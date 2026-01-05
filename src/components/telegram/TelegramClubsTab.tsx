import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Plus, Settings, Users, CheckCircle, XCircle, Loader2, MessageSquare, Megaphone, AlertTriangle, HelpCircle, Info, Link2, Package, BarChart3 } from 'lucide-react';
import { 
  useTelegramClubs, 
  useTelegramBots,
  useCreateTelegramClub, 
  useUpdateTelegramClub,
  TelegramClub,
} from '@/hooks/useTelegramIntegration';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { HelpLabel } from '@/components/help/HelpComponents';
import { ClubSettingsDialog } from './ClubSettingsDialog';

export function TelegramClubsTab() {
  const navigate = useNavigate();
  const { data: clubs, isLoading } = useTelegramClubs();
  const { data: bots } = useTelegramBots();
  const createClub = useCreateTelegramClub();
  const updateClub = useUpdateTelegramClub();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingClub, setEditingClub] = useState<TelegramClub | null>(null);
  const [newClub, setNewClub] = useState({
    club_name: '',
    bot_id: '',
    chat_invite_link: '',
    channel_invite_link: '',
    access_mode: 'AUTO_WITH_FALLBACK',
    revoke_mode: 'KICK_ONLY',
    subscription_duration_days: 30,
  });

  const handleAddClub = async () => {
    if (!newClub.club_name || !newClub.bot_id) {
      toast.error('Укажите название и выберите бота');
      return;
    }

    await createClub.mutateAsync(newClub);
    setNewClub({
      club_name: '',
      bot_id: '',
      chat_invite_link: '',
      channel_invite_link: '',
      access_mode: 'AUTO_WITH_FALLBACK',
      revoke_mode: 'KICK_ONLY',
      subscription_duration_days: 30,
    });
    setIsAddDialogOpen(false);
  };

  const handleToggleActive = async (clubId: string, isActive: boolean) => {
    await updateClub.mutateAsync({
      id: clubId,
      is_active: !isActive,
    });
  };

  const activeBots = bots?.filter(b => b.status === 'active') || [];

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
      <CardHeader className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-2">
            <CardTitle>Telegram клубы</CardTitle>
            <CardDescription>
              Клубы объединяют чат и канал. После оплаты подписки пользователь 
              автоматически получает доступ. Через 30 дней доступ отзывается автоматически.
            </CardDescription>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 text-muted-foreground cursor-help">
                      <Info className="h-3.5 w-3.5" />
                      Режимы доступа
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <p className="font-medium mb-1">Режимы выдачи доступа:</p>
                    <ul className="text-xs space-y-1">
                      <li><strong>Авто</strong> — бот разблокирует пользователя автоматически (требуется /start в боте)</li>
                      <li><strong>Ссылки</strong> — бот отправляет одноразовые инвайт-ссылки</li>
                      <li><strong>Авто+</strong> — сначала пробует авто, при неудаче отправляет ссылку</li>
                    </ul>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 text-muted-foreground cursor-help">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                      Нарушители
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <p className="font-medium mb-1">Кто такие нарушители?</p>
                    <p className="text-xs">
                      Это участники чата/канала, у которых нет привязанного аккаунта в системе. 
                      Они попали в клуб без оплаты — через чужую ссылку или другим способом. 
                      Их можно удалить на экране «Участники».
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-4 sm:mt-0">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate('/admin/integrations/telegram/product-mappings')}
            >
              <Package className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Автодоступ</span>
            </Button>
            <Button 
              variant="outline"
              size="sm"
              onClick={() => navigate('/admin/integrations/telegram/invites')}
            >
              <Link2 className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Инвайты</span>
            </Button>
            <Button 
              variant="outline"
              size="sm"
              onClick={() => navigate('/admin/integrations/telegram/analytics')}
            >
              <BarChart3 className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Аналитика</span>
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={activeBots.length === 0}>
                  <Plus className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Добавить клуб</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Добавить клуб</DialogTitle>
                <DialogDescription>
                  Создайте клуб для управления доступом в чат и канал
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="club_name">Название клуба</Label>
                  <Input
                    id="club_name"
                    placeholder="Gorbova Club"
                    value={newClub.club_name}
                    onChange={(e) => setNewClub({ ...newClub, club_name: e.target.value })}
                  />
                </div>
                
                <div>
                  <Label htmlFor="bot_id">Бот</Label>
                  <Select
                    value={newClub.bot_id}
                    onValueChange={(value) => setNewClub({ ...newClub, bot_id: value })}
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
                    value={newClub.chat_invite_link}
                    onChange={(e) => setNewClub({ ...newClub, chat_invite_link: e.target.value })}
                  />
                </div>

                <div>
                  <Label htmlFor="channel_invite_link">Инвайт-ссылка на канал</Label>
                  <Input
                    id="channel_invite_link"
                    placeholder="https://t.me/+..."
                    value={newClub.channel_invite_link}
                    onChange={(e) => setNewClub({ ...newClub, channel_invite_link: e.target.value })}
                  />
                </div>

                <div>
                  <HelpLabel helpKey="telegram.access_mode" htmlFor="access_mode">
                    Режим доступа
                  </HelpLabel>
                  <Select
                    value={newClub.access_mode}
                    onValueChange={(value) => setNewClub({ ...newClub, access_mode: value })}
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
                    value={newClub.subscription_duration_days}
                    onChange={(e) => setNewClub({ ...newClub, subscription_duration_days: parseInt(e.target.value) || 30 })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Отмена
                </Button>
                <Button onClick={handleAddClub} disabled={createClub.isPending}>
                  {createClub.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Создать'}
                </Button>
              </DialogFooter>
            </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {activeBots.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Сначала добавьте хотя бы одного активного бота.
          </div>
        ) : clubs && clubs.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Клуб</TableHead>
                <TableHead>Бот</TableHead>
                <TableHead>Чат</TableHead>
                <TableHead>Канал</TableHead>
                <TableHead>Режим</TableHead>
                <TableHead>Активен</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clubs.map((club) => (
                <TableRow key={club.id}>
                  <TableCell>
                    <div className="font-medium">{club.club_name}</div>
                    <div className="text-sm text-muted-foreground">
                      {club.subscription_duration_days} дней
                    </div>
                  </TableCell>
                  <TableCell>
                    {club.telegram_bots ? (
                      <span>@{club.telegram_bots.bot_username}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4" />
                      {club.chat_id ? (
                        <Badge variant="outline" className="bg-green-500/10 text-green-600">
                          Подключен
                        </Badge>
                      ) : club.chat_invite_link ? (
                        <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600">
                          Ожидает
                        </Badge>
                      ) : (
                        <Badge variant="outline">Не настроен</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Megaphone className="h-4 w-4" />
                      {club.channel_id ? (
                        <Badge variant="outline" className="bg-green-500/10 text-green-600">
                          Подключен
                        </Badge>
                      ) : club.channel_invite_link ? (
                        <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600">
                          Ожидает
                        </Badge>
                      ) : (
                        <Badge variant="outline">Не настроен</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {club.access_mode === 'AUTO_ADD' && 'Авто'}
                      {club.access_mode === 'INVITE_ONLY' && 'Ссылки'}
                      {club.access_mode === 'AUTO_WITH_FALLBACK' && 'Авто+'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={club.is_active}
                      onCheckedChange={() => handleToggleActive(club.id, club.is_active)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => navigate(`/admin/integrations/telegram/clubs/${club.id}/members`)}
                            >
                              <Users className="h-4 w-4" />
                              {(club.violators_count ?? 0) > 0 && (
                                <span className="ml-1 text-xs text-destructive">
                                  {club.violators_count}
                                </span>
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Участники</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingClub(club)}
                            >
                              <Settings className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Настройки</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Клубы не созданы. Нажмите "Добавить клуб" для начала работы.
          </div>
        )}
      </CardContent>

      {/* Settings Dialog */}
      <ClubSettingsDialog 
        club={editingClub}
        bots={bots || []}
        onClose={() => setEditingClub(null)}
      />
    </Card>
  );
}
