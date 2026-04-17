/**
 * Site Questionnaire Editor — ТОЛЬКО тонкий selector/wrapper.
 *
 * ЗАПРЕЩЕНО: создавать собственный конструктор вопросов / копировать schema lesson_blocks /
 * рендерить второй editor. Источник истины — canonical lesson_blocks editor
 * (/admin/training-lessons/.../edit/...).
 *
 * Этот компонент только:
 * 1. Выбирает существующий lesson из служебного module __site_questionnaires__
 * 2. Создаёт новый служебный lesson и открывает CANONICAL editor в новой вкладке
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { HelpIcon } from "@/components/help/HelpComponents";

interface Props {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

const SERVICE_MODULE_SLUG = "__site_questionnaires__";

export function QuestionnaireBlockEditor({ content, onChange }: Props) {
  const lessonId = (content.lessonId as string) || "";
  const title = (content.title as string) || "";
  const subtitle = (content.subtitle as string) || "";
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const { data: serviceModule } = useQuery({
    queryKey: ["site-questionnaires-module"],
    queryFn: async () => {
      const { data } = await supabase
        .from("training_modules")
        .select("id, slug")
        .eq("slug", SERVICE_MODULE_SLUG)
        .maybeSingle();
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const { data: lessons } = useQuery({
    queryKey: ["site-questionnaire-lessons", serviceModule?.id],
    queryFn: async () => {
      if (!serviceModule?.id) return [];
      const { data } = await supabase
        .from("training_lessons")
        .select("id, title, slug, created_at")
        .eq("module_id", serviceModule.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!serviceModule?.id,
  });

  const handleCreate = async () => {
    if (!serviceModule?.id) {
      toast.error("Служебный модуль анкет не найден");
      return;
    }
    setCreating(true);
    try {
      const newTitle = title.trim() || `Анкета сайта ${new Date().toLocaleString("ru-RU")}`;
      const slug = `site-q-${Date.now().toString(36)}`;
      const { data, error } = await supabase
        .from("training_lessons")
        .insert({
          module_id: serviceModule.id,
          title: newTitle,
          slug,
          is_active: true,
          content_type: "blocks",
          completion_mode: "manual",
        })
        .select("id")
        .single();
      if (error) throw error;

      onChange({ ...content, lessonId: data.id });
      qc.invalidateQueries({ queryKey: ["site-questionnaire-lessons"] });
      toast.success("Анкета создана. Откройте редактор вопросов в новой вкладке.");
      // Открываем canonical editor lesson_blocks
      window.open(`/admin/training-lessons/${serviceModule.id}/edit/${data.id}`, "_blank");
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    }
    setCreating(false);
  };

  const openCanonicalEditor = () => {
    if (!lessonId || !serviceModule?.id) return;
    window.open(`/admin/training-lessons/${serviceModule.id}/edit/${lessonId}`, "_blank");
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
        Анкета на сайте использует <strong>тот же движок</strong>, что и обучение.
        Вопросы редактируются в каноническом редакторе уроков.
        Ответы сохраняются в карточке контакта и в разделе «Анкеты и обучение».
      </div>

      <div>
        <Label className="text-xs">Заголовок над анкетой (опционально)</Label>
        <Input
          value={title}
          onChange={(e) => onChange({ ...content, title: e.target.value })}
          placeholder="Пройдите анкету"
        />
      </div>
      <div>
        <Label className="text-xs">Подзаголовок (опционально)</Label>
        <Input
          value={subtitle}
          onChange={(e) => onChange({ ...content, subtitle: e.target.value })}
          placeholder="Это займёт 2 минуты"
        />
      </div>

      <div>
        <Label className="text-xs">Анкета</Label>
        <Select
          value={lessonId || "__none__"}
          onValueChange={(v) => onChange({ ...content, lessonId: v === "__none__" ? "" : v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Выберите существующую анкету" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Не выбрана</SelectItem>
            {(lessons || []).map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
          Создать новую
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={openCanonicalEditor}
          disabled={!lessonId}
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Редактировать вопросы
        </Button>
      </div>
    </div>
  );
}
