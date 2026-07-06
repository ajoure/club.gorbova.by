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

const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
const functionsInvoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithOtp: (...a: any[]) => signInWithOtp(...a),
      verifyOtp: vi.fn(),
      updateUser: vi.fn(),
    },
    functions: { invoke: (...a: any[]) => functionsInvoke(...a) },
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

  it("new user → shows details step; does NOT call signInWithOtp before submit", async () => {
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
    expect(screen.getByRole("button", { name: /Получить код/i })).toBeTruthy();
  });
});
