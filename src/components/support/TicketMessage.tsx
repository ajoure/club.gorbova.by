import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { User, Headset, Bot, Lock, SmilePlus } from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TicketMessage as TicketMessageType } from "@/hooks/useTickets";
import type { ReactionGroup } from "@/hooks/useTicketReactions";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "👎"];

interface TicketMessageProps {
  message: TicketMessageType;
  isCurrentUser?: boolean;
  reactions?: ReactionGroup[];
  onToggleReaction?: (emoji: string) => void;
}

export function TicketMessage({ message, isCurrentUser, reactions, onToggleReaction }: TicketMessageProps) {
  const isSystem = message.author_type === "system";
  const isSupport = message.author_type === "support";
  const [pickerOpen, setPickerOpen] = useState(false);

  if (isSystem) {
    return (
      <div className="flex justify-center my-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
          <Bot className="h-3 w-3" />
          <span>{message.message}</span>
          <span>•</span>
          <span>
            {format(new Date(message.created_at), "HH:mm", { locale: ru })}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex gap-3 mb-4 group/msg",
        isCurrentUser && "flex-row-reverse"
      )}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className={cn(
          isSupport 
            ? "bg-primary text-primary-foreground" 
            : "bg-secondary"
        )}>
          {isSupport ? (
            <Headset className="h-4 w-4" />
          ) : (
            <User className="h-4 w-4" />
          )}
        </AvatarFallback>
      </Avatar>

      <div className={cn("flex flex-col max-w-[75%]", isCurrentUser && "items-end")}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium">
            {isSupport ? "Поддержка" : message.author_name || "Вы"}
          </span>
          {message.is_internal && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />
              Внутреннее
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {format(new Date(message.created_at), "d MMM, HH:mm", { locale: ru })}
          </span>
        </div>

        <div className="relative">
          <div
            className={cn(
              "rounded-lg px-4 py-2.5",
              isCurrentUser
                ? "bg-primary text-primary-foreground"
                : message.is_internal
                ? "bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900"
                : "bg-muted"
            )}
          >
            <p className="text-sm whitespace-pre-wrap">{message.message}</p>
          </div>

          {/* Emoji picker trigger — appears on hover */}
          {onToggleReaction && (
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "absolute -bottom-2 opacity-0 group-hover/msg:opacity-100 transition-opacity",
                    "h-6 w-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center hover:bg-accent",
                    isCurrentUser ? "left-0" : "right-0"
                  )}
                >
                  <SmilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-1.5" side="top" align="center">
                <div className="flex gap-1">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        onToggleReaction(emoji);
                        setPickerOpen(false);
                      }}
                      className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent text-base transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        {/* Reactions display */}
        {reactions && reactions.length > 0 && (
          <div className={cn("flex flex-wrap gap-1 mt-1", isCurrentUser && "justify-end")}>
            {reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onToggleReaction?.(r.emoji)}
                className={cn(
                  "inline-flex items-center gap-1 h-6 px-1.5 rounded-full text-xs border transition-colors",
                  r.userReacted
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-muted border-border hover:bg-accent"
                )}
              >
                <span>{r.emoji}</span>
                <span className="font-medium">{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {message.attachments.map((url, index) => (
              <a
                key={index}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline"
              >
                📎 Вложение {index + 1}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
