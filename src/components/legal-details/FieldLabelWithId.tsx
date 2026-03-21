/**
 * FieldLabelWithId — FormLabel + CopyableIdChip for legal details fields.
 * Renders the label text and a small ID chip that copies the canonical token.
 */

import { FormLabel } from "@/components/ui/form";
import { CopyableIdChip } from "@/components/ui/CopyableIdChip";
import type { LegalDetailsFieldEntry } from "@/hooks/useLegalDetailsFields";

interface FieldLabelWithIdProps {
  label: string;
  fieldEntry?: LegalDetailsFieldEntry;
  required?: boolean;
  children?: React.ReactNode;
}

export function FieldLabelWithId({ label, fieldEntry, required, children }: FieldLabelWithIdProps) {
  return (
    <FormLabel className="flex items-center gap-1.5 flex-wrap">
      <span>{label}{required ? " *" : ""}</span>
      {fieldEntry?.publicId && (
        <CopyableIdChip
          value={fieldEntry.publicId}
          copyValue={fieldEntry.tokenString}
          successMessage="Токен скопирован"
        />
      )}
      {children}
    </FormLabel>
  );
}
