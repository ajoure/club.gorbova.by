/**
 * Unit tests for useInlineEmailOtp (PATCH-INLINE-AUTH-EMAIL-OTP-FLOW Phase 2).
 *
 * Contract under test:
 *   1. sendCode → signInWithOtp WITHOUT emailRedirectTo, shouldCreateUser=true.
 *   2. verifyCode → verifyOtp({ type: 'email' }) on staging-proven contract.
 *   3. No `token` / `code` value appears in console.* calls (secrets safety).
 *   4. Invalid attempts counter increments; force-resend hint after 5.
 *   5. resend respects 60s cooldown from previous sendCode.
 *   6. changeEmail resets state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
const updateUser = vi.fn().mockResolvedValue({ data: {}, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { signInWithOtp: (...args: any[]) => signInWithOtp(...args),
             verifyOtp: (...args: any[]) => verifyOtp(...args),
             updateUser: (...args: any[]) => updateUser(...args) },
  },
}));

import { useInlineEmailOtp } from "./useInlineEmailOtp";

describe("useInlineEmailOtp", () => {
  beforeEach(() => {
    signInWithOtp.mockReset();
    verifyOtp.mockReset();
    updateUser.mockClear();
  });

  it("sendCode calls signInWithOtp WITHOUT emailRedirectTo", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.sendCode("USER@Example.com"); });
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    const call = signInWithOtp.mock.calls[0][0];
    expect(call.email).toBe("user@example.com");
    expect(call.options.shouldCreateUser).toBe(true);
    expect(call.options).not.toHaveProperty("emailRedirectTo");
    expect(result.current.step).toBe("sent");
    expect(result.current.resendIn).toBeGreaterThan(0);
  });

  it("sendCode passes signup metadata into options.data", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => {
      await result.current.sendCode("a@b.com", { firstName: "И", lastName: "П", phone: "+375" });
    });
    const opts = signInWithOtp.mock.calls[0][0].options;
    expect(opts.data).toMatchObject({ full_name: "И П", first_name: "И", last_name: "П", phone: "+375" });
  });

  it("verifyCode uses type='email' and lands authenticated", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: null });
    verifyOtp.mockResolvedValueOnce({
      data: { session: { access_token: "x" }, user: { id: "u1" } }, error: null,
    });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.sendCode("a@b.com"); });
    let ok: any;
    await act(async () => { ok = await result.current.verifyCode("123456"); });
    expect(verifyOtp).toHaveBeenCalledWith({ email: "a@b.com", token: "123456", type: "email" });
    expect(ok).toEqual({ userId: "u1" });
    expect(result.current.step).toBe("authenticated");
  });

  it("verifyCode increments invalidAttempts on failure and never logs the code", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    signInWithOtp.mockResolvedValueOnce({ error: null });
    verifyOtp.mockResolvedValue({ data: {}, error: { message: "Token has invalid" } });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.sendCode("a@b.com"); });
    await act(async () => { await result.current.verifyCode("111111"); });
    expect(result.current.invalidAttempts).toBe(1);
    // No console.* invocation may contain the OTP value.
    for (const call of consoleErr.mock.calls) {
      for (const arg of call) {
        expect(JSON.stringify(arg ?? "")).not.toContain("111111");
      }
    }
    consoleErr.mockRestore();
  });

  it("force-resend hint after 5 invalid attempts", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: null });
    verifyOtp.mockResolvedValue({ data: {}, error: { message: "invalid token" } });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.sendCode("a@b.com"); });
    for (let i = 0; i < 5; i++) {
      await act(async () => { await result.current.verifyCode("000000"); });
    }
    expect(result.current.error).toMatch(/новый код/i);
  });

  it("resend is blocked until cooldown expires", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.sendCode("a@b.com"); });
    signInWithOtp.mockClear();
    let ok: any;
    await act(async () => { ok = await result.current.resend(); });
    expect(ok).toBe(false);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("changeEmail resets state to email step", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.sendCode("a@b.com"); });
    act(() => { result.current.changeEmail(); });
    await waitFor(() => expect(result.current.step).toBe("email"));
    expect(result.current.resendIn).toBe(0);
  });

  it("empty/malformed code returns null and does not call verifyOtp", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useInlineEmailOtp());
    await act(async () => { await result.current.sendCode("a@b.com"); });
    let ok: any;
    await act(async () => { ok = await result.current.verifyCode("12"); });
    expect(ok).toBeNull();
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
