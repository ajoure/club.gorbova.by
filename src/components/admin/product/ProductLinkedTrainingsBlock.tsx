import { useState, useMemo } from "react";
import { useProductTrainings, useAvailableTrainingsForBind, type LinkedTraining, type TrainingBindingDiagnostics, type RebindPreview, type UnbindPreview } from "@/hooks/useProductTrainings";
import { useTrainingContentRulesForProduct, type TrainingContentRule, type TrainingContentConditions } from "@/hooks/useTrainingContentRules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { BookOpen, ChevronDown, ChevronRight, Link2, Unlink, AlertTriangle, Search, Info, Shield, ArrowRight, Loader2, Ban, CheckCircle2, LayoutGrid, List, Pencil, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  productId: string;
}

/** Recursively count all lessons in a training subtree */
function countTreeLessons(node: LinkedTraining): number {
  return node.lesson_count + node.children.reduce((sum, child) => sum + countTreeLessons(child), 0);
}

/** Recursively count all modules (children) in a training subtree (excluding root) */
function countTreeModules(node: LinkedTraining): number {
  return node.children.reduce((sum, child) => sum + 1 + countTreeModules(child), 0);
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
  const totalLessons = countTreeLessons(training);

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
          {totalLessons > 0
            ? `${totalLessons} ${totalLessons === 1 ? "урок" : totalLessons >= 2 && totalLessons <= 4 ? "урока" : "уроков"}`
            : training.children.length === 0 ? "—" : `${totalLessons} уроков`
          }
        </span>

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

// --- Preview Stat Row ---
function PreviewRow({ label, value, warning, danger }: { label: string; value: string | number; warning?: boolean; danger?: boolean }) {
  return (
    <div className={cn(
      "flex items-center justify-between py-1.5 px-3 rounded-md text-sm",
      danger ? "bg-destructive/10 text-destructive" : warning ? "bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200" : "bg-muted/30"
    )}>
      <span>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

// --- Rebind Preview Dialog ---
function RebindPreviewDialog({ open, onOpenChange, preview, trainingTitle, onConfirm, isExecuting }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: RebindPreview | null;
  trainingTitle: string;
  onConfirm: () => void;
  isExecuting: boolean;
}) {
  if (!preview) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Перепривязка тренинга</DialogTitle>
          <DialogDescription>Тренинг «{trainingTitle}» будет перемещён к другому продукту</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Product transition */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/40 border border-border/30">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-muted-foreground">Текущий продукт</p>
              <p className="text-sm font-medium truncate">{preview.current_product?.name || "—"}</p>
              {preview.current_product?.public_id && (
                <p className="text-[10px] font-mono text-muted-foreground">{preview.current_product.public_id}</p>
              )}
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-muted-foreground">Новый продукт</p>
              <p className="text-sm font-medium truncate">{preview.new_product.name}</p>
              {preview.new_product.public_id && (
                <p className="text-[10px] font-mono text-muted-foreground">{preview.new_product.public_id}</p>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="space-y-1">
            <PreviewRow label="Дочерних модулей получат новый product_id" value={preview.descendant_count} />
            <PreviewRow label="Уроков затронуто" value={preview.lesson_count} />
            <PreviewRow
              label="Правил доступа будет деактивировано"
              value={preview.training_content_rules_count}
              warning={preview.training_content_rules_count > 0}
            />
            <PreviewRow
              label="Старые настройки доступа"
              value={preview.legacy_module_access_count}
              warning={preview.legacy_module_access_count > 0}
            />
            {preview.has_active_entitlements && (
              <PreviewRow
                label="У пользователей есть активные entitlements на старый продукт"
                value="⚠ Есть"
                warning
              />
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExecuting}>Отмена</Button>
          <Button onClick={onConfirm} disabled={isExecuting} className="gap-1.5">
            {isExecuting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Перепривязать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Unbind Preview Dialog ---
function UnbindPreviewDialog({ open, onOpenChange, preview, onConfirm, isExecuting }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: UnbindPreview | null;
  onConfirm: () => void;
  isExecuting: boolean;
}) {
  if (!preview) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Отвязать тренинг</DialogTitle>
          <DialogDescription>Тренинг «{preview.training_title}» и все дочерние модули будут отвязаны от продукта</DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <PreviewRow label="Дочерних модулей" value={preview.descendant_count} />
          <PreviewRow label="Уроков" value={preview.lesson_count} />
          <PreviewRow
            label="Активных правил доступа к контенту"
            value={preview.training_content_rules_count}
            danger={preview.training_content_rules_count > 0}
          />
          <PreviewRow
            label="Старые настройки доступа"
            value={preview.legacy_module_access_count}
            warning={preview.legacy_module_access_count > 0}
          />
          {preview.has_active_entitlements && (
            <PreviewRow
              label="Активные entitlements на продукт"
              value="⚠ Есть — пользователи потеряют доступ"
              warning
            />
          )}
        </div>

        {!preview.can_unbind && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <Ban className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Невозможно отвязать: есть активные правила доступа к контенту. Сначала деактивируйте их.</span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExecuting}>Отмена</Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isExecuting || !preview.can_unbind}
            className="gap-1.5"
          >
            {isExecuting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Отвязать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Bind Dialog (with rebind & unbind support) ---
function BindTrainingDialog({ open, onOpenChange, productId, onBind, onRebindRequest, onUnbindRequest }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  onBind: (trainingId: string) => Promise<void>;
  onRebindRequest: (trainingId: string, trainingTitle: string) => void;
  onUnbindRequest: (trainingId: string) => void;
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

  const handleClick = async (m: { id: string; title: string; product_id: string | null }) => {
    const isOtherProduct = m.product_id && m.product_id !== productId;
    const isCurrent = m.product_id === productId;
    if (isCurrent) return; // Already bound — actions are inline
    if (isOtherProduct) {
      onRebindRequest(m.id, m.title);
      onOpenChange(false);
      return;
    }
    setBinding(true);
    try {
      await onBind(m.id);
      onOpenChange(false);
    } finally {
      setBinding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Привязать тренинг</DialogTitle>
          <DialogDescription>Выберите тренинг для привязки к продукту</DialogDescription>
        </DialogHeader>

        {/* Sticky filters */}
        <div className="flex-shrink-0 space-y-2">
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
        </div>

        {/* Scrollable list */}
        <div className="flex-1 min-h-0 max-h-[400px] overflow-y-auto border rounded-md">
          {filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              {filter === "free" ? "Нет свободных тренингов" : "Ничего не найдено"}
            </div>
          ) : (
            <div className="p-1.5 space-y-0.5">
              {filtered.map(m => {
                const isOtherProduct = m.product_id && m.product_id !== productId;
                const isCurrent = m.product_id === productId;
                const ownerName = (m as any).owner_product_name || null;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "w-full flex items-start gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors",
                      isCurrent
                        ? "bg-muted/30"
                        : isOtherProduct
                          ? "hover:bg-amber-50/50 dark:hover:bg-amber-900/10 cursor-pointer border border-transparent hover:border-amber-200/50"
                          : "hover:bg-muted/50 cursor-pointer"
                    )}
                  >
                    <BookOpen className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                    <div
                      className={cn("flex-1 min-w-0", !isCurrent && "cursor-pointer")}
                      onClick={() => !isCurrent && handleClick(m)}
                    >
                      <span
                        className="line-clamp-3 leading-snug block"
                        title={m.title}
                      >
                        {m.title}
                      </span>
                      <span
                        className="text-[11px] text-muted-foreground block line-clamp-1 mt-0.5"
                        title={ownerName || "не привязан"}
                      >
                        Владелец: {ownerName || "не привязан"}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0 self-start ml-3">
                      {m.public_id && (
                        <Badge variant="outline" className="text-[10px] font-mono">{m.public_id}</Badge>
                      )}
                      {!m.is_active && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">Неактивен</Badge>
                      )}
                      {isOtherProduct && (
                        <>
                          <Badge
                            variant="outline"
                            className="text-[10px] text-amber-600 border-amber-300 cursor-pointer"
                            onClick={() => handleClick(m)}
                          >
                            Перепривязать к этому продукту
                          </Badge>
                          <span className="text-[10px] text-muted-foreground italic mt-0.5">
                            Использование через правило доступа — в разработке
                          </span>
                        </>
                      )}
                      {isCurrent && (
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                            Привязан
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-[10px] gap-0.5 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUnbindRequest(m.id);
                              onOpenChange(false);
                            }}
                          >
                            <Unlink className="h-2.5 w-2.5" />
                            Отвязать
                          </Button>
                        </div>
                      )}
                      {!isCurrent && !isOtherProduct && (
                        <Badge
                          variant="outline"
                          className="text-[10px] text-primary cursor-pointer"
                          onClick={() => handleClick(m)}
                        >
                          Привязать
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Matrix View ---
function TrainingMatrixView({ trainings, diagnostics, viewMode }: {
  trainings: LinkedTraining[];
  diagnostics: Record<string, TrainingBindingDiagnostics>;
  viewMode: "summary" | "expanded";
}) {
  if (trainings.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="grid gap-2">
        {trainings.map(t => {
          const d = diagnostics[t.id];
          const totalLessons = countTreeLessons(t);
          const totalModules = countTreeModules(t);
          const hasRules = d && d.training_content_rules_count > 0;

          return (
            <div key={t.id} className="border rounded-lg overflow-hidden">
              {/* Root training row */}
              <div className="flex items-center gap-3 px-3 py-2 bg-muted/20">
                <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{t.title}</span>
                  {t.public_id && (
                    <span className="ml-2 text-[10px] font-mono text-muted-foreground">{t.public_id}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!t.is_active && (
                    <Badge variant="outline" className="text-[9px] text-muted-foreground">Неактивен</Badge>
                  )}
                  <Badge variant="outline" className="text-[9px]">
                    {totalModules} {totalModules === 1 ? "модуль" : totalModules >= 2 && totalModules <= 4 ? "модуля" : "модулей"}
                  </Badge>
                  {totalLessons > 0 || t.children.length > 0 ? (
                    <Badge variant="outline" className="text-[9px]">
                      {totalLessons} {totalLessons === 1 ? "урок" : totalLessons >= 2 && totalLessons <= 4 ? "урока" : "уроков"}
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className={cn("text-[9px]", hasRules ? "text-blue-600 border-blue-300" : "text-muted-foreground")}>
                    {hasRules ? "Ограничение доступа настроено" : "Полный доступ"}
                  </Badge>
                </div>
              </div>

              {/* Expanded: children */}
              {viewMode === "expanded" && t.children.length > 0 && (
                <div className="border-t">
                  {t.children.map(child => (
                    <div key={child.id} className="flex items-center gap-2 px-3 py-1.5 pl-8 text-sm border-b last:border-b-0 bg-background">
                      <BookOpen className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-muted-foreground">{child.title}</span>
                      {child.public_id && (
                        <span className="text-[10px] font-mono text-muted-foreground">{child.public_id}</span>
                      )}
                      {countTreeLessons(child) > 0 ? (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {countTreeLessons(child)} {countTreeLessons(child) === 1 ? "урок" : countTreeLessons(child) >= 2 && countTreeLessons(child) <= 4 ? "урока" : "уроков"}
                        </span>
                      ) : child.children.length > 0 ? null : (
                        <span className="text-[10px] text-muted-foreground shrink-0">—</span>
                      )}
                      {!child.is_active && (
                        <Badge variant="outline" className="text-[9px] text-muted-foreground">Неактивен</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Main Block ---
export function ProductLinkedTrainingsBlock({ productId }: Props) {
  const { trainings, diagnostics, isLoading, bindTraining, unbindTraining, rebindTraining, getRebindPreview, getUnbindPreview } = useProductTrainings(productId);
  const { data: contentRules = [] } = useTrainingContentRulesForProduct(productId);
  const [bindOpen, setBind] = useState(false);
  const [viewMode, setViewMode] = useState<"tree" | "matrix-summary" | "matrix-expanded">("tree");

  // Rebind state
  const [rebindPreview, setRebindPreview] = useState<RebindPreview | null>(null);
  const [rebindTrainingId, setRebindTrainingId] = useState<string | null>(null);
  const [rebindTrainingTitle, setRebindTrainingTitle] = useState("");
  const [rebindDialogOpen, setRebindDialogOpen] = useState(false);
  const [rebindLoading, setRebindLoading] = useState(false);
  const [rebindExecuting, setRebindExecuting] = useState(false);

  // Unbind state
  const [unbindPreview, setUnbindPreview] = useState<UnbindPreview | null>(null);
  const [unbindTrainingId, setUnbindTrainingId] = useState<string | null>(null);
  const [unbindDialogOpen, setUnbindDialogOpen] = useState(false);
  const [unbindLoading, setUnbindLoading] = useState(false);
  const [unbindExecuting, setUnbindExecuting] = useState(false);

  const handleBind = async (trainingId: string) => {
    await bindTraining({ trainingId, productId });
  };

  const handleRebindRequest = async (trainingId: string, trainingTitle: string) => {
    setRebindTrainingId(trainingId);
    setRebindTrainingTitle(trainingTitle);
    setRebindDialogOpen(true);
    setRebindLoading(true);
    try {
      const preview = await getRebindPreview(trainingId, productId);
      setRebindPreview(preview);
    } finally {
      setRebindLoading(false);
    }
  };

  const handleRebindConfirm = async () => {
    if (!rebindTrainingId) return;
    setRebindExecuting(true);
    try {
      await rebindTraining({ trainingId: rebindTrainingId, newProductId: productId });
      setRebindDialogOpen(false);
      setRebindPreview(null);
      setRebindTrainingId(null);
    } finally {
      setRebindExecuting(false);
    }
  };

  const handleUnbindRequest = async (trainingId: string) => {
    const training = trainings.find(t => t.id === trainingId);
    setUnbindTrainingId(trainingId);
    setUnbindDialogOpen(true);
    setUnbindLoading(true);
    try {
      const preview = await getUnbindPreview(trainingId);
      setUnbindPreview(preview);
    } finally {
      setUnbindLoading(false);
    }
  };

  const handleUnbindConfirm = async () => {
    if (!unbindTrainingId) return;
    setUnbindExecuting(true);
    try {
      await unbindTraining(unbindTrainingId);
      setUnbindDialogOpen(false);
      setUnbindPreview(null);
      setUnbindTrainingId(null);
    } finally {
      setUnbindExecuting(false);
    }
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
            <div className="flex items-center gap-1.5">
              {/* View mode toggle */}
              {trainings.length > 0 && (
                <div className="flex gap-0.5 p-0.5 rounded-md bg-muted/40 border border-border/20">
                  <button
                    onClick={() => setViewMode("tree")}
                    className={cn("p-1 rounded", viewMode === "tree" ? "bg-background shadow-sm" : "hover:bg-muted/60")}
                    title="Дерево"
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setViewMode(viewMode === "matrix-expanded" ? "matrix-summary" : "matrix-expanded")}
                    className={cn("p-1 rounded", viewMode.startsWith("matrix") ? "bg-background shadow-sm" : "hover:bg-muted/60")}
                    title="Матрица"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
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
          ) : viewMode === "tree" ? (
            <div className="space-y-0.5">
              {trainings.map(t => (
                <TrainingTreeItem
                  key={t.id}
                  training={t}
                  diagnostics={diagnostics[t.id]}
                  onUnbind={handleUnbindRequest}
                />
              ))}
            </div>
          ) : (
            <>
              {viewMode.startsWith("matrix") && (
                <div className="flex items-center gap-1.5 mb-2">
                  <button
                    onClick={() => setViewMode("matrix-summary")}
                    className={cn("text-xs px-2 py-0.5 rounded", viewMode === "matrix-summary" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground")}
                  >
                    Сводка
                  </button>
                  <button
                    onClick={() => setViewMode("matrix-expanded")}
                    className={cn("text-xs px-2 py-0.5 rounded", viewMode === "matrix-expanded" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground")}
                  >
                    Развёрнутый
                  </button>
                </div>
              )}
              <TrainingMatrixView
                trainings={trainings}
                diagnostics={diagnostics}
                viewMode={viewMode === "matrix-expanded" ? "expanded" : "summary"}
              />
            </>
          )}

          {/* Training content rules summary */}
          {trainings.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <Shield className="h-3.5 w-3.5" />
                  <span>Ограничение доступа внутри тренинга</span>
                  <Badge variant="outline" className="text-[9px]">{contentRules.length}</Badge>
                </div>
                {contentRules.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Нет настроенных правил — покупатели получают полный доступ ко всем тренингам продукта.
                    Настройте правила во вкладке «Правила доступа».
                  </p>
                ) : (
                  <div className="space-y-1">
                    {contentRules.map(rule => {
                      const training = trainings.find(t => t.id === rule.target_ref);
                      const cond = rule.conditions;
                      const mCount = cond.allowed_module_ids?.length || 0;
                      const lCount = cond.allowed_lesson_ids?.length || 0;
                      return (
                        <div
                          key={rule.id}
                          className={cn(
                            "flex items-center gap-2 p-2 rounded-md border text-sm",
                            rule.is_active ? "bg-muted/20" : "bg-muted/10 opacity-60"
                          )}
                        >
                          <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="flex-1 min-w-0 truncate text-xs font-medium">
                            {training?.title || rule.target_label || rule.target_ref}
                          </span>
                          <Badge variant="outline" className="text-[9px] shrink-0">
                            {rule.tariff_id ? "Тариф" : "Продукт"}
                          </Badge>
                          <Badge variant="outline" className={cn(
                            "text-[9px] shrink-0",
                            cond.access_mode === "partial" ? "text-amber-600 border-amber-300" : ""
                          )}>
                            {cond.access_mode === "full" ? "Полный" : `Частичный: ${mCount} мод. ${lCount} ур.`}
                          </Badge>
                          {!rule.is_active && (
                            <Badge variant="outline" className="text-[9px] text-muted-foreground shrink-0">
                              <EyeOff className="h-2.5 w-2.5 mr-0.5" />
                              Неактивно
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
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
                        {t.public_id && <span className="font-mono text-[9px]">{t.public_id}</span>}
                         {d.legacy_module_access_count > 0 && (
                          <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-300">
                            старые настройки: {d.legacy_module_access_count}
                          </Badge>
                        )}
                        {d.training_content_rules_count > 0 && (
                          <Badge variant="outline" className="text-[9px]">
                            правил: {d.training_content_rules_count}
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
        onRebindRequest={handleRebindRequest}
        onUnbindRequest={handleUnbindRequest}
      />

      {/* Rebind Preview Dialog */}
      {rebindDialogOpen && (
        rebindLoading ? (
          <Dialog open onOpenChange={() => { setRebindDialogOpen(false); setRebindPreview(null); }}>
            <DialogContent className="sm:max-w-md">
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Загрузка preview…</span>
              </div>
            </DialogContent>
          </Dialog>
        ) : (
          <RebindPreviewDialog
            open={rebindDialogOpen}
            onOpenChange={(open) => { setRebindDialogOpen(open); if (!open) { setRebindPreview(null); setRebindTrainingId(null); } }}
            preview={rebindPreview}
            trainingTitle={rebindTrainingTitle}
            onConfirm={handleRebindConfirm}
            isExecuting={rebindExecuting}
          />
        )
      )}

      {/* Unbind Preview Dialog */}
      {unbindDialogOpen && (
        unbindLoading ? (
          <Dialog open onOpenChange={() => { setUnbindDialogOpen(false); setUnbindPreview(null); }}>
            <DialogContent className="sm:max-w-md">
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Загрузка preview…</span>
              </div>
            </DialogContent>
          </Dialog>
        ) : (
          <UnbindPreviewDialog
            open={unbindDialogOpen}
            onOpenChange={(open) => { setUnbindDialogOpen(open); if (!open) { setUnbindPreview(null); setUnbindTrainingId(null); } }}
            preview={unbindPreview}
            onConfirm={handleUnbindConfirm}
            isExecuting={unbindExecuting}
          />
        )
      )}
    </>
  );
}
