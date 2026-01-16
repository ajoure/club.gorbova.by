import { useState, useEffect } from 'react';
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
  Hash,
  MessageCircle
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

export function TelegramProfileWidget() {
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
      .channel('telegram-link-profile')
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
      <div className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur-xl p-4">
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const status = linkStatus?.status || 'not_linked';
  const hasActiveAccess = clubAccess && clubAccess.length > 0;
  const activeClub = hasActiveAccess ? clubAccess[0] : null;
  const hasChatAccess = activeClub?.state_chat === 'active';
  const hasChannelAccess = activeClub?.state_channel === 'active';

  // Pending state
  if (status === 'pending' || linkSession) {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 backdrop-blur-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Telegram</span>
          </div>
          <Badge variant="outline" className="text-xs px-2 py-0.5 text-primary border-primary/30 bg-primary/10">
            {timeLeft !== null && (
              <span className="tabular-nums">
                {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
              </span>
            )}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          Нажмите кнопку ниже и отправьте /start боту
        </p>

        <div className="flex gap-2">
          <Button 
            size="sm"
            onClick={handleOpenTelegram}
            disabled={!linkSession?.deep_link}
            className="flex-1 h-8 text-xs bg-primary/90 hover:bg-primary"
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Открыть Telegram
          </Button>
          <Button 
            size="sm"
            variant="ghost" 
            onClick={() => { cancelLink.mutate(); setLinkSession(null); }}
            className="h-8 px-3 text-xs text-muted-foreground"
          >
            ✕
          </Button>
        </div>
      </div>
    );
  }

  // Not linked / Inactive state
  if (status === 'not_linked' || status === 'inactive') {
    return (
      <div className={`rounded-2xl border backdrop-blur-xl p-4 space-y-3 ${
        status === 'inactive' 
          ? 'border-destructive/30 bg-destructive/5' 
          : 'border-border/40 bg-card/60'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {status === 'inactive' ? (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            ) : (
              <MessageCircle className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">Telegram</span>
          </div>
          {status === 'inactive' && (
            <Badge variant="outline" className="text-xs px-2 py-0.5 text-destructive border-destructive/30">
              Ошибка связи
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Привяжите аккаунт для получения уведомлений и доступа к закрытому клубу
        </p>

        {/* Access indicators (greyed out) */}
        <div className="flex gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted/50 text-muted-foreground text-xs">
            <Users className="h-3 w-3" />
            <span>Чат</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted/50 text-muted-foreground text-xs">
            <Hash className="h-3 w-3" />
            <span>Канал</span>
          </div>
        </div>
        
        <Button 
          size="sm"
          onClick={handleStartLink}
          disabled={startLink.isPending}
          className="w-full h-8 text-xs"
        >
          {startLink.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
          )}
          {status === 'inactive' ? 'Перепривязать' : 'Привязать аккаунт'}
        </Button>
      </div>
    );
  }

  // Active state - full widget with access indicators
  return (
    <div className="rounded-2xl border border-green-500/30 bg-green-500/5 backdrop-blur-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="text-sm font-medium">Telegram</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCheckStatus}
          disabled={checkStatus.isPending}
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checkStatus.isPending ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium">@{linkStatus?.telegram_username || 'пользователь'}</p>
        <p className="text-xs text-muted-foreground">
          {linkStatus?.telegram_id_masked}
          {linkStatus?.linked_at && (
            <span className="ml-1">
              · с {format(new Date(linkStatus.linked_at), 'd MMM yyyy', { locale: ru })}
            </span>
          )}
        </p>
      </div>

      {/* Club access badges with indicators */}
      <div className="flex gap-2">
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
          hasChatAccess 
            ? 'bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/30' 
            : 'bg-muted/50 text-muted-foreground'
        }`}>
          <Users className="h-3 w-3" />
          <span>Чат</span>
          {hasChatAccess && <CheckCircle className="h-3 w-3" />}
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
          hasChannelAccess 
            ? 'bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/30' 
            : 'bg-muted/50 text-muted-foreground'
        }`}>
          <Hash className="h-3 w-3" />
          <span>Канал</span>
          {hasChannelAccess && <CheckCircle className="h-3 w-3" />}
        </div>
      </div>

      <Button 
        size="sm"
        variant="outline" 
        onClick={handleStartLink}
        disabled={startLink.isPending}
        className="w-full h-8 text-xs border-border/50 bg-background/50 hover:bg-background"
      >
        {startLink.isPending ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <Link2 className="h-3.5 w-3.5 mr-1.5" />
        )}
        Перепривязать
      </Button>
    </div>
  );
}
