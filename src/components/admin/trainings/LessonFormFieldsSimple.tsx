import React, { memo, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Upload, Sparkles, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const generateLessonSlug = (title: string) => {
  return title
    .toLowerCase()
    .replace(/[а-яё]/gi, (char) => {
      const ru = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
      const en = ["a","b","v","g","d","e","yo","zh","z","i","j","k","l","m","n","o","p","r","s","t","u","f","h","c","ch","sh","sch","","y","","e","yu","ya"];
      const idx = ru.indexOf(char.toLowerCase());
      return idx >= 0 ? en[idx] : char;
    })
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

export interface LessonFormDataSimple {
  title: string;
  slug: string;
  description?: string;
  thumbnail_url?: string;
  // Extended fields for universal wizard
  answer_date?: Date;
  answer_time?: string;      // "HH:mm"
  answer_timezone?: string;  // IANA, default "Europe/Minsk"
  kinescope_url?: string;
  questions?: Array<{
    question_number: number;
    title: string;
    full_question?: string;
    timecode?: string;
  }>;
}

interface LessonFormFieldsSimpleProps {
  formData: LessonFormDataSimple;
  onChange: (data: LessonFormDataSimple) => void;
  isEditing?: boolean;
}

export const LessonFormFieldsSimple = memo(function LessonFormFieldsSimple({
  formData,
  onChange,
  isEditing = false,
}: LessonFormFieldsSimpleProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTitleChange = (newTitle: string) => {
    onChange({
      ...formData,
      title: newTitle,
      slug: isEditing ? formData.slug : generateLessonSlug(newTitle),
    });
  };

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
      const fileExt = file.name.split(".").pop();
      const fileName = `lesson-covers/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("training-assets")
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("training-assets")
        .getPublicUrl(fileName);

      onChange({ ...formData, thumbnail_url: urlData.publicUrl });
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
    if (!formData.title) {
      toast.error("Введите название урока для генерации обложки");
      return;
    }

    setIsGenerating(true);
    try {
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
            title: formData.title,
            description: formData.description || "",
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Ошибка генерации");
      }

      if (result.url) {
        onChange({ ...formData, thumbnail_url: result.url });
        toast.success("Обложка сгенерирована");
      }
    } catch (error: any) {
      console.error("AI generation error:", error);
      toast.error(`Ошибка генерации: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRemoveThumbnail = () => {
    onChange({ ...formData, thumbnail_url: "" });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="lesson-title">Название урока</Label>
          <Input
            id="lesson-title"
            value={formData.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Введение в тему"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lesson-slug">URL-адрес</Label>
          <Input
            id="lesson-slug"
            value={formData.slug}
            onChange={(e) => onChange({ ...formData, slug: e.target.value })}
            placeholder="vvedenie-v-temu"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Краткое описание</Label>
        <Textarea
          value={formData.description || ""}
          onChange={(e) => onChange({ ...formData, description: e.target.value })}
          placeholder="О чём этот урок..."
          rows={2}
        />
      </div>

      {/* Thumbnail section */}
      <div className="space-y-2">
        <Label>Превью урока</Label>
        <div className="flex gap-2">
          <Input
            value={formData.thumbnail_url || ""}
            onChange={(e) => onChange({ ...formData, thumbnail_url: e.target.value })}
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
            disabled={isGenerating || !formData.title}
            title="Сгенерировать AI"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Thumbnail preview */}
        {formData.thumbnail_url && (
          <div className="relative mt-2 inline-block">
            <img
              src={formData.thumbnail_url}
              alt="Превью урока"
              className="h-24 w-auto rounded-md border border-border object-cover"
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
    </div>
  );
});
