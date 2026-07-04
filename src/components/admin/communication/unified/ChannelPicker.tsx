import { useMemo } from "react";
import { Send, Instagram, LifeBuoy, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useProfileChannels } from "@/hooks/useProfileChannels";
import type { UnifiedDialog, UnifiedSource } from "@/hooks/useUnifiedInbox";

/**
 * ChannelPicker V1 (PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-CHANNELS)
 *
 * СТРОГО READ-ONLY. Показывает, какие каналы связи уже существуют у
 * profile.id выбранной строки, и позволяет переключиться на существующую
 * unified-строку другого канала того же профиля.
 *
 * НЕ создаёт: новых тикетов, новых IG-thread'ов, cross-channel composer,
 * ничего не пишет в БД, не выбирает Telegram-бота (это остаётся внутри
 * ContactTelegramChat).
 *
 * Если у профиля есть канал в БД, но нет активной строки в текущей unified
 * ленте — кнопка disabled с tooltip «нет активного диалога в ленте».
 */
interface Props {
  currentRow: UnifiedDialog;
  allRows: UnifiedDialog[];
  onSelect: (key: string) => void;
}

interface ChannelOption {
  source: UnifiedSource;
  label: string;
  icon: typeof Send;
  targetKey: string | null; // key существующей unified-строки того же канала
  reason: string | null; // причина, почему кнопка disabled
  present: boolean; // есть ли канал в БД
}

export function ChannelPicker({ currentRow, allRows, onSelect }: Props) {
  const profileId = currentRow.meta.profileId ?? null;
  const { data, isLoading } = useProfileChannels(profileId);

  const options = useMemo<ChannelOption[]>(() => {
    if (!profileId || !data) return [];

    // Telegram
    const tgRow = allRows.find(
      (r) => r.source === "telegram" && r.meta.profileId === profileId,
    );
    const tg: ChannelOption = {
      source: "telegram",
      label: "Telegram",
      icon: Send,
      present: data.telegram.linked,
      targetKey: tgRow?.key ?? null,
      reason: !data.telegram.linked
        ? "Telegram не привязан к профилю"
        : tgRow
          ? null
          : "Нет активного диалога Telegram в ленте",
    };

    // Instagram — может быть несколько IG-аккаунтов у одного profile;
    // берём первую доступную unified-строку. Полный список — в карточке контакта.
    const igRow = allRows.find(
      (r) => r.source === "instagram" && r.meta.profileId === profileId,
    );
    const ig: ChannelOption = {
      source: "instagram",
      label: "Instagram",
      icon: Instagram,
      present: data.instagram.length > 0,
      targetKey: igRow?.key ?? null,
      reason:
        data.instagram.length === 0
          ? "Instagram-контакт не привязан к профилю"
          : igRow
            ? null
            : "IG-диалог существует, но не активен в ленте",
    };

    // Support
    const openTicket = data.support[0];
    const supportRow = openTicket
      ? allRows.find((r) => r.source === "support" && r.meta.ticketId === openTicket.ticketId)
      : undefined;
    const support: ChannelOption = {
      source: "support",
      label: "Техподдержка",
      icon: LifeBuoy,
      present: data.support.length > 0,
      targetKey: supportRow?.key ?? null,
      reason:
        data.support.length === 0
          ? "Нет открытых обращений"
          : supportRow
            ? null
            : "Тикет существует, но не в ленте",
    };

    return [tg, ig, support];
  }, [profileId, data, allRows]);

  if (!profileId) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground border-b border-border/10">
        <Link2Off className="h-3 w-3" />
        <span>Не привязан к профилю — переключение каналов недоступно</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="px-2 py-1 text-[10px] text-muted-foreground border-b border-border/10">
        Загрузка каналов…
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border/10 bg-muted/20">
        <span className="text-[10px] text-muted-foreground mr-1">Канал:</span>
        {options.map((opt) => {
          const Icon = opt.icon;
          const isActive = opt.source === currentRow.source;
          const disabled = !opt.targetKey || isActive;
          const btn = (
            <Button
              key={opt.source}
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 px-2 text-[11px] rounded-full gap-1",
                isActive && "bg-primary/15 text-primary",
                !opt.present && "opacity-40",
              )}
              disabled={disabled}
              onClick={() => opt.targetKey && onSelect(opt.targetKey)}
            >
              <Icon className="h-3 w-3" />
              {opt.label}
            </Button>
          );
          return opt.reason ? (
            <Tooltip key={opt.source}>
              <TooltipTrigger asChild>
                <span>{btn}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[11px]">
                {opt.reason}
              </TooltipContent>
            </Tooltip>
          ) : (
            btn
          );
        })}
      </div>
    </TooltipProvider>
  );
}
