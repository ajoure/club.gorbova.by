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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { IntegrationInstance, useIntegrationMutations } from "@/hooks/useIntegrations";

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
  const { setDefault, deleteInstance } = useIntegrationMutations();
  const [deleteId, setDeleteId] = useState<string | null>(null);

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

  const handleSetDefault = (id: string) => {
    setDefault.mutate(id);
  };

  const handleDelete = () => {
    if (deleteId) {
      deleteInstance.mutate(deleteId);
      setDeleteId(null);
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
            <TableHead className="w-12">По умолч.</TableHead>
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
                <RadioGroup
                  value={instances.find((i) => i.is_default)?.id || ""}
                  onValueChange={() => handleSetDefault(instance.id)}
                >
                  <RadioGroupItem value={instance.id} />
                </RadioGroup>
              </TableCell>
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
                    <DropdownMenuItem onClick={() => onEdit(instance)}>
                      <Settings className="h-4 w-4 mr-2" />
                      Настройки
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onViewLogs(instance)}>
                      <FileText className="h-4 w-4 mr-2" />
                      Логи
                    </DropdownMenuItem>
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
