import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ExternalLink, AlertCircle, CheckCircle2, RefreshCw, Send, Eye, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ContentSectionSelector } from "@/components/admin/trainings/ContentSectionSelector";
import { ModuleTreeSelector } from "@/components/admin/trainings/ModuleTreeSelector";
import { toast } from "sonner";

export interface RecordingTabProps {
  eventId: string | null;
  /** Form state — replay_enabled */
  replayEnabled: boolean;
  onReplayEnabledChange: (v: boolean) => void;
  menuSectionKey: string;
  onMenuSectionKeyChange: (v: string) => void;
  parentModuleId: string | null;
  onParentModuleIdChange: (v: string | null) => void;
  /** Status read from live_events.metadata for the saved record */
  replayLessonId: string | null;
  replayPublishStatus: "idle" | "published" | "error";
  replayPublishError: string | null;
  /** Title for preview */
  title: string;
  /** Whether the live event has a kinescope_video_id (recording is ready) */
  hasKinescopeVideoId: boolean;
}

/**
 * Recording tab: target folder selection + manual publish actions + dry-run preview.
 * Phase 1 — manual publication only. Auto-publish on completion is Phase 2.
 */
export function RecordingTab(props: RecordingTabProps) {
  const {
    eventId,
    replayEnabled,
    onReplayEnabledChange,
    menuSectionKey,
    onMenuSectionKeyChange,
    parentModuleId,
    onParentModuleIdChange,
    replayLessonId,
    replayPublishStatus,
    replayPublishError,
    title,
    hasKinescopeVideoId,
  } = props;

  const [busy, setBusy] = useState<null | "publish" | "republish" | "sync_access" | "dry_run">(null);
  const [preview, setPreview] = useState<any | null>(null);

  const callAction = async (action: "publish" | "republish" | "sync_access" | "dry_run") => {
    if (!eventId) {
      toast.error("Сначала сохраните эфир");
      return;
    }
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("live-event-publish-replay", {
        body: { live_event_id: eventId, action },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (action === "dry_run") {
        setPreview(data);
      } else {
        toast.success(
          action === "publish"
            ? "Запись опубликована"
            : action === "republish"
              ? "Запись пересоздана"
              : "Доступы синхронизированы",
        );
        // Refresh dry_run preview after action
        const { data: dr } = await supabase.functions.invoke(
          "live-event-publish-replay",
          { body: { live_event_id: eventId, action: "dry_run" } },
        );
        setPreview(dr);
      }
    } catch (e: any) {
      toast.error(`Ошибка: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  // Lesson info if published
  const { data: lessonInfo } = useQuery({
    queryKey: ["recording-lesson", replayLessonId],
    queryFn: async () => {
      if (!replayLessonId) return null;
      const { data } = await supabase
        .from("training_lessons")
        .select("id, slug, title, module_id, training_modules(title, slug)")
        .eq("id", replayLessonId)
        .maybeSingle();
      return data;
    },
    enabled: !!replayLessonId,
  });

  const canPublish =
    replayEnabled && hasKinescopeVideoId && !!parentModuleId && !!menuSectionKey && !!eventId;

  const blockers: string[] = [];
  if (!replayEnabled) blockers.push("Запись не разрешена");
  if (!hasKinescopeVideoId) blockers.push("Запись Kinescope ещё не появилась (kinescope_video_id пуст)");
  if (!menuSectionKey) blockers.push("Не выбран раздел");
  if (!parentModuleId) blockers.push("Не выбран модуль (урок не может лежать в корне раздела)");
  if (!eventId) blockers.push("Сначала сохраните эфир");

  return (
    <div className="space-y-4">
      {/* Toggle */}
      <div className="flex items-start gap-3 rounded-lg p-3 bg-muted/20">
        <input
          type="checkbox"
          checked={replayEnabled}
          onChange={(e) => onReplayEnabledChange(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-input"
        />
        <div className="space-y-0.5">
          <Label className="text-sm cursor-pointer" onClick={() => onReplayEnabledChange(!replayEnabled)}>
            Разрешить доступ к записи после завершения
          </Label>
          <p className="text-xs text-muted-foreground">
            После завершения эфира вы сможете опубликовать запись как видео-урок в выбранной папке базы знаний/вебинаров.
          </p>
        </div>
      </div>

      {replayEnabled && (
        <>
          {/* Section selector */}
          <div className="space-y-2">
            <Label className="text-sm">Куда опубликовать запись</Label>
            <ContentSectionSelector
              value={menuSectionKey}
              onChange={(v) => {
                onMenuSectionKeyChange(v);
                onParentModuleIdChange(null);
              }}
            />
          </div>

          {/* Module selector */}
          {menuSectionKey && (
            <div className="space-y-2">
              <Label className="text-sm">Модуль (папка) для урока *</Label>
              <ModuleTreeSelector
                sectionKey={menuSectionKey}
                selectedId={parentModuleId}
                onSelect={onParentModuleIdChange}
                mode="select-module"
              />
              <p className="text-xs text-muted-foreground">
                Урок-видео должен находиться внутри модуля (ограничение базы знаний). Доступ к записи наследует
                правила доступа эфира из вкладки «Доступ».
              </p>
            </div>
          )}

          {/* Status */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Статус публикации
              </span>
              {replayPublishStatus === "published" && (
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Опубликовано
                </Badge>
              )}
              {replayPublishStatus === "error" && (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="h-3 w-3" /> Ошибка
                </Badge>
              )}
              {replayPublishStatus === "idle" && (
                <Badge variant="secondary">Не опубликовано</Badge>
              )}
            </div>
            {replayPublishError && (
              <p className="text-xs text-destructive">{replayPublishError}</p>
            )}
            {lessonInfo && (
              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  Урок: <span className="font-medium text-foreground">{lessonInfo.title}</span>
                </p>
                <p>
                  Модуль: {(lessonInfo.training_modules as any)?.title || "—"}
                </p>
                <p>
                  Slug: <code className="bg-muted px-1.5 py-0.5 rounded">{lessonInfo.slug}</code>
                </p>
              </div>
            )}
          </div>

          {/* Blockers */}
          {blockers.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
              <p className="text-xs font-medium text-amber-700">
                Для публикации нужно:
              </p>
              {blockers.map((b) => (
                <p key={b} className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <AlertCircle className="h-3 w-3 shrink-0" /> {b}
                </p>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => callAction("dry_run")}
              disabled={busy !== null || !eventId}
            >
              {busy === "dry_run" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Eye className="h-3.5 w-3.5 mr-1.5" />
              )}
              Preview
            </Button>
            {replayPublishStatus !== "published" && (
              <Button
                size="sm"
                onClick={() => callAction("publish")}
                disabled={busy !== null || !canPublish}
              >
                {busy === "publish" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                )}
                Опубликовать запись
              </Button>
            )}
            {replayPublishStatus === "published" && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => callAction("sync_access")}
                  disabled={busy !== null}
                >
                  {busy === "sync_access" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Синхронизировать доступ
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!confirm("Пересоздать урок? Старый урок будет удалён.")) return;
                    callAction("republish");
                  }}
                  disabled={busy !== null || !canPublish}
                >
                  {busy === "republish" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Пересоздать урок
                </Button>
                {lessonInfo && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const moduleSlug = (lessonInfo.training_modules as any)?.slug;
                      if (moduleSlug && lessonInfo.slug) {
                        window.open(`/library/${moduleSlug}/${lessonInfo.slug}`, "_blank");
                      }
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Открыть урок
                  </Button>
                )}
              </>
            )}
          </div>

          {/* Preview */}
          {preview && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Preview публикации
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground">Название урока:</span>
                <span className="font-medium">{preview.plan?.title || "—"}</span>
                <span className="text-muted-foreground">Slug:</span>
                <code className="bg-background px-1.5 py-0.5 rounded text-[11px]">
                  {preview.plan?.base_slug || "—"}
                </code>
                <span className="text-muted-foreground">Тип:</span>
                <span>video / kinescope</span>
                <span className="text-muted-foreground">Видео URL:</span>
                <code className="bg-background px-1.5 py-0.5 rounded text-[11px] truncate">
                  {preview.plan?.video_url || "—"}
                </code>
                <span className="text-muted-foreground">Section:</span>
                <span>{preview.plan?.menu_section_key || "—"}</span>
                <span className="text-muted-foreground">Module ID:</span>
                <span className="font-mono text-[10px]">{preview.plan?.module_id || "—"}</span>
                <span className="text-muted-foreground">Правила доступа эфира:</span>
                <span>{preview.access_snapshot_live_event?.length ?? 0} шт</span>
                <span className="text-muted-foreground">Текущие правила урока:</span>
                <span>{preview.access_current_for_lesson?.length ?? 0} шт</span>
              </div>
              {/* Diff */}
              {preview.existing_lesson_id && (
                <AccessDiff
                  liveRules={preview.access_snapshot_live_event || []}
                  lessonRules={preview.access_current_for_lesson || []}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AccessDiff({
  liveRules,
  lessonRules,
}: {
  liveRules: Array<{ product_id: string; tariff_id: string | null }>;
  lessonRules: Array<{ product_id: string; tariff_id: string | null }>;
}) {
  const key = (r: { product_id: string; tariff_id: string | null }) =>
    `${r.product_id}::${r.tariff_id || "*"}`;
  const liveSet = new Set(liveRules.map(key));
  const lessonSet = new Set(lessonRules.map(key));
  const toAdd = liveRules.filter((r) => !lessonSet.has(key(r)));
  const toRemove = lessonRules.filter((r) => !liveSet.has(key(r)));

  if (toAdd.length === 0 && toRemove.length === 0) {
    return (
      <p className="text-xs text-primary flex items-center gap-1.5">
        <CheckCircle2 className="h-3 w-3" /> Доступы синхронизированы
      </p>
    );
  }
  return (
    <div className="text-xs space-y-1 pt-2 border-t">
      <p className="font-medium text-muted-foreground">Diff доступов:</p>
      {toAdd.length > 0 && (
        <p className="text-primary">+ {toAdd.length} добавить</p>
      )}
      {toRemove.length > 0 && (
        <p className="text-destructive">− {toRemove.length} удалить</p>
      )}
    </div>
  );
}
