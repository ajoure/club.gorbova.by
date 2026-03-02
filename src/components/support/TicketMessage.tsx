import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { User, Headset, Bot, Lock, SmilePlus, Pencil, Trash2, Check, X } from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { TicketMessage as TicketMessageType, TicketAttachment } from "@/hooks/useTickets";
import type { ReactionGroup } from "@/hooks/useTicketReactions";
import { useSignedAttachments } from "@/hooks/useSignedAttachments";
import { ChatMediaMessage } from "@/components/admin/chat/ChatMediaMessage";

const EMOJI_LIST = [
  "😀", "😃", "😄", "😁", "😅", "😂", "🤣", "😊", "😇", "🙂",
  "😉", "😌", "😍", "🥰", "😘", "😋", "😛", "😜", "🤪", "😎",
  "🤗", "🤔", "🤐", "😐", "😑", "😶", "😏", "😒", "🙄", "😬",
  "👍", "👎", "👌", "✌️", "🤞", "🤝", "👏", "🙏", "💪", "❤️",
  "🔥", "⭐", "✨", "💯", "✅", "❌", "⚠️", "📌", "📎", "💼",
];

function TicketAttachmentsList({ attachments, isOutgoing }: { attachments: (string | TicketAttachment)[] | null; isOutgoing?: boolean }) {
  const { signedUrls, getKey } = useSignedAttachments(attachments);

  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mt-2">
      {attachments.map((att, index) => {
        // Backward compat: old string format
        if (typeof att === "string") {
          return (
            <a
              key={index}
              href={att}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              📎 Вложение {index + 1}
            </a>
          );
        }

        const key = getKey(att);
        const signed = signedUrls.get(key);

        return (
          <ChatMediaMessage
            key={key}
            fileType={att.kind || null}
            fileUrl={signed?.url || null}
            fileName={att.file_name || null}
            mimeType={att.mime || null}
            isOutgoing={!!isOutgoing}
            storageBucket={att.bucket || null}
            storagePath={att.path || null}
            uploadStatus={signed?.url ? "ok" : att.bucket ? "pending" : null}
          />
        );
      })}
    </div>
  );
}

interface TicketMessageProps {
  message: TicketMessageType;
  isCurrentUser?: boolean;
  isAdmin?: boolean;
  reactions?: ReactionGroup[];
  onToggleReaction?: (emoji: string) => void;
  onEditMessage?: (messageId: string, newText: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  displayAvatarUrl?: string | null;
}

export function TicketMessage({ message, isCurrentUser, isAdmin, reactions, onToggleReaction, onEditMessage, onDeleteMessage, displayAvatarUrl }: TicketMessageProps) {
  const isSystem = message.author_type === "system";
  const isSupport = message.author_type === "support";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.message);

  // Can edit/delete only support messages for admin
  const canModify = isAdmin && isSupport && (onEditMessage || onDeleteMessage);

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
        "flex gap-3 mb-4 group/msg min-w-0",
        isCurrentUser && "flex-row-reverse"
      )}
    >
      <Avatar className="h-8 w-8 shrink-0">
        {isSupport && displayAvatarUrl && (
          <AvatarImage src={displayAvatarUrl} alt={message.author_name || "Поддержка"} />
        )}
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

      <div className={cn("flex flex-col max-w-[min(75%,calc(100%-3rem))]", isCurrentUser && "items-end")}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium">
            {isSupport ? (message.author_name || "Поддержка") : (message.author_name || "Вы")}
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
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="min-h-[60px] text-sm"
                autoFocus
              />
              <div className="flex gap-1 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => { setIsEditing(false); setEditText(message.message); }}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Отмена
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-2"
                  disabled={!editText.trim() || editText.trim() === message.message}
                  onClick={() => {
                    onEditMessage?.(message.id, editText.trim());
                    setIsEditing(false);
                  }}
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Сохранить
                </Button>
              </div>
            </div>
          ) : (
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
          )}

          {/* Admin action buttons — edit / delete */}
          {canModify && !isEditing && (
            <div className={cn(
              "absolute -top-2 opacity-0 group-hover/msg:opacity-100 transition-opacity flex gap-0.5",
              isCurrentUser ? "left-0" : "right-0"
            )}>
              {onEditMessage && (
                <button
                  onClick={() => { setEditText(message.message); setIsEditing(true); }}
                  className="h-6 w-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center hover:bg-accent"
                  title="Редактировать"
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
              {onDeleteMessage && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      className="h-6 w-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center hover:bg-destructive/10"
                      title="Удалить"
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Удалить сообщение?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Это действие нельзя отменить. Сообщение будет удалено навсегда.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => onDeleteMessage(message.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Удалить
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}

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
              <PopoverContent className="w-64 p-2" side="top" align="center">
                <div className="grid grid-cols-10 gap-1">
                  {EMOJI_LIST.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        onToggleReaction(emoji);
                        setPickerOpen(false);
                      }}
                      className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-sm transition-colors"
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

        <TicketAttachmentsList attachments={message.attachments} isOutgoing={isCurrentUser} />
      </div>
    </div>
  );
}
