import { useMemo, useState } from "react";
import { z } from "zod";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useAuth } from "@/contexts/AuthContext";

const testEmailSchema = z.object({
  to: z.string().trim().email("Введите корректный email").max(255),
  subject: z.string().trim().min(1, "Укажите тему письма").max(140),
});

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
  const { user } = useAuth();
  const { deleteInstance } = useIntegrationMutations();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sendingTestEmail, setSendingTestEmail] = useState<string | null>(null);
  const [expandedWebhook, setExpandedWebhook] = useState<string | null>(null);

  const [testEmailOpen, setTestEmailOpen] = useState(false);
  const [testEmailInstance, setTestEmailInstance] = useState<IntegrationInstance | null>(null);
  const [testEmailTo, setTestEmailTo] = useState<string>("");
  const [testEmailSubject, setTestEmailSubject] = useState<string>("");

  const defaultTestRecipient = useMemo(() => user?.email || "", [user?.email]);

  const openTestEmailDialog = (instance: IntegrationInstance) => {
    setTestEmailInstance(instance);
    setTestEmailTo(defaultTestRecipient);
    setTestEmailSubject(`Тестовое письмо: ${instance.alias}`);
    setTestEmailOpen(true);
  };

  const closeTestEmailDialog = () => {
    if (sendingTestEmail) return;
    setTestEmailOpen(false);
    setTestEmailInstance(null);
  };

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

  const handleSendTestEmail = async () => {
    if (!testEmailInstance) return;

    const parsed = testEmailSchema.safeParse({
      to: testEmailTo,
      subject: testEmailSubject,
    });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || "Проверьте данные");
      return;
    }

    setSendingTestEmail(testEmailInstance.id);

    try {
      const { to, subject } = parsed.data;

      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          to,
          subject,
          html: `<p>Это тестовое письмо отправлено для проверки почтовой интеграции <strong>${testEmailInstance.alias}</strong>.</p>
                 <p>Время отправки: ${new Date().toLocaleString("ru-RU")}</p>
                 <p style="color: #6b7280; font-size: 12px;">Если письмо не видно — проверьте Спам/Промоакции. Иногда доставка занимает несколько минут.</p>`,
          account_id: testEmailInstance.id,
        },
      });

      if (error) {
        toast.error(`Ошибка отправки: ${error.message}`);
        return;
      }

      if (data?.error) {
        toast.error(`Ошибка отправки: ${data.error}`);
        return;
      }

      const queueId = data?.queue_id as string | undefined;
      toast.success(queueId
        ? `SMTP принял письмо для ${to} (очередь: ${queueId})`
        : `SMTP принял письмо для ${to}`
      );

      setTestEmailOpen(false);
      setTestEmailInstance(null);
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
                  <DropdownMenuContent
                    align="end"
                    className="w-48 bg-popover text-popover-foreground border shadow-md z-50"
                  >
                    <DropdownMenuItem onClick={() => onHealthCheck(instance)} className="gap-2 cursor-pointer">
                      <RefreshCw className="h-4 w-4" />
                      <span>Проверить</span>
                    </DropdownMenuItem>
                    {instance.category === "email" && (
                      <DropdownMenuItem
                        onClick={() => openTestEmailDialog(instance)}
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

      <Dialog open={testEmailOpen} onOpenChange={(open) => (open ? setTestEmailOpen(true) : closeTestEmailDialog())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Тестовое письмо</DialogTitle>
            <DialogDescription>
              Отправим письмо на указанный адрес, используя выбранную интеграцию.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="testEmailTo">Кому</Label>
              <Input
                id="testEmailTo"
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
                placeholder={defaultTestRecipient || "example@email.com"}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="testEmailSubject">Тема</Label>
              <Input
                id="testEmailSubject"
                value={testEmailSubject}
                onChange={(e) => setTestEmailSubject(e.target.value)}
                placeholder="Тестовое письмо"
              />
            </div>

            {testEmailInstance && (
              <p className="text-xs text-muted-foreground">
                Интеграция: <span className="font-medium text-foreground">{testEmailInstance.alias}</span>
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeTestEmailDialog} disabled={!!sendingTestEmail}>
              Отмена
            </Button>
            <Button onClick={handleSendTestEmail} disabled={!testEmailInstance || !!sendingTestEmail}>
              {sendingTestEmail ? "Отправка..." : "Отправить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
