import { describe, expect, it, vi } from "vitest";
import liveEventsListSource from "../../supabase/functions/live-events-list/index.ts?raw";
import liveResolveSource from "../../supabase/functions/live-resolve/index.ts?raw";
import liveSessionHeartbeatSource from "../../supabase/functions/live-session-heartbeat/index.ts?raw";
import { verifyLiveBearerClaims } from "../../supabase/functions/_shared/live-auth-claims.ts";

describe("live-resolve bearer claims contract", () => {
  it("returns the verified subject", async () => {
    const result = await verifyLiveBearerClaims(async () => ({
      data: { claims: { sub: "user-123" } },
      error: null,
    }));

    expect(result).toEqual({ userId: "user-123", error: null });
  });

  it("fails closed when Supabase returns an auth error", async () => {
    const authError = new Error("invalid token");
    const result = await verifyLiveBearerClaims(async () => ({
      data: null,
      error: authError,
    }));

    expect(result).toEqual({ userId: null, error: authError });
  });

  it("fails closed when malformed JWT parsing throws", async () => {
    const authError = new Error("malformed JWT");
    const getClaims = vi.fn().mockRejectedValue(authError);

    await expect(verifyLiveBearerClaims(getClaims)).resolves.toEqual({
      userId: null,
      error: authError,
    });
  });

  it("fails closed when claims do not contain a subject", async () => {
    const result = await verifyLiveBearerClaims(async () => ({
      data: { claims: {} },
      error: null,
    }));

    expect(result.userId).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it.each([
    ["live-resolve", liveResolveSource],
    ["live-events-list", liveEventsListSource],
    ["live-session-heartbeat", liveSessionHeartbeatSource],
  ])("routes %s authentication through the normalized helper", (_name, source) => {
    expect(source).toContain("await verifyLiveBearerClaims(");
    expect(source).not.toMatch(/const \{ data: claimsData, error: authError \} = await .*getClaims/);
  });

  it("keeps every invalid-token response contract at 401", () => {
    expect(liveResolveSource).toContain("return jsonRes({ status: 'auth_required' }, 401)");
    expect(liveEventsListSource).toContain("{ status: 401,");
    expect(liveSessionHeartbeatSource).toContain(
      "return jsonResponse({ status: 'auth_required' }, 401)",
    );
  });
});
