import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authFixture, deferred, installLocks, OPERATOR, SESSION_B, session, TARGET } from "@/test/adminReturn/fixture";
import { type ImpersonationRecord, getImpersonationRecord, getReturnFence, IMPERSONATION_KEYS, withAuthLease, writeRecord } from "@/lib/impersonationStorage";
import { verifiedSessionBinding } from "@/lib/adminReturn";

const runtime = vi.hoisted(() => ({ client: null as SupabaseClient | null, success: vi.fn(), info: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: new Proxy({}, {
  get: (_object, key) => {
    if (!runtime.client) throw new Error("SYNTHETIC_CLIENT_NOT_CONFIGURED");
    const value = Reflect.get(runtime.client, key);
    return typeof value === "function" ? value.bind(runtime.client) : value;
  },
}) }));
vi.mock("sonner", () => ({ toast: { success: runtime.success, info: runtime.info, error: vi.fn() } }));
import { AuthProvider, useAuth } from "./AuthContext";
import { AdminReturnProvider } from "./AdminReturnContext";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { ImpersonationBar, saveAdminSessionForImpersonation } from "@/components/layout/ImpersonationBar";
import { permissionQueryKey } from "@/hooks/usePermissions";
import { adminAccessQueryKey } from "@/hooks/useAdminAccess";

let authOperations: ReturnType<typeof useAuth>;
function CaptureAuth() { authOperations = useAuth(); return null; }
const clients: QueryClient[] = [];
beforeEach(() => { localStorage.clear(); installLocks(); vi.stubGlobal("BroadcastChannel", undefined); runtime.success.mockReset(); runtime.info.mockReset(); });
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function setup() {
  const f = authFixture(); runtime.client = f.client as unknown as SupabaseClient;
  const target = f.register(session(TARGET)); const operator = f.register(session(OPERATOR, SESSION_B));
  const start = await f.client.auth.setSession(target); expect(start.error).toBeNull();
  const record: ImpersonationRecord = { version: 2, operationId: crypto.randomUUID(), startedAt: Date.now(), expectedOperatorId: OPERATOR,
    targetUserId: TARGET, temporaryBinding: await verifiedSessionBinding(f.client.auth, target, TARGET), returnUrl: "/admin/contacts", backup: operator };
  await withAuthLease(async lease => writeRecord(record, lease)); f.calls.length = 0;
  const query = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(query);
  const mount = (path = "/purchases?impersonating=true", authPage: React.ReactNode = <div>normal login page</div>) => render(<QueryClientProvider client={query}>
    <MemoryRouter initialEntries={[path]}><AuthProvider><CaptureAuth /><AdminReturnProvider><Routes>
      <Route path="/purchases" element={<ProtectedRoute><ImpersonationBar /><div>client content</div></ProtectedRoute>} />
      <Route path="/admin/contacts" element={<ProtectedRoute><div>operator content</div></ProtectedRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute><div>denied fallback content</div></ProtectedRoute>} />
      <Route path="/auth" element={authPage} />
    </Routes></AdminReturnProvider></AuthProvider></MemoryRouter>
  </QueryClientProvider>);
  return { f, record, query, mount };
}
const waitUntil = (assertion: () => void) => vi.isFakeTimers() ? vi.waitFor(assertion) : waitFor(assertion);
async function waitClient() { await waitUntil(() => expect(screen.getByText("client content")).toBeTruthy()); }
describe("Admin return real AuthProvider/coordinator/route integration with actual SDK", () => {
  it("T4/T5 unmounts guarded client content during return and accepts authorized delegated staff", async () => {
    const s = await setup(); const gate = deferred<void>(); s.f.options.permissionWait = gate.promise;
    s.mount(); await waitClient(); fireEvent.click(screen.getByRole("button", { name: "Вернуться в админку" }));
    await waitUntil(() => expect(s.f.calls.some(c => c.path.endsWith("user") && c.actor === OPERATOR)).toBe(true));
    expect(screen.queryByText("client content")).toBeNull(); expect(screen.queryByText("operator content")).toBeNull();
    expect(getImpersonationRecord()?.operationId).toBe(s.record.operationId); expect(runtime.success).not.toHaveBeenCalled();
    await act(async () => { gate.resolve(); });
    await waitUntil(() => expect(screen.getByText("operator content")).toBeTruthy());
    expect(authOperations.user?.id).toBe(OPERATOR); expect(authOperations.role).toBe("user");
    expect(runtime.success).toHaveBeenCalledOnce(); expect(getReturnFence()).toBeNull();
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toEqual([expect.objectContaining({ scope: "local", actor: TARGET })]);
  });
  it("T4/T6 discards a fresh-looking stale admin cache and follows canonical denial without logout of restored operator", async () => {
    const s = await setup(); s.f.options.deny = true;
    s.query.setQueryData(permissionQueryKey(OPERATOR), { actorId: OPERATOR, complete: true, permissions: [], userRoles: [{ code: "admin" }], adminAccess: [] });
    s.query.setQueryData(adminAccessQueryKey(OPERATOR), { actorId: OPERATOR, complete: true, rows: [], gatingEnabled: true });
    s.mount(); await waitClient(); fireEvent.click(screen.getByRole("button", { name: "Вернуться в админку" }));
    await waitUntil(() => expect(screen.getByText("denied fallback content")).toBeTruthy());
    expect(screen.queryByText("operator content")).toBeNull(); expect(runtime.success).not.toHaveBeenCalled();
    expect(runtime.info).toHaveBeenCalledOnce(); expect(authOperations.user?.id).toBe(OPERATOR);
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toHaveLength(1);
    expect(s.query.getQueryData<{ userRoles: unknown[] }>(permissionQueryKey(OPERATOR))?.userRoles).toEqual([]);
  });
  it("T4 incomplete canonical responses remain recovery, never success-degraded or cache timestamp success", async () => {
    const s = await setup(); s.f.options.permissionError = true;
    s.mount(); await waitClient(); fireEvent.click(screen.getByRole("button", { name: "Вернуться в админку" }));
    await waitUntil(() => expect(screen.getByRole("heading", { name: "Нужно подтвердить вход" })).toBeTruthy());
    expect(screen.queryByText("operator content")).toBeNull(); expect(runtime.success).not.toHaveBeenCalled(); expect(runtime.info).not.toHaveBeenCalled();
    expect(getImpersonationRecord()?.operationId).toBe(s.record.operationId);
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toHaveLength(1);
  });
  it("T6 mismatched restored identity never reaches protected content or catch logout", async () => {
    const s = await setup();
    await withAuthLease(async lease => writeRecord({ ...s.record, backup: s.f.register(session(TARGET)) }, lease));
    s.mount(); await waitClient(); fireEvent.click(screen.getByRole("button", { name: "Вернуться в админку" }));
    await waitUntil(() => expect(screen.getByRole("heading", { name: "Нужно подтвердить вход" })).toBeTruthy());
    expect(screen.queryByText("operator content")).toBeNull(); expect(runtime.success).not.toHaveBeenCalled();
    expect((await s.f.client.auth.getSession()).data.session?.user.id).toBe(TARGET);
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toHaveLength(1);
  });
  it("T7 actual public backup helper retains call signature and fails closed without binding", async () => {
    const s = await setup(); localStorage.clear(); s.f.calls.length = 0;
    await expect(saveAdminSessionForImpersonation("/admin/contacts")).rejects.toThrow("IMPERSONATION_BINDING_REQUIRED");
    expect(s.f.calls).toHaveLength(0); expect(getImpersonationRecord()).toBeNull();
  });
  it("T7 actual URL activation/remount never extends original TTL or invents a timestamp", async () => {
    const s = await setup(); const first = s.mount(); await waitClient();
    expect(getImpersonationRecord()?.startedAt).toBe(s.record.startedAt);
    first.unmount(); s.mount(); await waitClient();
    expect(getImpersonationRecord()?.startedAt).toBe(s.record.startedAt);
    expect(s.f.calls.filter(c => c.path.endsWith("logout") || c.path.endsWith("verify"))).toHaveLength(0);
  });
  it("T7 inert stale mount metadata is cleaned under its lock without any auth mutation", async () => {
    const s = await setup(); localStorage.clear(); localStorage.setItem(IMPERSONATION_KEYS.ADMIN_TOKEN, "synthetic-inert-stale");
    s.mount(); await waitClient();
    await waitUntil(() => expect(localStorage.getItem(IMPERSONATION_KEYS.ADMIN_TOKEN)).toBeNull());
    expect(s.f.calls.filter(c => /\/(logout|verify|token)$/.test(c.path))).toHaveLength(0);
  });
  it("T7 active legacy metadata stays fenced even with an authenticated SDK user; no guessed logout or restore", async () => {
    const s = await setup(); localStorage.clear(); localStorage.setItem(IMPERSONATION_KEYS.IS_IMPERSONATING, "true");
    localStorage.setItem(IMPERSONATION_KEYS.ADMIN_SESSION_BACKUP, "synthetic-legacy-untrusted");
    s.mount(); await waitUntil(() => expect(screen.getByRole("heading", { name: "Нужно подтвердить вход" })).toBeTruthy());
    expect(screen.queryByText("client content")).toBeNull(); expect(screen.queryByText("operator content")).toBeNull();
    expect(s.f.calls.filter(c => /\/(logout|verify|token)$/.test(c.path))).toHaveLength(0);
  });
  it("T9 init loading timers cannot unfence pending return or allow concurrent manual login", async () => {
    const s = await setup(); const gate = deferred<void>(); s.f.options.logoutWait = gate.promise;
    vi.useFakeTimers(); s.mount(); await waitClient();
    fireEvent.click(screen.getByRole("button", { name: "Вернуться в админку" }));
    await waitUntil(() => expect(s.f.calls.some(c => c.path.endsWith("logout"))).toBe(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(8_001); });
    expect(screen.queryByText("client content")).toBeNull(); expect(screen.queryByText("normal login page")).toBeNull();
    const attempted = await authOperations.signIn("operator@example.invalid", "synthetic-only");
    expect(attempted.error).not.toBeNull(); expect(s.f.calls.filter(c => c.path.endsWith("token"))).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(12_001); });
    expect(screen.getByRole("button", { name: "Войти заново" })).toBeDisabled();
    await act(async () => { gate.resolve(); });
    await waitUntil(() => expect(screen.getByRole("button", { name: "Войти заново" })).not.toBeDisabled());
    expect(screen.queryByText("normal login page")).toBeNull(); expect(runtime.success).not.toHaveBeenCalled();
  });
  it("T10 ordinary logout outside a return fence retains its existing global semantics and normal auth redirect", async () => {
    const s = await setup(); localStorage.clear(); s.mount(); await waitClient();
    await act(async () => { await authOperations.signOut(); });
    await waitUntil(() => expect(screen.getByText("normal login page")).toBeTruthy());
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toEqual([expect.objectContaining({ scope: "global", actor: TARGET })]);
    expect(getReturnFence()).toBeNull();
  });
  it("T10 ordinary password login outside return is unchanged and new return diagnostics never log credentials", async () => {
    const s = await setup(); localStorage.clear();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      s.mount("/auth");
      await waitUntil(() => expect(authOperations.user?.id).toBe(TARGET));
      let result: { error: unknown } | undefined;
      await act(async () => { result = await authOperations.signIn("operator@example.invalid", "synthetic-only"); });
      expect(result?.error).toBeNull();
      await waitUntil(() => expect(authOperations.user?.id).toBe(OPERATOR));
      const diagnostics = JSON.stringify([...info.mock.calls, ...error.mock.calls, ...runtime.success.mock.calls, ...runtime.info.mock.calls]);
      for (const value of [...s.f.sessions.keys(), ...s.f.refresh.keys()]) expect(diagnostics).not.toContain(value);
      expect(getReturnFence()).toBeNull();
    } finally { info.mockRestore(); error.mockRestore(); }
  });
  it("T11 actual Auth page does not auto-redirect a still-authenticated recovery user, then accepts explicit verified manual credentials", async () => {
    const s = await setup(); s.f.options.logoutStatus = 401;
    const Auth = (await import("@/pages/Auth")).default;
    s.mount("/purchases", <Auth />); await waitClient();
    fireEvent.click(screen.getByRole("button", { name: "Вернуться в админку" }));
    await waitUntil(() => expect(screen.getByRole("button", { name: "Войти заново" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Войти заново" }));
    await waitUntil(() => expect(screen.getByRole("heading", { name: "Войдите в свой аккаунт" })).toBeTruthy());
    expect(authOperations.user?.id).toBe(TARGET); expect(screen.queryByText("client content")).toBeNull();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "operator@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "synthetic-only" } });
    fireEvent.click(screen.getByRole("button", { name: /^Войти$/ }));
    await waitUntil(() => expect(getReturnFence()).toBeNull());
    expect(authOperations.user?.id).toBe(OPERATOR); expect(runtime.success).not.toHaveBeenCalled();
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toEqual([expect.objectContaining({ actor: TARGET, scope: "local" })]);
  });
  it("T11 raw actor drift during manual credential verification cannot clear the fence or log out the replacement", async () => {
    const s = await setup(); s.f.options.logoutStatus = 401;
    const Auth = (await import("@/pages/Auth")).default;
    s.mount("/purchases", <Auth />); await waitClient();
    fireEvent.click(screen.getByRole("button", { name: "Вернуться в админку" }));
    await waitUntil(() => expect(screen.getByRole("button", { name: "Войти заново" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Войти заново" }));
    await waitUntil(() => expect(screen.getByLabelText("Email")).toBeTruthy());
    const gate = deferred<void>(); s.f.options.userWait = gate.promise; s.f.options.userWaitActor = OPERATOR;
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "operator@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "synthetic-only" } });
    fireEvent.click(screen.getByRole("button", { name: /^Войти$/ }));
    await waitUntil(() => expect(s.f.calls.some(c => c.path.endsWith("user") && c.actor === OPERATOR)).toBe(true));
    s.f.options.passwordUserId = TARGET;
    await act(async () => { await s.f.client.auth.signInWithPassword({ email: "target@example.invalid", password: "synthetic-only" }); gate.resolve(); });
    await waitUntil(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(getReturnFence()?.phase).toBe("manual"); expect(authOperations.user?.id).toBe(TARGET);
    expect(screen.queryByText("operator content")).toBeNull(); expect(screen.queryByText("client content")).toBeNull();
    expect(s.f.calls.filter(c => c.path.endsWith("logout"))).toHaveLength(1); expect(runtime.success).not.toHaveBeenCalled();
  });
  it("T11 fresh public SDK state catches a peer storage change even before its auth event reaches the truthful context", async () => {
    const s = await setup(); s.f.options.logoutStatus = 401;
    const Auth = (await import("@/pages/Auth")).default;
    s.mount("/purchases", <Auth />); await waitClient();
    fireEvent.click(screen.getByRole("button", { name: "Вернуться в админку" }));
    await waitUntil(() => expect(screen.getByRole("button", { name: "Войти заново" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Войти заново" }));
    await waitUntil(() => expect(screen.getByLabelText("Email")).toBeTruthy());
    const peer = authFixture(undefined, { store: s.f.store, storageKey: s.f.storageKey });
    peer.options.passwordUserId = TARGET;
    const gate = deferred<void>(); s.f.options.userWait = gate.promise; s.f.options.userWaitActor = OPERATOR;
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "operator@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "synthetic-only" } });
    fireEvent.click(screen.getByRole("button", { name: /^Войти$/ }));
    await waitUntil(() => expect(s.f.calls.some(c => c.path.endsWith("user") && c.actor === OPERATOR)).toBe(true));
    expect(authOperations.user?.id).toBe(OPERATOR);
    // Two real SDK clients share the synthetic storage adapter. Broadcast delivery is intentionally absent.
    await peer.client.auth.signInWithPassword({ email: "target@example.invalid", password: "synthetic-only" });
    expect(authOperations.user?.id).toBe(OPERATOR);
    await act(async () => { gate.resolve(); });
    await waitUntil(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect((await s.f.client.auth.getSession()).data.session?.user.id).toBe(TARGET);
    expect(getReturnFence()?.phase).toBe("manual"); expect(screen.queryByText("operator content")).toBeNull();
    expect(screen.queryByText("client content")).toBeNull(); expect(runtime.success).not.toHaveBeenCalled();
    expect(s.f.calls.filter(c => c.path.endsWith("token"))).toHaveLength(1); // No refresh rescue.
  });
});
