/**
 * EntityEditorSheet — side panel for create/edit entity.
 *
 * Replaces EntityFormScreen.
 * Reuses OrganizationDetailsForm 1:1.
 * Anti-duplicate check mandatory before submit.
 * Edit mode excludes current entity from duplicate check.
 * Protected fields (purpose, status, is_default) are never sent from this form.
 */

import { useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { OrganizationDetailsForm } from "@/components/legal-details/OrganizationDetailsForm";
import { DuplicateWarningDialog } from "@/components/ai-requisites/DuplicateWarningDialog";
import { useEntityDuplicateCheck } from "@/hooks/useEntityDuplicateCheck";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";

interface EntityEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  entity?: ClientLegalDetails | null;
  profileId: string;
  isSubmitting: boolean;
  onSubmit: (data: Partial<ClientLegalDetails>) => Promise<void>;
  /** Called when user chooses to open an existing duplicate instead */
  onOpenExisting?: (id: string) => void;
}

export function EntityEditorSheet({
  open,
  onOpenChange,
  mode,
  entity,
  profileId,
  isSubmitting,
  onSubmit,
  onOpenExisting,
}: EntityEditorSheetProps) {
  const duplicateCheck = useEntityDuplicateCheck();
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [pendingData, setPendingData] = useState<Partial<ClientLegalDetails> | null>(null);

  const handleSubmit = useCallback(
    async (data: Partial<ClientLegalDetails>) => {
      // Strip protected fields — never allow AI form to change these
      const { purpose, status, is_default, ...safeData } = data as any;

      const unp = safeData.leg_unp || safeData.ent_unp || "";

      if (unp && unp.length === 9) {
        const result = await duplicateCheck.checkDuplicate(unp, profileId);

        if (result.status !== "no_match" && result.status !== "error") {
          // Edit mode: skip if all candidates are the current record
          if (mode === "edit" && entity) {
            const isSelf = result.candidates.every((c) => c.id === entity.id);
            if (isSelf) {
              await onSubmit(safeData);
              onOpenChange(false);
              return;
            }
          }
          setPendingData(safeData);
          setShowDuplicateDialog(true);
          return;
        }
      }

      await onSubmit(safeData);
      onOpenChange(false);
    },
    [duplicateCheck, profileId, mode, entity, onSubmit, onOpenChange]
  );

  const handleCloseDuplicateDialog = useCallback(() => {
    setShowDuplicateDialog(false);
    setPendingData(null);
    duplicateCheck.reset();
  }, [duplicateCheck]);

  const handleOpenExisting = useCallback(
    (id: string) => {
      handleCloseDuplicateDialog();
      onOpenChange(false);
      onOpenExisting?.(id);
    },
    [handleCloseDuplicateDialog, onOpenChange, onOpenExisting]
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {mode === "create" ? "Новые реквизиты" : "Редактирование реквизитов"}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4">
            <OrganizationDetailsForm
              initialData={entity ?? null}
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting || duplicateCheck.status === "checking"}
              showDemoOnEmpty={mode === "create"}
            />
          </div>
        </SheetContent>
      </Sheet>

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
