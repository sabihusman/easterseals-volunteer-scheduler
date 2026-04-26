import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Tier 1 auth tests for Auth (Sign In + Register tabs).
 *
 * Mocked: supabase.auth.* + rpc + from(...).insert + signInWithOAuth,
 * Turnstile widget, react-router-dom navigate/location/Link, useToast,
 * sendEmail (fire-and-forget welcome email on register).
 *
 * Sign In:
 *   - Username identifier resolves through `get_email_by_username` RPC.
 *   - Username-not-found returns generic "Invalid credentials" — verified
 *     literally to guard against email-enumeration regressions.
 *   - MFA AAL check after sign-in routes to /mfa-verify when step-up is needed.
 *
 * Register:
 *   - Zod validates name/email/username/password; we drive the schema
 *     errors through specific field-level inputs.
 *   - Username availability RPC + TOS + Turnstile must all be true.
 *
 * The dead `showReset` branch (lines 205–243 of Auth.tsx) is intentionally
 * not tested — it's unreachable. Tracked separately as a follow-up issue.
 */

const signInWithPasswordMock = vi.fn();
const signUpMock = vi.fn();
const getAALMock = vi.fn();
const signInWithOAuthMock = vi.fn();
const rpcMock = vi.fn();
const insertMock = vi.fn();
const sendEmailMock = vi.fn();
const navigateMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args),
      signUp: (...args: unknown[]) => signUpMock(...args),
      signInWithOAuth: (...args: unknown[]) => signInWithOAuthMock(...args),
      mfa: {
        getAuthenticatorAssuranceLevel: (...args: unknown[]) => getAALMock(...args),
      },
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => ({
      insert: (...args: unknown[]) => insertMock(...args),
    }),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/email-utils", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: (props: { onSuccess: (t: string) => void }) => (
    <button type="button" onClick={() => props.onSuccess("mock-turnstile-token")}>
      Mock Turnstile
    </button>
  ),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({ pathname: "/auth", state: null, search: "", hash: "", key: "" }),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

import Auth from "@/pages/Auth";

beforeEach(() => {
  signInWithPasswordMock.mockReset();
  signUpMock.mockReset();
  getAALMock.mockReset();
  signInWithOAuthMock.mockReset();
  rpcMock.mockReset();
  insertMock.mockReset();
  sendEmailMock.mockReset();
  navigateMock.mockReset();
  toastMock.mockReset();
  // Default: no MFA step-up required.
  getAALMock.mockResolvedValue({
    data: { currentLevel: "aal1", nextLevel: "aal1" },
    error: null,
  });
  sendEmailMock.mockResolvedValue(undefined);
});

function clickTurnstile() {
  fireEvent.click(screen.getAllByRole("button", { name: /mock turnstile/i })[0]);
}

/**
 * Direct id-based queries. Auth.tsx gives every input an explicit id, and
 * Radix Tabs unmounts inactive tab content, so an id-by-id approach is
 * deterministic across the tab switch in a way label-text queries are not.
 */
function getInput(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Input #${id} not in DOM`);
  return el as HTMLInputElement;
}

function fillLogin(identifier: string, password: string) {
  fireEvent.change(getInput("login-identifier"), { target: { value: identifier } });
  fireEvent.change(getInput("login-password"), { target: { value: password } });
}

/**
 * Submit a form via fireEvent.submit on its <form> ancestor. The submit
 * button text changes based on Turnstile state ("Sign In" → "Verifying..." →
 * "Signing in...") so a button-text query is fragile; the form-submit path
 * dispatches the same onSubmit handler regardless.
 */
function submitFormContaining(input: HTMLElement) {
  const form = input.closest("form");
  if (!form) throw new Error("Input is not inside a form");
  fireEvent.submit(form);
}

function fillRegister(opts: Partial<{ name: string; email: string; username: string; password: string; tos: boolean }>) {
  if (opts.name !== undefined) {
    fireEvent.change(getInput("reg-name"), { target: { value: opts.name } });
  }
  if (opts.email !== undefined) {
    fireEvent.change(getInput("reg-email"), { target: { value: opts.email } });
  }
  if (opts.username !== undefined) {
    fireEvent.change(getInput("reg-username"), { target: { value: opts.username } });
  }
  if (opts.password !== undefined) {
    fireEvent.change(getInput("reg-password"), { target: { value: opts.password } });
  }
  if (opts.tos) {
    fireEvent.click(screen.getByRole("checkbox", { name: /terms of service/i }));
  }
}

describe("Auth — Sign In tab", () => {
  it("renders sign-in form by default with identifier and password fields", () => {
    render(<Auth />);
    expect(getInput("login-identifier")).toBeInTheDocument();
    expect(getInput("login-password")).toBeInTheDocument();
  });

  it("shows verification toast and skips sign-in when no Turnstile token", () => {
    render(<Auth />);
    fillLogin("vol@example.com", "secret123");
    submitFormContaining(getInput("login-identifier"));
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringMatching(/verification required/i),
    }));
  });

  it("signs in with email identifier and navigates to / on success", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    render(<Auth />);
    fillLogin("vol@example.com", "secret123");
    clickTurnstile();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(signInWithPasswordMock).toHaveBeenCalledWith({
        email: "vol@example.com",
        password: "secret123",
        options: { captchaToken: "mock-turnstile-token" },
      });
      expect(navigateMock).toHaveBeenCalledWith("/");
    });
    expect(rpcMock).not.toHaveBeenCalled(); // email shouldn't trigger the username-resolve RPC
  });

  it("resolves username via RPC then signs in with the resolved email", async () => {
    rpcMock.mockResolvedValue({ data: "vol@example.com", error: null });
    signInWithPasswordMock.mockResolvedValue({ error: null });
    render(<Auth />);
    fillLogin("jane_doe", "secret123");
    clickTurnstile();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("get_email_by_username", { p_username: "jane_doe" });
      expect(signInWithPasswordMock).toHaveBeenCalledWith(expect.objectContaining({
        email: "vol@example.com",
      }));
    });
  });

  it("shows generic 'Invalid credentials' when username is not found (no enumeration leak)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    render(<Auth />);
    fillLogin("ghost_user", "secret123");
    clickTurnstile();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Login failed",
        description: "Invalid credentials.",
        variant: "destructive",
      }));
    });
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    // Guard against any leak of "user not found" / "no such user" / username-specific copy.
    const allDescs = toastMock.mock.calls.map((c) => (c[0] as { description?: string }).description);
    expect(allDescs.every((d) => !/not found|no such|user/i.test(d || ""))).toBe(true);
  });

  it("shows 'Login failed' toast when signInWithPassword returns an error", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { message: "wrong password" } });
    render(<Auth />);
    fillLogin("vol@example.com", "wrongpass");
    clickTurnstile();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Login failed",
        description: "Invalid credentials.",
        variant: "destructive",
      }));
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("navigates to /mfa-verify when MFA step-up is required after sign-in", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    getAALMock.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    render(<Auth />);
    fillLogin("vol@example.com", "secret123");
    clickTurnstile();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/mfa-verify");
    });
  });
});

describe("Auth — Register tab", () => {
  /**
   * Radix Tabs trigger value changes via onMouseDown (NOT onClick) — this
   * is in the Radix source. fireEvent.click silently no-ops on tab triggers.
   * Use mouseDown + click for full simulation.
   */
  async function switchToRegister() {
    const trigger = screen.getByRole("tab", { name: /register/i });
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(document.getElementById("reg-name")).not.toBeNull();
    });
  }

  it("reveals the registration form when the Register tab is clicked", async () => {
    render(<Auth />);
    await switchToRegister();
    expect(getInput("reg-name")).toBeInTheDocument();
    expect(getInput("reg-email")).toBeInTheDocument();
    expect(getInput("reg-username")).toBeInTheDocument();
  });

  it("renders zod field errors when the form is empty on submit", async () => {
    render(<Auth />);
    await switchToRegister();
    submitFormContaining(getInput("reg-name"));
    expect(screen.getByText(/full name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/invalid email address/i)).toBeInTheDocument();
    // zod fires the regex check before the min-length check on empty input,
    // so the username error here is "letters, numbers, and underscores".
    // We assert that *some* username-side error rendered rather than pinning
    // to one of the three possible messages.
    // Helper text below the username field says "3-30 characters, letters,
    // numbers, and underscores only" — so a /letters, numbers/i match also
    // catches the helper. Assert at least 2 matches when the error renders
    // alongside it, or 1 match for the min-length variant.
    const minLenErr = screen.queryByText(/username must be at least 3/i);
    const regexErr = screen.queryAllByText(/letters, numbers, and underscores/i);
    expect(minLenErr !== null || regexErr.length >= 2).toBe(true);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("renders email error for invalid email format", async () => {
    render(<Auth />);
    await switchToRegister();
    fillRegister({ name: "Jane", email: "not-an-email", username: "jane_d", password: "abcd1234" });
    submitFormContaining(getInput("reg-name"));
    expect(screen.getByText(/invalid email address/i)).toBeInTheDocument();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("renders password error when password lacks a digit", async () => {
    render(<Auth />);
    await switchToRegister();
    fillRegister({ name: "Jane", email: "j@example.com", username: "jane_d", password: "noDigitsHere" });
    submitFormContaining(getInput("reg-name"));
    expect(screen.getByText(/must contain at least one number/i)).toBeInTheDocument();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("registers successfully when validation, username availability, TOS, and Turnstile all pass", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null }); // username_available → true
    signUpMock.mockResolvedValue({ data: { user: { id: "new-user-id" } }, error: null });
    insertMock.mockResolvedValue({ error: null });

    render(<Auth />);
    await switchToRegister();
    fillRegister({ name: "Jane Doe", email: "jane@example.com", username: "jane_doe", password: "abcd1234", tos: true });
    clickTurnstile();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("username_available", { p_username: "jane_doe" });
      expect(signUpMock).toHaveBeenCalledWith(expect.objectContaining({
        email: "jane@example.com",
        password: "abcd1234",
      }));
      expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
        id: "new-user-id",
        email: "jane@example.com",
        username: "jane_doe",
        full_name: "Jane Doe",
        role: "volunteer",
      }));
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Account created",
      }));
    });
    // Welcome email is fire-and-forget — we don't await it but it should be invoked.
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "jane@example.com",
      type: "registration_welcome",
    }));
  });

  it("shows username-taken error and skips signUp when RPC returns not-available", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    render(<Auth />);
    await switchToRegister();
    fillRegister({ name: "Jane Doe", email: "jane@example.com", username: "jane_doe", password: "abcd1234", tos: true });
    clickTurnstile();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/username is already taken/i)).toBeInTheDocument();
    });
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("shows toast and skips signUp when TOS is not accepted", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    render(<Auth />);
    await switchToRegister();
    fillRegister({ name: "Jane Doe", email: "jane@example.com", username: "jane_doe", password: "abcd1234" });
    // Skip TOS click intentionally.
    clickTurnstile();
    submitFormContaining(getInput("reg-name"));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: expect.stringMatching(/terms required/i),
      }));
    });
    expect(signUpMock).not.toHaveBeenCalled();
  });
});
