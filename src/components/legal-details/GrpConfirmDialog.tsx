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
import { ArrowRight } from 'lucide-react';
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
      <AlertDialogContent className="max-w-lg">
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

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {diff.map((entry) => (
            <div
              key={entry.field}
              className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm"
            >
              <span className="font-medium text-muted-foreground min-w-[120px] shrink-0">
                {entry.label}
              </span>
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {entry.oldValue ? (
                  <>
                    <span className="text-muted-foreground line-through truncate max-w-[140px]">
                      {entry.oldValue}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  </>
                ) : (
                  <Badge variant="outline" className="text-xs shrink-0">новое</Badge>
                )}
                <span className="font-medium truncate">{entry.newValue}</span>
              </div>
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
