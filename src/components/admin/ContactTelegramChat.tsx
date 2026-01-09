import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Send,
  MessageCircle,
  Bot,
  User,
  AlertCircle,
  CheckCircle,
  Clock,
  RefreshCw,
  Paperclip,
  Smile,
  Image as ImageIcon,
  FileText,
  X,
  Key,
  UserPlus,
  UserMinus,
  Link,
  Unlink,
  Bell,
} from "lucide-react";
import { toast } from "sonner";

interface ContactTelegramChatProps {
  userId: string;
  telegramUserId: number | null;
  telegramUsername: string | null;
  clientName?: string | null;
  avatarUrl?: string | null;
  onAvatarUpdated?: (url: string) => void;
}

interface TelegramMessage {
  id: string;
  type: "message";
  direction: "outgoing" | "incoming";
  message_text: string | null;
  status: string;
  created_at: string;
  sent_by_admin?: string | null;
  meta?: {
    file_type?: string | null;
    file_name?: string | null;
    [key: string]: unknown;
  } | null;
}

interface TelegramEvent {
  id: string;
  type: "event";
  action: string;
  status: string;
  created_at: string;
  meta?: Record<string, unknown> | null;
}

type ChatItem = TelegramMessage | TelegramEvent;

const EMOJI_LIST = [
  "😀", "😃", "😄", "😁", "😅", "😂", "🤣", "😊", "😇", "🙂",
  "😉", "😌", "😍", "🥰", "😘", "😋", "😛", "😜", "🤪", "😎",
  "🤗", "🤔", "🤐", "😐", "😑", "😶", "😏", "😒", "🙄", "😬",
  "👍", "👎", "👌", "✌️", "🤞", "🤝", "👏", "🙏", "💪", "❤️",
  "🔥", "⭐", "✨", "💯", "✅", "❌", "⚠️", "📌", "📎", "💼",
];

const EVENT_ICONS: Record<string, React.ReactNode> = {
  LINK_SUCCESS: <Link className="w-3 h-3 text-green-500" />,
  RELINK_SUCCESS: <Link className="w-3 h-3 text-blue-500" />,
  UNLINK: <Unlink className="w-3 h-3 text-orange-500" />,
  AUTO_GRANT: <Key className="w-3 h-3 text-green-500" />,
  MANUAL_GRANT: <Key className="w-3 h-3 text-green-500" />,
  MANUAL_EXTEND: <Key className="w-3 h-3 text-blue-500" />,
  AUTO_REVOKE: <UserMinus className="w-3 h-3 text-red-500" />,
  MANUAL_REVOKE: <UserMinus className="w-3 h-3 text-red-500" />,
  AUTO_KICK_VIOLATOR: <UserMinus className="w-3 h-3 text-red-500" />,
  manual_notification: <Bell className="w-3 h-3 text-blue-500" />,
  ADMIN_CHAT_MESSAGE: <MessageCircle className="w-3 h-3 text-primary" />,
  ADMIN_CHAT_FILE: <Paperclip className="w-3 h-3 text-primary" />,
};

const EVENT_LABELS: Record<string, string> = {
  LINK_SUCCESS: "Привязал Telegram",
  RELINK_SUCCESS: "Перепривязал Telegram",
  UNLINK: "Отвязал Telegram",
  AUTO_GRANT: "Автоматическая выдача доступа",
  MANUAL_GRANT: "Ручная выдача доступа",
  MANUAL_EXTEND: "Продление доступа",
  AUTO_REVOKE: "Автоматический отзыв доступа",
  MANUAL_REVOKE: "Ручной отзыв доступа",
  AUTO_KICK_VIOLATOR: "Исключён из группы",
  manual_notification: "Уведомление отправлено",
};

export function ContactTelegramChat({
  userId,
  telegramUserId,
  telegramUsername,
  clientName,
  avatarUrl,
  onAvatarUpdated,
}: ContactTelegramChatProps) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch messages - optimized with shorter stale time
  const { data: messages, isLoading: messagesLoading, refetch: refetchMessages } = useQuery({
    queryKey: ["telegram-messages", userId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: { action: "get_messages", user_id: userId, limit: 50 },
      });
      if (error) throw error;
      return (data.messages || []).map((m: any) => ({ ...m, type: "message" })) as TelegramMessage[];
    },
    enabled: !!userId,
    staleTime: 10000,
    refetchOnWindowFocus: false,
  });

  // Fetch events from telegram_logs - optimized
  const { data: events, isLoading: eventsLoading, refetch: refetchEvents } = useQuery({
    queryKey: ["telegram-events", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_logs")
        .select("id, action, status, created_at, meta")
        .eq("user_id", userId)
        .not("action", "in", "(ADMIN_CHAT_MESSAGE,ADMIN_CHAT_FILE)")
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data || []).map((e: any) => ({ ...e, type: "event" })) as TelegramEvent[];
    },
    enabled: !!userId,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  // Combine and sort messages + events
  const chatItems: ChatItem[] = [...(messages || []), ...(events || [])]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const isLoading = messagesLoading || eventsLoading;

  const refetch = useCallback(() => {
    refetchMessages();
    refetchEvents();
  }, [refetchMessages, refetchEvents]);

  // Fetch profile photo from Telegram
  const fetchPhotoMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: { action: "fetch_profile_photo", user_id: userId },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Failed to fetch photo");
      return data.avatar_url;
    },
    onSuccess: (newAvatarUrl) => {
      if (newAvatarUrl && onAvatarUpdated) {
        onAvatarUpdated(newAvatarUrl);
      }
      queryClient.invalidateQueries({ queryKey: ["inbox-dialogs"] });
      toast.success("Фото профиля обновлено");
    },
    onError: (error) => {
      toast.error("Ошибка загрузки фото: " + (error as Error).message);
    },
  });

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async ({ text, file }: { text?: string; file?: File }) => {
      let fileData: { type: string; name: string; base64: string } | undefined;
      
      if (file) {
        setIsUploading(true);
        const buffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        
        let type = "document";
        if (file.type.startsWith("image/")) type = "photo";
        else if (file.type.startsWith("video/")) type = "video";
        else if (file.type.startsWith("audio/")) type = "audio";
        
        fileData = { type, name: file.name, base64 };
      }

      const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: { 
          action: "send_message", 
          user_id: userId, 
          message: text || "",
          file: fileData,
        },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Failed to send message");
      return data;
    },
    onMutate: () => {
      // Optimistically add message to UI immediately
      const tempMessage: TelegramMessage = {
        id: `temp-${Date.now()}`,
        type: "message",
        direction: "outgoing",
        message_text: message.trim() || (selectedFile ? `📎 ${selectedFile.name}` : null),
        status: "pending",
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData(["telegram-messages", userId], (old: TelegramMessage[] | undefined) => 
        [...(old || []), tempMessage]
      );
    },
    onSuccess: () => {
      setMessage("");
      setSelectedFile(null);
      setIsUploading(false);
      refetch();
    },
    onError: (error) => {
      setIsUploading(false);
      toast.error("Ошибка отправки: " + (error as Error).message);
    },
  });

  // Scroll to bottom when items change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatItems]);

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed && !selectedFile) return;
    sendMutation.mutate({ text: trimmed, file: selectedFile || undefined });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        toast.error("Файл слишком большой (макс. 20 МБ)");
        return;
      }
      setSelectedFile(file);
    }
  };

  const insertEmoji = (emoji: string) => {
    setMessage(prev => prev + emoji);
  };

  const getFileIcon = (fileType: string | null) => {
    if (fileType === "photo") return <ImageIcon className="w-4 h-4" />;
    return <FileText className="w-4 h-4" />;
  };

  if (!telegramUserId) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center text-muted-foreground">
          <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Telegram не привязан</p>
          <p className="text-sm mt-1">Клиент должен привязать свой Telegram аккаунт</p>
        </CardContent>
      </Card>
    );
  }

  const renderChatItem = (item: ChatItem) => {
    if (item.type === "event") {
      const event = item as TelegramEvent;
      return (
        <div key={event.id} className="flex justify-center my-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-xs text-muted-foreground">
            {EVENT_ICONS[event.action] || <Bell className="w-3 h-3" />}
            <span>{EVENT_LABELS[event.action] || event.action}</span>
            <span className="opacity-60">
              {format(new Date(event.created_at), "dd.MM HH:mm", { locale: ru })}
            </span>
          </div>
        </div>
      );
    }

    const msg = item as TelegramMessage;
    const fileType = msg.meta?.file_type as string | null;
    const fileName = msg.meta?.file_name as string | null;

    return (
      <div
        key={msg.id}
        className={`flex ${msg.direction === "outgoing" ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`max-w-[80%] rounded-lg p-3 ${
            msg.direction === "outgoing"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
        >
          <div className="flex items-center gap-1 mb-1">
            {msg.direction === "outgoing" ? (
              <Bot className="w-3 h-3" />
            ) : (
              <User className="w-3 h-3" />
            )}
            <span className="text-xs opacity-70">
              {msg.direction === "outgoing" ? "Вы" : (clientName || "Клиент")}
            </span>
          </div>
          
          {fileType && (
            <div className="flex items-center gap-2 mb-2 p-2 rounded bg-background/20">
              {getFileIcon(fileType)}
              <span className="text-xs truncate">{fileName || "Файл"}</span>
            </div>
          )}
          
          {msg.message_text && (
            <p className="text-sm whitespace-pre-wrap break-words">{msg.message_text}</p>
          )}
          
          <div className="flex items-center justify-end gap-1 mt-1">
            <span className="text-xs opacity-60">
              {format(new Date(msg.created_at), "HH:mm", { locale: ru })}
            </span>
            {msg.direction === "outgoing" && (
              <>
                {msg.status === "sent" && <CheckCircle className="w-3 h-3 opacity-60" />}
                {msg.status === "failed" && <AlertCircle className="w-3 h-3 text-destructive" />}
                {msg.status === "pending" && <Clock className="w-3 h-3 opacity-60" />}
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header - removed as parent already has header, keeping only refresh */}
      <div className="flex items-center justify-end pb-2 border-b">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchPhotoMutation.mutate()}
            disabled={fetchPhotoMutation.isPending}
            className="h-8 px-2 text-xs"
            title="Загрузить фото из Telegram"
          >
            {fetchPhotoMutation.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <ImageIcon className="w-4 h-4" />
            )}
            <span className="ml-1 hidden sm:inline">Фото TG</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={refetch}
            className="h-8 w-8 p-0"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Messages + Events */}
      <ScrollArea className="flex-1 py-3" ref={scrollRef}>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-3/4" />
            ))}
          </div>
        ) : !chatItems?.length ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Bot className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Нет сообщений</p>
              <p className="text-xs">Начните диалог, отправив сообщение</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 pr-4">
            {chatItems.map(renderChatItem)}
          </div>
        )}
      </ScrollArea>

      {/* Selected file preview */}
      {selectedFile && (
        <div className="flex items-center gap-2 px-2 py-1 bg-muted rounded-md mb-2">
          <Paperclip className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm truncate flex-1">{selectedFile.name}</span>
          <span className="text-xs text-muted-foreground">
            {(selectedFile.size / 1024).toFixed(0)} KB
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedFile(null)}
            className="h-6 w-6 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Input */}
      <div className="pt-3 border-t">
        <div className="flex gap-2">
          <div className="flex flex-col gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Smile className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <div className="grid grid-cols-10 gap-1">
                  {EMOJI_LIST.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => insertEmoji(emoji)}
                      className="w-6 h-6 text-center hover:bg-muted rounded transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 w-8 p-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="w-4 h-4" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.rar"
            />
          </div>
          
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Введите сообщение..."
            className="min-h-[60px] max-h-[120px] resize-none flex-1"
            disabled={sendMutation.isPending || isUploading}
          />
          <Button
            onClick={handleSend}
            disabled={(!message.trim() && !selectedFile) || sendMutation.isPending || isUploading}
            className="h-auto"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Enter для отправки, Shift+Enter для новой строки
        </p>
      </div>
    </div>
  );
}