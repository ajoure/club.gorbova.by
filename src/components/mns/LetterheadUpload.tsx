import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const LETTERHEAD_STORAGE_KEY = "mns_letterhead";

export interface LetterheadData {
  base64: string;
  filename: string;
  mimeType: string;
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

interface LetterheadUploadProps {
  letterhead: LetterheadData | null;
  onLetterheadChange: (data: LetterheadData | null) => void;
}

export function LetterheadUpload({ letterhead, onLetterheadChange }: LetterheadUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Accept any image format
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Неподдерживаемый формат",
        description: "Загрузите изображение (PNG, JPG, WEBP и др.)",
        variant: "destructive",
      });
      return;
    }

    // Check size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "Файл слишком большой",
        description: "Максимальный размер файла — 5 МБ",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      onLetterheadChange({
        base64,
        filename: file.name,
        mimeType: file.type,
      });
      toast({
        title: "Бланк загружен",
        description: file.name,
      });
    };
    reader.readAsDataURL(file);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [onLetterheadChange, toast]);

  const handleRemove = useCallback(() => {
    onLetterheadChange(null);
    toast({
      title: "Бланк удалён",
    });
  }, [onLetterheadChange, toast]);

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
      
      {letterhead ? (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/50">
          <div className="w-16 h-16 rounded border border-border overflow-hidden bg-background flex items-center justify-center">
            <img 
              src={letterhead.base64} 
              alt="Фирменный бланк" 
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {letterhead.filename}
            </p>
            <p className="text-xs text-muted-foreground">
              Фирменный бланк
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
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          className="w-full gap-2 h-auto py-3"
        >
          <ImageIcon className="h-4 w-4" />
          Загрузить фирменный бланк
        </Button>
      )}
      
      <p className="text-xs text-muted-foreground">
        Изображение будет добавлено в шапку документа при экспорте в DOCX
      </p>
    </div>
  );
}
