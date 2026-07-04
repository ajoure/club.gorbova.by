import { MessageSquare, Instagram, LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UnifiedSource } from "@/hooks/useUnifiedInbox";

interface Props {
  source: UnifiedSource;
  label?: string | null;
  className?: string;
}

/**
 * Единый бейдж источника в строке ленты. Заменяет ad-hoc плашки бота/аккаунта
 * в unified-режиме. Формат:
 *   Telegram · <bot_name>
 *   Instagram · @<account>
 *   Техподдержка
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
  const text = label ? `${base} · ${label}` : base;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap",
        color,
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      <span className="truncate max-w-[140px]">{text}</span>
    </span>
  );
}
