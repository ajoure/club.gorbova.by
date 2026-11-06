/** Metadata is a consistency hint, never authority. Shared writes require the origin Web Lock. */
export const IMPERSONATION_KEYS = {
  ADMIN_SESSION_BACKUP: "admin_session_backup", IS_IMPERSONATING: "is_impersonating",
  IMPERSONATION_START: "impersonation_start_time", ADMIN_RETURN_URL: "admin_return_url",
  ADMIN_TOKEN: "admin_token", ADMIN_SESSION: "admin_session",
  RECORD: "admin_impersonation_v2", FENCE: "admin_return_fence_v2",
} as const;
export const IMPERSONATION_TTL = 15 * 60 * 1000;
export const AUTH_OPERATION_LOCK = "gorbova:impersonation-auth-transaction:v2";
export const RETURN_STATE_EVENT = "gorbova:admin-return-state";
export interface AdminBackup { access_token: string; refresh_token: string }
export interface ImpersonationRecord {
  version: 2; operationId: string; startedAt: number; expectedOperatorId: string;
  targetUserId: string; temporaryBinding: string | null; returnUrl: string; backup: AdminBackup;
}
export interface ReturnFence { operationId: string; phase: "pending" | "recovery" | "manual"; deadline: number }
declare const leaseBrand: unique symbol;
export type AuthLease = { readonly [leaseBrand]: true };
const liveLeases = new WeakSet<object>();
const pendingMutations = new WeakMap<object, Set<Promise<unknown>>>();
export function hasWebLocks() { return typeof navigator !== "undefined" && !!navigator.locks?.request; }
export async function withAuthLease<T>(work: (lease: AuthLease) => Promise<T>): Promise<T> {
  if (!hasWebLocks()) throw new Error("RETURN_LOCK_UNAVAILABLE");
  return navigator.locks.request(AUTH_OPERATION_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("RETURN_BUSY");
    const lease = {} as AuthLease;
    liveLeases.add(lease);
    pendingMutations.set(lease, new Set());
    try { return await work(lease); } finally {
      // Even a caller that abandons its application wait cannot release a running SDK mutation.
      const pending = pendingMutations.get(lease)!;
      while (pending.size) await Promise.allSettled([...pending]);
      liveLeases.delete(lease); pendingMutations.delete(lease);
    }
  });
}
function requireLease(lease: AuthLease) { if (!liveLeases.has(lease)) throw new Error("RETURN_LOCK_REQUIRED"); }
export function runOwnedAuthMutation<T>(lease: AuthLease, work: () => Promise<T>): Promise<T> {
  requireLease(lease);
  const pending = pendingMutations.get(lease)!;
  const promise = Promise.resolve().then(() => { requireLease(lease); return work(); });
  pending.add(promise);
  void promise.then(() => pending.delete(promise), () => pending.delete(promise));
  return promise;
}
function changed() { window.dispatchEvent(new Event(RETURN_STATE_EVENT)); }
function read<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
export function getImpersonationRecord(): ImpersonationRecord | null { return read(IMPERSONATION_KEYS.RECORD); }
export function getReturnFence(): ReturnFence | null {
  try {
    const raw = localStorage.getItem(IMPERSONATION_KEYS.FENCE);
    if (!raw) return null;
    const f = JSON.parse(raw) as ReturnFence;
    if (typeof f.operationId === "string" && ["pending", "recovery", "manual"].includes(f.phase) && Number.isFinite(f.deadline)) return f;
  } catch { /* A corrupt fence stays closed. */ }
  return { operationId: "invalid", phase: "recovery", deadline: 0 };
}
export function normalizeAdminReturnUrl(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")
    || Array.from(value).some(character => character.charCodeAt(0) <= 32)) return "/dashboard";
  try { const u = new URL(value, window.location.origin); return u.origin === window.location.origin ? u.pathname + u.search + u.hash : "/dashboard"; } catch { return "/dashboard"; }
}
export function validRecord(r: ImpersonationRecord | null, now = Date.now()): r is ImpersonationRecord {
  return !!r && r.version === 2 && typeof r.operationId === "string" && !!r.operationId
    && Number.isFinite(r.startedAt) && r.startedAt > 0 && now >= r.startedAt && now - r.startedAt < IMPERSONATION_TTL
    && typeof r.expectedOperatorId === "string" && !!r.expectedOperatorId
    && typeof r.targetUserId === "string" && !!r.targetUserId
    && typeof r.temporaryBinding === "string" && /^(session|token):[a-f0-9]{64}$/.test(r.temporaryBinding)
    && typeof r.backup?.access_token === "string" && !!r.backup.access_token
    && typeof r.backup?.refresh_token === "string" && !!r.backup.refresh_token;
}
export function isValidImpersonationState() { return validRecord(getImpersonationRecord()); }
export function hasActiveImpersonationMarker() {
  try { return localStorage.getItem(IMPERSONATION_KEYS.IS_IMPERSONATING) === "true" || !!localStorage.getItem(IMPERSONATION_KEYS.RECORD); } catch { return false; }
}
export function hasStaleImpersonationState() {
  try { return Object.values(IMPERSONATION_KEYS).some(k => localStorage.getItem(k) !== null) && !isValidImpersonationState(); } catch { return false; }
}
export function writeRecord(record: ImpersonationRecord, lease: AuthLease) {
  requireLease(lease);
  localStorage.setItem(IMPERSONATION_KEYS.RECORD, JSON.stringify(record));
  localStorage.setItem(IMPERSONATION_KEYS.IS_IMPERSONATING, "true");
  changed();
}
export function writeFence(fence: ReturnFence, lease: AuthLease) {
  requireLease(lease); localStorage.setItem(IMPERSONATION_KEYS.FENCE, JSON.stringify(fence)); changed();
}
/** The origin lock provides exclusion; equality only prevents clearing a replaced operation. */
export function clearOwnedImpersonation(operationId: string, lease: AuthLease) {
  requireLease(lease);
  const record = getImpersonationRecord(); const fence = getReturnFence();
  if ((record && record.operationId !== operationId) || (fence && fence.operationId !== operationId)) throw new Error("RETURN_OWNER_CHANGED");
  Object.values(IMPERSONATION_KEYS).forEach(k => localStorage.removeItem(k)); changed();
}
export function clearImpersonationStorage(lease?: AuthLease) {
  if (getReturnFence() || getImpersonationRecord()) { if (!lease) return; requireLease(lease); }
  Object.values(IMPERSONATION_KEYS).forEach(k => localStorage.removeItem(k)); changed();
}
export function getAdminSessionBackup(): AdminBackup | null { return getImpersonationRecord()?.backup ?? null; }
export function getAdminReturnUrl() { return normalizeAdminReturnUrl(getImpersonationRecord()?.returnUrl); }
/** Legacy callers cannot invent verified identity/binding. */
export function saveImpersonationState(_backup: AdminBackup, _returnUrl: string, record?: ImpersonationRecord, lease?: AuthLease) {
  if (!record || !lease) throw new Error("IMPERSONATION_BINDING_REQUIRED");
  writeRecord(record, lease);
}
