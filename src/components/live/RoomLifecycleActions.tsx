import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Локальные glass-классы для admin layout lifecycle-кнопок.
 * НЕ добавляем глобальный variant в button.tsx — это локальный use-case.
 * Все 3 кнопки имеют одинаковую форму (h-9, min-w, padding, gap), tone несёт только цвет иконки/текста.
 */
const GLASS_BASE =
  "h-9 min-w-[148px] justify-center gap-1.5 px-3 " +
  "bg-white/60 backdrop-blur-md border border-white/40 shadow-sm " +
  "hover:bg-white/80 hover:shadow-md transition-all " +
  "disabled:opacity-40 disabled:bg-white/30 disabled:shadow-none disabled:hover:bg-white/30";

const GLASS_TONE = {
  neutral: "text-foreground/80 [&_svg]:text-foreground/70",
  primary: "text-primary [&_svg]:text-primary",
  destructive: "text-destructive/80 [&_svg]:text-destructive/80",
} as const;
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
          <Button size="sm" variant="destructive" disabled={!!pending}>
            {pending === "complete_webinar" ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Square className="h-4 w-4 mr-1" />
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

  // admin layout — все 3 кнопки + badge
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={badge.variant} className={badge.pulse ? "animate-pulse" : ""}>
        {badge.label}
      </Badge>

      <Button
        size="sm"
        variant="outline"
        disabled={!canPerformAction(roomState, "open_room") || !!pending}
        onClick={() => callAction("open_room")}
      >
        {pending === "open_room" ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <DoorOpen className="h-4 w-4 mr-1" />
        )}
        Открыть комнату
      </Button>

      <Button
        size="sm"
        variant="default"
        disabled={!canPerformAction(roomState, "start_live") || !!pending}
        onClick={() => callAction("start_live")}
      >
        {pending === "start_live" ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <PlayCircle className="h-4 w-4 mr-1" />
        )}
        Начать вебинар
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="destructive"
            disabled={!canPerformAction(roomState, "complete_webinar") || !!pending}
          >
            {pending === "complete_webinar" ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Square className="h-4 w-4 mr-1" />
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
