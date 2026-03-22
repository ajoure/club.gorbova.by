/**
 * FieldLabelWithId — FormLabel that copies field publicId (FLD-...) on click.
 * Visual FLD-ID chip is hidden; the label itself is the click target.
 * Scope: FLD-context only.
 */

import { FormLabel } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { LegalDetailsFieldEntry } from "@/hooks/useLegalDetailsFields";

interface FieldLabelWithIdProps {
  label: string;
  fieldEntry?: LegalDetailsFieldEntry;
  required?: boolean;
  children?: React.ReactNode;
}

export function FieldLabelWithId({ label, fieldEntry, required, children }: FieldLabelWithIdProps) {
  const handleCopy = fieldEntry?.publicId
    ? (e: React.MouseEvent) => {
        e.preventDefault();
        navigator.clipboard.writeText(fieldEntry.publicId);
        toast.success("ID скопирован");
      }
    : undefined;

  return (
    <FormLabel
      className={cn(
        "flex items-center gap-1.5 flex-wrap",
        handleCopy && "cursor-pointer hover:text-primary transition-colors"
      )}
      onClick={handleCopy}
      title={fieldEntry?.publicId ? `${fieldEntry.publicId} — клик для копирования` : undefined}
    >
      <span>{label}{required ? " *" : ""}</span>
      {children}
    </FormLabel>
  );
}
