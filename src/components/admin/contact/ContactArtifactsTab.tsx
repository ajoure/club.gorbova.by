import { useState, useCallback } from "react";
import { useContactArtifacts, type ContactArtifact, type ArtifactSourceType } from "@/hooks/useContactArtifacts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BookOpen, CheckCircle, ClipboardList, GraduationCap, ScrollText, ChevronRight, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  PayloadSection,
  EmptyPayloadState,
} from "./ArtifactPayloadRenderer";
import { supabase } from "@/integrations/supabase/client";
import { StudentProgressModal } from "@/components/admin/trainings/StudentProgressModal";
import type { LessonProgressRecord, LessonBlock } from "@/components/admin/trainings/StudentProgressModal";

interface ContactArtifactsTabProps {
  profileId: string | null | undefined;
  userId: string | null | undefined;
  enabled: boolean;
}

type FilterType = 'all' | 'forms' | 'training';

const SOURCE_TYPE_CONFIG: Record<ArtifactSourceType, { label: string; icon: typeof ClipboardList; color: string }> = {
  site_form: { label: "Анкета", icon: ClipboardList, color: "text-blue-500" },
  lesson_answer: { label: "Ответ", icon: GraduationCap, color: "text-emerald-500" },
  lesson_completion: { label: "Прохождение", icon: CheckCircle, color: "text-green-500" },
  quest_homework: { label: "ДЗ", icon: ScrollText, color: "text-amber-500" },
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  completed: { label: "Завершён", variant: "default" },
  in_progress: { label: "В процессе", variant: "secondary" },
  new: { label: "Новый", variant: "outline" },
};

// ── Training detail lazy loader ──────────────────────────────────────

interface TrainingDetailData {
  record: LessonProgressRecord;
  lessonBlocks: LessonBlock[];
  blockResponses: Record<string, any>;
}

async function loadTrainingDetail(userId: string, lessonId: string): Promise<TrainingDetailData | null> {
  // 3 parallel queries
  const [stateRes, blocksRes, progressRes] = await Promise.all([
    supabase
      .from("lesson_progress_state")
      .select("id, user_id, lesson_id, state_json, completed_at, created_at, updated_at")
      .eq("user_id", userId)
      .eq("lesson_id", lessonId)
      .maybeSingle(),
    supabase
      .from("lesson_blocks")
      .select("id, block_type, content")
      .eq("lesson_id", lessonId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("user_lesson_progress")
      .select("block_id, response")
      .eq("user_id", userId)
      .eq("lesson_id", lessonId),
  ]);

  const lessonBlocks = (blocksRes.data || []) as LessonBlock[];
  
  // Build blockResponses map
  const blockResponses: Record<string, any> = {};
  (progressRes.data || []).forEach((row: any) => {
    if (row.block_id && row.response) {
      blockResponses[row.block_id] = row.response;
    }
  });

  // Build record — use lesson_progress_state if exists, otherwise synthesize minimal
  const stateRow = stateRes.data;
  const record: LessonProgressRecord = stateRow
    ? {
        id: stateRow.id,
        user_id: stateRow.user_id,
        lesson_id: stateRow.lesson_id,
        state_json: stateRow.state_json || {},
        completed_at: stateRow.completed_at,
        created_at: stateRow.created_at,
        updated_at: stateRow.updated_at,
      }
    : {
        // Fallback: no lesson_progress_state but we have block responses
        id: '',
        user_id: userId,
        lesson_id: lessonId,
        state_json: {},
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

  return { record, lessonBlocks, blockResponses };
}

// ── Main component ───────────────────────────────────────────────────

export function ContactArtifactsTab({ profileId, userId, enabled }: ContactArtifactsTabProps) {
  const { artifacts, isLoading, formCount, trainingCount } = useContactArtifacts(profileId, userId, enabled);
  const [filter, setFilter] = useState<FilterType>('all');
  
  // Site form detail
  const [selectedForm, setSelectedForm] = useState<ContactArtifact | null>(null);
  
  // Training detail via StudentProgressModal
  const [trainingDetail, setTrainingDetail] = useState<TrainingDetailData | null>(null);
  const [trainingMeta, setTrainingMeta] = useState<{ lessonTitle: string; moduleId: string; lessonId: string } | null>(null);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingError, setTrainingError] = useState<string | null>(null);

  const handleArtifactClick = useCallback(async (artifact: ContactArtifact) => {
    // Site forms → form detail dialog
    if (artifact.source_type === 'site_form') {
      setSelectedForm(artifact);
      return;
    }

    // Quest homework → fallback to form dialog (quest has its own data model)
    if (artifact.source_type === 'quest_homework') {
      setSelectedForm(artifact);
      return;
    }

    // Training (lesson_answer / lesson_completion) → StudentProgressModal
    const artUserId = artifact.user_id;
    const artLessonId = artifact.lesson_id || artifact._lesson_id;
    if (!artUserId || !artLessonId) {
      // Missing IDs — fallback to generic view
      setSelectedForm(artifact);
      return;
    }

    setTrainingLoading(true);
    setTrainingError(null);
    setTrainingMeta({
      lessonTitle: artifact.lesson_title || artifact.title,
      moduleId: artifact.module_id || '',
      lessonId: artLessonId,
    });

    try {
      const detail = await loadTrainingDetail(artUserId, artLessonId);
      if (!detail) {
        setTrainingError("Не удалось загрузить данные урока");
        return;
      }
      setTrainingDetail(detail);
    } catch (err) {
      console.error("[ContactArtifactsTab] training detail load error:", err);
      setTrainingError("Ошибка загрузки данных урока");
    } finally {
      setTrainingLoading(false);
    }
  }, []);

  const closeTraining = useCallback(() => {
    setTrainingDetail(null);
    setTrainingMeta(null);
    setTrainingError(null);
    setTrainingLoading(false);
  }, []);

  const filtered = artifacts.filter(a => {
    if (filter === 'forms') return a.source_type === 'site_form';
    if (filter === 'training') return a.source_type !== 'site_form';
    return true;
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <BookOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">Нет анкет и данных по обучению</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex gap-1.5 flex-wrap">
        <Button variant={filter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('all')} className="text-xs h-7">
          Все ({artifacts.length})
        </Button>
        <Button variant={filter === 'forms' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('forms')} className="text-xs h-7" disabled={formCount === 0}>
          <ClipboardList className="w-3 h-3 mr-1" />
          Анкеты ({formCount})
        </Button>
        <Button variant={filter === 'training' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('training')} className="text-xs h-7" disabled={trainingCount === 0}>
          <GraduationCap className="w-3 h-3 mr-1" />
          Обучение ({trainingCount})
        </Button>
      </div>

      {/* Artifact list */}
      <div className="space-y-2">
        {filtered.map(artifact => {
          const config = SOURCE_TYPE_CONFIG[artifact.source_type];
          const statusConfig = STATUS_CONFIG[artifact.status] || STATUS_CONFIG.new;
          const Icon = config.icon;

          return (
            <Card
              key={`${artifact.source_type}-${artifact.id}`}
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => handleArtifactClick(artifact)}
            >
              <CardContent className="p-3 flex items-center gap-3">
                <div className={`flex-shrink-0 ${config.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{artifact.title}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0">{config.label}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                    {artifact.subtitle && <span className="truncate">{artifact.subtitle}</span>}
                    {artifact.product_title && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{artifact.product_title}</Badge>
                    )}
                    {artifact.score !== null && artifact.max_score !== null && (
                      <span>{artifact.score}/{artifact.max_score}</span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 flex items-center gap-2">
                  <div className="text-right">
                    <Badge variant={statusConfig.variant} className="text-[10px] px-1.5 py-0 h-4">{statusConfig.label}</Badge>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {artifact.submitted_at ? format(new Date(artifact.submitted_at), "dd.MM.yy HH:mm", { locale: ru }) : "—"}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Site Form Detail Dialog */}
      <SiteFormDetailDialog artifact={selectedForm} onClose={() => setSelectedForm(null)} />

      {/* Training Detail — reuse StudentProgressModal */}
      {trainingDetail && trainingMeta && (
        <StudentProgressModal
          record={trainingDetail.record}
          lessonBlocks={trainingDetail.lessonBlocks}
          open={true}
          onClose={closeTraining}
          blockResponses={trainingDetail.blockResponses}
          lessonId={trainingMeta.lessonId}
          lessonTitle={trainingMeta.lessonTitle}
          moduleId={trainingMeta.moduleId}
        />
      )}

      {/* Training loading overlay */}
      {trainingLoading && (
        <Dialog open onOpenChange={() => closeTraining()}>
          <DialogContent className="sm:max-w-md">
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Загрузка данных урока…</p>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Training error state */}
      {trainingError && !trainingLoading && !trainingDetail && (
        <Dialog open onOpenChange={() => closeTraining()}>
          <DialogContent className="sm:max-w-md">
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-destructive">{trainingError}</p>
              <Button variant="outline" size="sm" onClick={closeTraining}>Закрыть</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ── Site Form Detail Dialog (forms only) ─────────────────────────────

function SiteFormDetailDialog({ artifact, onClose }: { artifact: ContactArtifact | null; onClose: () => void }) {
  if (!artifact) return null;

  const config = SOURCE_TYPE_CONFIG[artifact.source_type];
  const statusConfig = STATUS_CONFIG[artifact.status] || STATUS_CONFIG.new;
  const hasPayload = Object.keys(artifact.payload).length > 0;
  const hasSummary = Object.keys(artifact.summary).length > 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-3xl lg:max-w-5xl max-h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b flex-shrink-0 space-y-2">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 ${config.color}`}>
              <config.icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base font-semibold leading-snug">{artifact.title}</DialogTitle>
              <DialogDescription asChild>
                <div className="flex items-center gap-2 flex-wrap mt-1.5">
                  <Badge variant="outline" className="text-[11px]">{config.label}</Badge>
                  <Badge variant={statusConfig.variant} className="text-[11px]">{statusConfig.label}</Badge>
                  {artifact.product_title && (
                    <Badge variant="secondary" className="text-[11px]">{artifact.product_title}</Badge>
                  )}
                </div>
              </DialogDescription>
            </div>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap pl-8">
            {artifact.submitted_at && (
              <span>{format(new Date(artifact.submitted_at), "dd MMMM yyyy, HH:mm", { locale: ru })}</span>
            )}
          </div>
        </DialogHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 bg-muted/5">
          {/* Summary section */}
          {hasSummary && (
            <PayloadSection title="Основная информация" data={artifact.summary} variant="summary" />
          )}

          {/* Main payload */}
          {hasPayload ? (
            <PayloadSection title="Данные формы" data={artifact.payload} variant="full" />
          ) : (
            <EmptyPayloadState />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
