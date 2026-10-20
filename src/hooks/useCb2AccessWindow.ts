import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Cb2AccessWindow } from '@/lib/cb2Access';

/** The same server-side source window protects content and suppresses stale reminders. */
export function useCb2AccessWindow(userId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['cb2-access-window', userId],
    enabled: enabled && !!userId,
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Cb2AccessWindow> => {
      const { data, error } = await supabase.rpc('get_cb2_access_window', { _user_id: userId! });
      if (error) throw error;
      if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.has_access !== 'boolean') throw new Error('invalid_access_window');
      return data as unknown as Cb2AccessWindow;
    },
  });
}
