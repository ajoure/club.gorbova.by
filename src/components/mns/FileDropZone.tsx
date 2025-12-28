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
}

const ACCEPTED_TYPES = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "application/pdf": "pdf",
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
} as const;

export function FileDropZone({ 
  files, 
  onFilesChange, 
  disabled = false,
  maxFiles = 5,
  maxSizeMB = 10 
}: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const getFileType = (file: File): UploadedFile["type"] => {
    return (ACCEPTED_TYPES[file.type as keyof typeof ACCEPTED_TYPES] as UploadedFile["type"]) || "other";
  };

  const processFile = useCallback(async (file: File): Promise<UploadedFile | null> => {
    const fileType = getFileType(file);
    
    if (fileType === "other") {
      return null;
    }

    if (file.size > maxSizeMB * 1024 * 1024) {
      return null;
    }

    const uploadedFile: UploadedFile = {
      id: crypto.randomUUID(),
      file,
      type: fileType,
    };

    // Create preview for images
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
  }, [maxSizeMB]);

  const addFiles = useCallback(async (newFiles: File[]) => {
    if (files.length >= maxFiles) return;

    const remainingSlots = maxFiles - files.length;
    const filesToProcess = newFiles.slice(0, remainingSlots);
    
    const processedFiles = await Promise.all(filesToProcess.map(processFile));
    const validFiles = processedFiles.filter((f): f is UploadedFile => f !== null);
    
    if (validFiles.length > 0) {
      onFilesChange([...files, ...validFiles]);
    }
  }, [files, maxFiles, onFilesChange, processFile]);

  const removeFile = useCallback((id: string) => {
    onFilesChange(files.filter(f => f.id !== id));
  }, [files, onFilesChange]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
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

    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  }, [disabled, addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (disabled) return;

    const items = Array.from(e.clipboardData.items);
    const filesToAdd: File[] = [];

    items.forEach(item => {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          filesToAdd.push(file);
        }
      }
    });

    if (filesToAdd.length > 0) {
      e.preventDefault();
      addFiles(filesToAdd);
    }
  }, [disabled, addFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    addFiles(selectedFiles);
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
    <div 
      className="space-y-3"
      onPaste={handlePaste}
    >
      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
          isDragging 
            ? "border-primary bg-primary/5" 
            : "border-border hover:border-primary/50",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground mb-2">
          Перетащите файлы сюда или вставьте из буфера (Ctrl+V)
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          PDF, JPG, PNG, Word, Excel • до {maxSizeMB} МБ
        </p>
        <label>
          <input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
            className="hidden"
            onChange={handleFileInput}
            disabled={disabled || files.length >= maxFiles}
          />
          <Button 
            type="button" 
            variant="outline" 
            size="sm"
            disabled={disabled || files.length >= maxFiles}
            asChild
          >
            <span>Выбрать файлы</span>
          </Button>
        </label>
      </div>

      {/* Uploaded Files List */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file) => (
            <div 
              key={file.id}
              className="flex items-center gap-3 p-2 rounded-lg bg-muted/50 border border-border"
            >
              {file.preview ? (
                <img 
                  src={file.preview} 
                  alt={file.file.name}
                  className="h-10 w-10 rounded object-cover"
                />
              ) : (
                <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                  {getFileIcon(file.type)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.file.size)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => removeFile(file.id)}
                disabled={disabled}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
