import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  User, 
  MessageSquare, 
  Megaphone, 
  CheckCircle, 
  XCircle, 
  CreditCard,
  History,
  AlertTriangle,
  Loader2,
  Plus,
  Calendar,
  Search,
  Copy,
  MinusCircle,
  Clock,
  Send,
  FileText,
  ShieldCheck,
  UserCheck,
  UserX,
  Ban,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { 
  TelegramClubMember,
  useUserAccessGrants,
  useGrantTelegramAccess,
  useRevokeTelegramAccess,
} from '@/hooks/useTelegramIntegration';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

interface MemberDetailsDrawerProps {
  member: TelegramClubMember | null;
  clubId: string | null;
  onClose: () => void;
  onRefresh?: () => void;
}

export function MemberDetailsDrawer({ member, clubId, onClose, onRefresh }: MemberDetailsDrawerProps) {
  const userId = member?.profiles?.user_id;
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  
  // Dialog states
  const [showGrantDialog, setShowGrantDialog] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [showExtendDialog, setShowExtendDialog] = useState(false);
  const [showMessageDialog, setShowMessageDialog] = useState(false);
  
  // Form states
  const [grantDays, setGrantDays] = useState(30);
  const [grantComment, setGrantComment] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [extendDays, setExtendDays] = useState(30);
  const [extendComment, setExtendComment] = useState('');
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  
  const [diagnosticResult, setDiagnosticResult] = useState<any>(null);
  
  const grantAccess = useGrantTelegramAccess();
  const revokeAccess = useRevokeTelegramAccess();

  // Check link mutation
  const checkLink = useMutation({
    mutationFn: async () => {
      if (!clubId || !member) return null;
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: { 
          action: 'check_status', 
          club_id: clubId,
          member_ids: [member.id],
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setDiagnosticResult(data?.results?.[0]);
      toast.success('Статус проверен');
      onRefresh?.();
    },
    onError: (error: any) => {
      toast.error('Ошибка проверки: ' + error.message);
    },
  });

  // Fetch access grants history
  const { data: accessGrants, isLoading: grantsLoading } = useUserAccessGrants(userId || null);

  // Fetch audit history
  const { data: auditHistory, isLoading: auditLoading } = useQuery({
    queryKey: ['telegram-audit', clubId, member?.telegram_user_id],
    queryFn: async () => {
      if (!clubId || !member) return [];
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: { 
          action: 'get_audit', 
          club_id: clubId,
          telegram_user_id: member.telegram_user_id,
          user_id: member.profiles?.user_id,
          limit: 50,
        },
      });
      if (error) throw error;
      return data?.audit || [];
    },
    enabled: !!clubId && !!member,
  });

  // Fetch orders/purchases
  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ['user-orders', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('orders')
        .select('*, products(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!userId,
  });

  const handleGrantAccess = async () => {
    if (!userId || !clubId) return;
    
    const validUntil = addDays(new Date(), grantDays).toISOString();
    
    await grantAccess.mutateAsync({
      userId,
      clubId,
      isManual: true,
      validUntil,
      comment: grantComment || undefined,
    });
    
    setShowGrantDialog(false);
    setGrantDays(30);
    setGrantComment('');
    queryClient.invalidateQueries({ queryKey: ['telegram-club-members', clubId] });
    queryClient.invalidateQueries({ queryKey: ['telegram-audit', clubId] });
    onRefresh?.();
  };

  const handleRevokeAccess = async () => {
    if (!clubId) return;
    
    await revokeAccess.mutateAsync({
      userId,
      telegramUserId: member?.telegram_user_id,
      clubId,
      reason: revokeReason || undefined,
      isManual: true,
    });
    
    setShowRevokeDialog(false);
    setRevokeReason('');
    queryClient.invalidateQueries({ queryKey: ['telegram-club-members', clubId] });
    queryClient.invalidateQueries({ queryKey: ['telegram-audit', clubId] });
    onRefresh?.();
  };

  const handleExtendAccess = async () => {
    if (!userId || !clubId) return;
    
    const validUntil = addDays(new Date(), extendDays).toISOString();
    
    await grantAccess.mutateAsync({
      userId,
      clubId,
      isManual: true,
      validUntil,
      comment: extendComment || 'Продление доступа',
    });
    
    setShowExtendDialog(false);
    setExtendDays(30);
    setExtendComment('');
    queryClient.invalidateQueries({ queryKey: ['telegram-club-members', clubId] });
    queryClient.invalidateQueries({ queryKey: ['telegram-audit', clubId] });
    onRefresh?.();
  };

  const handleSendMessage = async () => {
    if (!clubId || !member || !messageText.trim()) return;
    setSendingMessage(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: {
          action: 'send_message',
          club_id: clubId,
          telegram_user_id: member.telegram_user_id,
          message: messageText,
        },
      });

      if (error) throw error;
      
      if (data.success) {
        toast.success('Сообщение отправлено');
        queryClient.invalidateQueries({ queryKey: ['telegram-audit', clubId] });
      } else {
        if (data.error?.includes('bot was blocked') || data.error?.includes("can't initiate")) {
          toast.error('Пользователь не начал диалог с ботом или заблокировал его');
        } else {
          toast.error(data.error || 'Не удалось отправить');
        }
      }
    } catch (e) {
      console.error('Send message error:', e);
      toast.error('Ошибка отправки сообщения');
    }
    
    setSendingMessage(false);
    setShowMessageDialog(false);
    setMessageText('');
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case 'order': return 'Заказ';
      case 'payment': return 'Платёж';
      case 'manual': return 'Ручная выдача';
      case 'subscription': return 'Подписка';
      default: return source;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active': return 'Активен';
      case 'expired': return 'Истёк';
      case 'revoked': return 'Отозван';
      case 'paid': return 'Оплачен';
      case 'pending': return 'Ожидает';
      case 'failed': return 'Ошибка';
      default: return status;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
      case 'paid':
        return <Badge className="bg-green-500/10 text-green-600">{getStatusLabel(status)}</Badge>;
      case 'expired':
        return <Badge variant="secondary">{getStatusLabel(status)}</Badge>;
      case 'revoked':
      case 'failed':
        return <Badge variant="destructive">{getStatusLabel(status)}</Badge>;
      default:
        return <Badge variant="outline">{getStatusLabel(status)}</Badge>;
    }
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'GRANT':
        return <UserCheck className="h-4 w-4 text-green-500" />;
      case 'REVOKE':
        return <UserX className="h-4 w-4 text-destructive" />;
      case 'KICK_CHAT':
      case 'KICK_CHANNEL':
      case 'KICK_BOTH':
      case 'KICK_PRESENT':
        return <Ban className="h-4 w-4 text-destructive" />;
      case 'JOIN_APPROVED':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'JOIN_DECLINED':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'DM_SENT':
        return <Send className="h-4 w-4 text-primary" />;
      case 'DM_FAILED':
        return <Send className="h-4 w-4 text-destructive" />;
      case 'STATUS_CHECK':
        return <ShieldCheck className="h-4 w-4 text-muted-foreground" />;
      case 'RESYNC':
        return <History className="h-4 w-4 text-muted-foreground" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getEventLabel = (eventType: string) => {
    switch (eventType) {
      case 'GRANT': return 'Выдача доступа';
      case 'REVOKE': return 'Отзыв доступа';
      case 'KICK_CHAT': return 'Удаление из чата';
      case 'KICK_CHANNEL': return 'Удаление из канала';
      case 'KICK_BOTH': return 'Удаление из чата и канала';
      case 'KICK_PRESENT': return 'Удаление присутствующих';
      case 'JOIN_APPROVED': return 'Заявка одобрена';
      case 'JOIN_DECLINED': return 'Заявка отклонена';
      case 'DM_SENT': return 'Сообщение отправлено';
      case 'DM_FAILED': return 'Ошибка отправки';
      case 'STATUS_CHECK': return 'Проверка статуса';
      case 'RESYNC': return 'Синхронизация';
      case 'MARK_REMOVED': return 'Помечен удалённым';
      default: return eventType;
    }
  };

  return (
    <>
      <Sheet open={!!member} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="pr-10">
            <SheetTitle className="flex items-center gap-2">
              <User className="h-5 w-5 shrink-0" />
              Карточка участника
            </SheetTitle>
          </SheetHeader>

          {member && (
            <div className="mt-6 space-y-6">
              {/* Summary */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Сводка</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Telegram</span>
                    <span className="font-medium">
                      {member.telegram_username ? `@${member.telegram_username}` : `ID: ${member.telegram_user_id}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Имя в TG</span>
                    <span>{member.telegram_first_name} {member.telegram_last_name}</span>
                  </div>
                  {member.profiles && (
                    <>
                      <Separator />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ФИО</span>
                        <span>{member.profiles.full_name || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Email</span>
                        <span>{member.profiles.email || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Телефон</span>
                        <span>{member.profiles.phone || '—'}</span>
                      </div>
                    </>
                  )}
                  <Separator />
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Статус доступа</span>
                    {member.access_status === 'ok' ? (
                      <Badge className="bg-green-500/10 text-green-600 gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Разрешён
                      </Badge>
                    ) : member.access_status === 'no_access' ? (
                      <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        Нет доступа
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {member.access_status}
                      </Badge>
                    )}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <MessageSquare className="h-4 w-4" />
                      В чате
                    </span>
                    {member.in_chat === true ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : member.in_chat === false ? (
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <span className="text-muted-foreground text-sm">?</span>
                    )}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Megaphone className="h-4 w-4" />
                      В канале
                    </span>
                    {member.in_channel === true ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : member.in_channel === false ? (
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <span className="text-muted-foreground text-sm">?</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Quick Actions */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Действия</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => checkLink.mutate()}
                      disabled={checkLink.isPending}
                    >
                      {checkLink.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <ShieldCheck className="h-4 w-4 mr-2" />
                      )}
                      Проверить статус
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setShowMessageDialog(true)}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Написать
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(String(member.telegram_user_id));
                        toast.success('ID скопирован');
                      }}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      ID
                    </Button>
                  </div>
                  
                  {/* Diagnostic results */}
                  {diagnosticResult && (
                    <div className="mt-3 p-3 bg-muted rounded-md text-sm">
                      <p className="font-medium mb-2">Результат проверки:</p>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {diagnosticResult.in_chat ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                          <span>Чат: {diagnosticResult.chat_status || (diagnosticResult.in_chat ? 'member' : 'not member')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {diagnosticResult.in_channel ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                          <span>Канал: {diagnosticResult.channel_status || (diagnosticResult.in_channel ? 'member' : 'not member')}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <Separator className="my-3" />

                  {member.profiles ? (
                    member.access_status !== 'ok' ? (
                      <Button 
                        className="w-full" 
                        onClick={() => setShowGrantDialog(true)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Выдать доступ
                      </Button>
                    ) : (
                      <>
                        <Button 
                          variant="outline"
                          className="w-full" 
                          onClick={() => setShowExtendDialog(true)}
                        >
                          <Clock className="h-4 w-4 mr-2" />
                          Продлить доступ
                        </Button>
                        <Button 
                          variant="destructive"
                          className="w-full" 
                          onClick={() => setShowRevokeDialog(true)}
                        >
                          <MinusCircle className="h-4 w-4 mr-2" />
                          Отозвать доступ
                        </Button>
                      </>
                    )
                  ) : (
                    <Button 
                      variant="destructive"
                      className="w-full" 
                      onClick={() => setShowRevokeDialog(true)}
                    >
                      <Ban className="h-4 w-4 mr-2" />
                      Удалить из чата/канала
                    </Button>
                  )}
                </CardContent>
              </Card>

              {/* Tabs for history */}
              <Tabs defaultValue="audit" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="audit" className="gap-1">
                    <FileText className="h-4 w-4" />
                    Аудит
                  </TabsTrigger>
                  <TabsTrigger value="access" className="gap-1">
                    <History className="h-4 w-4" />
                    Доступ
                  </TabsTrigger>
                  <TabsTrigger value="purchases" className="gap-1">
                    <CreditCard className="h-4 w-4" />
                    Покупки
                  </TabsTrigger>
                </TabsList>

                {/* Audit Tab */}
                <TabsContent value="audit" className="mt-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">История изменений</CardTitle>
                      <CardDescription>Все события по участнику</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {auditLoading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                      ) : auditHistory && auditHistory.length > 0 ? (
                        <ScrollArea className="h-[300px]">
                          <div className="space-y-3">
                            {auditHistory.map((event: any) => (
                              <div key={event.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50">
                                {getEventIcon(event.event_type)}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm">{getEventLabel(event.event_type)}</span>
                                    <Badge variant="outline" className="text-xs">
                                      {event.actor_type === 'admin' ? 'Админ' : 'Система'}
                                    </Badge>
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {format(new Date(event.created_at), 'dd.MM.yy HH:mm', { locale: ru })}
                                  </div>
                                  {event.reason && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                      Причина: {event.reason}
                                    </div>
                                  )}
                                  {(event.telegram_chat_result || event.telegram_channel_result) && (
                                    <div className="text-xs mt-1 space-x-2">
                                      {event.telegram_chat_result && (
                                        <span className={event.telegram_chat_result.success ? 'text-green-600' : 'text-destructive'}>
                                          Чат: {event.telegram_chat_result.success ? 'OK' : event.telegram_chat_result.error || 'Ошибка'}
                                        </span>
                                      )}
                                      {event.telegram_channel_result && (
                                        <span className={event.telegram_channel_result.success ? 'text-green-600' : 'text-destructive'}>
                                          Канал: {event.telegram_channel_result.success ? 'OK' : event.telegram_channel_result.error || 'Ошибка'}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      ) : (
                        <p className="text-center text-muted-foreground py-4">
                          Нет записей аудита
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Access Tab */}
                <TabsContent value="access" className="mt-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">История доступа</CardTitle>
                      <CardDescription>Все выдачи и отзывы доступа</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {grantsLoading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                      ) : accessGrants && accessGrants.length > 0 ? (
                        <ScrollArea className="h-[250px]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Клуб</TableHead>
                                <TableHead>Тип</TableHead>
                                <TableHead>Период</TableHead>
                                <TableHead>Статус</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {accessGrants.map((grant) => (
                                <TableRow key={grant.id}>
                                  <TableCell className="font-medium">
                                    {grant.telegram_clubs?.club_name || '—'}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline">{getSourceLabel(grant.source)}</Badge>
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    <div>{format(new Date(grant.start_at), 'dd.MM.yy', { locale: ru })}</div>
                                    {grant.end_at && (
                                      <div className="text-muted-foreground">
                                        до {format(new Date(grant.end_at), 'dd.MM.yy', { locale: ru })}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell>{getStatusBadge(grant.status)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      ) : (
                        <p className="text-center text-muted-foreground py-4">
                          Нет записей о доступе
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Purchases Tab */}
                <TabsContent value="purchases" className="mt-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">История покупок</CardTitle>
                      <CardDescription>Все заказы и платежи</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {ordersLoading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                      ) : orders && orders.length > 0 ? (
                        <ScrollArea className="h-[250px]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Дата</TableHead>
                                <TableHead>Продукт</TableHead>
                                <TableHead>Сумма</TableHead>
                                <TableHead>Статус</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {orders.map((order) => (
                                <TableRow key={order.id}>
                                  <TableCell className="text-sm">
                                    {format(new Date(order.created_at), 'dd.MM.yy HH:mm', { locale: ru })}
                                  </TableCell>
                                  <TableCell className="font-medium">
                                    {order.products?.name || '—'}
                                  </TableCell>
                                  <TableCell>
                                    {(order.amount / 100).toFixed(2)} {order.currency}
                                  </TableCell>
                                  <TableCell>{getStatusBadge(order.status)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      ) : (
                        <p className="text-center text-muted-foreground py-4">
                          Нет покупок
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              {/* Unlinked user warning */}
              {!member.profiles && (
                <Card className="border-destructive/50 bg-destructive/5">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                      <div>
                        <p className="font-medium">Telegram не связан с аккаунтом</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Этот пользователь находится в чате/канале, но не имеет привязанного аккаунта в системе.
                          Вы можете удалить его из чата/канала.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Send Message Dialog */}
      <Dialog open={showMessageDialog} onOpenChange={setShowMessageDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отправить сообщение</DialogTitle>
            <DialogDescription>
              {member && (
                <>Получатель: {member.telegram_first_name} {member.telegram_last_name} 
                ({member.telegram_username ? `@${member.telegram_username}` : `ID: ${member.telegram_user_id}`})</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Шаблоны</Label>
              <div className="flex flex-wrap gap-2">
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setMessageText('Напоминаем о необходимости продлить подписку для сохранения доступа к клубу.')}
                >
                  Продление
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setMessageText('К сожалению, оплата не прошла. Пожалуйста, попробуйте ещё раз или свяжитесь с поддержкой.')}
                >
                  Ошибка оплаты
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setMessageText('Пожалуйста, свяжитесь с нами для уточнения деталей вашей подписки.')}
                >
                  Связаться
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message-text">Текст сообщения</Label>
              <Textarea
                id="message-text"
                placeholder="Введите текст сообщения..."
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={5}
              />
              <p className="text-xs text-muted-foreground">
                Сообщение будет отправлено от имени бота. Пользователь должен был ранее начать диалог с ботом.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowMessageDialog(false);
              setMessageText('');
            }}>
              Отмена
            </Button>
            <Button 
              onClick={handleSendMessage} 
              disabled={sendingMessage || !messageText.trim()}
            >
              {sendingMessage && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              <Send className="h-4 w-4 mr-2" />
              Отправить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Grant Access Dialog */}
      <Dialog open={showGrantDialog} onOpenChange={setShowGrantDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Выдать доступ</DialogTitle>
            <DialogDescription>
              Выдайте доступ пользователю {member?.profiles?.full_name || member?.telegram_first_name} к клубу
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="days">Срок доступа (дней)</Label>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="days"
                  type="number"
                  min={1}
                  max={365}
                  value={grantDays}
                  onChange={(e) => setGrantDays(parseInt(e.target.value) || 30)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                До {format(addDays(new Date(), grantDays), 'dd.MM.yyyy', { locale: ru })}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="comment">Комментарий</Label>
              <Textarea
                id="comment"
                placeholder="Причина выдачи доступа..."
                value={grantComment}
                onChange={(e) => setGrantComment(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGrantDialog(false)}>
              Отмена
            </Button>
            <Button onClick={handleGrantAccess} disabled={grantAccess.isPending}>
              {grantAccess.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Выдать доступ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend Access Dialog */}
      <Dialog open={showExtendDialog} onOpenChange={setShowExtendDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Продлить доступ</DialogTitle>
            <DialogDescription>
              Продлите доступ пользователю {member?.profiles?.full_name || member?.telegram_first_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="extend-days">Продлить на (дней)</Label>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="extend-days"
                  type="number"
                  min={1}
                  max={365}
                  value={extendDays}
                  onChange={(e) => setExtendDays(parseInt(e.target.value) || 30)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Новая дата окончания: {format(addDays(new Date(), extendDays), 'dd.MM.yyyy', { locale: ru })}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="extend-comment">Комментарий</Label>
              <Textarea
                id="extend-comment"
                placeholder="Причина продления..."
                value={extendComment}
                onChange={(e) => setExtendComment(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExtendDialog(false)}>
              Отмена
            </Button>
            <Button onClick={handleExtendAccess} disabled={grantAccess.isPending}>
              {grantAccess.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Продлить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Access Dialog */}
      <Dialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Отозвать доступ</DialogTitle>
            <DialogDescription>
              {member?.profiles 
                ? `Отзыв доступа для ${member.profiles.full_name || member.telegram_first_name}. Пользователь будет удалён из чата и канала.`
                : `Удаление ${member?.telegram_first_name || 'пользователя'} (ID: ${member?.telegram_user_id}) из чата и канала.`
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="revoke-reason">Причина</Label>
              <Textarea
                id="revoke-reason"
                placeholder="Укажите причину..."
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRevokeDialog(false)}>
              Отмена
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleRevokeAccess} 
              disabled={revokeAccess.isPending}
            >
              {revokeAccess.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {member?.profiles ? 'Отозвать доступ' : 'Удалить из Telegram'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
