import { useState } from "react";
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
import { FileText, BookOpen, CheckCircle, Clock, ClipboardList, GraduationCap, ScrollText, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface ContactArtifactsTabProps {
  profileId: string | null | undefined;
  userId: string | null | undefined;
  enabled: boolean;
}

type FilterType = 'all' | 'forms' | 'training';

const SOURCE_TYPE_CONFIG: Record<ArtifactSourceType, { label: string; icon: typeof FileText; color: string }> = {
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

export function ContactArtifactsTab({ profileId, userId, enabled }: ContactArtifactsTabProps) {
  const { artifacts, isLoading, formCount, trainingCount } = useContactArtifacts(profileId, userId, enabled);
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedArtifact, setSelectedArtifact] = useState<ContactArtifact | null>(null);

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
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
          className="text-xs h-7"
        >
          Все ({artifacts.length})
        </Button>
        <Button
          variant={filter === 'forms' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('forms')}
          className="text-xs h-7"
          disabled={formCount === 0}
        >
          <ClipboardList className="w-3 h-3 mr-1" />
          Анкеты ({formCount})
        </Button>
        <Button
          variant={filter === 'training' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('training')}
          className="text-xs h-7"
          disabled={trainingCount === 0}
        >
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
              onClick={() => setSelectedArtifact(artifact)}
            >
              <CardContent className="p-3 flex items-center gap-3">
                <div className={`flex-shrink-0 ${config.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{artifact.title}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0">
                      {config.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                    {artifact.subtitle && <span className="truncate">{artifact.subtitle}</span>}
                    {artifact.product_title && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                        {artifact.product_title}
                      </Badge>
                    )}
                    {artifact.score !== null && artifact.max_score !== null && (
                      <span>{artifact.score}/{artifact.max_score}</span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 flex items-center gap-2">
                  <div className="text-right">
                    <Badge variant={statusConfig.variant} className="text-[10px] px-1.5 py-0 h-4">
                      {statusConfig.label}
                    </Badge>
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

      {/* Detail Modal */}
      <Dialog open={!!selectedArtifact} onOpenChange={(open) => { if (!open) setSelectedArtifact(null); }}>
        <DialogContent className="sm:max-w-2xl lg:max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
          {selectedArtifact && (
            <>
              <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
                <DialogTitle className="text-base font-semibold">{selectedArtifact.title}</DialogTitle>
                <DialogDescription asChild>
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <Badge variant="outline" className="text-xs">
                      {SOURCE_TYPE_CONFIG[selectedArtifact.source_type].label}
                    </Badge>
                    {selectedArtifact.product_title && (
                      <Badge variant="secondary" className="text-xs">{selectedArtifact.product_title}</Badge>
                    )}
                    {selectedArtifact.submitted_at && (
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(selectedArtifact.submitted_at), "dd MMMM yyyy, HH:mm", { locale: ru })}
                      </span>
                    )}
                  </div>
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {/* Summary */}
                {Object.keys(selectedArtifact.summary).length > 0 && (
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Сводка</p>
                    <div className="space-y-2">
                      {Object.entries(selectedArtifact.summary).map(([key, value]) => (
                        <div key={key} className="flex justify-between items-baseline gap-4 text-sm">
                          <span className="text-muted-foreground shrink-0">{formatFieldLabel(key)}</span>
                          <span className="font-medium text-right">{formatFieldValue(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Full payload */}
                {Object.keys(selectedArtifact.payload).length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Все данные</p>
                    <div className="rounded-lg border divide-y">
                      {Object.entries(selectedArtifact.payload).map(([key, value]) => {
                        const isComplex = typeof value === 'object' && value !== null;
                        return (
                          <div key={key} className="px-4 py-3">
                            <p className="text-xs text-muted-foreground mb-1">{formatFieldLabel(key)}</p>
                            {isComplex ? (
                              <div className="overflow-x-auto">
                                <pre className="text-xs font-mono bg-muted/40 rounded-md p-3 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                                  {JSON.stringify(value, null, 2)}
                                </pre>
                              </div>
                            ) : (
                              <p className="text-sm break-words">{formatFieldValue(value)}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">Нет подробных данных</p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
