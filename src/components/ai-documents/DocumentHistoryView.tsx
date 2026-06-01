/**
 * DocumentHistoryView — Sprint 3R.
 *
 * Простая история сформированных документов для вкладки «История».
 *  • mode="user"  — показываем документы текущего профиля.
 *  • mode="admin" — показываем последние документы всех пользователей.
 *
 * Источник: ai_generated_documents (без deleted_at), сортировка по created_at desc.
 * Скачивание — через canonical edge function (downloadDocumentBlob).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, FileDown, Loader2, History as HistoryIcon } from "lucide-react";
import { downloadDocumentBlob } from "@/utils/downloadDocumentBlob";
import { toast } from "sonner";

interface Props {
  mode: "user" | "admin";
}

type Row = {
  id: string;
  title: string | null;
  template_name: string | null;
  status: string;
  document_number: string | null;
  document_date: string | null;
  created_at: string;
  generation_error: string | null;
  file_mime: string | null;
};

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    generated: { label: "заполнено", cls: "bg-emerald-50 text-emerald-700 border-emerald-300" },
    partial:   { label: "частично", cls: "bg-amber-50 text-amber-700 border-amber-300" },
    failed:    { label: "ошибка",   cls: "bg-rose-50 text-rose-700 border-rose-300" },
    blocked:   { label: "заблокировано", cls: "bg-rose-50 text-rose-700 border-rose-300" },
    pending:   { label: "в работе", cls: "bg-muted text-muted-foreground border-muted" },
    error:     { label: "ошибка",   cls: "bg-rose-50 text-rose-700 border-rose-300" },
  };
  const v = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground border-muted" };
  return <Badge variant="outline" className={`text-[10px] ${v.cls}`}>{v.label}</Badge>;
}

export function DocumentHistoryView({ mode }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["document-history-view", mode],
    queryFn: async (): Promise<Row[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      let query = supabase
        .from("ai_generated_documents")
        .select("id, title, template_name, status, document_number, document_date, created_at, generation_error, file_mime")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(mode === "admin" ? 200 : 100);

      if (mode === "user") {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!profile) return [];
        query = query.eq("profile_id", profile.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 15_000,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-slate-50 flex items-center justify-center shrink-0">
          <HistoryIcon className="h-5 w-5 text-slate-500" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">История сформированных документов</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {mode === "admin"
              ? "Последние документы всех пользователей. Можно скачать PDF или Word."
              : "Документы, которые вы уже формировали. Можно скачать заново."}
          </p>
        </div>
      </div>

      <GlassCard className="p-3">
        {isLoading && (
          <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка истории…
          </div>
        )}
        {isError && (
          <div className="py-8 text-center text-sm text-rose-600">
            Не удалось загрузить историю. Попробуйте позже.
          </div>
        )}
        {!isLoading && !isError && (data?.length ?? 0) === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Пока пусто. История появится после первой генерации документов.
          </div>
        )}
        {!isLoading && !isError && (data?.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            {data!.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-xs px-2 py-2 rounded border bg-background">
                <FileText className="h-4 w-4 text-indigo-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.title || d.template_name || "Документ"}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {new Date(d.created_at).toLocaleString("ru-RU")}
                    {d.document_number ? ` · № ${d.document_number}` : ""}
                    {d.document_date ? ` · ${new Date(d.document_date).toLocaleDateString("ru-RU")}` : ""}
                    {d.generation_error ? ` · ${d.generation_error}` : ""}
                  </div>
                </div>
                {statusBadge(d.status)}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={async () => {
                    const res = await downloadDocumentBlob(d.id, "pdf");
                    if (!res.ok) toast.error((res as { message: string }).message);
                  }}
                >
                  <FileDown className="h-3.5 w-3.5 mr-1" /> PDF
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={async () => {
                    const res = await downloadDocumentBlob(d.id, "docx");
                    if (!res.ok) toast.error((res as { message: string }).message);
                  }}
                >
                  <FileDown className="h-3.5 w-3.5 mr-1" /> Word
                </Button>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
