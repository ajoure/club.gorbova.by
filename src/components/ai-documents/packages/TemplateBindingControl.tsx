/**
 * TemplateBindingControl — Sprint 3F Phase 2b.
 *
 * Admin-only UI для привязки/отвязки `document_templates` к
 * `document_package_templates` через канонические RPC:
 *   - package_template_bind_template(_template_id, _package_template_id, _sort_order?)
 *   - package_template_unbind_template(_template_id, _package_template_id?)
 *
 * Никаких direct INSERT/DELETE/UPDATE в `document_package_template_items`
 * или `document_templates.template_scope`. Все мутации проходят через RPC,
 * который пишет audit_logs и синхронизирует template_scope.
 *
 * Ничего не вызывает в canonical-document-generate-strict / Gotenberg
 * / ai_generated_documents.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Link2, Unlink, FileText } from "lucide-react";
import { toast } from "sonner";

interface Props {
  packageTemplateId: string | null;
}

interface TemplateRow {
  id: string;
  name: string;
  template_scope: string | null;
  template_status: string;
}

interface BoundItem {
  id: string;
  template_id: string;
  sort_order: number;
  template_name: string;
  template_status: string;
}

const QK_BOUND = (pkgId: string | null) => ["pkg-bound-templates", pkgId];
const QK_ALL = ["pkg-all-templates"];

export function TemplateBindingControl({ packageTemplateId }: Props) {
  const qc = useQueryClient();
  const [pendingTemplateId, setPendingTemplateId] = useState<string>("");

  const boundQuery = useQuery({
    queryKey: QK_BOUND(packageTemplateId),
    queryFn: async () => {
      if (!packageTemplateId) return [] as BoundItem[];
      const { data, error } = await supabase
        .from("document_package_template_items")
        .select("id, template_id, sort_order")
        .eq("package_template_id", packageTemplateId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      const ids = (data ?? []).map((r) => r.template_id);
      if (ids.length === 0) return [];
      const { data: tpls } = await supabase
        .from("document_templates")
        .select("id, name, template_status")
        .in("id", ids);
      const map = new Map((tpls ?? []).map((t: any) => [t.id, t]));
      return (data ?? []).map((r: any) => ({
        id: r.id,
        template_id: r.template_id,
        sort_order: r.sort_order,
        template_name: (map.get(r.template_id) as any)?.name ?? "—",
        template_status: (map.get(r.template_id) as any)?.template_status ?? "—",
      })) as BoundItem[];
    },
    enabled: !!packageTemplateId,
  });

  const allTemplatesQuery = useQuery({
    queryKey: QK_ALL,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_templates")
        .select("id, name, template_scope, template_status")
        .is("deleted_at", null)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TemplateRow[];
    },
  });

  const bindMutation = useMutation({
    mutationFn: async (templateId: string) => {
      if (!packageTemplateId) throw new Error("Не выбран пакет");
      const { error } = await supabase.rpc("package_template_bind_template", {
        _template_id: templateId,
        _package_template_id: packageTemplateId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK_BOUND(packageTemplateId) });
      qc.invalidateQueries({ queryKey: QK_ALL });
      setPendingTemplateId("");
      toast.success("Шаблон привязан к пакету");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unbindMutation = useMutation({
    mutationFn: async (templateId: string) => {
      if (!packageTemplateId) throw new Error("Не выбран пакет");
      const { error } = await supabase.rpc("package_template_unbind_template", {
        _template_id: templateId,
        _package_template_id: packageTemplateId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK_BOUND(packageTemplateId) });
      qc.invalidateQueries({ queryKey: QK_ALL });
      toast.success("Шаблон отвязан");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bound = boundQuery.data ?? [];
  const boundIds = new Set(bound.map((b) => b.template_id));
  const available = (allTemplatesQuery.data ?? []).filter((t) => !boundIds.has(t.id));

  if (!packageTemplateId) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Выберите пакет, чтобы управлять привязкой шаблонов.
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Link2 className="h-4 w-4 text-emerald-500" />
            Шаблоны пакета
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Привязка идёт через admin-only RPC с автоматическим выставлением
            <code className="mx-1">template_scope = "package"</code> и audit-логом.
          </p>
        </div>
      </div>

      {/* Bind new */}
      <div className="flex items-center gap-2">
        <Select value={pendingTemplateId} onValueChange={setPendingTemplateId}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Выберите шаблон для привязки…" />
          </SelectTrigger>
          <SelectContent>
            {available.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                Все шаблоны уже привязаны или каталог пуст.
              </div>
            ) : (
              available.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{t.name}</span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                      scope: {t.template_scope ?? "—"}
                    </Badge>
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!pendingTemplateId || bindMutation.isPending}
          onClick={() => bindMutation.mutate(pendingTemplateId)}
        >
          {bindMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <Link2 className="h-3.5 w-3.5 mr-1" /> Привязать
            </>
          )}
        </Button>
      </div>

      {/* Bound list */}
      {boundQuery.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : bound.length === 0 ? (
        <div className="text-xs text-muted-foreground py-3 text-center border border-dashed rounded">
          К пакету пока не привязано ни одного шаблона.
        </div>
      ) : (
        <ul className="divide-y border rounded">
          {bound.map((b) => (
            <li key={b.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                #{b.sort_order}
              </Badge>
              <FileText className="h-3.5 w-3.5 text-emerald-500" />
              <span className="flex-1 truncate">{b.template_name}</span>
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                {b.template_status}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                disabled={unbindMutation.isPending}
                onClick={() => unbindMutation.mutate(b.template_id)}
              >
                <Unlink className="h-3.5 w-3.5 mr-1" /> Отвязать
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
