/**
 * Tests for InlineAuthForm (PATCH-INLINE-AUTH-PASSWORD-TABS).
 *
 * Contract:
 *   - Default mode = "link" (password).
 *   - Login tab uses supabase.auth.signInWithPassword, NEVER OTP.
 *   - Wrong password surfaces controlled error, no account existence leak.
 *   - Signup tab delegates to the six-digit email OTP registration form.
 *   - Password reset invokes auth-actions Edge Function with action=reset_password.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InlineAuthForm } from "./InlineAuthForm";

const signInWithPassword = vi.fn();
const signUp = vi.fn();
const functionsInvoke = vi.fn();
const otpAuthenticated = vi.fn();

vi.mock("./InlineEmailOtpForm", () => ({
  InlineEmailOtpForm: ({ onAuthenticated }: { onAuthenticated: (email: string, userId: string) => void }) => (
    <button
      type="button"
      onClick={() => {
        otpAuthenticated();
        onAuthenticated("verified@example.com", "u2");
      }}
    >
      Подтвердить регистрацию кодом
    </button>
  ),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: any[]) => signInWithPassword(...args),
      signUp: (...args: any[]) => signUp(...args),
    },
    functions: { invoke: (...args: any[]) => functionsInvoke(...args) },
  },
}));

// Force "link" mode regardless of env at test time.
vi.mock("@/lib/inlineAuth/mode", () => ({
  INLINE_AUTH_MODE: "link",
  getInlineAuthMode: () => "link",
}));

beforeEach(() => {
  signInWithPassword.mockReset();
  signUp.mockReset();
  functionsInvoke.mockReset();
  otpAuthenticated.mockReset();
});

describe("InlineAuthForm (password tabs)", () => {
  it("renders explicit Войти / Зарегистрироваться tabs", () => {
    render(<InlineAuthForm onAuthenticated={() => {}} />);
    expect(screen.getByRole("tab", { name: /Войти/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Зарегистрироваться/ })).toBeTruthy();
  });

  it("login uses signInWithPassword with lowercased email — NO OTP call", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const onAuthenticated = vi.fn();
    render(<InlineAuthForm onAuthenticated={onAuthenticated} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "  Shefska@Gmail.com " } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "SecretPass1" } });
    fireEvent.click(screen.getByRole("button", { name: /Войти/ }));

    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1));
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "shefska@gmail.com",
      password: "SecretPass1",
    });
    // No OTP request must be issued for a normal sign-in.
    const otpCalls = functionsInvoke.mock.calls.filter((c) => /otp/i.test(c[0]));
    expect(otpCalls).toHaveLength(0);
    await waitFor(() =>
      expect(onAuthenticated).toHaveBeenCalledWith("shefska@gmail.com", "u1"),
    );
  });

  it("invalid credentials surface controlled error without account leak", async () => {
    signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: "Invalid login credentials" },
    });
    render(<InlineAuthForm onAuthenticated={() => {}} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "x@y.com" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /Войти/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Неверный email или пароль/);
    // Must not reveal whether the account exists.
    expect(alert.textContent).not.toMatch(/аккаунт|существует|найден/i);
  });

  it("signup uses six-digit OTP and never calls link-based signUp", async () => {
    const onAuthenticated = vi.fn();
    render(<InlineAuthForm onAuthenticated={onAuthenticated} defaultTab="signup" />);

    fireEvent.click(screen.getByRole("button", { name: /Подтвердить регистрацию кодом/i }));

    expect(signUp).not.toHaveBeenCalled();
    expect(otpAuthenticated).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(onAuthenticated).toHaveBeenCalledWith("verified@example.com", "u2"),
    );
  });

  it("«Забыли пароль?» triggers auth-actions reset_password recovery", async () => {
    functionsInvoke.mockResolvedValue({ data: {}, error: null });
    render(<InlineAuthForm onAuthenticated={() => {}} initialEmail="shefska@gmail.com" />);

    fireEvent.click(screen.getByRole("button", { name: /Забыли пароль/ }));

    await waitFor(() =>
      expect(functionsInvoke).toHaveBeenCalledWith("auth-actions", expect.objectContaining({
        body: expect.objectContaining({ action: "reset_password", email: "shefska@gmail.com" }),
      })),
    );
  });
});
