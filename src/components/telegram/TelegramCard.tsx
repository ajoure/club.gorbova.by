import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { 
  MessageCircle, 
  CheckCircle, 
  AlertTriangle, 
  Loader2, 
  ExternalLink, 
  RefreshCw,
  Unlink,
  Link2,
  Clock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { supabase } from '@/integrations/supabase/client';
import {
  useTelegramLinkStatus,
  useStartTelegramLink,
  useUnlinkTelegram,
  useCheckTelegramStatus,
  useCancelTelegramLink,
  type LinkSessionResult,
} from '@/hooks/useTelegramLink';
import { useAuth } from '@/contexts/AuthContext';

export function TelegramCard() {
  const { user } = useAuth();
  const { data: linkStatus, isLoading: isStatusLoading, refetch } = useTelegramLinkStatus();
  const startLink = useStartTelegramLink();
  const unlink = useUnlinkTelegram();
  const checkStatus = useCheckTelegramStatus();
  const cancelLink = useCancelTelegramLink();

  const [linkSession, setLinkSession] = useState<LinkSessionResult | null>(null);
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

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
      .channel('telegram-link-status')
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
            // Link confirmed!
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

  const handleUnlink = async () => {
    await unlink.mutateAsync();
    setShowUnlinkDialog(false);
    setLinkSession(null);
  };

  const handleCheckStatus = async () => {
    await checkStatus.mutateAsync();
  };

  const handleCancel = async () => {
    await cancelLink.mutateAsync();
    setLinkSession(null);
  };

  const handleOpenTelegram = () => {
    if (linkSession?.deep_link) {
      window.open(linkSession.deep_link, '_blank');
    }
  };

  if (isStatusLoading) {
    return (
      <div className="rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm p-4">
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const status = linkStatus?.status || 'not_linked';

  // Pending state - waiting for user to confirm in Telegram
  if (status === 'pending' || linkSession) {
    return (
      <div className="rounded-2xl border border-primary/20 bg-primary/5 backdrop-blur-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Telegram</span>
          </div>
          <Badge variant="outline" className="text-xs text-primary border-primary/30 bg-primary/10">
            Ожидание
            {timeLeft !== null && (
              <span className="ml-1.5 tabular-nums">
                {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
              </span>
            )}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          Нажмите <strong>Start</strong> в боте
        </p>

        <div className="flex gap-2">
          <Button 
            size="sm"
            onClick={handleOpenTelegram}
            disabled={!linkSession?.deep_link}
            className="flex-1 h-8 bg-primary/90 hover:bg-primary text-xs"
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Открыть
          </Button>
          <Button 
            size="sm"
            variant="ghost" 
            onClick={handleCancel}
            disabled={cancelLink.isPending}
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
          >
            Отмена
          </Button>
        </div>
      </div>
    );
  }

  // Not linked state
  if (status === 'not_linked') {
    return (
      <div className="rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Telegram</span>
        </div>
        
        <p className="text-xs text-muted-foreground">
          Для доступа к клубу и уведомлений
        </p>

        <Button 
          size="sm"
          onClick={handleStartLink}
          disabled={startLink.isPending}
          className="w-full h-8 text-xs bg-primary/90 hover:bg-primary"
        >
          {startLink.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
          )}
          Привязать
        </Button>
      </div>
    );
  }

  // Inactive state - bot blocked or connection lost
  if (status === 'inactive') {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 backdrop-blur-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-sm font-medium">Telegram</span>
          </div>
          <Badge variant="outline" className="text-xs text-destructive border-destructive/30 bg-destructive/10">
            Ошибка
          </Badge>
        </div>

        {linkStatus?.telegram_username && (
          <p className="text-xs text-muted-foreground">
            @{linkStatus.telegram_username} · {linkStatus.telegram_id_masked}
          </p>
        )}

        <div className="flex gap-2">
          <Button 
            size="sm"
            onClick={handleStartLink}
            disabled={startLink.isPending}
            className="flex-1 h-8 text-xs"
          >
            {startLink.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5 mr-1.5" />
            )}
            Перепривязать
          </Button>
          <Button 
            size="sm"
            variant="ghost" 
            onClick={() => setShowUnlinkDialog(true)}
            className="h-8 text-xs text-muted-foreground hover:text-destructive"
          >
            <Unlink className="h-3.5 w-3.5" />
          </Button>
        </div>

        <AlertDialog open={showUnlinkDialog} onOpenChange={setShowUnlinkDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Отвязать Telegram?</AlertDialogTitle>
              <AlertDialogDescription>
                Доступ к чатам клуба может быть ограничен.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleUnlink}
                disabled={unlink.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {unlink.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Отвязать
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // Active state - linked and working
  return (
    <div className="rounded-2xl border border-green-500/20 bg-green-500/5 backdrop-blur-sm p-4 space-y-3">
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

      <div className="space-y-0.5">
        <p className="text-sm font-medium">@{linkStatus?.telegram_username || 'пользователь'}</p>
        <p className="text-[11px] text-muted-foreground">
          {linkStatus?.telegram_id_masked}
          {linkStatus?.linked_at && (
            <span className="ml-1.5">
              · {format(new Date(linkStatus.linked_at), 'd MMM', { locale: ru })}
            </span>
          )}
        </p>
      </div>

      <div className="flex gap-2">
        <Button 
          size="sm"
          variant="outline" 
          onClick={handleStartLink}
          disabled={startLink.isPending}
          className="flex-1 h-8 text-xs border-border/50 bg-background/50 hover:bg-background"
        >
          {startLink.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
          )}
          Перепривязать
        </Button>
        <Button 
          size="sm"
          variant="ghost" 
          onClick={() => setShowUnlinkDialog(true)}
          className="h-8 text-xs text-muted-foreground hover:text-destructive"
        >
          <Unlink className="h-3.5 w-3.5" />
        </Button>
      </div>

      <AlertDialog open={showUnlinkDialog} onOpenChange={setShowUnlinkDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отвязать Telegram?</AlertDialogTitle>
            <AlertDialogDescription>
              Доступ к чатам клуба может быть ограничен.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnlink}
              disabled={unlink.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {unlink.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Отвязать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
