import { describe, expect, it } from "vitest";
import migrationSource from "../../supabase/migrations/20260723085840_contact_center_rbac_atomic_support.sql?raw";
import instagramAdminSource from "../../supabase/functions/instagram-admin-chat/index.ts?raw";
import ticketsHookSource from "../hooks/useTickets.ts?raw";
import supportContentSource from "../components/admin/communication/SupportTabContent.tsx?raw";
import ticketChatSource from "../components/support/TicketChat.tsx?raw";
import unifiedInboxSource from "../components/admin/communication/unified/UnifiedInboxView.tsx?raw";
import channelPickerSource from "../components/admin/communication/unified/ChannelPicker.tsx?raw";
import instagramMediaSource from "../components/admin/communication/instagram/InstagramMessageMedia.tsx?raw";
import communicationPageSource from "../pages/admin/AdminCommunication.tsx?raw";
import unifiedInboxHookSource from "../hooks/useUnifiedInbox.ts?raw";
import realtimeInvalidationSource from "../hooks/useInboxRealtimeInvalidation.ts?raw";
import telegramChatSource from "../components/admin/ContactTelegramChat.tsx?raw";
import telegramAdminSource from "../../supabase/functions/telegram-admin-chat/index.ts?raw";
import incomingAlertSource from "../hooks/useIncomingMessageAlert.ts?raw";
import pushHookSource from "../hooks/usePushNotifications.ts?raw";
import manychatInboundSource from "../../supabase/functions/manychat-inbound/index.ts?raw";
import telegramWebhookSource from "../../supabase/functions/telegram-webhook/index.ts?raw";

describe("Contact-center safety and mobile performance", () => {
  it("aligns contact-center RLS and protects the atomic sender RPC", () => {
    expect(migrationSource).toContain("RBAC v3: view instagram messages");
    expect(migrationSource).toContain("has_admin_section_access(auth.uid(), 'communication', 'view')");
    expect(migrationSource).toContain("CREATE OR REPLACE FUNCTION public.send_ticket_message_v2");
    expect(migrationSource).toContain("FOR UPDATE");
    expect(migrationSource).toContain("REVOKE ALL ON FUNCTION public.send_ticket_message_v2");
  });

  it("uses the exact RBAC helper arguments in the Instagram admin endpoint", () => {
    expect(instagramAdminSource).toContain("_user_id: userId");
    expect(instagramAdminSource).toContain("_section_code: 'communication'");
    expect(instagramAdminSource).toContain("_min_level: requiredAccess");
  });

  it("sends support messages atomically instead of performing two client writes", () => {
    const sender = ticketsHookSource.slice(
      ticketsHookSource.indexOf("export function useSendMessage"),
      ticketsHookSource.indexOf("// Hook to update ticket"),
    );
    expect(sender).toContain('supabase.rpc("send_ticket_message_v2"');
    expect(sender).not.toContain('.from("ticket_messages")');
    expect(sender).not.toContain('.from("support_tickets")');
  });

  it("never enables Telegram delivery just by viewing a ticket", () => {
    const profileResolver = supportContentSource.slice(
      supportContentSource.indexOf("// Resolve telegram_user_id"),
      supportContentSource.indexOf("// Bridge message to Telegram"),
    );
    expect(profileResolver).not.toContain("telegram_bridge_enabled: true");
    expect(ticketChatSource).toContain("setSendToTelegram(false)");
    expect(ticketChatSource).not.toContain("setSendToTelegram(true)");
    expect(ticketChatSource).toContain("Дополнительно отправить в Telegram");
  });

  it("propagates Instagram failures and checks mark-read invocation errors", () => {
    expect(unifiedInboxSource).toContain("if (error) throw error");
    expect(unifiedInboxSource).toContain("Instagram: ошибка загрузки");
  });

  it("keeps mobile lists inertial and protects controls from iOS safe areas", () => {
    expect(unifiedInboxSource).toContain("contact-center-safe-top");
    expect(unifiedInboxSource).toContain("touch-scroll flex-1");
    expect(channelPickerSource).toContain("overflow-x-auto");
    expect(ticketChatSource).toContain("contact-center-safe-bottom");
  });

  it("does not proxy every Instagram media item while the chat mounts", () => {
    const resetEffect = instagramMediaSource.slice(
      instagramMediaSource.indexOf("useEffect(() => {", instagramMediaSource.indexOf("export function InstagramMessageMedia")),
      instagramMediaSource.indexOf("const tryLazyRehost"),
    );
    expect(resetEffect).not.toContain("rehostMedia(");
    expect(instagramMediaSource).toContain("void tryLazyRehost");
  });

  it("lazy-loads heavy contact-center panels instead of blocking the first render", () => {
    expect(communicationPageSource).toContain("const InboxTabContent = lazy(");
    expect(communicationPageSource).toContain("const UnifiedInboxView = lazy(");
    expect(communicationPageSource).toContain("const BroadcastsTabContent = lazy(");
    expect(communicationPageSource).toContain("<Suspense fallback=");
  });

  it("paginates and virtualizes the unified inbox without a fixed 200-row ceiling", () => {
    expect(unifiedInboxHookSource).toContain("useInfiniteQuery");
    expect(unifiedInboxHookSource).toContain("getNextPageParam");
    expect(unifiedInboxHookSource).toContain("fetchNextPage");
    expect(unifiedInboxHookSource).not.toContain("perSourceLimit = 200");
    expect(unifiedInboxSource).toContain("last.index >= filtered.length - 8");
    expect(unifiedInboxSource).toContain("virtualizer.getTotalSize()");
  });

  it("requests narrow realtime payloads for contact-center invalidation", () => {
    expect(realtimeInvalidationSource).toContain('select: ["id", "direction", "user_id"]');
    expect(realtimeInvalidationSource).toContain(
      'select: ["id", "direction", "is_read", "user_id"]',
    );
    expect(realtimeInvalidationSource).toContain(
      'select: ["id", "instagram_account_id"]',
    );
  });

  it("runs the Telegram media worker before refreshing a stuck attachment", () => {
    const refreshHandler = telegramChatSource.slice(
      telegramChatSource.indexOf("const handleMediaRefresh"),
      telegramChatSource.indexOf("if (!telegramUserId)"),
    );
    expect(refreshHandler).toContain('action: "process_media_jobs"');
    expect(refreshHandler).toContain("user_id: userId");
    expect(refreshHandler).toContain("db_message_id: messageDbId");
    expect(refreshHandler.indexOf("process_media_jobs")).toBeLessThan(
      refreshHandler.indexOf("refetchMessages"),
    );
    expect(telegramAdminSource).toContain('upload_status: "unavailable"');
    expect(telegramAdminSource).toContain('.from("media_jobs").insert');
    expect(telegramAdminSource).toContain("message_db_id: messageDbId");
  });

  it("keeps browser notification subscriptions deliverable and provides a realtime fallback", () => {
    expect(pushHookSource).toContain('supabase.from("push_subscriptions" as any).upsert');
    expect(pushHookSource).toContain("[Push] Subscription reconciliation failed:");
    expect(pushHookSource).toContain("if (!cancelled) setState(\"subscribed\")");
    expect(incomingAlertSource).toContain("hasPushSubscriptionRef");
    expect(incomingAlertSource).toContain("new Notification(title");
    expect(incomingAlertSource).toContain("Notification.permission !== \"granted\"");
  });

  it("awaits Instagram and Telegram push fan-out before webhook completion", () => {
    expect(manychatInboundSource).toContain(
      "const pushResponse = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`",
    );
    expect(telegramWebhookSource).toContain(
      "const pushResponse = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`",
    );
    expect(manychatInboundSource).not.toContain(
      "}).catch((e) => console.error(\"[Push][instagram] send error\", e))",
    );
    expect(telegramWebhookSource).not.toContain(
      "}).catch(err => console.error('[Push] Send error:', err))",
    );
  });
});
