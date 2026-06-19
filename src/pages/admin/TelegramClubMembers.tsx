import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { ClubStatistics } from '@/components/telegram/ClubStatistics';
import { ClubQuickStats } from '@/components/telegram/ClubQuickStats';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
  Send,
  ShieldCheck,
  Bot,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { 
  useTelegramClubs, 
  useClubMembers, 
  useClubMemberSummary,
  useClubBusinessStats,
  useSyncClubMembers,
  useKickViolators,
  useGrantTelegramAccess,
  useRevokeTelegramAccess,
  EnrichedClubMember,
  ClubMemberScope,
  ClubMemberSummary,
} from '@/hooks/useTelegramIntegration';
import { useClubAdmins } from '@/hooks/useClubAdmins';
import { Switch } from '@/components/ui/switch';
import { format, addDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { MemberDetailsDrawer } from '@/components/telegram/MemberDetailsDrawer';
import { ContactDetailSheet } from '@/components/admin/ContactDetailSheet';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// Interface for contact to show in sheet
interface SheetContact {
  id: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  telegram_username: string | null;
  telegram_user_id: number | null;
  avatar_url: string | null;
  status: string;
  created_at: string;
  last_seen_at: string | null;
  duplicate_flag: string | null;
  deals_count: number;
  last_deal_at: string | null;
}

type FilterTab = 'in_club' | 'with_access' | 'bought_not_joined' | 'violators' | 'removed' | 'admins';

export default function TelegramClubMembers() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  
  const { data: clubs } = useTelegramClubs();
  const club = clubs?.find(c => c.id === clubId);
  const { data: adminsList = [] } = useClubAdmins(clubId || null);
  
  // Scope toggle: 'relevant' = only club-related, 'all' = all synced
  const [showAllScope, setShowAllScope] = useState(false);
  const scope: ClubMemberScope = showAllScope ? 'all' : 'relevant';
  
  // Search with debounce for server-side search
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  
  const { data: members, isLoading, isError: isMembersError, error: membersError, refetch: refetchMembers } = useClubMembers(clubId || null, { 
    scope, 
    search: debouncedSearch 
  });
  const { data: summary, isError: isStatsError, error: statsError, refetch: refetchStats } = useClubMemberSummary(clubId || null);
  const resourceMode = summary?.resource_mode ?? 'chat_and_channel';
  const hasChat = resourceMode !== 'channel_only';
  const hasChannel = resourceMode !== 'chat_only';
  const [businessStatsPeriod, setBusinessStatsPeriod] = useState(30);
  const { data: businessStats, isLoading: isBusinessStatsLoading } = useClubBusinessStats(clubId || null, businessStatsPeriod);
  
  // Alias for backward compat (refetch used in many places)
  const refetch = refetchMembers;
  const syncMembers = useSyncClubMembers();
  const kickViolators = useKickViolators();
  const grantAccess = useGrantTelegramAccess();
  const revokeAccess = useRevokeTelegramAccess();

  const [activeTab, setActiveTab] = useState<FilterTab>('in_club');

  // Sorting state for the members table
  type SortKey = 'telegram_name' | 'crm_name' | 'access_status' | 'chat_channel' | 'access_started_at' | 'access_ended_at';
  type SortDir = 'asc' | 'desc';
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Default sort per tab: removed → by access_ended_at DESC (newest kicks first)
  useEffect(() => {
    if (activeTab === 'removed') {
      setSortKey('access_ended_at');
      setSortDir('desc');
    } else {
      setSortKey(null);
    }
  }, [activeTab]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    return sortDir === 'asc'
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const [showKickDialog, setShowKickDialog] = useState(false);
  const [selectedMember, setSelectedMember] = useState<EnrichedClubMember | null>(null);
  
  // Mass selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMassGrantDialog, setShowMassGrantDialog] = useState(false);
  const [showMassRevokeDialog, setShowMassRevokeDialog] = useState(false);
  const [showMassMarkRemovedDialog, setShowMassMarkRemovedDialog] = useState(false);
  const [showMassKickPresentDialog, setShowMassKickPresentDialog] = useState(false);
  const [kickPresentDryRunResult, setKickPresentDryRunResult] = useState<{ candidates_count: number; skipped_has_access_count: number } | null>(null);
  const [kickPresentDryRunLoading, setKickPresentDryRunLoading] = useState(false);
  const [massGrantDays, setMassGrantDays] = useState(30);
  const [massGrantComment, setMassGrantComment] = useState('');
  const [massRevokeReason, setMassRevokeReason] = useState('');
  const [massActionLoading, setMassActionLoading] = useState(false);
  const [showStats, setShowStats] = useState(false);
  
  // Reinvite ghosts state
  const [showReinviteDialog, setShowReinviteDialog] = useState(false);
  const [reinviteDryRunResult, setReinviteDryRunResult] = useState<any>(null);
  const [reinviteLoading, setReinviteLoading] = useState(false);
  
  // Status check state
  const [checkingStatuses, setCheckingStatuses] = useState(false);
  const [checkProgress, setCheckProgress] = useState({ current: 0, total: 0 });
  
  // Send message state
  const [showSendMessageDialog, setShowSendMessageDialog] = useState(false);
  const [messageTarget, setMessageTarget] = useState<EnrichedClubMember | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  
  // Contact detail sheet state
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<SheetContact | null>(null);

  // Open contact detail sheet
  const openContactSheet = async (profileId: string) => {
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, user_id, email, full_name, first_name, last_name, phone, telegram_username, telegram_user_id, avatar_url, status, created_at, last_seen_at, duplicate_flag")
        .eq("id", profileId)
        .single();
      
      if (error) throw error;
      if (profile) {
        // Calculate deals count
        const { count } = await supabase
          .from("orders_v2")
          .select("*", { count: "exact", head: true })
          .eq("profile_id", profileId);
        
        setSelectedContact({
          ...profile,
          deals_count: count || 0,
          last_deal_at: null,
        });
        setContactSheetOpen(true);
      }
    } catch (error) {
      console.error("Failed to fetch contact:", error);
      toast.error("Не удалось загрузить контакт");
    }
  };
  // Calculate counts for tabs - using computed flags from RPC (A-G definitions)
  // Set of admin telegram_user_ids for filtering
  const adminTelegramIds = useMemo(() => new Set(adminsList.map(a => a.telegram_user_id)), [adminsList]);

  // All admins (human + bot) from useClubAdmins that are NOT in members list
  // This is the unified SoT for the admin tab "extra rows" section
  const adminsNotInMembers = useMemo(() => {
    if (!members) return adminsList;
    const memberTgIds = new Set(members.map(m => m.telegram_user_id));
    return adminsList.filter(a => !memberTgIds.has(a.telegram_user_id));
  }, [adminsList, members]);

  // Backward-compat alias for bot-only rows (used in admin tab rendering)
  const botAdminsNotInMembers = useMemo(
    () => adminsNotInMembers.filter(a => a.is_bot),
    [adminsNotInMembers]
  );

  // Phase 8: Use backend summary counts; admin badge = adminsList.length (single SoT)
  // adminsList comes from useClubAdmins which is the same source as adminTelegramIds and admin tab rendering
  const counts = useMemo(() => {
    if (!summary) return { in_club: 0, in_club_regular: 0, in_club_admins: 0, with_access: 0, bought_not_joined: 0, violators: 0, removed: 0, admins: adminsList.length };
    
    return {
      in_club: summary.in_club_total,
      in_club_regular: summary.in_club_regular,
      in_club_admins: summary.in_club_admins,
      with_access: summary.with_access_total,
      bought_not_joined: summary.bought_not_joined_count,
      violators: summary.violators_count,
      removed: summary.removed_count,
      // PATCH-STAT-6: Badge Админы = adminsList.length (single SoT with admin tab rendering)
      // adminsList = human admins from telegram_club_members + bot admin from telegram_clubs
      admins: adminsList.length,
    };
  }, [summary, adminsList.length]);

  // Filter members by active tab
  const filteredMembers = useMemo(() => {
    if (!members) return [];

    const filtered = members.filter(member => {
      // Anti-contradiction guard: admin is never violator or removed
      const isAdmin = adminTelegramIds.has(member.telegram_user_id);

      switch (activeTab) {
        case 'in_club':
          return member.in_any;
        case 'with_access':
          // PATCH-B: exclude removed users from "with access" tab — they appear in "removed" tab instead
          return member.has_active_access && member.access_status !== 'removed';
        case 'bought_not_joined':
          return member.is_bought_not_joined;
        case 'violators':
          // PATCH: exclude admins, anti-contradiction: violator can't have valid access
          return member.is_violator && !isAdmin;
        case 'removed':
          // PATCH: exclude admins from removed
          return member.access_status === 'removed' && !member.in_any && !isAdmin;
        case 'admins':
          return isAdmin;
        default:
          return true;
      }
    });

    if (!sortKey) return filtered;

    const dirMul = sortDir === 'asc' ? 1 : -1;
    const cmpStr = (a: string | null | undefined, b: string | null | undefined) => {
      const av = (a ?? '').toString().toLowerCase();
      const bv = (b ?? '').toString().toLowerCase();
      if (!av && !bv) return 0;
      if (!av) return 1;   // empty values always last
      if (!bv) return -1;
      return av.localeCompare(bv, 'ru');
    };
    const cmpDate = (a: string | null | undefined, b: string | null | undefined) => {
      const at = a ? new Date(a).getTime() : null;
      const bt = b ? new Date(b).getTime() : null;
      if (at === null && bt === null) return 0;
      if (at === null) return 1;   // empty always last
      if (bt === null) return -1;
      return at - bt;
    };

    const sorted = [...filtered].sort((a, b) => {
      let r = 0;
      switch (sortKey) {
        case 'telegram_name':
          r = cmpStr(
            `${a.telegram_first_name || ''} ${a.telegram_last_name || ''} ${a.telegram_username || ''}`,
            `${b.telegram_first_name || ''} ${b.telegram_last_name || ''} ${b.telegram_username || ''}`,
          );
          break;
        case 'crm_name':
          r = cmpStr(a.profiles?.full_name || a.profiles?.email, b.profiles?.full_name || b.profiles?.email);
          break;
        case 'access_status':
          r = cmpStr(a.access_status, b.access_status);
          break;
        case 'chat_channel':
          r = (Number(!!b.in_chat) + Number(!!b.in_channel)) - (Number(!!a.in_chat) + Number(!!a.in_channel));
          // already desc-like; flip when asc
          if (sortDir === 'asc') r = -r;
          return r;
        case 'access_started_at':
          r = cmpDate(a.access_started_at, b.access_started_at);
          break;
        case 'access_ended_at':
          r = cmpDate(a.access_ended_at, b.access_ended_at);
          break;
      }
      return r * dirMul;
    });
    return sorted;
  }, [members, activeTab, adminTelegramIds, sortKey, sortDir]);



  const handleExportCSV = () => {
    if (!filteredMembers.length) return;

    const baseHeaders = ['Telegram ID', 'Username', 'Имя', 'Статус связки', 'Статус доступа'];
    if (hasChat) baseHeaders.push('Чат');
    if (hasChannel) baseHeaders.push('Канал');
    baseHeaders.push('Email', 'Телефон');
    const headers = baseHeaders;
    const rows = filteredMembers.map(m => {
      const row: (string | number | boolean | null)[] = [
        m.telegram_user_id,
        m.telegram_username || '',
        `${m.telegram_first_name || ''} ${m.telegram_last_name || ''}`.trim(),
        m.link_status === 'linked' ? 'Связан' : 'Не связан',
        m.access_status === 'ok' ? 'OK' : m.access_status === 'no_access' ? 'Нет доступа' : m.access_status,
      ];
      if (hasChat) row.push(m.in_chat ? 'Да' : 'Нет');
      if (hasChannel) row.push(m.in_channel ? 'Да' : 'Нет');
      row.push(m.profiles?.email || '', m.profiles?.phone || '');
      return row;
    });

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

  // Sync and then check statuses via getChatMember
  const handleSync = async () => {
    if (!clubId) return;
    
    try {
      // Step 1: Sync data from database
      await syncMembers.mutateAsync(clubId);
      
      // Step 2: Check statuses via Telegram API for all members
      setCheckingStatuses(true);
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: {
          action: 'check_status',
          club_id: clubId,
          member_ids: [], // Empty = all members (up to 50)
        },
      });
      setCheckingStatuses(false);
      
      if (error) {
        console.error('Check status error:', error);
        toast.error('Синхронизировано, но ошибка проверки статусов');
      } else {
        toast.success(`Обновлено. Проверено статусов: ${data.checked_count}`);
      }
      
      refetch();
    } catch (e) {
      setCheckingStatuses(false);
      console.error('Sync error:', e);
      toast.error('Ошибка синхронизации');
    }
  };

  // Check statuses via getChatMember for selected members
  const handleCheckStatuses = async () => {
    if (!clubId || selectedIds.size === 0) return;
    setCheckingStatuses(true);
    setCheckProgress({ current: 0, total: selectedIds.size });
    
    try {
      const memberIds = Array.from(selectedIds);
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: {
          action: 'check_status',
          club_id: clubId,
          member_ids: memberIds,
        },
      });

      if (error) throw error;
      toast.success(`Проверено: ${data.checked_count} пользователей`);
      refetch();
    } catch (e) {
      console.error('Check status error:', e);
      toast.error('Ошибка проверки статусов');
    }
    
    setCheckingStatuses(false);
    setCheckProgress({ current: 0, total: 0 });
  };

  // Send message to member
  const handleSendMessage = async () => {
    if (!clubId || !messageTarget || !messageText.trim()) return;
    setSendingMessage(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: {
          action: 'send_message',
          club_id: clubId,
          telegram_user_id: messageTarget.telegram_user_id,
          message: messageText,
        },
      });

      if (error) throw error;
      
      if (data.success) {
        toast.success('Сообщение отправлено');
      } else {
        toast.error(data.error || 'Не удалось отправить');
      }
    } catch (e) {
      console.error('Send message error:', e);
      toast.error('Ошибка отправки сообщения');
    }
    
    setSendingMessage(false);
    setShowSendMessageDialog(false);
    setMessageText('');
    setMessageTarget(null);
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

  // Mass revoke access - works with any selected members (even with unknown status)
  const handleMassRevoke = async () => {
    if (!clubId || selectedIds.size === 0) return;
    setMassActionLoading(true);
    
    let successCount = 0;
    let errorCount = 0;

    const selectedMembersList = filteredMembers.filter(m => selectedIds.has(m.id));

    for (const member of selectedMembersList) {
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

  // Mass mark as removed
  const handleMassMarkRemoved = async () => {
    if (!clubId || selectedIds.size === 0) return;
    setMassActionLoading(true);
    
    try {
      const memberIds = Array.from(selectedIds);
      const { error } = await supabase.functions.invoke('telegram-club-members', {
        body: {
          action: 'mark_removed',
          club_id: clubId,
          member_ids: memberIds,
        },
      });

      if (error) throw error;
      toast.success(`${memberIds.length} пользователей помечены как удалённые`);
    } catch (e) {
      console.error('Mark removed error:', e);
      toast.error('Ошибка при пометке удаления');
    }

    setMassActionLoading(false);
    setShowMassMarkRemovedDialog(false);
    setSelectedIds(new Set());
    refetch();
  };

  // Dry-run preview before mass kick_present
  const handleMassKickPresentPreview = async () => {
    if (!clubId || selectedIds.size === 0) return;
    setKickPresentDryRunLoading(true);
    try {
      const memberIds = Array.from(selectedIds);
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: { action: 'kick_present', club_id: clubId, member_ids: memberIds, dry_run: true },
      });
      if (error) throw error;
      setKickPresentDryRunResult({
        candidates_count: data.candidates_count ?? 0,
        skipped_has_access_count: data.skipped_has_access_count ?? 0,
      });
    } catch (e) {
      console.error('Dry run error:', e);
      setKickPresentDryRunResult(null);
    }
    setKickPresentDryRunLoading(false);
    setShowMassKickPresentDialog(true);
  };

  // Mass kick only members actually present
  const handleMassKickPresent = async () => {
    if (!clubId || selectedIds.size === 0) return;
    setMassActionLoading(true);
    
    try {
      const memberIds = Array.from(selectedIds);
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: {
          action: 'kick_present',
          club_id: clubId,
          member_ids: memberIds,
        },
      });

      if (error) throw error;
      const skipped = data.skipped_has_access_count ?? 0;
      toast.success(`Удалено: ${data.kicked_count}${skipped > 0 ? `, пропущено (есть доступ): ${skipped}` : ''}`);
    } catch (e) {
      console.error('Kick present error:', e);
      toast.error('Ошибка при удалении из чата/канала');
    }

    setMassActionLoading(false);
    setShowMassKickPresentDialog(false);
    setKickPresentDryRunResult(null);
    setSelectedIds(new Set());
    refetch();
  };

  // Single member kick from Telegram (for violators)
  const handleKickSingleMember = async (member: EnrichedClubMember) => {
    if (!clubId) return;
    
    try {
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: {
          action: 'kick_present',
          club_id: clubId,
          member_ids: [member.id],
        },
      });

      if (error) throw error;
      toast.success(data.kicked_count > 0 ? 'Пользователь удалён из Telegram' : 'Пользователь не найден в чате/канале');
      refetch();
    } catch (e) {
      console.error('Kick single member error:', e);
      toast.error('Ошибка при удалении из Telegram');
    }
  };

  // Single member mark as removed
  const handleMarkSingleRemoved = async (member: EnrichedClubMember) => {
    if (!clubId) return;
    
    try {
      const { error } = await supabase.functions.invoke('telegram-club-members', {
        body: {
          action: 'mark_removed',
          club_id: clubId,
          member_ids: [member.id],
        },
      });

      if (error) throw error;
      toast.success('Пользователь помечен как удалённый');
      refetch();
    } catch (e) {
      console.error('Mark removed error:', e);
      toast.error('Ошибка при пометке удаления');
    }
  };

  // Reinvite ghosts handlers
  const handleReinviteDryRun = async () => {
    if (!clubId) return;
    setReinviteLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: { action: 'reinvite_ghosts', club_id: clubId, scope: 'bought_not_joined', dry_run: true },
      });
      if (error) throw error;
      setReinviteDryRunResult(data);
      setShowReinviteDialog(true);
    } catch (e) {
      console.error('Reinvite dry run error:', e);
      toast.error('Ошибка при проверке кандидатов');
    }
    setReinviteLoading(false);
  };

  const handleReinviteExecute = async () => {
    if (!clubId) return;
    setReinviteLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: { action: 'reinvite_ghosts', club_id: clubId, scope: 'bought_not_joined', dry_run: false },
      });
      if (error) throw error;
      toast.success(`В очередь добавлено: ${data.queued_count}. Пропущено: ${data.skipped_count}`);
      setShowReinviteDialog(false);
      setReinviteDryRunResult(null);
      refetch();
    } catch (e) {
      console.error('Reinvite execute error:', e);
      toast.error('Ошибка при переотправке');
    }
    setReinviteLoading(false);
  };

  // Single member reinvite
  const handleReinviteSingle = async (member: EnrichedClubMember) => {
    if (!clubId) return;
    try {
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: { action: 'reinvite_ghosts', club_id: clubId, scope: 'selected_ids', member_ids: [member.id], dry_run: false },
      });
      if (error) throw error;
      toast.success(data.queued_count > 0 ? 'Переотправка ссылки поставлена в очередь' : `Пропущено: ${data.skipped?.[0]?.reason || 'лимит'}`);
      refetch();
    } catch (e) {
      toast.error('Ошибка переотправки');
    }
  };

  // Calculate selected members present in chat/channel (resource-mode aware)
  const selectedPresentMembers = useMemo(() => {
    return selectedMembers.filter(m => m.in_any);
  }, [selectedMembers]);

   // PATCH TG-REVOKE-FALSE-REGRANT: Backend truth wins for access badges
  // PATCH-ZOMBIE-GUARD: если access_ended_at в прошлом — никогда не показываем «Доступ активен»,
  // даже если has_active_access=true (зомби past_due без entitlement у Инны Грудецкой и т.п.).
  const getAccessStatusBadge = (
    status: string,
    linkStatus?: string,
    hasActiveAccess?: boolean,
    accessEndedAt?: string | null,
  ) => {
    const endedInPast = !!accessEndedAt && new Date(accessEndedAt).getTime() < Date.now();
    const effectiveHasAccess = hasActiveAccess === true && !endedInPast;

    // Если человек помечен removed — показываем только «Удалён», никакого «Доступ активен».
    if (status === 'removed') {
      return (
        <Badge variant="secondary" className="gap-1">
          <Trash2 className="h-3 w-3" />
          Удалён
        </Badge>
      );
    }

    if (effectiveHasAccess) {
      return (
        <Badge variant="outline" className="bg-green-500/10 text-green-600 gap-1">
          <CheckCircle className="h-3 w-3" />
          С доступом
        </Badge>
      );
    }

    // Нет валидного доступа — никогда не зелёный
    if (status === 'expired' || endedInPast) {
      return (
        <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 gap-1">
          <AlertTriangle className="h-3 w-3" />
          Истёк
        </Badge>
      );
    }

    if (status === 'no_access' || hasActiveAccess === false) {
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Без доступа
        </Badge>
      );
    }

    // Fallback for undefined cases
    if (status === 'ok') {
      return (
        <Badge variant="outline" className="bg-green-500/10 text-green-600 gap-1">
          <CheckCircle className="h-3 w-3" />
          С доступом
        </Badge>
      );
    }

    return (
      <Badge variant="secondary" className="gap-1">
        <HelpCircle className="h-3 w-3" />
        {status}
      </Badge>
    );
  };


  // Telegram status display — resource-mode aware
  const getTelegramStatus = (member: EnrichedClubMember) => {
    const inChat = member.in_chat;
    const inChannel = member.in_channel;
    const hasTelegramId = !!member.telegram_user_id;
    const lastCheck = member.last_telegram_check_at || member.last_synced_at;
    
    const getChatIcon = () => {
      if (inChat === true) return <CheckCircle className="h-4 w-4 text-green-600" />;
      if (inChat === false) return <XCircle className="h-4 w-4 text-destructive" />;
      if (!hasTelegramId) return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
      return <HelpCircle className="h-4 w-4 text-yellow-500" />;
    };
    
    const getChannelIcon = () => {
      if (!hasTelegramId) return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
      if (inChannel === true) return <CheckCircle className="h-4 w-4 text-green-600" />;
      if (inChannel === false) return <XCircle className="h-4 w-4 text-destructive" />;
      return <HelpCircle className="h-4 w-4 text-yellow-500" />;
    };

    const getChatTooltip = () => {
      if (!hasTelegramId) return 'Telegram не привязан';
      if (inChat === true) return 'В чате';
      if (inChat === false) return 'Не в чате';
      return 'Статус неизвестен - проверьте';
    };
    
    const getChannelTooltip = () => {
      if (!hasTelegramId) return 'Telegram не привязан';
      if (inChannel === true) return 'В канале';
      if (inChannel === false) return 'Не в канале';
      return 'Статус неизвестен - проверьте';
    };

    const lastCheckInfo = lastCheck ? 
      `Проверено: ${format(new Date(lastCheck), 'dd.MM.yy HH:mm', { locale: ru })}` : 
      'Не проверялось';

    // Resource-mode aware: only show relevant icons
    if (!hasChannel) {
      // Chat-only mode
      return (
        <div className="flex items-center justify-center">
          <Tooltip>
            <TooltipTrigger>{getChatIcon()}</TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">Чат</p>
              <p>{getChatTooltip()}</p>
              <p className="text-xs text-muted-foreground mt-1">{lastCheckInfo}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      );
    }

    if (!hasChat) {
      // Channel-only mode
      return (
        <div className="flex items-center justify-center">
          <Tooltip>
            <TooltipTrigger>{getChannelIcon()}</TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">Канал</p>
              <p>{getChannelTooltip()}</p>
              <p className="text-xs text-muted-foreground mt-1">{lastCheckInfo}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      );
    }

    // Chat + Channel mode
    return (
      <div className="flex items-center justify-center gap-1">
        <Tooltip>
          <TooltipTrigger>{getChatIcon()}</TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">Чат</p>
            <p>{getChatTooltip()}</p>
            <p className="text-xs text-muted-foreground mt-1">{lastCheckInfo}</p>
          </TooltipContent>
        </Tooltip>
        <span className="text-muted-foreground">/</span>
        <Tooltip>
          <TooltipTrigger>{getChannelIcon()}</TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">Канал</p>
            <p>{getChannelTooltip()}</p>
            <p className="text-xs text-muted-foreground mt-1">{lastCheckInfo}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    );
  };

  // Normalize error message for UI display
  const formatClubError = (err: unknown): { title: string; message: string } => {
    const e = err && typeof err === "object" ? (err as Record<string, any>) : {};
    const raw =
      (typeof e.message === "string" && e.message) ||
      (typeof e.error_description === "string" && e.error_description) ||
      (typeof e.details === "string" && e.details) ||
      (typeof e.hint === "string" && e.hint) ||
      "";
    const text = raw.toLowerCase();

    if (text.includes('forbidden') || text.includes('42501') || text.includes('unauthorized') || text.includes('jwt') || text.includes('not authorized')) {
      return { title: 'Нет доступа', message: 'Запрос отклонён (401/403). Проверьте роль/права пользователя и доступ к RPC.' };
    }
    if (text.includes('network') || text.includes('failed to fetch') || text.includes('timeout') || text.includes('fetch')) {
      return { title: 'Сетевая ошибка', message: 'Не удалось загрузить данные. Проверьте соединение и повторите.' };
    }
    return { title: 'Ошибка загрузки', message: raw || 'Неизвестная ошибка.' };
  };

  const errorInfo =
    isMembersError || isStatsError
      ? formatClubError(isMembersError ? membersError : statsError)
      : null;

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
              {hasChat && hasChannel ? 'Управление участниками чата и канала' :
               hasChat ? 'Управление участниками чата' : 'Управление участниками канала'}
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

        {/* Quick Stats — glassmorphism бизнес-метрики */}
        <ClubQuickStats
          club={club}
          businessStats={businessStats}
          members={members}
          isLoading={isLoading || isBusinessStatsLoading}
          isError={isStatsError}
          onTabChange={setActiveTab}
          violatorsCount={counts.violators}
          outsideSystemCount={summary?.outside_system_count ?? null}
          withAccessTotal={summary?.with_access_total ?? null}
          summary={summary}
          period={businessStatsPeriod}
          onPeriodChange={setBusinessStatsPeriod}
        />

        {/* Error Alert for members or stats */}
        {errorInfo && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{errorInfo.title}</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-4">
              <span className="min-w-0 break-words">{errorInfo.message}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { refetchMembers?.(); refetchStats?.(); }}
                className="shrink-0"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Повторить
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Поисковый индикатор */}
        {debouncedSearch.length >= 2 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Search className="h-3 w-3" />
              Поиск по всем записям
            </Badge>
          </div>
        )}

        {/* Tab Filters */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FilterTab)} className="w-full">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <TabsList className="inline-flex w-auto min-w-full sm:grid sm:w-full sm:grid-cols-6 gap-1">
              <TabsTrigger value="in_club" className="gap-1 px-2 sm:px-3 whitespace-nowrap">
                <span className="hidden sm:inline"><Users className="h-4 w-4" /></span>
                В клубе
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {counts.in_club}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="with_access" className="gap-1 px-2 sm:px-3 whitespace-nowrap">
                <span className="hidden sm:inline"><UserCheck className="h-4 w-4" /></span>
                С доступом
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">{counts.with_access}</Badge>
              </TabsTrigger>
              <TabsTrigger value="bought_not_joined" className="gap-1 px-2 sm:px-3 whitespace-nowrap">
                <span className="hidden sm:inline"><Clock className="h-4 w-4" /></span>
                Не вошли
                <Badge variant="outline" className="h-5 px-1.5 text-xs bg-yellow-500/10 text-yellow-600">{counts.bought_not_joined}</Badge>
              </TabsTrigger>
              <TabsTrigger value="violators" className="gap-1 px-2 sm:px-3 whitespace-nowrap">
                <span className="hidden sm:inline"><AlertTriangle className="h-4 w-4" /></span>
                Нарушители
                <Badge variant="destructive" className="h-5 px-1.5 text-xs">{counts.violators}</Badge>
              </TabsTrigger>
              <TabsTrigger value="removed" className="gap-1 px-2 sm:px-3 whitespace-nowrap">
                <span className="hidden sm:inline"><MinusCircle className="h-4 w-4" /></span>
                Удалённые
                <Badge variant="outline" className="h-5 px-1.5 text-xs">{counts.removed}</Badge>
              </TabsTrigger>
              <TabsTrigger value="admins" className="gap-1 px-2 sm:px-3 whitespace-nowrap">
                <span className="hidden sm:inline"><ShieldCheck className="h-4 w-4" /></span>
                Админы
                <Badge variant="outline" className="h-5 px-1.5 text-xs">{counts.admins}</Badge>
              </TabsTrigger>
            </TabsList>
          </div>
        </Tabs>

        {/* Actions */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
              <div className="flex flex-col sm:flex-row gap-3 flex-1">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Поиск по имени, username, email, телефону..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  disabled={syncMembers.isPending || checkingStatuses}
                >
                  {syncMembers.isPending || checkingStatuses ? (
                    <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 sm:mr-2" />
                  )}
                  <span className="hidden sm:inline">{checkingStatuses ? 'Проверка...' : 'Обновить'}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportCSV}
                  disabled={!filteredMembers.length}
                >
                  <Download className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Экспорт</span>
                </Button>
                {counts.violators > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowKickDialog(true)}
                  >
                    <Trash2 className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Удалить нарушителей</span>
                    <span className="sm:hidden">({counts.violators})</span>
                    <span className="hidden sm:inline ml-1">({counts.violators})</span>
                  </Button>
                )}
                {activeTab === 'bought_not_joined' && counts.bought_not_joined > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReinviteDryRun}
                    disabled={reinviteLoading}
                  >
                    {reinviteLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
                    ) : (
                      <Send className="h-4 w-4 sm:mr-2" />
                    )}
                    <span className="hidden sm:inline">Переотправить ссылки</span>
                    <span className="sm:hidden">({counts.bought_not_joined})</span>
                  </Button>
                )}
              </div>
            </div>
            
            {/* Mass selection toolbar */}
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 p-3 bg-muted rounded-lg mt-4">
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
                {/* Check statuses button */}
                <Button 
                  size="sm" 
                  variant="secondary"
                  onClick={handleCheckStatuses}
                  disabled={checkingStatuses}
                >
                  {checkingStatuses ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      {checkProgress.current}/{checkProgress.total}
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-4 w-4 mr-1" />
                      Проверить статусы
                    </>
                  )}
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
                  </>
                )}
                {/* Revoke works for any selected */}
                <Button 
                  size="sm" 
                  variant="destructive"
                  onClick={() => setShowMassRevokeDialog(true)}
                >
                  <MinusCircle className="h-4 w-4 mr-1" />
                  Отозвать доступ ({selectedIds.size})
                </Button>
                <Button 
                  size="sm" 
                  variant="secondary"
                  onClick={() => setShowMassMarkRemovedDialog(true)}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Пометить удалёнными
                </Button>
                {selectedPresentMembers.length > 0 && (
                  <Button 
                    size="sm" 
                    variant="destructive"
                    disabled={kickPresentDryRunLoading}
                    onClick={handleMassKickPresentPreview}
                  >
                    {kickPresentDryRunLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Ban className="h-4 w-4 mr-1" />}
                    Кикнуть из Telegram ({selectedPresentMembers.length})
                  </Button>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : filteredMembers.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 text-center text-muted-foreground">#</TableHead>
                    <TableHead className="w-10">
                      <Checkbox 
                        checked={selectedIds.size > 0 && selectedIds.size === filteredMembers.length}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>
                      <button onClick={() => toggleSort('telegram_name')} className="inline-flex items-center hover:text-foreground transition-colors">
                        Telegram <SortIcon k="telegram_name" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button onClick={() => toggleSort('crm_name')} className="inline-flex items-center hover:text-foreground transition-colors">
                        Связь с ЛК <SortIcon k="crm_name" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button onClick={() => toggleSort('access_status')} className="inline-flex items-center hover:text-foreground transition-colors">
                        Статус доступа <SortIcon k="access_status" />
                      </button>
                    </TableHead>
                    <TableHead className="text-center">
                      <button onClick={() => toggleSort('chat_channel')} className="inline-flex items-center justify-center gap-1 hover:text-foreground transition-colors">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-1 cursor-help">
                              {hasChat && hasChannel ? 'Чат / Канал' : hasChat ? 'В чате' : 'В канале'}
                              <HelpCircle className="h-3 w-3 text-muted-foreground" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{hasChat && hasChannel ? 'Чат / Канал' : hasChat ? 'Чат' : 'Канал'} (getChatMember)</p>
                            <p className="text-xs text-muted-foreground">Выберите участников и нажмите «Проверить статусы»</p>
                          </TooltipContent>
                        </Tooltip>
                        <SortIcon k="chat_channel" />
                      </button>
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      <button onClick={() => toggleSort('access_started_at')} className="inline-flex items-center hover:text-foreground transition-colors">
                        Доступ с <SortIcon k="access_started_at" />
                      </button>
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      <button onClick={() => toggleSort('access_ended_at')} className="inline-flex items-center hover:text-foreground transition-colors">
                        Доступ до <SortIcon k="access_ended_at" />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">Действия</TableHead>

                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map((member, index) => {
                    // Use has_active_access as source of truth for violator detection
                    const isViolator = !member.has_active_access && member.in_any;
                    const effectiveNoAccess = !member.has_active_access && (member.access_status === 'no_access' || member.access_status === 'removed');
                    
                    return (
                    <TableRow 
                      key={member.id}
                      className={`
                        ${selectedIds.has(member.id) ? 'bg-primary/5' : ''}
                        ${isViolator 
                          ? 'bg-red-500/10 border-l-2 border-l-red-500' 
                          : effectiveNoAccess
                            ? 'bg-destructive/5' 
                            : !member.has_active_access && member.access_status === 'expired' 
                              ? 'bg-yellow-500/5' 
                              : ''
                        }
                      `}
                    >
                      <TableCell className="text-center text-xs text-muted-foreground tabular-nums">
                        {index + 1}
                      </TableCell>
                      <TableCell>
                        <Checkbox 
                          checked={selectedIds.has(member.id)}
                          onCheckedChange={() => toggleSelect(member.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="font-medium flex items-center gap-1">
                              {member.telegram_first_name} {member.telegram_last_name}
                              {isViolator && (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <AlertTriangle className="h-4 w-4 text-red-500" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="font-medium text-red-500">Нарушитель</p>
                                    <p>Находится в {hasChat && member.in_chat ? 'чате' : ''}{hasChat && member.in_chat && hasChannel && member.in_channel ? ' и ' : ''}{hasChannel && member.in_channel ? 'канале' : ''}, но без доступа</p>
                                    <p className="text-xs mt-1">Подлежит автоматическому удалению</p>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {member.telegram_username ? `@${member.telegram_username}` : `ID: ${member.telegram_user_id}`}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {member.link_status === 'linked' && member.profiles?.id ? (
                          <button
                            onClick={() => openContactSheet(member.profiles!.id)}
                            className="text-left hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
                          >
                            <div className="text-sm font-medium text-primary hover:text-primary/80">
                              {member.profiles?.full_name || 'Без имени'}
                            </div>
                            <div className="text-xs text-muted-foreground hover:text-muted-foreground/80">
                              {member.profiles?.email}
                            </div>
                          </button>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Не связан</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {getAccessStatusBadge(member.access_status, member.link_status, member.has_active_access, member.access_ended_at)}
                      </TableCell>
                      <TableCell className="text-center">
                        {getTelegramStatus(member)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {member.access_started_at ? format(new Date(member.access_started_at), 'dd.MM.yyyy', { locale: ru }) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {member.access_ended_at ? format(new Date(member.access_ended_at), 'dd.MM.yyyy', { locale: ru }) : '—'}
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
                            <DropdownMenuItem onClick={() => {
                              setMessageTarget(member);
                              setShowSendMessageDialog(true);
                            }}>
                              <Send className="h-4 w-4 mr-2" />
                              Написать в Telegram
                            </DropdownMenuItem>
                            {/* Show grant option if no active access */}
                            {member.profiles && !member.has_active_access && (
                              <DropdownMenuItem onClick={() => setSelectedMember(member)}>
                                <Plus className="h-4 w-4 mr-2" />
                                Выдать доступ
                              </DropdownMenuItem>
                            )}
                            {/* Show extend option if has active access */}
                            {member.profiles && member.has_active_access && (
                              <DropdownMenuItem onClick={() => setSelectedMember(member)}>
                                <Clock className="h-4 w-4 mr-2" />
                                Продлить доступ
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            {/* Для пользователей с доступом (A) - отозвать и удалить */}
                            {member.has_active_access && (
                              <DropdownMenuItem 
                                onClick={() => {
                                  revokeAccess.mutate({
                                    userId: member.profiles?.user_id,
                                    telegramUserId: member.telegram_user_id,
                                    clubId: clubId!,
                                    reason: 'Ручной отзыв',
                                    isManual: true,
                                  }, {
                                    onSuccess: () => refetch()
                                  });
                                }}
                                className="text-destructive"
                              >
                                <Ban className="h-4 w-4 mr-2" />
                                Отозвать доступ и удалить
                              </DropdownMenuItem>
                            )}
                            {/* Для нарушителей (E: is_violator) - удалить из Telegram */}
                            {member.is_violator && (
                              <DropdownMenuItem 
                                onClick={() => handleKickSingleMember(member)}
                                className="text-destructive"
                              >
                                <Ban className="h-4 w-4 mr-2" />
                                Удалить из Telegram
                              </DropdownMenuItem>
                            )}
                            {/* Для не в клубе без active access - пометить удалённым */}
                            {!member.has_active_access && !member.in_any && member.access_status !== 'removed' && (
                              <DropdownMenuItem 
                                onClick={() => handleMarkSingleRemoved(member)}
                                className="text-muted-foreground"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Пометить удалённым
                              </DropdownMenuItem>
                            )}
                            {/* Reinvite for bought_not_joined */}
                            {!member.in_any && member.link_status === 'linked' && member.has_active_access && (
                              <DropdownMenuItem onClick={() => handleReinviteSingle(member)}>
                                <Send className="h-4 w-4 mr-2" />
                                Переотправить ссылку
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                  {activeTab === 'admins' && adminsNotInMembers.map((admin, index) => (
                    <TableRow key={`admin-extra-${admin.telegram_user_id}`} className="bg-muted/30">
                      <TableCell className="text-center text-xs text-muted-foreground tabular-nums">
                        {filteredMembers.length + index + 1}
                      </TableCell>
                      <TableCell />
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {admin.is_bot ? (
                            <Bot className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div>
                            <div className="font-medium">{admin.full_name || admin.telegram_username || `${admin.is_bot ? 'Bot' : 'Admin'} ${admin.telegram_user_id}`}</div>
                            <div className="text-sm text-muted-foreground">
                              {admin.telegram_username ? `@${admin.telegram_username}` : `ID: ${admin.telegram_user_id}`}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-muted-foreground">
                          {admin.is_bot ? 'Бот' : 'Не в списке'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          <ShieldCheck className="h-3 w-3 mr-1" />
                          {admin.role === 'creator' ? 'Создатель' : 'Администратор'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">—</TableCell>
                      <TableCell className="text-xs text-muted-foreground">—</TableCell>
                      <TableCell className="text-xs text-muted-foreground">—</TableCell>
                      <TableCell className="text-right">—</TableCell>
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
                    value={massGrantDays === 0 ? "" : massGrantDays}
                    onChange={(e) => setMassGrantDays(e.target.value === "" ? 0 : parseInt(e.target.value) || 0)}
                    onBlur={() => { if (massGrantDays < 1) setMassGrantDays(1); }}
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
                Отозвать доступ и удалить из чата/канала у {selectedIds.size} пользователей.
                Работает даже если статус в Telegram неизвестен.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="mass-reason">Причина отзыва</Label>
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
                disabled={massActionLoading}
              >
                {massActionLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Отозвать доступ ({selectedIds.size})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Mass Mark Removed Dialog */}
        <AlertDialog open={showMassMarkRemovedDialog} onOpenChange={setShowMassMarkRemovedDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Пометить как удалённые?</AlertDialogTitle>
              <AlertDialogDescription>
                {selectedIds.size} участников будут помечены как удалённые (без попытки кика из Telegram).
                Используйте это для обновления статуса в базе.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={handleMassMarkRemoved} disabled={massActionLoading}>
                {massActionLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Пометить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Mass Kick Present Dialog — с dry_run preview */}
        <AlertDialog open={showMassKickPresentDialog} onOpenChange={(open) => {
          setShowMassKickPresentDialog(open);
          if (!open) setKickPresentDryRunResult(null);
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-destructive">Удалить из Telegram?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  {kickPresentDryRunResult ? (
                    <div className="space-y-2">
                      <p>Проверка завершена:</p>
                      <div className="rounded-md border border-border p-3 space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Будет удалено (нет доступа):</span>
                          <span className="font-semibold text-destructive">{kickPresentDryRunResult.candidates_count}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Пропущено (есть доступ):</span>
                          <span className="font-semibold text-emerald-600">{kickPresentDryRunResult.skipped_has_access_count}</span>
                        </div>
                      </div>
                      {kickPresentDryRunResult.skipped_has_access_count > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Пользователи с активным доступом защищены от удаления.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p>
                      {selectedPresentMembers.length} участников будут удалены из чата и/или канала.
                      Пользователи с активным доступом будут пропущены.
                    </p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleMassKickPresent} 
                disabled={massActionLoading || (kickPresentDryRunResult?.candidates_count === 0)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {massActionLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {kickPresentDryRunResult
                  ? `Удалить (${kickPresentDryRunResult.candidates_count})`
                  : `Кикнуть (${selectedPresentMembers.length})`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Send Message Dialog */}
        <Dialog open={showSendMessageDialog} onOpenChange={setShowSendMessageDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Отправить сообщение</DialogTitle>
              <DialogDescription>
                {messageTarget && (
                  <>Получатель: {messageTarget.telegram_first_name} {messageTarget.telegram_last_name} 
                  ({messageTarget.telegram_username ? `@${messageTarget.telegram_username}` : `ID: ${messageTarget.telegram_user_id}`})</>
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
                setShowSendMessageDialog(false);
                setMessageText('');
                setMessageTarget(null);
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

        {/* Reinvite Ghosts Dialog */}
        <Dialog open={showReinviteDialog} onOpenChange={setShowReinviteDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Переотправить ссылки</DialogTitle>
              <DialogDescription>
                {reinviteDryRunResult ? (
                  <>
                    Будет отправлено: <strong>{reinviteDryRunResult.will_send}</strong> пользователям.
                    {reinviteDryRunResult.skipped_count > 0 && (
                      <> Пропущено: <strong>{reinviteDryRunResult.skipped_count}</strong> (лимиты/недавно отправлено).</>
                    )}
                  </>
                ) : 'Загрузка...'}
              </DialogDescription>
            </DialogHeader>
            {reinviteDryRunResult?.skipped?.length > 0 && (
              <div className="text-sm space-y-1 max-h-32 overflow-y-auto">
                <p className="font-medium text-muted-foreground">Причины пропуска:</p>
                {reinviteDryRunResult.skipped.map((s: any, i: number) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    TG {s.telegram_user_id}: {s.reason === 'invite_sent_recently' ? 'отправлено менее 4ч назад' : s.reason === 'max_reinvites_24h' ? 'лимит переотправок (3/24ч)' : s.reason === 'security_review' ? '⚠️ Security review' : s.reason}
                  </div>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowReinviteDialog(false); setReinviteDryRunResult(null); }}>
                Отмена
              </Button>
              <Button 
                onClick={handleReinviteExecute} 
                disabled={reinviteLoading || !reinviteDryRunResult?.will_send}
              >
                {reinviteLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                <Send className="h-4 w-4 mr-2" />
                Отправить ({reinviteDryRunResult?.will_send || 0})
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

        {/* Contact detail sheet */}
        <ContactDetailSheet
          contact={selectedContact}
          open={contactSheetOpen}
          onOpenChange={setContactSheetOpen}
        />
      </div>
    </AdminLayout>
  );
}
