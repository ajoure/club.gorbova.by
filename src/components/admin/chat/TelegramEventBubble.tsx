import { memo } from "react";
import { AlertCircle, Bell, CheckCircle } from "lucide-react";
import { renderTelegramFormattedText } from "./telegramFormat";
import {
  EVENT_ICONS,
  type EventBubbleProps,
  eventBubbleAreEqual,
} from "./telegramBubbleTypes";

/**
 * PATCH-CONTACT-CENTER-TELEGRAM-CHAT-PERFORMANCE-V1.3-MEMOIZE-BUBBLE
 *
 * Separate memoized component/comparator for system-event pills. Different
 * comparator from TelegramMessageBubble so we don't smear message-vs-event
 * concerns.
 */
function TelegramEventBubbleImpl({ data }: EventBubbleProps) {
  const pillBg = data.isSkipped
    ? "bg-muted/40 border border-dashed border-muted-foreground/30"
    : data.isFailed
    ? "bg-destructive/10 border border-destructive/30"
    : "bg-muted";

  return (
    <div className="flex justify-center my-2">
      <div className="flex flex-col items-center gap-1 max-w-[85%]">
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs text-muted-foreground ${pillBg}`}
          title={data.title || undefined}
        >
          {data.isSkipped ? (
            <AlertCircle className="w-3 h-3 text-muted-foreground" />
          ) : (
            EVENT_ICONS[data.action] || <Bell className="w-3 h-3" />
          )}
          <span>
            {data.displayText}
            {data.statusSuffix && <span className="opacity-70">{data.statusSuffix}</span>}
          </span>
          <span className="opacity-60">{data.timeMedium}</span>
          {data.isSuccess && <CheckCircle className="w-3 h-3 text-green-500" />}
          {data.isFailed && <AlertCircle className="w-3 h-3 text-destructive" />}
        </div>
        {data.hasMessageText && (
          <div className="w-full px-4 py-2 bg-muted/50 rounded-lg text-xs text-muted-foreground border border-border/30">
            <div className="whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
              {renderTelegramFormattedText(data.messageText || "")}
            </div>
          </div>
        )}
        {data.isSkipped && data.skipReason && (
          <div className="text-[10px] text-muted-foreground/70 italic">
            Причина: {data.skipReason}
          </div>
        )}
      </div>
    </div>
  );
}

export const TelegramEventBubble = memo(TelegramEventBubbleImpl, eventBubbleAreEqual);
