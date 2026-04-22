import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useLiveEventReactions, useSendLiveReaction } from "@/hooks/useLiveEventReactions";
import { toast } from "sonner";

interface LiveRoomReactionsBarProps {
  liveEventId: string;
  enabled: boolean;
}

const QUICK_REACTIONS = ["👍", "❤️", "🔥", "👏", "😂", "🎉", "🤔", "💯"];

/**
 * Панель быстрых реакций уровня комнаты.
 *
 * - Контракт: live_event_reactions (server-side rate limit + mute/remove guard в RLS).
 * - При reactions.enabled=false компонент не рендерится (родительский guard + локальная страховка).
 * - Для гостей кнопки disabled — серверный RLS всё равно отклонит.
 */
export function LiveRoomReactionsBar({ liveEventId, enabled }: LiveRoomReactionsBarProps) {
  const { user } = useAuth();
  const { data: aggregates } = useLiveEventReactions(liveEventId, enabled);
  const sendReaction = useSendLiveReaction(liveEventId);

  if (!enabled) return null;

  const counts = new Map<string, number>();
  for (const a of aggregates || []) counts.set(a.emoji, a.count);

  const handleClick = async (emoji: string) => {
    if (!user) {
      toast.error("Войдите, чтобы реагировать");
      return;
    }
    try {
      await sendReaction.mutateAsync(emoji);
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("row-level security") || msg.includes("violates")) {
        toast.error("Реакция временно недоступна");
      } else {
        toast.error("Не удалось отправить реакцию");
      }
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1 p-2 room-panel border-t">
      {QUICK_REACTIONS.map((emoji) => {
        const count = counts.get(emoji) || 0;
        return (
          <Button
            key={emoji}
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-base gap-1 hover:bg-muted"
            onClick={() => handleClick(emoji)}
            disabled={sendReaction.isPending}
            aria-label={`Реакция ${emoji}`}
          >
            <span>{emoji}</span>
            {count > 0 && (
              <span className="text-[10px] room-meta-text tabular-nums">{count}</span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
