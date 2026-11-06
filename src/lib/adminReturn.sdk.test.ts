import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authFixture, deferred, installLocks, OPERATOR, SESSION_A, SESSION_B, session, TARGET } from "@/test/adminReturn/fixture";
import { AdminReturnController, verifiedSessionBinding } from "./adminReturn";
import { getImpersonationRecord, getReturnFence, IMPERSONATION_KEYS, type ImpersonationRecord, withAuthLease, writeRecord } from "./impersonationStorage";

beforeEach(() => { localStorage.clear(); installLocks(); vi.stubGlobal("BroadcastChannel", undefined); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function setup() {
  const f = authFixture();
  const temporary = f.register(session(TARGET)); const operator = f.register(session(OPERATOR, SESSION_B));
  const initialized = await f.client.auth.setSession(temporary);
  expect(initialized.error).toBeNull(); expect(initialized.data.session?.user.id).toBe(TARGET);
  const record: ImpersonationRecord = { version: 2, operationId: crypto.randomUUID(), startedAt: Date.now(), targetUserId: TARGET,
    expectedOperatorId: OPERATOR, temporaryBinding: await verifiedSessionBinding(f.client.auth, temporary, TARGET),
    returnUrl: "/admin/contacts", backup: operator };
  await withAuthLease(async lease => writeRecord(record, lease));
  f.calls.length = 0;
  const navigate = vi.fn(); const notice = vi.fn();
  const controller = new AdminReturnController({ auth: f.client.auth, getSessionSnapshot: f.getSessionSnapshot, navigate, notice,
    waitForActor: async id => { expect((await f.client.auth.getSession()).data.session?.user.id).toBe(id); },
    freshAccess: async () => ({ allowed: true, fallback: "/dashboard" }),
  });
  return { f, record, controller, navigate, notice, temporary, operator };
}
describe("Admin return actual pinned SDK and real return controller", () => {
  it("T1 characterizes the current default global logout and actual SDK event", async () => {
    const f = authFixture(); await f.client.auth.setSession(f.register(session(TARGET)));
    const events: string[] = []; const subscription = f.client.auth.onAuthStateChange(event => { events.push(event); });
    await f.client.auth.signOut();
    expect(f.calls.filter(c => c.path.endsWith("logout"))).toEqual([expect.objectContaining({ scope: "global", actor: TARGET })]);
    expect(events).toContain("SIGNED_OUT"); subscription.data.subscription.unsubscribe();
  });
  it("T2 uses one local logout then verified restore and retains backup until access completes", async () => {
    const s = await setup(); const gate = deferred<{ allowed: boolean; fallback: string }>();
    const events: string[] = []; s.f.client.auth.onAuthStateChange(event => { events.push(event); });
    const controller = new AdminReturnController({ auth: s.f.client.auth, getSessionSnapshot: s.f.getSessionSnapshot, navigate: s.navigate, notice: s.notice,
      waitForActor: async () => {}, freshAccess: () => gate.promise });
    const run = controller.returnToAdmin();
    await vi.waitFor(() => expect(events).toContain("SIGNED_IN"));
    expect(getImpersonationRecord()?.operationId).toBe(s.record.operationId); expect(s.navigate).not.toHaveBeenCalled();
    gate.resolve({ allowed: true, fallback: "/dashboard" }); await run;
    expect(events.filter(e => e === "SIGNED_OUT")).toHaveLength(0);
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toEqual([expect.objectContaining({ scope: "local", actor: TARGET })]);
    expect(s.navigate).toHaveBeenCalledWith("/admin/contacts"); expect(getImpersonationRecord()).toBeNull();
  });
  it("T3 follows real expired backup refresh and rotation once", async () => {
    const s = await setup(); const expired = session(OPERATOR, SESSION_B, true, "old");
    const rotated = s.f.register(session(OPERATOR, SESSION_B, false, "rotated"));
    s.f.refresh.set(expired.refresh_token, rotated);
    await withAuthLease(async lease => writeRecord({ ...s.record, backup: expired }, lease));
    await s.controller.returnToAdmin();
    expect(s.f.calls.filter(c => c.path.endsWith("token"))).toHaveLength(1);
    expect((await s.f.client.auth.getSession()).data.session?.refresh_token).toBe(rotated.refresh_token);
    expect(s.navigate).toHaveBeenCalledOnce();
  });
  it("T3 rejects invalid backup refresh without a second logout or false success", async () => {
    const s = await setup(); s.f.options.refreshError = true;
    await withAuthLease(async lease => writeRecord({ ...s.record, backup: session(OPERATOR, SESSION_B, true) }, lease));
    await s.controller.returnToAdmin();
    expect(s.navigate).not.toHaveBeenCalled(); expect(getReturnFence()?.phase).toBe("recovery");
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toHaveLength(1);
  });
  it("T3 actual SDK error:null is insufficient when an HTTP200 restore user body has no verified identity", async () => {
    const s = await setup(); s.f.options.operatorUserMissing = true;
    await s.controller.returnToAdmin();
    expect(s.navigate).not.toHaveBeenCalled(); expect(s.notice).not.toHaveBeenCalled();
    expect(getReturnFence()?.phase).toBe("recovery"); expect(getImpersonationRecord()).not.toBeNull();
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toHaveLength(1);
  });
  it("T5/T7 accepts rotation of the SAME server-verified temporary session, rejects another session of same user", async () => {
    const s = await setup();
    await s.f.client.auth.setSession(s.f.register(session(TARGET, SESSION_A, false, "rotated")));
    await s.controller.returnToAdmin(); expect(s.navigate).toHaveBeenCalledOnce();
    localStorage.clear(); const other = await setup();
    await other.f.client.auth.setSession(other.f.register(session(TARGET, SESSION_B)));
    await other.controller.returnToAdmin();
    expect(other.f.calls.filter(c => c.path.endsWith("logout"))).toHaveLength(0); expect(other.navigate).not.toHaveBeenCalled();
  });
  it("T5 serializes two controllers/tabs and immediate double click through the actual operation lock", async () => {
    const s = await setup(); const wait = deferred<void>(); s.f.options.logoutWait = wait.promise;
    const first = s.controller.returnToAdmin(); const again = s.controller.returnToAdmin();
    await vi.waitFor(() => expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toHaveLength(1));
    const other = new AdminReturnController({ auth: s.f.client.auth, getSessionSnapshot: s.f.getSessionSnapshot, navigate: vi.fn(), notice: vi.fn(), waitForActor: async () => {}, freshAccess: async () => ({ allowed: true, fallback: "/dashboard" }) });
    await other.returnToAdmin(); await other.prepareManualLogin();
    expect(other.getSnapshot().phase).toBe("recovery");
    wait.resolve(); await first; await again;
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toHaveLength(1);
  });
  it.each([204, 401, 403, 404, 500])("T8 observes public captured-JWT status %s without client swallowing or fictitious local cleanup", async status => {
    const s = await setup(); s.f.options.logoutStatus = status;
    await s.controller.returnToAdmin();
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toEqual([expect.objectContaining({ scope: "local" })]);
    expect((await s.f.client.auth.getSession()).data.session?.user.id).toBe(status === 204 ? OPERATOR : TARGET);
    expect(s.navigate).toHaveBeenCalledTimes(status === 204 ? 1 : 0);
  });
  it("T9/T11 keeps actual late SDK storage writes fenced; a new document cannot unlock another tab", async () => {
    const s = await setup(); const late = deferred<void>(); s.f.options.userWait = late.promise;
    s.f.options.userWaitActor = OPERATOR;
    // Block the actual restore /user request: _setSession will still SAVE and emit SIGNED_IN after the deadline.
    vi.useFakeTimers(); const run = s.controller.returnToAdmin();
    await vi.waitFor(() => expect(s.f.calls.some(c => c.path.endsWith("user") && c.actor === OPERATOR)).toBe(true));
    await vi.advanceTimersByTimeAsync(20_001);
    expect(s.controller.getSnapshot().phase).toBe("recovery"); expect(s.controller.getSnapshot().inFlight).toBe(true);
    const fresh = new AdminReturnController({ auth: s.f.client.auth, getSessionSnapshot: s.f.getSessionSnapshot, navigate: vi.fn(), notice: vi.fn(), waitForActor: async () => {}, freshAccess: async () => ({ allowed: true, fallback: "/dashboard" }) });
    await fresh.prepareManualLogin(); expect(getReturnFence()?.phase).toBe("recovery");
    late.resolve(); await run;
    expect((await s.f.client.auth.getSession()).data.session?.user.id).toBe(OPERATOR);
    expect(s.navigate).not.toHaveBeenCalled(); expect(getImpersonationRecord()).not.toBeNull();
    await fresh.prepareManualLogin(); expect(getReturnFence()?.phase).toBe("manual");
  });
  it("T11 actual public auto-refresh tick discards its late target result after operator restore", async () => {
    const s = await setup();
    const soon = s.f.register(session(TARGET, SESSION_A, false, "soon", 60));
    expect((await s.f.client.auth.setSession(soon)).error).toBeNull();
    const rotated = s.f.register(session(TARGET, SESSION_A, false, "late-auto"));
    s.f.refresh.set(soon.refresh_token, rotated);
    const gate = deferred<void>(); s.f.options.refreshWait = gate.promise;
    try {
      await s.f.client.auth.startAutoRefresh();
      await vi.waitFor(() => expect(s.f.calls.some(c => c.path.endsWith("token"))).toBe(true));
      expect(s.f.sdkTraceMarkers).toContain("AUTO_REFRESH_TICK");
      await s.controller.returnToAdmin(); expect(s.navigate).toHaveBeenCalledOnce();
      gate.resolve();
      await vi.waitFor(() => expect(s.f.sdkTraceMarkers).toContain("DISCARDED_CHANGED_STORAGE"));
      expect((await s.f.client.auth.getSession()).data.session?.user.id).toBe(OPERATOR);
      expect(s.f.getSessionSnapshot()?.user.id).toBe(OPERATOR);
    } finally { gate.resolve(); await s.f.client.auth.stopAutoRefresh(); }
  });
  it("T11 another actual SDK constructor recovery cannot overwrite restored operator with a late refresh", async () => {
    const s = await setup();
    const soon = s.f.register(session(TARGET, SESSION_A, false, "init-soon", 60));
    expect((await s.f.client.auth.setSession(soon)).error).toBeNull();
    const gate = deferred<void>();
    const peer = authFixture(undefined, { store: s.f.store, storageKey: s.f.storageKey }, true);
    peer.options.refreshWait = gate.promise;
    peer.refresh.set(soon.refresh_token, peer.register(session(TARGET, SESSION_A, false, "late-init")));
    try {
      await vi.waitFor(() => expect(peer.calls.some(c => c.path.endsWith("token"))).toBe(true));
      expect(peer.sdkTraceMarkers).toContain("INITIAL_RECOVERY");
      await s.controller.returnToAdmin(); expect(s.navigate).toHaveBeenCalledOnce();
      gate.resolve(); await peer.client.auth.initialize();
      expect(peer.sdkTraceMarkers).toContain("DISCARDED_CHANGED_STORAGE");
      expect((await s.f.client.auth.getSession()).data.session?.user.id).toBe(OPERATOR);
      expect(s.f.getSessionSnapshot()?.user.id).toBe(OPERATOR);
    } finally { gate.resolve(); await peer.client.auth.initialize(); await peer.client.auth.stopAutoRefresh(); }
  });
  it("T7 legacy token-only backup never triggers logout or guessed restore", async () => {
    const s = await setup(); localStorage.removeItem(IMPERSONATION_KEYS.RECORD);
    localStorage.setItem(IMPERSONATION_KEYS.ADMIN_SESSION_BACKUP, JSON.stringify(s.operator));
    await s.controller.returnToAdmin(); expect(s.f.calls).toHaveLength(0); expect(s.navigate).not.toHaveBeenCalled();
  });
  it("design-delta baseline: a pending public signIn can change the session after successful target verification", async () => {
    const s = await setup(); const password = deferred<void>(); const verify = deferred<void>();
    s.f.options.passwordWait = password.promise;
    s.f.options.userWait = verify.promise; s.f.options.userWaitActor = TARGET;
    const signIn = s.f.client.auth.signInWithPassword({ email: "operator@example.invalid", password: "synthetic-only" });
    const verifiedTarget = verifiedSessionBinding(s.f.client.auth, s.temporary, TARGET);
    await vi.waitFor(() => expect(s.f.calls.some(c => c.path.endsWith("token"))).toBe(true));
    password.resolve(); await signIn; verify.resolve();
    expect(await verifiedTarget).toBe(s.record.temporaryBinding);
    // Characterization, NOT acceptance of this behavior: the SDK reads the newer current session.
    await s.f.client.auth.signOut({ scope: "local" });
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toEqual([expect.objectContaining({ actor: OPERATOR, scope: "local" })]);
  });
  it("design-delta comparison: supported explicit-JWT local revoke does not log out the newer current session", async () => {
    const s = await setup(); await s.f.client.auth.signInWithPassword({ email: "operator@example.invalid", password: "synthetic-only" });
    const result = await s.f.client.auth.admin.signOut(s.temporary.access_token, "local");
    expect(result.error).toBeNull();
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toEqual([expect.objectContaining({ actor: TARGET, scope: "local" })]);
    expect((await s.f.client.auth.getSession()).data.session?.user.id).toBe(OPERATOR);
    // This says nothing about later setSession races or full application ingress coverage.
  });
  it("design-delta baseline: a supported custom SDK lock does not serialize signInWithPassword with an in-flight logout", async () => {
    let lockDepth = 0;
    const f = authFixture(async (_name, _timeout, work) => {
      lockDepth++; try { return await work(); } finally { lockDepth--; }
    });
    await f.client.auth.setSession(f.register(session(TARGET)));
    const gate = deferred<void>(); f.options.logoutWait = gate.promise;
    const logout = f.client.auth.signOut({ scope: "local" });
    await vi.waitFor(() => expect(f.calls.some(c => c.path.endsWith("logout"))).toBe(true));
    expect(lockDepth).toBeGreaterThan(0);
    const signedIn = await f.client.auth.signInWithPassword({ email: "operator@example.invalid", password: "synthetic-only" });
    expect(signedIn.data.user?.id).toBe(OPERATOR); expect(lockDepth).toBeGreaterThan(0);
    gate.resolve(); await logout;
    // Characterizes the real limitation; this is NOT safe return acceptance.
    expect((await f.client.auth.getSession()).data.session).toBeNull();
  });
});
