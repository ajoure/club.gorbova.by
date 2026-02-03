import { useState, useMemo, useEffect } from "react";
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
import { 
  Send, 
  Bot, 
  Sparkles, 
  AlertTriangle, 
  ExternalLink,
  RefreshCw,
  MessageCircle,
  Users,
  Lock 
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface NotificationConfig {
  enabled: boolean;
  botId: string | null;
  messageText: string;
  buttonText: string;
  buttonUrl: string;
  sendToClubMembers: boolean;
  sendOnPublish: boolean; // Send when published_at is reached
}

interface LessonNotificationConfigProps {
  config: NotificationConfig;
  onChange: (config: NotificationConfig) => void;
  lessonTitle: string;
  lessonDescription?: string;
  lessonUrl?: string;
  selectedTariffIds?: string[];  // Which tariffs have access
}

/**
 * Component for configuring Telegram notifications about lesson release
 * Auto-generates message text from lesson title/description
 */
export function LessonNotificationConfig({
  config,
  onChange,
  lessonTitle,
  lessonDescription,
  lessonUrl,
  selectedTariffIds = [],
}: LessonNotificationConfigProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Fetch available Telegram bots
  const { data: bots, isLoading: botsLoading } = useQuery({
    queryKey: ["telegram-bots-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_bots")
        .select("id, bot_username, bot_name, status")
        .eq("status", "ok")
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

  // Calculate total members to notify
  const totalMembers = clubs?.reduce((sum, c) => sum + (c.members_count_chat || 0), 0) || 0;

  // Generate AI message based on lesson content
  const generateMessage = async () => {
    setIsGenerating(true);
    
    try {
      // Simple template-based generation (can be replaced with AI later)
      const title = lessonTitle || "новый урок";
      const desc = lessonDescription || "";
      
      // Create engaging message
      let message = `🎬 Новый выпуск уже доступен!\n\n`;
      message += `📚 ${title}\n\n`;
      
      if (desc) {
        message += `${desc.slice(0, 200)}${desc.length > 200 ? '...' : ''}\n\n`;
      }
      
      message += `Переходите по ссылке, чтобы посмотреть 👇`;
      
      const buttonText = "Смотреть";
      
      onChange({
        ...config,
        messageText: message,
        buttonText,
        buttonUrl: lessonUrl || "",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto-generate when first enabled or lesson title changes
  useEffect(() => {
    if (config.enabled && !config.messageText && lessonTitle) {
      generateMessage();
    }
  }, [config.enabled, lessonTitle]);

  // Auto-select first bot if none selected
  useEffect(() => {
    if (config.enabled && !config.botId && bots && bots.length > 0) {
      onChange({ ...config, botId: bots[0].id });
    }
  }, [config.enabled, bots]);

  const selectedBot = bots?.find(b => b.id === config.botId);

  return (
    <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
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
                  <SelectValue placeholder="Выберите бота" />
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

          {/* Audience info */}
          {selectedBot && totalMembers > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>
                Получат уведомление: <strong>{totalMembers}</strong> участников
              </span>
            </div>
          )}

          {/* Access restriction warning */}
          {selectedTariffIds.length > 0 && (
            <Alert className="border-primary/30 bg-primary/5">
              <Lock className="h-4 w-4 text-primary" />
              <AlertDescription className="text-sm">
                Уведомление получат только участники с доступом. Остальные увидят кнопку покупки.
              </AlertDescription>
            </Alert>
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
                  placeholder="https://..."
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
          <div className="flex items-center gap-3 pt-2 border-t">
            <Switch
              id="send-on-publish"
              checked={config.sendOnPublish}
              onCheckedChange={(v) => onChange({ ...config, sendOnPublish: v })}
            />
            <Label htmlFor="send-on-publish" className="text-sm font-normal cursor-pointer">
              Отправить автоматически при публикации урока
            </Label>
          </div>

          {/* Preview hint */}
          <p className="text-xs text-muted-foreground">
            💡 Сообщение будет отправлено участникам клуба через выбранного бота.
            {!config.sendOnPublish && " Отправка произойдёт после создания урока."}
          </p>
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
};
