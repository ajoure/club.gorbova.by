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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, RefreshCw, Trash2, Eye, EyeOff, Webhook, CheckCircle, XCircle, Loader2, Star } from 'lucide-react';
import { 
  useTelegramBots, 
  useCreateTelegramBot, 
  useUpdateTelegramBot,
  useDeleteTelegramBot,
  useCheckBotConnection,
  useSetupWebhook,
} from '@/hooks/useTelegramIntegration';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { HelpLabel } from '@/components/help/HelpComponents';

export function TelegramBotsTab() {
  const { data: bots, isLoading } = useTelegramBots();
  const createBot = useCreateTelegramBot();
  const updateBot = useUpdateTelegramBot();
  const deleteBot = useDeleteTelegramBot();
  const checkConnection = useCheckBotConnection();
  const setupWebhook = useSetupWebhook();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [showTokenFor, setShowTokenFor] = useState<string | null>(null);
  const [newBot, setNewBot] = useState({
    bot_name: '',
    bot_username: '',
    bot_token_encrypted: '',
  });
  const [checkingBot, setCheckingBot] = useState<string | null>(null);

  const handleAddBot = async () => {
    if (!newBot.bot_name || !newBot.bot_username || !newBot.bot_token_encrypted) {
      toast.error('Заполните все поля');
      return;
    }

    // Check connection first
    setCheckingBot('new');
    const result = await checkConnection.mutateAsync({ botToken: newBot.bot_token_encrypted });
    setCheckingBot(null);

    if (!result.success) {
      toast.error(`Ошибка подключения: ${result.error}`);
      return;
    }

    // Create bot
    const created = await createBot.mutateAsync(newBot);
    
    // Setup webhook
    if (created) {
      await setupWebhook.mutateAsync(created.id);
    }

    setNewBot({ bot_name: '', bot_username: '', bot_token_encrypted: '' });
    setIsAddDialogOpen(false);
  };

  const handleCheckConnection = async (botId: string) => {
    setCheckingBot(botId);
    try {
      const result = await checkConnection.mutateAsync({ botId });
      if (result.success) {
        toast.success(`Подключение успешно: @${result.bot.username}`);
      } else {
        toast.error(`Ошибка: ${result.error}`);
      }
    } catch (error) {
      toast.error('Ошибка проверки подключения');
    }
    setCheckingBot(null);
  };

  const handleSetupWebhook = async (botId: string) => {
    await setupWebhook.mutateAsync(botId);
  };

  const handleToggleStatus = async (bot: { id: string; status: string }) => {
    await updateBot.mutateAsync({
      id: bot.id,
      status: bot.status === 'active' ? 'inactive' : 'active',
    });
  };

  const handleSetPrimary = async (botId: string) => {
    // First, unset all primary flags
    if (bots) {
      for (const bot of bots) {
        if (bot.is_primary) {
          await updateBot.mutateAsync({ id: bot.id, is_primary: false });
        }
      }
    }
    // Set the new primary
    await updateBot.mutateAsync({ id: botId, is_primary: true });
    toast.success('Бот назначен основным для привязки в ЛК');
  };

  const handleDelete = async (botId: string) => {
    if (confirm('Удалить бота? Это также удалит все связанные клубы.')) {
      await deleteBot.mutateAsync(botId);
    }
  };

  const maskToken = (token: string) => {
    if (token.length <= 10) return '••••••••••';
    return token.slice(0, 5) + '•••••' + token.slice(-5);
  };

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
            <CardTitle>Telegram боты</CardTitle>
            <CardDescription>
              Управление ботами для автоматической выдачи доступа в чаты и каналы. 
              Создайте бота через @BotFather, добавьте токен и установите Webhook.
            </CardDescription>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Добавить бота
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Добавить бота</DialogTitle>
                <DialogDescription>
                  Введите данные Telegram бота. Токен можно получить у @BotFather.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="bot_name">Название</Label>
                  <Input
                    id="bot_name"
                    placeholder="FSBY Bot"
                    value={newBot.bot_name}
                    onChange={(e) => setNewBot({ ...newBot, bot_name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="bot_username">Username бота</Label>
                  <Input
                    id="bot_username"
                    placeholder="@fsby_bot"
                    value={newBot.bot_username}
                    onChange={(e) => setNewBot({ ...newBot, bot_username: e.target.value.replace('@', '') })}
                  />
                </div>
                <div>
                  <HelpLabel helpKey="telegram.bot_token" htmlFor="bot_token">
                    Токен бота
                  </HelpLabel>
                  <Input
                    id="telegram_bot_token"
                    name="telegram_bot_token"
                    type="text"
                    placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
                    value={newBot.bot_token_encrypted}
                    onChange={(e) => setNewBot({ ...newBot, bot_token_encrypted: e.target.value })}
                    className="[&:not(:placeholder-shown)]:[-webkit-text-security:disc]"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Отмена
                </Button>
                <Button 
                  onClick={handleAddBot}
                  disabled={createBot.isPending || checkingBot === 'new'}
                >
                  {checkingBot === 'new' ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Проверка...
                    </>
                  ) : (
                    'Добавить'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {bots && bots.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Бот</TableHead>
                <TableHead>Токен</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Для ЛК</TableHead>
                <TableHead>Проверка</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bots.map((bot) => (
                <TableRow key={bot.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{bot.bot_name}</div>
                      <div className="text-sm text-muted-foreground">@{bot.bot_username}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {showTokenFor === bot.id ? bot.bot_token_encrypted : maskToken(bot.bot_token_encrypted)}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowTokenFor(showTokenFor === bot.id ? null : bot.id)}
                      >
                        {showTokenFor === bot.id ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={bot.status === 'active' ? 'default' : 'secondary'}>
                      {bot.status === 'active' ? 'Активен' : 'Неактивен'}
                    </Badge>
                    {bot.error_message && (
                      <div className="text-xs text-destructive mt-1">{bot.error_message}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {bot.is_primary ? (
                      <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10">
                        <Star className="h-3 w-3 mr-1 fill-current" />
                        Основной
                      </Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetPrimary(bot.id)}
                        disabled={bot.status !== 'active'}
                        className="text-muted-foreground hover:text-amber-500"
                        title="Назначить основным для привязки в ЛК"
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    {bot.last_check_at ? (
                      <div className="flex items-center gap-1 text-sm">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        {format(new Date(bot.last_check_at), 'dd.MM HH:mm', { locale: ru })}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Не проверялся</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCheckConnection(bot.id)}
                        disabled={checkingBot === bot.id}
                      >
                        {checkingBot === bot.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetupWebhook(bot.id)}
                        title="Установить webhook"
                      >
                        <Webhook className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleStatus(bot)}
                      >
                        {bot.status === 'active' ? (
                          <XCircle className="h-4 w-4" />
                        ) : (
                          <CheckCircle className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(bot.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Боты не добавлены. Нажмите "Добавить бота" для начала работы.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
