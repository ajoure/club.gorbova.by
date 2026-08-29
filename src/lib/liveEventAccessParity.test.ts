import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readRepoFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("live event access parity", () => {
  it("uses the shared rule evaluator in every entry path", () => {
    const notificationSource = readRepoFile(
      "supabase/functions/live-event-notifications-cron/index.ts",
    );
    const resolveSource = readRepoFile("supabase/functions/live-resolve/index.ts");
    const tokenSource = readRepoFile(
      "supabase/functions/live-token-validate/index.ts",
    );

    expect(notificationSource).toContain(
      "select('product_id, tariff_id, conditions')",
    );
    expect(notificationSource).toContain("await evaluateLiveAccessRule(");
    expect(resolveSource).toContain("await evaluateLiveAccessRule(");
    expect(tokenSource).toContain("await evaluateLiveAccessRules(");
    expect(tokenSource).toContain("path: 'reentry'");
    expect(notificationSource).toContain("purchaseMonths: meta?.access_purchase_months");
    expect(resolveSource).toContain("purchaseMonths: eventAllowedPurchaseMonths");
    expect(tokenSource).toContain("purchaseMonths: event.metadata?.access_purchase_months");
    expect(resolveSource).toContain("eventAllowedPurchaseMonths");
  });

  it("checks exact-tariff month lists through the bulk purchase RPC", () => {
    const monthCheckSource = readRepoFile(
      "supabase/functions/_shared/check-month-purchase.ts",
    );
    expect(monthCheckSource).toContain("has_month_purchase_bulk");
    expect(monthCheckSource).toContain("data.some");
    expect(monthCheckSource).toContain("months.length === 0");
  });

  it("does not use a product entitlement as proof of a selected tariff", () => {
    const evaluator = readRepoFile(
      "supabase/functions/_shared/live-access-rule-eval.ts",
    );
    expect(evaluator).toContain("source.tariffId === rule.tariff_id");
    expect(evaluator).toContain("no_matching_tariff_access");
    expect(evaluator).not.toContain("from('entitlements')");
  });

  it("counts legacy profile-linked paid orders in the single-event gate", () => {
    const migration = readRepoFile(
      "supabase/migrations/20260814130836_fix_live_month_gate_profile_fallback.sql",
    );

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.has_month_purchase");
    expect(migration).toContain("p.id = o.profile_id");
    expect(migration).toContain("p.user_id = _user_id");
    expect(migration).toContain("COALESCE(o.meta->>'source', '') <> 'rule_engine'");
  });

  it("keeps database RLS guards aligned with tariff and month rules", () => {
    const migration = readRepoFile(
      "supabase/migrations/20260829105213_harden_live_event_access.sql",
    );

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.user_has_live_event_access");
    expect(migration).toContain("es.tariff_id = _rule.tariff_id");
    expect(migration).toContain("public.has_month_purchase(");
    expect(migration).toContain("cardinality(_purchase_months) = 0");
    expect(migration).toContain("RETURN false;");
    expect(migration).not.toContain("FROM public.live_access_proofs");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.user_has_live_event_access(uuid, uuid) FROM PUBLIC");
    expect(migration).toContain("TO authenticated, service_role");
  });

  it("fails closed when the resolver cannot load modern access rules", () => {
    const resolveSource = readRepoFile("supabase/functions/live-resolve/index.ts");

    expect(resolveSource).toContain("if (accessRulesError)");
    expect(resolveSource).toContain("reason: 'access_rules_lookup_failed'");
    expect(resolveSource).toContain("return jsonRes({ status: 'error', message: 'Internal error' }, 500)");
    expect(resolveSource).toContain("...accessDecision");
  });
});
