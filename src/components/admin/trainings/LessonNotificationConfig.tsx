import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { 
  Bot, 
  Sparkles, 
  AlertTriangle, 
  ExternalLink,
  RefreshCw,
  MessageCircle,
  Users,
  Lock,
  Send,
  Loader2,
  Clock,
  Megaphone
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface NotificationConfig {
  enabled: boolean;
  botId: string | null;
  messageText: string;
  buttonText: string;
  buttonUrl: string;
  sendToClubMembers: boolean;
  sendOnPublish: boolean;
  audienceType: 'with_access' | 'all_users';
  sendTiming: 'now' | 'on_publish' | 'announcement';
}

interface LessonNotificationConfigProps {
  config: NotificationConfig;
  onChange: (config: NotificationConfig) => void;
  lessonTitle: string;
  lessonDescription?: string;
  lessonUrl?: string;
  selectedTariffIds?: string[];
  episodeNumber?: number;
  questions?: { title: string }[];
}

/**
 * Component for configuring Telegram notifications about lesson release
 */
export function LessonNotificationConfig({
  config,
  onChange,
  lessonTitle,
  lessonDescription,
  lessonUrl,
  selectedTariffIds = [],
  episodeNumber,
  questions = [],
}: LessonNotificationConfigProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  
  // Fetch available Telegram bots
  const { data: bots, isLoading: botsLoading } = useQuery({
    queryKey: ["telegram-bots-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_bots")
        .select("id, bot_username, bot_name, status")
        .in("status", ["ok", "active"])
        .order("bot_name");
      
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch clubs for selected bot
  const { data: clubs } = useQuery({
    queryKey: ["telegram-clubs-for-bot", config.botId],
    queryFn: async () => {
      if (!config.botId) return [];
      
      const { data, error } = await supabase
        .from("telegram_clubs")
        .select("id, club_name, members_count_chat")
        .eq("bot_id", config.botId)
        .eq("is_active", true);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!config.botId,
  });

  const totalMembers = clubs?.reduce((sum, c) => sum + (c.members_count_chat || 0), 0) || 0;

  // Generate AI message
  const generateMessage = async () => {
    setIsGenerating(true);
    
    try {
      const { data: session } = await supabase.auth.getSession();
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-lesson-notification`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.session?.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            lessonTitle: lessonTitle || `Выпуск №${episodeNumber}`,
            episodeNumber,
            questions: questions.filter(q => q.title.trim()),
            lessonUrl,
          }),
        }
      );

      if (response.ok) {
        const { messageText, buttonText } = await response.json();
        onChange({
          ...config,
          messageText: messageText || config.messageText,
          buttonText: buttonText || "Смотреть",
          buttonUrl: lessonUrl || "",
        });
        toast.success("Текст сгенерирован");
      } else {
        // Fallback
        const title = lessonTitle || `Выпуск №${episodeNumber}`;
        const message = `🎬 Новый выпуск уже доступен!\n\n📚 ${title}\n\nПереходите по ссылке, чтобы посмотреть 👇\n\nКатерина 🤍`;
        
        onChange({
          ...config,
          messageText: message,
          buttonText: "Смотреть",
          buttonUrl: lessonUrl || "",
        });
      }
    } catch (e) {
      console.error("Generate message error:", e);
      const title = lessonTitle || `Выпуск №${episodeNumber}`;
      const message = `🎬 Новый выпуск уже доступен!\n\n📚 ${title}\n\nПереходите по ссылке, чтобы посмотреть 👇\n\nКатерина 🤍`;
      
      onChange({
        ...config,
        messageText: message,
        buttonText: "Смотреть",
        buttonUrl: lessonUrl || "",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Send test message to current user
  const handleSendTest = async () => {
    if (!config.botId || !config.messageText) {
      toast.error("Выберите бота и введите текст сообщения");
      return;
    }
    
    setIsSendingTest(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-send-test`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.session?.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            botId: config.botId,
            messageText: config.messageText,
            buttonText: config.buttonText,
            buttonUrl: config.buttonUrl,
          }),
        }
      );

      const result = await response.json();
      
      if (response.ok) {
        toast.success("Тестовое сообщение отправлено в ваш Telegram");
      } else {
        toast.error(result.error || "Не удалось отправить тест");
        if (result.details) {
          console.error("Test send details:", result.details);
        }
      }
    } catch (e) {
      console.error("Test send error:", e);
      toast.error("Ошибка отправки теста");
    } finally {
      setIsSendingTest(false);
    }
  };

  // Auto-generate when first enabled
  useEffect(() => {
    if (config.enabled && !config.messageText && lessonTitle) {
      generateMessage();
    }
  }, [config.enabled, lessonTitle]);

  // Auto-select first bot if only one exists
  useEffect(() => {
    if (config.enabled && !config.botId && bots && bots.length > 0) {
      onChange({ ...config, botId: bots[0].id });
    }
  }, [config.enabled, bots]);

  const selectedBot = bots?.find(b => b.id === config.botId);

  return (
    <div className={cn(
      "space-y-4 rounded-xl border border-border/40 p-4",
      "backdrop-blur-xl bg-card/40 dark:bg-card/30",
      "shadow-sm"
    )}>
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          <Label className="font-medium">Уведомить подписчиков</Label>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(v) => onChange({ ...config, enabled: v })}
        />
      </div>

      {config.enabled && (
        <div className="space-y-4 animate-in fade-in-50 duration-200">
          {/* Bot selector */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Telegram-бот</Label>
            {botsLoading ? (
              <div className="h-9 bg-muted animate-pulse rounded-md" />
            ) : bots && bots.length > 0 ? (
              <Select
                value={config.botId || ""}
                onValueChange={(v) => onChange({ ...config, botId: v })}
              >
                <SelectTrigger>
                  <Bot className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder={bots.length === 1 ? (bots[0].bot_name || `@${bots[0].bot_username}`) : "Выберите бота"} />
                </SelectTrigger>
                <SelectContent>
                  {bots.map((bot) => (
                    <SelectItem key={bot.id} value={bot.id}>
                      {bot.bot_name || `@${bot.bot_username}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Alert className="border-amber-500/50 bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <AlertDescription className="text-sm">
                  Нет активных Telegram-ботов. 
                  <a href="/admin/integrations/telegram" className="underline ml-1">
                    Настроить
                  </a>
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Audience selector */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Кому отправить</Label>
            <RadioGroup
              value={config.audienceType || 'with_access'}
              onValueChange={(v) => onChange({ ...config, audienceType: v as 'with_access' | 'all_users' })}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="with_access" id="audience-access" />
                <Label htmlFor="audience-access" className="text-sm font-normal cursor-pointer">
                  Только с доступом
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="all_users" id="audience-all" />
                <Label htmlFor="audience-all" className="text-sm font-normal cursor-pointer">
                  Всем пользователям
                </Label>
              </div>
            </RadioGroup>
            {config.audienceType === 'all_users' && (
              <p className="text-xs text-muted-foreground">
                Для пользователей без доступа будет показана кнопка покупки
              </p>
            )}
          </div>

          {/* Audience info */}
          {selectedBot && totalMembers > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>
                Получат уведомление: <strong>{totalMembers}</strong> участников
              </span>
            </div>
          )}

          {/* Message text */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Текст сообщения</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={generateMessage}
                disabled={isGenerating}
                className="h-7 text-xs gap-1"
              >
                {isGenerating ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                Сгенерировать
              </Button>
            </div>
            <Textarea
              value={config.messageText}
              onChange={(e) => onChange({ ...config, messageText: e.target.value })}
              placeholder="Текст уведомления для подписчиков..."
              className="min-h-[100px] text-sm"
            />
          </div>

          {/* Button config */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Текст кнопки</Label>
              <Input
                value={config.buttonText}
                onChange={(e) => onChange({ ...config, buttonText: e.target.value })}
                placeholder="Смотреть"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Ссылка (URL)</Label>
              <div className="relative">
                <Input
                  value={config.buttonUrl}
                  onChange={(e) => onChange({ ...config, buttonUrl: e.target.value })}
                  placeholder="https://club.gorbova.by/..."
                  className="pr-8"
                />
                {config.buttonUrl && (
                  <a
                    href={config.buttonUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Send timing */}
          <div className="space-y-2 pt-2 border-t">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Когда отправить
            </Label>
            <RadioGroup
              value={config.sendTiming || 'on_publish'}
              onValueChange={(v) => onChange({ ...config, sendTiming: v as NotificationConfig['sendTiming'] })}
              className="space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="now" id="timing-now" />
                <Label htmlFor="timing-now" className="text-sm font-normal cursor-pointer">
                  Сразу после создания урока
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="on_publish" id="timing-publish" />
                <Label htmlFor="timing-publish" className="text-sm font-normal cursor-pointer">
                  При открытии доступа к уроку
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="announcement" id="timing-announce" />
                <Label htmlFor="timing-announce" className="text-sm font-normal cursor-pointer flex items-center gap-1">
                  <Megaphone className="h-3 w-3" />
                  Анонс (сообщить заранее о дате выхода)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Test send button */}
          <div className="flex items-center justify-between pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              💡 Проверьте сообщение перед отправкой
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSendTest}
              disabled={isSendingTest || !config.messageText || !config.botId}
              className="gap-1.5 h-8"
            >
              {isSendingTest ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Тест себе
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Default notification config
 */
export const defaultNotificationConfig: NotificationConfig = {
  enabled: false,
  botId: null,
  messageText: "",
  buttonText: "Смотреть",
  buttonUrl: "",
  sendToClubMembers: true,
  sendOnPublish: true,
  audienceType: 'with_access',
  sendTiming: 'on_publish',
};
