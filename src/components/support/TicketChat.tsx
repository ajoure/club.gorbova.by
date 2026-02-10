import { useState, useEffect, useRef, useMemo } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TicketMessage } from "./TicketMessage";
import { useTicketMessages, useSendMessage, useMarkTicketRead } from "@/hooks/useTickets";
import { useTicketReactions, useToggleReaction } from "@/hooks/useTicketReactions";
import { useAuth } from "@/contexts/AuthContext";

interface TicketChatProps {
  ticketId: string;
  isAdmin?: boolean;
  isClosed?: boolean;
  telegramUserId?: number | null;
  telegramBridgeEnabled?: boolean;
  onBridgeMessage?: (ticketMessageId: string) => void;
}

export function TicketChat({ ticketId, isAdmin, isClosed, telegramUserId, telegramBridgeEnabled, onBridgeMessage }: TicketChatProps) {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sendToTelegram, setSendToTelegram] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading } = useTicketMessages(ticketId, isAdmin);

  // Defense-in-depth: redundant render-level filter for non-admin views
  const visibleMessages = isAdmin ? messages : messages?.filter(m => !m.is_internal);
  
  // Reactions
  const messageIds = useMemo(
    () => visibleMessages?.map((m) => m.id) || [],
    [visibleMessages]
  );
  const { data: reactionsMap } = useTicketReactions(ticketId, messageIds);
  const toggleReaction = useToggleReaction(ticketId);

  const sendMessageMutation = useSendMessage();
  const markRead = useMarkTicketRead();

  // Mark ticket as read when opened
  useEffect(() => {
    if (ticketId) {
      markRead.mutate({ ticketId, isAdmin: !!isAdmin });
    }
  }, [ticketId, isAdmin]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages]);

  // Show TG checkbox only for admin when user has telegram and bridge is on
  const canBridgeToTelegram = isAdmin && telegramBridgeEnabled && telegramUserId;

  const handleSend = async () => {
    if (!message.trim()) return;

    const result = await sendMessageMutation.mutateAsync({
      ticket_id: ticketId,
      message: message.trim(),
      author_type: isAdmin ? "support" : "user",
      is_internal: isAdmin ? isInternal : false,
    });

    // Bridge to Telegram if checkbox checked & not internal
    if (canBridgeToTelegram && sendToTelegram && !isInternal && result?.id && onBridgeMessage) {
      onBridgeMessage(result.id);
    }

    setMessage("");
    setIsInternal(false);
    setSendToTelegram(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea ref={scrollRef} className="flex-1 p-4">
        {visibleMessages?.map((msg) => (
          <TicketMessage
            key={msg.id}
            message={msg}
            isCurrentUser={msg.author_id === user?.id && !isAdmin}
            reactions={reactionsMap?.[msg.id]}
            onToggleReaction={(emoji) =>
              toggleReaction.mutate({ messageId: msg.id, emoji })
            }
          />
        ))}
        {visibleMessages?.length === 0 && (
          <p className="text-center text-muted-foreground text-sm py-8">
            Пока нет сообщений
          </p>
        )}
      </ScrollArea>

      {!isClosed && (
        <div className="border-t p-4">
          {isAdmin && (
            <div className="flex items-center gap-4 mb-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="internal"
                  checked={isInternal}
                  onCheckedChange={(checked) => {
                    setIsInternal(checked as boolean);
                    if (checked) setSendToTelegram(false);
                  }}
                />
                <Label htmlFor="internal" className="text-sm text-muted-foreground">
                  Внутренняя заметка
                </Label>
              </div>
              {canBridgeToTelegram && !isInternal && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="send-telegram"
                    checked={sendToTelegram}
                    onCheckedChange={(checked) => setSendToTelegram(checked as boolean)}
                  />
                  <Label htmlFor="send-telegram" className="text-sm text-muted-foreground">
                    Отправить в Telegram
                  </Label>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isInternal ? "Внутренняя заметка..." : "Введите сообщение..."}
              className="min-h-[80px] resize-none"
            />
            <Button
              onClick={handleSend}
              disabled={!message.trim() || sendMessageMutation.isPending}
              size="icon"
              className="h-[80px] w-12"
            >
              {sendMessageMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {isClosed && (
        <div className="border-t p-4 bg-muted">
          <p className="text-center text-sm text-muted-foreground">
            Обращение закрыто. Создайте новое обращение, если у вас есть вопросы.
          </p>
        </div>
      )}
    </div>
  );
}
