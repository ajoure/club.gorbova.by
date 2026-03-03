import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Instagram, Search, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { ContactInstagramChat } from "./ContactInstagramChat";

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
  profile_id: string | null;
}

export function InstagramInboxView() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDialog, setSelectedDialog] = useState<InstagramDialog | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ["instagram-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("instagram-admin-chat", {
        body: { action: "get_accounts" },
      });
      if (error) throw error;
      return data.accounts || [];
    },
  });

  const activeAccountId = accounts?.[0]?.id;

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

  // PATCH-6: Realtime with filter by instagram_account_id + local guard
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

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeAccountId, queryClient]);

  const filteredDialogs = useMemo(() => {
    if (!dialogs) return [];
    if (!searchQuery) return dialogs;
    const q = searchQuery.toLowerCase();
    return dialogs.filter(
      (d) =>
        (d.sender_name || "").toLowerCase().includes(q) ||
        (d.instagram_username || "").toLowerCase().includes(q) ||
        (d.last_message || "").toLowerCase().includes(q)
    );
  }, [dialogs, searchQuery]);

  const totalUnread = useMemo(() => (dialogs || []).reduce((s, d) => s + d.unread_count, 0), [dialogs]);

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

  return (
    <div className="flex h-full min-h-0">
      {/* Dialog List */}
      <div className="w-80 border-r border-border/30 flex flex-col min-h-0">
        <div className="p-3 border-b border-border/20 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <Instagram className="h-4 w-4 text-pink-500" />
            <h3 className="text-sm font-semibold">Instagram</h3>
            {totalUnread > 0 && (
              <Badge className="bg-pink-500 text-white text-[10px] h-4 min-w-4 px-1 rounded-full">
                {totalUnread}
              </Badge>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Поиск..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-4 text-center text-xs text-muted-foreground">Загрузка...</div>
          ) : filteredDialogs.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              {searchQuery ? "Ничего не найдено" : "Нет диалогов"}
            </div>
          ) : (
            filteredDialogs.map((dialog) => (
              <button
                key={dialog.thread_key}
                onClick={() => handleSelectDialog(dialog)}
                className={cn(
                  "w-full text-left p-3 border-b border-border/10 hover:bg-muted/30 transition-colors",
                  selectedDialog?.thread_key === dialog.thread_key && "bg-muted/50"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="bg-gradient-to-br from-pink-500/20 to-purple-500/20 text-xs">
                      {(dialog.sender_name || dialog.instagram_username || "?")[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">
                        {dialog.sender_name || dialog.instagram_username || dialog.peer_id}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 ml-1">
                        {formatDistanceToNow(new Date(dialog.last_at), { addSuffix: true, locale: ru })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <p className="text-xs text-muted-foreground truncate">
                        {dialog.last_direction === "outbound" && "Вы: "}
                        {dialog.last_message || (dialog.last_media_url ? "📷 Медиа" : "...")}
                      </p>
                      {dialog.unread_count > 0 && (
                        <Badge className="bg-pink-500 text-white text-[10px] h-4 min-w-4 px-1 rounded-full ml-1 shrink-0">
                          {dialog.unread_count}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </ScrollArea>
      </div>

      {/* Chat Panel */}
      <div className="flex-1 min-w-0 flex flex-col">
        {selectedDialog && activeAccountId ? (
          <ContactInstagramChat
            accountId={activeAccountId}
            senderId={selectedDialog.peer_id}
            threadId={selectedDialog.ig_thread_id}
            senderName={selectedDialog.sender_name || selectedDialog.instagram_username || selectedDialog.peer_id}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Выберите диалог</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
