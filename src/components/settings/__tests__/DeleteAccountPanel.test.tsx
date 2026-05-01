import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

/**
 * DeleteAccountPanel tests — issue #178 fix.
 *
 * The email-typing gate is the security primitive: nothing destructive
 * fires until the user types their account email. After the fix the
 * panel calls the new `delete-self` edge function and redirects to
 * /account-deleted (not the previous /auth?accountDeleted=true state
 * that relied on a now-gone toast).
 *
 * Tests cover the full brief:
 *   - Confirm button disabled until email matches
 *   - Case-insensitive but trim-sensitive comparison
 *   - Successful delete redirects to /account-deleted
 *   - Admin-blocked-self-delete error surfaces verbatim
 *   - Generic error path collapses to "contact support" copy
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
  // Radix AlertDialog mounts content asynchronously; wait for the
  // dialog to be present before any inner queries. Both the trigger
  // button and the action button render text containing "delete my
  // account" — scope confirmation queries via within(dialog).
  const trigger = screen.getByRole("button", { name: /delete my account/i });
  fireEvent.click(trigger);
  return await screen.findByRole("alertdialog");
}

function confirmButton(dialog: HTMLElement) {
  // The action button text now reads "Delete my account" (lower-case 'm');
  // the trigger reads "Delete My Account". Match by either case.
  return within(dialog).getByRole("button", { name: /delete my account/i });
}

describe("DeleteAccountPanel", () => {
  describe("email-typing gate", () => {
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

    it("matches case-insensitively (e.g. VOL@example.com → enabled)", async () => {
      render(<DeleteAccountPanel {...baseProps} />);
      const dialog = await openConfirm();
      fireEvent.change(within(dialog).getByPlaceholderText(baseProps.email), {
        target: { value: "VOL@EXAMPLE.COM" },
      });
      expect(confirmButton(dialog)).toBeEnabled();
    });

    it("rejects strings with leading/trailing whitespace (trim-sensitive)", async () => {
      // The brief's intent: paste-with-whitespace usually means the
      // user typed in the wrong place. Make them retype.
      render(<DeleteAccountPanel {...baseProps} />);
      const dialog = await openConfirm();
      fireEvent.change(within(dialog).getByPlaceholderText(baseProps.email), {
        target: { value: ` ${baseProps.email} ` },
      });
      expect(confirmButton(dialog)).toBeDisabled();
    });
  });

  describe("delete flow", () => {
    it("invokes delete-self, signs out, and navigates to /account-deleted on success", async () => {
      invokeMock.mockResolvedValue({ data: { success: true }, error: null });
      render(<DeleteAccountPanel {...baseProps} />);
      const dialog = await openConfirm();
      fireEvent.change(within(dialog).getByPlaceholderText(baseProps.email), {
        target: { value: baseProps.email },
      });
      fireEvent.click(confirmButton(dialog));

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith("delete-self", { body: {} });
        expect(onSignOutMock).toHaveBeenCalled();
        expect(navigateMock).toHaveBeenCalledWith("/account-deleted");
      });
    });

    it("does NOT pass the userId to the endpoint (server reads it from the JWT)", async () => {
      // Defensive: an earlier draft passed { userId } in the body.
      // The new endpoint identifies the caller from the JWT and only
      // accepts an optional target_user_id that MUST equal the JWT
      // sub. Easiest way to keep that invariant honest from the
      // client side is to send no target at all.
      invokeMock.mockResolvedValue({ data: { success: true }, error: null });
      render(<DeleteAccountPanel {...baseProps} />);
      const dialog = await openConfirm();
      fireEvent.change(within(dialog).getByPlaceholderText(baseProps.email), {
        target: { value: baseProps.email },
      });
      fireEvent.click(confirmButton(dialog));

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith("delete-self", { body: {} });
      });
      const [, callArgs] = invokeMock.mock.calls[0];
      expect((callArgs as { body: Record<string, unknown> }).body).not.toHaveProperty("userId");
      expect((callArgs as { body: Record<string, unknown> }).body).not.toHaveProperty("target_user_id");
    });

    it("surfaces the admin-blocked-self-delete error verbatim", async () => {
      // Admins hit the endpoint's role gate. The message includes
      // the user's next step ("Another admin must remove this
      // account.") — must surface verbatim, not collapsed into the
      // generic "contact support" copy.
      const adminMsg =
        "Admins cannot self-delete. Another admin must remove this account.";
      invokeMock.mockResolvedValue({
        data: { error: adminMsg },
        error: { message: adminMsg, name: "FunctionsHttpError" },
      });

      render(<DeleteAccountPanel {...baseProps} role="admin" />);
      const dialog = await openConfirm();
      fireEvent.change(within(dialog).getByPlaceholderText(baseProps.email), {
        target: { value: baseProps.email },
      });
      fireEvent.click(confirmButton(dialog));

      await waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
          title: "Could not delete account",
          description: adminMsg,
          variant: "destructive",
        }));
      });
      expect(onSignOutMock).not.toHaveBeenCalled();
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it("shows generic error toast on non-admin failures", async () => {
      // Network errors, 5xx, etc. Do NOT leak server details to the
      // toast — server-side logs carry the detail.
      invokeMock.mockResolvedValue({
        data: { error: "internal: pg connection refused" },
        error: { message: "edge fn down" },
      });

      render(<DeleteAccountPanel {...baseProps} />);
      const dialog = await openConfirm();
      fireEvent.change(within(dialog).getByPlaceholderText(baseProps.email), {
        target: { value: baseProps.email },
      });
      fireEvent.click(confirmButton(dialog));

      await waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
          title: "Could not delete account",
          description: expect.stringMatching(/contact support/i),
          variant: "destructive",
        }));
      });
      // Ensure the raw server error is NOT in the toast.
      const toastCall = toastMock.mock.calls[0][0] as { description: string };
      expect(toastCall.description).not.toMatch(/pg connection/i);
      expect(onSignOutMock).not.toHaveBeenCalled();
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  describe("coordinator copy", () => {
    it("shows coordinator-specific shift-attribution note when role=coordinator", () => {
      render(<DeleteAccountPanel {...baseProps} role="coordinator" />);
      // The trigger only — copy lives inside the dialog. Open it.
      fireEvent.click(screen.getByRole("button", { name: /delete my account/i }));
      // Use queryByText with regex; this passes only when the
      // coordinator-specific paragraph renders.
      expect(
        screen.getByText(/your created shifts will remain on the schedule/i),
      ).toBeInTheDocument();
    });

    it("does NOT show coordinator-specific copy when role=volunteer", () => {
      render(<DeleteAccountPanel {...baseProps} role="volunteer" />);
      fireEvent.click(screen.getByRole("button", { name: /delete my account/i }));
      expect(
        screen.queryByText(/your created shifts will remain on the schedule/i),
      ).not.toBeInTheDocument();
    });
  });
});
