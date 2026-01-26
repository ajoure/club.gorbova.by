import { useState } from "react";
import { Settings, Wrench, CheckCircle2, Link2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FalsePaymentsFixDialog from "./FalsePaymentsFixDialog";

interface AdminToolsMenuProps {
  onRefetch?: () => void;
}

export default function AdminToolsMenu({ onRefetch }: AdminToolsMenuProps) {
  const [fixFalsePaymentsOpen, setFixFalsePaymentsOpen] = useState(false);
  
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Settings className="h-4 w-4" />
            <span className="sr-only">Инструменты</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Инструменты обслуживания
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          <DropdownMenuItem 
            onClick={() => setFixFalsePaymentsOpen(true)}
            className="flex items-start gap-3 p-3 cursor-pointer"
          >
            <div className="p-1.5 rounded-lg bg-amber-500/10 mt-0.5">
              <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-sm">Исправить ошибочные платежи</span>
              <span className="text-xs text-muted-foreground">
                Транзакции с неверным статусом в БД
              </span>
            </div>
          </DropdownMenuItem>
          
          <DropdownMenuItem 
            className="flex items-start gap-3 p-3 cursor-pointer opacity-50"
            disabled
          >
            <div className="p-1.5 rounded-lg bg-blue-500/10 mt-0.5">
              <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-sm">Проверить целостность данных</span>
              <span className="text-xs text-muted-foreground">
                Расхождения сумм между платежами и сделками
              </span>
            </div>
          </DropdownMenuItem>
          
          <DropdownMenuItem 
            className="flex items-start gap-3 p-3 cursor-pointer opacity-50"
            disabled
          >
            <div className="p-1.5 rounded-lg bg-teal-500/10 mt-0.5">
              <Link2 className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-sm">Связать платежи со сделками</span>
              <span className="text-xs text-muted-foreground">
                Создать сделки для "сиротских" платежей
              </span>
            </div>
          </DropdownMenuItem>
          
          <DropdownMenuSeparator />
          
          <div className="p-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3" />
              <span>DRY-RUN по умолчанию для всех операций</span>
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      
      <FalsePaymentsFixDialog 
        open={fixFalsePaymentsOpen} 
        onOpenChange={setFixFalsePaymentsOpen}
        onSuccess={onRefetch}
      />
    </>
  );
}
