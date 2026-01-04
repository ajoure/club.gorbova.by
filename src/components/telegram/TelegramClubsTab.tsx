import { useState } from 'react';
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
import { Plus, Settings, Trash2, CheckCircle, XCircle, Loader2, MessageSquare, Megaphone } from 'lucide-react';
import { 
  useTelegramClubs, 
  useTelegramBots,
  useCreateTelegramClub, 
  useUpdateTelegramClub,
} from '@/hooks/useTelegramIntegration';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { HelpLabel, HelpIcon } from '@/components/help/HelpComponents';

export function TelegramClubsTab() {
  const { data: clubs, isLoading } = useTelegramClubs();
  const { data: bots } = useTelegramBots();
  const createClub = useCreateTelegramClub();
  const updateClub = useUpdateTelegramClub();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingClub, setEditingClub] = useState<string | null>(null);
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
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Telegram клубы</CardTitle>
            <CardDescription>
              Клубы объединяют чат и канал. После оплаты подписки пользователь 
              автоматически получает доступ. Через 30 дней доступ отзывается автоматически.
            </CardDescription>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={activeBots.length === 0}>
                <Plus className="h-4 w-4 mr-2" />
                Добавить клуб
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingClub(club.id)}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
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
    </Card>
  );
}
