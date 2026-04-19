import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Instagram, AlertCircle, Clock, Loader2, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { resolveInstagramSourceLabel } from "@/lib/resolveInstagramSourceLabel";
import { InstagramMessageMedia, isMediaUrl, guessMediaTypeFromUrl } from "./InstagramMessageMedia";
import { InstagramAttachComposer } from "./InstagramAttachComposer";

interface Message {
  id: string;
  external_message_id: string;
  sender_id: string;
  sender_name: string | null;
  peer_id: string;
  sent_by_admin: string | null;
  recipient_id: string | null;
  direction: "inbound" | "outbound";
  message_text: string | null;
  media_url: string | null;
  media_type: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface ContactInstagramChatProps {
  accountId: string;
  senderId: string;
  threadId: string | null;
  senderName: string;
  avatarUrl?: string | null;
  accountName?: string | null;
  onBack?: () => void;
}

export function ContactInstagramChat({
  accountId,
  senderId,
  threadId,
  senderName,
  avatarUrl,
  accountName,
  onBack,
}: ContactInstagramChatProps) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["instagram-chat", accountId, senderId, threadId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("instagram-admin-chat", {
        body: {
          action: "get_history",
          instagram_account_id: accountId,
          sender_id: senderId,
          thread_id: threadId,
          limit: 100,
        },
      });
      if (error) throw error;
      return (data.messages || []) as Message[];
    },
    refetchInterval: 10000,
  });

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`ig-chat-rt:${accountId}:${senderId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "instagram_messages",
          filter: `instagram_account_id=eq.${accountId}`,
        },
        (payload) => {
          const msg = payload.new as any;
          if (msg?.peer_id === senderId) {
            queryClient.invalidateQueries({ queryKey: ["instagram-chat", accountId, senderId, threadId] });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "instagram_messages",
          filter: `instagram_account_id=eq.${accountId}`,
        },
        (payload) => {
          const msg = payload.new as any;
          if (msg?.peer_id === senderId) {
            queryClient.invalidateQueries({ queryKey: ["instagram-chat", accountId, senderId, threadId] });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [accountId, senderId, threadId, queryClient]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!message.trim() || sending) return;
    setSending(true);

    try {
      const clientMsgId = crypto.randomUUID();
      const { data, error } = await supabase.functions.invoke("instagram-admin-chat", {
        body: {
          action: "send_reply",
          instagram_account_id: accountId,
          sender_id: senderId,
          thread_id: threadId,
          message_text: message.trim(),
          client_msg_id: clientMsgId,
        },
      });

      if (error) {
        toast.error("Ошибка отправки: " + error.message);
        return;
      }

      if (data?.ok === false) {
        toast.error(data.error || "Ошибка отправки");
      } else {
        setMessage("");
        queryClient.invalidateQueries({ queryKey: ["instagram-chat", accountId, senderId, threadId] });
        queryClient.invalidateQueries({ queryKey: ["instagram-dialogs"] });
      }
    } catch (e: any) {
      toast.error("Ошибка: " + e.message);
    } finally {
      setSending(false);
    }
  };

  const renderStatusBadge = (msg: Message) => {
    if (msg.direction !== "outbound") return null;
    switch (msg.status) {
      case "queued":
        return (
          <span className="flex items-center gap-0.5 text-[10px] text-amber-500">
            <Clock className="h-3 w-3" /> В очереди
          </span>
        );
      case "sending":
        return (
          <span className="flex items-center gap-0.5 text-[10px] text-blue-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Отправляется
          </span>
        );
      case "failed": {
        // PATCH-10: никогда не показывать сырой provider-error в ленте.
        // Короткий пользовательский лейбл; полный текст — только в title для admin.
        const raw = msg.error_message || "";
        const isProviderTech = /manychat|http error|validation|fbsbx|graph\.facebook/i.test(raw);
        const userLabel = isProviderTech ? "Не доставлено" : (raw.slice(0, 40) || "Ошибка");
        return (
          <span
            className="flex items-center gap-0.5 text-[10px] text-destructive"
            title={raw || undefined}
          >
            <AlertCircle className="h-3 w-3" />
            {userLabel}
          </span>
        );
      }
      case "pending":
        return (
          <Badge variant="outline" className="text-[10px] h-4 px-1">
            Ожидает
          </Badge>
        );
      default:
        return null;
    }
  };

  // Check if media_url is actually an avatar (not a real attachment)
  // Webhook already filters avatars, but double-check here
  const isRealMedia = (msg: Message) => {
    if (!msg.media_url) return false;
    if (msg.media_type === 'avatar') return false;
    return true;
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="p-3 border-b border-border/20 bg-card/80 backdrop-blur flex items-center gap-3 shrink-0">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full shrink-0"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <Avatar className="h-10 w-10 ring-2 ring-border/20">
          <AvatarImage src={avatarUrl || undefined} />
          <AvatarFallback className="bg-gradient-to-br from-pink-500/20 to-purple-500/20 text-sm font-semibold">
            {senderName[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{senderName}</p>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1 truncate">
            <Instagram className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {resolveInstagramSourceLabel({ display_name: accountName, account_name: accountName })}
            </span>
          </p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <p className="text-center text-xs text-muted-foreground">Загрузка...</p>
        ) : !messages?.length ? (
          <p className="text-center text-xs text-muted-foreground">Нет сообщений</p>
        ) : (
          messages.map((msg) => {
            // P5/P6: media resolution с legacy repair на render-layer.
            // Если media_url пуст, но message_text — это URL вложения (legacy записи),
            // лечим прямо здесь, БЕЗ изменения БД.
            const realMediaUrl =
              msg.media_url && msg.media_type !== 'avatar'
                ? msg.media_url
                : (msg.message_text && isMediaUrl(msg.message_text) ? msg.message_text : null);
            const realMediaType = realMediaUrl
              ? (msg.media_type && msg.media_type !== 'avatar'
                  ? msg.media_type
                  : guessMediaTypeFromUrl(realMediaUrl))
              : null;
            // Если text — это media URL и мы его отрендерим как media, не показываем как текст.
            const showText = msg.message_text && msg.message_text !== realMediaUrl;

            return (
              <div
                key={msg.id}
                className={cn(
                  "max-w-[75%] flex flex-col",
                  msg.direction === "outbound" ? "ml-auto items-end" : "mr-auto items-start",
                )}
              >
                {realMediaUrl && (
                  <InstagramMessageMedia url={realMediaUrl} type={realMediaType} messageId={msg.id} />
                )}
                {showText && (
                  <div
                    className={cn(
                      "rounded-2xl px-3 py-2",
                      realMediaUrl && "mt-1",
                      msg.direction === "outbound"
                        ? "bg-primary/10 border border-primary/20"
                        : "bg-muted/50 border border-border/30",
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.message_text}</p>
                  </div>
                )}
                <div
                  className={cn(
                    "flex items-center gap-2 mt-1 px-1",
                    msg.direction === "outbound" ? "justify-end" : "justify-start",
                  )}
                >
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(msg.created_at), "HH:mm", { locale: ru })}
                  </span>
                  {renderStatusBadge(msg)}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border/20 shrink-0">
        <InstagramAttachComposer
          accountId={accountId}
          senderId={senderId}
          threadId={threadId}
          text={message}
          onTextChange={setMessage}
          onSendText={handleSend}
          sending={sending}
          onMediaSent={() => {
            queryClient.invalidateQueries({ queryKey: ["instagram-chat", accountId, senderId, threadId] });
            queryClient.invalidateQueries({ queryKey: ["instagram-dialogs"] });
          }}
        />
      </div>
    </div>
  );
}
