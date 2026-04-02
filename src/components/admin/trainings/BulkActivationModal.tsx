import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, AlertTriangle } from "lucide-react";
import { getBulkModuleActivationPreview, type BulkAction, type BulkPreviewResult } from "@/hooks/useModuleBulkActions";

interface BulkActivationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedModuleIds: string[];
  action: BulkAction;
  cascadeToLessons: boolean;
  onConfirm: () => void;
  executing?: boolean;
}

export function BulkActivationModal({
  open,
  onOpenChange,
  selectedModuleIds,
  action,
  cascadeToLessons,
  onConfirm,
  executing,
}: BulkActivationModalProps) {
  const [preview, setPreview] = useState<BulkPreviewResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && selectedModuleIds.length > 0) {
      setLoading(true);
      getBulkModuleActivationPreview(selectedModuleIds, action, cascadeToLessons)
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setLoading(false));
    } else {
      setPreview(null);
    }
  }, [open, selectedModuleIds, action, cascadeToLessons]);

  const actionLabel = action === "activate" ? "Активация" : "Деактивация";
  const actionVerb = action === "activate" ? "активированы" : "деактивированы";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{actionLabel} модулей</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {loading ? (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Подсчёт...</span>
                </div>
              ) : preview ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg border p-3">
                      <div className="text-muted-foreground text-xs mb-1">Выбрано модулей</div>
                      <div className="text-lg font-semibold">{preview.selectedModuleCount}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-muted-foreground text-xs mb-1">Затронуто модулей</div>
                      <div className="text-lg font-semibold">{preview.affectedModuleCount}</div>
                      <div className="text-xs text-muted-foreground">
                        {preview.activeModules} акт. / {preview.inactiveModules} неакт.
                      </div>
                    </div>
                  </div>

                  {cascadeToLessons && (
                    <div className="rounded-lg border p-3 text-sm">
                      <div className="text-muted-foreground text-xs mb-1">Затронуто уроков</div>
                      <div className="text-lg font-semibold">{preview.affectedLessonCount}</div>
                      <div className="text-xs text-muted-foreground">
                        {preview.activeLessons} акт. / {preview.inactiveLessons} неакт.
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border p-3 text-sm">
                    <div className="text-muted-foreground text-xs mb-1">Действие</div>
                    <div className="font-medium">
                      {actionLabel} {cascadeToLessons ? "модулей + дочерних модулей + уроков" : "только выбранных модулей + дочерних модулей"}
                    </div>
                  </div>

                  <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {action === "deactivate"
                        ? "Деактивация скроет выбранный контент для всех пользователей. Уроки и модули станут недоступны на платформе."
                        : "Активация сделает контент видимым для пользователей с соответствующим доступом."}
                    </p>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    После выполнения будут {actionVerb}:{" "}
                    <strong>{preview.affectedModuleCount}</strong> модулей
                    {cascadeToLessons && (
                      <> и <strong>{preview.affectedLessonCount}</strong> уроков</>
                    )}
                    .
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Не удалось загрузить preview.</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={executing}>Отмена</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={loading || !preview || executing}
            className={action === "deactivate" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
          >
            {executing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
