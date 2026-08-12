import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");
const validation = readFileSync(
  path.join(root, "supabase/functions/_shared/accessValidation.ts"),
  "utf8",
);
const resolver = readFileSync(
  path.join(root, "supabase/functions/_shared/resolve-effective-access.ts"),
  "utf8",
);
const telegramGrant = readFileSync(
  path.join(root, "supabase/functions/telegram-grant-access/index.ts"),
  "utf8",
);
const migration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260812094000_fix_technical_past_due_access.sql",
  ),
  "utf8",
);

describe("active access reconciliation contract", () => {
  it("excludes only undated past_due subscriptions from commercial access", () => {
    expect(validation).toContain(
      "and(access_end_at.is.null,status.in.(active,trial)),access_end_at.gt.${graceNowIso}",
    );
    expect(validation.match(/accessBearingSubscriptionFilter\(subGraceNowStr\)/g)).toHaveLength(5);
    expect(resolver).toContain(".or(accessBearingSubscriptionFilter(graceNowStr))");
    expect(validation.match(/\['active', 'trial', 'past_due', 'canceled'\]/g)).toHaveLength(5);
    expect(resolver).toContain("['active', 'trial', 'past_due', 'canceled']");
  });

  it("skips a duplicate DM only when the Telegram projection is healthy", () => {
    const projectionGuard = telegramGrant.indexOf("projectionNeedsRestore");
    const duplicateGuard = telegramGrant.indexOf("if (!is_manual && canonicalBusinessRef)");
    const healthyDuplicate = telegramGrant.indexOf("if (dup && !projectionNeedsRestore)");
    const projectionUpdate = telegramGrant.indexOf("telegram_access_projection_failed");
    const duplicateContinue = telegramGrant.indexOf("skipped_duplicate: true");
    const restoreBypass = telegramGrant.indexOf("if (dup && projectionNeedsRestore)");

    expect(projectionGuard).toBeGreaterThan(-1);
    expect(duplicateGuard).toBeGreaterThan(projectionGuard);
    expect(healthyDuplicate).toBeGreaterThan(duplicateGuard);
    expect(projectionUpdate).toBeGreaterThan(healthyDuplicate);
    expect(duplicateContinue).toBeGreaterThan(duplicateGuard);
    expect(restoreBypass).toBeGreaterThan(duplicateContinue);
  });

  it("repairs deterministic shells and aligns the live installment without extending its term", () => {
    expect(migration).toContain("technical_shell_repair_count_mismatch: expected=3");
    expect(migration).toContain("canonical_end_source', 'access_grant_ledger'");
    expect(migration).toContain("status = 'superseded'");
    expect(migration).toContain("s.next_charge_at IS NULL");
    expect(migration).toContain("live_installment_alignment_count_mismatch: expected=1");
    expect(migration).toContain("public_link_installment_window_alignment");
    expect(migration).toContain("live_s.next_charge_at = a.preserved_next_charge_at");
    expect(migration).not.toContain("paid_at +");
  });

  it("keeps paid canceled windows but rejects undated past-due rows in the aggregate", () => {
    expect(migration.match(/status IN \('past_due', 'canceled'\) AND (?:s\.)?access_end_at IS NOT NULL/g))
      .toHaveLength(4);
    expect(migration).toContain("aggregate_recalc_target_count_mismatch: expected=1");
    expect(migration).toContain("aggregate_recalc_readback_mismatch: expected=1");
  });
});
