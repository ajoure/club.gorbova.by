import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { latestObservedIncomingBoundary, telegramMessageCacheKey } from "./telegramChatCache";

describe("observed Telegram read boundary", () => {
  it("reads the mounted chat cache instead of a stale legacy cache or outgoing timestamp", () => {
    const cache = new QueryClient();
    cache.setQueryData(["telegram-messages", "contact"], [{ direction: "incoming", created_at: "2026-10-22T08:00:00Z" }]);
    cache.setQueryData(telegramMessageCacheKey("contact"), [
      { direction: "incoming", created_at: "2026-10-22T10:20:41.029785Z" },
      { direction: "outgoing", created_at: "2026-10-22T11:00:00Z" },
      { direction: "incoming", created_at: "invalid" },
    ]);
    expect(latestObservedIncomingBoundary(cache.getQueryData(telegramMessageCacheKey("contact"))))
      .toBe("2026-10-22T10:20:41.029785Z");
    expect(cache.getQueryData(telegramMessageCacheKey("other-contact"))).toBeUndefined();
    expect(cache.getQueryData(telegramMessageCacheKey("contact", "support-bot:synthetic"))).toBeUndefined();
  });
  it("never invents a boundary without a loaded incoming message", () => {
    expect(latestObservedIncomingBoundary(undefined)).toBeNull();
    expect(latestObservedIncomingBoundary([{ direction: "outgoing", created_at: "2026-10-22T11:00:00Z" }])).toBeNull();
  });
  it("preserves PostgreSQL microseconds when messages share one JavaScript millisecond", () => {
    expect(latestObservedIncomingBoundary([
      { direction: "incoming", created_at: "2026-10-22T10:20:41.029785Z" },
      { direction: "incoming", created_at: "2026-10-22T10:20:41.029786Z" },
    ])).toBe("2026-10-22T10:20:41.029786Z");
  });
});
