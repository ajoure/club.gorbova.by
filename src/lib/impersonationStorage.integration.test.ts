import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { authFixture, installLocks, OPERATOR, SESSION_B, session, TARGET } from "@/test/adminReturn/fixture";
import { saveVerifiedAdminBackup, startBoundImpersonation, verifiedSessionBinding } from "./adminReturn";
import { clearOwnedImpersonation, getImpersonationRecord, getReturnFence, IMPERSONATION_TTL,
  normalizeAdminReturnUrl, type ImpersonationRecord, validRecord, withAuthLease, writeFence, writeRecord } from "./impersonationStorage";

beforeEach(() => { localStorage.clear(); installLocks(); vi.stubGlobal("BroadcastChannel", undefined); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("Admin return actual storage and verified writer integration", () => {
  it("T7 the backward-compatible writer fails closed without target; bound capture uses server-verified operator", async () => {
    const f = authFixture(); const operator = f.register(session(OPERATOR, SESSION_B)); await f.client.auth.setSession(operator); f.calls.length = 0;
    await expect(saveVerifiedAdminBackup(f.client.auth, "/admin/contacts")).rejects.toThrow("IMPERSONATION_BINDING_REQUIRED");
    expect(f.calls).toHaveLength(0); expect(getImpersonationRecord()).toBeNull();
    const captured = await saveVerifiedAdminBackup(f.client.auth, "/admin/contacts", TARGET);
    expect(captured.expectedOperatorId).toBe(OPERATOR); expect(captured.targetUserId).toBe(TARGET);
    expect(captured.temporaryBinding).toBeNull(); expect(validRecord(captured)).toBe(false);
    expect(f.calls.some(c => c.path.endsWith("user") && c.actor === OPERATOR)).toBe(true);
  });
  it("T7 the ContactDetailSheet writer path binds actual OTP target and original timestamp under one lease", async () => {
    const f = authFixture(); await f.client.auth.setSession(f.register(session(OPERATOR, SESSION_B)));
    let originalTime = 0;
    await startBoundImpersonation(f.client.auth, TARGET, "/admin/contacts?tab=support", async () => {
      originalTime = getImpersonationRecord()!.startedAt;
      // No second writer may replace the captured backup while this start owns the origin lock.
      await expect(saveVerifiedAdminBackup(f.client.auth, "/admin", TARGET)).rejects.toThrow("RETURN_BUSY");
      return { tokenHash: "synthetic-otp-hash" };
    });
    const record = getImpersonationRecord()!;
    expect(record.expectedOperatorId).toBe(OPERATOR); expect(record.targetUserId).toBe(TARGET);
    expect(record.startedAt).toBe(originalTime); expect(validRecord(record)).toBe(true);
    expect(record.temporaryBinding).toBe(await verifiedSessionBinding(f.client.auth, (await f.client.auth.getSession()).data.session!, TARGET));
    expect(getReturnFence()).toBeNull();
  });
  it("T7/T10 unsupported Web Locks never starts an auth operation or writes an invented backup", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    const f = authFixture();
    await expect(startBoundImpersonation(f.client.auth, TARGET, "/admin", async () => ({ tokenHash: "synthetic" }))).rejects.toThrow("RETURN_LOCK_UNAVAILABLE");
    expect(f.calls).toHaveLength(0); expect(getImpersonationRecord()).toBeNull();
  });
  it("T7 original TTL is strict, finite and never extended by read/remount", async () => {
    const f = authFixture(); await f.client.auth.setSession(f.register(session(OPERATOR, SESSION_B)));
    await startBoundImpersonation(f.client.auth, TARGET, "/admin/contacts", async () => ({ tokenHash: "synthetic" }));
    const r = getImpersonationRecord()!;
    expect(validRecord(r, r.startedAt + IMPERSONATION_TTL - 1)).toBe(true);
    expect(validRecord(r, r.startedAt + IMPERSONATION_TTL)).toBe(false);
    expect(validRecord(r, r.startedAt - 1)).toBe(false);
    for (const startedAt of [NaN, Infinity, "123partial", undefined, 0]) {
      expect(validRecord({ ...r, startedAt } as ImpersonationRecord)).toBe(false);
    }
    expect(getImpersonationRecord()?.startedAt).toBe(r.startedAt);
  });
  it("T3 an actual SDK OTP response with error:null/session:null/user:null cannot establish impersonation binding", async () => {
    const f = authFixture(); await f.client.auth.setSession(f.register(session(OPERATOR, SESSION_B)));
    f.options.otpNoSession = true;
    const actual = await f.client.auth.verifyOtp({ token_hash: "synthetic-confirmation", type: "magiclink" });
    expect(actual.error).toBeNull(); expect(actual.data.session).toBeNull(); expect(actual.data.user).toBeNull();
    await expect(startBoundImpersonation(f.client.auth, TARGET, "/admin/contacts", async () => ({ tokenHash: "synthetic-confirmation" }))).rejects.toThrow("IMPERSONATION_START_FAILED");
    expect(getImpersonationRecord()?.temporaryBinding).toBeNull(); expect(getReturnFence()?.phase).toBe("recovery");
  });
  it("T5 operation replacement cannot be cleared by an old owner or expired lease", async () => {
    const f = authFixture(); await f.client.auth.setSession(f.register(session(OPERATOR, SESSION_B)));
    const old = await saveVerifiedAdminBackup(f.client.auth, "/admin", TARGET);
    let expiredLease: Parameters<typeof writeRecord>[1] | undefined;
    await withAuthLease(async lease => {
      expiredLease = lease;
      writeRecord({ ...old, operationId: "new-operation" }, lease);
      writeFence({ operationId: "new-operation", phase: "recovery", deadline: 1 }, lease);
      expect(() => clearOwnedImpersonation(old.operationId, lease)).toThrow("RETURN_OWNER_CHANGED");
    });
    expect(() => writeRecord(old, expiredLease!)).toThrow("RETURN_LOCK_REQUIRED");
    expect(getImpersonationRecord()?.operationId).toBe("new-operation");
  });
  it.each(["https://example.invalid/admin", "//example.invalid/admin", "/\\example.invalid", "/\u0000admin", "javascript:alert(1)"])("T6 rejects nonlocal or ambiguous return URL %j", input => {
    expect(normalizeAdminReturnUrl(input)).toBe("/dashboard");
  });
});
