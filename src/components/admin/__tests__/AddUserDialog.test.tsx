import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

/**
 * Tier 2 test for AddUserDialog.
 *
 * Validates: form validation, admin cap enforcement, signUp + profiles.insert
 * flow, 23505 unique-violation handling (admin sees clear message — text
 * content asserted, not just toast call), and the form ↔ credentials view
 * lifecycle.
 *
 * generatePassword is mocked to a known string so credential assertions
 * are deterministic.
 */

const signUpMock = vi.fn();
const insertMock = vi.fn();
const toastMock = vi.fn();
const onUserCreatedMock = vi.fn();
const onOpenChangeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: (...args: unknown[]) => signUpMock(...args),
    },
    from: () => ({
      insert: (...args: unknown[]) => insertMock(...args),
    }),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/admin-user-utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-user-utils")>(
    "@/lib/admin-user-utils"
  );
  return {
    ...actual,
    generatePassword: () => "GENERATED-PW-FIXED",
  };
});

import { AddUserDialog } from "@/components/admin/AddUserDialog";

beforeEach(() => {
  signUpMock.mockReset();
  insertMock.mockReset();
  toastMock.mockReset();
  onUserCreatedMock.mockReset();
  onOpenChangeMock.mockReset();
});

function renderOpen(adminCount = 0) {
  return render(
    <AddUserDialog
      open={true}
      onOpenChange={onOpenChangeMock}
      adminCount={adminCount}
      onUserCreated={onUserCreatedMock}
    />
  );
}

function fillForm({ name, email }: { name: string; email: string }) {
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByPlaceholderText("Jane Smith"), { target: { value: name } });
  fireEvent.change(within(dialog).getByPlaceholderText("jane@example.com"), { target: { value: email } });
}

function clickCreate() {
  fireEvent.click(screen.getByRole("button", { name: /create user/i }));
}

describe("AddUserDialog", () => {
  it("rejects empty name with a visible error and does not call signUp", () => {
    renderOpen();
    fillForm({ name: "", email: "valid@example.com" });
    clickCreate();
    expect(screen.getByText(/name must be 2.*100 characters/i)).toBeInTheDocument();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("rejects invalid email format with a visible error and does not call signUp", () => {
    renderOpen();
    fillForm({ name: "Jane Doe", email: "not-an-email" });
    clickCreate();
    expect(screen.getByText(/enter a valid email/i)).toBeInTheDocument();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("blocks creating a 3rd admin when adminCount=2 (cap enforcement)", async () => {
    renderOpen(2);
    fillForm({ name: "Third Admin", email: "third@example.com" });
    // Radix Select doesn't respond to fireEvent.click in jsdom (uses pointer
    // events with capture phases that jsdom doesn't fully simulate). Easier
    // path: drive the trigger via keyboard, which Radix supports identically.
    const dialog = screen.getByRole("dialog");
    const roleTrigger = within(dialog).getByRole("combobox");
    fireEvent.keyDown(roleTrigger, { key: "Enter" });
    const adminOption = await screen.findByRole("option", { name: /^admin$/i });
    fireEvent.keyDown(adminOption, { key: "Enter" });
    clickCreate();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringMatching(/admin limit reached/i),
    }));
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("on successful create, calls signUp + profiles.insert and shows the credentials view", async () => {
    signUpMock.mockResolvedValue({ data: { user: { id: "new-user-id" } }, error: null });
    insertMock.mockResolvedValue({ error: null });
    renderOpen();
    fillForm({ name: "Jane Doe", email: "jane@example.com" });
    clickCreate();

    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalledWith(expect.objectContaining({
        email: "jane@example.com",
        password: "GENERATED-PW-FIXED",
      }));
      expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
        id: "new-user-id",
        email: "jane@example.com",
        full_name: "Jane Doe",
        role: "coordinator",
        is_active: true,
      }));
    });
    // Credentials view appears with the generated password visible.
    expect(await screen.findByText(/user created successfully/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("GENERATED-PW-FIXED")).toBeInTheDocument();
  });

  it("shows 'Error creating user' toast and skips profiles.insert when signUp fails", async () => {
    signUpMock.mockResolvedValue({ data: { user: null }, error: { message: "auth-broken" } });
    renderOpen();
    fillForm({ name: "Jane Doe", email: "jane@example.com" });
    clickCreate();

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Error creating user",
        description: "auth-broken",
        variant: "destructive",
      }));
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("renders the supabase 23505 unique-violation message verbatim so the admin sees a clear cause", async () => {
    signUpMock.mockResolvedValue({ data: { user: { id: "new-user-id" } }, error: null });
    // Real PostgREST shape for a unique-key violation.
    insertMock.mockResolvedValue({
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "profiles_email_key"',
      },
    });
    renderOpen();
    fillForm({ name: "Jane Doe", email: "jane@example.com" });
    clickCreate();

    // Admin must see both: a clear top-line title AND the supabase message itself
    // — not a stack trace, not silence, not a generic "something went wrong".
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "User created but profile insert failed",
        description: 'duplicate key value violates unique constraint "profiles_email_key"',
        variant: "destructive",
      }));
    });
    // Credentials view must NOT appear (insert failed).
    expect(screen.queryByText(/user created successfully/i)).not.toBeInTheDocument();
  });

  it("Done button on credentials view calls onUserCreated and closes the dialog", async () => {
    signUpMock.mockResolvedValue({ data: { user: { id: "new-user-id" } }, error: null });
    insertMock.mockResolvedValue({ error: null });
    renderOpen();
    fillForm({ name: "Jane Doe", email: "jane@example.com" });
    clickCreate();
    await screen.findByText(/user created successfully/i);
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onUserCreatedMock).toHaveBeenCalledTimes(1);
    expect(onOpenChangeMock).toHaveBeenCalledWith(false);
  });

  it("Cancel on form view closes the dialog without creating anything", () => {
    renderOpen();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onOpenChangeMock).toHaveBeenCalledWith(false);
    expect(onUserCreatedMock).not.toHaveBeenCalled();
    expect(signUpMock).not.toHaveBeenCalled();
  });
});
