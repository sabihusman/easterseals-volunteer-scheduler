import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

/**
 * Tier 2 test for DeleteAccountPanel.
 *
 * The email-typing gate is the security primitive: nothing destructive
 * fires until the user types their email exactly. Tests verify both the
 * UI gate and the success/error branches.
 */

const invokeMock = vi.fn();
const navigateMock = vi.fn();
const toastMock = vi.fn();
const onSignOutMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

import { DeleteAccountPanel } from "@/components/settings/DeleteAccountPanel";

const baseProps = {
  userId: "user-123",
  email: "vol@example.com",
  role: "volunteer" as const,
  onSignOut: onSignOutMock,
};

beforeEach(() => {
  invokeMock.mockReset();
  navigateMock.mockReset();
  toastMock.mockReset();
  onSignOutMock.mockReset();
  onSignOutMock.mockResolvedValue(undefined);
});

async function openConfirm() {
  // Radix AlertDialog Trigger (with asChild) forwards click handlers to the
  // Button, but the open transition mounts the content asynchronously via
  // Radix Presence — we wait for the dialog to fully appear before any
  // assertions. Both the trigger button and the confirm button inside the
  // dialog use the text "Delete My Account", so subsequent queries scope
  // via `within(dialog)` to disambiguate.
  const trigger = screen.getByRole("button", { name: /delete my account/i });
  fireEvent.click(trigger);
  return await screen.findByRole("alertdialog");
}

function confirmButton(dialog: HTMLElement) {
  return within(dialog).getByRole("button", { name: /delete my account/i });
}

describe("DeleteAccountPanel", () => {
  it("keeps the confirm button disabled when typed email does not match", async () => {
    render(<DeleteAccountPanel {...baseProps} />);
    const dialog = await openConfirm();
    fireEvent.change(within(dialog).getByPlaceholderText(baseProps.email), {
      target: { value: "wrong@example.com" },
    });
    expect(confirmButton(dialog)).toBeDisabled();
  });

  it("enables the confirm button when typed email matches exactly", async () => {
    render(<DeleteAccountPanel {...baseProps} />);
    const dialog = await openConfirm();
    fireEvent.change(within(dialog).getByPlaceholderText(baseProps.email), {
      target: { value: baseProps.email },
    });
    expect(confirmButton(dialog)).toBeEnabled();
  });

  it("invokes delete-user, signs out, and navigates with accountDeleted state on success", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });
    render(<DeleteAccountPanel {...baseProps} />);
    const dialog = await openConfirm();
    fireEvent.change(within(dialog).getByPlaceholderText(baseProps.email), {
      target: { value: baseProps.email },
    });
    fireEvent.click(confirmButton(dialog));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete-user", { body: { userId: "user-123" } });
      expect(onSignOutMock).toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith("/auth", { state: { accountDeleted: true } });
    });
  });

  it("shows error toast and does NOT sign out or navigate when supabase returns an error", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "edge fn down" } });
    render(<DeleteAccountPanel {...baseProps} />);
    const dialog = await openConfirm();
    fireEvent.change(within(dialog).getByPlaceholderText(baseProps.email), {
      target: { value: baseProps.email },
    });
    fireEvent.click(confirmButton(dialog));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Error",
        description: expect.stringMatching(/could not delete account/i),
        variant: "destructive",
      }));
    });
    expect(onSignOutMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

});
