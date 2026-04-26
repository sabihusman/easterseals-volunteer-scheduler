import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Tier 3 test for LoginForm (QR check-in login).
 *
 * Same security guard as Auth.tsx test #5 from Tier 1: username-not-found
 * must surface a generic "Invalid credentials" — no email-enumeration leak.
 *
 * The MFA AAL gate is the second half of the auth transaction and stays
 * inside this component; tests cover both the no-step-up path (call
 * onLoginSuccess) and the step-up-required path (toast + refuse).
 */

const signInWithPasswordMock = vi.fn();
const getAALMock = vi.fn();
const resolveLoginIdentifierToEmailMock = vi.fn();
const toastMock = vi.fn();
const onLoginSuccessMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...a: unknown[]) => signInWithPasswordMock(...a),
      mfa: {
        getAuthenticatorAssuranceLevel: (...a: unknown[]) => getAALMock(...a),
      },
    },
  },
}));

vi.mock("@/lib/checkin-actions", () => ({
  resolveLoginIdentifierToEmail: (...a: unknown[]) => resolveLoginIdentifierToEmailMock(...a),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: (props: { onSuccess: (t: string) => void }) => (
    <button type="button" onClick={() => props.onSuccess("mock-turnstile-token")}>
      Mock Turnstile
    </button>
  ),
}));

import { LoginForm } from "@/components/checkin/LoginForm";

beforeEach(() => {
  signInWithPasswordMock.mockReset();
  getAALMock.mockReset();
  resolveLoginIdentifierToEmailMock.mockReset();
  toastMock.mockReset();
  onLoginSuccessMock.mockReset();
  // Default: no MFA step-up required.
  getAALMock.mockResolvedValue({
    data: { currentLevel: "aal1", nextLevel: "aal1" },
    error: null,
  });
});

function fillCredentials(identifier: string, password: string) {
  const idInput = document.getElementById("checkin-identifier") as HTMLInputElement;
  const pwInput = document.getElementById("checkin-password") as HTMLInputElement;
  fireEvent.change(idInput, { target: { value: identifier } });
  fireEvent.change(pwInput, { target: { value: password } });
}

function clickTurnstile() {
  fireEvent.click(screen.getByRole("button", { name: /mock turnstile/i }));
}

function submit() {
  // Button text varies with state; submit via the form to avoid label drift.
  const form = (document.getElementById("checkin-identifier") as HTMLInputElement).closest("form")!;
  fireEvent.submit(form);
}

describe("LoginForm", () => {
  it("shows verification toast and skips signin when no Turnstile token", () => {
    render(<LoginForm onLoginSuccess={onLoginSuccessMock} />);
    fillCredentials("vol@example.com", "secret123");
    submit();
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringMatching(/verification required/i),
    }));
  });

  it("calls onLoginSuccess with the user when email login succeeds and no MFA step-up is needed", async () => {
    const fakeUser = { id: "user-1", email: "vol@example.com" };
    signInWithPasswordMock.mockResolvedValue({ data: { session: { user: fakeUser } }, error: null });
    render(<LoginForm onLoginSuccess={onLoginSuccessMock} />);
    fillCredentials("vol@example.com", "secret123");
    clickTurnstile();
    submit();

    await waitFor(() => {
      expect(signInWithPasswordMock).toHaveBeenCalledWith({
        email: "vol@example.com",
        password: "secret123",
        options: { captchaToken: "mock-turnstile-token" },
      });
      expect(onLoginSuccessMock).toHaveBeenCalledWith(fakeUser);
    });
    // Email path skips the username-resolve RPC.
    expect(resolveLoginIdentifierToEmailMock).not.toHaveBeenCalled();
  });

  it("resolves a username via RPC then signs in with the resolved email", async () => {
    resolveLoginIdentifierToEmailMock.mockResolvedValue("vol@example.com");
    const fakeUser = { id: "user-1", email: "vol@example.com" };
    signInWithPasswordMock.mockResolvedValue({ data: { session: { user: fakeUser } }, error: null });
    render(<LoginForm onLoginSuccess={onLoginSuccessMock} />);
    fillCredentials("jane_doe", "secret123");
    clickTurnstile();
    submit();

    await waitFor(() => {
      expect(resolveLoginIdentifierToEmailMock).toHaveBeenCalledWith("jane_doe");
      expect(signInWithPasswordMock).toHaveBeenCalledWith(expect.objectContaining({
        email: "vol@example.com",
      }));
    });
  });

  it("shows generic 'Invalid credentials' when username is not found (no enumeration leak)", async () => {
    resolveLoginIdentifierToEmailMock.mockResolvedValue(null);
    render(<LoginForm onLoginSuccess={onLoginSuccessMock} />);
    fillCredentials("ghost_user", "secret123");
    clickTurnstile();
    submit();

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Login failed",
        description: "Invalid credentials.",
        variant: "destructive",
      }));
    });
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(onLoginSuccessMock).not.toHaveBeenCalled();
    // Guard against any leak of "user not found" / "no such user" / username-specific copy.
    const calls = toastMock.mock.calls.flat();
    for (const c of calls) {
      const desc = (c as { description?: string }).description ?? "";
      expect(desc).not.toMatch(/not found|no such|user.*exist/i);
    }
  });

  it("shows 'Login failed' toast when signInWithPassword returns an error", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { session: null }, error: { message: "wrong pw" } });
    render(<LoginForm onLoginSuccess={onLoginSuccessMock} />);
    fillCredentials("vol@example.com", "wrongpass");
    clickTurnstile();
    submit();

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Login failed",
        variant: "destructive",
      }));
    });
    expect(onLoginSuccessMock).not.toHaveBeenCalled();
  });

  it("shows MFA-required toast and does NOT call onLoginSuccess when AAL step-up is required", async () => {
    const fakeUser = { id: "user-1", email: "vol@example.com" };
    signInWithPasswordMock.mockResolvedValue({ data: { session: { user: fakeUser } }, error: null });
    getAALMock.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    render(<LoginForm onLoginSuccess={onLoginSuccessMock} />);
    fillCredentials("vol@example.com", "secret123");
    clickTurnstile();
    submit();

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "MFA Required",
        variant: "destructive",
      }));
    });
    // The login transaction stops at the gate — no onLoginSuccess call.
    expect(onLoginSuccessMock).not.toHaveBeenCalled();
  });
});
