/**
 * Smoke test for InlineEmailOtpForm — verifies the OTP AutoFill contract that
 * iOS Safari / macOS Mail rely on. If any of these attributes disappear from
 * the rendered DOM, one-time-code AutoFill silently stops working on Apple
 * devices — hence this test.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signInWithOtp: (...a: any[]) => signInWithOtp(...a), verifyOtp: vi.fn(), updateUser: vi.fn() } },
}));

import { InlineEmailOtpForm } from "./InlineEmailOtpForm";

describe("InlineEmailOtpForm — one-time-code AutoFill contract", () => {
  it("email step renders with proper email autocomplete", () => {
    render(<InlineEmailOtpForm onAuthenticated={() => {}} />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.getAttribute("autocomplete")).toBe("email");
    expect(email.getAttribute("inputmode")).toBe("email");
  });

  it("after sending code, OTP input exposes one-time-code AutoFill attributes on a real <input>", async () => {
    render(<InlineEmailOtpForm onAuthenticated={() => {}} />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Получить код/i }));

    // Wait for step transition
    await waitFor(() => expect(screen.getByText(/Код отправлен на/i)).toBeTruthy());

    // The underlying real input rendered by input-otp
    const otpInput = document.getElementById("one-time-code") as HTMLInputElement | null;
    expect(otpInput).toBeTruthy();
    expect(otpInput!.getAttribute("autocomplete")).toBe("one-time-code");
    expect(otpInput!.getAttribute("inputmode")).toBe("numeric");
    expect(otpInput!.getAttribute("name")).toBe("one-time-code");
    expect(otpInput!.getAttribute("maxlength")).toBe("6");
  });
});
