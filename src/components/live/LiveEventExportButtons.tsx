import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { exportToExcel, type ExportColumn } from "@/utils/exportTableData";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface LiveEventExportButtonsProps {
  liveEventId: string;
  eventTitle?: string;
}

export function LiveEventExportButtons({ liveEventId, eventTitle }: LiveEventExportButtonsProps) {
  const [exporting, setExporting] = useState<string | null>(null);
  const prefix = eventTitle || "webinar";
  const dateSuffix = format(new Date(), "yyyy-MM-dd");

  const exportComments = async () => {
    setExporting("comments");
    try {
      const { data, error } = await supabase
        .from("live_event_comments")
        .select("id, user_id, content, created_at, author_display_name, author_role")
        .eq("live_event_id", liveEventId)
        .order("created_at", { ascending: true })
        .limit(1000);
      if (error) throw error;

      const columns: ExportColumn<typeof data[0]>[] = [
        { header: "Дата/время", getValue: (r) => format(new Date(r.created_at), "dd.MM.yyyy HH:mm:ss", { locale: ru }) },
        { header: "Автор", getValue: (r) => r.author_display_name || "—" },
        { header: "Роль", getValue: (r) => r.author_role || "user" },
        { header: "Текст", getValue: (r) => r.content },
      ];
      await exportToExcel(data || [], columns, `${prefix}_comments_${dateSuffix}.xlsx`);
      toast.success("Комментарии экспортированы");
    } catch (e) {
      console.error(e);
      toast.error("Ошибка экспорта комментариев");
    } finally {
      setExporting(null);
    }
  };

  const exportQuestions = async () => {
    setExporting("questions");
    try {
      const { data, error } = await supabase
        .from("live_event_questions")
        .select("id, user_id, content, is_answered, created_at, author_display_name, author_role")
        .eq("live_event_id", liveEventId)
        .order("created_at", { ascending: true })
        .limit(1000);
      if (error) throw error;

      const columns: ExportColumn<typeof data[0]>[] = [
        { header: "Дата/время", getValue: (r) => format(new Date(r.created_at), "dd.MM.yyyy HH:mm:ss", { locale: ru }) },
        { header: "Автор", getValue: (r) => r.author_display_name || "—" },
        { header: "Роль", getValue: (r) => r.author_role || "user" },
        { header: "Текст", getValue: (r) => r.content },
        { header: "Отвечен", getValue: (r) => r.is_answered ? "Да" : "Нет" },
      ];
      await exportToExcel(data || [], columns, `${prefix}_questions_${dateSuffix}.xlsx`);
      toast.success("Вопросы экспортированы");
    } catch (e) {
      console.error(e);
      toast.error("Ошибка экспорта вопросов");
    } finally {
      setExporting(null);
    }
  };

  const exportScenario = async () => {
    setExporting("scenario");
    try {
      const { data, error } = await supabase.rpc("get_live_event_scenario", {
        _live_event_id: liveEventId,
      });
      if (error) throw error;

      const entries = (data || []) as Array<{
        entry_id: string;
        entry_type: string;
        display_name: string | null;
        entry_text: string;
        visibility_scope: string | null;
        created_at: string;
      }>;

      const typeLabels: Record<string, string> = {
        comment: "Комментарий",
        question: "Вопрос",
        reply: "Ответ",
        moderation: "Модерация",
        cta_shown: "CTA показан",
        cta_hidden: "CTA скрыт",
        cta_replaced: "CTA заменён",
        cta_clicked: "CTA клик",
        cta_form_submitted: "CTA форма",
      };

      const columns: ExportColumn<typeof entries[0]>[] = [
        { header: "Дата/время", getValue: (r) => format(new Date(r.created_at), "dd.MM.yyyy HH:mm:ss", { locale: ru }) },
        { header: "Тип", getValue: (r) => typeLabels[r.entry_type] || r.entry_type },
        { header: "Автор", getValue: (r) => r.display_name || "—" },
        { header: "Текст", getValue: (r) => r.entry_text },
        { header: "Видимость", getValue: (r) => r.visibility_scope === "private" ? "Приватный" : "Публичный" },
      ];
      await exportToExcel(entries, columns, `${prefix}_scenario_${dateSuffix}.xlsx`);
      toast.success("Сценарий экспортирован");
    } catch (e) {
      console.error(e);
      toast.error("Ошибка экспорта сценария");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={exportComments} disabled={!!exporting}>
        {exporting === "comments" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        Комментарии
      </Button>
      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={exportQuestions} disabled={!!exporting}>
        {exporting === "questions" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        Вопросы
      </Button>
      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={exportScenario} disabled={!!exporting}>
        {exporting === "scenario" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        Сценарий
      </Button>
    </div>
  );
}
