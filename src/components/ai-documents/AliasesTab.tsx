/**
 * AliasesTab — Sprint 4
 *
 * Список и управление document_token_aliases.
 * Создание идёт через TokenMappingDialog, удаление — с подтверждением и audit.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Trash2, RefreshCw, Link2, Plus } from "lucide-react";
import { toast } from "sonner";
import { TokenMappingDialog } from "./TokenMappingDialog";

interface AliasRow {
  id: string;
  alias_token: string;
  canonical_token_key: string;
  template_id: string | null;
  template_version_id: string | null;
  created_by: string | null;
  created_at: string;
  template?: { name: string; code: string | null } | null;
  version?: { version_number: number } | null;
}

function scopeOf(a: AliasRow): "global" | "template" | "version" {
  if (a.template_version_id) return "version";
  if (a.template_id) return "template";
  return "global";
}

const SCOPE_BADGE: Record<string, string> = {
  global: "border-emerald-300 text-emerald-700",
  template: "border-blue-300 text-blue-700",
  version: "border-amber-300 text-amber-700",
};

export function AliasesTab() {
  const qc = useQueryClient();
  const [filterAlias, setFilterAlias] = useState("");
  const [filterCanonical, setFilterCanonical] = useState("");
  const [filterScope, setFilterScope] = useState<string>("any");
  const [filterTemplate, setFilterTemplate] = useState<string>("any");
  const [createDlg, setCreateDlg] = useState(false);
  const [createTemplateId, setCreateTemplateId] = useState<string>("");
  const [createToken, setCreateToken] = useState<string>("");
  const [delTarget, setDelTarget] = useState<AliasRow | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ["doc-templates-for-aliases"],
    queryFn: async () => {
      const { data } = await supabase.from("document_templates").select("id, name, code").eq("is_active", true).order("name");
      return data || [];
    },
  });

  const { data: rows = [], isFetching, refetch } = useQuery<AliasRow[]>({
    queryKey: ["doc-token-aliases"],
    queryFn: async () => {
      const { data } = await supabase.from("document_token_aliases")
        .select("*, template:template_id(name, code), version:template_version_id(version_number)")
        .order("created_at", { ascending: false });
      return (data || []) as any;
    },
  });

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterAlias && !r.alias_token.toLowerCase().includes(filterAlias.toLowerCase())) return false;
      if (filterCanonical && !r.canonical_token_key.toLowerCase().includes(filterCanonical.toLowerCase())) return false;
      if (filterScope !== "any" && scopeOf(r) !== filterScope) return false;
      if (filterTemplate !== "any" && r.template_id !== filterTemplate) return false;
      return true;
    });
  }, [rows, filterAlias, filterCanonical, filterScope, filterTemplate]);

  const handleDelete = async () => {
    if (!delTarget) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("document_token_aliases").delete().eq("id", delTarget.id);
      if (error) throw error;
      await supabase.from("audit_logs").insert({
        action: "document.token_alias_deleted",
        actor_type: "user",
        meta: { alias_id: delTarget.id, alias_token: delTarget.alias_token, canonical_token_key: delTarget.canonical_token_key, scope: scopeOf(delTarget) },
      });
      toast.success("Alias удалён");
      setDelTarget(null);
      qc.invalidateQueries({ queryKey: ["doc-token-aliases"] });
    } catch (e: any) {
      toast.error(`Не удалось удалить: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRevalidate = async (a: AliasRow) => {
    try {
      const versionId = a.template_version_id;
      const templateId = a.template_id;
      if (!versionId && !templateId) { toast.error("Global alias — нет версии для перепроверки"); return; }
      const { data, error } = await supabase.functions.invoke("canonical-template-validate", {
        body: versionId ? { template_version_id: versionId } : { template_id: templateId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Перепроверка: mapped=${data.mapped_count}, unmapped=${data.unmapped_count}`);
    } catch (e: any) {
      toast.error(`Ошибка: ${e?.message || e}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          Алиасы токенов
          <Badge variant="outline" className="ml-2">{rows.length}</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-3 w-3 mr-1" /> Обновить
            </Button>
            <Button size="sm" onClick={() => setCreateDlg(true)} disabled={!templates.length}>
              <Plus className="h-3 w-3 mr-1" /> Создать alias
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Input placeholder="Фильтр alias" value={filterAlias} onChange={(e) => setFilterAlias(e.target.value)} />
          <Input placeholder="Фильтр canonical" value={filterCanonical} onChange={(e) => setFilterCanonical(e.target.value)} />
          <Select value={filterScope} onValueChange={setFilterScope}>
            <SelectTrigger><SelectValue placeholder="Scope" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Любой scope</SelectItem>
              <SelectItem value="global">global</SelectItem>
              <SelectItem value="template">template</SelectItem>
              <SelectItem value="version">version</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterTemplate} onValueChange={setFilterTemplate}>
            <SelectTrigger><SelectValue placeholder="Шаблон" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Все шаблоны</SelectItem>
              {templates.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isFetching && <div className="text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin inline mr-1" /> Загружаем…</div>}

        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-2 py-1.5">alias_token</th>
                <th className="px-2 py-1.5">canonical_token_key</th>
                <th className="px-2 py-1.5">scope</th>
                <th className="px-2 py-1.5">template</th>
                <th className="px-2 py-1.5">version</th>
                <th className="px-2 py-1.5">created_at</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const sc = scopeOf(a);
                return (
                  <tr key={a.id} className="border-t hover:bg-muted/30">
                    <td className="px-2 py-1.5 font-mono">{`{{${a.alias_token}}}`}</td>
                    <td className="px-2 py-1.5 font-mono">{a.canonical_token_key}</td>
                    <td className="px-2 py-1.5">
                      <Badge variant="outline" className={SCOPE_BADGE[sc]}>{sc}</Badge>
                    </td>
                    <td className="px-2 py-1.5">{a.template?.name || "—"}</td>
                    <td className="px-2 py-1.5">{a.version?.version_number ? `v${a.version.version_number}` : "—"}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{new Date(a.created_at).toLocaleString("ru-RU")}</td>
                    <td className="px-2 py-1.5 text-right">
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => handleRevalidate(a)} title="Перепроверить версию">
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-rose-600" onClick={() => setDelTarget(a)} title="Удалить">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && !isFetching && (
                <tr><td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">Алиасов нет</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <AlertDialog open={!!delTarget} onOpenChange={(o) => { if (!o) setDelTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить alias?</AlertDialogTitle>
              <AlertDialogDescription>
                После удаления токен <code>{`{{${delTarget?.alias_token}}}`}</code> снова станет unmapped в этом шаблоне. Действие будет залогировано.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} disabled={busy} className="bg-rose-600 hover:bg-rose-700">
                {busy && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {createDlg && (
          <div className="border rounded-md p-3 space-y-2 bg-muted/30">
            <div className="text-xs font-semibold">Новый alias</div>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="alias_token (как в DOCX)" value={createToken} onChange={(e) => setCreateToken(e.target.value)} />
              <Select value={createTemplateId} onValueChange={setCreateTemplateId}>
                <SelectTrigger><SelectValue placeholder="Шаблон (для scope=template)" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setCreateDlg(false); setCreateToken(""); }}>Отмена</Button>
              <Button size="sm" onClick={() => { /* открывает универсальный диалог сопоставления */ }} disabled={!createToken || !createTemplateId}>
                Открыть сопоставление
              </Button>
            </div>
            {createToken && createTemplateId && (
              <TokenMappingDialog
                open={true}
                onOpenChange={(o) => { if (!o) { setCreateDlg(false); setCreateToken(""); } }}
                token={createToken}
                templateId={createTemplateId}
                templateVersionId={""}
                onMapped={() => { qc.invalidateQueries({ queryKey: ["doc-token-aliases"] }); setCreateDlg(false); setCreateToken(""); }}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
