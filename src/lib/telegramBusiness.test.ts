import { describe, expect, it } from "vitest";
import {
  classifyBusinessMessage,
  TELEGRAM_BUSINESS_ALLOWED_UPDATES,
} from "../../supabase/functions/_shared/telegram-business";

describe("Telegram Business helpers", () => {
  it("classifies an incoming customer message", () => {
    expect(classifyBusinessMessage({ from: { id: 22 }, chat: { id: 22 } }, 11)).toEqual({
      isOwnerMessage: false,
      remote: { id: 22 },
      telegramUserId: 22,
    });
  });

  it("classifies a manual owner message and resolves the customer from chat", () => {
    expect(classifyBusinessMessage({ from: { id: 11 }, chat: { id: 22 } }, 11)).toEqual({
      isOwnerMessage: true,
      remote: { id: 22 },
      telegramUserId: 22,
    });
  });

  it("keeps all required webhook update names", () => {
    expect(TELEGRAM_BUSINESS_ALLOWED_UPDATES).toEqual([
      "business_connection",
      "business_message",
      "edited_business_message",
      "deleted_business_messages",
    ]);
  });
});
