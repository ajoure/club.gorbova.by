import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { TELEGRAM_REACTION_EMOJIS } from "@/lib/telegramReactionEmojis";
import type { LiveCommentReaction } from "@/hooks/useLiveEventCommentReactions";

interface LiveEventCommentReactionsProps {
  reactions?: LiveCommentReaction[];
  disabled?: boolean;
  onToggle: (emoji: string) => void;
}

/** Telegram-style picker and aggregate pills for one live-room comment. */
export function LiveEventCommentReactions({ reactions, disabled, onToggle }: LiveEventCommentReactionsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="ml-9 -mt-1 mb-1 flex flex-wrap items-center gap-1">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed"
            aria-label="Добавить реакцию"
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-2" side="top" align="start">
          <div className="grid grid-cols-10 gap-1" aria-label="Выбор реакции">
            {TELEGRAM_REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => { onToggle(emoji); setPickerOpen(false); }}
                className="flex h-7 w-7 items-center justify-center rounded text-sm transition-colors hover:bg-accent focus:bg-accent"
                aria-label={`Реакция ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {(reactions ?? []).map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          disabled={disabled}
          onClick={() => onToggle(reaction.emoji)}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full border px-1.5 text-xs transition-colors",
            reaction.userReacted
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border bg-muted hover:bg-accent",
          )}
          aria-label={`${reaction.emoji}: ${reaction.count}. Нажмите, чтобы изменить реакцию`}
        >
          <span>{reaction.emoji}</span>
          <span className="font-medium tabular-nums">{reaction.count}</span>
        </button>
      ))}
    </div>
  );
}
