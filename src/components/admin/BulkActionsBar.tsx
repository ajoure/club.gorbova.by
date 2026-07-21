import { Button } from "@/components/ui/button";
import { X, Trash2, Mail, MessageCircle, CheckSquare, Combine, Archive, ArchiveRestore, UserPlus, Edit, CalendarPlus, Handshake, MoveRight } from "lucide-react";

interface BulkActionsBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkDelete?: () => void;
  onBulkEmail?: () => void;
  onBulkMessage?: () => void;
  onBulkMerge?: () => void;
  onBulkArchive?: () => void;
  onBulkRestore?: () => void;
  onBulkExtendAccess?: () => void;
  onBulkCreateAccounts?: () => void;
  onBulkEdit?: () => void;
  onBulkCreateDeals?: () => void;
  onBulkMove?: () => void;
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
  onBulkMerge,
  onBulkArchive,
  onBulkRestore,
  onBulkExtendAccess,
  onBulkCreateAccounts,
  onBulkEdit,
  onBulkCreateDeals,
  onBulkMove,
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

        {onBulkMerge && selectedCount >= 2 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBulkMerge}
            className="gap-2 text-blue-600 hover:text-blue-700"
          >
            <Combine className="h-4 w-4" />
            Объединить
          </Button>
        )}

        {onBulkCreateDeals && (
          <Button variant="ghost" size="sm" onClick={onBulkCreateDeals} className="h-8 gap-1.5 text-xs text-emerald-700 hover:text-emerald-800">
            <Handshake className="h-3.5 w-3.5" />
            Создать сделки
          </Button>
        )}

        {onBulkArchive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBulkArchive}
            className="gap-2 text-amber-600 hover:text-amber-700"
          >
            <Archive className="h-4 w-4" />
            Архивировать
          </Button>
        )}

        {onBulkRestore && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBulkRestore}
            className="gap-2 text-emerald-600 hover:text-emerald-700"
          >
            <ArchiveRestore className="h-4 w-4" />
            Восстановить
          </Button>
        )}

        {onBulkCreateAccounts && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBulkCreateAccounts}
            className="gap-2 text-green-600 hover:text-green-700"
          >
            <UserPlus className="h-4 w-4" />
            Создать аккаунты
          </Button>
        )}

        {onBulkEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBulkEdit}
            className="gap-2 text-primary hover:text-primary"
          >
            <Edit className="h-4 w-4" />
            Редактировать
          </Button>
        )}

        {onBulkExtendAccess && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBulkExtendAccess}
            className="gap-2 text-green-600 hover:text-green-700"
          >
            <CalendarPlus className="h-4 w-4" />
            Продлить доступ
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
