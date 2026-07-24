/**
 * Smoke tests for InlineEmailOtpForm (PATCH-INLINE-OTP-FIX-BROKEN-FLOW).
 *
 * Covers:
 *   - email step exposes email autocomplete
 *   - existing profile → skips details, lands directly on code step
 *     with the one-time-code AutoFill contract Apple devices rely on
 *   - new user → shows details step (name required)
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { signInWithOtp, functionsInvoke } = vi.hoisted(() => ({
  signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
  functionsInvoke: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithOtp,
      verifyOtp: vi.fn(),
      updateUser: vi.fn(),
      signOut: vi.fn(),
    },
    functions: { invoke: functionsInvoke },
  },
}));

import { InlineEmailOtpForm } from "./InlineEmailOtpForm";

describe("InlineEmailOtpForm", () => {
  it("email step renders with proper email autocomplete", () => {
    render(<InlineEmailOtpForm onAuthenticated={() => {}} />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.getAttribute("autocomplete")).toBe("email");
    expect(email.getAttribute("inputmode")).toBe("email");
  });

  it("existing profile → OTP step directly, one-time-code AutoFill contract present", async () => {
    functionsInvoke.mockResolvedValueOnce({
      data: { exists: true, hasPassword: true, profile_name: "Existing User" },
      error: null,
    });
    functionsInvoke.mockResolvedValueOnce({
      data: { success: true },
      error: null,
    });
    signInWithOtp.mockClear();
    signInWithOtp.mockResolvedValueOnce({ error: null });
    render(<InlineEmailOtpForm onAuthenticated={() => {}} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "existing@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Продолжить/i }));

    await waitFor(() => expect(screen.getByText(/Код отправлен на/i)).toBeTruthy());

    const otpInput = document.getElementById("one-time-code") as HTMLInputElement | null;
    expect(otpInput).toBeTruthy();
    expect(otpInput!.getAttribute("autocomplete")).toBe("one-time-code");
    expect(otpInput!.getAttribute("inputmode")).toBe("numeric");
    expect(otpInput!.getAttribute("name")).toBe("one-time-code");
    expect(otpInput!.getAttribute("maxlength")).toBe("6");
  });

  it("new user → requires matching passwords and exposes password visibility controls", async () => {
    functionsInvoke.mockResolvedValueOnce({
      data: { exists: false, hasPassword: false, profile_name: null },
      error: null,
    });
    signInWithOtp.mockClear();
    render(<InlineEmailOtpForm onAuthenticated={() => {}} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Продолжить/i }));

    await waitFor(() => expect(screen.getByLabelText("Имя")).toBeTruthy());
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Создайте пароль")).toBeTruthy();
    expect(screen.getByLabelText("Повторите пароль")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Показать пароль" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Показать повтор пароля" })).toBeTruthy();
    expect(screen.getByLabelText("Требования к паролю").textContent).toContain("Минимум 6 символов");

    const submit = screen.getByRole("button", { name: /Получить код/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Создайте пароль"), {
      target: { value: "test12" },
    });
    fireEvent.change(screen.getByLabelText("Повторите пароль"), {
      target: { value: "test13" },
    });
    expect(screen.getByText("Пароли не совпадают")).toBeTruthy();
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Повторите пароль"), {
      target: { value: "test12" },
    });
    fireEvent.change(screen.getByLabelText("Имя"), {
      target: { value: "Ирина" },
    });
    expect(screen.getByText("Пароли совпадают")).toBeTruthy();
    expect(submit.disabled).toBe(false);
  });
});
