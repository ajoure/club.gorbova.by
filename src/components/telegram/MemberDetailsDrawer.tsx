import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
} from 'lucide-react';
import { 
  TelegramClubMember,
  useUserAccessGrants,
  useGrantTelegramAccess,
} from '@/hooks/useTelegramIntegration';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';

interface MemberDetailsDrawerProps {
  member: TelegramClubMember | null;
  clubId: string | null;
  onClose: () => void;
  onRefresh?: () => void;
}

export function MemberDetailsDrawer({ member, clubId, onClose, onRefresh }: MemberDetailsDrawerProps) {
  const userId = member?.profiles?.user_id;
  const [showGrantDialog, setShowGrantDialog] = useState(false);
  const [grantDays, setGrantDays] = useState(30);
  const [grantComment, setGrantComment] = useState('');
  const [diagnosticResult, setDiagnosticResult] = useState<any>(null);
  
  const grantAccess = useGrantTelegramAccess();

  // Check link mutation
  const checkLink = useMutation({
    mutationFn: async () => {
      if (!clubId || !member) return null;
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: { 
          action: 'check_link', 
          club_id: clubId,
          profile_id: member.profile_id,
          telegram_user_id: member.telegram_user_id,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setDiagnosticResult(data?.diagnostics);
      toast.success('Проверка выполнена');
    },
    onError: (error: any) => {
      toast.error('Ошибка проверки: ' + error.message);
    },
  });

  // Fetch access grants history
  const { data: accessGrants, isLoading: grantsLoading } = useUserAccessGrants(userId || null);

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
    onRefresh?.();
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

  return (
    <>
      <Sheet open={!!member} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
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
                    {member.in_chat ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Megaphone className="h-4 w-4" />
                      В канале
                    </span>
                    {member.in_channel ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Diagnostics Card */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Диагностика</CardTitle>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => checkLink.mutate()}
                      disabled={checkLink.isPending}
                    >
                      {checkLink.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Search className="h-4 w-4 mr-2" />
                      )}
                      Проверить связку
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">telegram_user_id</span>
                    <span className="font-mono flex items-center gap-1">
                      {member.telegram_user_id}
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-5 w-5"
                        onClick={() => {
                          navigator.clipboard.writeText(String(member.telegram_user_id));
                          toast.success('Скопировано');
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">profile_id</span>
                    <span className="font-mono text-xs">{member.profile_id || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">link_status</span>
                    <Badge variant={member.link_status === 'linked' ? 'default' : 'secondary'}>
                      {member.link_status}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">access_status</span>
                    <Badge variant={
                      member.access_status === 'ok' ? 'default' : 
                      member.access_status === 'expired' ? 'secondary' : 
                      'destructive'
                    }>
                      {member.access_status}
                    </Badge>
                  </div>
                  {member.last_synced_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">last_synced_at</span>
                      <span className="text-xs">
                        {format(new Date(member.last_synced_at), 'dd.MM.yy HH:mm', { locale: ru })}
                      </span>
                    </div>
                  )}
                  
                  {/* Diagnostic results */}
                  {diagnosticResult && (
                    <div className="mt-4 p-3 bg-muted rounded-md">
                      <p className="font-medium mb-2">Результат проверки:</p>
                      {diagnosticResult.checks?.map((check: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs mb-1">
                          {check.passed ? (
                            <CheckCircle className="h-3 w-3 text-green-500" />
                          ) : (
                            <XCircle className="h-3 w-3 text-destructive" />
                          )}
                          <span>{check.check}: {check.details}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Grant Access Button - only for linked users without access */}
              {member.profiles && member.access_status !== 'ok' && (
                <Button 
                  className="w-full" 
                  onClick={() => setShowGrantDialog(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Выдать доступ вручную
                </Button>
              )}

              {/* Tabs for history */}
              {member.profiles && (
                <Tabs defaultValue="access" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="access" className="gap-1">
                      <History className="h-4 w-4" />
                      Доступ
                    </TabsTrigger>
                    <TabsTrigger value="purchases" className="gap-1">
                      <CreditCard className="h-4 w-4" />
                      Покупки
                    </TabsTrigger>
                  </TabsList>

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
                        ) : (
                          <p className="text-center text-muted-foreground py-4">
                            Нет записей о доступе
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

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
                        ) : (
                          <p className="text-center text-muted-foreground py-4">
                            Нет покупок
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              )}

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
                          Он будет помечен как нарушитель и может быть удалён.
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

      {/* Grant Access Dialog */}
      <Dialog open={showGrantDialog} onOpenChange={setShowGrantDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Выдать доступ вручную</DialogTitle>
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
              <Label htmlFor="comment">Комментарий (необязательно)</Label>
              <Input
                id="comment"
                placeholder="Причина выдачи..."
                value={grantComment}
                onChange={(e) => setGrantComment(e.target.value)}
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
    </>
  );
}