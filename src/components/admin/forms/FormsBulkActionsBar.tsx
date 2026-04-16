/**
 * Forms Bulk Actions Bar — обёртка над BulkActionsBar с confirm-dialog для bulk-delete.
 *
 * Логика безопасности:
 * - Только admin/super_admin
 * - Удаление только site_form + preorder
 * - training всегда показывается как "будет пропущено" в dry-run summary
 */
import { useState } from "react";
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
import { BulkActionsBar } from "@/components/admin/BulkActionsBar";
import { useAuth } from "@/contexts/AuthContext";
import { buildDeleteSummary, useFormsBulkDelete } from "@/hooks/useFormsBulkDelete";
import type { FormsHubRow } from "@/hooks/useFormsHubData";

interface Props {
  selectedRows: FormsHubRow[];
  totalCount: number;
  onClearSelection: () => void;
  onSelectAll?: () => void;
}

export function FormsBulkActionsBar({ selectedRows, totalCount, onClearSelection, onSelectAll }: Props) {
  const { role } = useAuth();
  const isAdmin = role === "admin" || role === "superadmin";
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteMutation = useFormsBulkDelete();

  const summary = buildDeleteSummary(selectedRows);
  const deletableCount = summary.site_form.length + summary.preorder.length;

  const handleConfirm = () => {
    deleteMutation.mutate(summary, {
      onSuccess: () => {
        setConfirmOpen(false);
        onClearSelection();
      },
    });
  };

  return (
    <>
      <BulkActionsBar
        selectedCount={selectedRows.length}
        totalCount={totalCount}
        entityName="записей"
        onClearSelection={onClearSelection}
        onSelectAll={onSelectAll}
        onBulkDelete={isAdmin ? () => setConfirmOpen(true) : undefined}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить выделенные записи?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 pt-2">
                <div className="text-sm">Будет выполнено:</div>
                <ul className="text-sm space-y-1.5 pl-4">
                  <li className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-primary" />
                    Анкеты сайта: <strong>{summary.site_form.length}</strong> → удалить
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-secondary" />
                    Предзаписи: <strong>{summary.preorder.length}</strong> → удалить
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground" />
                    Обучение: <strong>{summary.training_skipped.length}</strong> → пропустить (нельзя удалять прогресс ученика)
                  </li>
                </ul>
                {deletableCount === 0 && (
                  <div className="text-sm text-destructive border border-destructive/30 bg-destructive/5 rounded-md p-2">
                    В выделении нет записей, доступных для удаления.
                  </div>
                )}
                {deletableCount > 0 && (
                  <div className="text-xs text-muted-foreground pt-1">
                    Действие нельзя отменить.
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={deletableCount === 0 || deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Удаление..." : `Удалить ${deletableCount}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
