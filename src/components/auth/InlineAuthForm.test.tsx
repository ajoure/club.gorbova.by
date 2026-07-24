/**
 * Tests for InlineAuthForm (PATCH-INLINE-AUTH-PASSWORD-TABS).
 *
 * Contract:
 *   - Default mode = "link" (password).
 *   - Login tab uses supabase.auth.signInWithPassword, NEVER OTP.
 *   - Wrong password surfaces controlled error, no account existence leak.
 *   - Signup tab uses supabase.auth.signUp; email-confirmation flow shown.
 *   - Password reset invokes auth-actions Edge Function with action=reset_password.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InlineAuthForm } from "./InlineAuthForm";

const signInWithPassword = vi.fn();
const signUp = vi.fn();
const functionsInvoke = vi.fn();

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

  it("signup calls supabase.auth.signUp and shows email-confirm screen when session is null", async () => {
    signUp.mockResolvedValue({
      data: { user: { id: "u2" }, session: null },
      error: null,
    });
    functionsInvoke.mockResolvedValue({ data: {}, error: null });
    render(<InlineAuthForm onAuthenticated={() => {}} />);

    fireEvent.click(screen.getByRole("tab", { name: /Зарегистрироваться/ }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@user.com" } });
    fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Ivan" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "LongEnough123" } });
    fireEvent.click(screen.getByRole("button", { name: /Зарегистрироваться/i }));

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    expect(signUp.mock.calls[0][0].email).toBe("new@user.com");
    // Verification-follow-up email dispatched via auth-actions.
    await waitFor(() =>
      expect(functionsInvoke).toHaveBeenCalledWith("auth-actions", expect.objectContaining({
        body: expect.objectContaining({ action: "confirm_signup", email: "new@user.com" }),
      })),
    );
    expect(await screen.findByText(/Подтвердите email/)).toBeTruthy();
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
