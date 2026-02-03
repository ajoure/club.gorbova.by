import { useState, useEffect, useRef } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TicketMessage } from "./TicketMessage";
import { useTicketMessages, useSendMessage, useMarkTicketRead } from "@/hooks/useTickets";
import { useAuth } from "@/contexts/AuthContext";

interface TicketChatProps {
  ticketId: string;
  isAdmin?: boolean;
  isClosed?: boolean;
}

export function TicketChat({ ticketId, isAdmin, isClosed }: TicketChatProps) {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading } = useTicketMessages(ticketId);
  const sendMessage = useSendMessage();
  const markRead = useMarkTicketRead();

  // Mark ticket as read when opened
  useEffect(() => {
    if (ticketId) {
      markRead.mutate({ ticketId, isAdmin: !!isAdmin });
    }
  }, [ticketId, isAdmin]);

  // Scroll to bottom on new messages (wrapped in rAF to prevent forced reflow)
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!message.trim()) return;

    await sendMessage.mutateAsync({
      ticket_id: ticketId,
      message: message.trim(),
      author_type: isAdmin ? "support" : "user",
      is_internal: isAdmin ? isInternal : false,
    });

    setMessage("");
    setIsInternal(false);
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
        {messages?.map((msg) => (
          <TicketMessage
            key={msg.id}
            message={msg}
            isCurrentUser={msg.author_id === user?.id && !isAdmin}
          />
        ))}
        {messages?.length === 0 && (
          <p className="text-center text-muted-foreground text-sm py-8">
            Пока нет сообщений
          </p>
        )}
      </ScrollArea>

      {!isClosed && (
        <div className="border-t p-4">
          {isAdmin && (
            <div className="flex items-center gap-2 mb-2">
              <Checkbox
                id="internal"
                checked={isInternal}
                onCheckedChange={(checked) => setIsInternal(checked as boolean)}
              />
              <Label htmlFor="internal" className="text-sm text-muted-foreground">
                Внутренняя заметка (не видна клиенту)
              </Label>
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
              disabled={!message.trim() || sendMessage.isPending}
              size="icon"
              className="h-[80px] w-12"
            >
              {sendMessage.isPending ? (
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
