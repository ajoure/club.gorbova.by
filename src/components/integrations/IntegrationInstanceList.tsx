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
  Link,
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { IntegrationInstance, useIntegrationMutations } from "@/hooks/useIntegrations";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { WebhookUrlDisplay } from "./WebhookUrlDisplay";

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
  const [expandedWebhook, setExpandedWebhook] = useState<string | null>(null);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "connected":
        return (
          <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-200 gap-1">
            <CheckCircle className="h-3 w-3" />
            Подключено
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Ошибка
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="gap-1">
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

  const supportsWebhook = (provider: string) => 
    ["amocrm", "getcourse", "bepaid"].includes(provider);

  if (instances.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-muted/50 flex items-center justify-center">
          <Zap className="h-8 w-8 text-muted-foreground/50" />
        </div>
        <p className="font-medium text-foreground">Нет подключений</p>
        <p className="text-sm text-muted-foreground mt-1">
          Добавьте первое подключение для начала работы
        </p>
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
              "rounded-xl p-4 transition-all duration-200",
              "bg-card border",
              "hover:shadow-sm",
              instance.status === "error" 
                ? "border-destructive/50" 
                : instance.status === "connected"
                ? "border-green-500/30"
                : "border-border"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "h-10 w-10 rounded-lg flex items-center justify-center",
                  instance.status === "connected" 
                    ? "bg-green-100" 
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
                    <span className="font-medium text-foreground">{instance.alias}</span>
                    {getStatusBadge(instance.status)}
                  </div>
                  {instance.error_message && (
                    <p className="text-xs text-destructive max-w-[300px] truncate">
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

              <div className="flex items-center gap-2">
                {supportsWebhook(instance.provider) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setExpandedWebhook(expandedWebhook === instance.id ? null : instance.id)}
                    title="Показать Webhook URL"
                  >
                    <Link className="h-4 w-4" />
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => onHealthCheck(instance)} className="gap-2 cursor-pointer">
                      <RefreshCw className="h-4 w-4" />
                      <span>Проверить</span>
                    </DropdownMenuItem>
                    {instance.category === "email" && (
                      <DropdownMenuItem 
                        onClick={() => handleSendTestEmail(instance)}
                        disabled={sendingTestEmail === instance.id}
                        className="gap-2 cursor-pointer"
                      >
                        <Mail className="h-4 w-4" />
                        <span>{sendingTestEmail === instance.id ? "Отправка..." : "Тестовое письмо"}</span>
                      </DropdownMenuItem>
                    )}
                    {instance.category === "crm" && onSyncSettings && (
                      <DropdownMenuItem onClick={() => onSyncSettings(instance)} className="gap-2 cursor-pointer">
                        <ArrowLeftRight className="h-4 w-4" />
                        <span>Настройки обмена</span>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => onEdit(instance)} className="gap-2 cursor-pointer">
                      <Settings className="h-4 w-4" />
                      <span>Настройки</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onViewLogs(instance)} className="gap-2 cursor-pointer">
                      <FileText className="h-4 w-4" />
                      <span>Логи</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDeleteId(instance.id)}
                      className="gap-2 cursor-pointer text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>Удалить</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Webhook URL section */}
            {expandedWebhook === instance.id && supportsWebhook(instance.provider) && (
              <div className="mt-4 pt-4 border-t border-border">
                <WebhookUrlDisplay instanceId={instance.id} provider={instance.provider} />
              </div>
            )}
          </div>
        ))}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить подключение?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Подключение и все связанные настройки будут удалены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
