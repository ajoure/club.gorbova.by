import React, { memo, useRef, useState, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, Sparkles, Loader2, X, CalendarIcon, Plus, Video, HelpCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { KbQuestionInput, KbQuestionInputData } from "./KbQuestionInput";
import { generateLessonSlug } from "./LessonFormFieldsSimple";
import { TimezoneSelector } from "@/components/admin/payments/TimezoneSelector";

export interface KbLessonFormData {
  episode_number: number;
  answer_date?: Date;
  answer_time?: string;      // "HH:mm" format
  answer_timezone?: string;  // IANA timezone, default "Europe/Minsk"
  kinescope_url?: string;
  thumbnail_url?: string;
  questions: KbQuestionInputData[];
}

interface KbLessonFormFieldsProps {
  formData: KbLessonFormData;
  onChange: (data: KbLessonFormData) => void;
}

/**
 * Form fields specifically for Knowledge Base (KB) lessons
 * Includes episode number, answer date, Kinescope URL, and questions
 */
export const KbLessonFormFields = memo(function KbLessonFormFields({
  formData,
  onChange,
}: KbLessonFormFieldsProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file upload for thumbnail
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

  // Generate AI thumbnail
  const handleAIGenerate = async () => {
    if (!formData.episode_number) {
      toast.error("Введите номер выпуска для генерации обложки");
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

      const title = `Выпуск №${formData.episode_number}`;
      const description = formData.questions?.length 
        ? formData.questions.map(q => q.title).join(", ")
        : "Вопросы бухгалтеров";

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-cover`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title, description }),
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

  // Question management
  const addQuestion = useCallback(() => {
    const newNumber = formData.questions.length + 1;
    onChange({
      ...formData,
      questions: [
        ...formData.questions,
        { question_number: newNumber, title: "", full_question: "", timecode: "" },
      ],
    });
  }, [formData, onChange]);

  const updateQuestion = useCallback(
    (index: number, data: KbQuestionInputData) => {
      const updated = [...formData.questions];
      updated[index] = data;
      onChange({ ...formData, questions: updated });
    },
    [formData, onChange]
  );

  const removeQuestion = useCallback(
    (index: number) => {
      const updated = formData.questions.filter((_, i) => i !== index);
      // Renumber questions
      updated.forEach((q, i) => {
        q.question_number = i + 1;
      });
      onChange({ ...formData, questions: updated });
    },
    [formData, onChange]
  );

  return (
    <div className="space-y-6">
      {/* Episode info */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="episode-number">Номер выпуска *</Label>
          <Input
            id="episode-number"
            type="number"
            min={1}
            value={formData.episode_number || ""}
            onChange={(e) =>
              onChange({ ...formData, episode_number: parseInt(e.target.value) || 0 })
            }
            placeholder="101"
          />
        </div>
      </div>

      {/* Date, Time & Timezone */}
      <div className="space-y-2">
        <Label>Дата выпуска</Label>
        <div className="flex flex-wrap gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "flex-1 min-w-[140px] justify-start text-left font-normal",
                  !formData.answer_date && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {formData.answer_date
                  ? format(formData.answer_date, "dd.MM.yyyy", { locale: ru })
                  : "Дата"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={formData.answer_date}
                onSelect={(date) => onChange({ ...formData, answer_date: date })}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          
          <div className="relative min-w-[100px]">
            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="time"
              value={formData.answer_time || "00:00"}
              onChange={(e) => onChange({ ...formData, answer_time: e.target.value })}
              className="pl-9 w-full"
            />
          </div>
          
          <TimezoneSelector
            value={formData.answer_timezone || "Europe/Minsk"}
            onValueChange={(tz) => onChange({ ...formData, answer_timezone: tz })}
          />
        </div>
        
        {formData.answer_date && formData.answer_date > new Date() && (
          <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
            <Clock className="h-3 w-3" />
            Урок будет показан со статусом «Скоро» до указанной даты
          </p>
        )}
      </div>

      {/* Kinescope URL */}
      <div className="space-y-2">
        <Label htmlFor="kinescope-url">Ссылка на видео (Kinescope)</Label>
        <div className="relative">
          <Video className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="kinescope-url"
            value={formData.kinescope_url || ""}
            onChange={(e) => onChange({ ...formData, kinescope_url: e.target.value })}
            placeholder="https://kinescope.io/..."
            className="pl-10"
          />
        </div>
      </div>

      {/* Thumbnail */}
      <div className="space-y-2">
        <Label>Превью выпуска</Label>
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
            disabled={isGenerating || !formData.episode_number}
            title="Сгенерировать AI"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </Button>
        </div>

        {formData.thumbnail_url && (
          <div className="relative mt-2 inline-block">
            <img
              src={formData.thumbnail_url}
              alt="Превью"
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

      {/* Questions Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between sticky top-0 bg-background z-10 py-2 -mt-2">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-primary" />
            <Label className="text-base font-medium">Вопросы к выпуску</Label>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addQuestion}
            className="gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить вопрос
          </Button>
        </div>

        {formData.questions.length === 0 ? (
          <Alert className="border-muted bg-muted/30">
            <AlertDescription className="text-muted-foreground">
              Нет вопросов. Нажмите «Добавить вопрос» или оставьте пустым для выпуска без вопросов.
            </AlertDescription>
          </Alert>
        ) : (
          <div 
            className="space-y-3 pr-2 border rounded-md p-2 bg-muted/20"
            style={{ maxHeight: '240px', overflowY: 'auto' }}
          >
            {formData.questions.map((q, index) => (
              <KbQuestionInput
                key={index}
                data={q}
                onChange={(data) => updateQuestion(index, data)}
                onRemove={() => removeQuestion(index)}
                index={index}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * Generate lesson slug from episode number
 */
export function generateKbLessonSlug(episodeNumber: number): string {
  return `episode-${episodeNumber}`;
}
