/**
 * Unit tests for useInlineEmailOtp (PATCH-INLINE-OTP-FIX-BROKEN-FLOW).
 *
 * Contract:
 *   - submitEmail → identify via auth-check-email:
 *       * existing + hasProfile → signInWithOtp immediately → step "sent"
 *       * else → step "details" (no OTP yet)
 *   - submitDetails(meta) → signInWithOtp with data payload → step "sent"
 *   - signInWithOtp is NEVER called before the user submits either email
 *     (for existing profile) or details (for new).
 *   - verifyOtp uses type='email'.
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

describe("useInlineEmailOtp", () => {
  beforeEach(() => {
    signInWithOtp.mockReset();
    verifyOtp.mockReset();
    updateUser.mockClear();
    functionsInvoke.mockReset();
  });

  it("submitEmail for NEW email → routes to details, does NOT call signInWithOtp", async () => {
    functionsInvoke.mockResolvedValueOnce({
      data: { exists: false, hasPassword: false, profile_name: null },
      error: null,
    });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("NEW@Example.com"); });
    expect(functionsInvoke).toHaveBeenCalledWith("auth-check-email", {
      body: { email: "new@example.com" },
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(result.current.step).toBe("details");
    expect(result.current.email).toBe("new@example.com");
  });

  it("submitEmail for EXISTING profile → sends OTP directly, lands on sent", async () => {
    functionsInvoke.mockResolvedValueOnce({
      data: { exists: true, hasPassword: true, profile_name: "И П" },
      error: null,
    });
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    const call = signInWithOtp.mock.calls[0][0];
    expect(call.email).toBe("a@b.com");
    expect(call.options.shouldCreateUser).toBe(true);
    expect(call.options).not.toHaveProperty("emailRedirectTo");
    // Existing user path: no meta payload.
    expect(call.options).not.toHaveProperty("data");
    expect(result.current.step).toBe("sent");
    expect(result.current.resendIn).toBeGreaterThan(0);
  });

  it("submitDetails calls signInWithOtp with data payload; step→sent", async () => {
    functionsInvoke.mockResolvedValueOnce({
      data: { exists: false, profile_name: null }, error: null,
    });
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("new@x.com"); });
    expect(signInWithOtp).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.submitDetails({ firstName: "И", lastName: "П", phone: "+375" });
    });
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    const opts = signInWithOtp.mock.calls[0][0].options;
    expect(opts.data).toMatchObject({
      full_name: "И П", first_name: "И", last_name: "П", phone: "+375",
    });
    expect(result.current.step).toBe("sent");
  });

  it("sendOtp error keeps step and shows message; NEVER advances to sent", async () => {
    functionsInvoke.mockResolvedValueOnce({
      data: { exists: true, profile_name: "X" }, error: null,
    });
    signInWithOtp.mockResolvedValueOnce({ error: { message: "Email rate limit exceeded" } });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    expect(result.current.step).toBe("email");
    expect(result.current.error).toMatch(/подожд/i);
  });

  it("verifyCode uses type='email' and lands authenticated", async () => {
    functionsInvoke.mockResolvedValueOnce({
      data: { exists: true, profile_name: "X" }, error: null,
    });
    signInWithOtp.mockResolvedValueOnce({ error: null });
    verifyOtp.mockResolvedValueOnce({
      data: { session: { access_token: "x" }, user: { id: "u1" } }, error: null,
    });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    let ok: any;
    await act(async () => { ok = await result.current.verifyCode("123456"); });
    expect(verifyOtp).toHaveBeenCalledWith({ email: "a@b.com", token: "123456", type: "email" });
    expect(ok).toEqual({ userId: "u1" });
    expect(result.current.step).toBe("authenticated");
  });

  it("verifyCode increments invalidAttempts and never logs the code", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    functionsInvoke.mockResolvedValueOnce({
      data: { exists: true, profile_name: "X" }, error: null,
    });
    signInWithOtp.mockResolvedValueOnce({ error: null });
    verifyOtp.mockResolvedValue({ data: {}, error: { message: "Token has invalid" } });
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
    functionsInvoke.mockResolvedValueOnce({
      data: { exists: true, profile_name: "X" }, error: null,
    });
    signInWithOtp.mockResolvedValueOnce({ error: null });
    verifyOtp.mockResolvedValue({ data: {}, error: { message: "invalid token" } });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    for (let i = 0; i < 5; i++) {
      await act(async () => { await result.current.verifyCode("000000"); });
    }
    expect(result.current.error).toMatch(/новый код/i);
  });

  it("resend is blocked until cooldown expires", async () => {
    functionsInvoke.mockResolvedValueOnce({
      data: { exists: true, profile_name: "X" }, error: null,
    });
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    signInWithOtp.mockClear();
    let ok: any;
    await act(async () => { ok = await result.current.resend(); });
    expect(ok).toBe(false);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("changeEmail resets state to email step", async () => {
    functionsInvoke.mockResolvedValueOnce({
      data: { exists: true, profile_name: "X" }, error: null,
    });
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    act(() => { result.current.changeEmail(); });
    await waitFor(() => expect(result.current.step).toBe("email"));
    expect(result.current.resendIn).toBe(0);
  });

  it("empty/malformed code returns null and does not call verifyOtp", async () => {
    functionsInvoke.mockResolvedValueOnce({
      data: { exists: true, profile_name: "X" }, error: null,
    });
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.submitEmail("a@b.com"); });
    let ok: any;
    await act(async () => { ok = await result.current.verifyCode("12"); });
    expect(ok).toBeNull();
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
