import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { cronTick, cronReportId, type CronReport } from "../../supabase/functions/system-health-full-check/cron-tick";
import { AVAILABILITY_RELEASE, SCAN_TTL_MS } from "../../supabase/functions/system-health-full-check/availability";

const report = (start: string, complete = false, created = start, overrides = {}): CronReport => ({ id: "fixture-report",
  created_at: created, report_json: { availability_scan: { release: AVAILABILITY_RELEASE, started_at: start, complete,
    resume_after: null, ...overrides } as any } });
afterEach(() => vi.unstubAllGlobals());
describe("daily work over existing authenticated minute ticks", () => {
  it("starts only at/after05:00UTC and records a legacy same-day run as already attempted", () => {
    expect(cronTick(new Date("2026-10-22T04:59:59.999Z"), null).kind).toBe("idle");
    expect(cronTick(new Date("2026-10-22T05:00:00Z"), null).kind).toBe("start");
    expect(cronTick(new Date("2026-10-22T17:00:00Z"), { id: "legacy", created_at: "2026-10-22T05:00:00Z" }).kind).toBe("idle");
    expect(cronTick(new Date("2026-10-23T05:00:00Z"), report("2026-10-22T05:00:00Z", true)).kind).toBe("start");
  });
  it("resumes one fresh matching-release predecessor per minute and honors cooldown", () => {
    const now = new Date("2026-10-22T05:01:00Z");
    expect(cronTick(now, report("2026-10-22T05:00:00Z"))).toEqual({ kind: "resume", report_id: "fixture-report" });
    expect(cronTick(now, report(now.toISOString())).kind).toBe("idle");
    expect(cronTick(now, report("2026-10-22T05:00:00Z", false, "2026-10-22T05:00:00Z",
      { resume_after: "2026-10-22T05:02:00Z" }))).toMatchObject({ kind: "idle", reason: "retry_after" });
  });
  it("accepts TTL boundary, then preserves an expired same-day attempt without an endless restart loop", () => {
    const start = "2026-10-22T05:00:00Z";
    for (const age of [SCAN_TTL_MS - 1, SCAN_TTL_MS]) expect(cronTick(new Date(Date.parse(start) + age), report(start)).kind).toBe("resume");
    expect(cronTick(new Date(Date.parse(start) + SCAN_TTL_MS + 1), report(start)).kind).toBe("idle");
    expect(cronTick(new Date("2026-10-23T05:00:00Z"), report(start)).kind).toBe("start");
  });
  it("does not resume another release, invalid times or completed scans; continuation-only never starts work", () => {
    const now = new Date("2026-10-22T05:01:00Z");
    expect(cronTick(now, report("2026-10-22T05:00:00Z", false, "2026-10-22T05:00:00Z", { release: "old" })).kind).toBe("idle");
    expect(cronTick(now, report("2026-10-22T05:00:00Z", true)).kind).toBe("idle");
    expect(cronTick(now, report("2026-10-22T05:02:00Z")).kind).toBe("idle");
    expect(cronTick(now, { id: "bad", created_at: "invalid" }).kind).toBe("idle");
    expect(cronTick(now, null, true).kind).toBe("idle");
  });
  it("continues across UTC midnight and uses start day instead of completion day for the next window", () => {
    expect(cronTick(new Date("2026-10-23T00:01:00Z"), report("2026-10-22T23:59:00Z")).kind).toBe("resume");
    expect(cronTick(new Date("2026-10-23T05:00:00Z"), report("2026-10-22T23:59:00Z", true, "2026-10-23T00:05:00Z")).kind).toBe("start");
  });
  it("derives the same atomic report PK for the same UTC day or predecessor, distinct for the next day/parent", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const day = new Date("2026-10-22T05:00:00Z");
    expect(await cronReportId(day)).toBe(await cronReportId(new Date("2026-10-22T23:59:59Z")));
    expect(await cronReportId(day)).not.toBe(await cronReportId(new Date("2026-10-23T05:00:00Z")));
    expect(await cronReportId(day, "parent-a")).toBe(await cronReportId(new Date("2026-10-23T05:00:00Z"), "parent-a"));
    expect(await cronReportId(day, "parent-a")).not.toBe(await cronReportId(day, "parent-b"));
  });
});
