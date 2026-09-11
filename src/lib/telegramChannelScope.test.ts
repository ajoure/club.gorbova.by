import { describe, expect, it } from "vitest";
import { belongsToTelegramChannel, telegramChannelCacheKey } from "./telegramChannelScope";

describe("independent Telegram channels", () => {
  const support = { transport: "bot" as const, channel_ref: "support-bot" };
  const personal = { transport: "business" as const, channel_ref: "personal-account" };
  const personalMessage = { transport: "business", bot_id: "support-bot", business_account_id: "personal-account" };

  it("never places a personal message in the bridge bot's history", () => {
    expect(belongsToTelegramChannel(personalMessage, support)).toBe(false);
    expect(belongsToTelegramChannel(personalMessage, personal)).toBe(true);
    expect(belongsToTelegramChannel({ transport: "bot", bot_id: "support-bot" }, personal)).toBe(false);
  });

  it("separates bots and separate Business accounts sharing one bridge", () => {
    expect(belongsToTelegramChannel({ transport: "bot", bot_id: "other-bot" }, support)).toBe(false);
    expect(belongsToTelegramChannel({ ...personalMessage, business_account_id: "another-account" }, personal)).toBe(false);
    expect(belongsToTelegramChannel({ bot_id: "support-bot" }, support)).toBe(false);
  });

  it("isolates history caches by contact, transport and channel", () => {
    expect(telegramChannelCacheKey("client", support)).not.toEqual(telegramChannelCacheKey("client", personal));
    expect(telegramChannelCacheKey("client", support)).not.toEqual(telegramChannelCacheKey("other-client", support));
    expect(telegramChannelCacheKey("client", support)).not.toEqual(telegramChannelCacheKey("client", { transport: "business", channel_ref: "support-bot" }));
  });
});
