import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useContactArtifacts, type ContactArtifact, type ArtifactSourceType } from "@/hooks/useContactArtifacts";
import { ContactWebinarsView } from "./ContactWebinarsTab";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BookOpen, CheckCircle, ClipboardList, GraduationCap, ScrollText, ChevronRight, ChevronDown, Loader2, Layers, Video } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  PayloadSection,
  EmptyPayloadState,
} from "./ArtifactPayloadRenderer";
import { StudentProgressModal } from "@/components/admin/trainings/StudentProgressModal";
import { loadTrainingDetailContext, type TrainingDetailData } from "@/lib/training-detail-loader";

interface ContactArtifactsTabProps {
  profileId: string | null | undefined;
  userId: string | null | undefined;
  enabled: boolean;
  contactName?: string;
  isStaff?: boolean;
}

type FilterType = 'all' | 'forms' | 'training' | 'webinars';

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

// Training detail loader is now in src/lib/training-detail-loader.ts (shared)

// ── Grouping logic ───────────────────────────────────────────────────

interface ProductGroup {
  key: string;
  label: string;
  productId: string | null;
  items: ContactArtifact[];
  formCount: number;
  trainingCount: number;
}

function groupByProduct(artifacts: ContactArtifact[]): ProductGroup[] {
  const map = new Map<string, ContactArtifact[]>();
  const labelMap = new Map<string, string>();
  const pidMap = new Map<string, string | null>();

  for (const a of artifacts) {
    const key = a.product_id || a.training_title || '__ungrouped__';
    const label = a.product_title || a.training_title || 'Без продукта';
    if (!map.has(key)) {
      map.set(key, []);
      labelMap.set(key, label);
      pidMap.set(key, a.product_id || null);
    }
    map.get(key)!.push(a);
  }

  const groups: ProductGroup[] = [];
  for (const [key, items] of map) {
    groups.push({
      key,
      label: labelMap.get(key) || key,
      productId: pidMap.get(key) || null,
      items,
      formCount: items.filter(i => i.source_type === 'site_form').length,
      trainingCount: items.filter(i => i.source_type !== 'site_form').length,
    });
  }

  // Sort: groups with most recent activity first
  groups.sort((a, b) => {
    const latestA = new Date(a.items[0]?.submitted_at || 0).getTime();
    const latestB = new Date(b.items[0]?.submitted_at || 0).getTime();
    return latestB - latestA;
  });

  return groups;
}

// ── Main component ───────────────────────────────────────────────────

export function ContactArtifactsTab({ profileId, userId, enabled, contactName, isStaff = false }: ContactArtifactsTabProps) {
  const { artifacts, isLoading, formCount, trainingCount } = useContactArtifacts(profileId, userId, enabled);
  const [filter, setFilter] = useState<FilterType>('all');

  // Webinar count — distinct live_event_id из comments + questions; только для staff
  const { data: webinarCount = 0 } = useQuery({
    queryKey: ["contact-webinar-count", userId],
    queryFn: async () => {
      if (!userId) return 0;
      const [c, q] = await Promise.all([
        supabase.from("live_event_comments").select("live_event_id").eq("user_id", userId).limit(1000),
        supabase.from("live_event_questions").select("live_event_id").eq("user_id", userId).limit(1000),
      ]);
      const ids = new Set<string>();
      (c.data ?? []).forEach((r: any) => r.live_event_id && ids.add(r.live_event_id));
      (q.data ?? []).forEach((r: any) => r.live_event_id && ids.add(r.live_event_id));
      return ids.size;
    },
    enabled: enabled && isStaff && !!userId,
    staleTime: 60_000,
  });

  // Site form detail
  const [selectedForm, setSelectedForm] = useState<ContactArtifact | null>(null);

  // Training detail via StudentProgressModal
  const [trainingDetail, setTrainingDetail] = useState<TrainingDetailData | null>(null);
  const [trainingMeta, setTrainingMeta] = useState<{ lessonTitle: string; moduleId: string; lessonId: string } | null>(null);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingError, setTrainingError] = useState<string | null>(null);

  // Collapsible state — track which groups are collapsed (all open by default)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleArtifactClick = useCallback(async (artifact: ContactArtifact) => {
    if (artifact.source_type === 'site_form') {
      setSelectedForm(artifact);
      return;
    }
    if (artifact.source_type === 'quest_homework') {
      setSelectedForm(artifact);
      return;
    }

    // Training (lesson_answer / lesson_completion) → StudentProgressModal
    const artUserId = artifact.user_id;
    const artLessonId = artifact.lesson_id || artifact._lesson_id;
    if (!artUserId || !artLessonId) {
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
      const detail = await loadTrainingDetailContext(artUserId, artLessonId);
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

  const filtered = useMemo(() => artifacts.filter(a => {
    if (filter === 'forms') return a.source_type === 'site_form';
    if (filter === 'training') return a.source_type !== 'site_form';
    return true;
  }), [artifacts, filter]);

  const groups = useMemo(() => groupByProduct(filtered), [filtered]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  // Empty-state: только если нет ни artifacts, ни вебинарной активности у staff
  if (artifacts.length === 0 && (!isStaff || webinarCount === 0)) {
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
        {isStaff && (
          <Button
            variant={filter === 'webinars' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('webinars')}
            className="text-xs h-7"
            disabled={webinarCount === 0}
          >
            <Video className="w-3 h-3 mr-1" />
            Вебинары ({webinarCount})
          </Button>
        )}
      </div>

      {/* Контент: либо artifacts list, либо webinars view */}
      {filter === 'webinars' && isStaff && userId ? (
        <ContactWebinarsView userId={userId} />
      ) : (
        <div className="space-y-2">
          {groups.map(group => (
            <ProductGroupSection
              key={group.key}
              group={group}
              isOpen={!collapsedGroups.has(group.key)}
              onToggle={() => toggleGroup(group.key)}
              onItemClick={handleArtifactClick}
              contactName={contactName}
            />
          ))}
        </div>
      )}

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
          studentName={contactName}
          productTitle={groups.find(g => g.items.some(i => i.lesson_id === trainingMeta.lessonId || i._lesson_id === trainingMeta.lessonId))?.label}
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

// ── Product Group Section ────────────────────────────────────────────

function ProductGroupSection({
  group,
  isOpen,
  onToggle,
  onItemClick,
  contactName,
}: {
  group: ProductGroup;
  isOpen: boolean;
  onToggle: () => void;
  onItemClick: (a: ContactArtifact) => void;
  contactName?: string;
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <div className="bg-card border border-border/60 border-l-4 border-l-indigo-300 rounded-lg shadow-sm overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-accent/30 transition-colors text-left group"
          >
            <div className="w-7 h-7 rounded-md bg-indigo-50 flex items-center justify-center shrink-0">
              <Layers className="w-3.5 h-3.5 text-indigo-500" />
            </div>
            <span className="text-sm font-medium truncate flex-1">{group.label}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {group.trainingCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-emerald-50 text-emerald-600 border-emerald-200">
                  <GraduationCap className="w-2.5 h-2.5 mr-0.5" />
                  {group.trainingCount}
                </Badge>
              )}
              {group.formCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-blue-50 text-blue-600 border-blue-200">
                  <ClipboardList className="w-2.5 h-2.5 mr-0.5" />
                  {group.formCount}
                </Badge>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? '' : '-rotate-90'}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-0.5 px-2 pb-2">
            {group.items.map(artifact => (
              <ArtifactRow key={`${artifact.source_type}-${artifact.id}`} artifact={artifact} onClick={() => onItemClick(artifact)} />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ── Single artifact row ──────────────────────────────────────────────

function ArtifactRow({ artifact, onClick }: { artifact: ContactArtifact; onClick: () => void }) {
  const config = SOURCE_TYPE_CONFIG[artifact.source_type];
  const statusConfig = STATUS_CONFIG[artifact.status] || STATUS_CONFIG.new;
  const Icon = config.icon;

  const iconBgMap: Record<ArtifactSourceType, string> = {
    site_form: "bg-blue-50",
    lesson_answer: "bg-emerald-50",
    lesson_completion: "bg-green-50",
    quest_homework: "bg-amber-50",
  };

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2.5 px-2.5 py-2 rounded-md cursor-pointer hover:bg-accent/40 transition-colors"
      onClick={onClick}
    >
      {/* Top row on mobile: icon + title (+ type badge); inline on desktop */}
      <div className="flex items-start sm:items-center gap-2.5 min-w-0 sm:flex-1">
        <div className={`w-7 h-7 rounded-full ${iconBgMap[artifact.source_type]} flex items-center justify-center shrink-0`}>
          <Icon className={`w-3.5 h-3.5 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm break-words sm:truncate">{artifact.lesson_title || artifact.title}</span>
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 flex-shrink-0">{config.label}</Badge>
          </div>
          {artifact.subtitle && (
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">{artifact.subtitle}</div>
          )}
        </div>
      </div>

      {/* Bottom row on mobile (offset under title); inline on desktop */}
      <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap sm:flex-shrink-0 pl-9 sm:pl-0">
        {artifact.score !== null && artifact.max_score !== null && (
          <span className="text-[11px] text-muted-foreground">{artifact.score}/{artifact.max_score}</span>
        )}
        <Badge variant={statusConfig.variant} className="text-[9px] px-1 py-0 h-3.5">{statusConfig.label}</Badge>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {artifact.submitted_at ? format(new Date(artifact.submitted_at), "dd.MM.yy", { locale: ru }) : "—"}
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
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
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap pl-8">
            {artifact.submitted_at && (
              <span>{format(new Date(artifact.submitted_at), "dd MMMM yyyy, HH:mm", { locale: ru })}</span>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 bg-muted/5">
          {hasSummary && (
            <PayloadSection title="Основная информация" data={artifact.summary} variant="summary" />
          )}
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
