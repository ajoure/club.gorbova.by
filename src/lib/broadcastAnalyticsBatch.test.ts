import emailAdapter from "../../supabase/functions/email-mass-broadcast/boundedAnalytics.ts?raw";
import telegramAdapter from "../../supabase/functions/telegram-mass-broadcast/boundedAnalytics.ts?raw";
import { describe, expect, it } from "vitest";
import { chunkAnalyticsRead, prepareAnalyticsDeliveries } from "../../supabase/functions/telegram-mass-broadcast/boundedAnalytics";

describe("broadcast analytics bounded GETs", () => {
  it("packages the same bounded adapter with each managed sender", () => { expect(emailAdapter).toBe(telegramAdapter); });
  it.each([205, 1001])("prepares all %i recipients without an oversized PostgREST URL", async (count) => {
    const recipients = Array.from({ length: count }, (_, index) => ({
      recipientKey: `profile:${String(index).padStart(36, "0")}:bot:${"b".repeat(36)}`,
    }));
    const persisted = new Map<string, string>();
    let readCount = 0;
    const client = {
      from: () => ({
        upsert: async (rows: Array<{ id: string; recipient_key: string }>) => {
          for (const row of rows) persisted.set(row.recipient_key, row.id);
          return { error: null };
        },
        select: () => ({ eq: () => ({ in: async (_field: string, keys: string[]) => {
          readCount++;
          const encodedLength = keys.reduce((total, key) => total + encodeURIComponent(key).length + 3, 0);
          if (keys.length > 50 || encodedLength > 3000) return { error: { message: "URI too long" } };
          return { data: keys.map((key) => ({ id: persisted.get(key), recipient_key: key })), error: null };
        } }) }),
      }),
      rpc: async () => ({ error: null }),
    };
    const deliveries = await prepareAnalyticsDeliveries(client, { campaignId: "campaign", runId: "run", channel: "telegram" }, recipients);
    expect(deliveries).toHaveLength(count);
    expect(deliveries.map((row) => row.recipientKey)).toEqual(recipients.map((row) => row.recipientKey));
    expect(readCount).toBeGreaterThan(1);
  });

  it("limits UUID tracking reads and accounts for non-ASCII keys", () => {
    const ids = Array.from({ length: 501 }, (_, index) => String(index).padStart(36, "0"));
    const batches = chunkAnalyticsRead(ids, (id) => id);
    expect(batches.flat()).toEqual(ids);
    expect(batches.every((batch) => batch.length <= 50)).toBe(true);
    const longKeys = Array.from({ length: 30 }, (_, index) => `${index}${"ключ".repeat(15)}`);
    expect(chunkAnalyticsRead(longKeys, (key) => key).every((batch) => batch.reduce((n, key) => n + encodeURIComponent(key).length + 3, 0) <= 3000)).toBe(true);
  });
});
