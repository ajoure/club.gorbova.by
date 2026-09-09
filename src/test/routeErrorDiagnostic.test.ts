import { describe, expect, it } from "vitest";
import { isChunkLoadError, makeRouteErrorDiagnostic, validRouteErrorDiagnostic } from "../../supabase/functions/_shared/route-error-diagnostic";

export function diagnostic() {
  return makeRouteErrorDiagnostic(new Error("Maximum update depth exceeded; secret@example.invalid"), {
    id: "11111111-1111-4111-8111-111111111111", at: "2026-09-09T12:00:00.000Z",
    pathname: "/admin/deals", search: "?view=board&search=private&pipeline=private", build: "2026-09-09T12:00:00.000Z", online: true,
  });
}
describe("allowlisted route diagnostics", () => {
  it("never includes raw error, host, query, non-asset paths or customer data", () => {
    const e = new Error("secret@example.invalid https://private.invalid/assets/AdminDeals-abc.js?token=secret");
    e.stack = "TypeError: secret@example.invalid\n at https://private.invalid/assets/index-abc.js:12:34\n at /private/customer.ts:1:2";
    const d = makeRouteErrorDiagnostic(e, { id: diagnostic().id, at: diagnostic().at, pathname: "/admin/deals", search: "?view=board&token=secret", build: "secret", online: true });
    expect(d.frames).toEqual(["/assets/index-abc.js:12:34", "/assets/AdminDeals-abc.js"]);
    expect(JSON.stringify(d)).not.toMatch(/secret|private|customer|token|https/);
    expect(validRouteErrorDiagnostic(d)).toBe(true);
  });
  it.each(["Failed to fetch dynamically imported module", "Importing a module script failed", "Loading chunk 12 failed", "Unable to preload CSS"]) ("classifies %s", message => expect(isChunkLoadError(new Error(message))).toBe(true));
  it("classifies runtime and minified React codes without retaining text", () => {
    expect(diagnostic().reason).toBe("update_depth");
    const e = makeRouteErrorDiagnostic(new Error("Minified React error #310; secret"), { id: diagnostic().id, at: diagnostic().at, pathname: "/admin/deals", search: "", build: "unknown", online: false });
    expect(e.react_code).toBe(310); expect(e.kind).toBe("render");
  });
  it.each([{ actor_user_id: "other" }, { message: "private" }, { frames: ["https://private.invalid/a.js"] }, { test_marker: "private" }, { route: "other" }, { build: "private" }, { id: "not-uuid" }])("rejects non-allowlisted payload %j", patch => {
    expect(validRouteErrorDiagnostic({ ...diagnostic(), ...patch })).toBe(false);
  });
  it("caps stack frames", () => {
    const e = new Error(); e.stack = Array.from({ length: 50 }, (_, i) => `/assets/file${i}.js:1:2`).join("\n");
    expect(makeRouteErrorDiagnostic(e, { id: diagnostic().id, at: diagnostic().at, pathname: "/admin/deals", search: "", build: "unknown", online: true }).frames).toHaveLength(8);
  });
});
