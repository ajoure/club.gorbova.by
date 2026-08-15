// Cache bust v4
import { lazy, Suspense, useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Send, LifeBuoy, Inbox, Settings, ChevronDown, MessageSquare, Mail, Instagram, Layers, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { useUnifiedInboxFlag } from "@/hooks/useContactCenterFeatureFlag";

// Import unread hooks
import { useUnreadMessagesCount } from "@/hooks/useUnreadMessagesCount";
import { useUnreadEmailCount } from "@/hooks/useEmailInbox";
import { useUnreadTicketsCount } from "@/hooks/useUnreadTicketsCount";
import type { UnifiedInboxCounts } from "@/hooks/useUnifiedInbox";
import { CONTACT_CENTER_VISIBLE_UNREAD_QK } from "@/constants/inboxQueryKeys";
import { useAdminAccess } from "@/hooks/useAdminAccess";

const InboxTabContent = lazy(() =>
  import("@/components/admin/communication/InboxTabContent").then((module) => ({
    default: module.InboxTabContent,
  })),
);
const UnifiedInboxView = lazy(() =>
  import("@/components/admin/communication/unified/UnifiedInboxView").then((module) => ({
    default: module.UnifiedInboxView,
  })),
);
const BroadcastsTabContent = lazy(() =>
  import("@/components/admin/communication/BroadcastsTabContent").then((module) => ({
    default: module.BroadcastsTabContent,
  })),
);
const CommunicationSettingsTabContent = lazy(() =>
  import("@/components/admin/communication/CommunicationSettingsTabContent").then((module) => ({
    default: module.CommunicationSettingsTabContent,
  })),
);

function ContactCenterPanelFallback() {
  return (
    <div className="h-full flex items-center justify-center text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" aria-label="Загрузка контакт-центра" />
    </div>
  );
}

const tabs = [
  { id: "inbox", label: "Сообщения", icon: Inbox },
  { id: "broadcasts", label: "Рассылки", icon: Send },
  { id: "settings", label: "Настройки", icon: Settings },
];

export default function AdminCommunication() {
  const queryClient = useQueryClient();
  const access = useAdminAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const visibleTabs = useMemo(
    () => tabs.filter((tab) => access.canAccessResource("communication", tab.id)),
    [access],
  );
  // Единая лента опубликована для всех сотрудников с доступом к контакт-центру.
  // Доступ по-прежнему ограничивают маршрут, RPC и RLS; frontend-флаг отвечает
  // только за выбор нового интерфейса.
  const [unifiedEnabled] = useUnifiedInboxFlag();
  const [activeTab, setActiveTab] = useState<string>(searchParams.get("tab") || "inbox");
  const [inboxChannel, setInboxChannel] = useState<"all" | "telegram" | "email" | "support" | "instagram">(
    unifiedEnabled ? "all" : "telegram",
  );

  // Если unified внезапно отключился (kill-switch / потеря роли), а пользователь был в «Все» —
  // мягко переключаем на Telegram, чтобы не оставлять UI в невалидном состоянии.
  useEffect(() => {
    if (!unifiedEnabled && inboxChannel === "all") {
      setInboxChannel("telegram");
    }
  }, [unifiedEnabled, inboxChannel]);

  // Unread counts for badges
  const telegramUnread = useUnreadMessagesCount();
  const { data: emailUnread = 0 } = useUnreadEmailCount();
  const ticketsUnread = useUnreadTicketsCount();

  const [unifiedCounts, setUnifiedCounts] = useState<UnifiedInboxCounts | null>(null);
  const telegramBadgeUnread = unifiedEnabled && unifiedCounts
    ? unifiedCounts.telegramUnread
    : telegramUnread;
  const supportBadgeUnread = unifiedEnabled && unifiedCounts
    ? unifiedCounts.supportUnread
    : ticketsUnread;
  const instagramBadgeUnread = unifiedEnabled && unifiedCounts
    ? unifiedCounts.instagramUnread
    : 0;

  const inboxUnread = unifiedEnabled && unifiedCounts
    ? unifiedCounts.totalUnread + emailUnread
    : telegramUnread + emailUnread + ticketsUnread;
  const unifiedSourceFilter = inboxChannel === "email" ? "all" : inboxChannel;

  // The global sidebar used to show a raw Telegram-dialog total while the
  // unified contact center rendered canonical contact cards. Publish the
  // visible total into React Query so both badges describe the same queue.
  useEffect(() => {
    if (!unifiedEnabled || !unifiedCounts) return;
    queryClient.setQueryData(CONTACT_CENTER_VISIBLE_UNREAD_QK, inboxUnread);
  }, [emailUnread, inboxUnread, queryClient, unifiedCounts, unifiedEnabled]);

  // Sync tab with URL - handle legacy "support" tab redirect
  useEffect(() => {
    const tabFromUrl = searchParams.get("tab");
    
    // Redirect legacy "support" tab to inbox with support channel
    if (tabFromUrl === "support") {
      setActiveTab("inbox");
      setInboxChannel("support");
      setSearchParams({ tab: "inbox" }, { replace: true });
      return;
    }
    
    if (tabFromUrl && visibleTabs.some((tab) => tab.id === tabFromUrl) && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    } else if (!visibleTabs.some((tab) => tab.id === activeTab) && visibleTabs[0]) {
      setActiveTab(visibleTabs[0].id);
      setSearchParams({ tab: visibleTabs[0].id }, { replace: true });
    }
  }, [activeTab, searchParams, setSearchParams, visibleTabs]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const getUnreadCount = (tabId: string) => {
    switch (tabId) {
      case "inbox": return inboxUnread;
      default: return 0;
    }
  };

  return (
    <AdminLayout fullHeight>
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        {/* Compact Glass Tabs - Bitrix24 style */}
        <div className="px-3 md:px-4 pt-1 pb-1.5 shrink-0">
          <div className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const unread = getUnreadCount(tab.id);
              const isActive = activeTab === tab.id;
              
              // Dropdown for "Сообщения" tab
              if (tab.id === "inbox") {
                return (
                  <DropdownMenu key={tab.id}>
                    <DropdownMenuTrigger asChild>
                      <button
                        className={cn(
                          "relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200",
                          isActive 
                            ? "bg-background text-foreground shadow-sm" 
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{tab.label}</span>
                        <ChevronDown className="h-3 w-3 opacity-60" />
                        {unread > 0 && (
                          <Badge className="h-4 min-w-4 px-1 text-[10px] font-semibold rounded-full bg-primary text-primary-foreground">
                            {unread > 99 ? "99+" : unread}
                          </Badge>
                        )}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent 
                      align="start"
                      className="min-w-[160px] bg-background/80 backdrop-blur-xl border border-border/30 shadow-lg rounded-lg"
                    >
                      {unifiedEnabled && (
                        <DropdownMenuItem 
                          onClick={() => { handleTabChange("inbox"); setInboxChannel("all"); }}
                          className={cn(
                            "flex items-center gap-2 text-xs cursor-pointer rounded-md",
                            inboxChannel === "all" && activeTab === "inbox" && "bg-muted"
                          )}
                        >
                          <Layers className="h-3.5 w-3.5" />
                          Все
                          {inboxUnread > 0 && (
                            <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] rounded-full bg-primary text-primary-foreground">
                              {inboxUnread}
                            </Badge>
                          )}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem 
                        onClick={() => { handleTabChange("inbox"); setInboxChannel("telegram"); }}
                        className={cn(
                          "flex items-center gap-2 text-xs cursor-pointer rounded-md",
                          inboxChannel === "telegram" && activeTab === "inbox" && "bg-muted"
                        )}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Telegram
                        {telegramBadgeUnread > 0 && (
                          <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] rounded-full bg-primary text-primary-foreground">
                            {telegramBadgeUnread}
                          </Badge>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => { handleTabChange("inbox"); setInboxChannel("email"); }}
                        className={cn(
                          "flex items-center gap-2 text-xs cursor-pointer rounded-md",
                          inboxChannel === "email" && activeTab === "inbox" && "bg-muted"
                        )}
                      >
                        <Mail className="h-3.5 w-3.5" />
                        Email
                        {emailUnread > 0 && (
                          <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] rounded-full bg-primary text-primary-foreground">
                            {emailUnread}
                          </Badge>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => { handleTabChange("inbox"); setInboxChannel("support"); }}
                        className={cn(
                          "flex items-center gap-2 text-xs cursor-pointer rounded-md",
                          inboxChannel === "support" && activeTab === "inbox" && "bg-muted"
                        )}
                      >
                        <LifeBuoy className="h-3.5 w-3.5" />
                        Техподдержка
                        {supportBadgeUnread > 0 && (
                          <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] rounded-full bg-orange-500 text-white">
                            {supportBadgeUnread}
                          </Badge>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => { handleTabChange("inbox"); setInboxChannel("instagram"); }}
                        className={cn(
                          "flex items-center gap-2 text-xs cursor-pointer rounded-md",
                          inboxChannel === "instagram" && activeTab === "inbox" && "bg-muted"
                        )}
                      >
                        <Instagram className="h-3.5 w-3.5" />
                        Instagram
                        {instagramBadgeUnread > 0 && (
                          <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] rounded-full bg-primary text-primary-foreground">
                            {instagramBadgeUnread}
                          </Badge>
                        )}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              }
              
              // Regular tabs
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={cn(
                    "relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200",
                    isActive 
                      ? "bg-background text-foreground shadow-sm" 
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {unread > 0 && (
                    <Badge 
                      className={cn(
                        "h-4 min-w-4 px-1 text-[10px] font-semibold rounded-full",
                        tab.id === "support" 
                          ? "bg-orange-500 text-white" 
                          : "bg-primary text-primary-foreground"
                      )}
                    >
                      {unread > 99 ? "99+" : unread}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <Suspense fallback={<ContactCenterPanelFallback />}>
            {activeTab === "inbox" && (
              unifiedEnabled && inboxChannel !== "email"
                ? (
                  <UnifiedInboxView
                    sourceFilter={unifiedSourceFilter}
                    onCountsChange={setUnifiedCounts}
                    deepLinkTelegramUserId={searchParams.get("chat")}
                  />
                )
                : (
                  <InboxTabContent
                    defaultChannel={inboxChannel === "all" ? "telegram" : inboxChannel}
                    deepLinkTelegramUserId={searchParams.get("chat")}
                  />
                )
            )}
            {activeTab === "broadcasts" && <BroadcastsTabContent />}
            {activeTab === "settings" && <CommunicationSettingsTabContent />}
          </Suspense>
        </div>
      </div>
    </AdminLayout>
  );
}
