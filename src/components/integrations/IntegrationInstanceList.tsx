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
  Zap,
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
          <Badge className="bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-600 border border-green-500/30 gap-1.5 shadow-sm shadow-green-500/10">
            <CheckCircle className="h-3.5 w-3.5" />
            Подключено
          </Badge>
        );
      case "error":
        return (
          <Badge className="bg-gradient-to-r from-destructive/20 to-red-500/20 text-destructive border border-destructive/30 gap-1.5 shadow-sm shadow-destructive/10 animate-pulse">
            <XCircle className="h-3.5 w-3.5" />
            Ошибка
          </Badge>
        );
      default:
        return (
          <Badge className="bg-gradient-to-r from-muted/50 to-muted/30 text-muted-foreground border border-border/50 gap-1.5">
            <Clock className="h-3.5 w-3.5" />
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
      <div className="text-center py-16">
        <div className="h-20 w-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-muted/50 to-muted/30 flex items-center justify-center shadow-lg">
          <Zap className="h-10 w-10 text-muted-foreground/30" />
        </div>
        <p className="font-semibold text-lg text-foreground">Нет подключений</p>
        <p className="text-sm text-muted-foreground mt-2 max-w-[250px] mx-auto">
          Добавьте первое подключение для начала работы с интеграцией
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {instances.map((instance, index) => (
          <div 
            key={instance.id}
            className={cn(
              "rounded-3xl p-5 transition-all duration-500",
              "bg-gradient-to-br from-card via-card/95 to-transparent",
              "border-2 shadow-lg",
              "hover:shadow-xl hover:-translate-y-1",
              instance.status === "error" 
                ? "border-destructive/30 shadow-destructive/5 hover:border-destructive/50" 
                : instance.status === "connected"
                ? "border-green-500/20 shadow-green-500/5 hover:border-green-500/40"
                : "border-border/40 hover:border-primary/40"
            )}
            style={{
              animationDelay: `${index * 100}ms`,
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "relative h-12 w-12 rounded-2xl flex items-center justify-center transition-all duration-300",
                  "shadow-lg",
                  instance.status === "connected" 
                    ? "bg-gradient-to-br from-green-500/20 to-emerald-500/10 shadow-green-500/10" 
                    : instance.status === "error"
                    ? "bg-gradient-to-br from-destructive/20 to-red-500/10 shadow-destructive/10"
                    : "bg-gradient-to-br from-muted to-muted/50 shadow-sm"
                )}>
                  <div className={cn(
                    "h-4 w-4 rounded-full transition-all duration-500",
                    instance.status === "connected" 
                      ? "bg-gradient-to-br from-green-400 to-green-600 shadow-lg shadow-green-500/50" 
                      : instance.status === "error"
                      ? "bg-gradient-to-br from-red-400 to-red-600 shadow-lg shadow-red-500/50 animate-pulse"
                      : "bg-muted-foreground/30"
                  )} />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-foreground">{instance.alias}</span>
                    {getStatusBadge(instance.status)}
                  </div>
                  {instance.error_message && (
                    <p className="text-xs text-destructive font-medium max-w-[350px] truncate">
                      {instance.error_message}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {instance.last_check_at
                      ? `Проверено ${format(new Date(instance.last_check_at), "dd MMM, HH:mm", { locale: ru })}`
                      : "Ещё не проверялось"}
                  </p>
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl hover:bg-primary/10">
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 bg-card/98 backdrop-blur-xl border-2 border-border/50 rounded-2xl shadow-2xl p-2">
                  <DropdownMenuItem onClick={() => onHealthCheck(instance)} className="gap-3 rounded-xl py-2.5 cursor-pointer">
                    <RefreshCw className="h-4 w-4 text-primary" />
                    <span>Проверить</span>
                  </DropdownMenuItem>
                  {instance.category === "email" && (
                    <DropdownMenuItem 
                      onClick={() => handleSendTestEmail(instance)}
                      disabled={sendingTestEmail === instance.id}
                      className="gap-3 rounded-xl py-2.5 cursor-pointer"
                    >
                      <Mail className="h-4 w-4 text-primary" />
                      <span>{sendingTestEmail === instance.id ? "Отправка..." : "Тестовое письмо"}</span>
                    </DropdownMenuItem>
                  )}
                  {instance.category === "crm" && onSyncSettings && (
                    <DropdownMenuItem onClick={() => onSyncSettings(instance)} className="gap-3 rounded-xl py-2.5 cursor-pointer">
                      <ArrowLeftRight className="h-4 w-4 text-primary" />
                      <span>Настройки обмена</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => onEdit(instance)} className="gap-3 rounded-xl py-2.5 cursor-pointer">
                    <Settings className="h-4 w-4 text-primary" />
                    <span>Настройки</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onViewLogs(instance)} className="gap-3 rounded-xl py-2.5 cursor-pointer">
                    <FileText className="h-4 w-4 text-primary" />
                    <span>Логи</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-2" />
                  <DropdownMenuItem
                    onClick={() => setDeleteId(instance.id)}
                    className="gap-3 rounded-xl py-2.5 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Удалить</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-card/98 backdrop-blur-xl border-2 border-border/50 rounded-3xl shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">Удалить подключение?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Это действие нельзя отменить. Подключение и все связанные настройки будут удалены безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-3">
            <AlertDialogCancel className="rounded-xl border-2">Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-gradient-to-r from-destructive to-red-600 rounded-xl shadow-lg shadow-destructive/30">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
