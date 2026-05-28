/**
 * PackageContentsList — Sprint 3F Phase 2c.
 *
 * Read-only «Состав пакета» для не-админов и сводный обзор для админов.
 * Источник: `document_package_template_items` + join `document_templates`.
 *
 * Ничего не мутирует — для управления привязками используется
 * `TemplateBindingControl` (вкладка «Шаблоны пакета», admin-only) и форма
 * загрузки во вкладке «Шаблоны документов».
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2 } from "lucide-react";

interface Props {
  packageTemplateId: string;
  packageName: string;
}

interface Row {
  id: string;
  sort_order: number;
  template_id: string;
  template_name: string;
  template_status: string | null;
}

export function PackageContentsList({ packageTemplateId, packageName }: Props) {
  const query = useQuery({
    queryKey: ["package-contents-list", packageTemplateId],
    queryFn: async () => {
      const { data: items, error } = await supabase
        .from("document_package_template_items")
        .select("id, sort_order, template_id")
        .eq("package_template_id", packageTemplateId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      const ids = (items ?? []).map((r: any) => r.template_id);
      if (ids.length === 0) return [] as Row[];
      const { data: tpls } = await supabase
        .from("document_templates")
        .select("id, name, template_status")
        .in("id", ids);
      const map = new Map((tpls ?? []).map((t: any) => [t.id, t]));
      return (items ?? []).map((r: any) => ({
        id: r.id,
        sort_order: r.sort_order,
        template_id: r.template_id,
        template_name: (map.get(r.template_id) as any)?.name ?? "—",
        template_status: (map.get(r.template_id) as any)?.template_status ?? null,
      })) as Row[];
    },
  });

  if (query.isLoading) {
    return (
      <Card className="p-6 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  const rows = query.data ?? [];

  if (rows.length === 0) {
    return (
      <Card className="p-6 text-sm text-center text-muted-foreground space-y-2">
        <div>В пакете «{packageName}» пока нет шаблонов.</div>
        <div className="text-xs">
          Загрузите шаблон во вкладке «Шаблоны документов» и выберите пакет
          «{packageName}» в форме загрузки — шаблон сразу появится здесь.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Состав пакета</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Шаблоны, входящие в пакет. Управление привязкой — во вкладке
          «Шаблоны пакета» (admin) или при загрузке шаблона.
        </p>
      </div>
      <ul className="divide-y border rounded">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
              #{r.sort_order}
            </Badge>
            <FileText className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            <span className="flex-1 truncate">{r.template_name}</span>
            {r.template_status && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                {r.template_status}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
