/**
 * EntityRecordSheet — unified shell for view/edit/create modes.
 *
 * Single right-side sheet with mode toggle.
 * Shell (width, header, overlay, scroll) stays identical across modes.
 * Body content switches: view → Card sections, edit/create → OrganizationDetailsForm.
 */

import { useState, useCallback, useMemo } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Building2,
  User,
  Pencil,
  Archive,
  Loader2,
  MapPin,
  Landmark,
  Briefcase,
  Info,
  Copy,
  ClipboardList,
  X,
  Trash2,
} from "lucide-react";
import {
  getEntityShortName,
  getEntityTypeBadge,
  getEntityUnp,
} from "@/lib/legal-entities/entityDisplayUtils";
import { SHEET_SHELL_CLASS } from "@/lib/sheetShell";
import { OrganizationDetailsForm } from "@/components/legal-details/OrganizationDetailsForm";
import { DuplicateWarningDialog } from "@/components/ai-requisites/DuplicateWarningDialog";
import { useEntityDuplicateCheck } from "@/hooks/useEntityDuplicateCheck";
import { formatStructuredAddressForView } from "@/lib/address/formatStructuredAddress";
import type { CanonicalAddressPayload } from "@/lib/address/types";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";
import { EntityPersonLinksBlock } from "./EntityPersonLinksBlock";
import { toast } from "sonner";

/* ── GRP status badge ── */

const GRP_ACTIVE_STATUSES = ['действующий', 'действующая', 'действующее'];

function normalizeStatus(raw: string): 'active' | 'inactive' | 'unknown' {
  const s = raw.trim().toLowerCase();
  if (GRP_ACTIVE_STATUSES.some(a => s.includes(a))) return 'active';
  if (s.includes('ликвидир') || s.includes('прекра') || s.includes('недейств')) return 'inactive';
  return 'unknown';
}

function GrpStatusBadge({ status }: { status: string }) {
  const kind = normalizeStatus(status);
  const cls = kind === 'active'
    ? 'text-green-700/70 border-green-200/50 bg-green-50/30 dark:text-green-400/70 dark:border-green-800/50 dark:bg-green-950/30'
    : kind === 'inactive'
    ? 'text-red-700/70 border-red-200/50 bg-red-50/30 dark:text-red-400/70 dark:border-red-800/50 dark:bg-red-950/30'
    : 'text-muted-foreground';
  return <Badge variant="outline" className={cls}>{status}</Badge>;
}

/* ── helpers ── */

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text);
  toast.success(`${label} скопировано`);
}

function InfoRow({
  label,
  value,
  copyable,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  copyable?: boolean;
  mono?: boolean;
}) {
  const display = value || "—";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <span
          className={`text-sm text-right break-words ${mono ? "font-mono" : ""} ${!value ? "text-muted-foreground" : ""}`}
        >
          {display}
        </span>
        {copyable && value && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 shrink-0"
            onClick={() => copyToClipboard(value, label)}
          >
            <Copy className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── props ── */

export type RecordSheetMode = "view" | "edit" | "create";

interface EntityRecordSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: RecordSheetMode;
  onModeChange: (mode: RecordSheetMode) => void;
  entity: ClientLegalDetails | null;
  profileId: string | null;
  isSubmitting: boolean;
  isArchiving: boolean;
  isDeleting?: boolean;
  onSubmit: (data: Partial<ClientLegalDetails>) => Promise<void>;
  onArchive: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Called when user chooses to open an existing duplicate instead */
  onOpenExisting?: (id: string) => void;
}

/* ── component ── */

export function EntityRecordSheet({
  open,
  onOpenChange,
  mode,
  onModeChange,
  entity,
  profileId,
  isSubmitting,
  isArchiving,
  isDeleting,
  onSubmit,
  onArchive,
  onDelete,
  onOpenExisting,
}: EntityRecordSheetProps) {
  const duplicateCheck = useEntityDuplicateCheck();
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [pendingData, setPendingData] = useState<Partial<ClientLegalDetails> | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isViewMode = mode === "view";
  const isEditMode = mode === "edit";
  const isCreateMode = mode === "create";

  // Derived entity data for header
  const isEntrepreneur = entity?.client_type === "entrepreneur";
  const shortName = entity ? getEntityShortName(entity) : "Новые реквизиты";
  const typeBadge = entity ? getEntityTypeBadge(entity) : null;
  const unp = entity ? getEntityUnp(entity) : null;
  const canArchive = entity?.purpose === "document" && entity?.status === "active";
  const canDelete = entity?.purpose === "document" && !!onDelete;

  const orgForm = isEntrepreneur ? "Индивидуальный предприниматель" : entity?.leg_org_form;
  const subtitle = entity
    ? [orgForm, unp ? `УНП ${unp}` : null].filter(Boolean).join(" · ")
    : null;

  // Header title based on mode
  const headerTitle = useMemo(() => {
    if (isCreateMode) return "Новые реквизиты";
    return shortName;
  }, [isCreateMode, shortName]);

  /* ── duplicate check + form submit ── */

  const handleFormSubmit = useCallback(
    async (data: Partial<ClientLegalDetails>) => {
      const { purpose, status, is_default, ...safeData } = data as any;
      const unpVal = safeData.leg_unp || safeData.ent_unp || "";

      if (unpVal && unpVal.length === 9 && profileId) {
        const result = await duplicateCheck.checkDuplicate(unpVal, profileId);

        if (result.status !== "no_match" && result.status !== "error") {
          if (isEditMode && entity) {
            const isSelf = result.candidates.every((c) => c.id === entity.id);
            if (isSelf) {
              await onSubmit(safeData);
              onModeChange("view");
              return;
            }
          }
          setPendingData(safeData);
          setShowDuplicateDialog(true);
          return;
        }
      }

      await onSubmit(safeData);
      if (isEditMode) {
        onModeChange("view");
      } else {
        onOpenChange(false);
      }
    },
    [duplicateCheck, profileId, isEditMode, entity, onSubmit, onModeChange, onOpenChange]
  );

  const handleCloseDuplicateDialog = useCallback(() => {
    setShowDuplicateDialog(false);
    setPendingData(null);
    duplicateCheck.reset();
  }, [duplicateCheck]);

  const handleOpenExisting = useCallback(
    (id: string) => {
      handleCloseDuplicateDialog();
      onOpenExisting?.(id);
    },
    [handleCloseDuplicateDialog, onOpenExisting]
  );

  const handleArchiveConfirm = useCallback(() => {
    if (entity) {
      onArchive(entity.id);
    }
    setShowArchiveConfirm(false);
  }, [entity, onArchive]);

  const handleDeleteConfirm = useCallback(async () => {
    if (entity && onDelete) {
      await onDelete(entity.id);
      setShowDeleteConfirm(false);
      onOpenChange(false);
    }
  }, [entity, onDelete, onOpenChange]);



  /* ── view content ── */

  const renderViewContent = () => {
    if (!entity) return null;

    const addressStructured = (isEntrepreneur
      ? entity.ent_address_structured
      : entity.leg_address_structured) as unknown as CanonicalAddressPayload | null;
    const addressFallback = isEntrepreneur ? entity.ent_address : entity.leg_address;
    const addressLines = formatStructuredAddressForView(addressStructured, addressFallback);

    const bankAccount = entity.bank_account;
    const bankName = entity.bank_name;
    const bankCode = entity.bank_code;

    const directorName = !isEntrepreneur ? entity.leg_director_name : null;
    const directorPosition = !isEntrepreneur ? entity.leg_director_position : null;
    const actsOnBasis = isEntrepreneur ? entity.ent_acts_on_basis : entity.leg_acts_on_basis;
    const fullName = isEntrepreneur ? entity.ent_name : entity.leg_name;

    const hasGrpData = !!(
      entity.grp_registration_date ||
      entity.grp_status_name ||
      entity.grp_tax_office_name ||
      entity.grp_short_name ||
      entity.grp_liquidation_date
    );

    return (
      <div className="px-4 sm:px-6 py-4 pb-24 space-y-4">
        {/* Section 1: Basic info */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Info className="w-4 h-4" />
              Основная информация
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow
              label={isEntrepreneur ? "ФИО" : "Полное наименование"}
              value={fullName}
            />
            {!isEntrepreneur && (
              <>
                <Separator />
                <InfoRow label="Орг. форма" value={entity.leg_org_form} />
              </>
            )}
            <Separator />
            <InfoRow label="УНП" value={unp} copyable mono />
            {actsOnBasis && (
              <>
                <Separator />
                <InfoRow label="Действует на основании" value={actsOnBasis} />
              </>
            )}
          </CardContent>
        </Card>

        {/* Section 2: Registry data (GRP) — read-only */}
        {hasGrpData && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />
                Данные реестра
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {entity.grp_registration_date && (
                <InfoRow label="Дата регистрации" value={entity.grp_registration_date} />
              )}
              {entity.grp_status_name && (
                <>
                  {entity.grp_registration_date && <Separator />}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground shrink-0">Статус</span>
                    <GrpStatusBadge status={entity.grp_status_name} />
                  </div>
                </>
              )}
              {entity.grp_tax_office_name && (
                <>
                  <Separator />
                  <InfoRow label="ИМНС" value={entity.grp_tax_office_name} />
                </>
              )}
              {entity.grp_short_name && (
                <>
                  <Separator />
                  <InfoRow label="Краткое название" value={entity.grp_short_name} />
                </>
              )}
              {entity.grp_liquidation_date && (
                <>
                  <Separator />
                  <InfoRow label="Дата ликвидации" value={entity.grp_liquidation_date} />
                </>
              )}
              {entity.grp_liquidation_reason && (
                <>
                  <Separator />
                  <InfoRow label="Причина ликвидации" value={entity.grp_liquidation_reason} />
                </>
              )}
              {entity.grp_last_fetched_at && (
                <>
                  <Separator />
                  <InfoRow
                    label="Обновлено"
                    value={format(new Date(entity.grp_last_fetched_at), "dd MMM yyyy HH:mm", { locale: ru })}
                  />
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Section 3: Address */}
        {addressLines.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Адрес
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm text-muted-foreground shrink-0">Юридический адрес</span>
                <div className="text-sm text-right break-words">
                  {addressLines.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 4: Director (legal entity only) */}
        {!isEntrepreneur && (directorName || directorPosition) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <Briefcase className="w-4 h-4" />
                Руководитель
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {directorPosition && (
                <InfoRow label="Должность" value={directorPosition} />
              )}
              {directorPosition && directorName && <Separator />}
              {directorName && (
                <InfoRow label="ФИО" value={directorName} />
              )}
            </CardContent>
          </Card>
        )}

        {/* Section 5: Bank details */}
        {(bankAccount || bankName || bankCode) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <Landmark className="w-4 h-4" />
                Банковские реквизиты
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="Расчётный счёт" value={bankAccount} copyable mono />
              {bankName && (
                <>
                  <Separator />
                  <InfoRow label="Банк" value={bankName} />
                </>
              )}
              {bankCode && (
                <>
                  <Separator />
                  <InfoRow label="Код банка" value={bankCode} copyable mono />
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Section 6: System info */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Info className="w-4 h-4" />
              Служебная информация
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow
              label="Назначение"
              value={entity.purpose === "billing" ? "Платёжные" : "Документы"}
            />
            <Separator />
            <InfoRow
              label="Дата создания"
              value={format(new Date(entity.created_at), "dd MMM yyyy HH:mm", { locale: ru })}
            />
            <Separator />
            <InfoRow label="ID" value={entity.id} copyable mono />
          </CardContent>
        </Card>

        {/* Section 7: Linked persons */}
        {profileId && (
          <EntityPersonLinksBlock
            legalDetailsId={entity.id}
            profileId={profileId}
          />
        )}
      </div>
    );
  };

  /* ── edit/create content ── */

  const renderFormContent = () => {
    if (!profileId) return null;
    return (
      <div className="px-4 sm:px-6 py-4 pb-24">
        <OrganizationDetailsForm
          initialData={isEditMode ? entity ?? null : null}
          onSubmit={handleFormSubmit}
          isSubmitting={isSubmitting || duplicateCheck.status === "checking"}
          showDemoOnEmpty={isCreateMode}
        />
      </div>
    );
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          data-address-shell="true"
          className={SHEET_SHELL_CLASS}
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
          {/* ── Header (identical shell across all modes) ── */}
          <SheetHeader className="p-4 sm:p-6 pb-3 sm:pb-4 pr-14 sm:pr-16 flex-shrink-0">
            {/* Row 1: Icon + Title + Subtitle */}
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-muted shrink-0">
                {isCreateMode ? (
                  <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground" />
                ) : isEntrepreneur ? (
                  <User className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground" />
                ) : (
                  <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-lg sm:text-xl font-bold leading-tight break-words">
                  {headerTitle}
                </SheetTitle>
                {subtitle && !isCreateMode && (
                  <p className="text-xs text-muted-foreground break-all mt-0.5">{subtitle}</p>
                )}
                {isEditMode && (
                  <p className="text-xs text-primary mt-0.5">Режим редактирования</p>
                )}
                {isCreateMode && (
                  <p className="text-xs text-muted-foreground mt-0.5">Создание новой записи</p>
                )}
              </div>
            </div>

            <Separator className="mt-3" />

            {/* Row 2: Badge pills + action buttons */}
            <div className="flex flex-wrap items-center gap-1.5 px-1 py-1">
              {/* Type badge (view/edit only) */}
              {typeBadge && !isCreateMode && (
                <Badge variant="outline" className="h-7 px-2.5 text-xs">
                  {typeBadge}
                </Badge>
              )}

              {/* Status badge (view/edit only) */}
              {entity && !isCreateMode && (
                entity.status === "active" ? (
                  <Badge variant="default" className="h-7 px-2.5 text-xs gap-1">
                    Активный
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="h-7 px-2.5 text-xs gap-1">
                    Архив
                  </Badge>
                )
              )}

              {/* Billing badge */}
              {entity?.purpose === "billing" && !isCreateMode && (
                <Badge variant="outline" className="h-7 px-2.5 text-xs gap-1 border-amber-400/30 text-amber-600 dark:text-amber-400">
                  <Landmark className="w-3 h-3" />
                  Платёжные
                </Badge>
              )}

              {/* View mode actions */}
              {isViewMode && entity && (
                <>
                  <Badge
                    variant="outline"
                    className="cursor-pointer h-7 px-2.5 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                    onClick={() => onModeChange("edit")}
                  >
                    <Pencil className="w-3 h-3" />
                    редактировать
                  </Badge>

                  {canArchive && (
                    <Badge
                      variant="outline"
                      className="cursor-pointer h-7 px-2.5 text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                      onClick={() => setShowArchiveConfirm(true)}
                    >
                      {isArchiving ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Archive className="w-3 h-3" />
                      )}
                      в архив
                    </Badge>
                  )}
                  {canDelete && (
                    <Badge
                      variant="outline"
                      className="cursor-pointer h-7 px-2.5 text-xs gap-1 border-red-500/40 text-red-600 hover:bg-red-500/10"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      удалить навсегда
                    </Badge>
                  )}
                </>
              )}

              {/* Edit mode actions */}
              {isEditMode && (
                <Badge
                  variant="outline"
                  className="cursor-pointer h-7 px-2.5 text-xs gap-1 border-muted-foreground/30 text-muted-foreground hover:bg-muted"
                  onClick={() => onModeChange("view")}
                >
                  <X className="w-3 h-3" />
                  отмена
                </Badge>
              )}
            </div>
          </SheetHeader>

          {/* ── Scrollable body ── */}
          <div className="flex-1 overflow-y-auto">
            {isViewMode && renderViewContent()}
            {(isEditMode || isCreateMode) && renderFormContent()}
          </div>
        </SheetContent>
      </Sheet>

      {/* Archive confirm dialog */}
      <AlertDialog open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Архивировать реквизиты?</AlertDialogTitle>
            <AlertDialogDescription>
              Запись «{entity ? getEntityShortName(entity) : ""}» будет перемещена в архив. Вы сможете найти её через фильтр «Архив».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchiveConfirm}>
              В архив
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить навсегда?</AlertDialogTitle>
            <AlertDialogDescription>
              Запись «{entity ? getEntityShortName(entity) : ""}» будет удалена навсегда вместе со всеми связями. Уже созданные документы не изменятся. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Удалить навсегда
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Duplicate warning dialog */}
      {showDuplicateDialog && duplicateCheck.candidates.length > 0 && (
        <DuplicateWarningDialog
          open={showDuplicateDialog}
          onOpenChange={setShowDuplicateDialog}
          type="entity"
          matchType="exact"
          candidates={duplicateCheck.candidates.map((c) => ({
            id: c.id,
            label: c.leg_name || c.ent_name || "Без названия",
            sublabel: `УНП: ${c.leg_unp || c.ent_unp || "—"}`,
            isArchived: c.status === "archived",
          }))}
          onOpenExisting={handleOpenExisting}
          onCancel={handleCloseDuplicateDialog}
        />
      )}
    </>
  );
}
