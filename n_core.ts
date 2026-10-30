import { SignJWT, jwtVerify } from "npm:jose@6.2.3";

// Synthetic media only. This does not grant access to any production lesson.
export const ISSUER = "gorbova-video-drm-pilot";
export const AUDIENCE = "kinescope-drm-pilot";
const TYPE = "pilot-drm+jwt";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyPattern = /^[a-z][a-z0-9-]{0,63}$/;
export interface PilotMedia { key: string; id: string; type: "vod" | "live"; playerId: string }
export interface PilotConfig {
  subjects: string[];
  media: PilotMedia[];
  origins: string[];
  ttlSeconds: number;
  // Explicit null means disabled in the independently verified Auth policy.
  sessionMaxAgeSeconds: number | null;
  sessionIdleSeconds: number | null;
  singleSessionPerUser: boolean;
}
export interface Viewer { subject: string; sessionId: string; authExpiresAt: number }
export interface PilotDependencies {
  // Must verify the Supabase signature, issuer, audience and expiration.
  authenticate: (jwt: string, signal: AbortSignal) => Promise<Viewer | null>;
  // Live auth.sessions / user-ban lookup AND current pilot ACL; service role only.
  canWatch: (viewer: Viewer, media: PilotMedia, signal: AbortSignal) => Promise<boolean>;
  now: () => number;
}
export interface PilotSecrets { signingKey: Uint8Array; providerPassword: string }

export function readPilotConfig(raw: string | undefined): PilotConfig | null {
  try {
    const c = JSON.parse(raw ?? "null");
    if (!c || c.enabled !== true || c.sessionPolicyVerified !== true || typeof c.singleSessionPerUser !== "boolean") return null;
    if (!Array.isArray(c.subjects) || c.subjects.length < 1 || c.subjects.length > 5 ||
      !c.subjects.every((v: unknown) => typeof v === "string" && uuid.test(v))) return null;
    if (!Array.isArray(c.media) || c.media.length < 1 || c.media.length > 4 ||
      !c.media.every((m: PilotMedia) => m && typeof m.key === "string" && keyPattern.test(m.key) &&
        typeof m.id === "string" && uuid.test(m.id) && (m.type === "vod" || m.type === "live") &&
        typeof m.playerId === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(m.playerId))) return null;
    if (new Set(c.media.map((m: PilotMedia) => m.key)).size !== c.media.length ||
      new Set(c.media.map((m: PilotMedia) => `${m.type}:${m.id.toLowerCase()}`)).size !== c.media.length) return null;
    if (!Array.isArray(c.origins) || c.origins.length < 1 || c.origins.length > 4 ||
      !c.origins.every((o: unknown) => {
        if (typeof o !== "string") return false;
        const u = new URL(o);
        return u.protocol === "https:" && u.origin === o && !u.username && !u.password;
      })) return null;
    if (!Number.isInteger(c.ttlSeconds) || c.ttlSeconds < 30 || c.ttlSeconds > 300) return null;
    for (const key of ["sessionIdleSeconds", "sessionMaxAgeSeconds"] as const)
      if (!(key in c) || (c[key] !== null && (!Number.isInteger(c[key]) || c[key] < 1 || c[key] > 31536000))) return null;
    return c as PilotConfig;
  } catch { return null; }
}

export function readPilotSecrets(key: string | undefined, password: string | undefined): PilotSecrets | null {
  if (!/^[0-9a-f]{64}$/i.test(key ?? "") || !/^[0-9a-f]{64}$/i.test(password ?? "") || key === password) return null;
  return { signingKey: Uint8Array.from(key!.match(/../g)!, h => parseInt(h, 16)), providerPassword: password! };
}

function validViewer(v: Viewer | null, c: PilotConfig, now: number): v is Viewer {
  return !!v && uuid.test(v.subject) && uuid.test(v.sessionId) && c.subjects.includes(v.subject) &&
    Number.isSafeInteger(v.authExpiresAt) && v.authExpiresAt > now;
}
export async function issuePermit(v: Viewer, m: PilotMedia, c: PilotConfig, s: PilotSecrets, now: number) {
  if (!Number.isSafeInteger(now) || !validViewer(v, c, now) || !c.media.includes(m)) throw new Error("pilot_denied");
  const expiresAt = Math.min(now + c.ttlSeconds, v.authExpiresAt);
  if (expiresAt - now < 10) throw new Error("pilot_auth_refresh_required");
  const token = await new SignJWT({ sid: v.sessionId, media_id: m.id, media_type: m.type,
    ctx: m.key, auth_exp: v.authExpiresAt })
    .setProtectedHeader({ alg: "HS256", typ: TYPE }).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setSubject(v.subject).setJti(crypto.randomUUID()).setIssuedAt(now)
    .setExpirationTime(expiresAt).sign(s.signingKey);
  return { token, expiresAt, renewAfterSeconds: Math.max(1, Math.floor((expiresAt - now) * 0.6)),
    mediaKey: m.key, mediaType: m.type, playerId: m.playerId };
}

export async function verifyPermit(token: string, c: PilotConfig, s: PilotSecrets, now: number) {
  const { payload: p } = await jwtVerify(token, s.signingKey, { issuer: ISSUER, audience: AUDIENCE,
    algorithms: ["HS256"], typ: TYPE, currentDate: new Date(now * 1000), clockTolerance: 0,
    requiredClaims: ["sub", "sid", "jti", "iat", "exp", "auth_exp", "media_id", "media_type", "ctx"] });
  const v: Viewer = { subject: p.sub!, sessionId: p.sid as string, authExpiresAt: p.auth_exp as number };
  const m = c.media.find(x => x.key === p.ctx && x.id === p.media_id && x.type === p.media_type);
  if (!validViewer(v, c, now) || !m || !uuid.test(p.jti!) ||
    !Number.isSafeInteger(p.iat) || !Number.isSafeInteger(p.exp) || p.iat! > now ||
    p.exp! <= p.iat! || p.exp! - p.iat! > c.ttlSeconds || p.exp! > v.authExpiresAt) throw new Error("pilot_denied");
  return { viewer: v, media: m, expiresAt: p.exp! };
}

async function providerAuthenticated(header: string | null, password: string): Promise<boolean> {
  if (!header || header.length > 512) return false;
  const expected = `Basic ${btoa(`pilot-provider:${password}`)}`;
  // Compare fixed-length digests, never exit early on a matching secret prefix.
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([header, expected].map(x => crypto.subtle.digest("SHA-256", encode.encode(x))));
  let difference = 0;
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  for (let i = 0; i < aa.length; i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}

async function boundedJson(req: Request, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("pilot_body");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("pilot_body");
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error("pilot_timeout");
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) throw new Error("pilot_body");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("pilot_body");
    return body;
  } finally { signal.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); }
}

// The deadline covers body consumption, authentication, database I/O and signing.
export async function handlePilotRequest(req: Request, kind: "token" | "callback", c: PilotConfig | null,
  secrets: PilotSecrets | null, deps: PilotDependencies, deadlineMs = 3500): Promise<Response> {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = { "Cache-Control": "no-store", "Content-Type": "application/json" };
  if (kind === "token" && c?.origins.includes(origin ?? "")) Object.assign(headers, {
    "Access-Control-Allow-Origin": origin!, "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  const response = (status: number, body: unknown = { error: "pilot_denied" }) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
  if (!c || !secrets) return response(404);
  if (kind === "token" && !c.origins.includes(origin ?? "")) return response(403);
  if (req.method === "OPTIONS" && kind === "token") return response(204);
  if (req.method !== "POST") return response(kind === "callback" ? 403 : 405);
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 3500) return response(403);
  const controller = new AbortController();
  const timeoutResponse = response(403);
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<Response>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(timeoutResponse); }, deadlineMs);
  });
  const run = async () => {
    try {
      if (kind === "callback" && !await providerAuthenticated(req.headers.get("authorization"), secrets.providerPassword)) return response(403);
      const body = await boundedJson(req, controller.signal);
      if (controller.signal.aborted) return response(403);
      if (kind === "token") {
        const bearer = req.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
        if (!bearer || bearer.length > 8192) return response(401);
        const viewer = await deps.authenticate(bearer, controller.signal);
        if (!validViewer(viewer, c, deps.now()) || controller.signal.aborted) return response(401);
        const media = c.media.find(x => x.key === body.mediaKey);
        if (!media || !await deps.canWatch(viewer, media, controller.signal) || controller.signal.aborted) return response(403);
        const permit = await issuePermit(viewer, media, c, secrets, deps.now());
        return !controller.signal.aborted && permit.expiresAt > deps.now() ? response(200, permit) : response(403);
      }
      if (typeof body.token !== "string" || body.token.length > 8192 || !body.token) return response(403);
      const permit = await verifyPermit(body.token, c, secrets, deps.now());
      if (body.id !== permit.media.id || body.type !== permit.media.type || controller.signal.aborted) return response(403);
      if (!await deps.canWatch(permit.viewer, permit.media, controller.signal)) return response(403);
      // Repeat license calls remain valid until expiry; jti is not single-use.
      return !controller.signal.aborted && permit.expiresAt > deps.now() ? response(200, {}) : response(403);
    } catch { return response(403); }
  };
  try { return await Promise.race([run(), deadline]); }
  finally { clearTimeout(timer!); controller.abort(); }
}
