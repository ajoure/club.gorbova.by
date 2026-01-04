import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { ClubStatistics } from '@/components/telegram/ClubStatistics';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  MoreHorizontal,
  Plus,
  Clock,
  Ban,
  MinusCircle,
  Calendar,
  BarChart3,
  ChevronDown,
} from 'lucide-react';
import { 
  useTelegramClubs, 
  useClubMembers, 
  useSyncClubMembers,
  useKickViolators,
  useGrantTelegramAccess,
  useRevokeTelegramAccess,
  TelegramClubMember,
} from '@/hooks/useTelegramIntegration';
import { format, addDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { MemberDetailsDrawer } from '@/components/telegram/MemberDetailsDrawer';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type FilterTab = 'all' | 'clients' | 'with_access' | 'violators' | 'removed';

export default function TelegramClubMembers() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  
  const { data: clubs } = useTelegramClubs();
  const club = clubs?.find(c => c.id === clubId);
  
  const { data: members, isLoading, refetch } = useClubMembers(clubId || null);
  const syncMembers = useSyncClubMembers();
  const kickViolators = useKickViolators();
  const grantAccess = useGrantTelegramAccess();
  const revokeAccess = useRevokeTelegramAccess();

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [showKickDialog, setShowKickDialog] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TelegramClubMember | null>(null);
  const [lastSyncInfo, setLastSyncInfo] = useState<{ chat_total_count?: number; channel_total_count?: number; chat_warning?: string; channel_warning?: string; members_count?: number } | null>(null);
  
  // Mass selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMassGrantDialog, setShowMassGrantDialog] = useState(false);
  const [showMassRevokeDialog, setShowMassRevokeDialog] = useState(false);
  const [massGrantDays, setMassGrantDays] = useState(30);
  const [massGrantComment, setMassGrantComment] = useState('');
  const [massRevokeReason, setMassRevokeReason] = useState('');
  const [massActionLoading, setMassActionLoading] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // Calculate counts for tabs
  const counts = useMemo(() => {
    if (!members) return { all: 0, clients: 0, with_access: 0, violators: 0, removed: 0 };
    
    return {
      all: members.length,
      clients: members.filter(m => m.link_status === 'linked').length,
      with_access: members.filter(m => m.access_status === 'ok').length,
      // "Нарушители" = users in chat/channel but without legal access
      violators: members.filter(m => 
        (m.access_status !== 'ok' && m.access_status !== 'removed') && 
        (m.in_chat || m.in_channel)
      ).length,
      // "Удалённые" = users who were removed
      removed: members.filter(m => m.access_status === 'removed').length,
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
        case 'violators':
          // "Нарушители" = users in chat/channel but without legal access (excluding already removed)
          return (member.access_status !== 'ok' && member.access_status !== 'removed') && (member.in_chat || member.in_channel);
        case 'removed':
          return member.access_status === 'removed';
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

  // Mass selection handlers
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredMembers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredMembers.map(m => m.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const selectedMembers = useMemo(() => {
    return filteredMembers.filter(m => selectedIds.has(m.id));
  }, [filteredMembers, selectedIds]);

  const selectedLinkedMembers = useMemo(() => {
    return selectedMembers.filter(m => m.link_status === 'linked' && m.profiles?.user_id);
  }, [selectedMembers]);

  // Mass grant access
  const handleMassGrant = async () => {
    if (!clubId || selectedLinkedMembers.length === 0) return;
    setMassActionLoading(true);
    
    const validUntil = addDays(new Date(), massGrantDays).toISOString();
    let successCount = 0;
    let errorCount = 0;

    for (const member of selectedLinkedMembers) {
      if (!member.profiles?.user_id) continue;
      try {
        await grantAccess.mutateAsync({
          userId: member.profiles.user_id,
          clubId,
          isManual: true,
          validUntil,
          comment: massGrantComment || 'Массовая выдача доступа',
        });
        
        // Log the action
        await supabase.from('telegram_logs').insert({
          user_id: member.profiles.user_id,
          club_id: clubId,
          action: 'MASS_GRANT',
          status: 'ok',
          target: member.telegram_username || String(member.telegram_user_id),
          meta: { 
            granted_by: currentUser?.id,
            days: massGrantDays, 
            comment: massGrantComment,
          },
        });
        successCount++;
      } catch (e) {
        errorCount++;
      }
    }

    setMassActionLoading(false);
    setShowMassGrantDialog(false);
    setSelectedIds(new Set());
    setMassGrantDays(30);
    setMassGrantComment('');
    refetch();
    
    if (successCount > 0) toast.success(`Доступ выдан ${successCount} пользователям`);
    if (errorCount > 0) toast.error(`Ошибки: ${errorCount}`);
  };

  // Mass revoke access - works with both linked users and violators
  const handleMassRevoke = async () => {
    if (!clubId || selectedIds.size === 0) return;
    setMassActionLoading(true);
    
    let successCount = 0;
    let errorCount = 0;

    // Get selected members (may or may not be linked)
    const selectedMembers = filteredMembers.filter(m => selectedIds.has(m.id));

    for (const member of selectedMembers) {
      try {
        await revokeAccess.mutateAsync({
          userId: member.profiles?.user_id,
          telegramUserId: member.telegram_user_id,
          clubId,
          reason: massRevokeReason || 'Массовый отзыв доступа',
          isManual: true,
        });
        successCount++;
      } catch (e) {
        console.error('Revoke error for', member.telegram_user_id, e);
        errorCount++;
      }
    }

    setMassActionLoading(false);
    setShowMassRevokeDialog(false);
    setSelectedIds(new Set());
    setMassRevokeReason('');
    refetch();
    
    if (successCount > 0) toast.success(`Доступ отозван у ${successCount} пользователей`);
    if (errorCount > 0) toast.error(`Ошибки: ${errorCount}`);
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

        {/* Statistics Toggle */}
        <Collapsible open={showStats} onOpenChange={setShowStats}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              <span className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Статистика клуба
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showStats ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <ClubStatistics clubId={clubId!} />
          </CollapsibleContent>
        </Collapsible>

        {/* Quick Stats */}
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
            <TabsTrigger value="violators" className="gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              Нарушители
              <Badge variant="destructive" className="ml-1 h-5 px-1.5">{counts.violators}</Badge>
            </TabsTrigger>
            <TabsTrigger value="removed" className="gap-1.5">
              <MinusCircle className="h-4 w-4" />
              Удалённые
              <Badge variant="outline" className="ml-1 h-5 px-1.5">{counts.removed}</Badge>
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
            
            {/* Mass selection toolbar */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg mt-4">
                <span className="text-sm font-medium">
                  Выбрано: {selectedIds.size} 
                  {selectedLinkedMembers.length < selectedIds.size && (
                    <span className="text-muted-foreground"> (с профилем: {selectedLinkedMembers.length})</span>
                  )}
                </span>
                <div className="flex-1" />
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Снять выбор
                </Button>
                {selectedLinkedMembers.length > 0 && (
                  <>
                    <Button 
                      size="sm" 
                      onClick={() => setShowMassGrantDialog(true)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Выдать доступ
                    </Button>
                    <Button 
                      size="sm" 
                      variant="destructive"
                      onClick={() => setShowMassRevokeDialog(true)}
                    >
                      <MinusCircle className="h-4 w-4 mr-1" />
                      Отозвать доступ
                    </Button>
                  </>
                )}
              </div>
            )}
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
                    <TableHead className="w-10">
                      <Checkbox 
                        checked={selectedIds.size > 0 && selectedIds.size === filteredMembers.length}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Telegram</TableHead>
                    <TableHead>Связь с ЛК</TableHead>
                    <TableHead>Статус доступа</TableHead>
                    <TableHead className="text-center">Чат</TableHead>
                    <TableHead className="text-center">Канал</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map((member) => (
                    <TableRow 
                      key={member.id}
                      className={`
                        ${selectedIds.has(member.id) ? 'bg-primary/5' : ''}
                        ${member.access_status === 'no_access' || member.access_status === 'removed' 
                          ? 'bg-destructive/5' 
                          : member.access_status === 'expired' 
                            ? 'bg-yellow-500/5' 
                            : ''
                        }
                      `}
                    >
                      <TableCell>
                        <Checkbox 
                          checked={selectedIds.has(member.id)}
                          onCheckedChange={() => toggleSelect(member.id)}
                        />
                      </TableCell>
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
                          <Badge variant="outline" className="text-muted-foreground">Не связан</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {getAccessStatusBadge(member.access_status, member.link_status)}
                      </TableCell>
                      <TableCell className="text-center">
                        {member.in_chat === true ? (
                          <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                        ) : member.in_chat === false ? (
                          <XCircle className="h-4 w-4 text-destructive mx-auto" />
                        ) : (
                          <HelpCircle className="h-4 w-4 text-muted-foreground mx-auto" />
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {member.in_channel === true ? (
                          <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                        ) : member.in_channel === false ? (
                          <XCircle className="h-4 w-4 text-destructive mx-auto" />
                        ) : (
                          <HelpCircle className="h-4 w-4 text-muted-foreground mx-auto" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Действия</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setSelectedMember(member)}>
                              <Eye className="h-4 w-4 mr-2" />
                              Подробнее
                            </DropdownMenuItem>
                            {member.profiles && member.access_status !== 'ok' && (
                              <DropdownMenuItem onClick={() => {
                                setSelectedMember(member);
                                // Will open grant dialog from drawer
                              }}>
                                <Plus className="h-4 w-4 mr-2" />
                                Выдать доступ
                              </DropdownMenuItem>
                            )}
                            {member.profiles && member.access_status === 'ok' && (
                              <>
                                <DropdownMenuItem onClick={() => setSelectedMember(member)}>
                                  <Clock className="h-4 w-4 mr-2" />
                                  Продлить доступ
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => setSelectedMember(member)}
                                  className="text-destructive"
                                >
                                  <MinusCircle className="h-4 w-4 mr-2" />
                                  Отозвать доступ
                                </DropdownMenuItem>
                              </>
                            )}
                            {(member.access_status === 'no_access' || member.access_status === 'removed') && 
                             (member.in_chat || member.in_channel) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  onClick={() => clubId && kickViolators.mutate({ clubId, memberIds: [member.id] })}
                                  className="text-destructive"
                                >
                                  <Ban className="h-4 w-4 mr-2" />
                                  Удалить из чата/канала
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
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

        {/* Mass Grant Dialog */}
        <Dialog open={showMassGrantDialog} onOpenChange={setShowMassGrantDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Массовая выдача доступа</DialogTitle>
              <DialogDescription>
                Выдать доступ {selectedLinkedMembers.length} пользователям
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="mass-days">Срок доступа (дней)</Label>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <Input
                    id="mass-days"
                    type="number"
                    min={1}
                    max={365}
                    value={massGrantDays}
                    onChange={(e) => setMassGrantDays(parseInt(e.target.value) || 30)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  До {format(addDays(new Date(), massGrantDays), 'dd.MM.yyyy', { locale: ru })}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mass-comment">Комментарий</Label>
                <Textarea
                  id="mass-comment"
                  placeholder="Причина массовой выдачи..."
                  value={massGrantComment}
                  onChange={(e) => setMassGrantComment(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowMassGrantDialog(false)}>
                Отмена
              </Button>
              <Button onClick={handleMassGrant} disabled={massActionLoading}>
                {massActionLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Выдать доступ ({selectedLinkedMembers.length})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Mass Revoke Dialog */}
        <Dialog open={showMassRevokeDialog} onOpenChange={setShowMassRevokeDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-destructive">Массовый отзыв доступа</DialogTitle>
              <DialogDescription>
                Отозвать доступ у {selectedLinkedMembers.length} пользователей
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="mass-reason">Причина отзыва *</Label>
                <Textarea
                  id="mass-reason"
                  placeholder="Укажите причину массового отзыва..."
                  value={massRevokeReason}
                  onChange={(e) => setMassRevokeReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowMassRevokeDialog(false)}>
                Отмена
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleMassRevoke} 
                disabled={massActionLoading || !massRevokeReason.trim()}
              >
                {massActionLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Отозвать доступ ({selectedLinkedMembers.length})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
