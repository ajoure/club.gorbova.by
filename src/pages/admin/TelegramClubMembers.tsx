import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { 
  ArrowLeft, 
  RefreshCw, 
  Trash2, 
  Search, 
  Download, 
  Users,
  MessageSquare,
  Megaphone,
  AlertTriangle,
  CheckCircle,
  XCircle,
  HelpCircle,
  Eye,
  Loader2,
  UserCheck,
  UserX,
  Link2,
} from 'lucide-react';
import { 
  useTelegramClubs, 
  useClubMembers, 
  useSyncClubMembers,
  useKickViolators,
  TelegramClubMember,
} from '@/hooks/useTelegramIntegration';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { MemberDetailsDrawer } from '@/components/telegram/MemberDetailsDrawer';

type FilterTab = 'all' | 'clients' | 'with_access' | 'no_access' | 'violators';

export default function TelegramClubMembers() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  
  const { data: clubs } = useTelegramClubs();
  const club = clubs?.find(c => c.id === clubId);
  
  const { data: members, isLoading, refetch } = useClubMembers(clubId || null);
  const syncMembers = useSyncClubMembers();
  const kickViolators = useKickViolators();

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [showKickDialog, setShowKickDialog] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TelegramClubMember | null>(null);
  const [lastSyncInfo, setLastSyncInfo] = useState<{ chat_total_count?: number; channel_total_count?: number; chat_warning?: string; channel_warning?: string; members_count?: number } | null>(null);

  // Calculate counts for tabs
  const counts = useMemo(() => {
    if (!members) return { all: 0, clients: 0, with_access: 0, no_access: 0, violators: 0 };
    
    return {
      all: members.length,
      clients: members.filter(m => m.link_status === 'linked').length,
      with_access: members.filter(m => m.access_status === 'ok').length,
      // "Без доступа" = linked users with expired OR no_access status
      no_access: members.filter(m => 
        m.link_status === 'linked' && 
        (m.access_status === 'no_access' || m.access_status === 'expired')
      ).length,
      // "Нарушители" = users in chat/channel but without access (regardless of link status)
      violators: members.filter(m => 
        m.access_status === 'no_access' && 
        (m.in_chat || m.in_channel)
      ).length,
    };
  }, [members]);

  // Filter and search members
  const filteredMembers = useMemo(() => {
    if (!members) return [];
    
    return members.filter(member => {
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch = 
          member.telegram_username?.toLowerCase().includes(searchLower) ||
          member.telegram_first_name?.toLowerCase().includes(searchLower) ||
          member.telegram_last_name?.toLowerCase().includes(searchLower) ||
          member.telegram_user_id.toString().includes(searchLower) ||
          member.profiles?.email?.toLowerCase().includes(searchLower) ||
          member.profiles?.phone?.includes(search) ||
          member.profiles?.full_name?.toLowerCase().includes(searchLower);
        
        if (!matchesSearch) return false;
      }

      // Tab filter
      switch (activeTab) {
        case 'clients':
          return member.link_status === 'linked';
        case 'with_access':
          return member.access_status === 'ok';
        case 'no_access':
          // "Без доступа" = linked users with expired OR no_access status  
          return member.link_status === 'linked' && 
            (member.access_status === 'no_access' || member.access_status === 'expired');
        case 'violators':
          // "Нарушители" = users in chat/channel but without access
          return member.access_status === 'no_access' && (member.in_chat || member.in_channel);
        default:
          return true;
      }
    });
  }, [members, search, activeTab]);

  const handleExportCSV = () => {
    if (!filteredMembers.length) return;

    const headers = ['Telegram ID', 'Username', 'Имя', 'Статус связки', 'Статус доступа', 'Чат', 'Канал', 'Email', 'Телефон'];
    const rows = filteredMembers.map(m => [
      m.telegram_user_id,
      m.telegram_username || '',
      `${m.telegram_first_name || ''} ${m.telegram_last_name || ''}`.trim(),
      m.link_status === 'linked' ? 'Связан' : 'Не связан',
      m.access_status === 'ok' ? 'OK' : m.access_status === 'no_access' ? 'Нет доступа' : m.access_status,
      m.in_chat ? 'Да' : 'Нет',
      m.in_channel ? 'Да' : 'Нет',
      m.profiles?.email || '',
      m.profiles?.phone || '',
    ]);

    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `club_members_${club?.club_name}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleKickAll = () => {
    if (!clubId) return;
    kickViolators.mutate({ clubId });
    setShowKickDialog(false);
  };

  const getAccessStatusBadge = (status: string, linkStatus?: string) => {
    switch (status) {
      case 'ok':
        return (
          <Badge variant="outline" className="bg-green-500/10 text-green-600 gap-1">
            <CheckCircle className="h-3 w-3" />
            С доступом
          </Badge>
        );
      case 'no_access':
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Без доступа
          </Badge>
        );
      case 'expired':
        return (
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 gap-1">
            <AlertTriangle className="h-3 w-3" />
            Истёк
          </Badge>
        );
      case 'removed':
        return (
          <Badge variant="secondary" className="gap-1">
            <Trash2 className="h-3 w-3" />
            Удалён
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="gap-1">
            <HelpCircle className="h-3 w-3" />
            {status}
          </Badge>
        );
    }
  };

  if (!club) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Клуб не найден</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin/integrations/telegram')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Участники: {club.club_name}</h1>
            <p className="text-muted-foreground">
              Управление участниками чата и канала
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Чат
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{club.members_count_chat || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Megaphone className="h-4 w-4" />
                Канал
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{club.members_count_channel || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Нарушители
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{counts.violators}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Последняя синхронизация</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm">
                {club.last_members_sync_at 
                  ? format(new Date(club.last_members_sync_at), 'dd.MM.yyyy HH:mm', { locale: ru })
                  : 'Никогда'
                }
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tab Filters */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FilterTab)} className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="all" className="gap-1.5">
              <Users className="h-4 w-4" />
              Все
              <Badge variant="secondary" className="ml-1 h-5 px-1.5">{counts.all}</Badge>
            </TabsTrigger>
            <TabsTrigger value="clients" className="gap-1.5">
              <Link2 className="h-4 w-4" />
              Клиенты
              <Badge variant="secondary" className="ml-1 h-5 px-1.5">{counts.clients}</Badge>
            </TabsTrigger>
            <TabsTrigger value="with_access" className="gap-1.5">
              <UserCheck className="h-4 w-4" />
              С доступом
              <Badge variant="secondary" className="ml-1 h-5 px-1.5">{counts.with_access}</Badge>
            </TabsTrigger>
            <TabsTrigger value="no_access" className="gap-1.5">
              <UserX className="h-4 w-4" />
              Без доступа
              <Badge variant="secondary" className="ml-1 h-5 px-1.5">{counts.no_access}</Badge>
            </TabsTrigger>
            <TabsTrigger value="violators" className="gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              Нарушители
              <Badge variant="destructive" className="ml-1 h-5 px-1.5">{counts.violators}</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Actions */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
              <div className="relative flex-1 sm:w-80">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Поиск по имени, email, телефону..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    clubId &&
                    syncMembers.mutate(clubId, {
                      onSuccess: (data: any) => setLastSyncInfo(data),
                    })
                  }
                  disabled={syncMembers.isPending}
                >
                  {syncMembers.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Обновить
                </Button>
                <Button
                  variant="outline"
                  onClick={handleExportCSV}
                  disabled={!filteredMembers.length}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Экспорт
                </Button>
                {counts.violators > 0 && (
                  <Button
                    variant="destructive"
                    onClick={() => setShowKickDialog(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Удалить нарушителей ({counts.violators})
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {(lastSyncInfo?.chat_warning || lastSyncInfo?.channel_warning) && (
              <Alert className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Ограничение Telegram Bot API</AlertTitle>
                <AlertDescription>
                  Telegram Bot API не позволяет получить полный список участников чата/канала.
                  Поэтому список «Участники» формируется по привязкам Telegram в системе.
                  <div className="mt-2 text-sm text-muted-foreground">
                    Привязано в системе: {counts.all} пользователей. 
                    Telegram показывает: чат ~{club.members_count_chat || 0}, канал ~{club.members_count_channel || 0}.
                    <br />
                    Поля «В чате/В канале» могут иметь состояние "unknown", если мы не можем проверить факт присутствия.
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : filteredMembers.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Telegram</TableHead>
                    <TableHead>Связь</TableHead>
                    <TableHead>Должен иметь доступ</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Чат</TableHead>
                    <TableHead>Канал</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map((member) => (
                    <TableRow 
                      key={member.id}
                      className={member.access_status === 'no_access' ? 'bg-destructive/5' : ''}
                    >
                      <TableCell>
                        <div>
                          <div className="font-medium">
                            {member.telegram_first_name} {member.telegram_last_name}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {member.telegram_username ? `@${member.telegram_username}` : `ID: ${member.telegram_user_id}`}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {member.link_status === 'linked' ? (
                          <div>
                            <div className="text-sm font-medium">{member.profiles?.full_name || 'Без имени'}</div>
                            <div className="text-xs text-muted-foreground">{member.profiles?.email}</div>
                          </div>
                        ) : (
                          <Badge variant="outline">Не связан</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {member.profiles && member.access_status === 'ok' ? (
                          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">Должен</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">Не должен</Badge>
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
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedMember(member)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {member.access_status === 'no_access' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => clubId && kickViolators.mutate({ clubId, memberIds: [member.id] })}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Участники не найдены</p>
                <p className="text-sm">Нажмите "Обновить" для синхронизации списка</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Kick confirmation dialog */}
        <AlertDialog open={showKickDialog} onOpenChange={setShowKickDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить нарушителей?</AlertDialogTitle>
              <AlertDialogDescription>
                Будет удалено {counts.violators} участников без права доступа из чата и канала.
                Это действие нельзя отменить.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleKickAll}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Member details drawer */}
        <MemberDetailsDrawer 
          member={selectedMember}
          clubId={clubId || null}
          onClose={() => setSelectedMember(null)}
          onRefresh={() => refetch()}
        />
      </div>
    </AdminLayout>
  );
}
