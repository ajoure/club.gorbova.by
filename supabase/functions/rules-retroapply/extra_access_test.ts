/**
 * Stage 4 — Deno tests for extra-access classifier.
 * Covers all 7 fixtures from the plan.
 *
 * Run: deno test --allow-net --allow-env extra_access_test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyEntitlement,
  canExecuteDestructive,
  detectLineage,
  type EntitlementSnapshot,
  type RuleCoverage,
  type PaidWindow,
} from "../_shared/extra-access-classifier.ts";

const NOW = new Date("2026-05-23T00:00:00Z").getTime();
const FUTURE = new Date("2026-09-01T00:00:00Z").toISOString();
const PAST = new Date("2026-01-01T00:00:00Z").toISOString();
const COVERED: RuleCoverage = { covered: true, rule_id: "rule-1", rule_end_ms: NOW + 86_400_000 };
const UNCOVERED: RuleCoverage = { covered: false, rule_id: null, rule_end_ms: null };

function ent(meta: Record<string, unknown> | null, expires_at: string | null = FUTURE): EntitlementSnapshot {
  return {
    id: "e1", user_id: "u1", product_id: "p1",
    expires_at, status: "active", meta,
  };
}

// ─── Fixture 1: system entitlement, no rule, no paid → soft_expire/revoke ───
Deno.test("F1: system future entitlement uncovered + no paid → revoke_extra_access", () => {
  const e = ent({ source_type: "rule_engine", source_rule_id: "old-rule" });
  const c = classifyEntitlement(e, UNCOVERED, [], NOW);
  assertEquals(c.category, "revoke_extra_access");
  assertEquals(c.lineage, "system");
  assertEquals(c.human_lineage_protected, false);
});

Deno.test("F1b: system EXPIRED entitlement uncovered + no paid → soft_expire", () => {
  const e = ent({ source_type: "retroapply" }, PAST);
  const c = classifyEntitlement(e, UNCOVERED, [], NOW);
  assertEquals(c.category, "soft_expire_extra_access");
});

// ─── Fixture 2: manual lineage, no rule, no paid ───
Deno.test("F2-nightly: manual lineage → human_lineage_protected, blocked in nightly_safe", () => {
  const e = ent({ source_type: "admin", granted_by: "admin_panel" });
  const c = classifyEntitlement(e, UNCOVERED, [], NOW);
  assertEquals(c.lineage, "manual_admin");
  assertEquals(c.human_lineage_protected, true);
  const gate = canExecuteDestructive(c, {
    reconcileMode: "nightly_safe",
    allowRevokeOrExpire: true,
    allowManualOverride: true,
    isSuperAdmin: true,
    explicitlySelected: true,
  });
  assertEquals(gate.allowed, false);
  assertEquals(gate.reason, "nightly_safe_protects_human_lineage");
});

Deno.test("F2-admin: manual lineage + all flags + super_admin → allowed", () => {
  const e = ent({ source_type: "cohort_repair" });
  const c = classifyEntitlement(e, UNCOVERED, [], NOW);
  const gate = canExecuteDestructive(c, {
    reconcileMode: "admin_canonicalize_all",
    allowRevokeOrExpire: true,
    allowManualOverride: true,
    isSuperAdmin: true,
    explicitlySelected: true,
  });
  assertEquals(gate.allowed, true);
});

// ─── Fixture 3: paid window covers → not soft-expired ───
Deno.test("F3: paid window covers future expiry → manual_review_paid_access_exists", () => {
  const e = ent({ source_type: "rule_engine" }, FUTURE);
  const paid: PaidWindow[] = [{ end_ms: new Date(FUTURE).getTime() + 86_400_000, source: "order", source_id: "o1" }];
  const c = classifyEntitlement(e, UNCOVERED, paid, NOW);
  assertEquals(c.category, "manual_review_paid_access_exists");
});

Deno.test("F3b: paid window shorter than current → manual_review_ambiguous_source", () => {
  const e = ent({ source_type: "rule_engine" }, FUTURE);
  const paid: PaidWindow[] = [{ end_ms: NOW + 7 * 86_400_000, source: "subscription", source_id: "s1" }];
  const c = classifyEntitlement(e, UNCOVERED, paid, NOW);
  assertEquals(c.category, "manual_review_ambiguous_source");
});

// ─── Fixture 4: allow_revoke_or_expire_access=false ───
Deno.test("F4: allowRevokeOrExpire=false → execute blocked even for system lineage", () => {
  const e = ent({ source_type: "rule_engine" });
  const c = classifyEntitlement(e, UNCOVERED, [], NOW);
  const gate = canExecuteDestructive(c, {
    reconcileMode: "admin_canonicalize_all",
    allowRevokeOrExpire: false,
    allowManualOverride: true,
    isSuperAdmin: true,
    explicitlySelected: true,
  });
  assertEquals(gate.allowed, false);
  assertEquals(gate.reason, "allow_revoke_or_expire_required");
});

// ─── Fixture 5: explicit selection required ───
Deno.test("F5: no explicit selection → never destructive even with all flags", () => {
  const e = ent({ source_type: "rule_engine" });
  const c = classifyEntitlement(e, UNCOVERED, [], NOW);
  const gate = canExecuteDestructive(c, {
    reconcileMode: "admin_canonicalize_all",
    allowRevokeOrExpire: true,
    allowManualOverride: true,
    isSuperAdmin: true,
    explicitlySelected: false,
  });
  assertEquals(gate.allowed, false);
  assertEquals(gate.reason, "destructive_requires_explicit_selection");
});

// ─── Fixture 6: nightly vs UI parity — same fixture, same classification ───
Deno.test("F6: classifier is stateless — identical input → identical output", () => {
  const e = ent({ source_type: "rule_engine" });
  const c1 = classifyEntitlement(e, UNCOVERED, [], NOW);
  const c2 = classifyEntitlement(e, UNCOVERED, [], NOW);
  assertEquals(c1.category, c2.category);
  assertEquals(c1.lineage, c2.lineage);
  assertEquals(c1.reason, c2.reason);
});

// ─── Fixture 7: covered by rule → already_correct ───
Deno.test("F7: rule covers → already_correct, no destructive path", () => {
  const e = ent({ source_type: "rule_engine" });
  const c = classifyEntitlement(e, COVERED, [], NOW);
  assertEquals(c.category, "already_correct");
  const gate = canExecuteDestructive(c, {
    reconcileMode: "admin_canonicalize_all",
    allowRevokeOrExpire: true,
    allowManualOverride: true,
    isSuperAdmin: true,
    explicitlySelected: true,
  });
  assertEquals(gate.allowed, false);
  assertEquals(gate.reason, "no_action_needed");
});

// ─── Lineage detection edge cases ───
Deno.test("Lineage: empty meta → none", () => {
  assertEquals(detectLineage(null), "none");
  assertEquals(detectLineage({}), "none");
});

Deno.test("Lineage: cohort_repair → manual_admin", () => {
  assertEquals(detectLineage({ source_type: "cohort_repair" }), "manual_admin");
});

Deno.test("Lineage: RETROAPPLY batch_id → system", () => {
  assertEquals(detectLineage({ batch_id: "RETROAPPLY-2026-05-23-abc" }), "system");
});

Deno.test("Lineage: manual_access_edit_last_at → manual_admin", () => {
  assertEquals(detectLineage({ manual_access_edit_last_at: "2026-01-01" }), "manual_admin");
});

// ─── Unknown lineage in nightly_safe → protected ───
Deno.test("Unknown lineage: blocked in nightly_safe", () => {
  const e = ent({}); // no markers
  const c = classifyEntitlement(e, UNCOVERED, [], NOW);
  assertEquals(c.lineage, "none");
  assertEquals(c.human_lineage_protected, true);
  const gate = canExecuteDestructive(c, {
    reconcileMode: "nightly_safe",
    allowRevokeOrExpire: true,
    allowManualOverride: true,
    isSuperAdmin: true,
    explicitlySelected: true,
  });
  assertEquals(gate.allowed, false);
});
