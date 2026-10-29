/**
 * OFFLINE PILOT ONLY. No Edge entrypoint, secrets, database or provider changes.
 * This checks entitlement, NOT possession of the viewer's device. A bearer URL
 * can be replayed. That residual risk was accepted for an isolated pilot on
 * 2026-10-29; production still requires runtime acceptance and separate approval.
 */
export type VideoMediaType = "vod" | "live";

export interface PlaybackPermit {
  subject: string;
  sessionId: string;
  mediaId: string;
  mediaType: VideoMediaType;
  expiresAt: number; // Unix seconds; not a one-use ticket
}

export interface PlaybackDependencies {
  /** Verify the provider's credential, never a credential supplied in the body. */
  authenticateProvider: (signal: AbortSignal) => Promise<boolean>;
  /** Cryptographically verify signature/algorithm, issuer and audience first. */
  verifyPermit: (token: string, signal: AbortSignal) => Promise<PlaybackPermit | null>;
  /** Recheck BOTH live application session and current content ACL on every call.
   * Never accept a role, entitlement, mapping or session status from the browser.
   * Unknown mapping, deleted content, revoked access and errors must deny.
   */
  canWatch: (permit: PlaybackPermit, signal: AbortSignal) => Promise<boolean>;
  nowSeconds: () => number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nilUuid = "00000000-0000-0000-0000-000000000000";
const validMediaId = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value) && value !== nilUuid;

/** The documented Kinescope callback has no device proof / license challenge.
 * ip is only IPv4 /24; user_agent is forgeable. Neither is authorization proof.
 * Return exactly 403 on ALL failures. Provider must ALSO use strict:true.
 */
export async function authorizePlayback(
  body: unknown,
  dependencies: PlaybackDependencies,
  deadlineMs = 3500,
): Promise<200 | 403> {
  if (!Number.isFinite(deadlineMs) || deadlineMs < 1 || deadlineMs > 4000) return 403;
  if (!body || typeof body !== "object" || Array.isArray(body)) return 403;
  const request = body as Record<string, unknown>;
  if (!validMediaId(request.id) || (request.type !== "vod" && request.type !== "live") ||
      typeof request.token !== "string" || request.token.length < 1 || request.token.length > 8192) return 403;

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deniedOnDeadline = new Promise<403>((resolve) => {
    timeout = setTimeout(() => { controller.abort(); resolve(403); }, deadlineMs);
  });
  const check = async (): Promise<200 | 403> => {
    try {
      if (await dependencies.authenticateProvider(controller.signal) !== true || controller.signal.aborted) return 403;
      const permit = await dependencies.verifyPermit(request.token as string, controller.signal);
      if (!permit || controller.signal.aborted || typeof permit.subject !== "string" || !permit.subject ||
          typeof permit.sessionId !== "string" || !permit.sessionId ||
          !validMediaId(permit.mediaId) || permit.mediaId.toLowerCase() !== (request.id as string).toLowerCase() ||
          permit.mediaType !== request.type || !Number.isFinite(permit.expiresAt)) return 403;
      const isFresh = () => {
        const now = dependencies.nowSeconds();
        return Number.isFinite(now) && permit.expiresAt > now;
      };
      if (!isFresh()) return 403;
      if (await dependencies.canWatch(permit, controller.signal) !== true) return 403;
      // Recheck after slow I/O; access must not be granted after expiration/deadline.
      return !controller.signal.aborted && isFresh() ? 200 : 403;
    } catch {
      // Tokens, URLs, provider payloads and exception messages must not be logged.
      return 403;
    }
  };
  try { return await Promise.race([check(), deniedOnDeadline]); }
  finally { clearTimeout(timeout); controller.abort(); }
}
