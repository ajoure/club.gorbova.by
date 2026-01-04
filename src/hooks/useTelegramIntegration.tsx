import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Types
export interface TelegramBot {
  id: string;
  bot_name: string;
  bot_username: string;
  bot_token_encrypted: string;
  bot_id: number | null;
  status: string;
  last_check_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelegramClub {
  id: string;
  club_name: string;
  bot_id: string;
  chat_id: number | null;
  chat_invite_link: string | null;
  chat_status: string | null;
  channel_id: number | null;
  channel_invite_link: string | null;
  channel_status: string | null;
  access_mode: string;
  revoke_mode: string;
  subscription_duration_days: number;
  is_active: boolean;
  last_members_sync_at?: string | null;
  members_count_chat?: number;
  members_count_channel?: number;
  violators_count?: number;
  created_at: string;
  updated_at: string;
  telegram_bots?: TelegramBot;
}

export interface TelegramAccess {
  id: string;
  user_id: string;
  club_id: string;
  state_chat: string;
  state_channel: string;
  active_until: string | null;
  last_sync_at: string | null;
  telegram_clubs?: TelegramClub;
}

export interface TelegramManualAccess {
  id: string;
  user_id: string;
  club_id: string;
  is_active: boolean;
  valid_until: string | null;
  comment: string | null;
  created_by_admin_id: string;
  created_at: string;
}

export interface TelegramLog {
  id: string;
  user_id: string | null;
  club_id: string | null;
  action: string;
  target: string | null;
  status: string;
  error_message: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface TelegramClubMember {
  id: string;
  club_id: string;
  telegram_user_id: number;
  telegram_username: string | null;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  in_chat: boolean | null;
  in_channel: boolean | null;
  joined_chat_at: string | null;
  joined_channel_at: string | null;
  profile_id: string | null;
  link_status: string;
  access_status: string;
  last_synced_at: string | null;
  last_telegram_check_at: string | null;
  last_telegram_check_result: Record<string, unknown> | null;
  can_dm: boolean | null;
  created_at: string;
  updated_at: string;
  profiles?: {
    id: string;
    user_id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
  };
}

export interface TelegramAccessGrant {
  id: string;
  user_id: string;
  club_id: string;
  source: string;
  source_id: string | null;
  granted_by: string | null;
  start_at: string;
  end_at: string | null;
  status: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  telegram_clubs?: TelegramClub;
}

// Hooks
export function useTelegramBots() {
  return useQuery({
    queryKey: ['telegram-bots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_bots')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as TelegramBot[];
    },
  });
}

export function useTelegramClubs() {
  return useQuery({
    queryKey: ['telegram-clubs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_clubs')
        .select('*, telegram_bots(*)')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as TelegramClub[];
    },
  });
}

export function useTelegramLogs(limit = 50) {
  return useQuery({
    queryKey: ['telegram-logs', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as TelegramLog[];
    },
  });
}

export function useUserTelegramAccess(userId: string) {
  return useQuery({
    queryKey: ['telegram-access', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_access')
        .select('*, telegram_clubs(*)')
        .eq('user_id', userId);

      if (error) throw error;
      return data as TelegramAccess[];
    },
    enabled: !!userId,
  });
}

export function useUserManualAccess(userId: string) {
  return useQuery({
    queryKey: ['telegram-manual-access', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_manual_access')
        .select('*')
        .eq('user_id', userId);

      if (error) throw error;
      return data as TelegramManualAccess[];
    },
    enabled: !!userId,
  });
}

// Mutations
export function useCreateTelegramBot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (bot: Partial<TelegramBot>) => {
      const { data, error } = await supabase
        .from('telegram_bots')
        .insert({
          bot_name: bot.bot_name!,
          bot_username: bot.bot_username!,
          bot_token_encrypted: bot.bot_token_encrypted!,
          status: 'active',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-bots'] });
      toast.success('Бот добавлен');
    },
    onError: (error) => {
      console.error('Failed to create bot:', error);
      toast.error('Ошибка при добавлении бота');
    },
  });
}

export function useUpdateTelegramBot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<TelegramBot> & { id: string }) => {
      const { data, error } = await supabase
        .from('telegram_bots')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-bots'] });
      toast.success('Бот обновлён');
    },
    onError: (error) => {
      console.error('Failed to update bot:', error);
      toast.error('Ошибка при обновлении бота');
    },
  });
}

export function useDeleteTelegramBot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (botId: string) => {
      const { error } = await supabase
        .from('telegram_bots')
        .delete()
        .eq('id', botId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-bots'] });
      toast.success('Бот удалён');
    },
    onError: (error) => {
      console.error('Failed to delete bot:', error);
      toast.error('Ошибка при удалении бота');
    },
  });
}

export function useCreateTelegramClub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (club: Partial<TelegramClub>) => {
      const { data, error } = await supabase
        .from('telegram_clubs')
        .insert({
          club_name: club.club_name!,
          bot_id: club.bot_id!,
          chat_invite_link: club.chat_invite_link,
          channel_invite_link: club.channel_invite_link,
          access_mode: club.access_mode || 'AUTO_WITH_FALLBACK',
          revoke_mode: club.revoke_mode || 'KICK_ONLY',
          subscription_duration_days: club.subscription_duration_days || 30,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-clubs'] });
      toast.success('Клуб создан');
    },
    onError: (error) => {
      console.error('Failed to create club:', error);
      toast.error('Ошибка при создании клуба');
    },
  });
}

export function useUpdateTelegramClub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<TelegramClub> & { id: string }) => {
      const { data, error } = await supabase
        .from('telegram_clubs')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-clubs'] });
      toast.success('Клуб обновлён');
    },
    onError: (error) => {
      console.error('Failed to update club:', error);
      toast.error('Ошибка при обновлении клуба');
    },
  });
}

export function useCheckBotConnection() {
  return useMutation({
    mutationFn: async ({ botId, botToken }: { botId?: string; botToken?: string }) => {
      const { data, error } = await supabase.functions.invoke('telegram-bot-actions', {
        body: {
          action: 'check_connection',
          bot_id: botId,
          bot_token: botToken,
        },
      });

      if (error) throw error;
      return data;
    },
  });
}

export function useSetupWebhook() {
  return useMutation({
    mutationFn: async (botId: string) => {
      const { data, error } = await supabase.functions.invoke('telegram-bot-actions', {
        body: {
          action: 'set_webhook',
          bot_id: botId,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Webhook установлен');
    },
    onError: (error) => {
      console.error('Failed to setup webhook:', error);
      toast.error('Ошибка при установке webhook');
    },
  });
}

export function useCheckChatRights() {
  return useMutation({
    mutationFn: async ({ botId, chatId }: { botId: string; chatId: number }) => {
      const { data, error } = await supabase.functions.invoke('telegram-bot-actions', {
        body: {
          action: 'check_chat_rights',
          bot_id: botId,
          chat_id: chatId,
        },
      });

      if (error) throw error;
      return data;
    },
  });
}

export function useGrantTelegramAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      clubId,
      isManual,
      validUntil,
      comment,
    }: {
      userId: string;
      clubId?: string;
      isManual?: boolean;
      validUntil?: string;
      comment?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase.functions.invoke('telegram-grant-access', {
        body: {
          user_id: userId,
          club_id: clubId,
          is_manual: isManual,
          admin_id: user?.id,
          valid_until: validUntil,
          comment,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['telegram-access', variables.userId] });
      queryClient.invalidateQueries({ queryKey: ['telegram-manual-access', variables.userId] });
      queryClient.invalidateQueries({ queryKey: ['telegram-logs'] });
      toast.success('Доступ выдан');
    },
    onError: (error) => {
      console.error('Failed to grant access:', error);
      toast.error('Ошибка при выдаче доступа');
    },
  });
}

export function useRevokeTelegramAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      telegramUserId,
      clubId,
      reason,
      isManual,
    }: {
      userId?: string;
      telegramUserId?: number;
      clubId: string;
      reason?: string;
      isManual?: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke('telegram-revoke-access', {
        body: {
          user_id: userId,
          telegram_user_id: telegramUserId,
          club_id: clubId,
          reason,
          is_manual: isManual,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      if (variables.userId) {
        queryClient.invalidateQueries({ queryKey: ['telegram-access', variables.userId] });
        queryClient.invalidateQueries({ queryKey: ['telegram-manual-access', variables.userId] });
      }
      queryClient.invalidateQueries({ queryKey: ['telegram-logs'] });
      queryClient.invalidateQueries({ queryKey: ['club-members'] });
      toast.success('Доступ отозван');
    },
    onError: (error) => {
      console.error('Failed to revoke access:', error);
      toast.error('Ошибка при отзыве доступа');
    },
  });
}

// Generate link token for user
export function useGenerateTelegramLinkToken() {
  return useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Generate random token
      const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      
      // Create token with 15 min expiry
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);

      const { data, error } = await supabase
        .from('telegram_link_tokens')
        .insert({
          user_id: user.id,
          token,
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onError: (error) => {
      console.error('Failed to generate link token:', error);
      toast.error('Ошибка при генерации ссылки');
    },
  });
}

// Get current user's Telegram status
export function useCurrentUserTelegramStatus() {
  return useQuery({
    queryKey: ['current-user-telegram-status'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_user_id, telegram_username, telegram_linked_at')
        .eq('user_id', user.id)
        .single();

      const { data: access } = await supabase
        .from('telegram_access')
        .select('*, telegram_clubs(*)')
        .eq('user_id', user.id);

      return {
        profile,
        access: access || [],
        isLinked: !!profile?.telegram_user_id,
      };
    },
  });
}

// Club Members hooks
export function useClubMembers(clubId: string | null) {
  return useQuery({
    queryKey: ['telegram-club-members', clubId],
    queryFn: async () => {
      if (!clubId) return [];
      const { data, error } = await supabase
        .from('telegram_club_members')
        .select('*, profiles(id, user_id, full_name, email, phone)')
        .eq('club_id', clubId)
        .order('access_status', { ascending: true })
        .order('telegram_username', { ascending: true });

      if (error) throw error;
      return data as TelegramClubMember[];
    },
    enabled: !!clubId,
  });
}

export function useSyncClubMembers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (clubId: string) => {
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: { action: 'sync', club_id: clubId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data, clubId) => {
      queryClient.invalidateQueries({ queryKey: ['telegram-club-members', clubId] });
      queryClient.invalidateQueries({ queryKey: ['telegram-clubs'] });
      // Toast removed - handled in component for combined sync+check flow
    },
    onError: (error) => {
      console.error('Sync error:', error);
      // Toast removed - handled in component
    },
  });
}

export function useKickViolators() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clubId, memberIds }: { clubId: string; memberIds?: string[] }) => {
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: { action: 'kick', club_id: clubId, member_ids: memberIds },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data, { clubId }) => {
      queryClient.invalidateQueries({ queryKey: ['telegram-club-members', clubId] });
      queryClient.invalidateQueries({ queryKey: ['telegram-clubs'] });
      toast.success(`Удалено: ${data.kicked_count} участников`);
    },
    onError: (error) => {
      console.error('Kick error:', error);
      toast.error('Ошибка удаления');
    },
  });
}

export function usePreviewViolators(clubId: string | null) {
  return useQuery({
    queryKey: ['telegram-violators-preview', clubId],
    queryFn: async () => {
      if (!clubId) return { violators: [], count: 0 };
      const { data, error } = await supabase.functions.invoke('telegram-club-members', {
        body: { action: 'preview', club_id: clubId },
      });

      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });
}

// Delete club
export function useDeleteTelegramClub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (clubId: string) => {
      const { error } = await supabase
        .from('telegram_clubs')
        .delete()
        .eq('id', clubId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-clubs'] });
      toast.success('Клуб удалён');
    },
    onError: (error) => {
      console.error('Delete club error:', error);
      toast.error('Ошибка при удалении клуба');
    },
  });
}

// Access grants history
export function useUserAccessGrants(userId: string | null) {
  return useQuery({
    queryKey: ['telegram-access-grants', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('telegram_access_grants')
        .select('*, telegram_clubs(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as TelegramAccessGrant[];
    },
    enabled: !!userId,
  });
}
