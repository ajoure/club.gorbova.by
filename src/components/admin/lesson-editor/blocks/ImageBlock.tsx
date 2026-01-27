import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ImageContent } from "@/hooks/useLessonBlocks";
import { ImageIcon, Upload, Loader2, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ImageBlockProps {
  content: ImageContent;
  onChange: (content: ImageContent) => void;
  isEditing?: boolean;
}

export function ImageBlock({ content, onChange, isEditing = true }: ImageBlockProps) {
  const [localUrl, setLocalUrl] = useState(content.url || "");
  const [localAlt, setLocalAlt] = useState(content.alt || "");
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleUrlBlur = () => {
    onChange({ ...content, url: localUrl });
  };

  const handleAltBlur = () => {
    onChange({ ...content, alt: localAlt });
  };

  const handleWidthChange = (value: number[]) => {
    onChange({ ...content, width: value[0] });
  };

  const handleFileUpload = async (file: File) => {
    // Валидация типа файла
    if (!file.type.startsWith("image/")) {
      toast.error("Выберите файл изображения");
      return;
    }

    // Валидация размера (10 МБ)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Максимальный размер файла: 10 МБ");
      return;
    }

    try {
      setUploading(true);
      
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `lesson-images/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("training-assets")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("training-assets")
        .getPublicUrl(filePath);

      const newUrl = urlData.publicUrl;
      setLocalUrl(newUrl);
      onChange({ ...content, url: newUrl });
      toast.success("Изображение загружено");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Ошибка загрузки изображения");
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  if (!isEditing) {
    if (!content.url) {
      return (
        <div className="flex items-center justify-center h-48 bg-muted rounded-lg">
          <ImageIcon className="h-12 w-12 text-muted-foreground" />
        </div>
      );
    }
    
    return (
      <div className="flex justify-center">
        <img
          src={content.url}
          alt={content.alt || ""}
          style={{ maxWidth: content.width ? `${content.width}%` : '100%' }}
          className="rounded-lg max-h-[600px] object-contain"
        />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Зона загрузки с Drag & Drop */}
        <div 
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            isDragOver 
              ? "border-primary bg-primary/5" 
              : "border-border hover:border-primary/50"
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
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
                <Upload className="h-8 w-8 text-muted-foreground" />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  Загрузить изображение
                </Button>
                <p className="text-xs text-muted-foreground">
                  или перетащите файл сюда • до 10 МБ
                </p>
              </>
            )}
          </div>
        </div>

        {/* URL ввод */}
        <div className="space-y-1.5">
          <Label>Или укажите ссылку на изображение</Label>
          <Input
            value={localUrl}
            onChange={(e) => setLocalUrl(e.target.value)}
            onBlur={handleUrlBlur}
            placeholder="https://..."
          />
        </div>
        
        {/* Alt текст с подсказкой */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label>Описание для доступности (alt)</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>Используется для программ чтения с экрана и SEO. Не отображается пользователю напрямую.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Input
            value={localAlt}
            onChange={(e) => setLocalAlt(e.target.value)}
            onBlur={handleAltBlur}
            placeholder="Краткое описание изображения"
          />
        </div>

        {/* Ширина */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label>Ширина: {content.width || 100}%</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Ширина изображения относительно контейнера урока</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Slider
            value={[content.width || 100]}
            onValueChange={handleWidthChange}
            min={25}
            max={100}
            step={5}
          />
        </div>

        {/* Предпросмотр */}
        {content.url && (
          <div className="flex justify-center p-4 bg-muted/30 rounded-lg">
            <img
              src={content.url}
              alt={content.alt || "Предпросмотр"}
              style={{ maxWidth: content.width ? `${content.width}%` : '100%' }}
              className="max-h-[300px] object-contain rounded"
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
