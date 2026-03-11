import { copyToClipboard } from "@/utils/clipboardUtils";
import { cn } from "@/lib/utils";

interface CopyableIdChipProps {
  /** Text displayed in the chip */
  value: string;
  /** Text copied to clipboard (defaults to `value`) */
  copyValue?: string;
  className?: string;
  successMessage?: string;
}

export function CopyableIdChip({
  value,
  copyValue,
  className,
  successMessage = "Скопировано",
}: CopyableIdChipProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        copyToClipboard(copyValue ?? value, successMessage);
      }}
      className={cn(
        "inline-flex items-center rounded-sm border border-border/50 bg-muted/50 px-1.5 py-0",
        "text-[11px] leading-4 font-mono text-muted-foreground",
        "cursor-pointer transition-colors duration-150",
        "hover:bg-muted/60 hover:border-border/60",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        className
      )}
    >
      {value}
    </button>
  );
}
