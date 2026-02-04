import React, { memo, useRef, useState, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  Sparkles,
  Loader2,
  X,
  CalendarIcon,
  Plus,
  Video,
  HelpCircle,
  Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { KbQuestionInput, KbQuestionInputData } from "./KbQuestionInput";
import { generateLessonSlug, LessonFormDataSimple } from "./LessonFormFieldsSimple";
import { KbLessonFormData } from "./KbLessonFormFields";
import { TimezoneSelector } from "@/components/admin/payments/TimezoneSelector";

interface UniversalLessonFormFieldsProps {
  isKbSection: boolean; // true = "Номер выпуска", false = "Название урока"
  lessonData: LessonFormDataSimple;
  kbData: KbLessonFormData;
  onLessonChange: (data: LessonFormDataSimple) => void;
  onKbChange: (data: KbLessonFormData) => void;
}

/**
 * Universal form for lesson creation in both KB and regular sections
 * - KB sections: show "Номер выпуска *"
 * - Other sections: show "Название урока *" + slug
 * - Shared fields: Date, Time, Timezone, Kinescope URL, Thumbnail, Questions
 */
export const UniversalLessonFormFields = memo(function UniversalLessonFormFields({
  isKbSection,
  lessonData,
  kbData,
  onLessonChange,
  onKbChange,
}: UniversalLessonFormFieldsProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle title change (for non-KB sections)
  const handleTitleChange = (newTitle: string) => {
    onLessonChange({
      ...lessonData,
      title: newTitle,
      slug: generateLessonSlug(newTitle),
    });
  };

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

      if (isKbSection) {
        onKbChange({ ...kbData, thumbnail_url: urlData.publicUrl });
      } else {
        onLessonChange({ ...lessonData, thumbnail_url: urlData.publicUrl });
      }
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
    const title = isKbSection
      ? `Выпуск №${kbData.episode_number}`
      : lessonData.title;

    if (!title || (isKbSection && !kbData.episode_number)) {
      toast.error(
        isKbSection
          ? "Введите номер выпуска для генерации обложки"
          : "Введите название урока для генерации обложки"
      );
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

      const description = isKbSection
        ? kbData.questions?.length
          ? kbData.questions.map((q) => q.title).join(", ")
          : "Вопросы бухгалтеров"
        : lessonData.description || "";

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
        if (isKbSection) {
          onKbChange({ ...kbData, thumbnail_url: result.url });
        } else {
          onLessonChange({ ...lessonData, thumbnail_url: result.url });
        }
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
    if (isKbSection) {
      onKbChange({ ...kbData, thumbnail_url: "" });
    } else {
      onLessonChange({ ...lessonData, thumbnail_url: "" });
    }
  };

  // Question management - works with both flows (questions stored appropriately)
  const questions = isKbSection ? kbData.questions : lessonData.questions || [];

  const addQuestion = useCallback(() => {
    const newNumber = questions.length + 1;
    const newQuestion = {
      question_number: newNumber,
      title: "",
      full_question: "",
      timecode: "",
    };

    if (isKbSection) {
      onKbChange({
        ...kbData,
        questions: [...kbData.questions, newQuestion],
      });
    } else {
      onLessonChange({
        ...lessonData,
        questions: [...(lessonData.questions || []), newQuestion],
      });
    }
  }, [isKbSection, kbData, lessonData, questions, onKbChange, onLessonChange]);

  const updateQuestion = useCallback(
    (index: number, data: KbQuestionInputData) => {
      if (isKbSection) {
        const updated = [...kbData.questions];
        updated[index] = data;
        onKbChange({ ...kbData, questions: updated });
      } else {
        const updated = [...(lessonData.questions || [])];
        updated[index] = data;
        onLessonChange({ ...lessonData, questions: updated });
      }
    },
    [isKbSection, kbData, lessonData, onKbChange, onLessonChange]
  );

  const removeQuestion = useCallback(
    (index: number) => {
      if (isKbSection) {
        const updated = kbData.questions.filter((_, i) => i !== index);
        updated.forEach((q, i) => {
          q.question_number = i + 1;
        });
        onKbChange({ ...kbData, questions: updated });
      } else {
        const updated = (lessonData.questions || []).filter((_, i) => i !== index);
        updated.forEach((q, i) => {
          q.question_number = i + 1;
        });
        onLessonChange({ ...lessonData, questions: updated });
      }
    },
    [isKbSection, kbData, lessonData, onKbChange, onLessonChange]
  );

  // Date/Time/Timezone handlers for non-KB (stored in lessonData)
  const answerDate = isKbSection ? kbData.answer_date : lessonData.answer_date;
  const answerTime = isKbSection
    ? kbData.answer_time || "00:00"
    : lessonData.answer_time || "00:00";
  const answerTimezone = isKbSection
    ? kbData.answer_timezone || "Europe/Minsk"
    : lessonData.answer_timezone || "Europe/Minsk";
  const kinescopeUrl = isKbSection
    ? kbData.kinescope_url || ""
    : lessonData.kinescope_url || "";
  const thumbnailUrl = isKbSection
    ? kbData.thumbnail_url || ""
    : lessonData.thumbnail_url || "";

  const handleDateChange = (date: Date | undefined) => {
    if (isKbSection) {
      onKbChange({ ...kbData, answer_date: date });
    } else {
      onLessonChange({ ...lessonData, answer_date: date });
    }
  };

  const handleTimeChange = (time: string) => {
    if (isKbSection) {
      onKbChange({ ...kbData, answer_time: time });
    } else {
      onLessonChange({ ...lessonData, answer_time: time });
    }
  };

  const handleTimezoneChange = (tz: string) => {
    if (isKbSection) {
      onKbChange({ ...kbData, answer_timezone: tz });
    } else {
      onLessonChange({ ...lessonData, answer_timezone: tz });
    }
  };

  const handleKinescopeChange = (url: string) => {
    if (isKbSection) {
      onKbChange({ ...kbData, kinescope_url: url });
    } else {
      onLessonChange({ ...lessonData, kinescope_url: url });
    }
  };

  const handleThumbnailUrlChange = (url: string) => {
    if (isKbSection) {
      onKbChange({ ...kbData, thumbnail_url: url });
    } else {
      onLessonChange({ ...lessonData, thumbnail_url: url });
    }
  };

  const canGenerateAI = isKbSection
    ? kbData.episode_number > 0
    : !!lessonData.title;

  return (
    <div className="space-y-6">
      {/* Primary field: Episode number OR Title */}
      {isKbSection ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="episode-number">Номер выпуска *</Label>
            <Input
              id="episode-number"
              type="number"
              min={1}
              value={kbData.episode_number || ""}
              onChange={(e) =>
                onKbChange({
                  ...kbData,
                  episode_number: parseInt(e.target.value) || 0,
                })
              }
              placeholder="101"
            />
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lesson-title">Название урока *</Label>
              <Input
                id="lesson-title"
                value={lessonData.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Введение в тему"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lesson-slug">URL-адрес</Label>
              <Input
                id="lesson-slug"
                value={lessonData.slug}
                onChange={(e) =>
                  onLessonChange({ ...lessonData, slug: e.target.value })
                }
                placeholder="vvedenie-v-temu"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Краткое описание</Label>
            <Textarea
              value={lessonData.description || ""}
              onChange={(e) =>
                onLessonChange({ ...lessonData, description: e.target.value })
              }
              placeholder="О чём этот урок..."
              rows={2}
            />
          </div>
        </>
      )}

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
                  !answerDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {answerDate
                  ? format(answerDate, "dd.MM.yyyy", { locale: ru })
                  : "Дата"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={answerDate}
                onSelect={handleDateChange}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <div className="relative min-w-[100px]">
            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="time"
              value={answerTime}
              onChange={(e) => handleTimeChange(e.target.value)}
              className="pl-9 w-full"
            />
          </div>

          <TimezoneSelector
            value={answerTimezone}
            onValueChange={handleTimezoneChange}
          />
        </div>

        {answerDate && answerDate > new Date() && (
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
            value={kinescopeUrl}
            onChange={(e) => handleKinescopeChange(e.target.value)}
            placeholder="https://kinescope.io/..."
            className="pl-10"
          />
        </div>
      </div>

      {/* Thumbnail */}
      <div className="space-y-2">
        <Label>Превью урока</Label>
        <div className="flex gap-2">
          <Input
            value={thumbnailUrl}
            onChange={(e) => handleThumbnailUrlChange(e.target.value)}
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
            disabled={isGenerating || !canGenerateAI}
            title="Сгенерировать AI"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </Button>
        </div>

        {thumbnailUrl && (
          <div className="relative mt-2 inline-block">
            <img
              src={thumbnailUrl}
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
            <Label className="text-base font-medium">Вопросы к уроку</Label>
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

        {questions.length === 0 ? (
          <Alert className="border-muted bg-muted/30">
            <AlertDescription className="text-muted-foreground">
              Нет вопросов. Нажмите «Добавить вопрос» или оставьте пустым.
            </AlertDescription>
          </Alert>
        ) : (
          <div
            className="space-y-3 pr-2 border rounded-md p-2 bg-muted/20"
            style={{ maxHeight: "240px", overflowY: "auto" }}
          >
            {questions.map((q, index) => (
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
