import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FileContent } from "@/hooks/useLessonBlocks";
import { FileText, ExternalLink, Upload, Loader2, AlertTriangle } from "lucide-react";
import { getFileTypeIcon, pickIconHint } from "./fileTypeIcons";
import { toast } from "sonner";
import { uploadToTrainingAssets, formatFileSize, extractStoragePathFromPublicUrl, deleteTrainingAssets } from "./uploadToTrainingAssets";

interface FileBlockProps {
  content: FileContent;
  onChange: (content: FileContent) => void;
  isEditing?: boolean;
  lessonId?: string;
}

// Админ может загружать любые файлы — ограничение только по размеру

function formatFileSizeDisplay(bytes?: number): string {
  if (!bytes) return "";
  return formatFileSize(bytes);
}

export function FileBlock({ content, onChange, isEditing = true, lessonId }: FileBlockProps) {
  const [localUrl, setLocalUrl] = useState(content.url || "");
  const [localName, setLocalName] = useState(content.name || "");
  const [localSize, setLocalSize] = useState(content.size?.toString() || "");
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleUrlBlur = () => {
    onChange({ ...content, url: localUrl });
  };

  const handleNameBlur = () => {
    onChange({ ...content, name: localName });
  };

  const handleSizeBlur = () => {
    onChange({ ...content, size: localSize ? parseInt(localSize) : undefined });
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
        "lesson-files",
        500,
        undefined,
        undefined, // Админ: любые файлы, без ограничения расширений
        ownerId
      );
      if (result) {
        const { publicUrl, storagePath } = result;
        setLocalUrl(publicUrl);
        setLocalName(file.name);
        setLocalSize(String(file.size));
        onChange({
          ...content,
          url: publicUrl,
          name: file.name,
          size: file.size,
          storagePath,
        } as FileContent & { storagePath?: string });
        toast.success("Файл загружен");
        // Удаляем старый файл из Storage (fire-and-forget)
        if (prevPath && prevPath !== storagePath) {
          deleteTrainingAssets([prevPath], entity, "file_replaced");
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    // Сброс input чтобы можно было загрузить тот же файл повторно
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

  // ── Проверка доступности файла (view mode) ──
  const [fileAvailable, setFileAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (isEditing || !content.url) return;
    const controller = new AbortController();
    fetch(content.url, { method: "GET", headers: { Range: "bytes=0-0" }, signal: controller.signal })
      .then(res => setFileAvailable(res.ok))
      .catch(err => {
        if (err.name !== "AbortError") setFileAvailable(false);
      });
    return () => controller.abort();
  }, [content.url, isEditing]);

  // Режим просмотра (для студента) — файл кликабельный, открывается в новой вкладке
  if (!isEditing) {
    if (!content.url) {
      return (
        <div className="flex items-center gap-3 p-4 border rounded-lg bg-muted/30">
          <FileText className="h-8 w-8 text-muted-foreground" />
          <span className="text-muted-foreground">Файл не загружен</span>
        </div>
      );
    }

    // Файл недоступен (404 / ошибка)
    if (fileAvailable === false) {
      return (
        <div className="flex items-center gap-3 p-4 border rounded-lg bg-amber-50 border-amber-200">
          <AlertTriangle className="h-8 w-8 text-amber-500 shrink-0" />
          <div>
            <p className="font-medium text-amber-800">Файл недоступен</p>
            <p className="text-sm text-amber-600">Файл удален из хранилища.</p>
          </div>
        </div>
      );
    }

    const sp = (content as any).storagePath || (content as any).storage_path;
    const hint = pickIconHint(content.name, sp, content.url);
    const fileIcon = getFileTypeIcon(hint, { colored: true });
    return (
      <a
        href={content.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 p-4 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <fileIcon.Icon className={`h-8 w-8 shrink-0 ${fileIcon.colorClass}`} />
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{content.name || "Файл"}</p>
          {content.size && (
            <p className="text-sm text-muted-foreground">{formatFileSizeDisplay(content.size)}</p>
          )}
        </div>
        <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
      </a>
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
          accept="*/*"
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
              <FileText className="h-8 w-8 text-muted-foreground" />
              <Button
                variant="outline"
                type="button"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                disabled={uploading}
              >
                <Upload className="h-4 w-4 mr-2" />
                Загрузить файл
              </Button>
              <p className="text-xs text-muted-foreground">
                или перетащите файл сюда • любые файлы • до 500 МБ
              </p>
            </>
          )}
        </div>
      </div>

      {/* URL поле */}
      <div className="space-y-1.5">
        <Label>URL файла</Label>
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
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Название файла</Label>
          <Input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={handleNameBlur}
            placeholder="document.pdf"
            disabled={uploading}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Размер (bytes)</Label>
          <Input
            type="number"
            value={localSize}
            onChange={(e) => setLocalSize(e.target.value)}
            onBlur={handleSizeBlur}
            placeholder="1024"
            disabled={uploading}
          />
        </div>
      </div>

      {/* Превью загруженного файла */}
      {content.url && content.name && (() => {
        const sp = (content as any).storagePath || (content as any).storage_path;
        const previewHint = pickIconHint(content.name, sp, content.url);
        const previewIcon = getFileTypeIcon(previewHint, { colored: true });
        return (
        <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
          <previewIcon.Icon className={`h-6 w-6 shrink-0 ${previewIcon.colorClass}`} />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{content.name}</p>
            {content.size && (
              <p className="text-xs text-muted-foreground">{formatFileSizeDisplay(content.size)}</p>
            )}
          </div>
          <a
            href={content.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0"
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-primary transition-colors" />
          </a>
        </div>
        );
      })()}
    </div>
  );
}
