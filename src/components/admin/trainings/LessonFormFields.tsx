import React, { memo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Video, Music, Files, BookOpen } from "lucide-react";
import { MonthYearPicker } from "@/components/ui/month-year-picker";

export const contentTypeOptions = [
  { value: "article", label: "Статья", icon: FileText },
  { value: "video", label: "Видео", icon: Video },
  { value: "audio", label: "Аудио", icon: Music },
  { value: "document", label: "Документ", icon: Files },
  { value: "mixed", label: "Смешанный", icon: BookOpen },
];

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

export interface LessonFormData {
  title: string;
  slug: string;
  description?: string;
  content?: string;
  content_type?: "video" | "audio" | "article" | "document" | "mixed";
  video_url?: string;
  audio_url?: string;
  duration_minutes?: number;
  is_active?: boolean;
  content_month?: string | null;
}

interface LessonFormFieldsProps {
  formData: LessonFormData;
  onChange: (data: LessonFormData) => void;
  isEditing?: boolean;
  compact?: boolean;
  showContent?: boolean;
  showActiveSwitch?: boolean;
}

export const LessonFormFields = memo(function LessonFormFields({
  formData,
  onChange,
  isEditing = false,
  compact = false,
  showContent = true,
  showActiveSwitch = true,
}: LessonFormFieldsProps) {
  const updateField = <K extends keyof LessonFormData>(
    field: K,
    value: LessonFormData[K]
  ) => {
    onChange({ ...formData, [field]: value });
  };

  const handleTitleChange = (newTitle: string) => {
    onChange({
      ...formData,
      title: newTitle,
      slug: isEditing ? formData.slug : generateLessonSlug(newTitle),
    });
  };

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div className={compact ? "space-y-3" : "grid gap-4 md:grid-cols-2"}>
        <div className="space-y-2">
          <Label htmlFor="lesson-title">Название *</Label>
          <Input
            id="lesson-title"
            value={formData.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Введение в тему"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lesson-slug">URL-slug *</Label>
          <Input
            id="lesson-slug"
            value={formData.slug}
            onChange={(e) => updateField("slug", e.target.value)}
            placeholder="vvedenie-v-temu"
          />
        </div>
      </div>

      <div className={compact ? "space-y-3" : "grid gap-4 md:grid-cols-2"}>
        <div className="space-y-2">
          <Label>Тип контента</Label>
          <Select
            value={formData.content_type || "article"}
            onValueChange={(value: any) => updateField("content_type", value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {contentTypeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div className="flex items-center gap-2">
                    <opt.icon className="h-4 w-4" />
                    {opt.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Длительность (мин)</Label>
          <Input
            type="number"
            value={formData.duration_minutes || ""}
            onChange={(e) =>
              updateField(
                "duration_minutes",
                e.target.value ? parseInt(e.target.value) : undefined
              )
            }
            placeholder="15"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Краткое описание</Label>
        <Textarea
          value={formData.description || ""}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="О чём этот урок..."
          rows={compact ? 2 : 3}
        />
      </div>

      {(formData.content_type === "video" || formData.content_type === "mixed") && (
        <div className="space-y-2">
          <Label>URL видео</Label>
          <Input
            value={formData.video_url || ""}
            onChange={(e) => updateField("video_url", e.target.value)}
            placeholder="https://youtube.com/watch?v=... или https://kinescope.io/..."
          />
          <p className="text-xs text-muted-foreground">
            Поддерживается YouTube, Vimeo, Kinescope или прямая ссылка
          </p>
        </div>
      )}

      {(formData.content_type === "audio" || formData.content_type === "mixed") && (
        <div className="space-y-2">
          <Label>URL аудио</Label>
          <Input
            value={formData.audio_url || ""}
            onChange={(e) => updateField("audio_url", e.target.value)}
            placeholder="https://..."
          />
        </div>
      )}

      {showContent && (
        <div className="space-y-2">
          <Label>Текстовый контент (HTML)</Label>
          <Textarea
            value={formData.content || ""}
            onChange={(e) => updateField("content", e.target.value)}
            placeholder="<p>Содержимое урока...</p>"
            rows={compact ? 3 : 6}
            className="font-mono text-sm"
          />
        </div>
      )}

      {showActiveSwitch && (
        <div className="flex items-center space-x-2">
          <Switch
            id="lesson-is_active"
            checked={formData.is_active !== false}
            onCheckedChange={(checked) => updateField("is_active", checked)}
          />
          <Label htmlFor="lesson-is_active">Активен</Label>
        </div>
      )}
    </div>
  );
});
