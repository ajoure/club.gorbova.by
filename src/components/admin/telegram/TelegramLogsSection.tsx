import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Search, Filter, X, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";

const EVENT_TYPE_OPTIONS = [
  { value: 'all', label: 'Все типы' },
  { value: 'subscription_reminder_7d', label: 'Напоминание 7 дней' },
  { value: 'subscription_reminder_3d', label: 'Напоминание 3 дня' },
  { value: 'subscription_reminder_1d', label: 'Напоминание 1 день' },
  { value: 'subscription_no_card_warning', label: 'Нет карты' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'Все статусы' },
  { value: 'success', label: 'Успешно' },
  { value: 'failed', label: 'Ошибка' },
  { value: 'skipped', label: 'Пропущено' },
];

const statusColors: Record<string, string> = {
  success: 'bg-green-500/20 text-green-700 border-green-500/30',
  failed: 'bg-red-500/20 text-red-700 border-red-500/30',
  skipped: 'bg-amber-500/20 text-amber-700 border-amber-500/30',
  error: 'bg-red-500/20 text-red-700 border-red-500/30',
};

export function TelegramLogsSection() {
  const [searchQuery, setSearchQuery] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: logs, isLoading } = useQuery({
    queryKey: ['telegram-logs-diagnostics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_logs')
        .select('id, action, event_type, user_id, status, error_message, meta, created_at, message_text')
        .order('created_at', { ascending: false })
        .limit(200);
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    
    return logs.filter(log => {
      // Event type filter
      if (eventTypeFilter !== 'all' && log.event_type !== eventTypeFilter) {
        return false;
      }
      
      // Status filter
      if (statusFilter !== 'all' && log.status !== statusFilter) {
        return false;
      }
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const subscriptionId = (log.meta as any)?.subscription_id || '';
        const reason = (log.meta as any)?.reason || '';
        return (
          log.user_id?.toLowerCase().includes(query) ||
          log.action?.toLowerCase().includes(query) ||
          subscriptionId.toLowerCase().includes(query) ||
          reason.toLowerCase().includes(query) ||
          log.error_message?.toLowerCase().includes(query)
        );
      }
      
      return true;
    });
  }, [logs, eventTypeFilter, statusFilter, searchQuery]);

  const hasFilters = eventTypeFilter !== 'all' || statusFilter !== 'all' || searchQuery;

  const clearFilters = () => {
    setEventTypeFilter('all');
    setStatusFilter('all');
    setSearchQuery('');
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          Telegram Logs
          {logs && (
            <span className="text-sm font-normal text-muted-foreground ml-auto">
              {filteredLogs.length} из {logs.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по user_id, subscription_id..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          
          <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
            <SelectTrigger className="w-[180px] h-9">
              <Filter className="h-3.5 w-3.5 mr-2" />
              <SelectValue placeholder="Тип события" />
            </SelectTrigger>
            <SelectContent>
              {EVENT_TYPE_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9">
              <X className="h-4 w-4 mr-1" />
              Сбросить
            </Button>
          )}
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {hasFilters ? 'Ничего не найдено' : 'Нет логов'}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Время</TableHead>
                  <TableHead>Событие</TableHead>
                  <TableHead className="w-[100px]">Статус</TableHead>
                  <TableHead>Subscription ID</TableHead>
                  <TableHead>Reason / Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.slice(0, 50).map((log) => {
                  const meta = log.meta as any;
                  const subscriptionId = meta?.subscription_id;
                  const reason = meta?.reason;
                  
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(log.created_at), 'dd.MM HH:mm:ss', { locale: ru })}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">{log.action}</span>
                          {log.event_type && (
                            <span className="text-xs text-muted-foreground">{log.event_type}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="outline" 
                          className={cn(
                            'text-xs',
                            statusColors[log.status] || 'bg-muted'
                          )}
                        >
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {subscriptionId ? subscriptionId.slice(0, 8) + '...' : '—'}
                      </TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">
                        {reason && (
                          <Badge variant="secondary" className="mr-1 text-[10px]">
                            {reason}
                          </Badge>
                        )}
                        {log.error_message && (
                          <span className="text-destructive">{log.error_message}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
