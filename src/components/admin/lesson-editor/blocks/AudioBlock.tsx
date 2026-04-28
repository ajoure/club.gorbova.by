import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { RichTextarea } from "@/components/ui/RichTextarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SafeHtml } from "@/components/ui/SafeHtml";
import { AudioContent } from "@/hooks/useLessonBlocks";
import { Music, ExternalLink, Upload, Loader2, AlertTriangle } from "lucide-react";
import { CustomAudioPlayer } from "@/components/ui/CustomAudioPlayer";
import { toast } from "sonner";
import { uploadToTrainingAssets, convertGoogleDriveUrl, extractStoragePathFromPublicUrl, deleteTrainingAssets } from "./uploadToTrainingAssets";

interface AudioBlockProps {
  content: AudioContent;
  onChange: (content: AudioContent) => void;
  isEditing?: boolean;
  lessonId?: string;
}

const ALLOWED_AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg", ".aac"];

export function AudioBlock({ content, onChange, isEditing = true, lessonId }: AudioBlockProps) {
  const [localUrl, setLocalUrl] = useState(content.url || "");
  const [localTitle, setLocalTitle] = useState(content.title || "");
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Проверяем, является ли URL Google Drive ссылкой
  const { isGoogleDrive } = convertGoogleDriveUrl(localUrl);

  const handleUrlBlur = () => {
    let finalUrl = localUrl;

    // Автоконвертация Google Drive URL при вставке
    const { converted, isGoogleDrive: isGD } = convertGoogleDriveUrl(localUrl);
    if (isGD && converted && converted !== localUrl) {
      finalUrl = converted;
      setLocalUrl(converted);
    }

    onChange({ ...content, url: finalUrl });
  };

  const handleTitleBlur = () => {
    onChange({ ...content, title: localTitle });
  };

  const handleFileUpload = async (file: File) => {
    try {
      setUploading(true);
      // Нормализуем ownerId один раз — чтобы путь в Storage и entity.id совпадали
      const ownerId = (lessonId || "").trim();
      const entity = ownerId ? { type: "lesson", id: ownerId } : undefined;

      // Сохраняем предыдущий storagePath для удаления после замены
      const prevPath = (content as any).storagePath as string | undefined
        || (localUrl ? extractStoragePathFromPublicUrl(localUrl) : null);

      const result = await uploadToTrainingAssets(
        file,
        "lesson-audio",
        500,
        "audio/",
        ALLOWED_AUDIO_EXTENSIONS,
        ownerId // нормализованный ownerId → lesson-audio/<lessonId>/...
      );
      if (result) {
        const { publicUrl, storagePath } = result;
        setLocalUrl(publicUrl);
        onChange({ ...content, url: publicUrl, storagePath } as AudioContent & { storagePath?: string });
        toast.success("Аудио загружено");
        // Удаляем старый файл из Storage (fire-and-forget)
        if (prevPath && prevPath !== storagePath) {
          deleteTrainingAssets([prevPath], entity, "audio_replaced");
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    // Сбрасываем input чтобы можно было загрузить тот же файл повторно
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  // Режим просмотра (для студента)
  if (!isEditing) {
    if (!content.url) {
      return (
        <div className="flex items-center justify-center h-20 bg-muted rounded-lg">
          <Music className="h-8 w-8 text-muted-foreground" />
        </div>
      );
    }

    const { isGoogleDrive: isGD } = convertGoogleDriveUrl(content.url);

    return (
      <div className="space-y-2">
        {content.title && (
          <SafeHtml html={content.title} as="p" className="text-sm font-medium text-muted-foreground" />
        )}
        {isGD ? (
          // Google Drive не отдаёт прямой аудио-поток — показываем предупреждение вместо плеера
          <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Google Drive не поддерживает прямое воспроизведение.</p>
              <p>Обратитесь к организатору — аудио необходимо загрузить напрямую в систему.</p>
              <a
                href={content.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-2 text-amber-800 hover:text-amber-900"
              >
                <ExternalLink className="h-3 w-3" />
                Открыть ссылку
              </a>
            </div>
          </div>
        ) : audioError ? (
          <div className="flex items-center gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Аудио недоступно. Файл мог быть удален из хранилища.</span>
          </div>
        ) : (
          <CustomAudioPlayer src={content.url} onError={() => setAudioError(true)} />
        )}
      </div>
    );
  }

  // Режим редактирования
  return (
    <div className="space-y-3">
      {/* Drag & Drop зона загрузки */}
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !uploading && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,.wav,.m4a,.ogg,.aac,audio/*"
          onChange={handleInputChange}
          className="hidden"
        />

        <div className="flex flex-col items-center gap-3">
          {uploading ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Загрузка...</p>
            </>
          ) : (
            <>
              <Music className="h-8 w-8 text-muted-foreground" />
              <Button
                variant="outline"
                type="button"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                disabled={uploading}
              >
                <Upload className="h-4 w-4 mr-2" />
                Загрузить аудио
              </Button>
              <p className="text-xs text-muted-foreground">
                или перетащите файл сюда • .mp3, .wav, .m4a, .ogg, .aac • до 500 МБ
              </p>
            </>
          )}
        </div>
      </div>

      {/* URL поле */}
      <div className="space-y-1.5">
        <Label>Или укажите прямую ссылку на аудио</Label>
        <div className="flex gap-2">
          <Input
            value={localUrl}
            onChange={(e) => setLocalUrl(e.target.value)}
            onBlur={handleUrlBlur}
            placeholder="https://..."
            className="flex-1"
            disabled={uploading}
          />
          {content.url && (
            <a
              href={content.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-input bg-background hover:bg-accent shrink-0"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>

        {/* Google Drive предупреждение в режиме редактора */}
        {isGoogleDrive && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Google Drive не поддерживает прямое воспроизведение аудио. Ссылка преобразована для скачивания, но воспроизведение не гарантировано.{" "}
              <strong>Рекомендуется загрузить файл через кнопку выше.</strong>
            </span>
          </div>
        )}
      </div>

      {/* Название */}
      <div className="space-y-1.5">
        <Label>Название (опционально)</Label>
        <RichTextarea
          value={localTitle}
          onChange={(html) => { setLocalTitle(html); onChange({ ...content, title: html }); }}
          placeholder="Название аудио"
          inline
        />
      </div>

      {/* Превью плеер — только если URL не Google Drive */}
      {content.url && !isGoogleDrive && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Предпросмотр</Label>
          <audio
            controls
            controlsList="nodownload"
            onContextMenu={(e) => e.preventDefault()}
            className="w-full"
          >
            <source src={content.url} />
          </audio>
        </div>
      )}

      {/* Если Google Drive — вместо плеера показываем предупреждение */}
      {content.url && isGoogleDrive && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">Воспроизведение недоступно</p>
            <p className="text-xs">Google Drive не отдаёт прямой аудио-поток. Загрузите файл через кнопку «Загрузить аудио» выше.</p>
          </div>
        </div>
      )}
    </div>
  );
}
