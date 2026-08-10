import { describe, expect, it } from "vitest";
import webhookSource from "../../supabase/functions/telegram-webhook/index.ts?raw";
import botActionsSource from "../../supabase/functions/telegram-bot-actions/index.ts?raw";
import adminChatSource from "../../supabase/functions/telegram-admin-chat/index.ts?raw";
import auditShapeRunnerSource from "../../supabase/functions/telegram-audit-shape-runner/index.ts?raw";
import migrationSource from "../../supabase/migrations/20260721183552_c27995d4-a65d-4202-b4aa-add4bd025ea1.sql?raw";
import historyRbacMigrationSource from "../../supabase/migrations/20260723063657_contact_center_telegram_history_rbac.sql?raw";
import workOwnershipMigrationSource from "../../supabase/migrations/20260810095920_cd313d47-3142-4045-b5db-b1f234b4a06b.sql?raw";
import securityFinalizeMigrationSource from "../../supabase/migrations/20260810121000_contact_center_security_finalize.sql?raw";
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
    expect(adminChatSource.match(/message_origin: "crm_operator"/g)).toHaveLength(2);
    expect(contactTelegramChatSource).toContain('message_origin: "crm_operator"');
  });

  it("validates an explicitly selected personal sender against the dialog", () => {
    expect(adminChatSource).toContain('sender_type === "business"');
    expect(adminChatSource).toContain('.eq("business_account_id", businessConnection.id)');
    expect(adminChatSource).toContain("business_sender_not_available_for_dialog");
  });

  it("clears older unread customer messages when the owner replies in Telegram", () => {
    expect(webhookSource).toContain("isOwnerMessage && !update.edited_business_message");
    expect(webhookSource).toContain("business_owner_reply_read_sync_failed");
    expect(webhookSource).toContain(".rpc('resolve_telegram_conversation_v1'");
    expect(webhookSource).toContain("p_transport: 'business'");
    expect(webhookSource).toContain("p_boundary_message_id: ownerMessageId");
    expect(workOwnershipMigrationSource).toContain("m.direction = 'incoming'");
    expect(workOwnershipMigrationSource).toContain("m.message_id < p_boundary_message_id");
    expect(workOwnershipMigrationSource).toContain("requires_reply = false");
  });

  it("re-applies a configured webhook secret and preserves existing update types", () => {
    expect(botActionsSource).toContain("missingUpdates.length === 0");
    expect(botActionsSource).toContain("[...new Set([...currentUpdates, ...businessRequiredUpdates])]");
    expect(botActionsSource).toContain("updatePayload.secret_token = webhookSecret");
  });

  it("fails closed when the Telegram webhook secret is absent", () => {
    expect(webhookSource).toContain("if (!webhookSecret || suppliedWebhookSecret !== webhookSecret)");
    expect(botActionsSource).toContain("telegram_webhook_secret_not_configured");
    expect(auditShapeRunnerSource).toContain("'x-telegram-bot-api-secret-token': telegramWebhookSecret");
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

  it("uses production staff role codes and keeps assignment rows away from anon", () => {
    expect(workOwnershipMigrationSource).toContain(
      "r.code IN ('super_admin', 'admin', 'menedzher', 'support')",
    );
    expect(workOwnershipMigrationSource).not.toContain("'manager', 'employee'");
    expect(workOwnershipMigrationSource).toContain(
      "REVOKE ALL ON TABLE public.contact_center_message_assignments FROM PUBLIC, anon",
    );
    expect(workOwnershipMigrationSource).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contact_center_message_assignments TO authenticated",
    );
    for (const signature of [
      "resolve_telegram_conversation_v1(uuid, timestamptz, text, uuid, uuid, uuid, bigint)",
      "get_contact_center_unanswered_v1(uuid)",
      "get_contact_center_unanswered_dialogs_v1()",
      "get_contact_center_unanswered_total_v1()",
      "assign_contact_center_message_v1(uuid, uuid, text)",
      "get_contact_center_assignments_v1()",
      "get_contact_center_assignees_v1()",
    ]) {
      expect(securityFinalizeMigrationSource).toContain(
        `REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon`,
      );
    }
  });
});
