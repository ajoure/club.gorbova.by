/**
 * GrpConfirmDialog — diff-preview dialog for GRP (MNS) autofill.
 *
 * Shows which fields will be changed, requires explicit confirmation.
 * No business logic — purely UI. Uses GrpAutofillService for diff.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { ArrowDown } from 'lucide-react';
import type { GrpDiffEntry } from '@/lib/legal-entities/GrpAutofillService';

interface GrpConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  diff: GrpDiffEntry[];
  statusName?: string | null;
  liquidationDate?: string | null;
  onConfirm: () => void;
}

export function GrpConfirmDialog({
  open,
  onOpenChange,
  diff,
  statusName,
  liquidationDate,
  onConfirm,
}: GrpConfirmDialogProps) {
  const isLiquidating = liquidationDate || (statusName && statusName.toLowerCase().includes('ликвид'));

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Найдено в реестре МНС</AlertDialogTitle>
          <AlertDialogDescription>
            Следующие поля будут обновлены. Проверьте данные перед применением.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isLiquidating && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
            <p className="text-sm text-destructive font-medium">
              ⚠ Статус: {statusName}
              {liquidationDate && ` (с ${liquidationDate})`}
            </p>
          </div>
        )}

        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {diff.map((entry) => (
            <div
              key={entry.field}
              className="rounded-md border bg-muted/30 p-3 text-sm space-y-1.5"
            >
              <div className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                {entry.label}
              </div>
              {entry.oldValue ? (
                <div className="space-y-1">
                  <div className="text-muted-foreground line-through break-words whitespace-pre-wrap">
                    {entry.oldValue}
                  </div>
                  <ArrowDown className="h-3 w-3 text-muted-foreground" />
                  <div className="font-medium break-words whitespace-pre-wrap">
                    {entry.newValue}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="text-xs shrink-0 mt-0.5">новое</Badge>
                  <span className="font-medium break-words whitespace-pre-wrap">{entry.newValue}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {diff.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Все поля уже совпадают с реестром МНС.
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={diff.length === 0}>
            Заполнить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
