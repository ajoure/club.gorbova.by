import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { 
  Plus, 
  Copy, 
  Trash2, 
  Link2, 
  Calendar, 
  Users,
  ArrowLeft,
  RefreshCw,
  ExternalLink
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
import { useNavigate, useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/AdminLayout';

interface TelegramInvite {
  id: string;
  club_id: string;
  code: string;
  name: string;
  duration_days: number;
  max_uses: number | null;
  uses_count: number;
  is_active: boolean;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  telegram_clubs?: {
    club_name: string;
  };
}

interface TelegramClub {
  id: string;
  club_name: string;
  is_active: boolean;
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default function TelegramInvites() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedClubId, setSelectedClubId] = useState<string>('');
  const [newInvite, setNewInvite] = useState({
    name: '',
    code: generateInviteCode(),
    duration_days: 30,
    max_uses: '',
    expires_days: '',
  });

  // Fetch clubs
  const { data: clubs = [] } = useQuery({
    queryKey: ['telegram-clubs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_clubs')
        .select('id, club_name, is_active')
        .eq('is_active', true)
        .order('club_name');
      if (error) throw error;
      return data as TelegramClub[];
    },
  });

  // Fetch invites
  const { data: invites = [], isLoading } = useQuery({
    queryKey: ['telegram-invites', selectedClubId],
    queryFn: async () => {
      let query = supabase
        .from('telegram_invites')
        .select('*, telegram_clubs(club_name)')
        .order('created_at', { ascending: false });
      
      if (selectedClubId) {
        query = query.eq('club_id', selectedClubId);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as TelegramInvite[];
    },
  });

  // Create invite
  const createInvite = useMutation({
    mutationFn: async () => {
      if (!selectedClubId) throw new Error('Выберите клуб');
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Не авторизован');

      const expiresAt = newInvite.expires_days 
        ? new Date(Date.now() + parseInt(newInvite.expires_days) * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const { error } = await supabase
        .from('telegram_invites')
        .insert({
          club_id: selectedClubId,
          code: newInvite.code,
          name: newInvite.name || `Инвайт ${newInvite.code}`,
          duration_days: newInvite.duration_days,
          max_uses: newInvite.max_uses ? parseInt(newInvite.max_uses) : null,
          expires_at: expiresAt,
          created_by: user.id,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Инвайт создан');
      setIsCreateDialogOpen(false);
      setNewInvite({
        name: '',
        code: generateInviteCode(),
        duration_days: 30,
        max_uses: '',
        expires_days: '',
      });
      queryClient.invalidateQueries({ queryKey: ['telegram-invites'] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Toggle invite active
  const toggleInvite = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('telegram_invites')
        .update({ is_active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-invites'] });
    },
  });

  // Delete invite
  const deleteInvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('telegram_invites')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Инвайт удалён');
      queryClient.invalidateQueries({ queryKey: ['telegram-invites'] });
    },
  });

  const copyInviteLink = (code: string) => {
    const botUsername = 'fsby_bot'; // Can be made dynamic later
    const link = `https://t.me/${botUsername}?start=invite_${code}`;
    navigator.clipboard.writeText(link);
    toast.success('Ссылка скопирована');
  };

  const getInviteStatus = (invite: TelegramInvite) => {
    if (!invite.is_active) return { label: 'Неактивен', variant: 'secondary' as const };
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return { label: 'Истёк', variant: 'destructive' as const };
    }
    if (invite.max_uses && invite.uses_count >= invite.max_uses) {
      return { label: 'Исчерпан', variant: 'destructive' as const };
    }
    return { label: 'Активен', variant: 'default' as const };
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
              <h1 className="text-2xl font-bold">Приглашения в клуб</h1>
              <p className="text-muted-foreground">
                Создавайте инвайт-ссылки для привлечения участников
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div className="flex items-center gap-4">
              <Select value={selectedClubId || "all"} onValueChange={(v) => setSelectedClubId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[250px]">
                  <SelectValue placeholder="Все клубы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все клубы</SelectItem>
                  {clubs.map((club) => (
                    <SelectItem key={club.id} value={club.id}>
                      {club.club_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Создать инвайт
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Новый инвайт</DialogTitle>
                  <DialogDescription>
                    Создайте ссылку-приглашение в Telegram-клуб
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Клуб</Label>
                    <Select value={selectedClubId} onValueChange={setSelectedClubId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите клуб" />
                      </SelectTrigger>
                      <SelectContent>
                        {clubs.map((club) => (
                          <SelectItem key={club.id} value={club.id}>
                            {club.club_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Название</Label>
                    <Input
                      placeholder="Например: Акция июнь 2024"
                      value={newInvite.name}
                      onChange={(e) => setNewInvite({ ...newInvite, name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Код инвайта</Label>
                    <div className="flex gap-2">
                      <Input
                        value={newInvite.code}
                        onChange={(e) => setNewInvite({ ...newInvite, code: e.target.value.toUpperCase() })}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setNewInvite({ ...newInvite, code: generateInviteCode() })}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Доступ на (дней)</Label>
                      <Input
                        type="number"
                        min="1"
                        value={newInvite.duration_days === 0 ? "" : newInvite.duration_days}
                        onChange={(e) => setNewInvite({ ...newInvite, duration_days: e.target.value === "" ? 0 : parseInt(e.target.value) || 0 })}
                        onBlur={() => { if (newInvite.duration_days < 1) setNewInvite({ ...newInvite, duration_days: 1 }); }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Лимит использований</Label>
                      <Input
                        type="number"
                        min="1"
                        placeholder="Без лимита"
                        value={newInvite.max_uses}
                        onChange={(e) => setNewInvite({ ...newInvite, max_uses: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Действует (дней)</Label>
                    <Input
                      type="number"
                      min="1"
                      placeholder="Бессрочно"
                      value={newInvite.expires_days}
                      onChange={(e) => setNewInvite({ ...newInvite, expires_days: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      После этого срока инвайт перестанет работать
                    </p>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Отмена
                  </Button>
                  <Button 
                    onClick={() => createInvite.mutate()}
                    disabled={createInvite.isPending || !selectedClubId}
                  >
                    Создать
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
            ) : invites.length === 0 ? (
              <div className="text-center py-12">
                <Link2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium mb-1">Нет инвайтов</h3>
                <p className="text-muted-foreground mb-4">
                  Создайте первый инвайт для привлечения участников
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>Клуб</TableHead>
                    <TableHead>Код</TableHead>
                    <TableHead>Доступ</TableHead>
                    <TableHead>Использований</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Создан</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((invite) => {
                    const status = getInviteStatus(invite);
                    return (
                      <TableRow key={invite.id}>
                        <TableCell className="font-medium">{invite.name}</TableCell>
                        <TableCell>{invite.telegram_clubs?.club_name}</TableCell>
                        <TableCell>
                          <code className="bg-muted px-2 py-1 rounded text-sm">
                            {invite.code}
                          </code>
                        </TableCell>
                        <TableCell>{invite.duration_days} дн.</TableCell>
                        <TableCell>
                          {invite.uses_count}
                          {invite.max_uses && ` / ${invite.max_uses}`}
                        </TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {format(new Date(invite.created_at), 'd MMM yyyy', { locale: ru })}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copyInviteLink(invite.code)}
                              title="Копировать ссылку"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Switch
                              checked={invite.is_active}
                              onCheckedChange={(checked) => 
                                toggleInvite.mutate({ id: invite.id, is_active: checked })
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteInvite.mutate(invite.id)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Как это работает</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>1. Создайте инвайт с нужными параметрами (срок доступа, лимит использований)</p>
            <p>2. Скопируйте ссылку и отправьте её потенциальным участникам</p>
            <p>3. При переходе по ссылке пользователь попадает в бота и автоматически получает доступ</p>
            <p>4. Пользователь появится в списке участников клуба</p>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
