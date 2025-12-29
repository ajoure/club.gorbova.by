import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CheckCircle, XCircle, Clock, Loader2 } from "lucide-react";
import { IntegrationInstance, useIntegrationLogs } from "@/hooks/useIntegrations";

interface IntegrationLogsSheetProps {
  instance: IntegrationInstance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IntegrationLogsSheet({
  instance,
  open,
  onOpenChange,
}: IntegrationLogsSheetProps) {
  const { data: logs, isLoading } = useIntegrationLogs(instance?.id || null);

  const getResultBadge = (result: string) => {
    switch (result) {
      case "success":
        return (
          <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/20">
            <CheckCircle className="h-3 w-3 mr-1" />
            Успех
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
            В процессе
          </Badge>
        );
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Логи: {instance?.alias}</SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-100px)] mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs && logs.length > 0 ? (
            <div className="space-y-3">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="p-3 border rounded-lg space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{log.event_type}</span>
                    {getResultBadge(log.result)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(log.created_at), "dd MMM yyyy, HH:mm:ss", { locale: ru })}
                  </div>
                  {log.error_message && (
                    <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                      {log.error_message}
                    </div>
                  )}
                  {Object.keys(log.payload_meta).length > 0 && (
                    <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                      {JSON.stringify(log.payload_meta, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Логи отсутствуют
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
