import { describe, expect, it, vi } from "vitest";
import { handleReport, type Dependencies, type StoredReport } from "../../supabase/functions/report-client-error/handler";
import { makeRouteErrorDiagnostic } from "../../supabase/functions/_shared/route-error-diagnostic";
const d = () => makeRouteErrorDiagnostic(new Error("test"), { id: "11111111-1111-4111-8111-111111111111", at: "2026-09-09T12:00:00.000Z", pathname: "/admin/deals", search: "?view=board", build: "unknown", online: true });
function fixture() {
  const rows = new Map<string, StoredReport>();
  const deps: Dependencies = {
    authenticate: vi.fn().mockResolvedValue({ ok: true, actor: { id: "staff" } }),
    now: () => Date.parse("2026-09-09T12:00:00.000Z"), slotId: async () => "slot",
    recent: vi.fn(async () => [...rows.values()]),
    insert: vi.fn(async (id, actorId, diagnostic) => { if (rows.has(id)) return "conflict"; rows.set(id, { id, diagnostic }); return "inserted"; }),
    read: vi.fn(async id => rows.get(id) ?? null),
  };
  return { deps, rows };
}
const req = (body: unknown) => new Request("https://example.invalid", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
describe("authenticated route error receiver", () => {
  it.each([401, 403, 500])("rejects auth/RBAC status %s before any data read/write", async status => {
    const { deps } = fixture(); vi.mocked(deps.authenticate).mockResolvedValue({ ok: false, status, error: "blocked" });
    expect((await handleReport(req(d()), deps)).status).toBe(status); expect(deps.recent).not.toHaveBeenCalled(); expect(deps.insert).not.toHaveBeenCalled();
  });
  it.each([{ extra: "private" }, { actor_user_id: "forged" }, { message: "private" }, { frames: ["https://private.invalid"] }])("rejects extra fields and raw data %j", async patch => {
    const { deps } = fixture(); expect((await handleReport(req({ ...d(), ...patch }), deps)).status).toBe(400); expect(deps.insert).not.toHaveBeenCalled();
  });
  it("rejects oversized body without trusting content-length", async () => {
    const { deps } = fixture(); expect((await handleReport(req({ x: "x".repeat(5000) }), deps)).status).toBe(400); expect(deps.insert).not.toHaveBeenCalled();
  });
  it("writes as the verified actor, reads back and deduplicates a retry", async () => {
    const { deps, rows } = fixture(); const payload = { ...d(), test_marker: "synthetic-preflight" };
    const result = await handleReport(req(payload), deps); expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ ok: true, id: payload.id, stored_id: "slot", deduplicated: false });
    expect(deps.insert).toHaveBeenCalledWith("slot", "staff", payload); expect(deps.read).toHaveBeenCalledWith("slot", "staff");
    expect(await (await handleReport(req(payload), deps)).json()).toMatchObject({ deduplicated: true }); expect(rows.size).toBe(1); expect(deps.insert).toHaveBeenCalledTimes(1);
  });
  it("DB unique minute slot limits concurrent different reports without claiming saved", async () => {
    const { deps, rows } = fixture(); vi.mocked(deps.recent).mockResolvedValue([]);
    const statuses = await Promise.all([d(), { ...d(), id: "22222222-2222-4222-8222-222222222222" }].map(async body => (await handleReport(req(body), deps)).status));
    expect(statuses.sort()).toEqual([200, 429]); expect(rows.size).toBe(1);
  });
  it("does not acknowledge failed read-back or failed persistence", async () => {
    const { deps } = fixture(); vi.mocked(deps.read).mockResolvedValue(null);
    expect((await handleReport(req(d()), deps)).status).toBe(503);
    vi.mocked(deps.recent).mockRejectedValue(new Error("secret internal details"));
    const response = await handleReport(req(d()), deps); expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  });
  it("handles browser preflight without auth/data", async () => {
    const { deps } = fixture(); const response = await handleReport(new Request("https://example.invalid", { method: "OPTIONS" }), deps);
    expect(response.status).toBe(200); expect(response.headers.get("access-control-allow-headers")).toContain("authorization"); expect(deps.authenticate).not.toHaveBeenCalled();
  });
});
