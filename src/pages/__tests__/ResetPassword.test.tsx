import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Tier 1 auth tests for ResetPassword.
 *
 * Mocked: supabase auth.updateUser, react-router-dom navigate + Link, toast.
 * The page is hash-gated (`#type=recovery`) — tests set the hash before
 * mount via a helper.
 *
 * The success path schedules a 2s setTimeout to navigate. We spy on
 * window.setTimeout and invoke the captured callback manually rather
 * than mixing fake timers with async work — cleaner and deterministic.
 */

const updateUserMock = vi.fn();
const navigateMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      updateUser: (...args: unknown[]) => updateUserMock(...args),
    },
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

import ResetPassword from "@/pages/ResetPassword";

function setHash(hash: string) {
  // jsdom's location.hash is writable
  window.location.hash = hash;
}

beforeEach(() => {
  updateUserMock.mockReset();
  navigateMock.mockReset();
  toastMock.mockReset();
  setHash("");
});

function fillForm(password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: confirm } });
}

describe("ResetPassword", () => {
  it("shows invalid-link card when hash does not contain type=recovery", () => {
    setHash(""); // no recovery flag
    render(<ResetPassword />);
    expect(screen.getByText(/this reset link has expired or is invalid/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /request a new reset link/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^new password$/i)).not.toBeInTheDocument();
  });

  it("renders the password form when hash contains type=recovery", () => {
    setHash("#access_token=abc&type=recovery");
    render(<ResetPassword />);
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
  });

  it("disables submit when password is shorter than 8 characters", () => {
    setHash("#type=recovery");
    render(<ResetPassword />);
    fillForm("abc1", "abc1");
    expect(screen.getByRole("button", { name: /update password/i })).toBeDisabled();
  });

  it("disables submit when password lacks a letter", () => {
    setHash("#type=recovery");
    render(<ResetPassword />);
    fillForm("12345678", "12345678");
    expect(screen.getByRole("button", { name: /update password/i })).toBeDisabled();
  });

  it("disables submit when password lacks a digit", () => {
    setHash("#type=recovery");
    render(<ResetPassword />);
    fillForm("abcdefgh", "abcdefgh");
    expect(screen.getByRole("button", { name: /update password/i })).toBeDisabled();
  });

  it("shows mismatch error and disables submit when passwords do not match", () => {
    setHash("#type=recovery");
    render(<ResetPassword />);
    fillForm("abcd1234", "different1");
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /update password/i })).toBeDisabled();
  });

  it("calls updateUser, shows success state, and schedules a 2s redirect on submit success", async () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    updateUserMock.mockResolvedValue({ error: null });
    setHash("#type=recovery");
    render(<ResetPassword />);

    fillForm("validpw1", "validpw1");
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({ password: "validpw1" });
    });
    expect(await screen.findByText(/password updated successfully/i)).toBeInTheDocument();

    // The redirect is scheduled with setTimeout(..., 2000) but hasn't fired yet.
    expect(navigateMock).not.toHaveBeenCalled();
    const redirectCall = setTimeoutSpy.mock.calls.find((c) => c[1] === 2000);
    expect(redirectCall).toBeDefined();

    // Manually invoke the scheduled callback — confirms it would navigate.
    const callback = redirectCall![0] as () => void;
    callback();
    expect(navigateMock).toHaveBeenCalledWith("/dashboard");

    setTimeoutSpy.mockRestore();
  });

  it("shows error toast and stays on form on supabase error", async () => {
    updateUserMock.mockResolvedValue({ error: { message: "session expired" } });
    setHash("#type=recovery");
    render(<ResetPassword />);

    fillForm("validpw1", "validpw1");
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Error",
        description: "session expired",
        variant: "destructive",
      }));
    });
    expect(screen.queryByText(/password updated successfully/i)).not.toBeInTheDocument();
  });
});
