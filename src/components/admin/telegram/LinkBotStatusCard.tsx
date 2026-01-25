import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Bot, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

export function LinkBotStatusCard() {
  const { data: bot, isLoading, error } = useQuery({
    queryKey: ['link-bot-status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_bots')
        .select('id, bot_name, bot_username, status, is_primary, last_check_at, error_message, updated_at')
        .eq('is_primary', true)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    refetchInterval: 30000, // Refresh every 30s
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Link-bot статус
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Link-bot статус
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Ошибка загрузки: {error instanceof Error ? error.message : 'Unknown error'}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!bot) {
    return (
      <Card className="border-destructive/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Link-bot статус
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Link-bot не настроен!</strong> Telegram-уведомления не будут отправляться.
              <br />
              <span className="text-sm opacity-80">
                Необходим бот с is_primary=true и status=active в таблице telegram_bots.
              </span>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const isActive = bot.status === 'active';

  return (
    <Card className={isActive ? 'border-green-500/30' : 'border-amber-500/50'}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="h-4 w-4" />
          Link-bot статус
          {isActive ? (
            <Badge variant="default" className="bg-green-600 ml-auto">
              <CheckCircle className="h-3 w-3 mr-1" />
              Активен
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-amber-600 text-white ml-auto">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {bot.status}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Имя бота</span>
            <p className="font-medium">{bot.bot_name}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Username</span>
            <p className="font-medium">@{bot.bot_username}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Primary</span>
            <p className="font-medium">{bot.is_primary ? 'Да' : 'Нет'}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Обновлён</span>
            <p className="font-medium">
              {bot.updated_at 
                ? format(new Date(bot.updated_at), 'dd MMM HH:mm', { locale: ru })
                : '—'
              }
            </p>
          </div>
        </div>
        
        {bot.error_message && (
          <Alert variant="destructive" className="mt-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Ошибка: {bot.error_message}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
