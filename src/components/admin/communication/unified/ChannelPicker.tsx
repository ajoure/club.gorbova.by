import { Send, Instagram, LifeBuoy, Plus } from "lucide-react";
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
 * ChannelPicker V3 (PATCH-UNIFIED-INBOX-V3-PROFILE-GROUPING +
 * PATCH-CONTACT-CENTER-ADMIN-INITIATE-SUPPORT-TICKET).
 *
 * Support-канал: если у контакта есть profileId, но нет активного support-канала,
 * кнопка «Техподдержка» переходит в состояние «Создать» — по клику вызывает
 * onRequestCreateSupport(contact). Telegram/Instagram остаются disabled, если
 * канал у контакта отсутствует.
 */
interface Props {
  contact: UnifiedContactRow;
  activeSource: UnifiedSource;
  onChange: (source: UnifiedSource) => void;
  onRequestCreateSupport?: (contact: UnifiedContactRow) => void;
}

const OPTIONS: { source: UnifiedSource; label: string; Icon: typeof Send }[] = [
  { source: "telegram", label: "Telegram", Icon: Send },
  { source: "instagram", label: "Instagram", Icon: Instagram },
  { source: "support", label: "Техподдержка", Icon: LifeBuoy },
];

export function ChannelPicker({ contact, activeSource, onChange, onRequestCreateSupport }: Props) {
  // Support-canCreate: есть profileId, но support-канала пока нет.
  const canCreateSupport = !!contact.profileId && !contact.channels.support && !!onRequestCreateSupport;

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
          const isCreate = source === "support" && !present && canCreateSupport;
          const disabled = !present && !isCreate;

          const btn = (
            <Button
              key={source}
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 px-2 text-[11px] rounded-full gap-1",
                isActive && "bg-primary/15 text-primary",
                disabled && "opacity-40",
                isCreate && "border border-dashed border-primary/40 text-primary/80 hover:bg-primary/10",
              )}
              disabled={disabled}
              onClick={() => {
                if (isCreate) {
                  onRequestCreateSupport?.(contact);
                  return;
                }
                if (present && !isActive) onChange(source);
              }}
            >
              <Icon className="h-3 w-3" />
              {label}
              {isCreate && <Plus className="h-3 w-3 ml-0.5" />}
              {ch && ch.unread > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-3.5 h-3.5 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
                  {ch.unread > 99 ? "99+" : ch.unread}
                </span>
              )}
            </Button>
          );

          if (present) return btn;

          return (
            <Tooltip key={source}>
              <TooltipTrigger asChild>
                <span>{btn}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[11px]">
                {isCreate ? "Создать обращение в техподдержку" : "Канал не привязан к контакту"}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
