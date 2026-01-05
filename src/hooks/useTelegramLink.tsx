import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type TelegramLinkStatus = 'not_linked' | 'pending' | 'active' | 'inactive';

export interface TelegramLinkState {
  status: TelegramLinkStatus;
  telegram_username: string | null;
  telegram_id_masked: string | null;
  linked_at: string | null;
  last_check_at: string | null;
  needs_action: boolean;
  error?: string | null;
  cached?: boolean;
}

export interface LinkSessionResult {
  success: boolean;
  token?: string;
  bot_username?: string;
  deep_link?: string;
  expires_at?: string;
  action_type?: 'link' | 'relink';
  error?: string;
}

export function useTelegramLinkStatus() {
  return useQuery({
    queryKey: ['telegram-link-status'],
    queryFn: async (): Promise<TelegramLinkState> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return {
          status: 'not_linked',
          telegram_username: null,
          telegram_id_masked: null,
          linked_at: null,
          last_check_at: null,
          needs_action: false,
        };
      }

      // Get profile data first for immediate display
      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_user_id, telegram_username, telegram_linked_at, telegram_link_status, telegram_last_check_at, telegram_last_error')
        .eq('user_id', user.id)
        .single();

      if (!profile) {
        return {
          status: 'not_linked',
          telegram_username: null,
          telegram_id_masked: null,
          linked_at: null,
          last_check_at: null,
          needs_action: false,
        };
      }

      const status = (profile.telegram_link_status || 'not_linked') as TelegramLinkStatus;
      
      return {
        status,
        telegram_username: profile.telegram_username,
        telegram_id_masked: profile.telegram_user_id 
          ? `****${String(profile.telegram_user_id).slice(-4)}`
          : null,
        linked_at: profile.telegram_linked_at,
        last_check_at: profile.telegram_last_check_at,
        needs_action: status === 'inactive',
        error: profile.telegram_last_error,
      };
    },
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });
}

export function useStartTelegramLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<LinkSessionResult> => {
      const { data, error } = await supabase.functions.invoke('telegram-link-manage', {
        body: { action: 'start' },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-link-status'] });
    },
    onError: (error) => {
      console.error('Start link error:', error);
      toast.error('Не удалось начать привязку');
    },
  });
}

export function useUnlinkTelegram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('telegram-link-manage', {
        body: { action: 'unlink' },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-link-status'] });
      queryClient.invalidateQueries({ queryKey: ['current-user-telegram-status'] });
      toast.success('Telegram отвязан');
    },
    onError: (error) => {
      console.error('Unlink error:', error);
      toast.error('Не удалось отвязать Telegram');
    },
  });
}

export function useCheckTelegramStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<TelegramLinkState> => {
      const { data, error } = await supabase.functions.invoke('telegram-link-manage', {
        body: { action: 'check_status' },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['telegram-link-status'], data);
      if (data.status === 'active') {
        toast.success('Связь активна');
      } else if (data.status === 'inactive') {
        toast.warning('Связь с ботом потеряна');
      }
    },
    onError: (error) => {
      console.error('Check status error:', error);
      toast.error('Не удалось проверить статус');
    },
  });
}

export function useCancelTelegramLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('telegram-link-manage', {
        body: { action: 'cancel' },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-link-status'] });
    },
  });
}
