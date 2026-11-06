import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createAuthMutationFacade } from "./authMutationFacade";
import {
  type AuthLease, type ImpersonationRecord, IMPERSONATION_TTL, clearOwnedImpersonation,
  getImpersonationRecord, getReturnFence, hasActiveImpersonationMarker,
  normalizeAdminReturnUrl, saveImpersonationState, validRecord, withAuthLease, writeFence, writeRecord,
} from "./impersonationStorage";

type Auth = SupabaseClient["auth"];
const codeError = (code: string) => new Error(code);
function claims(token: string): { exp?: number; sub?: string; iss?: string; session_id?: string } | null {
  try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
}
/** Used only for drift/consistency, never authorization. Authority is exact-token getUser and canonical RBAC. */
function sessionHint(token: string) {
  const p = claims(token);
  return p && typeof p.sub === "string" && typeof p.iss === "string" && /^https?:\/\//.test(p.iss)
    && typeof p.session_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.session_id)
    ? JSON.stringify([p.iss, p.sub, p.session_id]) : null;
}
async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
/** Claims are read ONLY after the exact token was accepted by getUser; they grant no role. */
export async function verifiedSessionBinding(auth: Auth, session: Session, expectedUserId: string) {
  const verified = await auth.getUser(session.access_token);
  if (verified.error || !verified.data.user || verified.data.user.id !== expectedUserId || session.user.id !== expectedUserId) throw codeError("RETURN_IDENTITY_MISMATCH");
  try {
    const payload = JSON.parse(atob(session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.sub === expectedUserId && typeof payload.iss === "string" && /^https?:\/\//.test(payload.iss)
      && typeof payload.session_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.session_id)) {
      return "session:" + await digest(JSON.stringify([payload.iss, payload.sub, payload.session_id]));
    }
  } catch { /* Exact-token fallback, never infer a session ID. */ }
  return "token:" + await digest(session.access_token);
}

async function captureBackup(auth: Auth, targetUserId: string | undefined, returnUrl: string, lease: AuthLease) {
  if (!targetUserId) throw codeError("IMPERSONATION_BINDING_REQUIRED");
  if (getReturnFence() || hasActiveImpersonationMarker()) throw codeError("RETURN_BUSY");
  const result = await auth.getSession();
  const session = result.data.session;
  if (result.error || !session) throw codeError("OPERATOR_SESSION_REQUIRED");
  await verifiedSessionBinding(auth, session, session.user.id);
  const current = await auth.getSession();
  if (!current.data.session || current.data.session.access_token !== session.access_token) throw codeError("RETURN_IDENTITY_CHANGED");
  const record: ImpersonationRecord = {
    version: 2, operationId: crypto.randomUUID(), startedAt: Date.now(), expectedOperatorId: session.user.id,
    targetUserId, temporaryBinding: null, returnUrl: normalizeAdminReturnUrl(returnUrl),
    backup: { access_token: session.access_token, refresh_token: session.refresh_token },
  };
  saveImpersonationState(record.backup, returnUrl, record, lease);
  return record;
}

/** Public helper keeps its old call shape, but an unbound legacy caller fails before any auth mutation. */
export async function saveVerifiedAdminBackup(auth: Auth, returnUrl: string, targetUserId?: string) {
  return withAuthLease(lease => captureBackup(auth, targetUserId, returnUrl, lease));
}

/** The same origin lock covers capture, existing start action, OTP and verified target binding. */
export async function startBoundImpersonation(auth: Auth, targetUserId: string, returnUrl: string,
  start: () => Promise<{ tokenHash: string } | null>) {
  return withAuthLease(async lease => {
    const record = await captureBackup(auth, targetUserId, returnUrl, lease);
    let mutationStarted = false;
    try {
      const result = await start();
      if (!result) throw codeError("IMPERSONATION_START_FAILED");
      mutationStarted = true;
      writeFence({ operationId: record.operationId, phase: "pending", deadline: record.startedAt + IMPERSONATION_TTL }, lease);
      const otp = await createAuthMutationFacade(auth).verifyOtp({ token_hash: result.tokenHash, type: "magiclink" }, lease);
      if (otp.error || !otp.data.session || !otp.data.user || otp.data.user.id !== targetUserId) throw codeError("IMPERSONATION_SESSION_FAILED");
      record.temporaryBinding = await verifiedSessionBinding(auth, otp.data.session, targetUserId);
      if (getImpersonationRecord()?.operationId !== record.operationId) throw codeError("RETURN_OWNER_CHANGED");
      writeRecord(record, lease);
      // Remove only our entry fence. The backup remains for the eventual return.
      localStorage.removeItem("admin_return_fence_v2");
      window.dispatchEvent(new Event("gorbova:admin-return-state"));
      return true;
    } catch {
      if (!mutationStarted) clearOwnedImpersonation(record.operationId, lease);
      else writeFence({ operationId: record.operationId, phase: "recovery", deadline: record.startedAt + IMPERSONATION_TTL }, lease);
      throw codeError("IMPERSONATION_START_FAILED");
    }
  });
}

export interface ReturnView { phase: "idle" | "pending" | "recovery" | "manual"; inFlight: boolean; code: string }
export interface ReturnDependencies {
  auth: Auth;
  getSessionSnapshot: () => Session | null;
  waitForActor: (id: string, signal: AbortSignal) => Promise<void>;
  freshAccess: (id: string, returnUrl: string, signal: AbortSignal) => Promise<{ allowed: boolean; fallback: string }>;
  navigate: (url: string) => void;
  notice: (kind: "success" | "denied") => void;
}
export class AdminReturnController {
  private listeners = new Set<() => void>();
  private view: ReturnView;
  private inFlight = false;
  constructor(private deps: ReturnDependencies) {
    const fence = getReturnFence();
    this.view = { phase: fence?.phase === "manual" ? "manual" : fence || (hasActiveImpersonationMarker() && !validRecord(getImpersonationRecord())) ? "recovery" : "idle", inFlight: false, code: "" };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.view;
  private publish(phase: ReturnView["phase"], code = "") {
    this.view = { phase, code, inFlight: this.inFlight }; this.listeners.forEach(fn => fn());
  }
  sync = () => {
    if (this.inFlight) return;
    const f = getReturnFence();
    this.publish(f?.phase === "manual" ? "manual" : f || (hasActiveImpersonationMarker() && !validRecord(getImpersonationRecord())) ? "recovery" : "idle");
  };
  async returnToAdmin() {
    if (this.inFlight) return;
    this.inFlight = true; this.publish("pending");
    try {
      await withAuthLease(async lease => {
        const record = getImpersonationRecord();
        const existingFence = getReturnFence();
        const operationId = existingFence?.operationId ?? record?.operationId ?? crypto.randomUUID();
        const deadline = validRecord(record) ? Math.min(Date.now() + 20_000, record.startedAt + IMPERSONATION_TTL) : Date.now();
        writeFence({ operationId, deadline, phase: "pending" }, lease);
        if (existingFence || !validRecord(record)) throw codeError("RETURN_MANUAL_LOGIN_REQUIRED");
        // Capture once from truthful context/SDK state. Never rescue an expired candidate by shared-client refresh.
        const candidate = this.deps.getSessionSnapshot();
        const candidateExpiry = candidate && claims(candidate.access_token)?.exp;
        if (!candidate || candidate.user.id !== record.targetUserId || typeof candidateExpiry !== "number"
          || !Number.isFinite(candidateExpiry) || candidateExpiry * 1000 <= Date.now()) throw codeError("RETURN_CANDIDATE_INVALID");
        const exactJwt = candidate.access_token;
        const temporaryHint = sessionHint(exactJwt);
        const operatorHint = sessionHint(record.backup.access_token);
        let stage: "candidate" | "restore" | "verify" = "candidate";
        let drift = false;
        const observer = this.deps.auth.onAuthStateChange((event, session) => {
          // Synchronous observation only. No SDK/DB/role calls inside the listener.
          if (stage === "candidate") {
            if (session?.user.id === record.targetUserId && (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED")
              && (session.access_token === exactJwt || temporaryHint && sessionHint(session.access_token) === temporaryHint)) return;
          } else if (session?.user.id === record.expectedOperatorId
            && (!operatorHint || sessionHint(session.access_token) === operatorHint)) return;
          drift = true;
        });
        const storageObserver = (event: StorageEvent) => {
          // Old/unwrapped same-origin documents can still write. Observe without reading token values or private SDK fields.
          if (event.storageArea === localStorage && event.key?.startsWith("sb-") && event.key.includes("-auth-token") && event.newValue !== event.oldValue) drift = true;
        };
        window.addEventListener("storage", storageObserver);
        const abort = new AbortController();
        const timer = setTimeout(() => {
          abort.abort();
          writeFence({ operationId, deadline, phase: "recovery" }, lease);
          this.publish("recovery", "RETURN_PENDING_UNKNOWN");
        }, Math.max(0, deadline - Date.now()));
        const assertOwner = () => {
          if (drift || abort.signal.aborted || Date.now() >= deadline || getImpersonationRecord()?.operationId !== record.operationId
            || getReturnFence()?.operationId !== operationId) throw codeError("RETURN_PENDING_UNKNOWN");
        };
        try {
          if (await verifiedSessionBinding(this.deps.auth, candidate, record.targetUserId) !== record.temporaryBinding) throw codeError("RETURN_IDENTITY_CHANGED");
          assertOwner();
          // Public SDK exact-JWT endpoint: NEVER consult current SDK storage to choose a destructive target.
          const mutations = createAuthMutationFacade(this.deps.auth);
          const revoked = await mutations.revokeCaptured(exactJwt, lease); assertOwner();
          if (revoked.error) throw codeError("RETURN_REVOCATION_UNVERIFIED");
          // A 2xx acknowledges the refresh-session revoke; it does not invalidate already issued access JWTs.
          stage = "restore";
          const restored = await mutations.setSession(record.backup, lease); assertOwner();
          if (restored.error || !restored.data.session || !restored.data.user
            || restored.data.user.id !== record.expectedOperatorId || restored.data.session.user.id !== record.expectedOperatorId) throw codeError("RETURN_OPERATOR_UNVERIFIED");
          const verified = await this.deps.auth.getUser(restored.data.session.access_token); assertOwner();
          if (verified.error || verified.data.user?.id !== record.expectedOperatorId) throw codeError("RETURN_OPERATOR_UNVERIFIED");
          stage = "verify";
          await this.deps.waitForActor(record.expectedOperatorId, abort.signal); assertOwner();
          const decision = await this.deps.freshAccess(record.expectedOperatorId, record.returnUrl, abort.signal); assertOwner();
          const confirmed = this.deps.getSessionSnapshot();
          if (!confirmed || confirmed.user.id !== record.expectedOperatorId
            || (sessionHint(restored.data.session.access_token) ? sessionHint(confirmed.access_token) !== sessionHint(restored.data.session.access_token)
              : confirmed.access_token !== restored.data.session.access_token)) throw codeError("RETURN_IDENTITY_CHANGED");
          clearOwnedImpersonation(operationId, lease);
          this.publish("idle");
          this.deps.navigate(decision.allowed ? normalizeAdminReturnUrl(record.returnUrl) : decision.fallback);
          this.deps.notice(decision.allowed ? "success" : "denied");
        } catch {
          if (getReturnFence()?.operationId === operationId) writeFence({ operationId, deadline, phase: "recovery" }, lease);
          this.publish("recovery", "RETURN_VERIFICATION_REQUIRED");
        } finally {
          clearTimeout(timer); observer.data.subscription.unsubscribe(); window.removeEventListener("storage", storageObserver);
        }
      });
    } catch { this.publish("recovery", "RETURN_MANUAL_LOGIN_REQUIRED"); }
    finally { this.inFlight = false; this.publish(this.view.phase, this.view.code); }
  }
  async prepareManualLogin() {
    if (this.inFlight) return;
    try {
      // A new document must reacquire this SAME origin lock; another tab may still own the pending SDK operation.
      await withAuthLease(async lease => {
        const fence = getReturnFence(); const record = getImpersonationRecord();
        writeFence({ operationId: fence?.operationId ?? record?.operationId ?? crypto.randomUUID(), phase: "manual", deadline: fence?.deadline ?? 0 }, lease);
        this.publish("manual"); this.deps.navigate("/auth");
      });
    } catch { this.publish("recovery", "RETURN_OTHER_WINDOW_PENDING"); }
  }
}

/** Only application waits can be abandoned; this NEVER claims cancellation of an SDK mutation. */
export function awaitApplicationRead<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(codeError("RETURN_PENDING_UNKNOWN")); return; }
    const stop = () => reject(codeError("RETURN_PENDING_UNKNOWN"));
    signal.addEventListener("abort", stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}
