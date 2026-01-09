import { Button } from "@/components/ui/button";
import { X, Trash2, Mail, MessageCircle, CheckSquare } from "lucide-react";

interface BulkActionsBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkDelete?: () => void;
  onBulkEmail?: () => void;
  onBulkMessage?: () => void;
  onSelectAll?: () => void;
  totalCount?: number;
  entityName?: string;
}

export function BulkActionsBar({
  selectedCount,
  onClearSelection,
  onBulkDelete,
  onBulkEmail,
  onBulkMessage,
  onSelectAll,
  totalCount,
  entityName = "элементов",
}: BulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
      <div className="bg-background border rounded-xl shadow-lg px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            {selectedCount}
          </div>
          <span className="text-muted-foreground">
            {entityName} выбрано
            {totalCount && (
              <span className="ml-1">из {totalCount}</span>
            )}
          </span>
        </div>

        <div className="h-6 w-px bg-border" />

        {onSelectAll && totalCount && selectedCount < totalCount && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onSelectAll}
            className="gap-2"
          >
            <CheckSquare className="h-4 w-4" />
            Выбрать все
          </Button>
        )}

        {onBulkMessage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBulkMessage}
            className="gap-2"
          >
            <MessageCircle className="h-4 w-4" />
            Telegram
          </Button>
        )}

        {onBulkEmail && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBulkEmail}
            className="gap-2"
          >
            <Mail className="h-4 w-4" />
            Email
          </Button>
        )}

        {onBulkDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBulkDelete}
            className="gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Удалить
          </Button>
        )}

        <div className="h-6 w-px bg-border" />

        <Button
          variant="ghost"
          size="icon"
          onClick={onClearSelection}
          className="h-8 w-8"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
