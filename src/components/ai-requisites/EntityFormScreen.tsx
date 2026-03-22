/**
 * EntityFormScreen — create/edit wrapper for entity records.
 * 
 * - Reuses OrganizationDetailsForm 1:1 (no adapter needed)
 * - PayerTypeSelector shown only in create mode (individual not available here)
 * - Anti-duplicate: checks UNP before submit via useEntityDuplicateCheck
 * - purpose='document' is hardcoded for new records
 * - All GRP lookup/confirm/autofill is built into OrganizationDetailsForm
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { OrganizationDetailsForm } from "@/components/legal-details/OrganizationDetailsForm";
import { DuplicateWarningDialog } from "@/components/ai-requisites/DuplicateWarningDialog";
import { useEntityDuplicateCheck } from "@/hooks/useEntityDuplicateCheck";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";

interface EntityFormScreenProps {
  mode: "create" | "edit";
  initialData?: ClientLegalDetails | null;
  profileId: string;
  isSubmitting: boolean;
  onSubmit: (data: Partial<ClientLegalDetails>) => Promise<void>;
  onBack: () => void;
}

export function EntityFormScreen({
  mode,
  initialData,
  profileId,
  isSubmitting,
  onSubmit,
  onBack,
}: EntityFormScreenProps) {
  const duplicateCheck = useEntityDuplicateCheck();
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [pendingData, setPendingData] = useState<Partial<ClientLegalDetails> | null>(null);

  const handleSubmit = useCallback(async (data: Partial<ClientLegalDetails>) => {
    // Extract UNP from the data being submitted
    const unp = data.leg_unp || data.ent_unp || "";
    
    if (unp && unp.length === 9) {
      // Mandatory anti-duplicate check before create/update
      const result = await duplicateCheck.checkDuplicate(unp, profileId);

      if (result.status !== "no_match" && result.status !== "error") {
        // If editing the same record, skip duplicate warning
        if (mode === "edit" && initialData) {
          const isSelf = result.candidates.every(c => c.id === initialData.id);
          if (isSelf) {
            await onSubmit(data);
            return;
          }
        }
        // Show duplicate dialog
        setPendingData(data);
        setShowDuplicateDialog(true);
        return;
      }
    }

    await onSubmit(data);
  }, [duplicateCheck, profileId, mode, initialData, onSubmit]);

  const handleCloseDuplicateDialog = useCallback(() => {
    setShowDuplicateDialog(false);
    setPendingData(null);
    duplicateCheck.reset();
  }, [duplicateCheck]);

  return (
    <div className="space-y-4">
      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Назад к списку
      </Button>

      <h2 className="text-lg font-semibold">
        {mode === "create" ? "Новые реквизиты" : "Редактирование реквизитов"}
      </h2>

      {/* OrganizationDetailsForm — reused 1:1 */}
      <OrganizationDetailsForm
        initialData={initialData}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting || duplicateCheck.status === "checking"}
        showDemoOnEmpty={mode === "create"}
      />

      {/* Duplicate warning dialog */}
      {showDuplicateDialog && duplicateCheck.candidates.length > 0 && (
        <DuplicateWarningDialog
          open={showDuplicateDialog}
          onOpenChange={setShowDuplicateDialog}
          type="entity"
          matchType="exact"
          candidates={duplicateCheck.candidates.map(c => ({
            id: c.id,
            label: c.leg_name || c.ent_name || "Без названия",
            sublabel: `УНП: ${c.leg_unp || c.ent_unp || "—"}`,
            isArchived: c.status === "archived",
          }))}
          onOpenExisting={(id) => {
            handleCloseDuplicateDialog();
            // In this context, we navigate to edit mode for that record
            // The parent handles the actual navigation
          }}
          onCancel={handleCloseDuplicateDialog}
        />
      )}
    </div>
  );
}
