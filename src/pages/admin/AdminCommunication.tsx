// Cache bust v4
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Send, LifeBuoy, Inbox, Settings, ChevronDown, MessageSquare, Mail, Instagram } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Import tab contents
import { SupportTabContent } from "@/components/admin/communication/SupportTabContent";
import { BroadcastsTabContent } from "@/components/admin/communication/BroadcastsTabContent";
import { InboxTabContent } from "@/components/admin/communication/InboxTabContent";
import { CommunicationSettingsTabContent } from "@/components/admin/communication/CommunicationSettingsTabContent";

// Import unread hooks
import { useUnreadMessagesCount } from "@/hooks/useUnreadMessagesCount";
import { useUnreadEmailCount } from "@/hooks/useEmailInbox";
import { useUnreadTicketsCount } from "@/hooks/useUnreadTicketsCount";

const tabs = [
  { id: "inbox", label: "Сообщения", icon: Inbox },
  { id: "broadcasts", label: "Рассылки", icon: Send },
  { id: "settings", label: "Настройки", icon: Settings },
];

export default function AdminCommunication() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(searchParams.get("tab") || "inbox");
  const [inboxChannel, setInboxChannel] = useState<"telegram" | "email" | "support" | "instagram">("telegram");

  // Unread counts for badges
  const telegramUnread = useUnreadMessagesCount();
  const { data: emailUnread = 0 } = useUnreadEmailCount();
  const ticketsUnread = useUnreadTicketsCount();

  const inboxUnread = telegramUnread + emailUnread + ticketsUnread;

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
    
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [searchParams]);

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
            {tabs.map((tab) => {
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
                      <DropdownMenuItem 
                        onClick={() => { handleTabChange("inbox"); setInboxChannel("telegram"); }}
                        className={cn(
                          "flex items-center gap-2 text-xs cursor-pointer rounded-md",
                          inboxChannel === "telegram" && activeTab === "inbox" && "bg-muted"
                        )}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Telegram
                        {telegramUnread > 0 && (
                          <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] rounded-full bg-primary text-primary-foreground">
                            {telegramUnread}
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
                        {ticketsUnread > 0 && (
                          <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] rounded-full bg-orange-500 text-white">
                            {ticketsUnread}
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
          {activeTab === "inbox" && <InboxTabContent defaultChannel={inboxChannel} />}
          {activeTab === "broadcasts" && <BroadcastsTabContent />}
          {activeTab === "settings" && <CommunicationSettingsTabContent />}
        </div>
      </div>
    </AdminLayout>
  );
}