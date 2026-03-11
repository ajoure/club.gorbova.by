import { Copy } from "lucide-react";
import { copyToClipboard } from "@/utils/clipboardUtils";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

interface CopyableIdChipProps {
  value: string;
  className?: string;
  tooltipText?: string;
  successMessage?: string;
}

export function CopyableIdChip({
  value,
  className,
  tooltipText = "Нажмите, чтобы скопировать",
  successMessage = "Скопировано",
}: CopyableIdChipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(value, successMessage);
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/50 px-2 py-0.5",
              "text-xs font-mono text-muted-foreground",
              "cursor-pointer transition-all duration-150",
              "hover:bg-primary/10 hover:text-primary hover:border-primary/30",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              className
            )}
          >
            <span>{value}</span>
            <Copy className="h-3 w-3 shrink-0 opacity-50" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
