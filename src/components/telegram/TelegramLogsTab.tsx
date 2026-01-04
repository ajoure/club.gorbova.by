import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Search, X } from 'lucide-react';
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
  REMINDER_SENT: 'Напоминание',
  NOTIFICATION_SENT: 'Уведомление',
  MASS_NOTIFICATION: 'Массовая рассылка',
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
  REMINDER_SENT: 'secondary',
  NOTIFICATION_SENT: 'secondary',
  MASS_NOTIFICATION: 'default',
};

const ALL_ACTIONS = Object.keys(actionLabels);

export function TelegramLogsTab() {
  const { data: logs, isLoading } = useTelegramLogs(500);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    
    return logs.filter((log) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTarget = log.target?.toLowerCase().includes(query);
        const matchesError = log.error_message?.toLowerCase().includes(query);
        const matchesAction = actionLabels[log.action]?.toLowerCase().includes(query);
        if (!matchesTarget && !matchesError && !matchesAction) return false;
      }
      
      // Action filter
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;
      
      // Date filters
      if (dateFrom) {
        const logDate = new Date(log.created_at);
        const fromDate = new Date(dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        if (logDate < fromDate) return false;
      }
      
      if (dateTo) {
        const logDate = new Date(log.created_at);
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        if (logDate > toDate) return false;
      }
      
      return true;
    });
  }, [logs, searchQuery, actionFilter, dateFrom, dateTo]);

  const clearFilters = () => {
    setSearchQuery('');
    setActionFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  const hasFilters = searchQuery || actionFilter !== 'all' || dateFrom || dateTo;

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
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по цели, ошибке..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Тип действия" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все действия</SelectItem>
              {ALL_ACTIONS.map((action) => (
                <SelectItem key={action} value={action}>
                  {actionLabels[action]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-[150px]"
            placeholder="От"
          />
          
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-[150px]"
            placeholder="До"
          />
          
          {hasFilters && (
            <Button variant="ghost" size="icon" onClick={clearFilters}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Results count */}
        <div className="text-sm text-muted-foreground">
          Показано: {filteredLogs.length} из {logs?.length || 0}
        </div>

        {filteredLogs.length > 0 ? (
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
              {filteredLogs.map((log) => (
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
            {hasFilters ? 'Ничего не найдено' : 'Логов пока нет'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
