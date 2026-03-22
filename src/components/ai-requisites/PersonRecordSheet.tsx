/**
 * PersonRecordSheet — unified shell for view/edit/create of person records.
 * Mirrors EntityRecordSheet shell pattern 1:1.
 */

import { useState, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  User, Pencil, Loader2, MapPin, FileText, Phone, Info, Copy, X, Link2, Power,
} from 'lucide-react';
import { PersonFieldsForm } from './PersonFieldsForm';
import { PersonLinkedEntitiesBlock } from './PersonLinkedEntitiesBlock';
import { DuplicateWarningDialog } from './DuplicateWarningDialog';
import { usePersonDuplicateCheck } from '@/hooks/usePersonDuplicateCheck';
import { getPersonDisplayName, getPersonAddressLines } from '@/lib/persons/personDisplayUtils';
import type { PersonRow } from '@/hooks/useAiPersons';
import type { RecordSheetMode } from './EntityRecordSheet';
import { toast } from 'sonner';

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text);
  toast.success(`${label} скопировано`);
}

function InfoRow({ label, value, copyable, mono }: {
  label: string; value: string | null | undefined; copyable?: boolean; mono?: boolean;
}) {
  const display = value || '—';
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <span className={`text-sm text-right break-words ${mono ? 'font-mono' : ''} ${!value ? 'text-muted-foreground' : ''}`}>
          {display}
        </span>
        {copyable && value && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => copyToClipboard(value, label)}>
            <Copy className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

interface PersonRecordSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: RecordSheetMode;
  onModeChange: (mode: RecordSheetMode) => void;
  person: PersonRow | null;
  profileId: string | null;
  isSubmitting: boolean;
  isDeactivating: boolean;
  onSubmit: (data: Record<string, any>) => Promise<void>;
  onDeactivate: (id: string) => void;
  onOpenExisting?: (id: string) => void;
}

export function PersonRecordSheet({
  open, onOpenChange, mode, onModeChange, person, profileId,
  isSubmitting, isDeactivating, onSubmit, onDeactivate, onOpenExisting,
}: PersonRecordSheetProps) {
  const duplicateCheck = usePersonDuplicateCheck();
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [pendingData, setPendingData] = useState<Record<string, any> | null>(null);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);

  const isViewMode = mode === 'view';
  const isEditMode = mode === 'edit';
  const isCreateMode = mode === 'create';

  const displayName = person ? getPersonDisplayName(person) : 'Новое физлицо';
  const canDeactivate = person?.is_active === true;

  const headerTitle = isCreateMode ? 'Новое физлицо' : displayName;

  const handleFormSubmit = useCallback(async (data: Record<string, any>) => {
    if (!profileId) return;

    const checkInput = {
      personal_number: data.personal_number,
      passport_series: data.passport_series,
      passport_number: data.passport_number,
      full_name: data.full_name,
      birth_date: data.birth_date,
    };

    const result = await duplicateCheck.checkDuplicate(
      checkInput,
      profileId,
      isEditMode && person ? person.id : undefined
    );

    if (result.matchType !== 'none') {
      if (isEditMode && person) {
        const isSelf = result.candidates.every((c) => c.id === person.id);
        if (isSelf) {
          await onSubmit(data);
          onModeChange('view');
          return;
        }
      }
      setPendingData(data);
      setShowDuplicateDialog(true);
      return;
    }

    await onSubmit(data);
    if (isEditMode) {
      onModeChange('view');
    } else {
      onOpenChange(false);
    }
  }, [duplicateCheck, profileId, isEditMode, person, onSubmit, onModeChange, onOpenChange]);

  const handleCloseDuplicateDialog = useCallback(() => {
    setShowDuplicateDialog(false);
    setPendingData(null);
    duplicateCheck.reset();
  }, [duplicateCheck]);

  const handleDuplicateContinue = useCallback(async () => {
    if (pendingData) {
      await onSubmit(pendingData);
      if (isEditMode) onModeChange('view');
      else onOpenChange(false);
    }
    handleCloseDuplicateDialog();
  }, [pendingData, onSubmit, isEditMode, onModeChange, onOpenChange, handleCloseDuplicateDialog]);

  const handleOpenExisting = useCallback((id: string) => {
    handleCloseDuplicateDialog();
    onOpenExisting?.(id);
  }, [handleCloseDuplicateDialog, onOpenExisting]);

  const handleDeactivateConfirm = useCallback(() => {
    if (person) onDeactivate(person.id);
    setShowDeactivateConfirm(false);
  }, [person, onDeactivate]);

  const renderViewContent = () => {
    if (!person) return null;
    const addressLines = getPersonAddressLines(person);

    return (
      <div className="px-4 sm:px-6 py-4 pb-24 space-y-4">
        {/* Basic info */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <User className="w-4 h-4" />
              Основная информация
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="ФИО" value={person.full_name} />
            {person.birth_date && (<><Separator /><InfoRow label="Дата рождения" value={person.birth_date} /></>)}
            {person.personal_number && (<><Separator /><InfoRow label="Личный номер" value={person.personal_number} copyable mono /></>)}
          </CardContent>
        </Card>

        {/* Passport */}
        {(person.passport_series || person.passport_number || person.passport_issued_by) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Паспортные данные
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {person.passport_series && <InfoRow label="Серия" value={person.passport_series} />}
              {person.passport_number && (<>{person.passport_series && <Separator />}<InfoRow label="Номер" value={person.passport_number} copyable mono /></>)}
              {person.passport_issued_by && (<><Separator /><InfoRow label="Кем выдан" value={person.passport_issued_by} /></>)}
              {person.passport_issued_date && (<><Separator /><InfoRow label="Дата выдачи" value={person.passport_issued_date} /></>)}
              {person.passport_valid_until && (<><Separator /><InfoRow label="Срок действия" value={person.passport_valid_until} /></>)}
            </CardContent>
          </Card>
        )}

        {/* Address */}
        {addressLines.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Адрес
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm">
                {addressLines.map((line, i) => <div key={i}>{line}</div>)}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Contacts */}
        {(person.phone || person.email) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <Phone className="w-4 h-4" />
                Контакты
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {person.phone && <InfoRow label="Телефон" value={person.phone} copyable />}
              {person.email && (<>{person.phone && <Separator />}<InfoRow label="Email" value={person.email} copyable /></>)}
            </CardContent>
          </Card>
        )}

        {/* System info */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Info className="w-4 h-4" />
              Служебная информация
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="Дата создания" value={format(new Date(person.created_at), 'dd MMM yyyy HH:mm', { locale: ru })} />
            {person.notes && (<><Separator /><InfoRow label="Заметки" value={person.notes} /></>)}
            <Separator />
            <InfoRow label="ID" value={person.id} copyable mono />
          </CardContent>
        </Card>

        {/* Linked entities */}
        <PersonLinkedEntitiesBlock personId={person.id} />
      </div>
    );
  };

  const renderFormContent = () => {
    if (!profileId) return null;
    return (
      <div className="px-4 sm:px-6 py-4 pb-24">
        <PersonFieldsForm
          initialData={isEditMode ? person : null}
          onSubmit={handleFormSubmit}
          isSubmitting={isSubmitting || duplicateCheck.isChecking}
        />
      </div>
    );
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          data-address-shell="true"
          className="w-full sm:max-w-[60vw] lg:max-w-3xl p-0 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden"
          onPointerDownOutside={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('[role="listbox"]') || target.closest('[data-address-dropdown]')) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('[role="listbox"]') || target.closest('[data-address-dropdown]')) {
              e.preventDefault();
            }
          }}
        >
          <div data-address-portal-root />
          <SheetHeader className="p-4 sm:p-6 pb-3 sm:pb-4 pr-14 sm:pr-16 flex-shrink-0">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-muted shrink-0">
                <User className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-lg sm:text-xl font-bold leading-tight break-words">
                  {headerTitle}
                </SheetTitle>
                {isEditMode && <p className="text-xs text-primary mt-0.5">Режим редактирования</p>}
                {isCreateMode && <p className="text-xs text-muted-foreground mt-0.5">Создание новой записи</p>}
              </div>
            </div>

            <Separator className="mt-3" />

            <div className="flex flex-wrap items-center gap-1.5 px-1 py-1">
              {person && !isCreateMode && (
                person.is_active ? (
                  <Badge variant="default" className="h-7 px-2.5 text-xs gap-1">Активный</Badge>
                ) : (
                  <Badge variant="secondary" className="h-7 px-2.5 text-xs gap-1">Неактивный</Badge>
                )
              )}

              {isViewMode && person && (
                <>
                  <Badge
                    variant="outline"
                    className="cursor-pointer h-7 px-2.5 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                    onClick={() => onModeChange('edit')}
                  >
                    <Pencil className="w-3 h-3" />
                    редактировать
                  </Badge>
                  {canDeactivate && (
                    <Badge
                      variant="outline"
                      className="cursor-pointer h-7 px-2.5 text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                      onClick={() => setShowDeactivateConfirm(true)}
                    >
                      {isDeactivating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                      деактивировать
                    </Badge>
                  )}
                </>
              )}

              {isEditMode && (
                <Badge
                  variant="outline"
                  className="cursor-pointer h-7 px-2.5 text-xs gap-1 border-muted-foreground/30 text-muted-foreground hover:bg-muted"
                  onClick={() => onModeChange('view')}
                >
                  <X className="w-3 h-3" />
                  отмена
                </Badge>
              )}
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {isViewMode && renderViewContent()}
            {(isEditMode || isCreateMode) && renderFormContent()}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={showDeactivateConfirm} onOpenChange={setShowDeactivateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Деактивировать запись?</AlertDialogTitle>
            <AlertDialogDescription>
              Запись «{person ? getPersonDisplayName(person) : ''}» будет деактивирована. Вы сможете активировать её позже.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivateConfirm}>Деактивировать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showDuplicateDialog && duplicateCheck.candidates.length > 0 && (
        <DuplicateWarningDialog
          open={showDuplicateDialog}
          onOpenChange={setShowDuplicateDialog}
          type="person"
          matchType={duplicateCheck.matchType === 'exact' ? 'exact' : 'probable'}
          matchReason={duplicateCheck.matchReason || undefined}
          candidates={duplicateCheck.candidates.map((c) => ({
            id: c.id,
            label: c.full_name || 'Без имени',
            sublabel: c.personal_number ? `ЛН: ${c.personal_number}` : c.passport_number ? `Паспорт: ${c.passport_series || ''} ${c.passport_number}` : undefined,
            isArchived: !c.is_active,
          }))}
          onOpenExisting={handleOpenExisting}
          onContinue={duplicateCheck.matchType === 'probable' ? handleDuplicateContinue : undefined}
          onCancel={handleCloseDuplicateDialog}
        />
      )}
    </>
  );
}
