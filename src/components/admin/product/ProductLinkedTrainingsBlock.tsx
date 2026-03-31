import { useState } from "react";
import { useProductTrainings, useAvailableTrainingsForBind, type LinkedTraining, type TrainingBindingDiagnostics } from "@/hooks/useProductTrainings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { BookOpen, ChevronDown, ChevronRight, Link2, Unlink, AlertTriangle, Search, Info, RefreshCw, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RebindPreview } from "@/hooks/useProductTrainings";

interface Props {
  productId: string;
}

// --- Training tree item ---
function TrainingTreeItem({ training, diagnostics, level = 0, onUnbind }: {
  training: LinkedTraining;
  diagnostics?: TrainingBindingDiagnostics;
  level?: number;
  onUnbind?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(level === 0 && training.children.length > 0);
  const hasChildren = training.children.length > 0;
  const totalLessons = training.lesson_count + training.children.reduce((s, c) => s + c.lesson_count, 0);

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors group",
          level > 0 && "ml-5"
        )}
      >
        {hasChildren ? (
          <button onClick={() => setExpanded(!expanded)} className="p-0.5">
            {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        ) : (
          <span className="w-[18px]" />
        )}

        <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />

        <span className="text-sm font-medium flex-1 min-w-0 truncate">{training.title}</span>

        {training.public_id && (
          <Badge variant="outline" className="text-[10px] shrink-0 font-mono">{training.public_id}</Badge>
        )}

        {!training.is_active && (
          <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">Неактивен</Badge>
        )}

        <span className="text-[11px] text-muted-foreground shrink-0">
          {totalLessons} {totalLessons === 1 ? "урок" : totalLessons >= 2 && totalLessons <= 4 ? "урока" : "уроков"}
        </span>

        {/* Diagnostics badges for root */}
        {level === 0 && diagnostics && (
          <>
            {diagnostics.legacy_module_access_count > 0 && (
              <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-300 shrink-0">
                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                legacy
              </Badge>
            )}
          </>
        )}

        {level === 0 && onUnbind && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={() => onUnbind(training.id)}
            title="Отвязать тренинг"
          >
            <Unlink className="h-3 w-3 text-muted-foreground" />
          </Button>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {training.children.map(child => (
            <TrainingTreeItem key={child.id} training={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Bind Dialog ---
function BindTrainingDialog({ open, onOpenChange, productId, onBind }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  onBind: (trainingId: string) => Promise<void>;
}) {
  const { data } = useAvailableTrainingsForBind(productId);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"free" | "current" | "all">("free");
  const [binding, setBinding] = useState(false);

  const items = filter === "free" ? data?.free
    : filter === "current" ? data?.currentProduct
    : data?.all;

  const filtered = (items || []).filter(m => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return m.title.toLowerCase().includes(q) || (m.public_id || "").toLowerCase().includes(q);
  });

  const handleBind = async (id: string) => {
    setBinding(true);
    try {
      await onBind(id);
      onOpenChange(false);
    } finally {
      setBinding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Привязать тренинг</DialogTitle>
          <DialogDescription>Выберите тренинг для привязки к продукту</DialogDescription>
        </DialogHeader>

        {/* Filters */}
        <div className="flex gap-1 p-0.5 rounded-full bg-muted/40 border border-border/20 w-fit">
          {([
            { key: "free", label: `Свободные (${data?.free?.length || 0})` },
            { key: "current", label: `Этого продукта (${data?.currentProduct?.length || 0})` },
            { key: "all", label: "Все" },
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-all",
                filter === f.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск тренинга..."
            className="pl-8 h-9"
          />
        </div>

        <div className="max-h-[300px] overflow-y-auto border rounded-md">
          {filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              {filter === "free" ? "Нет свободных тренингов" : "Ничего не найдено"}
            </div>
          ) : (
            <div className="p-1.5 space-y-0.5">
              {filtered.map(m => {
                const isOtherProduct = m.product_id && m.product_id !== productId;
                return (
                  <button
                    key={m.id}
                    onClick={() => !isOtherProduct && handleBind(m.id)}
                    disabled={binding || !!isOtherProduct}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors",
                      isOtherProduct
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:bg-muted/50 cursor-pointer"
                    )}
                  >
                    <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{m.title}</span>
                    {m.public_id && (
                      <Badge variant="outline" className="text-[10px] font-mono shrink-0">{m.public_id}</Badge>
                    )}
                    {!m.is_active && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">Неактивен</Badge>
                    )}
                    {isOtherProduct && (
                      <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 shrink-0">
                        Другой продукт
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Main Block ---
export function ProductLinkedTrainingsBlock({ productId }: Props) {
  const { trainings, diagnostics, isLoading, bindTraining, unbindTraining } = useProductTrainings(productId);
  const [bindOpen, setBind] = useState(false);
  const [unbindTarget, setUnbindTarget] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const handleBind = async (trainingId: string) => {
    await bindTraining({ trainingId, productId });
  };

  const handleUnbind = async () => {
    if (!unbindTarget) return;
    await unbindTraining(unbindTarget);
    setUnbindTarget(null);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          Загрузка тренингов…
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">Тренинги этого продукта</CardTitle>
              <Badge variant="outline" className="text-[10px]">{trainings.length}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setBind(true)} className="gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                Привязать
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {trainings.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <BookOpen className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">К продукту не привязано ни одного тренинга</p>
              <Button variant="outline" size="sm" onClick={() => setBind(true)} className="gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                Привязать тренинг
              </Button>
            </div>
          ) : (
            <Collapsible open={expanded} onOpenChange={setExpanded}>
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-2">
                  <ChevronDown className={cn("h-3 w-3 transition-transform", !expanded && "-rotate-90")} />
                  {expanded ? "Свернуть" : "Развернуть"} дерево
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-0.5">
                  {trainings.map(t => (
                    <TrainingTreeItem
                      key={t.id}
                      training={t}
                      diagnostics={diagnostics[t.id]}
                      onUnbind={(id) => setUnbindTarget(id)}
                    />
                  ))}
                </div>
              </CollapsibleContent>
              {!expanded && (
                <div className="space-y-0.5">
                  {trainings.map(t => (
                    <div key={t.id} className="flex items-center gap-2 py-1 px-2">
                      <BookOpen className="h-3.5 w-3.5 text-primary" />
                      <span className="text-sm">{t.title}</span>
                      {t.public_id && <Badge variant="outline" className="text-[10px] font-mono">{t.public_id}</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </Collapsible>
          )}

          {/* Layer 2 placeholder — training_content rules (PATCH B) */}
          {trainings.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Shield className="h-3.5 w-3.5" />
                <span>Правила гранулярности доступа к контенту</span>
                <Badge variant="outline" className="text-[9px]">Запланировано</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Настройка частичного доступа к урокам и модулям по тарифам будет доступна в следующем обновлении.
              </p>
            </>
          )}

          {/* Diagnostics */}
          {trainings.length > 0 && Object.values(diagnostics).some(d => d.has_conflict || d.legacy_module_access_count > 0) && (
            <>
              <Separator className="my-4" />
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <Info className="h-3 w-3" />
                    Диагностика
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-1">
                  {trainings.map(t => {
                    const d = diagnostics[t.id];
                    if (!d) return null;
                    return (
                      <div key={t.id} className="flex items-center gap-2 text-[11px] text-muted-foreground px-2 py-1 rounded-md bg-muted/30">
                        <span className="font-medium">{t.title}</span>
                        <Badge variant="outline" className="text-[9px]">{d.binding_source}</Badge>
                        {d.legacy_module_access_count > 0 && (
                          <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-300">
                            legacy: {d.legacy_module_access_count}
                          </Badge>
                        )}
                        {d.training_content_rules_count > 0 && (
                          <Badge variant="outline" className="text-[9px]">
                            rules: {d.training_content_rules_count}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
        </CardContent>
      </Card>

      {/* Bind Dialog */}
      <BindTrainingDialog
        open={bindOpen}
        onOpenChange={setBind}
        productId={productId}
        onBind={handleBind}
      />

      {/* Unbind Confirm */}
      <AlertDialog open={!!unbindTarget} onOpenChange={(open) => !open && setUnbindTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отвязать тренинг?</AlertDialogTitle>
            <AlertDialogDescription>
              Тренинг и все дочерние модули будут отвязаны от этого продукта. Пользователи потеряют доступ к нему через этот продукт.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnbind}>Отвязать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
