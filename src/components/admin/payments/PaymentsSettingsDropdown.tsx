import { cn } from "@/lib/utils";
import { Settings, FileText, RotateCcw, Trash2, AlertTriangle, RefreshCw, RefreshCcw, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ReceiptsSyncButton from "./ReceiptsSyncButton";
import RecoverPaymentDialog from "./RecoverPaymentDialog";
import PurgeImportsDialog from "./PurgeImportsDialog";
import PaymentDiagnosticsDialog from "./PaymentDiagnosticsDialog";
import ResyncFromApiDialog from "./ResyncFromApiDialog";
import { MigrationExportDialog } from "./MigrationExportDialog";

interface PaymentsSettingsDropdownProps {
  selectedIds?: string[];
  onRefreshFromApi: () => void;
  isRefreshingFromApi: boolean;
  onComplete: () => void;
}

export default function PaymentsSettingsDropdown({
  selectedIds,
  onRefreshFromApi,
  isRefreshingFromApi,
  onComplete,
}: PaymentsSettingsDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn(
            "h-9 w-9",
            "bg-background/60 backdrop-blur-sm border-border/50",
            "hover:bg-background/80 hover:border-border",
            "transition-all duration-200"
          )}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="end" 
        className={cn(
          "w-56",
          "bg-background/95 backdrop-blur-xl",
          "border-border/50 shadow-xl",
          "rounded-xl"
        )}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Синхронизация
        </DropdownMenuLabel>
        
        <DropdownMenuItem 
          onClick={onRefreshFromApi}
          disabled={isRefreshingFromApi}
          className="gap-2 cursor-pointer"
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshingFromApi && "animate-spin")} />
          <span>Обновить из bePaid</span>
        </DropdownMenuItem>
        
        {/* Receipts sync - render as custom trigger */}
        <ReceiptsSyncButton 
          selectedIds={selectedIds}
          onComplete={onComplete}
          renderTrigger={(onClick, isLoading) => (
            <DropdownMenuItem 
              onClick={(e) => { e.preventDefault(); onClick(); }}
              disabled={isLoading}
              className="gap-2 cursor-pointer"
            >
              <FileText className={cn("h-4 w-4", isLoading && "animate-spin")} />
              <span>Получить чеки</span>
            </DropdownMenuItem>
          )}
        />
        
        {/* UID-based recovery */}
        <ResyncFromApiDialog 
          onComplete={onComplete}
          renderTrigger={(onClick) => (
            <DropdownMenuItem 
              onClick={(e) => { e.preventDefault(); onClick(); }}
              className="gap-2 cursor-pointer"
            >
              <RefreshCcw className="h-4 w-4" />
              <span>Восстановление по UID</span>
            </DropdownMenuItem>
          )}
        />
        
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Восстановление
        </DropdownMenuLabel>
        
        {/* Recover payment */}
        <RecoverPaymentDialog 
          onRecovered={onComplete}
          renderTrigger={(onClick) => (
            <DropdownMenuItem 
              onClick={(e) => { e.preventDefault(); onClick(); }}
              className="gap-2 cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Восстановить платёж</span>
            </DropdownMenuItem>
          )}
        />
        
        {/* Diagnostics */}
        <PaymentDiagnosticsDialog 
          onComplete={onComplete}
          renderTrigger={(onClick) => (
            <DropdownMenuItem 
              onClick={(e) => { e.preventDefault(); onClick(); }}
              className="gap-2 cursor-pointer"
            >
              <AlertTriangle className="h-4 w-4" />
              <span>Диагностика потерь</span>
            </DropdownMenuItem>
          )}
        />
        
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Очистка
        </DropdownMenuLabel>
        
        {/* Purge imports */}
        <PurgeImportsDialog 
          onComplete={onComplete}
          renderTrigger={(onClick) => (
            <DropdownMenuItem 
              onClick={(e) => { e.preventDefault(); onClick(); }}
              className="gap-2 cursor-pointer text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              <span>Удалить CSV-импорт</span>
            </DropdownMenuItem>
          )}
        />
        
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Миграция
        </DropdownMenuLabel>
        
        {/* Migration export */}
        <MigrationExportDialog 
          renderTrigger={(onClick) => (
            <DropdownMenuItem 
              onClick={(e) => { e.preventDefault(); onClick(); }}
              className="gap-2 cursor-pointer"
            >
              <Database className="h-4 w-4" />
              <span>Экспорт для миграции</span>
            </DropdownMenuItem>
          )}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
