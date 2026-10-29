import { describe, expect, it, vi } from "vitest";
import { authorizePlayback, type PlaybackDependencies, type PlaybackPermit } from "../../supabase/functions/_shared/video-playback-authorization";

const mediaId = "11111111-1111-4111-8111-111111111111";
const request = { id: mediaId, type: "vod", token: "synthetic-pilot-token" };
const permit: PlaybackPermit = { subject: "fixture-viewer", sessionId: "fixture-session", mediaId, mediaType: "vod", expiresAt: 1300 };
function deps(overrides: Partial<PlaybackDependencies> = {}): PlaybackDependencies {
  return { authenticateProvider: vi.fn(async () => true), verifyPermit: vi.fn(async () => ({ ...permit })),
    canWatch: vi.fn(async () => true), nowSeconds: () => 1000, ...overrides };
}

describe("offline playback authorization contract (not a deployed DRM test)", () => {
  it("allows repeated license requests, pause/resume and seek while entitlement remains valid", async () => {
    const d = deps();
    for (let i = 0; i < 4; i++) expect(await authorizePlayback(request, d)).toBe(200);
    expect(d.canWatch).toHaveBeenCalledTimes(4);
  });
  it("checks live event identity separately from its VOD recording", async () => {
    expect(await authorizePlayback({ ...request, type: "live" }, deps())).toBe(403);
    expect(await authorizePlayback({ ...request, type: "live" }, deps({ verifyPermit: async () => ({ ...permit, mediaType: "live" }) }))).toBe(200);
  });
  it.each([null, [], {}, { ...request, token: "" }, { ...request, token: "x".repeat(8193) },
    { ...request, id: "short-player-slug" }, { ...request, id: "00000000-0000-0000-0000-000000000000" },
    { ...request, type: "recording" }, { ...request, type: ["vod"] }])("rejects malformed callback %#", async body => {
    const d = deps();
    expect(await authorizePlayback(body, d)).toBe(403);
    expect(d.canWatch).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated provider before touching a token", async () => {
    const d = deps({ authenticateProvider: async () => false });
    expect(await authorizePlayback(request, d)).toBe(403);
    expect(d.verifyPermit).not.toHaveBeenCalled();
  });
  it.each([null, { ...permit, expiresAt: 1000 }, { ...permit, expiresAt: NaN }, { ...permit, sessionId: "" },
    { ...permit, subject: "" }, { ...permit, mediaId: "22222222-2222-4222-8222-222222222222" }])("rejects invalid, stale or mismatched grant %#", async value => {
    const d = deps({ verifyPermit: async () => value });
    expect(await authorizePlayback(request, d)).toBe(403);
    expect(d.canWatch).not.toHaveBeenCalled();
  });
  it("rejects revoked session/access and does not trust client roles or entitlement claims", async () => {
    let access = true;
    const d = deps({ canWatch: async () => access });
    expect(await authorizePlayback(request, d)).toBe(200);
    access = false;
    expect(await authorizePlayback({ ...request, role: "super_admin", has_access: true }, d)).toBe(403);
  });
  it.each(["authenticateProvider", "verifyPermit", "canWatch"] as const)("fails closed on %s outage", async key => {
    expect(await authorizePlayback(request, deps({ [key]: async () => { throw new Error("fixture outage"); } }))).toBe(403);
  });
  it("denies when permit expires during the access check", async () => {
    let now = 1000;
    expect(await authorizePlayback(request, deps({ nowSeconds: () => now, canWatch: async () => { now = 1300; return true; } }))).toBe(403);
  });
  it("times out before the provider deadline even if a dependency ignores abort", async () => {
    vi.useFakeTimers();
    try {
      const result = authorizePlayback(request, deps({ canWatch: async () => new Promise(() => {}) }), 3500);
      await vi.advanceTimersByTimeAsync(3500);
      expect(await result).toBe(403);
    } finally { vi.useRealTimers(); }
  });
  it("does not mistake IPv4 subnet or user agent for device proof: copied bearer remains replayable (release blocker)", async () => {
    const originalBrowser = { ...request, ip: "192.0.2.0", user_agent: "fixture browser" };
    const secondBrowser = { ...originalBrowser };
    // An independent viewer can produce exactly the documented callback fields.
    // This PASS proves a LIMITATION, not successful anti-sharing protection.
    const d = deps();
    expect(await authorizePlayback(originalBrowser, d)).toBe(200);
    expect(await authorizePlayback(secondBrowser, d)).toBe(200);
  });
  it("a naive one-use ticket breaks the legitimate second startup license request", async () => {
    let used = false;
    const d = deps({ verifyPermit: async () => { if (used) return null; used = true; return permit; } });
    expect(await authorizePlayback(request, d)).toBe(200);
    expect(await authorizePlayback(request, d)).toBe(403);
  });
});
