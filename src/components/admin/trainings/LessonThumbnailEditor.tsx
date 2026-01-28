import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Sparkles, Loader2, X, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface LessonThumbnailEditorProps {
  lessonId: string;
  lessonTitle: string;
  lessonDescription?: string;
  currentThumbnail?: string | null;
  onThumbnailChange: (url: string | null) => void;
}

export function LessonThumbnailEditor({
  lessonId,
  lessonTitle,
  lessonDescription,
  currentThumbnail,
  onThumbnailChange,
}: LessonThumbnailEditorProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previousThumbnail, setPreviousThumbnail] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState(currentThumbnail || "");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Выберите файл изображения");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Размер файла не должен превышать 5 МБ");
      return;
    }

    setIsUploading(true);
    try {
      // Save previous for revert
      if (currentThumbnail) {
        setPreviousThumbnail(currentThumbnail);
      }

      const fileExt = file.name.split(".").pop();
      const fileName = `lesson-covers/${lessonId}-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("training-assets")
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("training-assets")
        .getPublicUrl(fileName);

      const newUrl = urlData.publicUrl;
      setThumbnailUrl(newUrl);
      onThumbnailChange(newUrl);
      toast.success("Изображение загружено");
    } catch (error: any) {
      console.error("Upload error:", error);
      toast.error(`Ошибка загрузки: ${error.message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleAIGenerate = async () => {
    if (!lessonTitle) {
      toast.error("Название урока отсутствует");
      return;
    }

    setIsGenerating(true);
    try {
      // Save previous for revert
      if (currentThumbnail) {
        setPreviousThumbnail(currentThumbnail);
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        toast.error("Необходима авторизация");
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-cover`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: lessonTitle,
            description: lessonDescription || "",
            moduleId: lessonId,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Ошибка генерации");
      }

      if (result.url) {
        setThumbnailUrl(result.url);
        onThumbnailChange(result.url);
        toast.success("Обложка сгенерирована AI");
      }
    } catch (error: any) {
      console.error("AI generation error:", error);
      toast.error(`Ошибка генерации: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRevert = () => {
    if (previousThumbnail) {
      setThumbnailUrl(previousThumbnail);
      onThumbnailChange(previousThumbnail);
      setPreviousThumbnail(null);
      toast.success("Предыдущее изображение восстановлено");
    }
  };

  const handleRemoveThumbnail = () => {
    if (currentThumbnail) {
      setPreviousThumbnail(currentThumbnail);
    }
    setThumbnailUrl("");
    onThumbnailChange(null);
  };

  const handleUrlChange = (url: string) => {
    setThumbnailUrl(url);
  };

  const handleUrlBlur = () => {
    if (thumbnailUrl !== currentThumbnail) {
      if (currentThumbnail) {
        setPreviousThumbnail(currentThumbnail);
      }
      onThumbnailChange(thumbnailUrl || null);
    }
  };

  return (
    <div className="space-y-3">
      <Label>Превью урока</Label>
      <div className="flex gap-2">
        <Input
          value={thumbnailUrl}
          onChange={(e) => handleUrlChange(e.target.value)}
          onBlur={handleUrlBlur}
          placeholder="https://... или загрузите/сгенерируйте"
          className="flex-1"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileUpload}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          title="Загрузить изображение"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleAIGenerate}
          disabled={isGenerating}
          title="Сгенерировать AI"
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
        </Button>
        {previousThumbnail && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleRevert}
            title="Вернуть предыдущую"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Thumbnail preview */}
      {thumbnailUrl && (
        <div className="relative inline-block">
          <img
            src={thumbnailUrl}
            alt="Превью урока"
            className="h-32 w-auto rounded-md border border-border object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute -right-2 -top-2 h-6 w-6"
            onClick={handleRemoveThumbnail}
            title="Удалить"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
