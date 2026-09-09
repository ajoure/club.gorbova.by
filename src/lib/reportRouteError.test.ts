import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportRouteError } from "./reportRouteError";
import { makeRouteErrorDiagnostic } from "../../supabase/functions/_shared/route-error-diagnostic";
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: mocks.getSession }, functions: { invoke: mocks.invoke } } }));
const d = makeRouteErrorDiagnostic(new Error(), { id: "11111111-1111-4111-8111-111111111111", at: "2026-09-09T12:00:00.000Z", pathname: "/admin/deals", search: "", build: "unknown", online: true });
beforeEach(() => { vi.clearAllMocks(); mocks.getSession.mockResolvedValue({ data: { session: {} } }); });
afterEach(() => vi.useRealTimers());
describe("best-effort diagnostic delivery", () => {
  it("does not invoke an endpoint for a signed-out user or another route", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    expect(await reportRouteError(d)).toBe("local_only");
    expect(await reportRouteError({ ...d, route: "other" })).toBe("local_only"); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("requires exact acknowledgement, not just HTTP success", async () => {
    for (const data of [null, {}, { ok: true, id: "other" }]) {
      mocks.invoke.mockResolvedValue({ data, error: null }); expect(await reportRouteError(d)).toBe("not_confirmed");
    }
    mocks.invoke.mockResolvedValue({ data: { ok: true, id: d.id }, error: null }); expect(await reportRouteError(d)).toBe("sent");
  });
  it("does not recurse or throw on a failed report", async () => {
    mocks.invoke.mockRejectedValue(new Error("offline")); expect(await reportRouteError(d)).toBe("not_confirmed"); expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("bounds waiting even when session lookup stalls", async () => {
    vi.useFakeTimers(); mocks.getSession.mockReturnValue(new Promise(() => {}));
    const pending = reportRouteError(d); await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe("not_confirmed"); expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
