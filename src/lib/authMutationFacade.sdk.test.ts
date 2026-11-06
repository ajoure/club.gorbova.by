import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authFixture, deferred, installLocks, OPERATOR, SESSION_B, session, TARGET } from "@/test/adminReturn/fixture";
import { createAuthMutationFacade } from "./authMutationFacade";
import { AdminReturnController, verifiedSessionBinding } from "./adminReturn";
import { getImpersonationRecord, getReturnFence, type AuthLease, type ImpersonationRecord,
  withAuthLease, writeFence, writeRecord } from "./impersonationStorage";

beforeEach(() => { localStorage.clear(); installLocks(); vi.stubGlobal("BroadcastChannel", undefined); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function setup() {
  const f = authFixture(); const target = f.register(session(TARGET)); const operator = f.register(session(OPERATOR, SESSION_B));
  expect((await f.client.auth.setSession(target)).error).toBeNull();
  const record: ImpersonationRecord = { version: 2, operationId: crypto.randomUUID(), startedAt: Date.now(), targetUserId: TARGET,
    expectedOperatorId: OPERATOR, temporaryBinding: await verifiedSessionBinding(f.client.auth, target, TARGET), returnUrl: "/admin/contacts", backup: operator };
  await withAuthLease(async lease => writeRecord(record, lease)); f.calls.length = 0;
  const navigate = vi.fn(); const notice = vi.fn();
  const controller = new AdminReturnController({ auth: f.client.auth, getSessionSnapshot: f.getSessionSnapshot, navigate, notice,
    waitForActor: async id => { expect(f.getSessionSnapshot()?.user.id).toBe(id); }, freshAccess: async () => ({ allowed: true, fallback: "/dashboard" }) });
  return { f, target, operator, record, controller, navigate, notice, facade: createAuthMutationFacade(f.client.auth) };
}
describe("D+C explicit facade with actual pinned SDK", () => {
  it("T5 an app login already in flight BEFORE the fence holds the origin lease through actual settle", async () => {
    const s = await setup(); const gate = deferred<void>(); s.f.options.passwordWait = gate.promise;
    const login = s.facade.signInWithPassword({ email: "operator@example.invalid", password: "synthetic-only" });
    await vi.waitFor(() => expect(s.f.calls.some(c => c.path.endsWith("token"))).toBe(true));
    await s.controller.returnToAdmin(); await s.controller.prepareManualLogin();
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toHaveLength(0); expect(s.navigate).not.toHaveBeenCalled();
    gate.resolve(); expect((await login).error).toBeNull();
    expect(s.f.getSessionSnapshot()?.user.id).toBe(OPERATOR);
    expect(s.controller.getSnapshot().phase).toBe("recovery");
  });
  it("T5 ordinary concurrent ingress outside any fence is explicitly busy rather than dispatched in parallel", async () => {
    const f = authFixture(); const facade = createAuthMutationFacade(f.client.auth);
    const gate = deferred<void>(); f.options.passwordWait = gate.promise;
    const first = facade.signInWithPassword({ email: "operator@example.invalid", password: "synthetic-only" });
    await vi.waitFor(() => expect(f.calls.some(c => c.path.endsWith("token"))).toBe(true));
    expect(getReturnFence()).toBeNull();
    await expect(facade.verifyOtp({ token_hash: "synthetic-already-obtained", type: "magiclink" })).rejects.toThrow("RETURN_BUSY");
    expect(f.calls.filter(c => c.path.endsWith("verify"))).toHaveLength(0);
    gate.resolve(); expect((await first).data.user?.id).toBe(OPERATOR);
  });
  it("T5/T11 old unwrapped SDK negative control cannot change the exact revoke target or produce a false return", async () => {
    const s = await setup(); const loginGate = deferred<void>(); const revokeGate = deferred<void>();
    s.f.options.passwordWait = loginGate.promise; s.f.options.logoutWait = revokeGate.promise;
    // Deliberately bypass the new facade to represent an already-open old document.
    const rawLogin = s.f.client.auth.signInWithPassword({ email: "operator@example.invalid", password: "synthetic-only" });
    await vi.waitFor(() => expect(s.f.calls.some(c => c.path.endsWith("token"))).toBe(true));
    const returning = s.controller.returnToAdmin();
    await vi.waitFor(() => expect(s.f.calls.some(c => c.path.endsWith("logout"))).toBe(true));
    loginGate.resolve(); expect((await rawLogin).data.user?.id).toBe(OPERATOR);
    revokeGate.resolve(); await returning;
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toEqual([expect.objectContaining({ actor: TARGET, scope: "local" })]);
    expect(s.f.getSessionSnapshot()?.user.id).toBe(OPERATOR);
    expect(s.navigate).not.toHaveBeenCalled(); expect(s.notice).not.toHaveBeenCalled();
    expect(getReturnFence()?.phase).toBe("recovery"); expect(getImpersonationRecord()).not.toBeNull();
    expect(s.f.calls.filter(c => c.path.endsWith("user") && c.actor === OPERATOR)).toHaveLength(0);
  });
  it("T5 active lease identity permits nested owned calls without ambient bypass or deadlock", async () => {
    const s = await setup();
    await withAuthLease(async lease => {
      await expect(s.facade.signInWithPassword({ email: "operator@example.invalid", password: "synthetic-only" })).rejects.toThrow("RETURN_BUSY");
      const actual = await s.facade.signInWithPassword({ email: "operator@example.invalid", password: "synthetic-only" }, lease);
      expect(actual.data.user?.id).toBe(OPERATOR);
    });
    expect(s.f.calls.filter(c => c.path.endsWith("token"))).toHaveLength(1);
  });
  it("T5 a forged lease object cannot dispatch any SDK mutation", async () => {
    const s = await setup(); const before = s.f.calls.length;
    expect(() => s.facade.signInWithPassword({ email: "operator@example.invalid", password: "synthetic-only" }, {} as AuthLease)).toThrow("RETURN_LOCK_REQUIRED");
    expect(s.f.calls).toHaveLength(before);
  });
  it("T5/T11 abandoning an application wait cannot release a live SDK mutation; leases are revoked finally", async () => {
    const s = await setup(); const gate = deferred<void>(); s.f.options.passwordWait = gate.promise;
    let owned: AuthLease | undefined; let done = false;
    const running = withAuthLease(async lease => {
      owned = lease;
      void s.facade.signInWithPassword({ email: "operator@example.invalid", password: "synthetic-only" }, lease);
      // Even a buggy caller returning without awaiting the SDK cannot drop the origin lock.
    }).then(() => { done = true; });
    await vi.waitFor(() => expect(s.f.calls.some(c => c.path.endsWith("token"))).toBe(true));
    expect(done).toBe(false); await expect(withAuthLease(async () => {})).rejects.toThrow("RETURN_BUSY");
    gate.resolve(); await running;
    expect(() => s.facade.signInWithPassword({ email: "operator@example.invalid", password: "synthetic-only" }, owned!)).toThrow("RETURN_LOCK_REQUIRED");
    expect(s.f.calls.filter(c => c.path.endsWith("token"))).toHaveLength(1);
  });
  it("T7 expired captured candidate is rejected without shared-client refresh rescue, revoke or restore", async () => {
    const s = await setup(); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 3_601_000);
    await withAuthLease(async lease => writeRecord({ ...s.record, startedAt: Date.now() }, lease));
    s.f.calls.length = 0; await s.controller.returnToAdmin();
    expect(s.f.calls).toHaveLength(0); expect(s.navigate).not.toHaveBeenCalled(); expect(s.controller.getSnapshot().phase).toBe("recovery");
  });
  it("T10 no-Web-Locks browsers retain ordinary login outside any fence, but cannot overlap a persistent fence", async () => {
    const f = authFixture(); Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    const facade = createAuthMutationFacade(f.client.auth);
    expect((await facade.signInWithPassword({ email: "operator@example.invalid", password: "synthetic-only" })).data.user?.id).toBe(OPERATOR);
    installLocks(); await withAuthLease(async lease => writeFence({ operationId: "synthetic-pending", phase: "pending", deadline: Date.now() + 1000 }, lease));
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    const count = f.calls.length;
    await expect(facade.signInWithPassword({ email: "operator@example.invalid", password: "synthetic-only" })).rejects.toThrow("RETURN_LOCK_UNAVAILABLE");
    expect(f.calls).toHaveLength(count);
  });
  it.each([401, 403, 404, 500])("T8 public explicit-JWT API preserves status %s rather than client signOut swallowing it", async status => {
    const s = await setup(); s.f.options.logoutStatus = status;
    const result = await withAuthLease(lease => s.facade.revokeCaptured(s.target.access_token, lease));
    expect(result.error?.status).toBe(status);
    expect(s.f.getSessionSnapshot()?.user.id).toBe(TARGET);
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toEqual([expect.objectContaining({ actor: TARGET, scope: "local" })]);
  });
});
