import { Send, Instagram, LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTelegramSourceBadgeText } from "@/lib/telegramBusinessIdentity";
import type { UnifiedSource } from "@/hooks/useUnifiedInbox";

interface Props {
  source: UnifiedSource;
  /** Actual bot or personal account; visible for every Telegram destination. */
  label?: string | null;
  className?: string;
}

/**
 * Единый бейдж источника в строке ленты / unified header.
 * Формат:
 *   TG · название бота
 *   TG · имя владельца личного Telegram
 *   Instagram
 *   Техподдержка
 * Полное имя канала остаётся в title/aria-label при визуальном сокращении.
 */
export function SourceBadge({ source, label, className }: Props) {
  const config = {
    telegram: {
      Icon: Send,
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
  const a11y = label ? `${base} · ${label}` : base;
  const visibleLabel = source === "telegram" ? getTelegramSourceBadgeText(label) : base;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap",
        color,
        className,
      )}
      title={a11y}
      aria-label={a11y}
    >
      <Icon className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      <span className="truncate max-w-[190px]">{visibleLabel}</span>
    </span>
  );
}
