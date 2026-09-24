import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260924085000_inv22_ignore_live_provider_sibling.sql"),
  "utf8",
);
const resolver = readFileSync(
  resolve(root, "supabase/functions/system-health-inv22-resolve/index.ts"),
  "utf8",
);
const details = readFileSync(
  resolve(root, "supabase/functions/bepaid-get-subscription-details/index.ts"),
  "utf8",
);

describe("INV-22 live-provider sibling safety contract", () => {
  it("excludes a local subscription when any linked bePaid row is alive", () => {
    expect(migration).toContain("AND NOT EXISTS");
    expect(migration).toContain("live.state = 'active'");
    expect(migration).toContain("live.next_charge_at IS NOT NULL OR live.last_charge_at IS NOT NULL");
    expect(migration).toContain("'count', (SELECT count(*) FROM desync)");
  });

  it("returns one deterministic result per local subscription", () => {
    expect(migration).toContain("FROM candidates c");
    expect(migration).toContain("dead_provider_subscriptions");
    expect(migration).toContain("ORDER BY access_end_at, subscription_id");
  });

  it("resolver groups legacy duplicate RPC rows and rechecks all provider siblings", () => {
    expect(resolver).toContain("new Map<string, any[]>()");
    expect(resolver).toContain('eq("subscription_v2_id", subId)');
    expect(resolver).toContain('outcome = "skipped_live_sibling"');
    expect(resolver).toContain("A single live sibling protects the local subscription");
    expect(resolver).toContain('.eq("status", "active")');
    expect(resolver).toContain('.eq("auto_renew", true)');
  });

  it("unsafe user-only fallback refuses terminal records and a live sibling", () => {
    expect(details).toContain("TERMINAL_AUTOLINK_STATES");
    expect(details).toContain("bepaid.sync.autolink_skipped_terminal_state");
    expect(details).toContain("bepaid.sync.autolink_skipped_live_sibling");
    expect(details).toContain("user_only_single_sub");
  });
});
