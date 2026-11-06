import { createClient, type Session, type User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { vi } from "vitest";

export const OPERATOR = "00000000-0000-4000-8000-000000000001";
export const TARGET = "00000000-0000-4000-8000-000000000002";
export const SESSION_A = "00000000-0000-4000-8000-000000000003";
export const SESSION_B = "00000000-0000-4000-8000-000000000004";
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function token(id: string, sessionId = SESSION_A, expired = false, serial = "1", lifetime?: number) {
  const encode = (v: unknown) => btoa(JSON.stringify(v)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, iss: "https://auth.fixture.invalid/auth/v1", session_id: sessionId, exp: Math.floor(Date.now() / 1000) + (lifetime ?? (expired ? -60 : 3600)), iat: 1, serial })}.c3ludGhldGlj`;
}
export function session(id: string, sessionId = SESSION_A, expired = false, serial = "1", lifetime?: number): Session {
  const user: User = { id, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z", email: `${id.slice(-1)}@example.invalid` };
  const seconds = lifetime ?? (expired ? -60 : 3600);
  return { access_token: token(id, sessionId, expired, serial, seconds), refresh_token: `synthetic-refresh-${id}-${serial}`, token_type: "bearer", expires_in: seconds, expires_at: Math.floor(Date.now() / 1000) + seconds, user };
}
export function installLocks() {
  const held = new Set<string>();
  const request = vi.fn(async (name: string, _options: unknown, callback: (lock: Lock | null) => unknown) => {
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name, mode: "exclusive" } as Lock); } finally { held.delete(name); }
  });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
  return { held, request };
}
export function authFixture(lock?: <R>(name: string, timeout: number, work: () => Promise<R>) => Promise<R>, shared?: { store: Map<string, string>; storageKey: string }, autoRefreshToken = false) {
  const store = shared?.store ?? new Map<string, string>();
  const storageKey = shared?.storageKey ?? `synthetic-${crypto.randomUUID()}`;
  const sessions = new Map<string, Session>();
  const refresh = new Map<string, Session>();
  const calls: { method: string; path: string; scope: string | null; actor?: string }[] = [];
  const sdkTraceMarkers: string[] = [];
  const options = {
    logoutStatus: 204,
    logoutWait: null as Promise<void> | null,
    passwordWait: null as Promise<void> | null,
    refreshWait: null as Promise<void> | null,
    userWait: null as Promise<void> | null,
    userWaitActor: null as string | null,
    permissionWait: null as Promise<void> | null,
    permissionError: false,
    deny: false,
    delegated: true,
    refreshError: false,
    passwordUserId: OPERATOR,
    operatorUserMissing: false,
    otpNoSession: false,
  };
  const register = (s: Session) => { sessions.set(s.access_token, s); refresh.set(s.refresh_token, s); return s; };
  const transport: typeof fetch = async (input, init) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (u.origin !== "https://auth.fixture.invalid") throw new Error("CLOSED_TRANSPORT");
    const headers = new Headers(init?.headers);
    const s = sessions.get((headers.get("authorization") ?? "").replace(/^Bearer /, ""));
    calls.push({ method: init?.method ?? "GET", path: u.pathname, scope: u.searchParams.get("scope"), actor: s?.user.id });
    const reply = (value: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (u.pathname === "/auth/v1/logout") { await options.logoutWait; return reply({ message: "synthetic logout result" }, options.logoutStatus); }
    if (u.pathname === "/auth/v1/user") { if (!options.userWaitActor || options.userWaitActor === s?.user.id) await options.userWait; return s ? reply(options.operatorUserMissing && s.user.id === OPERATOR ? { user: null } : s.user) : reply({ message: "invalid synthetic user" }, 401); }
    if (u.pathname === "/auth/v1/token") {
      const body = JSON.parse(String(init?.body));
      if (u.searchParams.get("grant_type") === "password") { await options.passwordWait; return reply(register(session(options.passwordUserId, SESSION_B, false, "manual"))); }
      await options.refreshWait;
      const next = refresh.get(body.refresh_token);
      if (options.refreshError || !next) return reply({ message: "invalid synthetic refresh", code: "refresh_token_not_found" }, 400);
      return reply(next);
    }
    if (u.pathname === "/auth/v1/verify") return reply(options.otpNoSession ? { msg: "synthetic confirmation without session" } : register(session(TARGET)));
    if (u.pathname.startsWith("/rest/v1/")) {
      if (s?.user.id === OPERATOR && !u.pathname.endsWith("profiles")) await options.permissionWait;
      if (options.permissionError && s?.user.id === OPERATOR) return reply({ message: "synthetic permission failure" }, 403);
      if (u.pathname.endsWith("get_user_permissions")) return reply([]);
      if (u.pathname.endsWith("get_admin_access")) return reply(s?.user.id === OPERATOR && !options.deny ? [{ section_code: "contacts", resource_code: null, access_level: "manage", source: "synthetic" }] : []);
      if (u.pathname.endsWith("user_roles_v2")) return reply(s?.user.id === OPERATOR && !options.delegated ? [{ role_id: "synthetic", roles: { id: "synthetic", code: "admin", name: "Admin", description: null } }] : []);
      if (u.pathname.endsWith("app_settings")) return reply({ value: { enabled: true } });
      if (u.pathname.endsWith("profiles")) return reply({ id: "synthetic-profile", status: "active" });
    }
    throw new Error(`UNEXPECTED_SYNTHETIC_ROUTE:${u.pathname}`);
  };
  const client = createClient<Database>("https://auth.fixture.invalid", "synthetic-publishable-key", {
    auth: { storage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); }, removeItem: k => { store.delete(k); } },
      storageKey, autoRefreshToken, persistSession: true, detectSessionInUrl: false, lock,
      // Public SDK diagnostics, strictly reduced to fixed markers. Never retain/print logger arguments or session values.
      debug: (_prefix, ...args) => {
        if (args.includes("commit guard: storage changed since refresh started, discarding rotated tokens")) sdkTraceMarkers.push("DISCARDED_CHANGED_STORAGE");
        if (args.includes("#_autoRefreshTokenTick()")) sdkTraceMarkers.push("AUTO_REFRESH_TICK");
        if (args.includes("#_recoverAndRefresh()")) sdkTraceMarkers.push("INITIAL_RECOVERY");
      } },
    global: { fetch: transport },
  });
  let snapshot: Session | null = null;
  client.auth.onAuthStateChange((_event, current) => { snapshot = current; });
  return { client, store, storageKey, sessions, refresh, calls, sdkTraceMarkers, options, register, transport, getSessionSnapshot: () => snapshot };
}
