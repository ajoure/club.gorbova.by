import { describe, expect, it } from "vitest";
import {
  getTelegramBusinessAccountName,
  getTelegramMessageIdentityLabel,
  getTelegramPersonalChannelLabel,
} from "./telegramBusinessIdentity";

const kateryna = {
  id: "personal-account",
  first_name: "Катерина",
  last_name: "Горбова",
  username: "kateryna",
};

describe("Telegram Business identity labels", () => {
  it("uses the connected personal account for an incoming Business message", () => {
    expect(
      getTelegramMessageIdentityLabel({
        direction: "incoming",
        transport: "business",
        source: "telegram_business",
        businessAccount: kateryna,
        botName: "gorbova support",
      }),
    ).toBe("Катерина Горбова · личный Telegram");
  });

  it("does not expose the technical bot when the RPC only returns the Business source", () => {
    expect(
      getTelegramMessageIdentityLabel({
        direction: "incoming",
        source: "telegram_business",
        businessAccount: kateryna,
        botName: "gorbova support",
      }),
    ).toBe("Катерина Горбова · личный Telegram");
  });

  it("distinguishes manual and CRM replies from the personal account", () => {
    expect(
      getTelegramMessageIdentityLabel({
        direction: "outgoing",
        transport: "business",
        messageOrigin: "owner_manual",
        businessAccount: kateryna,
      }),
    ).toBe("Катерина Горбова · вручную");
    expect(
      getTelegramMessageIdentityLabel({
        direction: "outgoing",
        transport: "business",
        messageOrigin: "crm_operator",
        businessAccount: kateryna,
      }),
    ).toBe("Катерина Горбова · CRM");
  });

  it("keeps the support bot label for ordinary Bot API messages", () => {
    expect(
      getTelegramMessageIdentityLabel({
        direction: "incoming",
        transport: "bot",
        botName: "gorbova support",
        botUsername: "gorbovabybot",
      }),
    ).toBe("gorbova support");
  });

  it("falls back safely when a Business connection has no profile name", () => {
    expect(getTelegramBusinessAccountName(null)).toBeNull();
    expect(getTelegramPersonalChannelLabel(null)).toBe("Личный Telegram");
    expect(
      getTelegramMessageIdentityLabel({
        direction: "incoming",
        source: "telegram_business",
        botName: "gorbova support",
      }),
    ).toBe("Личный Telegram");
  });
});
