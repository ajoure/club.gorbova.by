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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  useTelegramLinkStatus,
  useStartTelegramLink,
  useUnlinkTelegram,
  useCheckTelegramStatus,
  useCancelTelegramLink,
  type LinkSessionResult,
} from '@/hooks/useTelegramLink';

export function TelegramCard() {
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

  // Check status on mount (with throttling handled server-side)
  useEffect(() => {
    if (linkStatus?.status === 'active' && !linkStatus.cached) {
      // Already up-to-date
    } else if (linkStatus?.status === 'active' || linkStatus?.status === 'inactive') {
      // Could trigger auto-check, but respect server-side throttling
    }
  }, [linkStatus]);

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
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const status = linkStatus?.status || 'not_linked';

  // Pending state - waiting for user to confirm in Telegram
  if (status === 'pending' || linkSession) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Telegram</CardTitle>
              <CardDescription>Ожидаем подтверждение</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-primary border-primary/30">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Ожидание
            </Badge>
            {timeLeft !== null && (
              <span className="text-xs text-muted-foreground">
                {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
              </span>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            Нажмите <strong>Start</strong> в боте, чтобы завершить привязку
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button 
              onClick={handleOpenTelegram}
              className="flex-1"
              disabled={!linkSession?.deep_link}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Открыть Telegram
            </Button>
            <Button 
              variant="outline" 
              onClick={handleCancel}
              disabled={cancelLink.isPending}
            >
              Отменить
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Not linked state
  if (status === 'not_linked') {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-muted">
              <MessageCircle className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Telegram</CardTitle>
              <CardDescription>Не привязан</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Привяжите Telegram для доступа к клубу и получения уведомлений
          </p>
          <Button 
            onClick={handleStartLink}
            disabled={startLink.isPending}
            className="w-full sm:w-auto"
          >
            {startLink.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4 mr-2" />
            )}
            Привязать Telegram
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Inactive state - bot blocked or connection lost
  if (status === 'inactive') {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base">Telegram</CardTitle>
              <CardDescription className="text-destructive">
                Нужна перепривязка
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            {linkStatus?.telegram_username && (
              <p className="text-sm">
                @{linkStatus.telegram_username}
                <span className="text-muted-foreground ml-1">
                  ({linkStatus.telegram_id_masked})
                </span>
              </p>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            Связь с ботом потеряна. Перепривяжите Telegram для восстановления доступа.
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button 
              onClick={handleStartLink}
              disabled={startLink.isPending}
              className="flex-1"
            >
              {startLink.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4 mr-2" />
              )}
              Перепривязать
            </Button>
            <Button 
              variant="outline" 
              onClick={() => setShowUnlinkDialog(true)}
            >
              <Unlink className="h-4 w-4 mr-2" />
              Отвязать
            </Button>
          </div>
        </CardContent>

        <AlertDialog open={showUnlinkDialog} onOpenChange={setShowUnlinkDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Отвязать Telegram?</AlertDialogTitle>
              <AlertDialogDescription>
                Доступ к чатам и каналам клуба может быть ограничен. 
                Вы сможете привязать Telegram снова в любой момент.
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
      </Card>
    );
  }

  // Active state - linked and working
  return (
    <Card className="border-green-500/20 bg-green-500/5">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-green-500/10">
            <CheckCircle className="h-5 w-5 text-green-500" />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base">Telegram</CardTitle>
            <CardDescription className="text-green-600 dark:text-green-400">
              Активен
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCheckStatus}
            disabled={checkStatus.isPending}
            className="shrink-0"
            title="Проверить статус"
          >
            <RefreshCw className={`h-4 w-4 ${checkStatus.isPending ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            @{linkStatus?.telegram_username || 'пользователь'}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>ID: {linkStatus?.telegram_id_masked}</span>
            {linkStatus?.linked_at && (
              <span>
                Привязан: {format(new Date(linkStatus.linked_at), 'd MMM yyyy', { locale: ru })}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button 
            variant="outline" 
            onClick={handleStartLink}
            disabled={startLink.isPending}
            className="flex-1"
          >
            {startLink.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4 mr-2" />
            )}
            Перепривязать
          </Button>
          <Button 
            variant="ghost" 
            onClick={() => setShowUnlinkDialog(true)}
          >
            <Unlink className="h-4 w-4 mr-2" />
            Отвязать
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={showUnlinkDialog} onOpenChange={setShowUnlinkDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отвязать Telegram?</AlertDialogTitle>
            <AlertDialogDescription>
              Доступ к чатам и каналам клуба может быть ограничен. 
              Вы сможете привязать Telegram снова в любой момент.
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
    </Card>
  );
}
