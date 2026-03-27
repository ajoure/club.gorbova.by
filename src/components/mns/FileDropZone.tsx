import { useCallback, useState } from "react";
import { Upload, X, FileText, Image, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface UploadedFile {
  id: string;
  file: File;
  preview?: string;
  type: "image" | "pdf" | "word" | "excel" | "other";
}

interface FileDropZoneProps {
  files: UploadedFile[];
  onFilesChange: (files: UploadedFile[]) => void;
  disabled?: boolean;
  maxFiles?: number;
  maxSizeMB?: number;
  compact?: boolean;
}

const ACCEPTED_TYPES: Record<string, UploadedFile["type"]> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "application/pdf": "pdf",
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/rtf": "word",
  "text/rtf": "word",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "text/csv": "excel",
};

const ACCEPT_STRING = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.rtf,.csv";

/** Resolve file type from MIME or extension fallback — exported as SoT */
export function resolveFileType(file: File): UploadedFile["type"] {
  const fromMime = ACCEPTED_TYPES[file.type];
  if (fromMime) return fromMime;
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "rtf") return "word";
  if (ext === "csv") return "excel";
  if (ext === "xls" || ext === "xlsx") return "excel";
  if (ext === "doc" || ext === "docx") return "word";
  return "other";
}

/** Process a single dropped/selected file — exported as SoT for validation + preview */
export async function processDroppedFile(file: File, maxSizeMB: number): Promise<UploadedFile | null> {
  const fileType = resolveFileType(file);
  if (fileType === "other") return null;
  if (file.size > maxSizeMB * 1024 * 1024) return null;

  const uploadedFile: UploadedFile = {
    id: crypto.randomUUID(),
    file,
    type: fileType,
  };

  if (fileType === "image") {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        uploadedFile.preview = e.target?.result as string;
        resolve(uploadedFile);
      };
      reader.readAsDataURL(file);
    });
  }

  return uploadedFile;
}

export function FileDropZone({ 
  files, 
  onFilesChange, 
  disabled = false,
  maxFiles = 5,
  maxSizeMB = 10,
  compact = false,
}: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const addFiles = useCallback(async (newFiles: File[]) => {
    if (files.length >= maxFiles) return;
    const remainingSlots = maxFiles - files.length;
    const filesToProcess = newFiles.slice(0, remainingSlots);
    const processedFiles = await Promise.all(filesToProcess.map(f => processDroppedFile(f, maxSizeMB)));
    const validFiles = processedFiles.filter((f): f is UploadedFile => f !== null);
    if (validFiles.length > 0) {
      onFilesChange([...files, ...validFiles]);
    }
  }, [files, maxFiles, maxSizeMB, onFilesChange]);

  const removeFile = useCallback((id: string) => {
    onFilesChange(files.filter(f => f.id !== id));
  }, [files, onFilesChange]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;
    addFiles(Array.from(e.dataTransfer.files));
  }, [disabled, addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (disabled) return;
    const filesToAdd: File[] = [];
    Array.from(e.clipboardData.items).forEach(item => {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) filesToAdd.push(file);
      }
    });
    if (filesToAdd.length > 0) {
      e.preventDefault();
      addFiles(filesToAdd);
    }
  }, [disabled, addFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files || []));
    e.target.value = "";
  }, [addFiles]);

  const getFileIcon = (type: UploadedFile["type"]) => {
    switch (type) {
      case "image": return <Image className="h-4 w-4" />;
      case "pdf": return <FileText className="h-4 w-4 text-red-500" />;
      case "word": return <FileText className="h-4 w-4 text-blue-500" />;
      case "excel": return <FileSpreadsheet className="h-4 w-4 text-green-500" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-3" onPaste={handlePaste}>
      {compact ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed transition-colors",
            isDragging ? "border-primary bg-primary/5" : "border-border",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <label className="shrink-0">
            <input
              type="file"
              multiple
              accept={ACCEPT_STRING}
              className="hidden"
              onChange={handleFileInput}
              disabled={disabled || files.length >= maxFiles}
            />
            <Button type="button" variant="outline" size="sm" disabled={disabled || files.length >= maxFiles} asChild>
              <span>
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Выбрать файлы
              </span>
            </Button>
          </label>
          <span className="text-xs text-muted-foreground">
            до {maxSizeMB} МБ • PDF, JPG, PNG, Word, Excel, RTF, CSV
          </span>
        </div>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
            isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-2">
            Перетащите файлы сюда или вставьте из буфера (Ctrl+V)
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            PDF, JPG, PNG, Word, Excel, RTF, CSV • до {maxSizeMB} МБ
          </p>
          <label>
            <input
              type="file"
              multiple
              accept={ACCEPT_STRING}
              className="hidden"
              onChange={handleFileInput}
              disabled={disabled || files.length >= maxFiles}
            />
            <Button type="button" variant="outline" size="sm" disabled={disabled || files.length >= maxFiles} asChild>
              <span>Выбрать файлы</span>
            </Button>
          </label>
        </div>
      )}

      {files.length > 0 && (
        <div className={compact ? "flex flex-wrap gap-1.5" : "space-y-2"}>
          {files.map((file) =>
            compact ? (
              <div
                key={file.id}
                className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-muted/50 border border-border max-w-[220px]"
              >
                {getFileIcon(file.type)}
                <span className="text-xs truncate min-w-0 flex-1">{file.file.name}</span>
                <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => removeFile(file.id)} disabled={disabled}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div key={file.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50 border border-border">
                {file.preview ? (
                  <img src={file.preview} alt={file.file.name} className="h-10 w-10 rounded object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                    {getFileIcon(file.type)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(file.file.size)}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeFile(file.id)} disabled={disabled}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
