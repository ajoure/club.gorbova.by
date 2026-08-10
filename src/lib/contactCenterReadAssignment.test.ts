import { describe, expect, it } from "vitest";
import unifiedInboxSource from "../components/admin/communication/unified/UnifiedInboxView.tsx?raw";
import inboxSource from "../components/admin/communication/InboxTabContent.tsx?raw";
import unifiedInboxHookSource from "../hooks/useUnifiedInbox.ts?raw";
import communicationPageSource from "../pages/admin/AdminCommunication.tsx?raw";
import notificationSource from "../../supabase/functions/contact-center-assignment-notify/index.ts?raw";
import migrationSource from "../../supabase/migrations/20260810121217_fix_contact_center_mark_read_assignment_release.sql?raw";
import telegramChatSource from "../components/admin/ContactTelegramChat.tsx?raw";
import realtimeSource from "../hooks/useInboxRealtimeInvalidation.ts?raw";

describe("Contact-center read and assignment lifecycle", () => {
  it("closes the canonical unanswered marker when a dialog is dismissed", () => {
    expect(migrationSource.match(/SET is_read = true,[\s\S]*?requires_reply = false/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migrationSource).toContain(
      "(m.requires_reply OR (m.requires_reply = false AND m.is_read = false))",
    );
    expect(migrationSource).toContain("auth.role() = 'service_role'");
    expect(migrationSource).not.toContain("current_user = 'service_role'");
    expect(unifiedInboxSource).toContain('["contact-center-unanswered-dialogs"]');
    expect(unifiedInboxSource).toContain('["contact-center-assignments"]');
  });

  it("assigns the oldest open question atomically instead of using a stale prefetch", () => {
    expect(migrationSource).toContain(
      "CREATE OR REPLACE FUNCTION public.assign_contact_center_dialog_v2",
    );
    expect(migrationSource).toContain("FOR UPDATE");
    expect(migrationSource).toContain("unanswered_message_not_found");
    expect(unifiedInboxSource).toContain('"assign_contact_center_dialog_v2"');
    expect(unifiedInboxSource).not.toContain('"get_contact_center_unanswered_v1"');
  });

  it("keeps an answered assignment in My until the assignee removes it", () => {
    const resolver = migrationSource.slice(
      migrationSource.indexOf("CREATE OR REPLACE FUNCTION public.resolve_telegram_conversation_v1"),
      migrationSource.indexOf("CREATE OR REPLACE FUNCTION public.get_contact_center_assignments_v2"),
    );
    expect(resolver).toContain("requires_reply = false");
    expect(resolver).not.toContain("UPDATE public.contact_center_message_assignments");
    expect(migrationSource).toContain("CREATE OR REPLACE FUNCTION public.unassign_contact_center_dialog_v1");
    expect(migrationSource).toContain("AS is_answered");
    expect(unifiedInboxSource).toContain("Ответ дан · ");
    expect(unifiedInboxSource).toContain("Убрать из «Мои»");
    expect(unifiedInboxHookSource).toContain("Answered assignments intentionally stay in «Мои»");
    expect(telegramChatSource).toContain('["contact-center-assignments"]');
    expect(realtimeSource).toContain('["contact-center-assignments"]');
    expect(realtimeSource).toContain('["contact-center-unanswered-dialogs"]');
  });

  it("sends a compact contact card and opens the exact dialog from Telegram", () => {
    for (const field of ["full_name", "email", "phone", "telegram_username"]) {
      expect(notificationSource).toContain(field);
    }
    expect(notificationSource).toContain('text: "Посмотреть вопрос"');
    expect(notificationSource).toContain('text: "Открыть в Telegram"');
    expect(notificationSource).toContain("/admin/communication?tab=inbox&chat=");
    expect(communicationPageSource).toContain('<InboxTabContent');
    expect(communicationPageSource).toContain('deepLinkTelegramUserId={searchParams.get("chat")}');
    expect(inboxSource).toContain('deepLinkTelegramUserId?: string | null');
    expect(inboxSource).toContain('setSelectedUserId(deepLinkTelegramUserId)');
    expect(unifiedInboxSource).toContain("openedDeepLinkRef");
    expect(unifiedInboxSource).toContain('[row.key]: "telegram"');
  });

  it("keeps all new RPCs private from anonymous callers", () => {
    for (const signature of [
      "assign_contact_center_dialog_v2(uuid, uuid, text)",
      "get_contact_center_assignments_v2()",
      "unassign_contact_center_dialog_v1(uuid)",
    ]) {
      expect(migrationSource).toContain(
        `REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon`,
      );
    }
  });
});
