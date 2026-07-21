import { describe, expect, it } from "vitest";
import webhookSource from "../../supabase/functions/telegram-webhook/index.ts?raw";
import botActionsSource from "../../supabase/functions/telegram-bot-actions/index.ts?raw";
import adminChatSource from "../../supabase/functions/telegram-admin-chat/index.ts?raw";
import migrationSource from "../../supabase/migrations/20260721113128_telegram_business_contact_center.sql?raw";

describe("Telegram Business contact-centre wiring", () => {
  it("subscribes and handles every Business update family", () => {
    for (const update of [
      "business_connection",
      "business_message",
      "edited_business_message",
      "deleted_business_messages",
    ]) {
      expect(botActionsSource).toContain("TELEGRAM_BUSINESS_ALLOWED_UPDATES");
      expect(webhookSource).toContain(update);
    }
  });

  it("routes contact-centre sends through business_connection_id", () => {
    expect(adminChatSource).toContain("sendBody.business_connection_id = businessConnectionId");
    expect(adminChatSource).toContain('transport: businessConnectionId ? "business" : "bot"');
  });

  it("re-applies a configured webhook secret and preserves existing update types", () => {
    expect(botActionsSource).toContain("missingUpdates.length === 0 && !webhookSecret");
    expect(botActionsSource).toContain("[...new Set([...currentUpdates, ...businessRequiredUpdates])]");
    expect(botActionsSource).toContain("updatePayload.secret_token = webhookSecret");
  });

  it("creates a secured connection table and message dedupe index", () => {
    expect(migrationSource).toContain("CREATE TABLE public.telegram_business_connections");
    expect(migrationSource).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migrationSource).toContain("telegram_messages_business_dedupe_idx");
    expect(migrationSource).toContain("GRANT SELECT ON public.telegram_business_connections TO authenticated");
  });
});
