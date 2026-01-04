import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { 
  ArrowLeft,
  RefreshCw,
  Phone,
  Shield,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ExternalLink,
  Key
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/AdminLayout';

interface MTProtoSession {
  id: string;
  phone_number: string;
  api_id: string;
  api_hash: string;
  status: string;
  error_message: string | null;
  last_sync_at: string | null;
  created_at: string;
}

export default function TelegramMTProto() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isSetupDialogOpen, setIsSetupDialogOpen] = useState(false);
  const [newSession, setNewSession] = useState({
    phone_number: '',
    api_id: '',
    api_hash: '',
  });

  // Fetch sessions
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['mtproto-sessions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_mtproto_sessions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as MTProtoSession[];
    },
  });

  // Create session
  const createSession = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('telegram_mtproto_sessions')
        .insert({
          phone_number: newSession.phone_number,
          api_id: newSession.api_id,
          api_hash: newSession.api_hash,
          status: 'pending',
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Сессия создана. Требуется авторизация.');
      setIsSetupDialogOpen(false);
      setNewSession({ phone_number: '', api_id: '', api_hash: '' });
      queryClient.invalidateQueries({ queryKey: ['mtproto-sessions'] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Sync members
  const syncMembers = useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.functions.invoke('telegram-mtproto-sync', {
        body: { session_id: sessionId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Синхронизировано: ${data.synced_count || 0} участников`);
      queryClient.invalidateQueries({ queryKey: ['mtproto-sessions'] });
    },
    onError: (error: Error) => {
      toast.error(`Ошибка синхронизации: ${error.message}`);
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="default" className="bg-green-500">Активна</Badge>;
      case 'pending':
        return <Badge variant="secondary">Ожидает авторизации</Badge>;
      case 'error':
        return <Badge variant="destructive">Ошибка</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <AdminLayout>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin/integrations/telegram')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">MTProto API</h1>
              <p className="text-muted-foreground">
                Получение полного списка подписчиков через пользовательский аккаунт
              </p>
            </div>
          </div>
        </div>

        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Внимание: Экспериментальная функция</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              MTProto API использует пользовательский аккаунт Telegram (не бота) для получения полного 
              списка участников каналов и чатов.
            </p>
            <ul className="list-disc list-inside text-sm">
              <li>Требуется отдельный Telegram аккаунт (не рекомендуется использовать личный)</li>
              <li>Аккаунт должен быть администратором канала/чата</li>
              <li>Есть риск блокировки аккаунта при злоупотреблении</li>
            </ul>
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle>Подключённые аккаунты</CardTitle>
              <CardDescription>
                Для получения API ID и Hash перейдите на{' '}
                <a 
                  href="https://my.telegram.org/apps" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  my.telegram.org <ExternalLink className="h-3 w-3" />
                </a>
              </CardDescription>
            </div>

            <Dialog open={isSetupDialogOpen} onOpenChange={setIsSetupDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Phone className="h-4 w-4 mr-2" />
                  Добавить аккаунт
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Добавить MTProto аккаунт</DialogTitle>
                  <DialogDescription>
                    Введите данные для подключения пользовательского аккаунта Telegram
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Номер телефона</Label>
                    <Input
                      placeholder="+375291234567"
                      value={newSession.phone_number}
                      onChange={(e) => setNewSession({ ...newSession, phone_number: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>API ID</Label>
                    <Input
                      placeholder="12345678"
                      value={newSession.api_id}
                      onChange={(e) => setNewSession({ ...newSession, api_id: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>API Hash</Label>
                    <Input
                      type="password"
                      placeholder="a1b2c3d4e5f6..."
                      value={newSession.api_hash}
                      onChange={(e) => setNewSession({ ...newSession, api_hash: e.target.value })}
                    />
                  </div>

                  <Alert>
                    <Key className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      После создания потребуется авторизация через код из Telegram
                    </AlertDescription>
                  </Alert>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsSetupDialogOpen(false)}>
                    Отмена
                  </Button>
                  <Button 
                    onClick={() => createSession.mutate()}
                    disabled={createSession.isPending || !newSession.phone_number || !newSession.api_id || !newSession.api_hash}
                  >
                    Добавить
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">
                <Loader2 className="h-6 w-6 animate-spin mx-auto" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-12">
                <Shield className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium mb-1">Нет подключённых аккаунтов</h3>
                <p className="text-muted-foreground mb-4">
                  Добавьте пользовательский аккаунт Telegram для получения полного списка участников
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {sessions.map((session) => (
                  <div 
                    key={session.id} 
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="space-y-1">
                      <div className="font-medium">{session.phone_number}</div>
                      <div className="text-sm text-muted-foreground">
                        API ID: {session.api_id}
                      </div>
                      {session.last_sync_at && (
                        <div className="text-xs text-muted-foreground">
                          Последняя синхронизация: {format(new Date(session.last_sync_at), 'd MMM yyyy HH:mm', { locale: ru })}
                        </div>
                      )}
                      {session.error_message && (
                        <div className="text-xs text-destructive">
                          {session.error_message}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(session.status)}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => syncMembers.mutate(session.id)}
                        disabled={session.status !== 'active' || syncMembers.isPending}
                      >
                        {syncMembers.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        <span className="ml-2">Синхронизировать</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Как это работает</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>1. Зарегистрируйте приложение на my.telegram.org и получите API ID и Hash</p>
            <p>2. Добавьте аккаунт (рекомендуется использовать отдельный номер)</p>
            <p>3. Пройдите авторизацию через код из Telegram</p>
            <p>4. После авторизации можно запускать синхронизацию для получения всех участников</p>
            <p className="text-destructive">
              ⚠️ Не злоупотребляйте API — это может привести к блокировке аккаунта
            </p>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
