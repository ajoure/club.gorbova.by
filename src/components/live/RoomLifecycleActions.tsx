import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Glass-классы для lifecycle-кнопок вынесены в shared helper
 * (`lifecycleButtonStyles.ts`) — он же используется для «Создать эфир»,
 * «Справка», «Пересоздать» в /admin/live-events. Единая форма + tones.
 */
import {
  LIFECYCLE_BUTTON_BASE as GLASS_BASE,
  LIFECYCLE_BUTTON_TONES as GLASS_TONE,
  LIFECYCLE_BUTTON_WIDTH_FIXED,
  LIFECYCLE_BUTTON_WIDTH_MIN,
} from "./lifecycleButtonStyles";

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
        const provider = (data as any)?.provider;
        if (provider?.attempted && !provider.ok) {
          // PATCH KINESCOPE-TOKEN: human-friendly toast вместо raw JSON провайдера.
          if (provider.reason === "provider_token_missing") {
            toast.warning(
              "Kinescope: интеграция не настроена или токен недействителен. Состояние комнаты обновлено, но провайдер не получил команду. Обратитесь к администратору.",
            );
          } else {
            toast.warning(
              `Kinescope временно недоступен. Состояние комнаты обновлено в degraded-режиме (детали в audit_logs).`,
            );
          }
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
            className={cn(GLASS_BASE, GLASS_TONE.destructiveRoom, LIFECYCLE_BUTTON_WIDTH_MIN)}
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
        className={cn(GLASS_BASE, GLASS_TONE.neutral, LIFECYCLE_BUTTON_WIDTH_FIXED)}
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
        className={cn(GLASS_BASE, GLASS_TONE.primary, LIFECYCLE_BUTTON_WIDTH_FIXED)}
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
            className={cn(GLASS_BASE, GLASS_TONE.destructive, LIFECYCLE_BUTTON_WIDTH_FIXED)}
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
