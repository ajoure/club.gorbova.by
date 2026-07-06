import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { 
  CheckCircle, 
  AlertTriangle, 
  Loader2, 
  ExternalLink, 
  RefreshCw,
  Link2,
  Clock,
  Users,
  Hash
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import {
  useTelegramLinkStatus,
  useStartTelegramLink,
  useCheckTelegramStatus,
  useCancelTelegramLink,
  type LinkSessionResult,
} from '@/hooks/useTelegramLink';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';

export function TelegramCompactCard() {
  const { user } = useAuth();
  const { data: linkStatus, isLoading: isStatusLoading, refetch } = useTelegramLinkStatus();
  const startLink = useStartTelegramLink();
  const checkStatus = useCheckTelegramStatus();
  const cancelLink = useCancelTelegramLink();

  const [linkSession, setLinkSession] = useState<LinkSessionResult | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Fetch club access info
  const { data: clubAccess } = useQuery({
    queryKey: ['telegram-club-access', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_user_id')
        .eq('user_id', user.id)
        .single();
      
      if (!profile?.telegram_user_id) return null;

      const { data } = await supabase
        .from('telegram_access')
        .select(`
          id,
          state_chat,
          state_channel,
          active_until,
          telegram_clubs(club_name)
        `)
        .eq('user_id', user.id)
        .or('state_chat.eq.active,state_channel.eq.active');
      
      return data;
    },
    enabled: !!user?.id && linkStatus?.status === 'active',
  });

  // Timer for pending state
  useEffect(() => {
    if (!linkSession?.expires_at) {
      setTimeLeft(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const expires = new Date(linkSession.expires_at!).getTime();
      const remaining = Math.max(0, Math.floor((expires - now) / 1000));
      setTimeLeft(remaining);

      if (remaining <= 0) {
        setLinkSession(null);
        refetch();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [linkSession?.expires_at, refetch]);

  // Subscribe to profile changes for realtime updates
  useEffect(() => {
    if (!user?.id || !linkSession) return;

    const channel = supabase
      .channel('telegram-link-compact')
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

  const handleStartLink = async () => {
    const result = await startLink.mutateAsync();
    if (result.success && result.deep_link) {
      setLinkSession(result);
    }
  };

  const handleOpenTelegram = () => {
    if (linkSession?.deep_link) {
      window.open(linkSession.deep_link, '_blank');
    }
  };

  const handleCheckStatus = async () => {
    await checkStatus.mutateAsync();
  };

  if (isStatusLoading) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm p-3">
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const status = linkStatus?.status || 'not_linked';

  // Pending state
  if (status === 'pending' || linkSession) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium">Telegram</span>
          </div>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-primary border-primary/30 bg-primary/10">
            {timeLeft !== null && (
              <span className="tabular-nums">
                {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
              </span>
            )}
          </Badge>
        </div>

        <div className="flex gap-1.5">
          <Button 
            size="sm"
            onClick={handleOpenTelegram}
            disabled={!linkSession?.deep_link}
            className="flex-1 h-7 text-[11px] bg-primary/90 hover:bg-primary"
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Открыть
          </Button>
          <Button 
            size="sm"
            variant="ghost" 
            onClick={() => { cancelLink.mutate(); setLinkSession(null); }}
            className="h-7 px-2 text-[11px] text-muted-foreground"
          >
            ✕
          </Button>
        </div>
      </div>
    );
  }

  // Not linked state
  if (status === 'not_linked') {
    return (
      <div className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Telegram</span>
        </div>
        
        <Button 
          size="sm"
          onClick={handleStartLink}
          disabled={startLink.isPending}
          className="w-full h-7 text-[11px] bg-primary/90 hover:bg-primary"
        >
          {startLink.isPending ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Link2 className="h-3 w-3 mr-1" />
          )}
          Привязать
        </Button>
      </div>
    );
  }

  // Inactive state
  if (status === 'inactive') {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            <span className="text-xs font-medium">Telegram</span>
          </div>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-destructive border-destructive/30">
            Ошибка
          </Badge>
        </div>

        <Button 
          size="sm"
          onClick={handleStartLink}
          disabled={startLink.isPending}
          className="w-full h-7 text-[11px]"
        >
          {startLink.isPending ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Link2 className="h-3 w-3 mr-1" />
          )}
          Перепривязать
        </Button>
      </div>
    );
  }

  // Active state - compact version like in screenshot
  const hasActiveAccess = clubAccess && clubAccess.length > 0;
  const activeClub = hasActiveAccess ? clubAccess[0] : null;
  const hasChatAccess = activeClub?.state_chat === 'active';
  const hasChannelAccess = activeClub?.state_channel === 'active';

  return (
    <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CheckCircle className="h-3.5 w-3.5 text-green-500" />
          <span className="text-xs font-medium">Telegram</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCheckStatus}
          disabled={checkStatus.isPending}
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`h-3 w-3 ${checkStatus.isPending ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium">@{linkStatus?.telegram_username || 'пользователь'}</p>
        <p className="text-[10px] text-muted-foreground">
          {linkStatus?.telegram_id_masked}
          {linkStatus?.linked_at && (
            <span className="ml-1">
              · {format(new Date(linkStatus.linked_at), 'd MMM', { locale: ru })}
            </span>
          )}
        </p>
      </div>

      {/* Club access badges */}
      {hasActiveAccess && (
        <div className="flex gap-1 flex-wrap">
          {hasChatAccess && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
              <Users className="h-2.5 w-2.5" />
              Чат
            </Badge>
          )}
          {hasChannelAccess && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
              <Hash className="h-2.5 w-2.5" />
              Канал
            </Badge>
          )}
        </div>
      )}

      <Button 
        size="sm"
        variant="outline" 
        onClick={handleStartLink}
        disabled={startLink.isPending}
        className="w-full h-7 text-[11px] border-border/50 bg-background/50 hover:bg-background"
      >
        {startLink.isPending ? (
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        ) : (
          <Link2 className="h-3 w-3 mr-1" />
        )}
        Перепривязать
      </Button>
    </div>
  );
}
