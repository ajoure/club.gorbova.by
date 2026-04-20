/**
 * Final follow-up sprint PATCH F5:
 * Единый dialog для single + bulk удаления эфиров с двумя режимами и type-to-confirm.
 *
 * Контракт безопасности:
 * - Загружает summary до execute (Kinescope linkage + lifecycle counters).
 * - Lifecycle counters (PATCH F5 п.6): closed/opened/live/completed.
 * - live-эфиры исключаются из набора серверным guard'ом (PATCH F6 п.9 — partial execution).
 * - Type-to-confirm "УДАЛИТЬ" обязателен.
 * - Provider 404 трактуется как success (already_absent), не failure.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { parseRoomState, roomStateShortLabels } from "@/lib/liveRoomLifecycle";

type DeleteMode = "platform_only" | "platform_and_provider";

interface Props {
  open: boolean;
  eventIds: string[];
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface SummaryRow {
  id: string;
  title: string;
  kinescope_live_event_id: string | null;
  kinescope_video_id: string | null;
  room_state: string | null;
}

const CONFIRM_PHRASE = "УДАЛИТЬ";

export function LiveEventDeleteDialog({ open, eventIds, onOpenChange, onSuccess }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<DeleteMode>("platform_only");
  const [confirmText, setConfirmText] = useState("");

  // Load summary при открытии
  const { data: rows, isLoading } = useQuery({
    queryKey: ["live-events-delete-summary", eventIds.sort().join(",")],
    enabled: open && eventIds.length > 0,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("live_events")
        .select("id, title, kinescope_live_event_id, kinescope_video_id, room_state")
        .in("id", eventIds);
      if (error) throw error;
      return (data || []) as SummaryRow[];
    },
  });

  const stats = useMemo(() => {
    const list = rows || [];
    const lcCounts: Record<string, number> = { closed: 0, opened: 0, live: 0, completed: 0 };
    let withLive = 0;
    let withVideo = 0;
    for (const r of list) {
      const s = parseRoomState(r.room_state);
      lcCounts[s] = (lcCounts[s] || 0) + 1;
      if (r.kinescope_live_event_id) withLive++;
      if (r.kinescope_video_id) withVideo++;
    }
    const blockedLive = lcCounts.live;
    const deletable = list.length - blockedLive;
    return { total: list.length, withLive, withVideo, lcCounts, blockedLive, deletable };
  }, [rows]);

  // reset state on open
  useEffect(() => {
    if (open) {
      setMode("platform_only");
      setConfirmText("");
    }
  }, [open]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("live-events-delete", {
        body: { event_ids: eventIds, mode },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Не удалось удалить");
      return data.summary;
    },
    onSuccess: (summary) => {
      const parts: string[] = [`Удалено: ${summary.deleted}`];
      if (summary.skipped_live?.length) parts.push(`пропущено (live): ${summary.skipped_live.length}`);
      if (summary.provider_attempted) {
        parts.push(`Kinescope: ${summary.provider_deleted}/${summary.provider_attempted}`);
      }
      if (summary.degraded) {
        toast.warning(parts.join(", "), {
          description: `Часть provider-удалений упала (${summary.provider_failed?.length || 0}). Смотрите audit.`,
        });
      } else {
        toast.success(parts.join(", "));
      }
      qc.invalidateQueries({ queryKey: ["admin-live-events"] });
      qc.invalidateQueries({ queryKey: ["live-active-participants"] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (e: any) => {
      toast.error(`Ошибка удаления: ${e?.message || e}`);
    },
  });

  const isConfirmValid = confirmText.trim().toUpperCase() === CONFIRM_PHRASE;
  const canSubmit = !isLoading && stats.deletable > 0 && isConfirmValid && !deleteMutation.isPending;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {eventIds.length === 1 ? "Удалить эфир?" : `Удалить ${eventIds.length} эфиров?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 pt-2">
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Загрузка summary…
                </div>
              ) : (
                <>
                  {/* Lifecycle counters */}
                  <div className="text-sm">
                    <div className="font-medium mb-1.5 text-foreground">Состав выборки:</div>
                    <ul className="space-y-1 pl-1">
                      <li>Всего: <strong>{stats.total}</strong></li>
                      {(["closed", "opened", "completed"] as const).map((s) =>
                        stats.lcCounts[s] > 0 ? (
                          <li key={s} className="text-muted-foreground">
                            {roomStateShortLabels[s]}: <strong className="text-foreground">{stats.lcCounts[s]}</strong>
                          </li>
                        ) : null,
                      )}
                      {stats.blockedLive > 0 && (
                        <li className="text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>
                            В эфире: <strong>{stats.blockedLive}</strong> — будут пропущены (сначала завершите вебинар).
                          </span>
                        </li>
                      )}
                    </ul>
                  </div>

                  {/* Provider linkage */}
                  <div className="text-sm">
                    <div className="font-medium mb-1.5 text-foreground">Связи с Kinescope:</div>
                    <ul className="space-y-1 pl-1 text-muted-foreground">
                      <li>Live-сущности: <strong className="text-foreground">{stats.withLive}</strong></li>
                      <li>Видео-записи (replay): <strong className="text-foreground">{stats.withVideo}</strong></li>
                    </ul>
                  </div>

                  {/* Mode selection */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-foreground">Режим удаления:</Label>
                    <RadioGroup value={mode} onValueChange={(v) => setMode(v as DeleteMode)}>
                      <div className="flex items-start gap-2 rounded-md border p-2.5">
                        <RadioGroupItem value="platform_only" id="mode-local" className="mt-0.5" />
                        <Label htmlFor="mode-local" className="flex-1 cursor-pointer font-normal">
                          <div className="font-medium text-sm">Только в платформе</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Сущности в Kinescope сохранятся.
                          </div>
                        </Label>
                      </div>
                      <div className="flex items-start gap-2 rounded-md border p-2.5">
                        <RadioGroupItem value="platform_and_provider" id="mode-both" className="mt-0.5" />
                        <Label htmlFor="mode-both" className="flex-1 cursor-pointer font-normal">
                          <div className="font-medium text-sm">В платформе и в Kinescope</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Live events + видео-записи. Provider 404 = success (уже отсутствует).
                          </div>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* Type-to-confirm */}
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm-input" className="text-sm font-medium text-foreground">
                      Введите <code className="px-1 rounded bg-muted text-xs">{CONFIRM_PHRASE}</code> для подтверждения:
                    </Label>
                    <Input
                      id="confirm-input"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={CONFIRM_PHRASE}
                      autoComplete="off"
                    />
                  </div>

                  {stats.deletable === 0 && (
                    <div className="text-sm text-destructive border border-destructive/30 bg-destructive/5 rounded-md p-2">
                      Нет эфиров, доступных для удаления.
                    </div>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleteMutation.isPending}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={!canSubmit}
          >
            {deleteMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Удаление…</>
            ) : (
              `Удалить ${stats.deletable}`
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
