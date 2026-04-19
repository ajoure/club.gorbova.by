import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Paperclip,
  Send,
  X,
  Loader2,
  Image as ImageIcon,
  Video,
  FileText,
  MicOff,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Outbound media контракт ManyChat (подтверждено пилотом):
 *  - image: ✅ signed URL из telegram-media (TTL 24h)
 *  - video: ✅
 *  - file:  ✅
 *  - audio: ❌ provider/API limitation for outbound audio
 *
 * Поэтому в композере audio запрещён на UI-уровне.
 */

type AttachKind = "image" | "video" | "file";

interface PendingAttachment {
  file: File;
  kind: AttachKind;
  previewUrl?: string;
}

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB safety cap

function detectKind(file: File): AttachKind | "audio" | "unknown" {
  const m = file.type.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (
    m === "application/pdf" ||
    m.startsWith("application/") ||
    m === "text/plain"
  ) {
    return "file";
  }
  return "unknown";
}

interface Props {
  accountId: string;
  senderId: string;
  threadId: string | null;
  /** Текущее текстовое значение */
  text: string;
  onTextChange: (v: string) => void;
  /** Отправка чисто текстового сообщения (без вложения) — делегируем родителю. */
  onSendText: () => Promise<void> | void;
  sending: boolean;
  /** Колбэк после успешной отправки media (для invalidate). */
  onMediaSent?: () => void;
}

export function InstagramAttachComposer({
  accountId,
  senderId,
  threadId,
  text,
  onTextChange,
  onSendText,
  sending,
  onMediaSent,
}: Props) {
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Чистим object URL preview при размонтировании / смене файла
  useEffect(() => {
    return () => {
      if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    };
  }, [pending?.previewUrl]);

  const acceptFile = useCallback((file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error("Файл больше 25 МБ — слишком большой для отправки.");
      return;
    }
    const kind = detectKind(file);
    if (kind === "audio") {
      toast.error(
        "Outbound audio не поддерживается провайдером (Meta/ManyChat). Аудио можно только принимать.",
      );
      return;
    }
    if (kind === "unknown") {
      toast.error("Неподдерживаемый тип файла.");
      return;
    }
    const previewUrl =
      kind === "image" || kind === "video"
        ? URL.createObjectURL(file)
        : undefined;
    setPending((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return { file, kind, previewUrl };
    });
  }, []);

  const onPickClick = () => fileInputRef.current?.click();

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) acceptFile(f);
    // сбрасываем, чтобы можно было выбрать тот же файл повторно
    e.target.value = "";
  };

  // Drag & drop
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types?.includes("Files")) setIsDragging(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) acceptFile(f);
  };

  const removePending = () => {
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
  };

  const uploadAndSend = async () => {
    if (!pending || uploading || sending) return;
    setUploading(true);
    try {
      const safeName = pending.file.name.replace(/[^\w.\-]+/g, "_");
      const path = `instagram-outbound/${accountId}/${Date.now()}_${crypto
        .randomUUID()
        .slice(0, 8)}_${safeName}`;

      const { error: upErr } = await supabase.storage
        .from("telegram-media")
        .upload(path, pending.file, {
          cacheControl: "3600",
          upsert: false,
          contentType: pending.file.type || undefined,
        });
      if (upErr) {
        toast.error("Загрузка не удалась: " + upErr.message);
        return;
      }

      const { data: signed, error: signErr } = await supabase.storage
        .from("telegram-media")
        .createSignedUrl(path, 60 * 60 * 24); // 24h
      if (signErr || !signed?.signedUrl) {
        toast.error("Не удалось получить signed URL.");
        return;
      }

      const clientMsgId = crypto.randomUUID();
      const { data, error } = await supabase.functions.invoke(
        "instagram-admin-chat",
        {
          body: {
            action: "send_reply",
            instagram_account_id: accountId,
            sender_id: senderId,
            thread_id: threadId,
            message_text: text.trim() || null,
            media_url: signed.signedUrl,
            media_type: pending.kind, // 'image' | 'video' | 'file'
            client_msg_id: clientMsgId,
          },
        },
      );

      if (error) {
        toast.error("Ошибка отправки: " + error.message);
        return;
      }
      if (data?.ok === false) {
        toast.error(data.error || "Не доставлено");
        return;
      }

      // success
      onTextChange("");
      removePending();
      onMediaSent?.();
    } catch (e: any) {
      toast.error("Ошибка: " + (e?.message ?? String(e)));
    } finally {
      setUploading(false);
    }
  };

  const KindIcon =
    pending?.kind === "image"
      ? ImageIcon
      : pending?.kind === "video"
        ? Video
        : FileText;

  return (
    <div
      ref={dropRef}
      className={cn(
        "relative rounded-md transition-colors",
        isDragging && "ring-2 ring-primary/50 bg-primary/5",
      )}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none rounded-md bg-primary/10 border-2 border-dashed border-primary/40">
          <p className="text-sm font-medium text-primary">
            Отпустите файл, чтобы прикрепить
          </p>
        </div>
      )}

      {/* Pending attachment preview */}
      {pending && (
        <div className="mb-2 flex items-center gap-2 p-2 rounded-md border border-border/40 bg-muted/40">
          {pending.kind === "image" && pending.previewUrl ? (
            <img
              src={pending.previewUrl}
              alt="preview"
              className="h-12 w-12 rounded object-cover"
            />
          ) : pending.kind === "video" && pending.previewUrl ? (
            <video
              src={pending.previewUrl}
              className="h-12 w-12 rounded object-cover bg-black"
              muted
            />
          ) : (
            <div className="h-12 w-12 rounded bg-background flex items-center justify-center">
              <KindIcon className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{pending.file.name}</p>
            <p className="text-[10px] text-muted-foreground">
              {(pending.file.size / 1024).toFixed(0)} КБ · {pending.kind}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={removePending}
            disabled={uploading}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) {
            void uploadAndSend();
          } else {
            void onSendText();
          }
        }}
        className="flex items-center gap-2"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,application/pdf,application/*,text/plain"
          className="hidden"
          onChange={onFileInputChange}
        />
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={onPickClick}
                disabled={sending || uploading}
                aria-label="Прикрепить файл"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Прикрепить изображение, видео или файл
            </TooltipContent>
          </Tooltip>

          {/* Audio explicitly disabled — provider limitation */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 opacity-50"
                  disabled
                  aria-label="Аудио недоступно"
                >
                  <MicOff className="h-4 w-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px]">
              Отправка голосовых/аудио в Instagram через Meta/ManyChat API
              не поддерживается провайдером. Принимать входящие аудио — можно.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Input
          className="flex-1 h-9 text-sm"
          placeholder={
            pending
              ? "Подпись к вложению (необязательно)…"
              : "Написать сообщение…"
          }
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          disabled={sending || uploading}
        />
        <Button
          type="submit"
          size="icon"
          className="h-9 w-9 shrink-0"
          disabled={
            sending ||
            uploading ||
            (!pending && !text.trim())
          }
        >
          {uploading || sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
