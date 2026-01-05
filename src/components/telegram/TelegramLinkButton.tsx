import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  useCurrentUserTelegramStatus, 
  useGenerateTelegramLinkToken 
} from '@/hooks/useTelegramIntegration';
import { Loader2, CheckCircle, ExternalLink, MessageCircle } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface TelegramLinkButtonProps {
  botUsername?: string;
}

export function TelegramLinkButton({ botUsername = 'fsby_bot' }: TelegramLinkButtonProps) {
  const { data: status, isLoading } = useCurrentUserTelegramStatus();
  const generateToken = useGenerateTelegramLinkToken();
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  const handleGenerateLink = async () => {
    const tokenData = await generateToken.mutateAsync();
    if (tokenData) {
      const url = `https://t.me/${botUsername}?start=${tokenData.token}`;
      setLinkUrl(url);
    }
  };

  if (isLoading) {
    return (
      <Button variant="ghost" size="sm" disabled className="gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="hidden sm:inline">Загрузка...</span>
      </Button>
    );
  }

  if (status?.isLinked) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="hidden sm:inline">@{status.profile?.telegram_username || 'Telegram'}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="end">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="font-medium text-sm">Telegram привязан</span>
            </div>
            
            <div className="text-xs text-muted-foreground">
              @{status.profile?.telegram_username || 'пользователь'}
              {status.profile?.telegram_linked_at && (
                <span className="ml-1">
                  · {format(new Date(status.profile.telegram_linked_at), 'd MMM yyyy', { locale: ru })}
                </span>
              )}
            </div>
            
            {status.access && status.access.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground">Доступы:</p>
                {status.access.map((acc: { id: string; telegram_clubs?: { club_name: string }; state_chat: string; state_channel: string }) => (
                  <div key={acc.id} className="space-y-1">
                    <p className="text-xs font-medium">{acc.telegram_clubs?.club_name || 'Клуб'}</p>
                    <div className="flex gap-1.5 flex-wrap">
                      <Badge 
                        variant={acc.state_chat === 'active' ? 'default' : 'secondary'} 
                        className="text-[10px] px-1.5 py-0"
                      >
                        Чат
                      </Badge>
                      <Badge 
                        variant={acc.state_channel === 'active' ? 'default' : 'secondary'}
                        className="text-[10px] px-1.5 py-0"
                      >
                        Канал
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
          <MessageCircle className="h-4 w-4" />
          <span className="hidden sm:inline">Привязать Telegram</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="space-y-3">
          <div>
            <p className="font-medium text-sm mb-1">Привязать Telegram</p>
            <p className="text-xs text-muted-foreground">
              Для доступа к закрытому клубу
            </p>
          </div>
          
          {linkUrl ? (
            <div className="space-y-2">
              <Button asChild size="sm" className="w-full">
                <a href={linkUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Открыть @{botUsername}
                </a>
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">
                Ссылка действительна 15 минут
              </p>
            </div>
          ) : (
            <Button 
              onClick={handleGenerateLink} 
              disabled={generateToken.isPending}
              size="sm"
              className="w-full"
            >
              {generateToken.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Генерация...
                </>
              ) : (
                'Получить ссылку'
              )}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
