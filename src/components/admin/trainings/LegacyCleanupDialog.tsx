import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle, Trash2 } from "lucide-react";

interface LegacyCleanupPreview {
  root_id: string;
  all_tree_ids: string[];
  descendant_count: number;
  legacy_rows: { id: string; module_id: string }[];
  total_count: number;
  sample_ids: string[];
}

interface LegacyCleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootTrainingTitle: string;
  onGetPreview: () => Promise<LegacyCleanupPreview>;
  onExecute: (confirmedModuleIds: string[]) => Promise<{ deleted_count: number; post_check_remaining: number }>;
}

export function LegacyCleanupDialog({
  open,
  onOpenChange,
  rootTrainingTitle,
  onGetPreview,
  onExecute,
}: LegacyCleanupDialogProps) {
  const [step, setStep] = useState<"idle" | "loading" | "preview" | "executing" | "done">("idle");
  const [preview, setPreview] = useState<LegacyCleanupPreview | null>(null);
  const [result, setResult] = useState<{ deleted_count: number; post_check_remaining: number } | null>(null);

  const handleOpen = async () => {
    if (step !== "idle") return;
    setStep("loading");
    try {
      const p = await onGetPreview();
      setPreview(p);
      setStep("preview");
    } catch {
      setStep("idle");
    }
  };

  const handleExecute = async () => {
    if (!preview) return;
    setStep("executing");
    try {
      const r = await onExecute(preview.all_tree_ids);
      setResult(r);
      setStep("done");
    } catch {
      setStep("preview");
    }
  };

  const handleClose = () => {
    setStep("idle");
    setPreview(null);
    setResult(null);
    onOpenChange(false);
  };

  // Auto-load preview on open
  if (open && step === "idle") {
    handleOpen();
  }

  // Unique module_ids in legacy rows
  const affectedModuleIds = preview
    ? [...new Set(preview.legacy_rows.map(r => r.module_id))]
    : [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Очистка старых настроек доступа</DialogTitle>
          <DialogDescription>
            Тренинг «{rootTrainingTitle}»
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === "loading" && (
            <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Анализ данных…</span>
            </div>
          )}

          {step === "preview" && preview && (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between text-sm py-1.5 px-3 rounded-md bg-muted/30">
                  <span>Записей к удалению</span>
                  <Badge variant="secondary">{preview.total_count}</Badge>
                </div>
                <div className="flex justify-between text-sm py-1.5 px-3 rounded-md bg-muted/30">
                  <span>Затронуто модулей</span>
                  <Badge variant="secondary">{affectedModuleIds.length}</Badge>
                </div>
                <div className="flex justify-between text-sm py-1.5 px-3 rounded-md bg-muted/30">
                  <span>Дочерних модулей в дереве</span>
                  <Badge variant="secondary">{preview.descendant_count}</Badge>
                </div>
              </div>

              {preview.total_count > 0 && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-md">
                  <div className="flex items-center gap-2 text-amber-600 font-medium text-sm">
                    <AlertTriangle className="h-4 w-4" />
                    Подтвердите очистку
                  </div>
                  <p className="text-xs mt-1 text-muted-foreground">
                    Будут удалены старые записи доступа (module_access) для этого тренинга и всех дочерних модулей.
                    Это действие нельзя отменить.
                  </p>
                </div>
              )}

              {preview.total_count === 0 && (
                <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-md">
                  <div className="flex items-center gap-2 text-green-600 font-medium text-sm">
                    <CheckCircle className="h-4 w-4" />
                    Старых настроек не найдено
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "executing" && (
            <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Удаление…</span>
            </div>
          )}

          {step === "done" && result && (
            <div className={`p-3 rounded-md ${
              result.post_check_remaining === 0
                ? "bg-green-500/10 border border-green-500/30"
                : "bg-amber-500/10 border border-amber-500/30"
            }`}>
              <div className={`flex items-center gap-2 font-medium text-sm ${
                result.post_check_remaining === 0 ? "text-green-600" : "text-amber-600"
              }`}>
                <CheckCircle className="h-4 w-4" />
                {result.post_check_remaining === 0
                  ? `Очистка завершена: удалено ${result.deleted_count} записей`
                  : `Удалено ${result.deleted_count}, осталось ${result.post_check_remaining}`
                }
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === "preview" && preview && preview.total_count > 0 && (
            <>
              <Button variant="outline" onClick={handleClose}>Отмена</Button>
              <Button variant="destructive" onClick={handleExecute} className="gap-1.5">
                <Trash2 className="h-3.5 w-3.5" />
                Очистить
              </Button>
            </>
          )}
          {step === "preview" && preview && preview.total_count === 0 && (
            <Button onClick={handleClose}>Закрыть</Button>
          )}
          {step === "done" && (
            <Button onClick={handleClose}>Закрыть</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
