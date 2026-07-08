import { memo } from "react";
import {
  Bot,
  User,
  Reply,
  SmilePlus,
  CheckCircle,
  AlertCircle,
  Clock,
  MoreVertical,
  Edit2,
  Trash2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatMediaMessage } from "./ChatMediaMessage";
import { renderTelegramFormattedText } from "./telegramFormat";
import {
  type MessageBubbleProps,
  messageBubbleAreEqual,
} from "./telegramBubbleTypes";

/**
 * PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.3-MEMOIZE-BUBBLE
 *
 * Flat-props, React.memo'd bubble. Comparator lives in `telegramBubbleTypes`.
 * MUST NOT read from parent's messages map / reactions map / botsMap — all
 * lookup happens in the parent's `chatItemsWithMeta` precompute.
 */
function TelegramMessageBubbleImpl(props: MessageBubbleProps) {
  // V1.3 perf instrumentation (harness-only): counts real bubble renders
  // when window.__perfBubbleCount === true. No-op otherwise.
  if (typeof window !== "undefined" && (window as any).__perfBubbleCount === true) {
    (window as any).__bubbleRendersTotal = ((window as any).__bubbleRendersTotal || 0) + 1;
  }

  const {
    data,
    isHighlighted,
    onReply,
    onEdit,
    onDelete,
    onReact,
    onQuoteClick,
    onMediaRefresh,
    emojiList,
  } = props;

  if (data.isDeleted) {
    return (
      <div
        id={`tg-msg-${data.id}`}
        data-message-id={data.id}
        className={cn(
          "flex",
          data.direction === "outgoing" ? "justify-end" : "justify-start"
        )}
      >
        <div className="max-w-[80%] rounded-lg p-3 bg-muted/50 border border-dashed">
          <p className="text-sm text-muted-foreground italic">Сообщение удалено</p>
          <span className="text-xs opacity-60">{data.timeShort}</span>
        </div>
      </div>
    );
  }

  const isOutgoing = data.direction === "outgoing";
  const isVideoNoteMsg = data.fileType === "video_note";
  const isPureMediaMsg = data.isMediaLike && !data.messageText && !data.hasReply;
  const transparentBubble = isVideoNoteMsg || isPureMediaMsg;
  const senderLabel = isOutgoing
    ? data.adminName || "Администратор"
    : data.clientName || "Клиент";
  const senderAvatar = isOutgoing ? data.adminAvatarUrl : data.clientAvatarUrl;

  return (
    <div
      id={`tg-msg-${data.id}`}
      data-message-id={data.id}
      className={cn(
        "flex w-full min-w-0 group transition-colors duration-700 rounded-lg",
        isOutgoing ? "justify-end pr-1" : "justify-start",
        isHighlighted && "bg-yellow-200/40"
      )}
    >
      <div className={cn("relative max-w-[80%] min-w-0", isOutgoing && "mr-1")}>
        <div className="flex flex-col w-full min-w-0">
          <div className="relative">
            <div
              className={cn(
                "break-words overflow-hidden",
                transparentBubble
                  ? "p-0 bg-transparent rounded-none"
                  : cn(
                      "rounded-lg p-3",
                      isOutgoing ? "bg-primary text-primary-foreground" : "bg-muted"
                    )
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                {senderAvatar ? (
                  <img
                    src={senderAvatar}
                    alt=""
                    className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                  />
                ) : isOutgoing ? (
                  <Bot className="w-3 h-3 flex-shrink-0" />
                ) : (
                  <User className="w-3 h-3 flex-shrink-0" />
                )}
                <span className="text-xs opacity-70">{senderLabel}</span>
              </div>

              {data.hasReply && (
                <button
                  type="button"
                  onClick={() => data.quotedMessageDbId && onQuoteClick(data.quotedMessageDbId)}
                  disabled={!data.quotedMessageDbId}
                  className={cn(
                    "block w-full text-left mb-2 pl-2 border-l-2 rounded-sm py-1 px-2 -mx-1 transition-colors",
                    isOutgoing
                      ? "border-primary-foreground/60 bg-primary-foreground/10 hover:bg-primary-foreground/20"
                      : "border-primary/60 bg-primary/5 hover:bg-primary/10",
                    data.quotedMissing && "opacity-60 cursor-default"
                  )}
                >
                  <div
                    className={cn(
                      "text-[11px] font-semibold truncate",
                      isOutgoing ? "text-primary-foreground/90" : "text-primary"
                    )}
                  >
                    {data.quotedAuthor || "Сообщение"}
                  </div>
                  <div
                    className={cn(
                      "text-xs truncate",
                      isOutgoing ? "text-primary-foreground/80" : "text-muted-foreground"
                    )}
                  >
                    {data.quotedPreview || "Недоступно (не загружено)"}
                  </div>
                </button>
              )}

              {data.isMediaLike && (
                <div className="mb-2">
                  <ChatMediaMessage
                    fileType={data.fileType}
                    fileUrl={data.fileUrl}
                    fileName={data.fileName}
                    mimeType={data.mimeType}
                    errorMessage={data.uploadError}
                    isOutgoing={isOutgoing}
                    storageBucket={data.storageBucket}
                    storagePath={data.storagePath}
                    uploadStatus={data.uploadStatus}
                    onRefresh={onMediaRefresh}
                  />
                </div>
              )}

              {data.messageText && (
                <p className="text-sm whitespace-pre-wrap break-words">
                  {renderTelegramFormattedText(data.messageText)}
                </p>
              )}

              {data.inlineUrlRows.length > 0 && (
                <div
                  className={cn(
                    "mt-2 pt-2 -mx-3 px-3 flex flex-col gap-1.5 border-t",
                    isOutgoing ? "border-primary-foreground/20" : "border-border/40"
                  )}
                >
                  {data.inlineUrlRows.map((row, ri) => (
                    <div key={ri} className="flex flex-wrap gap-1.5">
                      {row.map((btn, bi) => (
                        <a
                          key={bi}
                          href={btn.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            "flex-1 min-w-0 inline-flex items-center justify-center text-center h-9 px-3 rounded-lg text-sm font-medium transition-colors break-words",
                            isOutgoing
                              ? "bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25"
                              : "bg-primary/10 text-primary hover:bg-primary/20"
                          )}
                        >
                          <span className="truncate">{btn.text || btn.url}</span>
                        </a>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-end gap-1 mt-1">
                {data.automated && (
                  <span
                    className="text-[10px] opacity-80 mr-1 px-1 rounded bg-primary-foreground/20"
                    title={data.automatedTitle || undefined}
                  >
                    Авто
                  </span>
                )}
                {data.botLabel && (
                  <span className="text-[10px] opacity-70 mr-1">{data.botLabel}</span>
                )}
                {data.isEdited && <span className="text-xs opacity-60 mr-1">ред.</span>}
                <span className="text-xs opacity-60">{data.timeShort}</span>
                {isOutgoing && (
                  <>
                    {data.status === "sent" && <CheckCircle className="w-3 h-3 opacity-60" />}
                    {data.status === "failed" && (
                      <AlertCircle className="w-3 h-3 text-destructive" />
                    )}
                    {data.status === "pending" && <Clock className="w-3 h-3 opacity-60" />}
                  </>
                )}
              </div>
            </div>

            {/* Hover controls */}
            <div
              className={cn(
                "absolute -bottom-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity",
                isOutgoing ? "left-0" : "right-0"
              )}
            >
              <button
                type="button"
                onClick={() => onReply(data.id)}
                title="Ответить"
                className="h-6 w-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center hover:bg-accent"
              >
                <Reply className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className="h-6 w-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center hover:bg-accent"
                    title="Реакция"
                  >
                    <SmilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" side="top" align="center">
                  <div className="grid grid-cols-10 gap-1">
                    {emojiList.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => onReact(data.id, emoji)}
                        className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-sm transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5 text-center leading-tight">
                    В Telegram отображается только 1 реакция от бота (лимит Telegram API)
                  </p>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {data.reactionsForRow.length > 0 && (
            <div
              className={cn(
                "flex flex-wrap gap-1 mt-1",
                isOutgoing && "justify-end"
              )}
            >
              {data.reactionsForRow.map((r) => (
                <button
                  key={r.emoji}
                  onClick={() => onReact(data.id, r.emoji)}
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
        </div>

        {isOutgoing && (data.canEdit || data.canDelete) && (
          <div className="absolute -left-8 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <MoreVertical className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {data.canEdit && (
                  <DropdownMenuItem onClick={() => onEdit(data.id)}>
                    <Edit2 className="w-4 h-4 mr-2" />
                    Редактировать
                  </DropdownMenuItem>
                )}
                {data.canDelete && data.telegramMessageId && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => onDelete(data.id, data.telegramMessageId!)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Удалить
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
}

export const TelegramMessageBubble = memo(TelegramMessageBubbleImpl, messageBubbleAreEqual);
