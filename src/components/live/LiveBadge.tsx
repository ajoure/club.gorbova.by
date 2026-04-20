/**
 * Compact pulsing LIVE badge.
 * Pure UI label — does NOT influence platform_status / room_state / player branch / resolver.
 *
 * Display modes (read from live_events.metadata.live_badge_mode):
 * - 'auto'        — show only when platform_status === 'live' (default)
 * - 'always_show' — show always (e.g. for replay/auto-webinar)
 * - 'hidden'      — never show
 */
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type LiveBadgeMode = "auto" | "always_show" | "hidden";

interface LiveBadgeProps {
  platformStatus?: string | null;
  mode?: LiveBadgeMode;
  size?: "sm" | "md";
}

export function shouldShowLiveBadge(
  mode: LiveBadgeMode | undefined | null,
  platformStatus: string | null | undefined,
): boolean {
  const m = (mode || "auto") as LiveBadgeMode;
  if (m === "hidden") return false;
  if (m === "always_show") return true;
  return platformStatus === "live";
}

export function LiveBadge({ platformStatus, mode = "auto", size = "sm" }: LiveBadgeProps) {
  if (!shouldShowLiveBadge(mode, platformStatus)) return null;

  const dotSize = size === "md" ? "h-2 w-2" : "h-1.5 w-1.5";
  const padding = size === "md" ? "px-2 py-0.5" : "px-1.5 py-0.5";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1.5 rounded-md bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 font-bold uppercase tracking-wide text-[10px] ${padding}`}
            aria-label="Живой эфир"
          >
            <span className="relative flex">
              <span className={`absolute inline-flex rounded-full bg-rose-500 opacity-75 animate-ping ${dotSize}`} />
              <span className={`relative inline-flex rounded-full bg-rose-500 ${dotSize}`} />
            </span>
            LIVE
          </span>
        </TooltipTrigger>
        <TooltipContent>Живой эфир</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
