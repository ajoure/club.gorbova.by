import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Trash2, Users, Settings, CheckCircle, XCircle, AlertTriangle, RefreshCw, ShieldCheck, Info } from 'lucide-react';
import { 
  TelegramClub, 
  TelegramBot,
  useUpdateTelegramClub,
  useDeleteTelegramClub,
  useClubMembers,
  useSyncClubMembers,
} from '@/hooks/useTelegramIntegration';
import { HelpLabel } from '@/components/help/HelpComponents';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ClubSettingsDialogProps {
  club: TelegramClub | null;
  bots: TelegramBot[];
  onClose: () => void;
}

export function ClubSettingsDialog({ club, bots, onClose }: ClubSettingsDialogProps) {
  const updateClub = useUpdateTelegramClub();
  const deleteClub = useDeleteTelegramClub();
  const { data: members, isLoading: membersLoading } = useClubMembers(club?.id || null);
  const syncMembers = useSyncClubMembers();
  
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [activeTab, setActiveTab] = useState('settings');
  const [membersView, setMembersView] = useState<'all' | 'clients'>('all');
  const [testingBot, setTestingBot] = useState(false);
  const [botTestResult, setBotTestResult] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    club_name: '',
    bot_id: '',
    chat_id: '',
    channel_id: '',
    chat_invite_link: '',
    channel_invite_link: '',
    access_mode: 'AUTO_WITH_FALLBACK',
    revoke_mode: 'KICK_ONLY',
    subscription_duration_days: 30,
    join_request_mode: false,
    autokick_no_access: false,
    auto_resync_enabled: true,
    auto_resync_interval_minutes: 60,
    chat_analytics_enabled: false,
  });

  useEffect(() => {
    if (club) {
      setFormData({
        club_name: club.club_name,
        bot_id: club.bot_id,
        chat_id: club.chat_id?.toString() || '',
        channel_id: club.channel_id?.toString() || '',
        chat_invite_link: club.chat_invite_link || '',
        channel_invite_link: club.channel_invite_link || '',
        access_mode: club.access_mode,
        revoke_mode: club.revoke_mode,
        subscription_duration_days: club.subscription_duration_days,
        join_request_mode: (club as any).join_request_mode || false,
        autokick_no_access: (club as any).autokick_no_access || false,
        auto_resync_enabled: (club as any).auto_resync_enabled ?? true,
        auto_resync_interval_minutes: (club as any).auto_resync_interval_minutes || 60,
        chat_analytics_enabled: (club as any).chat_analytics_enabled || false,
      });
      setActiveTab('settings');
      setMembersView('all');
      setBotTestResult(null);
    }
  }, [club?.id, club?.updated_at]);

  const handleSave = async () => {
    if (!club) return;
    
    await updateClub.mutateAsync({
      id: club.id,
      club_name: formData.club_name,
      bot_id: formData.bot_id,
      chat_id: formData.chat_id ? parseInt(formData.chat_id) : null,
      channel_id: formData.channel_id ? parseInt(formData.channel_id) : null,
      chat_invite_link: formData.chat_invite_link,
      channel_invite_link: formData.channel_invite_link,
      access_mode: formData.access_mode,
      revoke_mode: formData.revoke_mode,
      subscription_duration_days: formData.subscription_duration_days,
      join_request_mode: formData.join_request_mode,
      autokick_no_access: formData.autokick_no_access,
      auto_resync_enabled: formData.auto_resync_enabled,
      auto_resync_interval_minutes: formData.auto_resync_interval_minutes,
      chat_analytics_enabled: formData.chat_analytics_enabled,
    } as any);
    onClose();
  };

  const handleDelete = async () => {
    if (!club) return;
    
    await deleteClub.mutateAsync(club.id);
    setShowDeleteDialog(false);
    onClose();
  };

  const handleSync = async () => {
    if (!club) return;
    await syncMembers.mutateAsync(club.id);
    toast.success('Данные обновлены');
  };

  const handleTestBot = async () => {
    if (!club) return;
    setTestingBot(true);
    setBotTestResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('telegram-bot-actions', {
        body: {
          action: 'check_chat_rights',
          bot_id: club.bot_id,
          chat_id: formData.chat_id ? parseInt(formData.chat_id) : null,
          channel_id: formData.channel_id ? parseInt(formData.channel_id) : null,
        },
      });
      
      if (error) throw error;
      setBotTestResult(data);
    } catch (e) {
      console.error('Bot test error:', e);
      setBotTestResult({ error: 'Ошибка проверки' });
    }
    
    setTestingBot(false);
  };

  const activeBots = bots.filter(b => b.status === 'active');

  const clubMembers = members ?? [];
  const clientsInClub = clubMembers.filter((m) => !!m.profiles && (m.in_chat || m.in_channel));
  const displayedMembers = membersView === 'clients' ? clientsInClub : clubMembers;

  const getAccessStatusBadge = (status: string) => {
    switch (status) {
      case 'ok':
        return (
          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
            <CheckCircle className="h-3 w-3 mr-1" />
            Доступ есть
          </Badge>
        );
      case 'expired':
        return (
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Истёк
          </Badge>
        );
      case 'no_access':
        return (
          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">
            <XCircle className="h-3 w-3 mr-1" />
            Нет доступа
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <>
      <Dialog open={!!club} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Настройки клуба</DialogTitle>
            <DialogDescription>
              Редактирование параметров клуба
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="settings" className="gap-2">
                <Settings className="h-4 w-4" />
                Настройки
              </TabsTrigger>
              <TabsTrigger value="access" className="gap-2">
                <ShieldCheck className="h-4 w-4" />
                Доступ
              </TabsTrigger>
              <TabsTrigger value="members" className="gap-2">
                <Users className="h-4 w-4" />
                Участники
                {members && members.length > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {members.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Settings Tab */}
            <TabsContent value="settings" className="space-y-4 mt-4">
              <div>
                <Label htmlFor="club_name">Название клуба</Label>
                <Input
                  id="club_name"
                  value={formData.club_name}
                  onChange={(e) => setFormData({ ...formData, club_name: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="bot_id">Бот</Label>
                <Select
                  value={formData.bot_id}
                  onValueChange={(value) => setFormData({ ...formData, bot_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите бота" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeBots.map((bot) => (
                      <SelectItem key={bot.id} value={bot.id}>
                        {bot.bot_name} (@{bot.bot_username})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="chat_id">Chat ID (группа)</Label>
                  <Input
                    id="chat_id"
                    placeholder="-100..."
                    value={formData.chat_id}
                    onChange={(e) => setFormData({ ...formData, chat_id: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="channel_id">Channel ID (канал)</Label>
                  <Input
                    id="channel_id"
                    placeholder="-100..."
                    value={formData.channel_id}
                    onChange={(e) => setFormData({ ...formData, channel_id: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="chat_invite_link">Инвайт-ссылка на чат</Label>
                <Input
                  id="chat_invite_link"
                  placeholder="https://t.me/+..."
                  value={formData.chat_invite_link}
                  onChange={(e) => setFormData({ ...formData, chat_invite_link: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="channel_invite_link">Инвайт-ссылка на канал</Label>
                <Input
                  id="channel_invite_link"
                  placeholder="https://t.me/+..."
                  value={formData.channel_invite_link}
                  onChange={(e) => setFormData({ ...formData, channel_invite_link: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="subscription_duration_days">Длительность подписки (дней)</Label>
                <Input
                  id="subscription_duration_days"
                  type="number"
                  value={formData.subscription_duration_days}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    subscription_duration_days: parseInt(e.target.value) || 30 
                  })}
                />
              </div>

              {/* Bot diagnostics */}
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Диагностика бота</Label>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleTestBot}
                    disabled={testingBot || (!formData.chat_id && !formData.channel_id)}
                  >
                    {testingBot ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Проверить права
                  </Button>
                </div>
                {!formData.chat_id && !formData.channel_id && (
                  <p className="text-sm text-muted-foreground">
                    Укажите Chat ID или Channel ID для проверки
                  </p>
                )}
                {botTestResult && (
                  <div className="text-sm space-y-3">
                    {botTestResult.error ? (
                      <p className="text-destructive">{botTestResult.error}</p>
                    ) : (
                      <>
                        {botTestResult.chat && (
                          <div className="space-y-1">
                            <p className="font-medium text-muted-foreground">Чат (группа):</p>
                            {botTestResult.chat.error ? (
                              <div className="flex items-center gap-2 text-destructive">
                                <XCircle className="h-4 w-4" />
                                <span>{botTestResult.chat.error}</span>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2">
                                  {botTestResult.chat.is_admin ? (
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                  ) : (
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  )}
                                  <span>Админ: {botTestResult.chat.is_admin ? 'Да' : 'Нет'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {botTestResult.chat.can_restrict_members ? (
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                  ) : (
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  )}
                                  <span>Может кикать: {botTestResult.chat.can_restrict_members ? 'Да' : 'Нет'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {botTestResult.chat.can_invite_users ? (
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                  ) : (
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  )}
                                  <span>Может приглашать: {botTestResult.chat.can_invite_users ? 'Да' : 'Нет'}</span>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        {botTestResult.channel && (
                          <div className="space-y-1">
                            <p className="font-medium text-muted-foreground">Канал:</p>
                            {botTestResult.channel.error ? (
                              <div className="flex items-center gap-2 text-destructive">
                                <XCircle className="h-4 w-4" />
                                <span>{botTestResult.channel.error}</span>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2">
                                  {botTestResult.channel.is_admin ? (
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                  ) : (
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  )}
                                  <span>Админ: {botTestResult.channel.is_admin ? 'Да' : 'Нет'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {botTestResult.channel.can_restrict_members ? (
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                  ) : (
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  )}
                                  <span>Может кикать: {botTestResult.channel.can_restrict_members ? 'Да' : 'Нет'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {botTestResult.channel.can_invite_users ? (
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                  ) : (
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  )}
                                  <span>Может приглашать: {botTestResult.channel.can_invite_users ? 'Да' : 'Нет'}</span>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Access Control Tab */}
            <TabsContent value="access" className="space-y-4 mt-4">
              <div>
                <HelpLabel helpKey="telegram.access_mode" htmlFor="access_mode">
                  Режим доступа
                </HelpLabel>
                <Select
                  value={formData.access_mode}
                  onValueChange={(value) => setFormData({ ...formData, access_mode: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUTO_ADD">Автодобавление (join requests)</SelectItem>
                    <SelectItem value="INVITE_ONLY">Только ссылки</SelectItem>
                    <SelectItem value="AUTO_WITH_FALLBACK">Авто + ссылки (рекомендуется)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Join Request Mode */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <Label htmlFor="join_request_mode" className="font-medium">
                    Режим заявок (Join Request Mode)
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Пользователи подают заявку на вступление, бот автоматически одобряет/отклоняет
                  </p>
                </div>
                <Switch
                  id="join_request_mode"
                  checked={formData.join_request_mode}
                  onCheckedChange={(checked) => setFormData({ ...formData, join_request_mode: checked })}
                />
              </div>

              {formData.join_request_mode && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Включите в Telegram настройку "Approve new members" в чате/канале и дайте боту права на approve/decline заявок.
                  </AlertDescription>
                </Alert>
              )}

              {/* Autokick */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <Label htmlFor="autokick_no_access" className="font-medium">
                    Автокик пользователей без доступа
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Автоматически удалять из чата и канала при истечении/отзыве доступа
                  </p>
                </div>
                <Switch
                  id="autokick_no_access"
                  checked={formData.autokick_no_access}
                  onCheckedChange={(checked) => setFormData({ ...formData, autokick_no_access: checked })}
                />
              </div>

              {/* Auto Resync */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <Label htmlFor="auto_resync_enabled" className="font-medium">
                    Автосверка статусов
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Периодическая проверка статусов участников через getChatMember
                  </p>
                </div>
                <Switch
                  id="auto_resync_enabled"
                  checked={formData.auto_resync_enabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, auto_resync_enabled: checked })}
                />
              </div>

              {formData.auto_resync_enabled && (
                <div>
                  <Label htmlFor="auto_resync_interval">Интервал автосверки (минут)</Label>
                  <Select
                    value={formData.auto_resync_interval_minutes.toString()}
                    onValueChange={(value) => setFormData({ ...formData, auto_resync_interval_minutes: parseInt(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 минут</SelectItem>
                      <SelectItem value="60">1 час</SelectItem>
                      <SelectItem value="120">2 часа</SelectItem>
                      <SelectItem value="360">6 часов</SelectItem>
                      <SelectItem value="720">12 часов</SelectItem>
                      <SelectItem value="1440">24 часа</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Chat Analytics */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <Label htmlFor="chat_analytics_enabled" className="font-medium">
                    Аналитика чата
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Сбор сообщений из чата для ежедневных итогов и поддержки
                  </p>
                </div>
                <Switch
                  id="chat_analytics_enabled"
                  checked={formData.chat_analytics_enabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, chat_analytics_enabled: checked })}
                />
              </div>

              {formData.chat_analytics_enabled && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Для работы аналитики отключите "Group Privacy" в настройках бота (@BotFather → Bot Settings → Group Privacy → Turn off).
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t">
                <Button 
                  variant="destructive" 
                  onClick={() => setShowDeleteDialog(true)}
                  className="sm:mr-auto"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Удалить клуб
                </Button>
                <Button variant="outline" onClick={onClose}>
                  Отмена
                </Button>
                <Button onClick={handleSave} disabled={updateClub.isPending}>
                  {updateClub.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Сохранить'
                  )}
                </Button>
              </div>
            </TabsContent>

            {/* Members Tab */}
            <TabsContent value="members" className="mt-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-muted-foreground">
                    {club?.last_members_sync_at ? (
                      <>Последняя синхронизация: {new Date(club.last_members_sync_at).toLocaleString('ru-RU')}</>
                    ) : (
                      <>Синхронизация не выполнялась</>
                    )}
                  </div>
                  <Select value={membersView} onValueChange={(v) => setMembersView(v as 'all' | 'clients')}>
                    <SelectTrigger className="w-[170px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все участники</SelectItem>
                      <SelectItem value="clients">Клиенты в клубе</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleSync}
                  disabled={syncMembers.isPending}
                >
                  {syncMembers.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Синхронизировать
                </Button>
              </div>

              <div className="flex flex-wrap gap-3 mb-3 text-sm text-muted-foreground">
                <span>Всего: {clubMembers.length}</span>
                <span>Клиенты: {clientsInClub.length}</span>
                <span className="text-green-600">С доступом: {clientsInClub.filter(m => m.access_status === 'ok').length}</span>
                <span className="text-red-600">Без доступа: {clientsInClub.filter(m => m.access_status !== 'ok').length}</span>
              </div>

              <ScrollArea className="h-[350px] rounded-md border">
                {membersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : displayedMembers && displayedMembers.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Telegram</TableHead>
                        <TableHead>Клиент</TableHead>
                        <TableHead>Чат</TableHead>
                        <TableHead>Канал</TableHead>
                        <TableHead>Статус</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedMembers.map((member) => (
                        <TableRow 
                          key={member.id}
                          className={member.access_status === 'no_access' ? 'bg-destructive/5' : ''}
                        >
                          <TableCell>
                            <div className="font-medium">
                              {member.telegram_first_name} {member.telegram_last_name}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {member.telegram_username ? `@${member.telegram_username}` : `ID: ${member.telegram_user_id}`}
                            </div>
                          </TableCell>
                          <TableCell>
                            {member.profiles ? (
                              <div>
                                <div className="text-sm">{member.profiles.full_name || member.profiles.email}</div>
                                <div className="text-xs text-muted-foreground">{member.profiles.phone}</div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">Не привязан</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {member.in_chat === true ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : member.in_chat === false ? (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <span className="text-muted-foreground">?</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {member.in_channel === true ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : member.in_channel === false ? (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <span className="text-muted-foreground">?</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {getAccessStatusBadge(member.access_status)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Users className="h-8 w-8 mb-2 opacity-50" />
                    <p>Нет данных об участниках</p>
                    <p className="text-sm">Нажмите "Синхронизировать" для загрузки списка</p>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить клуб?</AlertDialogTitle>
            <AlertDialogDescription>
              Клуб "{club?.club_name}" будет удалён. Все записи о доступе и участниках будут потеряны.
              Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteClub.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Удалить'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
