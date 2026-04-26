import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Tier 1 auth flow tests for ForgotPassword.
 *
 * Mocked: supabase client, Turnstile widget, react-router-dom, useToast.
 * Each test asserts a single observable behavior — what supabase was called
 * with, what toast was fired, or what UI state is visible.
 */

const resetPasswordForEmailMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmailMock(...args),
    },
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

// Turnstile renders as a button; clicking it simulates a successful captcha.
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
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

import ForgotPassword from "@/pages/ForgotPassword";

beforeEach(() => {
  resetPasswordForEmailMock.mockReset();
  toastMock.mockReset();
});

describe("ForgotPassword", () => {
  it("renders the email field and Turnstile widget", () => {
    render(<ForgotPassword />);
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mock turnstile/i })).toBeInTheDocument();
    // Submit is disabled until the captcha succeeds.
    expect(screen.getByRole("button", { name: /verifying/i })).toBeDisabled();
  });

  it("shows verification toast and skips supabase when no Turnstile token", () => {
    render(<ForgotPassword />);
    const form = screen.getByLabelText(/email address/i).closest("form")!;
    fireEvent.submit(form);
    expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringMatching(/verification required/i),
      variant: "destructive",
    }));
  });

  it("calls resetPasswordForEmail and shows the sent state on success", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ error: null });
    render(<ForgotPassword />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "vol@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /mock turnstile/i }));
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(resetPasswordForEmailMock).toHaveBeenCalledWith(
        "vol@example.com",
        expect.objectContaining({ captchaToken: "mock-turnstile-token" }),
      );
    });
    // Sent state — generic copy not promising "we sent it" but "if account exists you'll get one".
    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument();
  });

  it("shows error toast and does NOT show the sent state on supabase error", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ error: { message: "rate limited" } });
    render(<ForgotPassword />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "vol@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /mock turnstile/i }));
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Error",
        description: "rate limited",
        variant: "destructive",
      }));
    });
    expect(screen.queryByText(/if an account exists/i)).not.toBeInTheDocument();
  });
});
