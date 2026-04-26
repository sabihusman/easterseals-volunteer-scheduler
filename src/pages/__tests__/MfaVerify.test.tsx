import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Tier 1 auth tests for MfaVerify.
 *
 * The page mounts → fetches AAL → fetches factors → either redirects
 * (already aal2 / no aal2 needed) or renders the 6-digit form. Recovery
 * mode submits a backup code via the `mfa-recovery` edge function.
 *
 * Mocked: supabase.auth.mfa.* + functions.invoke + auth.signOut, navigate, toast.
 */

const getAALMock = vi.fn();
const listFactorsMock = vi.fn();
const challengeMock = vi.fn();
const verifyMock = vi.fn();
const signOutMock = vi.fn();
const invokeMock = vi.fn();
const navigateMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: (...args: unknown[]) => getAALMock(...args),
        listFactors: (...args: unknown[]) => listFactorsMock(...args),
        challenge: (...args: unknown[]) => challengeMock(...args),
        verify: (...args: unknown[]) => verifyMock(...args),
      },
      signOut: (...args: unknown[]) => signOutMock(...args),
    },
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

import MfaVerify from "@/pages/MfaVerify";

const verifiedFactor = { id: "totp-factor-1", status: "verified", factor_type: "totp" };

beforeEach(() => {
  getAALMock.mockReset();
  listFactorsMock.mockReset();
  challengeMock.mockReset();
  verifyMock.mockReset();
  signOutMock.mockReset();
  invokeMock.mockReset();
  navigateMock.mockReset();
  toastMock.mockReset();

  // Sensible defaults — tests override per-case.
  getAALMock.mockResolvedValue({
    data: { currentLevel: "aal1", nextLevel: "aal2" },
    error: null,
  });
  listFactorsMock.mockResolvedValue({
    data: { totp: [verifiedFactor] },
    error: null,
  });
  signOutMock.mockResolvedValue({ error: null });
});

describe("MfaVerify", () => {
  it("renders the 6-digit code form when MFA challenge is required", async () => {
    render(<MfaVerify />);
    expect(await screen.findByPlaceholderText("000000")).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("redirects to /dashboard when AAL is already aal2", async () => {
    getAALMock.mockResolvedValue({
      data: { currentLevel: "aal2", nextLevel: "aal2" },
      error: null,
    });
    render(<MfaVerify />);
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("redirects to /dashboard when nextLevel is not aal2", async () => {
    getAALMock.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal1" },
      error: null,
    });
    render(<MfaVerify />);
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("calls challenge + verify and navigates to /dashboard on valid 6-digit code", async () => {
    challengeMock.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
    verifyMock.mockResolvedValue({ data: {}, error: null });
    render(<MfaVerify />);

    const input = await screen.findByPlaceholderText("000000");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /^verify$/i }));

    await waitFor(() => {
      expect(challengeMock).toHaveBeenCalledWith({ factorId: "totp-factor-1" });
      expect(verifyMock).toHaveBeenCalledWith({
        factorId: "totp-factor-1",
        challengeId: "challenge-1",
        code: "123456",
      });
      expect(navigateMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("shows error toast and clears the code field on verify error", async () => {
    challengeMock.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
    verifyMock.mockResolvedValue({ data: null, error: { message: "wrong code" } });
    render(<MfaVerify />);

    const input = await screen.findByPlaceholderText("000000");
    fireEvent.change(input, { target: { value: "999999" } });
    fireEvent.click(screen.getByRole("button", { name: /^verify$/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Verification failed",
        variant: "destructive",
      }));
    });
    // UX guard: the field is cleared so the user can retry without manually deleting.
    expect((input as HTMLInputElement).value).toBe("");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows the backup-code form when recovery mode is toggled", async () => {
    render(<MfaVerify />);
    await screen.findByPlaceholderText("000000");
    fireEvent.click(screen.getByRole("button", { name: /backup recovery code/i }));
    expect(screen.getByPlaceholderText("XXXX-XXXX")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("000000")).not.toBeInTheDocument();
  });

  it("calls mfa-recovery edge function when backup code is submitted", async () => {
    invokeMock.mockResolvedValue({ data: { success: true }, error: null });
    render(<MfaVerify />);
    await screen.findByPlaceholderText("000000");
    fireEvent.click(screen.getByRole("button", { name: /backup recovery code/i }));

    fireEvent.change(screen.getByPlaceholderText("XXXX-XXXX"), {
      target: { value: "ABCD1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /use recovery code/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("mfa-recovery", {
        body: { code: "ABCD1234" },
      });
    });
  });

  it("signs out and navigates to /auth on successful recovery", async () => {
    invokeMock.mockResolvedValue({ data: { success: true }, error: null });
    render(<MfaVerify />);
    await screen.findByPlaceholderText("000000");
    fireEvent.click(screen.getByRole("button", { name: /backup recovery code/i }));

    fireEvent.change(screen.getByPlaceholderText("XXXX-XXXX"), {
      target: { value: "ABCD1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /use recovery code/i }));

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith("/auth");
    });
  });

  it("shows error toast and clears recovery code on invalid backup code", async () => {
    invokeMock.mockResolvedValue({ data: { success: false }, error: null });
    render(<MfaVerify />);
    await screen.findByPlaceholderText("000000");
    fireEvent.click(screen.getByRole("button", { name: /backup recovery code/i }));

    const input = screen.getByPlaceholderText("XXXX-XXXX");
    fireEvent.change(input, { target: { value: "BADCODE1" } });
    fireEvent.click(screen.getByRole("button", { name: /use recovery code/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Invalid recovery code",
        variant: "destructive",
      }));
    });
    expect((input as HTMLInputElement).value).toBe("");
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
