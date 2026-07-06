/**
 * Unit tests for useInlineEmailOtp
 * (PATCH-INLINE-OTP-EMAIL-SENDER-ROOT-FIX v2 — own OTP channel).
 *
 * Contract:
 *   - submitEmail → identify via auth-check-email:
 *       * existing + hasProfile → invoke("request-inline-otp") → step "sent"
 *       * else → step "details" (no OTP yet)
 *   - submitDetails(meta) → invoke("request-inline-otp") with meta → step "sent"
 *   - No signInWithOtp call anywhere.
 *   - verifyCode: invoke("verify-inline-otp") → auth.verifyOtp(token_hash, magiclink).
 *   - No token/code value appears in console.*.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
const updateUser = vi.fn().mockResolvedValue({ data: {}, error: null });
const functionsInvoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args: any[]) => signInWithOtp(...args),
      verifyOtp: (...args: any[]) => verifyOtp(...args),
      updateUser: (...args: any[]) => updateUser(...args),
    },
    functions: { invoke: (...args: any[]) => functionsInvoke(...args) },
  },
}));

import { useInlineEmailOtp } from "./useInlineEmailOtp";

// Helper: queue mock responses in the exact order the hook calls them.
function mockIdentify(payload: any) {
  functionsInvoke.mockImplementationOnce((name: string) => {
    expect(name).toBe("auth-check-email");
    return Promise.resolve({ data: payload, error: null });
  });
}
function mockRequestOtp(response: { data?: any; error?: any } = { data: { ok: true } }) {
  functionsInvoke.mockImplementationOnce((name: string) => {
    expect(name).toBe("request-inline-otp");
    return Promise.resolve(response);
  });
}
function mockVerifyOtpFn(response: { data?: any; error?: any }) {
  functionsInvoke.mockImplementationOnce((name: string) => {
    expect(name).toBe("verify-inline-otp");
    return Promise.resolve(response);
  });
}

describe("useInlineEmailOtp", () => {
  beforeEach(() => {
    signInWithOtp.mockReset();
    verifyOtp.mockReset();
    updateUser.mockClear();
    functionsInvoke.mockReset();
  });

  it("submitEmail for NEW email → routes to details, does NOT request OTP", async () => {
    mockIdentify({ exists: false, hasPassword: false, profile_name: null });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("NEW@Example.com"); });
    expect(functionsInvoke).toHaveBeenCalledTimes(1);
    expect(functionsInvoke).toHaveBeenCalledWith("auth-check-email", {
      body: { email: "new@example.com" },
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(result.current.step).toBe("details");
    expect(result.current.email).toBe("new@example.com");
  });

  it("submitEmail for EXISTING profile → requests OTP directly, lands on sent", async () => {
    mockIdentify({ exists: true, hasPassword: true, profile_name: "И П" });
    mockRequestOtp({ data: { ok: true } });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    expect(signInWithOtp).not.toHaveBeenCalled();
    const otpCall = functionsInvoke.mock.calls[1];
    expect(otpCall[0]).toBe("request-inline-otp");
    expect(otpCall[1].body.email).toBe("a@b.com");
    expect(otpCall[1].body.purpose).toBe("auth");
    expect(otpCall[1].body.meta).toBeUndefined();
    expect(result.current.step).toBe("sent");
    expect(result.current.resendIn).toBeGreaterThan(0);
  });

  it("submitDetails sends meta payload to request-inline-otp; step→sent", async () => {
    mockIdentify({ exists: false, profile_name: null });
    mockRequestOtp({ data: { ok: true } });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("new@x.com"); });
    expect(functionsInvoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.submitDetails({ firstName: "И", lastName: "П", phone: "+375" });
    });
    const otpCall = functionsInvoke.mock.calls[1];
    expect(otpCall[0]).toBe("request-inline-otp");
    expect(otpCall[1].body.meta).toMatchObject({
      firstName: "И", lastName: "П", fullName: "И П", phone: "+375",
    });
    expect(result.current.step).toBe("sent");
  });

  it("request-inline-otp rate_limited keeps step and shows message", async () => {
    mockIdentify({ exists: true, profile_name: "X" });
    mockRequestOtp({ data: { error: "rate_limited", retry_after_s: 42 } });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    expect(result.current.step).toBe("email");
    expect(result.current.error).toMatch(/попроб|подожд/i);
  });

  it("verifyCode: exchanges token_hash for session and lands authenticated", async () => {
    mockIdentify({ exists: true, profile_name: "X" });
    mockRequestOtp();
    mockVerifyOtpFn({ data: { ok: true, token_hash: "th_abc", user_id: "u1" } });
    verifyOtp.mockResolvedValueOnce({
      data: { session: { access_token: "x" }, user: { id: "u1" } }, error: null,
    });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    let ok: any;
    await act(async () => { ok = await result.current.verifyCode("123456"); });
    expect(functionsInvoke.mock.calls[2][0]).toBe("verify-inline-otp");
    expect(functionsInvoke.mock.calls[2][1].body).toEqual({ email: "a@b.com", code: "123456" });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "th_abc", type: "magiclink" });
    expect(ok).toEqual({ userId: "u1" });
    expect(result.current.step).toBe("authenticated");
  });

  it("verifyCode invalid_code increments invalidAttempts and never logs the code", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    mockIdentify({ exists: true, profile_name: "X" });
    mockRequestOtp();
    mockVerifyOtpFn({ data: { error: "invalid_code", attempts_left: 4 } });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    await act(async () => { await result.current.verifyCode("111111"); });
    expect(result.current.invalidAttempts).toBe(1);
    for (const call of consoleErr.mock.calls) {
      for (const arg of call) {
        expect(JSON.stringify(arg ?? "")).not.toContain("111111");
      }
    }
    consoleErr.mockRestore();
  });

  it("force-resend hint after 5 invalid attempts", async () => {
    mockIdentify({ exists: true, profile_name: "X" });
    mockRequestOtp();
    for (let i = 0; i < 5; i++) mockVerifyOtpFn({ data: { error: "invalid_code" } });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    for (let i = 0; i < 5; i++) {
      await act(async () => { await result.current.verifyCode("000000"); });
    }
    expect(result.current.error).toMatch(/новый код/i);
  });

  it("resend is blocked until cooldown expires", async () => {
    mockIdentify({ exists: true, profile_name: "X" });
    mockRequestOtp();
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    const callsBefore = functionsInvoke.mock.calls.length;
    let ok: any;
    await act(async () => { ok = await result.current.resend(); });
    expect(ok).toBe(false);
    expect(functionsInvoke.mock.calls.length).toBe(callsBefore); // no extra call
  });

  it("changeEmail resets state to email step", async () => {
    mockIdentify({ exists: true, profile_name: "X" });
    mockRequestOtp();
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    act(() => { result.current.changeEmail(); });
    await waitFor(() => expect(result.current.step).toBe("email"));
    expect(result.current.resendIn).toBe(0);
  });

  it("empty/malformed code returns null and does not call verify function", async () => {
    mockIdentify({ exists: true, profile_name: "X" });
    mockRequestOtp();
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    const callsBefore = functionsInvoke.mock.calls.length;
    let ok: any;
    await act(async () => { ok = await result.current.verifyCode("12"); });
    expect(ok).toBeNull();
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(functionsInvoke.mock.calls.length).toBe(callsBefore);
  });
});
