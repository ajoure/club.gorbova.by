import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { IntegrationInstance, useIntegrationMutations } from "@/hooks/useIntegrations";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface IntegrationInstanceListProps {
  instances: IntegrationInstance[];
  onEdit: (instance: IntegrationInstance) => void;
  onViewLogs: (instance: IntegrationInstance) => void;
  onHealthCheck: (instance: IntegrationInstance) => void;
  isLoading?: boolean;
}

export function IntegrationInstanceList({
  instances,
  onEdit,
  onViewLogs,
  onHealthCheck,
  isLoading,
}: IntegrationInstanceListProps) {
  const { deleteInstance } = useIntegrationMutations();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sendingTestEmail, setSendingTestEmail] = useState<string | null>(null);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "connected":
        return (
          <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/20">
            <CheckCircle className="h-3 w-3 mr-1" />
            Подключено
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Ошибка
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            <Clock className="h-3 w-3 mr-1" />
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
      <div className="text-center py-8 text-muted-foreground">
        Нет подключений. Добавьте первое подключение.
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Название</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead>Последняя проверка</TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instances.map((instance) => (
            <TableRow key={instance.id}>
              <TableCell>
                <div>
                  <span className="font-medium">{instance.alias}</span>
                  {instance.error_message && (
                    <p className="text-xs text-destructive mt-0.5 truncate max-w-[200px]">
                      {instance.error_message}
                    </p>
                  )}
                </div>
              </TableCell>
              <TableCell>{getStatusBadge(instance.status)}</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {instance.last_check_at
                  ? format(new Date(instance.last_check_at), "dd MMM yyyy, HH:mm", { locale: ru })
                  : "—"}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onHealthCheck(instance)}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Проверить
                    </DropdownMenuItem>
                    {instance.category === "email" && (
                      <DropdownMenuItem 
                        onClick={() => handleSendTestEmail(instance)}
                        disabled={sendingTestEmail === instance.id}
                      >
                        <Mail className="h-4 w-4 mr-2" />
                        {sendingTestEmail === instance.id ? "Отправка..." : "Тестовое письмо"}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => onEdit(instance)}>
                      <Settings className="h-4 w-4 mr-2" />
                      Настройки
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onViewLogs(instance)}>
                      <FileText className="h-4 w-4 mr-2" />
                      Логи
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDeleteId(instance.id)}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Удалить
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить подключение?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Подключение и все связанные логи будут удалены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
