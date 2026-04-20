import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Локальные glass-классы для admin/room lifecycle-кнопок.
 * Цветной полупрозрачный fill (как Sonner-уведомления, mem://ui/notifications/sonner-visual-standard),
 * единая форма (h-9, min-w, padding, gap), tone задаёт сам цвет фона + tint текста/иконки.
 */
const GLASS_BASE =
  "h-9 min-w-[148px] justify-center gap-1.5 px-3 " +
  "backdrop-blur-md border shadow-sm hover:shadow-md transition-all " +
  "disabled:opacity-40 disabled:bg-white/30 disabled:border-white/30 disabled:shadow-none disabled:hover:shadow-none";

const GLASS_TONE = {
  // нейтральная (Открыть комнату): мягкий серо-белый стеклянный fill
  neutral:
    "bg-white/60 hover:bg-white/80 border-white/40 text-foreground/85 [&_svg]:text-foreground/70",
  // primary (Начать вебинар): мягкий blue-tinted glass fill
  primary:
    "bg-primary/15 hover:bg-primary/25 border-primary/25 text-primary [&_svg]:text-primary",
  // destructive (Завершить): мягкий red-tinted glass fill (admin-таблица — чуть мягче)
  destructive:
    "bg-destructive/12 hover:bg-destructive/20 border-destructive/25 text-destructive/85 [&_svg]:text-destructive/85",
  // destructive room: чуть плотнее, чтобы оставаться заметной на любом фоне комнаты
  destructiveRoom:
    "bg-destructive/15 hover:bg-destructive/25 border-destructive/30 text-destructive/90 [&_svg]:text-destructive/90",
} as const;

/** Бейдж в той же палитре, тише кнопок (мягче, не спорит с ними) */
const BADGE_TONE: Record<RoomState, string> = {
  closed:
    "bg-muted/60 backdrop-blur-md border-white/40 text-foreground/70",
  opened:
    "bg-primary/12 backdrop-blur-md border-primary/20 text-primary/90",
  live:
    "bg-destructive/12 backdrop-blur-md border-destructive/25 text-destructive/85 animate-pulse",
  completed:
    "bg-muted/60 backdrop-blur-md border-white/40 text-foreground/60",
};
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DoorOpen, PlayCircle, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  type RoomState,
  type LifecycleAction,
  canPerformAction,
  getRoomStateBadgeVM,
  lifecycleActionLabels,
} from "@/lib/liveRoomLifecycle";

interface Props {
  eventId: string;
  roomState: RoomState;
  /** Layout: 'admin' shows all 3 buttons + badge, 'room' shows only Complete (in-room, для staff) */
  layout?: "admin" | "room";
  invalidateKeys?: string[][];
  onSuccess?: () => void;
}

export function RoomLifecycleActions({
  eventId,
  roomState,
  layout = "admin",
  invalidateKeys = [["admin-live-events"]],
  onSuccess,
}: Props) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<LifecycleAction | null>(null);
  const badge = getRoomStateBadgeVM(roomState);

  const callAction = async (action: LifecycleAction) => {
    setPending(action);
    try {
      const { data, error } = await supabase.functions.invoke("live-event-lifecycle", {
        body: { event_id: eventId, action },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      if ((data as any)?.skipped) {
        toast.info("Действие пропущено: комната уже в нужном состоянии.");
      } else {
        toast.success(`${lifecycleActionLabels[action]} — выполнено`);
        if ((data as any)?.provider?.attempted && !(data as any).provider.ok) {
          toast.warning(
            `Provider call (Kinescope) упал: ${(data as any).provider.error?.slice(0, 120) ?? "unknown"}. Состояние комнаты обновлено в degraded-режиме (см. audit_logs).`,
          );
        }
      }
      invalidateKeys.forEach((key) => qc.invalidateQueries({ queryKey: key }));
      onSuccess?.();
    } catch (e: any) {
      toast.error(`Ошибка lifecycle: ${e?.message ?? e}`);
    } finally {
      setPending(null);
    }
  };

  if (layout === "room") {
    if (!canPerformAction(roomState, "complete_webinar")) return null;
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            className={cn(GLASS_BASE, GLASS_TONE.destructiveRoom)}
            disabled={!!pending}
          >
            {pending === "complete_webinar" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            Завершить вебинар
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Завершить вебинар?</AlertDialogTitle>
            <AlertDialogDescription>
              Эфир будет завершён для всех участников. Это действие нельзя отменить.
              Замените на запись через отдельный flow при необходимости.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!pending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => callAction("complete_webinar")}
              disabled={!!pending}
            >
              Завершить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // admin layout — все 3 кнопки + badge (glass-стиль, цветные tint-фоны)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge
        variant="outline"
        className={cn(
          "h-9 px-3 font-medium border",
          BADGE_TONE[roomState],
        )}
      >
        {badge.label}
      </Badge>

      <Button
        variant="outline"
        className={cn(GLASS_BASE, GLASS_TONE.neutral)}
        disabled={!canPerformAction(roomState, "open_room") || !!pending}
        onClick={() => callAction("open_room")}
      >
        {pending === "open_room" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <DoorOpen className="h-4 w-4" />
        )}
        Открыть комнату
      </Button>

      <Button
        variant="outline"
        className={cn(GLASS_BASE, GLASS_TONE.primary)}
        disabled={!canPerformAction(roomState, "start_live") || !!pending}
        onClick={() => callAction("start_live")}
      >
        {pending === "start_live" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <PlayCircle className="h-4 w-4" />
        )}
        Начать вебинар
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            className={cn(GLASS_BASE, GLASS_TONE.destructive)}
            disabled={!canPerformAction(roomState, "complete_webinar") || !!pending}
          >
            {pending === "complete_webinar" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            Завершить вебинар
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Завершить вебинар?</AlertDialogTitle>
            <AlertDialogDescription>
              Эфир будет завершён для всех участников. Действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!pending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => callAction("complete_webinar")}
              disabled={!!pending}
            >
              Завершить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
