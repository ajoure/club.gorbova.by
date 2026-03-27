import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Upload, Trash2, FileText, FileSpreadsheet, File, Loader2 } from "lucide-react";
import type { PromptAttachment } from "@/hooks/usePromptAttachments";

interface PromptAttachmentsSectionProps {
  promptId: string | null;
  attachments: PromptAttachment[];
  loading: boolean;
  uploading: boolean;
  onFetch: (promptId: string) => void;
  onUpload: (promptId: string, file: File) => Promise<PromptAttachment | null>;
  onDelete: (id: string, filePath: string) => void;
}

const ACCEPT = ".docx,.xlsx,.xls,.csv,.rtf,.txt,.doc";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  ready: { label: "Готов", color: "text-green-600" },
  truncated: { label: "Обрезан", color: "text-yellow-600" },
  empty: { label: "Пусто", color: "text-muted-foreground" },
  failed: { label: "Ошибка", color: "text-destructive" },
};

const TYPE_ICONS: Record<string, typeof FileText> = {
  word: FileText,
  excel: FileSpreadsheet,
  text: File,
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function PromptAttachmentsSection({
  promptId,
  attachments,
  loading,
  uploading,
  onFetch,
  onUpload,
  onDelete,
}: PromptAttachmentsSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (promptId && fetchedRef.current !== promptId) {
      fetchedRef.current = promptId;
      onFetch(promptId);
    }
  }, [promptId, onFetch]);

  if (!promptId) {
    return (
      <div>
        <p className="text-xs text-muted-foreground">
          Сохраните карточку (достаточно кода и названия), затем вернитесь сюда для загрузки файлов базы знаний.
        </p>
      </div>
    );
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !promptId) return;
    for (const file of Array.from(files)) {
      await onUpload(promptId, file);
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{attachments.length} файл(ов)</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-1" />
          )}
          {uploading ? "Загрузка..." : "Добавить файл"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Загрузка списка...
        </div>
      )}

      {!loading && attachments.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Нет прикреплённых файлов. Загрузите DOCX, XLSX, CSV, RTF или TXT для базы знаний сценария.
        </p>
      )}

      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((att) => {
            const Icon = TYPE_ICONS[att.file_type] || File;
            const status = STATUS_CONFIG[att.extraction_status] || STATUS_CONFIG.failed;

            return (
              <div
                key={att.id}
                className="flex items-center gap-3 p-2 rounded-md border bg-muted overflow-hidden"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0 overflow-hidden">
                  <p className="text-sm font-medium truncate block w-full">{att.file_name}</p>
                  <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <span>{formatSize(att.file_size)}</span>
                    <span>•</span>
                    <span className={status.color}>{status.label}</span>
                    {att.extracted_chars > 0 && (
                      <>
                        <span>•</span>
                        <span>{att.extracted_chars.toLocaleString()} симв.</span>
                      </>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => onDelete(att.id, att.file_path)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
