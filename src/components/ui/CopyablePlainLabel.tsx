/**
 * CopyablePlainLabel — Label that copies a field's publicId on click.
 * No react-hook-form dependency (unlike FieldLabelWithId).
 */

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/utils/clipboardUtils";

interface CopyablePlainLabelProps {
  htmlFor?: string;
  label: string;
  publicId?: string;
  className?: string;
}

export function CopyablePlainLabel({ htmlFor, label, publicId, className }: CopyablePlainLabelProps) {
  const handleClick = publicId
    ? (e: React.MouseEvent) => {
        e.preventDefault();
        copyToClipboard(publicId, "ID скопирован");
      }
    : undefined;

  return (
    <Label
      htmlFor={htmlFor}
      className={cn(
        "text-xs text-muted-foreground",
        publicId && "cursor-pointer hover:text-primary transition-colors",
        className,
      )}
      onClick={handleClick}
      title={publicId ? `${publicId} — клик для копирования` : undefined}
    >
      {label}
    </Label>
  );
}
