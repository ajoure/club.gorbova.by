import { describe, expect, it } from "vitest";
import webhookSource from "../../supabase/functions/telegram-webhook/index.ts?raw";
import botActionsSource from "../../supabase/functions/telegram-bot-actions/index.ts?raw";
import adminChatSource from "../../supabase/functions/telegram-admin-chat/index.ts?raw";
import migrationSource from "../../supabase/migrations/20260721183552_c27995d4-a65d-4202-b4aa-add4bd025ea1.sql?raw";
import historyRbacMigrationSource from "../../supabase/migrations/20260723063657_contact_center_telegram_history_rbac.sql?raw";
import contactTelegramChatSource from "../components/admin/ContactTelegramChat.tsx?raw";

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

  it("validates an explicitly selected personal sender against the dialog", () => {
    expect(adminChatSource).toContain('sender_type === "business"');
    expect(adminChatSource).toContain('.eq("business_account_id", businessConnection.id)');
    expect(adminChatSource).toContain("business_sender_not_available_for_dialog");
  });

  it("clears older unread customer messages when the owner replies in Telegram", () => {
    expect(webhookSource).toContain("isOwnerMessage && !update.edited_business_message");
    expect(webhookSource).toContain("business_owner_reply_read_sync_failed");
    expect(webhookSource).toContain(".eq('direction', 'incoming')");
    expect(webhookSource).toContain(".eq('is_read', false)");
    expect(webhookSource).toContain(".lt('message_id', ownerMessageId)");
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

  it("allows every contact-center viewer to read the complete Telegram history", () => {
    expect(historyRbacMigrationSource).toContain(
      "CREATE OR REPLACE FUNCTION public.admin_get_telegram_messages_fast_v1",
    );
    expect(historyRbacMigrationSource).toContain(
      "CREATE OR REPLACE FUNCTION public.admin_get_telegram_messages_lean_v1",
    );
    expect(historyRbacMigrationSource).toContain(
      "CREATE OR REPLACE FUNCTION public.admin_get_telegram_messages_page_v2",
    );
    expect(historyRbacMigrationSource).toContain(
      "OR (m.created_at, m.id) < (p_before_created_at, p_before_id)",
    );
    expect(historyRbacMigrationSource.match(/public\.has_admin_section_access\(/g)).toHaveLength(3);
    expect(historyRbacMigrationSource.match(/'communication'/g)).toHaveLength(3);
    expect(historyRbacMigrationSource).toContain("'view'");
    expect(historyRbacMigrationSource).not.toContain(
      "public.has_role(auth.uid(), 'admin'::app_role)",
    );
  });

  it("does not mistake the 20-row lean cache seed for complete chat history", () => {
    expect(contactTelegramChatSource).toContain("p_limit: 20");
    expect(contactTelegramChatSource).toContain("p_limit: 200");
    expect(contactTelegramChatSource).toContain("staleTime: 0");
    expect(contactTelegramChatSource).toContain(
      "setHasOlderMessages(nextMessages.length === 200)",
    );
  });
});
