import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContactTelegramChat } from "@/components/admin/ContactTelegramChat";
import { 
  Search, 
  MessageSquare, 
  MailCheck, 
  MailQuestion,
  RefreshCw,
  ArrowLeft
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

interface Dialog {
  user_id: string;
  profile: {
    id: string;
    full_name: string | null;
    email: string | null;
    telegram_username: string | null;
    telegram_user_id: number | null;
    avatar_url: string | null;
  } | null;
  last_message: string;
  last_message_at: string;
  unread_count: number;
}

export default function AdminInbox() {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");

  // Fetch dialogs with unread counts
  const { data: dialogs = [], isLoading, refetch } = useQuery({
    queryKey: ["inbox-dialogs", filter],
    queryFn: async () => {
      // First get all unique user_ids from messages
      const { data: messages, error } = await supabase
        .from("telegram_messages")
        .select(`
          user_id,
          message_text,
          created_at,
          direction,
          is_read
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Group by user_id and get stats
      const dialogMap = new Map<string, {
        user_id: string;
        last_message: string;
        last_message_at: string;
        unread_count: number;
      }>();

      messages?.forEach((msg) => {
        if (!msg.user_id) return;
        
        const existing = dialogMap.get(msg.user_id);
        if (!existing) {
          dialogMap.set(msg.user_id, {
            user_id: msg.user_id,
            last_message: msg.message_text || "",
            last_message_at: msg.created_at,
            unread_count: msg.direction === "incoming" && !msg.is_read ? 1 : 0,
          });
        } else {
          if (msg.direction === "incoming" && !msg.is_read) {
            existing.unread_count++;
          }
        }
      });

      // Get profiles for all users - FIX: use user_id column instead of id
      const userIds = Array.from(dialogMap.keys());
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, email, telegram_username, telegram_user_id, avatar_url")
        .in("user_id", userIds);

      // Map by user_id field, not id
      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      // Combine and filter
      let result: Dialog[] = Array.from(dialogMap.values()).map(d => ({
        ...d,
        profile: profileMap.get(d.user_id) || null
      }));

      // Apply filter
      if (filter === "unread") {
        result = result.filter(d => d.unread_count > 0);
      } else if (filter === "read") {
        result = result.filter(d => d.unread_count === 0);
      }

      // Sort by last message date
      result.sort((a, b) => 
        new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      );

      return result;
    },
    refetchInterval: 30000,
  });

  // Get total unread count
  const totalUnread = dialogs.reduce((sum, d) => sum + d.unread_count, 0);

  // Mark messages as read when selecting a dialog
  const markAsRead = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("telegram_messages")
        .update({ is_read: true })
        .eq("user_id", userId)
        .eq("direction", "incoming")
        .eq("is_read", false);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-dialogs"] });
      queryClient.invalidateQueries({ queryKey: ["unread-messages-count"] });
    },
  });

  // Handle dialog selection
  const handleSelectDialog = (userId: string) => {
    setSelectedUserId(userId);
    markAsRead.mutate(userId);
  };

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel("inbox-messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "telegram_messages",
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  // Filter dialogs by search
  const filteredDialogs = dialogs.filter((dialog) => {
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return (
      dialog.profile?.full_name?.toLowerCase().includes(search) ||
      dialog.profile?.email?.toLowerCase().includes(search) ||
      dialog.profile?.telegram_username?.toLowerCase().includes(search) ||
      dialog.last_message?.toLowerCase().includes(search)
    );
  });

  const selectedDialog = dialogs.find(d => d.user_id === selectedUserId);

  return (
    <AdminLayout>
      <div className="flex h-[calc(100vh-8rem)] gap-4">
        {/* Dialog List */}
        <Card className={`${selectedUserId ? "hidden md:flex" : "flex"} flex-col w-full md:w-96 shrink-0`}>
          <CardHeader className="pb-3 space-y-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Входящие
                {totalUnread > 0 && (
                  <Badge variant="destructive">{totalUnread}</Badge>
                )}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => refetch()}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по имени или сообщению..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <TabsList className="w-full">
                <TabsTrigger value="all" className="flex-1">Все</TabsTrigger>
                <TabsTrigger value="unread" className="flex-1">
                  Непрочитанные
                  {totalUnread > 0 && (
                    <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">
                      {totalUnread}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="read" className="flex-1">Прочитанные</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>

          <CardContent className="flex-1 p-0 overflow-hidden">
            <ScrollArea className="h-full">
              {filteredDialogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  {filter === "unread" ? (
                    <>
                      <MailCheck className="h-12 w-12 mb-3 opacity-50" />
                      <p>Нет непрочитанных сообщений</p>
                    </>
                  ) : (
                    <>
                      <MailQuestion className="h-12 w-12 mb-3 opacity-50" />
                      <p>Нет сообщений</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="divide-y">
                  {filteredDialogs.map((dialog) => (
                    <button
                      key={dialog.user_id}
                      onClick={() => handleSelectDialog(dialog.user_id)}
                      className={`w-full p-4 flex items-start gap-3 hover:bg-muted/50 transition-colors text-left ${
                        selectedUserId === dialog.user_id ? "bg-muted" : ""
                      }`}
                    >
                      <Avatar className="h-10 w-10 shrink-0">
                        {dialog.profile?.avatar_url && (
                          <AvatarImage src={dialog.profile.avatar_url} alt={dialog.profile.full_name || ""} />
                        )}
                        <AvatarFallback>
                          {dialog.profile?.full_name?.[0]?.toUpperCase() || 
                           dialog.profile?.telegram_username?.[0]?.toUpperCase() || 
                           "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">
                            {dialog.profile?.full_name || 
                             dialog.profile?.telegram_username || 
                             dialog.profile?.email || 
                             "Неизвестный"}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {formatDistanceToNow(new Date(dialog.last_message_at), {
                              addSuffix: true,
                              locale: ru,
                            })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-sm text-muted-foreground truncate flex-1">
                            {dialog.last_message || "Нет сообщений"}
                          </p>
                          {dialog.unread_count > 0 && (
                            <Badge variant="destructive" className="h-5 min-w-5 px-1.5 shrink-0">
                              {dialog.unread_count}
                            </Badge>
                          )}
                        </div>
                        {dialog.profile?.telegram_username && (
                          <p className="text-xs text-muted-foreground mt-1">
                            @{dialog.profile.telegram_username}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Chat View */}
        <Card className={`${selectedUserId ? "flex" : "hidden md:flex"} flex-1 flex-col`}>
          {selectedUserId && selectedDialog ? (
            <>
              <CardHeader className="border-b pb-3">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    onClick={() => setSelectedUserId(null)}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <Avatar className="h-10 w-10">
                    {selectedDialog.profile?.avatar_url && (
                      <AvatarImage src={selectedDialog.profile.avatar_url} alt={selectedDialog.profile.full_name || ""} />
                    )}
                    <AvatarFallback>
                      {selectedDialog.profile?.full_name?.[0]?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle className="text-base">
                      {selectedDialog.profile?.full_name || 
                       selectedDialog.profile?.telegram_username || 
                       "Неизвестный"}
                    </CardTitle>
                    {selectedDialog.profile?.telegram_username && (
                      <p className="text-sm text-muted-foreground">
                        @{selectedDialog.profile.telegram_username}
                      </p>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 p-4 overflow-hidden">
                <ContactTelegramChat 
                  userId={selectedUserId} 
                  telegramUserId={selectedDialog.profile?.telegram_user_id || null}
                  telegramUsername={selectedDialog.profile?.telegram_username || null}
                  clientName={selectedDialog.profile?.full_name}
                  avatarUrl={selectedDialog.profile?.avatar_url}
                  onAvatarUpdated={() => refetch()}
                />
              </CardContent>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <MessageSquare className="h-16 w-16 mb-4 opacity-30" />
              <p className="text-lg">Выберите диалог</p>
              <p className="text-sm">для просмотра сообщений</p>
            </div>
          )}
        </Card>
      </div>
    </AdminLayout>
  );
}
