import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";
import { SwipeableDialogCard } from "@/components/admin/communication/SwipeableDialogCard";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ContactInstagramChat } from "./ContactInstagramChat";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Instagram, Search, MessageSquare, ArrowLeft, RefreshCw, Check, Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { resolveInstagramAccountDisplayName } from "@/lib/resolveInstagramSourceLabel";

interface InstagramDialog {
  thread_key: string;
  peer_id: string;
  sender_id: string;
  sender_name: string | null;
  ig_thread_id: string | null;
  last_message: string | null;
  last_media_url: string | null;
  last_direction: string;
  last_at: string;
  unread_count: number;
  instagram_username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  profile_id: string | null;
  account_name: string | null;
  integration_instance_id: string | null;
  is_pinned?: boolean;
  pinned_at?: string | null;
}

const IG_PANEL_SIZE_KEY = "ig-panel-sizes";
const IG_ACTIVE_ACCOUNT_KEY = "ig-active-account";

export function InstagramInboxView() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDialog, setSelectedDialog] = useState<InstagramDialog | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const parentRef = useRef<HTMLDivElement>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(() => {
    try { return localStorage.getItem(IG_ACTIVE_ACCOUNT_KEY); } catch { return null; }
  });

  const [savedPanelSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(IG_PANEL_SIZE_KEY);
      if (saved) return JSON.parse(saved).left || 40;
    } catch {}
    return 40;
  });

  const handlePanelResize = (sizes: number[]) => {
    try {
      localStorage.setItem(IG_PANEL_SIZE_KEY, JSON.stringify({ left: sizes[0] }));
    } catch {}
  };

  const { data: accounts } = useQuery({
    queryKey: ["instagram-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("instagram-admin-chat", {
        body: { action: "get_accounts" },
      });
      if (error) throw error;
      // Filter to active accounts only
      const all = (data.accounts || []) as Array<{ id: string; is_active?: boolean; status?: string; instagram_page_id?: string }>;
      return all.filter(a => a.is_active !== false && a.status !== 'error');
    },
  });

  // Resolve active account: saved → first active → null
  const activeAccountId = useMemo(() => {
    if (!accounts || accounts.length === 0) return null;
    // Check if saved selection is still valid
    if (selectedAccountId && accounts.some(a => a.id === selectedAccountId)) {
      return selectedAccountId;
    }
    // Fallback to first active
    return accounts[0]?.id || null;
  }, [accounts, selectedAccountId]);

  const handleAccountChange = useCallback((accountId: string) => {
    setSelectedAccountId(accountId);
    setSelectedDialog(null);
    try { localStorage.setItem(IG_ACTIVE_ACCOUNT_KEY, accountId); } catch {}
  }, []);

  const { data: dialogs, isLoading } = useQuery({
    queryKey: ["instagram-dialogs", activeAccountId],
    queryFn: async () => {
      if (!activeAccountId) return [];
      const { data, error } = await supabase.rpc("get_instagram_dialogs_v1", {
        p_account_id: activeAccountId,
      });
      if (error) throw error;
      return (data || []) as unknown as InstagramDialog[];
    },
    enabled: !!activeAccountId,
    refetchInterval: 15000,
  });

  // Realtime
  useEffect(() => {
    if (!activeAccountId) return;
    const channel = supabase
      .channel(`instagram-messages-rt:${activeAccountId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "instagram_messages",
          filter: `instagram_account_id=eq.${activeAccountId}`,
        },
        (payload) => {
          const msg = payload.new as any;
          if (msg.instagram_account_id === activeAccountId) {
            queryClient.invalidateQueries({ queryKey: ["instagram-dialogs", activeAccountId] });
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeAccountId, queryClient]);

  const filteredDialogs = useMemo(() => {
    if (!dialogs) return [];
    // FIX-4 + PATCH: расширенный фильтр synthetic / test probe / smoke контактов.
    let list = dialogs.filter((d) => {
      const name = (d.sender_name || d.full_name || "").toLowerCase();
      const peer = (d.peer_id || "").toLowerCase();
      if (name.includes("webhook test probe")) return false;
      if (name.includes("smoke test")) return false;
      if (peer.startsWith("test_")) return false;
      if (peer.startsWith("smoke_")) return false;
      return true;
    });
    if (filter === "unread") {
      list = list.filter((d) => d.unread_count > 0);
    }
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (d) =>
        (d.full_name || "").toLowerCase().includes(q) ||
        (d.sender_name || "").toLowerCase().includes(q) ||
        (d.instagram_username || "").toLowerCase().includes(q) ||
        (d.last_message || "").toLowerCase().includes(q)
    );
  }, [dialogs, searchQuery, filter]);

  const totalUnread = useMemo(() => (dialogs || []).reduce((s, d) => s + d.unread_count, 0), [dialogs]);

  const virtualizer = useVirtualizer({
    count: filteredDialogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 68,
    overscan: 5,
  });

  const handleSelectDialog = useCallback(
    (dialog: InstagramDialog) => {
      setSelectedDialog(dialog);
      if (dialog.unread_count > 0 && activeAccountId) {
        supabase.functions.invoke("instagram-admin-chat", {
          body: {
            action: "mark_read",
            instagram_account_id: activeAccountId,
            sender_id: dialog.peer_id,
            thread_id: dialog.ig_thread_id,
          },
        }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["instagram-dialogs", activeAccountId] });
        });
      }
    },
    [activeAccountId, queryClient]
  );

  const markChatAsRead = useCallback(
    (peerId: string) => {
      if (!activeAccountId) return;
      const dialog = dialogs?.find((d) => d.peer_id === peerId);
      supabase.functions.invoke("instagram-admin-chat", {
        body: {
          action: "mark_read",
          instagram_account_id: activeAccountId,
          sender_id: peerId,
          thread_id: dialog?.ig_thread_id || null,
        },
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["instagram-dialogs", activeAccountId] });
      });
    },
    [activeAccountId, dialogs, queryClient]
  );

  const togglePin = useCallback(
    async (dialog: InstagramDialog) => {
      if (!activeAccountId) return;
      const { data: userRes } = await supabase.auth.getUser();
      const adminId = userRes.user?.id;
      if (!adminId) {
        toast.error("Не удалось определить администратора");
        return;
      }
      const wasPinned = !!dialog.is_pinned;
      const nextPinned = !wasPinned;
      const { error } = await supabase
        .from("instagram_dialog_preferences")
        .upsert(
          {
            admin_user_id: adminId,
            instagram_account_id: activeAccountId,
            thread_key: dialog.thread_key,
            is_pinned: nextPinned,
            pinned_at: nextPinned ? new Date().toISOString() : null,
          },
          { onConflict: "admin_user_id,instagram_account_id,thread_key" },
        );
      if (error) {
        toast.error(`Не удалось ${wasPinned ? "открепить" : "закрепить"} диалог`);
        return;
      }
      toast.success(nextPinned ? "Диалог закреплён" : "Диалог откреплён");
      queryClient.invalidateQueries({ queryKey: ["instagram-dialogs", activeAccountId] });
    },
    [activeAccountId, queryClient],
  );


  const getDisplayName = (d: InstagramDialog) =>
    d.full_name || d.sender_name || d.instagram_username || d.peer_id;

  if (!accounts || accounts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center">
        <div>
          <Instagram className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="font-medium text-muted-foreground">Instagram не подключён</p>
          <p className="text-xs text-muted-foreground mt-1">
            Перейдите в Интеграции → Соцсети, чтобы подключить Instagram DM.
          </p>
        </div>
      </div>
    );
  }

  // --- Dialog list content ---
  const dialogListContent = (
    <>
      <div className="p-3 border-b border-border/20 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <Instagram className="h-4 w-4 text-pink-500" />
          <h3 className="text-sm font-semibold">Instagram</h3>
          {totalUnread > 0 && (
            <Badge className="bg-pink-500 text-white text-[10px] h-4 min-w-4 px-1 rounded-full">
              {totalUnread}
            </Badge>
          )}
        </div>
        {accounts && accounts.length > 1 && (
          <Select value={activeAccountId || ''} onValueChange={handleAccountChange}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Аккаунт" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((acc: any) => {
                const label =
                  resolveInstagramAccountDisplayName(acc) ||
                  "Instagram Direct";
                return (
                  <SelectItem key={acc.id} value={acc.id} className="text-xs">
                    {label}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Поиск..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          {(["all", "unread"] as const).map((f) => (
            <Button
              key={f}
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 text-xs rounded-full px-3",
                filter === f
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-card/60 text-muted-foreground"
              )}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "Все" : "Непрочитанные"}
              {f === "unread" && totalUnread > 0 && (
                <span className="ml-1 text-[10px]">({totalUnread})</span>
              )}
            </Button>
          ))}
        </div>
      </div>

      <div ref={parentRef} className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
            <span className="text-sm">Загрузка...</span>
          </div>
        ) : filteredDialogs.length === 0 ? (
          <div className="p-8 text-center">
            <MessageSquare className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              {searchQuery ? "Ничего не найдено" : "Нет диалогов"}
            </p>
          </div>
        ) : (
          <div
            className="relative p-1.5"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const dialog = filteredDialogs[virtualRow.index];
              const displayName = getDisplayName(dialog);
              return (
                <div
                  key={dialog.thread_key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full px-1.5"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <SwipeableDialogCard
                    onSwipeRight={dialog.unread_count > 0 ? () => markChatAsRead(dialog.peer_id) : undefined}
                    onClick={() => handleSelectDialog(dialog)}
                    className={cn(
                      "group relative grid grid-cols-[auto_1fr_24px] items-start gap-1.5 p-1.5 cursor-pointer rounded-lg border transition-colors duration-200",
                      selectedDialog?.thread_key === dialog.thread_key
                        ? "bg-primary/10 border-primary"
                        : "border-transparent hover:bg-muted/40"
                    )}
                  >
                    <div className="relative shrink-0">
                      <Avatar className="h-8 w-8 ring-1 ring-border/20">
                        <AvatarImage src={dialog.avatar_url || undefined} />
                        <AvatarFallback className="bg-gradient-to-br from-pink-500/20 to-purple-500/20 text-xs font-semibold">
                          {displayName[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {dialog.unread_count > 0 && (
                        <div className="absolute -top-0.5 -right-0.5 h-5 min-w-5 px-1 flex items-center justify-center rounded-full bg-pink-500 text-white text-[10px] font-bold shadow-lg">
                          {dialog.unread_count > 99 ? "99+" : dialog.unread_count}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-semibold truncate flex-1 min-w-0 whitespace-nowrap">
                          {displayName}
                        </span>
                        {(() => {
                          const label = resolveInstagramAccountDisplayName({
                            account_name: dialog.account_name,
                          });
                          if (!label) return null;
                          return (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 shrink-0 font-normal text-muted-foreground border-border/40 whitespace-nowrap max-w-[100px] truncate">
                              {label}
                            </Badge>
                          );
                        })()}
                        <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
                          {formatDistanceToNow(new Date(dialog.last_at), { addSuffix: false, locale: ru })}
                        </span>
                      </div>
                      <p className={cn(
                        "text-xs line-clamp-2 break-words mt-0.5 min-w-0",
                        dialog.unread_count > 0
                          ? "text-foreground font-medium"
                          : "text-muted-foreground"
                      )}>
                        {dialog.last_direction === "outbound" && "Вы: "}
                        {dialog.last_message || (dialog.last_media_url ? "📷 Медиа" : "...")}
                      </p>
                    </div>
                    {/* Quick action: mark read */}
                    <div className="self-stretch flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
                      <button
                        type="button"
                        disabled={dialog.unread_count === 0}
                        className={cn(
                          "h-6 w-6 rounded-md flex items-center justify-center transition-colors",
                          dialog.unread_count > 0
                            ? "hover:bg-primary/15"
                            : "opacity-40 cursor-not-allowed"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (dialog.unread_count > 0) markChatAsRead(dialog.peer_id);
                        }}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </SwipeableDialogCard>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  // --- Chat panel content ---
  const chatPanelContent = selectedDialog && activeAccountId ? (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <ContactInstagramChat
        accountId={activeAccountId}
        senderId={selectedDialog.peer_id}
        threadId={selectedDialog.ig_thread_id}
        senderName={getDisplayName(selectedDialog)}
        avatarUrl={selectedDialog.avatar_url}
        accountName={selectedDialog.account_name}
        onBack={isMobile ? () => setSelectedDialog(null) : undefined}
      />
    </div>
  ) : (
    <div className="h-full flex items-center justify-center text-center text-muted-foreground p-8">
      <div>
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500/10 to-purple-500/10 flex items-center justify-center mx-auto mb-4">
          <MessageSquare className="h-8 w-8 text-pink-500/50" />
        </div>
        <p className="font-medium">Выберите диалог</p>
        <p className="text-sm text-muted-foreground/70 mt-1">для просмотра сообщений</p>
      </div>
    </div>
  );

  // --- Layout: mobile toggle or desktop resizable ---
  if (isMobile) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        {!selectedDialog ? (
          <div className="flex flex-col h-full min-h-0">{dialogListContent}</div>
        ) : (
          chatPanelContent
        )}
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 h-full" onLayout={handlePanelResize}>
      <ResizablePanel
        defaultSize={savedPanelSize}
        minSize={15}
        maxSize={40}
        className="flex flex-col min-w-0"
      >
        {dialogListContent}
      </ResizablePanel>
      <ResizableHandle withHandle className="mx-1" />
      <ResizablePanel defaultSize={75} minSize={50} className="min-w-0 overflow-hidden">
        {chatPanelContent}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
