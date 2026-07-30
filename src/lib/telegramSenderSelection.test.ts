import { describe, expect, it } from "vitest";
import { selectDefaultTelegramSender } from "./telegramSenderSelection";

const supportBot = { id: "support", is_primary: true };
const otherBot = { id: "other", is_primary: false };
const personalAccount = { id: "personal", is_enabled: true, can_reply: true };

describe("selectDefaultTelegramSender", () => {
  it("uses the Business account only when the latest incoming message used it", () => {
    expect(
      selectDefaultTelegramSender({
        messages: [
          {
            direction: "incoming",
            created_at: "2026-07-30T08:00:00Z",
            transport: "bot",
            bot_id: "support",
          },
          {
            direction: "incoming",
            created_at: "2026-07-30T09:00:00Z",
            transport: "business",
            business_account_id: "personal",
          },
        ],
        activeBots: [supportBot],
        businessAccount: personalAccount,
      }),
    ).toEqual({ type: "business", botId: null, businessAccountId: "personal" });
  });

  it("uses the bot from the latest incoming bot message", () => {
    expect(
      selectDefaultTelegramSender({
        messages: [
          {
            direction: "incoming",
            created_at: "2026-07-30T09:00:00Z",
            transport: "bot",
            bot_id: "other",
          },
        ],
        activeBots: [supportBot, otherBot],
        businessAccount: personalAccount,
      }),
    ).toEqual({ type: "bot", botId: "other", businessAccountId: null });
  });

  it("uses the primary support bot for a new outbound dialog", () => {
    expect(
      selectDefaultTelegramSender({
        messages: [],
        activeBots: [otherBot, supportBot],
        businessAccount: personalAccount,
      }),
    ).toEqual({ type: "bot", botId: "support", businessAccountId: null });
  });

  it("falls back to the support bot when the historical Business sender is unavailable", () => {
    expect(
      selectDefaultTelegramSender({
        messages: [
          {
            direction: "incoming",
            created_at: "2026-07-30T09:00:00Z",
            transport: "business",
            business_account_id: "personal",
          },
        ],
        activeBots: [supportBot],
        businessAccount: { ...personalAccount, can_reply: false },
      }),
    ).toEqual({ type: "bot", botId: "support", businessAccountId: null });
  });

  it("falls back to the support bot when the historical bot is inactive", () => {
    expect(
      selectDefaultTelegramSender({
        messages: [
          {
            direction: "incoming",
            created_at: "2026-07-30T09:00:00Z",
            transport: "bot",
            bot_id: "inactive",
          },
        ],
        activeBots: [supportBot],
      }),
    ).toEqual({ type: "bot", botId: "support", businessAccountId: null });
  });
});
