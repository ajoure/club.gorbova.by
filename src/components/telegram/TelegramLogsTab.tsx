import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2 } from 'lucide-react';
import { useTelegramLogs } from '@/hooks/useTelegramIntegration';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

const actionLabels: Record<string, string> = {
  LINK_SUCCESS: 'Привязка',
  LINK_FAILED: 'Ошибка привязки',
  LINK_CONFLICT: 'Конфликт привязки',
  AUTO_GRANT: 'Авто-выдача',
  MANUAL_GRANT: 'Ручная выдача',
  AUTO_REVOKE: 'Авто-отзыв',
  MANUAL_REVOKE: 'Ручной отзыв',
  GRANT_FAILED: 'Ошибка выдачи',
};

const actionColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  LINK_SUCCESS: 'default',
  LINK_FAILED: 'destructive',
  LINK_CONFLICT: 'destructive',
  AUTO_GRANT: 'default',
  MANUAL_GRANT: 'secondary',
  AUTO_REVOKE: 'outline',
  MANUAL_REVOKE: 'outline',
  GRANT_FAILED: 'destructive',
};

export function TelegramLogsTab() {
  const { data: logs, isLoading } = useTelegramLogs(100);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Логи Telegram</CardTitle>
        <CardDescription>
          История всех действий: привязка аккаунтов, выдача и отзыв доступа, 
          отправка уведомлений. Помогает отследить проблемы и проанализировать работу системы.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {logs && logs.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата/время</TableHead>
                <TableHead>Действие</TableHead>
                <TableHead>Цель</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Ошибка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap">
                    {format(new Date(log.created_at), 'dd.MM.yyyy HH:mm:ss', { locale: ru })}
                  </TableCell>
                  <TableCell>
                    <Badge variant={actionColors[log.action] || 'secondary'}>
                      {actionLabels[log.action] || log.action}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {log.target || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={log.status === 'ok' ? 'outline' : log.status === 'error' ? 'destructive' : 'secondary'}>
                      {log.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {log.error_message || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Логов пока нет
          </div>
        )}
      </CardContent>
    </Card>
  );
}
