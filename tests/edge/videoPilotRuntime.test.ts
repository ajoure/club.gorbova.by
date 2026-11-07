// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { AUDIENCE, ISSUER, handlePilotRequest, issuePermit, readPilotConfig, readPilotSecrets,
  type PilotDependencies, type Viewer } from "../../supabase/functions/video-pilot-token/core";

const now = 1_700_000_000;
const subject = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const mediaId = "33333333-3333-4333-8333-333333333333";
const raw = { enabled: true, sessionPolicyVerified: true, singleSessionPerUser: false, subjects: [subject],
  media: [{ key: "synthetic-vod", id: mediaId, type: "vod", playerId: "syntheticPlayer" }],
  origins: ["https://pilot.example.test"], ttlSeconds: 60, sessionMaxAgeSeconds: 1800, sessionIdleSeconds: 300 };
const config = readPilotConfig(JSON.stringify(raw))!;
const secrets = readPilotSecrets("a1".repeat(32), "b2".repeat(32))!;
const viewer: Viewer = { subject, sessionId, authExpiresAt: now + 600 };
const providerHeader = `Basic ${btoa(`pilot-provider:${secrets.providerPassword}`)}`;
const deps = (extra: Partial<PilotDependencies> = {}): PilotDependencies => ({
  authenticate: vi.fn(async () => viewer), canWatch: vi.fn(async () => true), now: () => now, ...extra,
});
const issuer = (body: unknown = { mediaKey: "synthetic-vod" }, extra: Record<string, string> = {}) =>
  new Request("https://example.test/token", { method: "POST", headers: {
    "Content-Type": "application/json", Origin: raw.origins[0], Authorization: "Bearer verified-by-adapter", ...extra,
  }, body: JSON.stringify(body) });
const callback = (token: string, body: Record<string, unknown> = {}, auth = providerHeader) =>
  new Request("https://example.test/callback", { method: "POST", headers: {
    "Content-Type": "application/json", Authorization: auth,
  }, body: JSON.stringify({ token, id: mediaId, type: "vod", ...body }) });
const permit = () => issuePermit(viewer, config.media[0], config, secrets, now);

describe("isolated pilot HTTP and real JWT security boundaries", () => {
  it("is disabled without explicitly verified configuration or independent strong secrets", async () => {
    for (const value of [undefined, "{}", JSON.stringify({ ...raw, enabled: false }),
      JSON.stringify({ ...raw, sessionPolicyVerified: false })]) expect(readPilotConfig(value)).toBeNull();
    expect(readPilotSecrets("short", "short")).toBeNull();
    expect(readPilotSecrets("aa".repeat(32), "aa".repeat(32))).toBeNull();
    expect((await handlePilotRequest(issuer(), "token", null, secrets, deps())).status).toBe(404);
  });
  it.each([
    { ttlSeconds: 301 }, { ttlSeconds: NaN }, { sessionIdleSeconds: 0 }, { sessionMaxAgeSeconds: 31536001 },
    { sessionIdleSeconds: undefined }, { sessionMaxAgeSeconds: undefined },
    { subjects: [] }, { subjects: ["not-uuid"] }, { origins: ["*"] }, { origins: ["http://example.test"] },
    { origins: ["https://pilot.example.test/path"] }, { media: [raw.media[0], raw.media[0]] },
    { media: [{ ...raw.media[0], key: undefined }] }, { media: [{ ...raw.media[0], playerId: undefined }] },
  ])("rejects unsafe configuration %#", delta => expect(readPilotConfig(JSON.stringify({ ...raw, ...delta }))).toBeNull());
  it("issues a bounded real signed JWT; callback accepts repeated licenses only after live ACL", async () => {
    const d = deps();
    const result = await handlePilotRequest(issuer(), "token", config, secrets, d);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("access-control-allow-origin")).toBe(raw.origins[0]);
    const p = await result.json();
    expect(p.expiresAt).toBe(now + 60);
    expect(p.renewAfterSeconds).toBe(36);
    for (let i = 0; i < 3; i++) expect((await handlePilotRequest(callback(p.token), "callback", config, secrets, d)).status).toBe(200);
    expect(d.canWatch).toHaveBeenCalledTimes(4);
  });
  it("never extends permit past the verified platform JWT expiry", async () => {
    expect((await issuePermit({ ...viewer, authExpiresAt: now + 20 }, config.media[0], config, secrets, now)).expiresAt).toBe(now + 20);
    await expect(issuePermit({ ...viewer, authExpiresAt: now + 5 }, config.media[0], config, secrets, now)).rejects.toThrow();
  });
  it("denies missing auth, cross-origin and unknown media without issuing a permit", async () => {
    for (const request of [issuer({}, { Origin: "https://attacker.test" }), issuer({ mediaKey: "real-course" }),
      issuer(undefined, { Authorization: "" })]) {
      expect((await handlePilotRequest(request, "token", config, secrets, deps())).status).not.toBe(200);
    }
    expect((await handlePilotRequest(issuer(), "token", config, secrets, deps({ authenticate: async () => null }))).status).toBe(401);
    expect((await handlePilotRequest(issuer(), "token", config, secrets, deps({ authenticate: async () => ({ ...viewer, subject: sessionId }) }))).status).toBe(401);
  });
  it("checks provider authentication before doing any ACL work", async () => {
    const p = await permit(), d = deps();
    expect((await handlePilotRequest(callback(p.token, {}, "Basic invalid"), "callback", config, secrets, d)).status).toBe(403);
    expect(d.canWatch).not.toHaveBeenCalled();
  });
  it("denies altered signatures, wrong UUID/type, expired and revoked sessions", async () => {
    const p = await permit();
    const parts = p.token.split(".");
    parts[1] = btoa(JSON.stringify({ sub: sessionId }));
    for (const request of [callback(parts.join(".")), callback(p.token, { id: sessionId }), callback(p.token, { type: "live" })])
      expect((await handlePilotRequest(request, "callback", config, secrets, deps())).status).toBe(403);
    expect((await handlePilotRequest(callback(p.token), "callback", config, secrets, deps({ now: () => now + 60 }))).status).toBe(403);
    expect((await handlePilotRequest(callback(p.token), "callback", config, secrets, deps({ canWatch: async () => false }))).status).toBe(403);
  });
  it.each([
    { iss: "other" }, { aud: "other" }, { ctx: "other" }, { auth_exp: now + 10 },
    { iat: now + 5 }, { exp: now + 301 }, { sub: sessionId }, { sid: "unknown" }, { jti: "invalid" },
  ])("denies correctly signed but invalid claims %#", async extra => {
    const token = await new SignJWT({ iss: ISSUER, aud: AUDIENCE, sub: subject, sid: sessionId,
      jti: crypto.randomUUID(), media_id: mediaId, media_type: "vod", ctx: "synthetic-vod",
      iat: now, exp: now + 60, auth_exp: now + 600, ...extra })
      .setProtectedHeader({ alg: "HS256", typ: "pilot-drm+jwt" }).sign(secrets.signingKey);
    expect((await handlePilotRequest(callback(token), "callback", config, secrets, deps())).status).toBe(403);
  });
  it("denies HS384 algorithm confusion even with the same secret", async () => {
    const token = await new SignJWT({ sub: subject }).setProtectedHeader({ alg: "HS384", typ: "pilot-drm+jwt" })
      .sign(new Uint8Array(48).fill(1));
    expect((await handlePilotRequest(callback(token), "callback", config, secrets, deps())).status).toBe(403);
  });
  it("fails closed on database error/deadline and cancels upstream I/O", async () => {
    const p = await permit();
    let observed: AbortSignal | undefined;
    const d = deps({ canWatch: async (_v, _m, signal) => { observed = signal; return new Promise(() => {}); } });
    expect((await handlePilotRequest(callback(p.token), "callback", config, secrets, d, 20)).status).toBe(403);
    expect(observed?.aborted).toBe(true);
    expect((await handlePilotRequest(callback(p.token), "callback", config, secrets,
      deps({ canWatch: async () => { throw new Error("sensitive error must not escape"); } }))).status).toBe(403);
  });
  it("bounds streaming input and rejects oversized or non-JSON bodies", async () => {
    const p = await permit();
    expect((await handlePilotRequest(callback(p.token, { padding: "x".repeat(17000) }), "callback", config, secrets, deps())).status).toBe(403);
    const request = new Request("https://example.test/callback", { method: "POST",
      headers: { Authorization: providerHeader, "Content-Type": "application/json" },
      body: new ReadableStream({ start() {} }), duplex: "half" } as RequestInit);
    expect((await handlePilotRequest(request, "callback", config, secrets, deps(), 20)).status).toBe(403);
  });
  it("records the accepted residual risk: copying a valid bearer token is not device binding", async () => {
    const p = await permit();
    for (const ip of ["192.0.2.0", "198.51.100.0"])
      expect((await handlePilotRequest(callback(p.token, { ip, user_agent: "another browser" }), "callback", config, secrets, deps())).status).toBe(200);
  });
});
