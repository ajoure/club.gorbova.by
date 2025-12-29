import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  MoreHorizontal,
  RefreshCw,
  Settings,
  Trash2,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Mail,
  ArrowLeftRight,
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { IntegrationInstance, useIntegrationMutations } from "@/hooks/useIntegrations";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface IntegrationInstanceListProps {
  instances: IntegrationInstance[];
  onEdit: (instance: IntegrationInstance) => void;
  onViewLogs: (instance: IntegrationInstance) => void;
  onHealthCheck: (instance: IntegrationInstance) => void;
  onSyncSettings?: (instance: IntegrationInstance) => void;
  isLoading?: boolean;
}

export function IntegrationInstanceList({
  instances,
  onEdit,
  onViewLogs,
  onHealthCheck,
  onSyncSettings,
}: IntegrationInstanceListProps) {
  const { deleteInstance } = useIntegrationMutations();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sendingTestEmail, setSendingTestEmail] = useState<string | null>(null);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "connected":
        return (
          <Badge className="bg-green-500/10 text-green-600 border border-green-500/20 gap-1.5">
            <CheckCircle className="h-3 w-3" />
            Подключено
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive" className="gap-1.5">
            <XCircle className="h-3 w-3" />
            Ошибка
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="bg-muted/50 text-muted-foreground border border-border/50 gap-1.5">
            <Clock className="h-3 w-3" />
            Отключено
          </Badge>
        );
    }
  };

  const handleDelete = () => {
    if (deleteId) {
      deleteInstance.mutate(deleteId);
      setDeleteId(null);
    }
  };

  const handleSendTestEmail = async (instance: IntegrationInstance) => {
    setSendingTestEmail(instance.id);
    
    try {
      const config = instance.config as Record<string, unknown> | null;
      const recipientEmail = config?.email as string || config?.from_email as string;
      
      if (!recipientEmail) {
        toast.error("Email не указан в настройках интеграции");
        return;
      }

      const { error } = await supabase.functions.invoke("send-email", {
        body: {
          to: recipientEmail,
          subject: "Тестовое письмо",
          html: `<p>Это тестовое письмо отправлено для проверки почтовой интеграции <strong>${instance.alias}</strong>.</p>
                 <p>Время отправки: ${new Date().toLocaleString("ru-RU")}</p>`,
          account_id: instance.id,
        },
      });

      if (error) throw error;
      
      toast.success(`Тестовое письмо отправлено на ${recipientEmail}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка";
      toast.error(`Ошибка отправки: ${message}`);
    } finally {
      setSendingTestEmail(null);
    }
  };

  if (instances.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-muted/30 flex items-center justify-center">
          <Settings className="h-8 w-8 opacity-30" />
        </div>
        <p className="font-medium">Нет подключений</p>
        <p className="text-sm mt-1">Добавьте первое подключение для начала работы</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {instances.map((instance) => (
          <div 
            key={instance.id}
            className={cn(
              "rounded-2xl p-4 transition-all duration-300",
              "bg-card/50 backdrop-blur-sm border shadow-sm",
              "hover:shadow-md hover:bg-card/80",
              instance.status === "error" 
                ? "border-destructive/30" 
                : instance.status === "connected"
                ? "border-green-500/20"
                : "border-border/50"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "h-10 w-10 rounded-xl flex items-center justify-center",
                  instance.status === "connected" 
                    ? "bg-green-500/10" 
                    : instance.status === "error"
                    ? "bg-destructive/10"
                    : "bg-muted"
                )}>
                  <div className={cn(
                    "h-3 w-3 rounded-full",
                    instance.status === "connected" 
                      ? "bg-green-500" 
                      : instance.status === "error"
                      ? "bg-destructive animate-pulse"
                      : "bg-muted-foreground/30"
                  )} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{instance.alias}</span>
                    {getStatusBadge(instance.status)}
                  </div>
                  {instance.error_message && (
                    <p className="text-xs text-destructive mt-1 max-w-[300px] truncate">
                      {instance.error_message}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {instance.last_check_at
                      ? `Проверено ${format(new Date(instance.last_check_at), "dd MMM, HH:mm", { locale: ru })}`
                      : "Не проверялось"}
                  </p>
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 bg-card/95 backdrop-blur-xl border-border/50">
                  <DropdownMenuItem onClick={() => onHealthCheck(instance)} className="gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Проверить
                  </DropdownMenuItem>
                  {instance.category === "email" && (
                    <DropdownMenuItem 
                      onClick={() => handleSendTestEmail(instance)}
                      disabled={sendingTestEmail === instance.id}
                      className="gap-2"
                    >
                      <Mail className="h-4 w-4" />
                      {sendingTestEmail === instance.id ? "Отправка..." : "Тестовое письмо"}
                    </DropdownMenuItem>
                  )}
                  {instance.category === "crm" && onSyncSettings && (
                    <DropdownMenuItem onClick={() => onSyncSettings(instance)} className="gap-2">
                      <ArrowLeftRight className="h-4 w-4" />
                      Настройки обмена
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => onEdit(instance)} className="gap-2">
                    <Settings className="h-4 w-4" />
                    Настройки
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onViewLogs(instance)} className="gap-2">
                    <FileText className="h-4 w-4" />
                    Логи
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDeleteId(instance.id)}
                    className="text-destructive focus:text-destructive gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Удалить
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-card/95 backdrop-blur-xl border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить подключение?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Подключение и все связанные настройки будут удалены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground rounded-xl">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
