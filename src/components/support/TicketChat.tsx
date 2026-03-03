import { useState, useEffect, useRef, useMemo } from "react";
import { Send, Loader2, Plus, Image as ImageIcon, Video, Music, Circle, FileText, UserCircle, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TicketMessage } from "./TicketMessage";
import { useTicketMessages, useSendMessage, useMarkTicketRead, useEditTicketMessage, useDeleteTicketMessage } from "@/hooks/useTickets";
import { useDisplayProfiles } from "@/hooks/useDisplayProfiles";
import type { TicketAttachment } from "@/hooks/useTickets";
import { useTicketReactions, useToggleReaction } from "@/hooks/useTicketReactions";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { OutboundMediaPreview } from "@/components/admin/chat/OutboundMediaPreview";
import { VideoNoteRecorder } from "@/components/admin/VideoNoteRecorder";
import { VoiceRecorder } from "@/components/support/VoiceRecorder";
import { useQuery } from "@tanstack/react-query";

type MediaFileType = "photo" | "video" | "audio" | "video_note" | "voice" | "document";

interface TicketChatProps {
  ticketId: string;
  isAdmin?: boolean;
  isClosed?: boolean;
  telegramUserId?: number | null;
  telegramBridgeEnabled?: boolean;
  telegramMode?: "bridge" | "notify";
  onBridgeMessage?: (ticketMessageId: string) => void;
}

// match storage bucket limit for ticket-attachments
const MAX_TICKET_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export function TicketChat({ ticketId, isAdmin, isClosed, telegramUserId, telegramBridgeEnabled, telegramMode = "bridge", onBridgeMessage }: TicketChatProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sendToTelegram, setSendToTelegram] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [selectedFileType, setSelectedFileType] = useState<MediaFileType | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showVideoNoteRecorder, setShowVideoNoteRecorder] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const [sendAsUserId, setSendAsUserId] = useState<string>("self");
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load admin/support users for "Send as" dropdown
  const { data: supportSenders } = useQuery({
    queryKey: ["support-senders"],
    queryFn: async () => {
      // Get users with admin/support roles via user_roles_v2 + roles
      const { data: roleUsers } = await supabase
        .from("user_roles_v2")
        .select("user_id, roles(code)")
        .in("role_id", 
          (await supabase.from("roles").select("id").in("code", ["super_admin", "admin", "support"])).data?.map(r => r.id) || []
        );

      if (!roleUsers || roleUsers.length === 0) return [];

      const userIds = [...new Set(roleUsers.map(r => r.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      return (profiles || []).filter(p => p.full_name).map(p => ({
        user_id: p.user_id,
        full_name: p.full_name!,
      }));
    },
    enabled: !!isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const { data: messages, isLoading } = useTicketMessages(ticketId, isAdmin);

  // Defense-in-depth: redundant render-level filter for non-admin views
  const visibleMessages = isAdmin ? messages : messages?.filter(m => !m.is_internal);

  // Collect unique display_user_ids for avatar resolution
  const displayUserIds = useMemo(() => {
    const ids = new Set<string>();
    visibleMessages?.forEach(m => {
      if (m.display_user_id) ids.add(m.display_user_id);
    });
    return [...ids];
  }, [visibleMessages]);

  const { data: displayProfilesMap } = useDisplayProfiles(displayUserIds);
  
  // Reactions
  const messageIds = useMemo(
    () => visibleMessages?.map((m) => m.id) || [],
    [visibleMessages]
  );
  const { data: reactionsMap } = useTicketReactions(ticketId, messageIds);
  const toggleReaction = useToggleReaction(ticketId);

  const sendMessageMutation = useSendMessage();
  const markRead = useMarkTicketRead();
  const editMessage = useEditTicketMessage();
  const deleteMessage = useDeleteTicketMessage();

  // Mark ticket as read when opened
  useEffect(() => {
    if (ticketId) {
      markRead.mutate({ ticketId, isAdmin: !!isAdmin });
    }
  }, [ticketId, isAdmin]);

  // Scroll to bottom on new messages (only if user is near bottom)
  const AUTOSCROLL_THRESHOLD_PX = 120;
  const lastId = visibleMessages?.at(-1)?.id ?? '';

  useEffect(() => {
    if (!scrollEndRef.current) return;
    const root = scrollEndRef.current.closest('[data-radix-scroll-area-root]') as HTMLElement | null;
    const viewport = root?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (viewport) {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < AUTOSCROLL_THRESHOLD_PX;
      if (isNearBottom) {
        scrollEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
      }
    } else {
      // Fallback: first render, always scroll
      scrollEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [visibleMessages?.length, lastId]);

  // Show TG checkbox only for admin when user has telegram and bridge is on
  const canBridgeToTelegram = isAdmin && telegramBridgeEnabled && telegramUserId;

  // Auto-enable sendToTelegram when bridge is available
  useEffect(() => {
    if (canBridgeToTelegram) {
      setSendToTelegram(true);
    }
  }, [canBridgeToTelegram]);

  // Voice preview URL lifecycle (cleanup revokes previous URL automatically)
  useEffect(() => {
    if (!attachedFile || selectedFileType !== "voice") {
      setVoicePreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(attachedFile);
    setVoicePreviewUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [attachedFile, selectedFileType]);

  const handleMediaMenuSelect = (type: MediaFileType) => {
    if (type === "video_note") {
      setShowVideoNoteRecorder(true);
      return;
    }

    // Set accept dynamically based on type
    if (fileInputRef.current) {
      switch (type) {
        case "photo":
          fileInputRef.current.accept = "image/*";
          break;
        case "video":
          fileInputRef.current.accept = "video/*";
          break;
        case "audio":
          fileInputRef.current.accept = "audio/*";
          break;
        case "document":
          fileInputRef.current.accept = "*/*";
          break;
      }
      setSelectedFileType(type);
      fileInputRef.current.click();
    }
  };

  const detectFileType = (file: File): MediaFileType => {
    if (file.type.startsWith("image/")) return "photo";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    return "document";
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_TICKET_ATTACHMENT_BYTES) {
      toast({
        title: "Файл слишком большой",
        description: `Максимальный размер: ${MAX_TICKET_ATTACHMENT_BYTES / 1024 / 1024} МБ`,
        variant: "destructive",
      });
      return;
    }
    setAttachedFile(file);
    // Auto-detect type if not explicitly set (fallback)
    if (!selectedFileType) {
      setSelectedFileType(detectFileType(file));
    }
    // Reset input so same file can be re-selected
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.accept = "*/*"; // Reset accept
    }
  };

  const handleVideoNoteRecorded = (file: File) => {
    setAttachedFile(file);
    setSelectedFileType("video_note");
    setShowVideoNoteRecorder(false);
  };

  const handleVoiceRecorded = (file: File) => {
    setAttachedFile(file);
    setSelectedFileType("voice");
    setSendToTelegram(false); // voice не отправляется в TG
    setShowVoiceRecorder(false);
  };

  const handleRemoveFile = () => {
    setAttachedFile(null);
    setSelectedFileType(null);
  };

  const handleSend = async () => {
    if (!message.trim() && !attachedFile) return;

    let attachments: TicketAttachment[] = [];

    // Upload file if attached
    if (attachedFile) {
      setIsUploading(true);
      try {
        const sanitizedName = attachedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${ticketId}/${crypto.randomUUID()}-${sanitizedName}`;
        const { error: uploadError } = await supabase.storage
          .from("ticket-attachments")
          .upload(path, attachedFile);

        if (uploadError) throw uploadError;

        attachments = [{
          bucket: "ticket-attachments",
          path,
          file_name: attachedFile.name,
          size: attachedFile.size,
          mime: attachedFile.type || "application/octet-stream",
          kind: selectedFileType || detectFileType(attachedFile),
        }];
      } catch (err: any) {
        toast({
          title: "Ошибка загрузки файла",
          description: err?.message || "Не удалось загрузить файл",
          variant: "destructive",
        });
        setIsUploading(false);
        return;
      }
      setIsUploading(false);
    }

    // Resolve "send as" display name
    const selectedSender = sendAsUserId !== "self" && supportSenders
      ? supportSenders.find(s => s.user_id === sendAsUserId)
      : null;

    const displayUserId = sendAsUserId !== "self" && selectedSender
      ? selectedSender.user_id
      : null;

    const result = await sendMessageMutation.mutateAsync({
      ticket_id: ticketId,
      message: message.trim(),
      author_type: isAdmin ? "support" : "user",
      is_internal: isAdmin ? isInternal : false,
      attachments: attachments.length > 0 ? attachments : undefined,
      author_name_override: selectedSender?.full_name || undefined,
      display_user_id: displayUserId,
    });

    // Bridge to Telegram if checkbox checked & not internal
    // Voice не бриджится в Telegram
    const isVoice = selectedFileType === "voice";
    if (!isVoice && canBridgeToTelegram && sendToTelegram && !isInternal && result?.id && onBridgeMessage) {
      onBridgeMessage(result.id);
    }

    setMessage("");
    setAttachedFile(null);
    setSelectedFileType(null);
    setIsInternal(false);
    setShowVoiceRecorder(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 p-4 overflow-x-hidden">
        {visibleMessages?.map((msg) => (
          <TicketMessage
            key={msg.id}
            message={msg}
            isCurrentUser={msg.author_id === user?.id && !isAdmin}
            isAdmin={isAdmin}
            reactions={reactionsMap?.[msg.id]}
            onToggleReaction={(emoji) =>
              toggleReaction.mutate({ messageId: msg.id, emoji })
            }
            onEditMessage={isAdmin ? (messageId, newText) => editMessage.mutate({ messageId, ticketId, newText }) : undefined}
            onDeleteMessage={isAdmin ? (messageId) => deleteMessage.mutate({ messageId, ticketId }) : undefined}
            displayAvatarUrl={
              msg.display_user_id
                ? displayProfilesMap?.get(msg.display_user_id)?.avatar_url ?? null
                : null
            }
          />
        ))}
        {visibleMessages?.length === 0 && (
          <p className="text-center text-muted-foreground text-sm py-8">
            Пока нет сообщений
          </p>
        )}
        <div ref={scrollEndRef} />
      </ScrollArea>

      {!isClosed && (
        <div className="border-t p-4">
          {isAdmin && (
            <div className="flex items-center gap-4 mb-2 flex-wrap">
              {/* "Send as" dropdown */}
              {supportSenders && supportSenders.length > 1 && (
                <div className="flex items-center gap-1.5">
                  <UserCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select value={sendAsUserId} onValueChange={setSendAsUserId}>
                    <SelectTrigger className="h-7 w-auto min-w-[120px] text-xs border-dashed">
                      <SelectValue placeholder="От имени" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="self" className="text-xs">Я (по умолчанию)</SelectItem>
                      {supportSenders.map((s) => (
                        <SelectItem key={s.user_id} value={s.user_id} className="text-xs">
                          {s.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="internal"
                  checked={isInternal}
                  onCheckedChange={(checked) => {
                    setIsInternal(checked as boolean);
                    if (checked) setSendToTelegram(false);
                  }}
                />
                <Label htmlFor="internal" className="text-sm text-muted-foreground">
                  Внутренняя заметка
                </Label>
              </div>
              {canBridgeToTelegram && !isInternal && selectedFileType !== "voice" && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="send-telegram"
                    checked={sendToTelegram}
                    onCheckedChange={(checked) => setSendToTelegram(checked as boolean)}
                  />
                  <Label htmlFor="send-telegram" className="text-sm text-muted-foreground">
                    {telegramMode === "notify" ? "Уведомить в Telegram" : "Отправить в Telegram"}
                  </Label>
                </div>
              )}
            </div>
          )}

          {/* Attached file preview */}
          {attachedFile && selectedFileType === "voice" ? (
            <div className="rounded-lg border bg-muted/30 p-3 flex items-center gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                    Голосовое
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {attachedFile.name} • {(attachedFile.size / 1024).toFixed(0)} КБ
                  </span>
                </div>
                {voicePreviewUrl ? (
                  <audio controls src={voicePreviewUrl} className="w-full" />
                ) : (
                  <div className="text-xs text-muted-foreground">Готовлю превью…</div>
                )}
              </div>
              <button
                type="button"
                onClick={handleRemoveFile}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Удалить вложение"
                title="Удалить"
              >
                ✕
              </button>
            </div>
          ) : attachedFile ? (
            <OutboundMediaPreview
              file={attachedFile}
              fileType={selectedFileType === "voice" ? "document" : selectedFileType}
              isUploading={isUploading}
              onRemove={handleRemoveFile}
            />
          ) : null}

          <div className="flex gap-2 items-end">
            {/* Media menu (like contact center) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 flex-shrink-0"
                  type="button"
                  disabled={!!attachedFile || isUploading}
                >
                  <Plus className="h-5 w-5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                <DropdownMenuItem onClick={() => handleMediaMenuSelect("photo")}>
                  <ImageIcon className="h-4 w-4 mr-2" />
                  Фото
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleMediaMenuSelect("video")}>
                  <Video className="h-4 w-4 mr-2" />
                  Видео
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleMediaMenuSelect("video_note")}>
                  <Circle className="h-4 w-4 mr-2" />
                  Записать кружок
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleMediaMenuSelect("audio")}>
                  <Music className="h-4 w-4 mr-2" />
                  Аудио
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleMediaMenuSelect("document")}>
                  <FileText className="h-4 w-4 mr-2" />
                  Документ
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowVoiceRecorder(true)}>
                  <Mic className="h-4 w-4 mr-2" />
                  Записать голосовое
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="*/*"
              onChange={handleFileSelect}
            />

            <div className="flex-1">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isInternal ? "Внутренняя заметка..." : "Введите сообщение..."}
                className="min-h-[80px] resize-none"
              />
            </div>

            <Button
              onClick={handleSend}
              disabled={(!message.trim() && !attachedFile) || sendMessageMutation.isPending || isUploading}
              size="icon"
              className="h-[80px] w-12 flex-shrink-0"
            >
              {(sendMessageMutation.isPending || isUploading) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {isClosed && (
        <div className="border-t p-4 bg-muted">
          <p className="text-center text-sm text-muted-foreground">
            Обращение закрыто. Создайте новое обращение, если у вас есть вопросы.
          </p>
        </div>
      )}

      {/* Video Note Recorder */}
      <VideoNoteRecorder
        open={showVideoNoteRecorder}
        onOpenChange={setShowVideoNoteRecorder}
        onRecorded={handleVideoNoteRecorded}
      />

      {/* Voice Recorder */}
      <VoiceRecorder
        open={showVoiceRecorder}
        onOpenChange={setShowVoiceRecorder}
        onRecorded={handleVoiceRecorded}
      />
    </div>
  );
}
