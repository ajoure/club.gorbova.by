import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { X, FileText, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const LETTERHEAD_STORAGE_KEY = "mns_letterhead";

export interface LetterheadData {
  base64: string;
  filename: string;
  mimeType: string;
  type: "image" | "word" | "pdf" | "other";
}

export function useLetterhead() {
  const [letterhead, setLetterhead] = useState<LetterheadData | null>(() => {
    const stored = localStorage.getItem(LETTERHEAD_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  });

  const saveLetterhead = useCallback((data: LetterheadData | null) => {
    if (data) {
      localStorage.setItem(LETTERHEAD_STORAGE_KEY, JSON.stringify(data));
    } else {
      localStorage.removeItem(LETTERHEAD_STORAGE_KEY);
    }
    setLetterhead(data);
  }, []);

  return { letterhead, saveLetterhead };
}

function getFileType(file: File): LetterheadData["type"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  if (
    file.type === "application/msword" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) return "word";
  return "other";
}

function getFileIcon(type: LetterheadData["type"]) {
  return <FileText className="h-6 w-6 text-primary" />;
}

interface LetterheadUploadProps {
  letterhead: LetterheadData | null;
  onLetterheadChange: (data: LetterheadData | null) => void;
}

export function LetterheadUpload({ letterhead, onLetterheadChange }: LetterheadUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFile = useCallback(async (file: File) => {
    // Check size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "Файл слишком большой",
        description: "Максимальный размер файла — 10 МБ",
        variant: "destructive",
      });
      return;
    }

    const fileType = getFileType(file);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      onLetterheadChange({
        base64,
        filename: file.name,
        mimeType: file.type,
        type: fileType,
      });
      toast({
        title: "Бланк загружен",
        description: file.name,
      });
    };
    reader.readAsDataURL(file);
  }, [onLetterheadChange, toast]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleRemove = useCallback(() => {
    onLetterheadChange(null);
    toast({ title: "Бланк удалён" });
  }, [onLetterheadChange, toast]);

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx"
        onChange={handleFileSelect}
        className="hidden"
      />
      
      {letterhead ? (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/50">
          <div className="w-12 h-12 rounded border border-border overflow-hidden bg-background flex items-center justify-center">
            {letterhead.type === "image" ? (
              <img 
                src={letterhead.base64} 
                alt="Фирменный бланк" 
                className="w-full h-full object-contain"
              />
            ) : (
              getFileIcon(letterhead.type)
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {letterhead.filename}
            </p>
            <p className="text-xs text-muted-foreground">
              {letterhead.type === "word" ? "Будет использован как шаблон" : "Фирменный бланк"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRemove}
            className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
            ${isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}
          `}
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            Загрузить фирменный бланк
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Word, PDF или изображение
          </p>
        </div>
      )}
      
      <p className="text-xs text-muted-foreground">
        Word-документ будет использован как шаблон, в который вставится ответ. 
        Изображение или PDF добавятся в шапку документа.
      </p>
    </div>
  );
}
