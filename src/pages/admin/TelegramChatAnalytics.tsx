import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { 
  CalendarDays, 
  MessageSquare, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  RefreshCw,
  Loader2,
  Users,
  TrendingUp,
  Filter
} from 'lucide-react';

interface ChatMessage {
  id: string;
  club_id: string;
  message_id: number;
  message_ts: string;
  from_tg_user_id: number;
  from_display_name: string;
  text: string;
  has_media: boolean;
}

interface DailySummary {
  id: string;
  club_id: string;
  date: string;
  summary_text: string;
  key_topics: string[];
  support_issues: Array<{
    category: string;
    severity: string;
    excerpt: string;
    user?: string;
  }>;
  action_items: string[];
  messages_count: number;
  unique_users_count: number;
  generated_at: string;
}

interface SupportSignal {
  id: string;
  club_id: string;
  date: string;
  severity: string;
  category: string;
  excerpt: string;
  tg_username: string;
  status: string;
  notes: string;
}

interface TelegramClub {
  id: string;
  club_name: string;
  chat_analytics_enabled: boolean;
}

export default function TelegramChatAnalytics() {
  const queryClient = useQueryClient();
  const [selectedClub, setSelectedClub] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [activeTab, setActiveTab] = useState('summaries');

  // Fetch clubs
  const { data: clubs = [], isLoading: clubsLoading } = useQuery({
    queryKey: ['telegram-clubs-analytics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_clubs')
        .select('id, club_name, chat_analytics_enabled')
        .eq('is_active', true);
      if (error) throw error;
      return (data || []) as TelegramClub[];
    },
  });

  // Fetch daily summaries
  const { data: summaries = [], isLoading: summariesLoading } = useQuery({
    queryKey: ['tg-daily-summaries', selectedClub],
    queryFn: async () => {
      let query = supabase
        .from('tg_daily_summaries')
        .select('*')
        .order('date', { ascending: false })
        .limit(30);
      
      if (selectedClub !== 'all') {
        query = query.eq('club_id', selectedClub);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((item: any) => ({
        ...item,
        key_topics: Array.isArray(item.key_topics) ? item.key_topics : [],
        support_issues: Array.isArray(item.support_issues) ? item.support_issues : [],
        action_items: Array.isArray(item.action_items) ? item.action_items : [],
      })) as DailySummary[];
    },
  });

  // Fetch messages for selected date
  const formattedDate = format(selectedDate, 'yyyy-MM-dd');
  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ['tg-chat-messages', selectedClub, formattedDate],
    queryFn: async () => {
      let query = supabase
        .from('tg_chat_messages')
        .select('*')
        .gte('message_ts', `${formattedDate}T00:00:00Z`)
        .lte('message_ts', `${formattedDate}T23:59:59Z`)
        .order('message_ts', { ascending: true })
        .limit(500);
      
      if (selectedClub !== 'all') {
        query = query.eq('club_id', selectedClub);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as ChatMessage[];
    },
    enabled: activeTab === 'messages',
  });

  // Fetch support signals
  const { data: signals = [], isLoading: signalsLoading } = useQuery({
    queryKey: ['tg-support-signals', selectedClub],
    queryFn: async () => {
      let query = supabase
        .from('tg_support_signals')
        .select('*')
        .order('date', { ascending: false })
        .limit(100);
      
      if (selectedClub !== 'all') {
        query = query.eq('club_id', selectedClub);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as SupportSignal[];
    },
    enabled: activeTab === 'signals',
  });

  // Generate summary mutation
  const generateSummary = useMutation({
    mutationFn: async (date: string) => {
      const { data, error } = await supabase.functions.invoke('telegram-daily-summary', {
        body: { 
          club_id: selectedClub !== 'all' ? selectedClub : undefined,
          date,
          force: true,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Резюме сгенерировано');
      queryClient.invalidateQueries({ queryKey: ['tg-daily-summaries'] });
    },
    onError: (error) => {
      toast.error('Ошибка генерации: ' + String(error));
    },
  });

  // Update signal status
  const updateSignalStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('tg_support_signals')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tg-support-signals'] });
      toast.success('Статус обновлён');
    },
  });

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'high':
        return <Badge variant="destructive">Высокий</Badge>;
      case 'medium':
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">Средний</Badge>;
      default:
        return <Badge variant="secondary">Низкий</Badge>;
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case 'complaint':
        return <Badge variant="destructive">Жалоба</Badge>;
      case 'bug':
        return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">Баг</Badge>;
      case 'suggestion':
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">Предложение</Badge>;
      default:
        return <Badge variant="secondary">Вопрос</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'done':
        return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20"><CheckCircle className="h-3 w-3 mr-1" />Решено</Badge>;
      case 'in_progress':
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20"><Clock className="h-3 w-3 mr-1" />В работе</Badge>;
      case 'ignored':
        return <Badge variant="secondary">Игнор</Badge>;
      default:
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20"><AlertTriangle className="h-3 w-3 mr-1" />Новый</Badge>;
    }
  };

  const selectedSummary = summaries.find(s => s.date === formattedDate);
  const analyticsClubs = clubs.filter(c => c.chat_analytics_enabled);

  // Generate all summaries for all clubs
  const generateAllSummaries = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('telegram-daily-summary', {
        body: { 
          date: format(new Date(), 'yyyy-MM-dd'),
          force: true,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Резюме сгенерировано: ${data?.processed || 0} клубов`);
      queryClient.invalidateQueries({ queryKey: ['tg-daily-summaries'] });
    },
    onError: (error) => {
      toast.error('Ошибка генерации: ' + String(error));
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">Аналитика чата</h1>
          <p className="text-muted-foreground">Сообщения, итоги дня и сигналы техподдержки</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => generateAllSummaries.mutate()}
            disabled={generateAllSummaries.isPending}
          >
            {generateAllSummaries.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Сгенерировать все
          </Button>
          <Select value={selectedClub} onValueChange={setSelectedClub}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Выберите клуб" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все клубы</SelectItem>
              {clubs.map((club) => (
                <SelectItem key={club.id} value={club.id}>
                  {club.club_name}
                  {!club.chat_analytics_enabled && ' (выкл)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Cron configuration info */}
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Автоматическая генерация
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Резюме можно генерировать автоматически каждый день в 23:55. 
            Для этого настройте cron job в Supabase Dashboard:
          </p>
          <div className="bg-muted rounded p-3 font-mono text-xs overflow-x-auto">
            <code>
{`-- SQL Editor → New Query
SELECT cron.schedule(
  'telegram-daily-summary',
  '55 23 * * *',
  $$SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/telegram-daily-summary',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_KEY"}'::jsonb,
    body := '{}'::jsonb
  )$$
);`}
            </code>
          </div>
          <p className="text-xs text-muted-foreground">
            Замените YOUR_SERVICE_KEY на сервисный ключ из Settings → API → service_role key.
            Убедитесь, что включены расширения <strong>pg_cron</strong> и <strong>pg_net</strong> в Database → Extensions.
          </p>
        </CardContent>
      </Card>

      {analyticsClubs.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">Аналитика не включена</h3>
            <p className="text-sm text-muted-foreground">
              Включите "Аналитика чата" в настройках клуба, чтобы начать сбор сообщений.
            </p>
          </CardContent>
        </Card>
      )}

      {analyticsClubs.length > 0 && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="summaries" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              Итоги дня
            </TabsTrigger>
            <TabsTrigger value="messages" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Сообщения
            </TabsTrigger>
            <TabsTrigger value="signals" className="gap-2">
              <AlertTriangle className="h-4 w-4" />
              Сигналы
              {signals.filter(s => s.status === 'new').length > 0 && (
                <Badge variant="destructive" className="ml-1">
                  {signals.filter(s => s.status === 'new').length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Summaries Tab */}
          <TabsContent value="summaries" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Calendar */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Выберите дату</CardTitle>
                </CardHeader>
                <CardContent>
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => date && setSelectedDate(date)}
                    locale={ru}
                    className="rounded-md border"
                  />
                  <Button 
                    variant="outline" 
                    className="w-full mt-4"
                    onClick={() => generateSummary.mutate(formattedDate)}
                    disabled={generateSummary.isPending}
                  >
                    {generateSummary.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Сгенерировать резюме
                  </Button>
                </CardContent>
              </Card>

              {/* Summary for selected date */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5" />
                    {format(selectedDate, 'd MMMM yyyy', { locale: ru })}
                  </CardTitle>
                  {selectedSummary && (
                    <CardDescription>
                      {selectedSummary.messages_count} сообщений от {selectedSummary.unique_users_count} участников
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  {summariesLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  ) : selectedSummary ? (
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-medium mb-2">Резюме</h4>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {selectedSummary.summary_text}
                        </p>
                      </div>
                      
                      {selectedSummary.key_topics?.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-2">Ключевые темы</h4>
                          <div className="flex flex-wrap gap-2">
                            {selectedSummary.key_topics.map((topic, i) => (
                              <Badge key={i} variant="secondary">{topic}</Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedSummary.action_items?.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-2">Действия</h4>
                          <ul className="list-disc list-inside text-sm text-muted-foreground">
                            {selectedSummary.action_items.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {selectedSummary.support_issues?.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-2">Проблемы/Вопросы</h4>
                          <div className="space-y-2">
                            {selectedSummary.support_issues.map((issue, i) => (
                              <div key={i} className="flex items-start gap-2 p-2 border rounded">
                                {getCategoryBadge(issue.category)}
                                {getSeverityBadge(issue.severity)}
                                <span className="text-sm flex-1">{issue.excerpt}</span>
                                {issue.user && <span className="text-xs text-muted-foreground">— {issue.user}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Нет данных за выбранную дату
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Recent summaries */}
            <Card>
              <CardHeader>
                <CardTitle>Последние итоги</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Дата</TableHead>
                        <TableHead>Сообщений</TableHead>
                        <TableHead>Участников</TableHead>
                        <TableHead>Проблем</TableHead>
                        <TableHead>Сгенерировано</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summaries.map((summary) => (
                        <TableRow 
                          key={summary.id} 
                          className="cursor-pointer"
                          onClick={() => setSelectedDate(new Date(summary.date))}
                        >
                          <TableCell>{format(new Date(summary.date), 'd MMM', { locale: ru })}</TableCell>
                          <TableCell>{summary.messages_count}</TableCell>
                          <TableCell>{summary.unique_users_count}</TableCell>
                          <TableCell>
                            {summary.support_issues?.length || 0}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {format(new Date(summary.generated_at), 'HH:mm')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Messages Tab */}
          <TabsContent value="messages" className="space-y-4">
            <div className="flex items-center gap-4">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline">
                    <CalendarDays className="h-4 w-4 mr-2" />
                    {format(selectedDate, 'd MMMM yyyy', { locale: ru })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => date && setSelectedDate(date)}
                    locale={ru}
                  />
                </PopoverContent>
              </Popover>
              <span className="text-sm text-muted-foreground">
                {messages.length} сообщений
              </span>
            </div>

            <Card>
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  {messagesLoading ? (
                    <div className="p-4 space-y-3">
                      {[...Array(5)].map((_, i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : messages.length > 0 ? (
                    <div className="divide-y">
                      {messages.map((msg) => (
                        <div key={msg.id} className="p-3 hover:bg-muted/50">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">
                              {msg.from_display_name || `User ${msg.from_tg_user_id}`}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(msg.message_ts), 'HH:mm')}
                            </span>
                            {msg.has_media && (
                              <Badge variant="secondary" className="text-xs">медиа</Badge>
                            )}
                          </div>
                          <p className="text-sm">{msg.text || '(без текста)'}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="p-8 text-center text-muted-foreground">
                      Нет сообщений за выбранную дату
                    </p>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Support Signals Tab */}
          <TabsContent value="signals" className="space-y-4">
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  {signalsLoading ? (
                    <div className="p-4 space-y-3">
                      {[...Array(5)].map((_, i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : signals.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Дата</TableHead>
                          <TableHead>Тип</TableHead>
                          <TableHead>Важность</TableHead>
                          <TableHead>Описание</TableHead>
                          <TableHead>Пользователь</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead>Действия</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {signals.map((signal) => (
                          <TableRow key={signal.id}>
                            <TableCell className="whitespace-nowrap">
                              {format(new Date(signal.date), 'd MMM', { locale: ru })}
                            </TableCell>
                            <TableCell>{getCategoryBadge(signal.category)}</TableCell>
                            <TableCell>{getSeverityBadge(signal.severity)}</TableCell>
                            <TableCell className="max-w-xs truncate">{signal.excerpt}</TableCell>
                            <TableCell>{signal.tg_username || '—'}</TableCell>
                            <TableCell>{getStatusBadge(signal.status)}</TableCell>
                            <TableCell>
                              <Select 
                                value={signal.status} 
                                onValueChange={(status) => updateSignalStatus.mutate({ id: signal.id, status })}
                              >
                                <SelectTrigger className="w-[120px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="new">Новый</SelectItem>
                                  <SelectItem value="in_progress">В работе</SelectItem>
                                  <SelectItem value="done">Решено</SelectItem>
                                  <SelectItem value="ignored">Игнор</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="p-8 text-center text-muted-foreground">
                      Нет сигналов техподдержки
                    </p>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
