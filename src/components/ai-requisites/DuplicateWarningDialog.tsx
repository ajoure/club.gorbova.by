/**
 * DuplicateWarningDialog — unified UI for duplicate detection.
 *
 * Supports:
 * - Entity duplicates (by UNP): active, archived, multiple
 * - Person duplicates: exact, probable, multiple
 * - Multiple candidates display
 *
 * Contract:
 * - Does NOT create or modify data
 * - Does NOT have "Restore from archive" (no restore flow in PATCH 3)
 * - Actions: Open existing / Continue (probable person only) / Cancel
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
import { Button } from '@/components/ui/button';
import { AlertTriangle, Archive, Users } from 'lucide-react';

export interface DuplicateCandidate {
  id: string;
  label: string;
  sublabel?: string;
  isArchived?: boolean;
}

interface DuplicateWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'entity' | 'person';
  matchType: 'exact' | 'probable';
  candidates: DuplicateCandidate[];
  matchReason?: string;
  onOpenExisting: (candidateId: string) => void;
  onContinue?: () => void;
  onCancel: () => void;
}

export function DuplicateWarningDialog({
  open,
  onOpenChange,
  type,
  matchType,
  candidates,
  matchReason,
  onOpenExisting,
  onContinue,
  onCancel,
}: DuplicateWarningDialogProps) {
  const isMultiple = candidates.length > 1;
  const hasArchived = candidates.some(c => c.isArchived);
  const allowContinue = type === 'person' && matchType === 'probable';

  const title = isMultiple
    ? type === 'entity'
      ? 'Найдено несколько записей с таким УНП'
      : 'Найдено несколько похожих записей'
    : type === 'entity'
      ? 'Запись с таким УНП уже существует'
      : matchType === 'exact'
        ? 'Такая запись уже существует'
        : 'Найдена похожая запись';

  const description = matchReason
    || (type === 'entity'
      ? 'В вашей базе уже есть карточка с таким УНП. Создание дубля невозможно.'
      : matchType === 'exact'
        ? 'Найдена запись с совпадающими идентификационными данными.'
        : 'Найдена запись с похожими данными. Проверьте, не является ли это той же персоной.');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {isMultiple ? (
              <Users className="h-5 w-5 text-destructive" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            )}
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {candidates.map((candidate) => (
            <div
              key={candidate.id}
              className="flex items-center justify-between rounded-md border bg-muted/30 p-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{candidate.label}</span>
                  {candidate.isArchived && (
                    <Badge variant="outline" className="text-xs shrink-0 gap-1">
                      <Archive className="h-3 w-3" />
                      Архив
                    </Badge>
                  )}
                </div>
                {candidate.sublabel && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {candidate.sublabel}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="ml-2 shrink-0"
                onClick={() => onOpenExisting(candidate.id)}
              >
                Открыть
              </Button>
            </div>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Отмена</AlertDialogCancel>
          {allowContinue && onContinue && (
            <AlertDialogAction onClick={onContinue}>
              Создать новую
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
