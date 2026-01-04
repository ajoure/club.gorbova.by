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
import { Loader2, Trash2, Users, Settings, CheckCircle, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { 
  TelegramClub, 
  TelegramBot,
  useUpdateTelegramClub,
  useDeleteTelegramClub,
  useClubMembers,
  useSyncClubMembers,
} from '@/hooks/useTelegramIntegration';
import { HelpLabel } from '@/components/help/HelpComponents';

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
  const [formData, setFormData] = useState({
    club_name: '',
    bot_id: '',
    chat_invite_link: '',
    channel_invite_link: '',
    access_mode: 'AUTO_WITH_FALLBACK',
    revoke_mode: 'KICK_ONLY',
    subscription_duration_days: 30,
  });

  // Update form when club changes - use useEffect correctly
  useEffect(() => {
    if (club) {
      setFormData({
        club_name: club.club_name,
        bot_id: club.bot_id,
        chat_invite_link: club.chat_invite_link || '',
        channel_invite_link: club.channel_invite_link || '',
        access_mode: club.access_mode,
        revoke_mode: club.revoke_mode,
        subscription_duration_days: club.subscription_duration_days,
      });
      setActiveTab('settings');
    }
  }, [club]);

  const handleSave = async () => {
    if (!club) return;
    
    await updateClub.mutateAsync({
      id: club.id,
      ...formData,
    });
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
  };

  const activeBots = bots.filter(b => b.status === 'active');

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
        <DialogContent className="max-w-2xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Настройки клуба</DialogTitle>
            <DialogDescription>
              Редактирование параметров клуба
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="settings" className="gap-2">
                <Settings className="h-4 w-4" />
                Настройки
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
                    <SelectItem value="AUTO_ADD">Автодобавление</SelectItem>
                    <SelectItem value="INVITE_ONLY">Только ссылки</SelectItem>
                    <SelectItem value="AUTO_WITH_FALLBACK">Авто + ссылки (fallback)</SelectItem>
                  </SelectContent>
                </Select>
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

            <TabsContent value="members" className="mt-4">
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm text-muted-foreground">
                  {club?.last_members_sync_at ? (
                    <>Последняя синхронизация: {new Date(club.last_members_sync_at).toLocaleString('ru-RU')}</>
                  ) : (
                    <>Синхронизация не выполнялась</>
                  )}
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

              <ScrollArea className="h-[350px] rounded-md border">
                {membersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : members && members.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Telegram</TableHead>
                        <TableHead>Клиент</TableHead>
                        <TableHead>Чат</TableHead>
                        <TableHead>Канал</TableHead>
                        <TableHead>Статус доступа</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((member) => (
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
                            {member.in_chat ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell>
                            {member.in_channel ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
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

              {members && members.length > 0 && (
                <div className="flex gap-4 mt-4 text-sm text-muted-foreground">
                  <span>Всего: {members.length}</span>
                  <span className="text-green-600">
                    С доступом: {members.filter(m => m.access_status === 'ok').length}
                  </span>
                  <span className="text-red-600">
                    Нарушители: {members.filter(m => m.access_status === 'no_access').length}
                  </span>
                </div>
              )}
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
