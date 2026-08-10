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
import adminSidebarSource from "../components/layout/AdminSidebar.tsx?raw";
import inboxQueryKeysSource from "../constants/inboxQueryKeys.ts?raw";
import unifiedInboxHookSource from "../hooks/useUnifiedInbox.ts?raw";
import realtimeInvalidationSource from "../hooks/useInboxRealtimeInvalidation.ts?raw";
import telegramChatSource from "../components/admin/ContactTelegramChat.tsx?raw";
import telegramAdminSource from "../../supabase/functions/telegram-admin-chat/index.ts?raw";
import incomingAlertSource from "../hooks/useIncomingMessageAlert.ts?raw";
import pushHookSource from "../hooks/usePushNotifications.ts?raw";
import manychatInboundSource from "../../supabase/functions/manychat-inbound/index.ts?raw";
import telegramWebhookSource from "../../supabase/functions/telegram-webhook/index.ts?raw";
import unifiedChatHeaderSource from "../components/admin/communication/unified/UnifiedChatHeader.tsx?raw";
import mediaLightboxSource from "../components/admin/chat/MediaLightbox.tsx?raw";
import { sanitizeExternalDisplayName } from "./sanitizeExternalDisplayName";

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

  it("keeps mobile lists inertial and renders one compact clickable contact header", () => {
    expect(unifiedInboxSource).not.toContain("contact-center-safe-top");
    expect(unifiedInboxSource).toContain("compactMobile={isMobile}");
    expect(unifiedChatHeaderSource).toContain('aria-label="Вернуться к списку чатов"');
    expect(unifiedChatHeaderSource).toContain("linked && setSheetOpen(true)");
    expect(unifiedInboxSource).toContain("touch-scroll flex-1");
    expect(channelPickerSource).toContain("overflow-x-auto");
    expect(ticketChatSource).toContain("contact-center-safe-bottom");
  });

  it("keeps media controls inside the iPhone safe viewport", () => {
    expect(mediaLightboxSource).not.toContain("!w-screen !h-[100dvh]");
    expect(mediaLightboxSource).toContain("env(safe-area-inset-top)");
    expect(mediaLightboxSource).toContain("env(safe-area-inset-bottom)");
    expect(mediaLightboxSource).toContain("max-h-[calc(80dvh-4rem)]");
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

  it("hydrates every unanswered Telegram dialog without downloading the full inbox", () => {
    expect(unifiedInboxHookSource).toContain("mergeTelegramWorkQueue");
    expect(unifiedInboxHookSource).toContain("for (const queueItem of tgQueue)");
    expect(unifiedInboxHookSource).toContain("unanswered?.oldest_message_text");
    expect(unifiedInboxHookSource).toContain("unreadCount: Number(unanswered?.unanswered_count) || 0");
    expect(unifiedInboxHookSource).toContain("!serverSearch");
  });

  it("keeps channel badges and channel views on the same unified contact queue", () => {
    expect(unifiedInboxHookSource).toContain("totalUnread: contactRows.filter");
    expect(unifiedInboxHookSource).toContain('telegramUnread: open("telegram")');
    expect(communicationPageSource).toContain("onCountsChange={setUnifiedCounts}");
    expect(communicationPageSource).toContain('unifiedEnabled && inboxChannel !== "email"');
    expect(communicationPageSource).toContain("sourceFilter={unifiedSourceFilter}");
    expect(communicationPageSource).toContain("instagramBadgeUnread");
    expect(unifiedInboxSource).toContain("isUnansweredForSource(r, sourceFilter)");
    expect(unifiedInboxSource).toContain('sourceFilter !== "all" && row.channels[sourceFilter]');
    expect(unifiedInboxSource).toContain("rowActive.lastMessagePreview");
    expect(unifiedInboxSource).toContain('sourceFilter === "all" ? row.totalUnread : rowActive.unread');
  });

  it("keeps the global contact-center badge equal to the visible canonical queue", () => {
    expect(inboxQueryKeysSource).toContain("CONTACT_CENTER_VISIBLE_UNREAD_QK");
    expect(communicationPageSource).toContain(
      "queryClient.setQueryData(CONTACT_CENTER_VISIBLE_UNREAD_QK, inboxUnread)",
    );
    expect(adminSidebarSource).toContain(
      'location.pathname.startsWith("/admin/communication")',
    );
    expect(adminSidebarSource).toContain(
      'typeof contactCenterVisibleUnread === "number"',
    );
  });

  it("renders ready sources progressively instead of blocking on the slowest integration", () => {
    expect(unifiedInboxHookSource).toContain("const loadingBySource");
    expect(unifiedInboxHookSource).toContain("contactRows.length === 0");
    expect(unifiedInboxHookSource).toContain("Object.values(loadingBySource).some(Boolean)");
    expect(unifiedInboxSource).toContain(
      'sourceFilter === "all" ? isLoading : loadingBySource[sourceFilter]',
    );
    expect(unifiedInboxSource).toContain("viewIsLoading ?");
  });

  it("keeps realtime invalidation scoped to contact-center tables and typed fields", () => {
    expect(realtimeInvalidationSource).toContain('table: "telegram_messages"');
    expect(realtimeInvalidationSource).toContain(
      'new: { direction?: string; is_read?: boolean; user_id?: string } | null',
    );
    expect(realtimeInvalidationSource).toContain('table: "instagram_messages"');
    expect(realtimeInvalidationSource).toContain('table: "support_tickets"');
    expect(realtimeInvalidationSource).toContain('table: "ticket_messages"');
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

  it("uses canonical commercial access and stores bot technical replies in chat history", () => {
    expect(telegramWebhookSource).toContain(
      "import { hasCommercialAccess } from '../_shared/accessValidation.ts'",
    );
    expect(telegramWebhookSource).toContain(
      "const access = await hasCommercialAccess(supabase, userId, club.id)",
    );
    expect(telegramWebhookSource).toContain("persistAutomatedOutboundMessage");
    expect(telegramWebhookSource).toContain("source: 'join_request_declined'");
    expect(telegramWebhookSource).toContain("message_origin: 'bot_automation'");
    expect(telegramChatSource).toContain('.from("telegram_access_audit")');
    expect(telegramChatSource).toContain('event_type === "JOIN_DECLINED"');
  });

  it("removes unresolved ManyChat name tokens without inventing a surname", () => {
    expect(sanitizeExternalDisplayName("Натікун {{last_name}}")).toBe("Натікун");
    expect(sanitizeExternalDisplayName("{{first_name}} {{last_name}}")).toBeNull();
    expect(sanitizeExternalDisplayName("Наталия")).toBe("Наталия");
    expect(manychatInboundSource).toContain("sanitizeDisplayName(pickString(");
  });
});
