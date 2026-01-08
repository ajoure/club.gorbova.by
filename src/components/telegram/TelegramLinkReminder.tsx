import { useState, useEffect } from 'react';
import { X, MessageCircle, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTelegramLinkStatus, useStartTelegramLink, type LinkSessionResult } from '@/hooks/useTelegramLink';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

const REMINDER_DISMISSED_KEY = 'telegram_reminder_dismissed';
const REMINDER_COOLDOWN_HOURS = 24;

export function TelegramLinkReminder() {
  const { user } = useAuth();
  const { data: linkStatus, isLoading, refetch } = useTelegramLinkStatus();
  const startLink = useStartTelegramLink();
  const [isDismissed, setIsDismissed] = useState(true);
  const [linkSession, setLinkSession] = useState<LinkSessionResult | null>(null);

  // Check if user has pending notifications
  const { data: pendingCount } = useQuery({
    queryKey: ['pending-notifications-count', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      
      const { count } = await supabase
        .from('pending_telegram_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'pending');
      
      return count || 0;
    },
    enabled: !!user?.id && linkStatus?.status !== 'active',
  });

  useEffect(() => {
    // Check if reminder was recently dismissed
    const dismissedAt = localStorage.getItem(REMINDER_DISMISSED_KEY);
    if (dismissedAt) {
      const hours = (Date.now() - parseInt(dismissedAt)) / (1000 * 60 * 60);
      if (hours < REMINDER_COOLDOWN_HOURS) {
        setIsDismissed(true);
        return;
      }
    }
    setIsDismissed(false);
  }, []);

  // Subscribe to profile changes
  useEffect(() => {
    if (!user?.id || !linkSession) return;

    const channel = supabase
      .channel('telegram-reminder-status')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newStatus = (payload.new as any)?.telegram_link_status;
          if (newStatus === 'active') {
            setLinkSession(null);
            refetch();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, linkSession, refetch]);

  const handleDismiss = () => {
    localStorage.setItem(REMINDER_DISMISSED_KEY, Date.now().toString());
    setIsDismissed(true);
  };

  const handleStartLink = async () => {
    const result = await startLink.mutateAsync();
    if (result.success && result.deep_link) {
      setLinkSession(result);
    }
  };

  // Don't show if loading, dismissed, already linked, or has telegram username (already linked)
  if (isLoading || isDismissed || linkStatus?.status === 'active' || linkStatus?.telegram_username) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-5 duration-300">
      <div className="rounded-2xl border border-primary/20 bg-card/95 backdrop-blur-md shadow-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <MessageCircle className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Привяжите Telegram</p>
              <p className="text-xs text-muted-foreground">
                {pendingCount && pendingCount > 0 
                  ? `У вас ${pendingCount} непрочитанных уведомлений`
                  : 'Для получения уведомлений и доступа к клубу'
                }
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            className="h-6 w-6 -mt-1 -mr-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {linkSession ? (
          <Button 
            onClick={() => window.open(linkSession.deep_link, '_blank')}
            className="w-full h-9 text-sm gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            Открыть Telegram
          </Button>
        ) : (
          <Button 
            onClick={handleStartLink}
            disabled={startLink.isPending}
            className="w-full h-9 text-sm gap-2"
          >
            {startLink.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MessageCircle className="h-4 w-4" />
            )}
            Привязать Telegram
          </Button>
        )}
      </div>
    </div>
  );
}
