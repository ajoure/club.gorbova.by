// PATCH-PACKAGE-CUSTOM-FIELDS-V1 (B5): unit-tests для required-gate.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluatePfRequiredGate } from "./pf-required-gate.ts";

const baseEntry = {
  public_id: "pf-000001",
  label: "Дата",
  data_type: "date",
  rendered_value: "",
  effective_required: true,
  default_kind_applied: null,
};

Deno.test("gate: ok when no tokens", () => {
  assertEquals(evaluatePfRequiredGate([], {}).kind, "ok");
});

Deno.test("gate: tokens_not_preresolved when bag misses entry", () => {
  const r = evaluatePfRequiredGate(
    [{ public_id: "pf-000001", raw_inside: "pf-000001" }],
    {},
  );
  assertEquals(r.kind, "tokens_not_preresolved");
  if (r.kind === "tokens_not_preresolved") {
    assertEquals(r.tokens, ["{{pf-000001}}"]);
  }
});

Deno.test("gate: required + empty → 422 payload shape", () => {
  const r = evaluatePfRequiredGate(
    [{ public_id: "pf-000001", raw_inside: "pf-000001" }],
    { "pf-000001": { ...baseEntry, raw_value: null } },
  );
  assertEquals(r.kind, "required_missing");
  if (r.kind === "required_missing") {
    assertEquals(r.fields, [{ public_id: "pf-000001", label: "Дата" }]);
  }
});

Deno.test("gate: required + empty array → required_missing", () => {
  const r = evaluatePfRequiredGate(
    [{ public_id: "pf-000002", raw_inside: "pf-000002" }],
    { "pf-000002": { ...baseEntry, public_id: "pf-000002", raw_value: [] } },
  );
  assertEquals(r.kind, "required_missing");
});

Deno.test("gate: non-required + empty → ok", () => {
  const r = evaluatePfRequiredGate(
    [{ public_id: "pf-000003", raw_inside: "pf-000003" }],
    { "pf-000003": { ...baseEntry, public_id: "pf-000003", effective_required: false, raw_value: "" } },
  );
  assertEquals(r.kind, "ok");
});

Deno.test("gate: duplicate token deduped, single missing reported once", () => {
  const r = evaluatePfRequiredGate(
    [
      { public_id: "pf-000004", raw_inside: "pf-000004" },
      { public_id: "pf-000004", raw_inside: "pf-000004|case=gen" },
    ],
    { "pf-000004": { ...baseEntry, public_id: "pf-000004", raw_value: "" } },
  );
  assertEquals(r.kind, "required_missing");
  if (r.kind === "required_missing") assertEquals(r.fields.length, 1);
});

Deno.test("gate: filled required → ok", () => {
  const r = evaluatePfRequiredGate(
    [{ public_id: "pf-000005", raw_inside: "pf-000005" }],
    { "pf-000005": { ...baseEntry, public_id: "pf-000005", raw_value: "2026-06-15", rendered_value: "15.06.2026" } },
  );
  assertEquals(r.kind, "ok");
});
