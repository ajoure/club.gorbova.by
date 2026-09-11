import { describe, expect, it } from "vitest";
import migration from "../../supabase/migrations/20260911080000_separate_telegram_channel_history.sql?raw";

describe("Telegram channel history SQL contract", () => {
  it("requires the existing permission and an explicit transport/channel", () => {
    expect(migration).toContain("'communication', 'view'");
    expect(migration).toContain("p_channel_ref IS NULL OR p_transport IS NULL");
    expect(migration).toContain("USING ERRCODE = '42501'");
    expect(migration.match(/FROM PUBLIC, anon/g)).toHaveLength(2);
  });
  it("filters the canonical channel before cursor pagination and LIMIT", () => {
    const history = migration.slice(migration.indexOf("RETURN QUERY"));
    expect(history).toContain("m.transport = p_transport");
    expect(history).toContain("p_transport = 'bot' AND m.bot_id = p_channel_ref");
    expect(history).toContain("p_transport = 'business' AND m.business_account_id = p_channel_ref");
    expect(history.indexOf("m.transport = p_transport")).toBeLessThan(history.indexOf("LIMIT LEAST"));
    expect(history).toContain("(m.created_at, m.id) < (p_before_created_at, p_before_id)");
  });
  it("preserves empty active channels and never modifies historical messages", () => {
    expect(migration).toContain("FROM public.telegram_bots b WHERE b.status = 'active'");
    expect(migration).toContain("FROM channels c LEFT JOIN counts n");
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE FROM|INSERT INTO)\s+public\.telegram_messages/i);
  });
});
