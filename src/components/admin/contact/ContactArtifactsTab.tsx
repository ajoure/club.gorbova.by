import { useState } from "react";
import { useContactArtifacts, type ContactArtifact, type ArtifactSourceType } from "@/hooks/useContactArtifacts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
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

      {/* Detail Drawer */}
      <Drawer open={!!selectedArtifact} onOpenChange={(open) => { if (!open) setSelectedArtifact(null); }}>
        <DrawerContent className="max-h-[85vh]">
          {selectedArtifact && (
            <>
              <DrawerHeader>
                <DrawerTitle className="text-base">{selectedArtifact.title}</DrawerTitle>
                <DrawerDescription className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    {SOURCE_TYPE_CONFIG[selectedArtifact.source_type].label}
                  </Badge>
                  {selectedArtifact.product_title && (
                    <Badge variant="secondary" className="text-xs">{selectedArtifact.product_title}</Badge>
                  )}
                  {selectedArtifact.submitted_at && (
                    <span className="text-xs">
                      {format(new Date(selectedArtifact.submitted_at), "dd MMMM yyyy, HH:mm", { locale: ru })}
                    </span>
                  )}
                </DrawerDescription>
              </DrawerHeader>
              <div className="px-4 pb-6 overflow-y-auto">
                {/* Summary */}
                {Object.keys(selectedArtifact.summary).length > 0 && (
                  <div className="mb-4 p-3 rounded-lg bg-muted/50">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Сводка</p>
                    <div className="space-y-1">
                      {Object.entries(selectedArtifact.summary).map(([key, value]) => (
                        <div key={key} className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{formatFieldLabel(key)}</span>
                          <span className="font-medium">{formatFieldValue(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Full payload */}
                {Object.keys(selectedArtifact.payload).length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Все данные</p>
                    <div className="space-y-1.5">
                      {Object.entries(selectedArtifact.payload).map(([key, value]) => (
                        <div key={key} className="p-2 rounded bg-muted/30">
                          <p className="text-xs text-muted-foreground mb-0.5">{formatFieldLabel(key)}</p>
                          <p className="text-sm break-words">{formatFieldValue(value)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">Нет подробных данных</p>
                )}
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>
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
