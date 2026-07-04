import { Send, Instagram, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { UnifiedContactRow, UnifiedSource } from "@/hooks/useUnifiedInbox";

/**
 * ChannelPicker V3 (PATCH-UNIFIED-INBOX-V3-PROFILE-GROUPING).
 *
 * Больше НЕ переключает выбранную строку ленты. Меняет только activeSource
 * внутри уже выбранного grouped-контакта: selectedKey остаётся `profile:<id>`,
 * а правая панель перерисовывается на соответствующий канал.
 *
 * disabled — если канал у контакта отсутствует.
 */
interface Props {
  contact: UnifiedContactRow;
  activeSource: UnifiedSource;
  onChange: (source: UnifiedSource) => void;
}

const OPTIONS: { source: UnifiedSource; label: string; Icon: typeof Send }[] = [
  { source: "telegram", label: "Telegram", Icon: Send },
  { source: "instagram", label: "Instagram", Icon: Instagram },
  { source: "support", label: "Техподдержка", Icon: LifeBuoy },
];

export function ChannelPicker({ contact, activeSource, onChange }: Props) {
  // Одинокая source-строка (без profileId) — переключать нечего, скрываем.
  if (!contact.profileId && contact.availableSources.length <= 1) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border/10 bg-muted/20">
        <span className="text-[10px] text-muted-foreground mr-1">Канал:</span>
        {OPTIONS.map(({ source, label, Icon }) => {
          const present = !!contact.channels[source];
          const isActive = source === activeSource;
          const ch = contact.channels[source];
          const btn = (
            <Button
              key={source}
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 px-2 text-[11px] rounded-full gap-1",
                isActive && "bg-primary/15 text-primary",
                !present && "opacity-40",
              )}
              disabled={!present}
              onClick={() => present && !isActive && onChange(source)}
            >
              <Icon className="h-3 w-3" />
              {label}
              {ch && ch.unread > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-3.5 h-3.5 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
                  {ch.unread > 99 ? "99+" : ch.unread}
                </span>
              )}
            </Button>
          );
          return present ? (
            btn
          ) : (
            <Tooltip key={source}>
              <TooltipTrigger asChild>
                <span>{btn}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[11px]">
                Канал не привязан к контакту
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
