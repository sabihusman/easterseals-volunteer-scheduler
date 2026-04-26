import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

/**
 * Tier 2 test for MfaPanel.
 *
 * Two render branches: enrolled vs not. Enrollment is a 3-step async flow
 * (enroll → challenge → verify) that — on success — generates backup codes
 * via RPC and renders the BackupCodesDialog. Tests cover both branches
 * plus the error paths and the regenerate + remove operations.
 *
 * Verified during test authoring: the production code DOES render the
 * BackupCodesDialog on first verify success (line 109: setBackupCodes(codes)
 * after verify). No bug to flag here.
 */

const listFactorsMock = vi.fn();
const enrollMock = vi.fn();
const challengeMock = vi.fn();
const verifyMock = vi.fn();
const unenrollMock = vi.fn();
const rpcMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      mfa: {
        listFactors: (...a: unknown[]) => listFactorsMock(...a),
        enroll: (...a: unknown[]) => enrollMock(...a),
        challenge: (...a: unknown[]) => challengeMock(...a),
        verify: (...a: unknown[]) => verifyMock(...a),
        unenroll: (...a: unknown[]) => unenrollMock(...a),
      },
    },
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { MfaPanel } from "@/components/settings/MfaPanel";

beforeEach(() => {
  listFactorsMock.mockReset();
  enrollMock.mockReset();
  challengeMock.mockReset();
  verifyMock.mockReset();
  unenrollMock.mockReset();
  rpcMock.mockReset();
  toastMock.mockReset();
  // Default: not enrolled.
  listFactorsMock.mockResolvedValue({ data: { totp: [] }, error: null });
});

describe("MfaPanel", () => {
  it("renders Enable 2FA button when no verified factor exists", async () => {
    render(<MfaPanel />);
    await screen.findByRole("button", { name: /enable 2fa/i });
    expect(screen.queryByText(/^active$/i)).not.toBeInTheDocument();
  });

  it("renders Active badge + Remove + backup-codes section when listFactors returns a verified factor", async () => {
    listFactorsMock.mockResolvedValue({
      data: { totp: [{ id: "factor-1", status: "verified" }] },
      error: null,
    });
    rpcMock.mockResolvedValue({ data: 7, error: null });
    render(<MfaPanel />);
    await screen.findByText(/^active$/i);
    expect(screen.getByRole("button", { name: /remove 2fa/i })).toBeInTheDocument();
    await screen.findByText(/7 of 10 codes remaining/i);
  });

  it("clicking Enable calls auth.mfa.enroll and opens the enrollment dialog with the QR code", async () => {
    enrollMock.mockResolvedValue({
      data: { id: "enroll-factor-1", totp: { qr_code: "data:image/png;base64,FAKEQR" } },
      error: null,
    });
    render(<MfaPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /enable 2fa/i }));
    await waitFor(() => expect(enrollMock).toHaveBeenCalledWith({ factorType: "totp" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByAltText(/mfa qr code/i)).toBeInTheDocument();
  });

  it("submitting a 6-digit verify code calls challenge + verify, generates backup codes, and renders BackupCodesDialog", async () => {
    enrollMock.mockResolvedValue({
      data: { id: "enroll-factor-1", totp: { qr_code: "data:image/png;base64,FAKEQR" } },
      error: null,
    });
    challengeMock.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
    verifyMock.mockResolvedValue({ error: null });
    rpcMock.mockResolvedValue({ data: ["AAA-111", "BBB-222", "CCC-333"], error: null });

    render(<MfaPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /enable 2fa/i }));
    const dialog = await screen.findByRole("dialog");
    const codeInput = within(dialog).getByPlaceholderText("000000");
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /verify & enable/i }));

    await waitFor(() => {
      expect(challengeMock).toHaveBeenCalledWith({ factorId: "enroll-factor-1" });
      expect(verifyMock).toHaveBeenCalledWith({
        factorId: "enroll-factor-1",
        challengeId: "challenge-1",
        code: "123456",
      });
      expect(rpcMock).toHaveBeenCalledWith("mfa_generate_backup_codes");
    });
    // BackupCodesDialog renders one cell per code.
    await screen.findByText("AAA-111");
    expect(screen.getByText("BBB-222")).toBeInTheDocument();
    expect(screen.getByText("CCC-333")).toBeInTheDocument();
  });

  it("verify error shows 'Verification failed' toast and clears the code field", async () => {
    enrollMock.mockResolvedValue({
      data: { id: "enroll-factor-1", totp: { qr_code: "data:image/png;base64,FAKEQR" } },
      error: null,
    });
    challengeMock.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
    verifyMock.mockResolvedValue({ error: { message: "wrong code" } });

    render(<MfaPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /enable 2fa/i }));
    const dialog = await screen.findByRole("dialog");
    const codeInput = within(dialog).getByPlaceholderText("000000") as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: "000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /verify & enable/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Verification failed",
        description: "wrong code",
        variant: "destructive",
      }));
    });
    // Code cleared. Confirm via the controlled input value.
    expect(codeInput.value).toBe("");
  });

  it("clicking Remove calls auth.mfa.unenroll and flips back to the not-enrolled view", async () => {
    listFactorsMock.mockResolvedValue({
      data: { totp: [{ id: "factor-1", status: "verified" }] },
      error: null,
    });
    rpcMock.mockResolvedValue({ data: 5, error: null });
    unenrollMock.mockResolvedValue({ error: null });

    render(<MfaPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /remove 2fa/i }));
    await waitFor(() => expect(unenrollMock).toHaveBeenCalledWith({ factorId: "factor-1" }));
    await screen.findByRole("button", { name: /enable 2fa/i });
    expect(screen.queryByText(/^active$/i)).not.toBeInTheDocument();
  });

  it("clicking Generate new codes calls the backup-codes RPC and renders the new codes", async () => {
    listFactorsMock.mockResolvedValue({
      data: { totp: [{ id: "factor-1", status: "verified" }] },
      error: null,
    });
    // First call: count fetch on mount. Subsequent: regenerate.
    rpcMock
      .mockResolvedValueOnce({ data: 5, error: null })
      .mockResolvedValueOnce({ data: ["NEW-1", "NEW-2"], error: null });

    render(<MfaPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /generate new codes/i }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("mfa_generate_backup_codes");
    });
    await screen.findByText("NEW-1");
    expect(screen.getByText("NEW-2")).toBeInTheDocument();
  });

  it("shows '0 of 10 codes remaining' messaging when the count RPC returns 0", async () => {
    listFactorsMock.mockResolvedValue({
      data: { totp: [{ id: "factor-1", status: "verified" }] },
      error: null,
    });
    rpcMock.mockResolvedValue({ data: 0, error: null });
    render(<MfaPanel />);
    await screen.findByText(/no codes remaining/i);
  });
});
