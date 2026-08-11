import { MessageSquare, Instagram, LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UnifiedSource } from "@/hooks/useUnifiedInbox";

interface Props {
  source: UnifiedSource;
  /**
   * Bot/account suffixes stay hidden for compact channel badges. Telegram
   * Business is the exception: the personal-account label is user-critical
   * and must remain visible so it cannot be confused with the connected bot.
   */
  label?: string | null;
  className?: string;
}

/**
 * Единый бейдж источника в строке ленты / unified header.
 * Формат:
 *   Telegram
 *   Катерина Горбова · личный Telegram
 *   Instagram
 *   Техподдержка
 * Имя обычного бота/@аккаунта остаётся только в title/aria-label; личный
 * Telegram показывается явно.
 */
export function SourceBadge({ source, label, className }: Props) {
  const config = {
    telegram: {
      Icon: MessageSquare,
      base: "Telegram",
      color: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
    },
    instagram: {
      Icon: Instagram,
      base: "Instagram",
      color: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
    },
    support: {
      Icon: LifeBuoy,
      base: "Техподдержка",
      color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
    },
  }[source];

  const { Icon, base, color } = config;
  const isPersonalTelegram = source === "telegram" && !!label?.includes("личный Telegram");
  const a11y = label ? `${base} · ${label}` : base;
  const visibleLabel = isPersonalTelegram ? label : base;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap",
        color,
        className,
      )}
      title={a11y}
      aria-label={a11y}
    >
      <Icon className="h-2.5 w-2.5" />
      <span className="truncate max-w-[190px]">{visibleLabel}</span>
    </span>
  );
}
