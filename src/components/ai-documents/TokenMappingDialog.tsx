/**
 * TokenMappingDialog — Sprint 3
 *
 * Сопоставить unmapped-токен из DOCX с существующим canonical token,
 * либо создать новый registry-token (с дедуп-проверками), либо просто скопировать.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertTriangle, Copy } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string;
  templateId: string;
  templateVersionId: string;
  onMapped?: () => void;
}

const CATEGORY_ORDER = ["executor", "customer", "deal", "document", "system", "legal_details", "custom"];

export function TokenMappingDialog({ open, onOpenChange, token, templateId, templateVersionId, onMapped }: Props) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"map" | "create" | "copy">("map");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"global" | "template" | "version">("template");
  const [selectedCanonical, setSelectedCanonical] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Create-form state
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newCategory, setNewCategory] = useState<string>("custom");
  const [newDataType, setNewDataType] = useState<string>("text");
  const [newRequired, setNewRequired] = useState(false);

  useEffect(() => {
    if (open) {
      setTab("map");
      setSearch("");
      setSelectedCanonical("");
      setNewKey(token);
      setNewLabel("");
      setNewCategory("custom");
      setNewRequired(false);
    }
  }, [open, token]);

  const { data: registry = [] } = useQuery({
    queryKey: ["doc-token-registry-all"],
    queryFn: async () => {
      const { data } = await supabase.from("document_token_registry")
        .select("token_key, ui_label, category, source_type, is_required")
        .is("archived_at", null)
        .order("category");
      return data || [];
    },
    enabled: open,
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = (registry as any[]).filter((r) =>
      !s || r.token_key.toLowerCase().includes(s) || (r.ui_label || "").toLowerCase().includes(s),
    );
    const groups: Record<string, any[]> = {};
    for (const r of list) {
      const cat = r.category || "custom";
      (groups[cat] = groups[cat] || []).push(r);
    }
    return CATEGORY_ORDER
      .filter((c) => groups[c])
      .map((c) => ({ category: c, items: groups[c] }))
      .concat(
        Object.keys(groups)
          .filter((c) => !CATEGORY_ORDER.includes(c))
          .map((c) => ({ category: c, items: groups[c] })),
      );
  }, [registry, search]);

  const fuzzyDuplicates = useMemo(() => {
    if (tab !== "create") return [];
    const s = (newLabel || newKey).toLowerCase();
    if (!s) return [];
    return (registry as any[]).filter((r) =>
      r.token_key.toLowerCase().includes(s) || (r.ui_label || "").toLowerCase().includes(s),
    ).slice(0, 5);
  }, [tab, newLabel, newKey, registry]);

  const handleCreateAlias = async () => {
    if (!selectedCanonical) { toast.error("Выберите canonical token"); return; }
    setBusy(true);
    try {
      const row: any = {
        alias_token: token,
        canonical_token_key: selectedCanonical,
        notes: `Mapped from template_version=${templateVersionId}`,
      };
      if (scope === "template") row.template_id = templateId;
      if (scope === "version") { row.template_id = templateId; row.template_version_id = templateVersionId; }
      const { error } = await supabase.from("document_token_aliases").insert(row);
      if (error) throw error;
      toast.success("Alias создан. Перепроверьте версию шаблона.");
      onMapped?.();
      qc.invalidateQueries({ queryKey: ["doc-template-versions", templateId] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Не удалось создать alias: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateRegistry = async () => {
    if (!newKey || !newLabel) { toast.error("Укажите canonical_key и ui_label"); return; }
    setBusy(true);
    try {
      // exact-key dup check
      const { data: dup } = await supabase.from("document_token_registry")
        .select("token_key").eq("token_key", newKey).maybeSingle();
      if (dup) { toast.error("Токен с таким token_key уже есть"); setBusy(false); return; }
      const { error } = await supabase.from("document_token_registry").insert({
        token_key: newKey,
        ui_label: newLabel,
        category: newCategory,
        source_type: newCategory === "legal_details" ? "custom_field" : "system",
        data_type: newDataType,
        is_required: newRequired,
        resolver_key: newKey,
      });
      if (error) throw error;
      // immediately also create alias if alias_token != canonical
      if (newKey !== token) {
        await supabase.from("document_token_aliases").insert({
          alias_token: token,
          canonical_token_key: newKey,
          template_id: templateId,
          notes: `Auto-created from new registry token`,
        });
      }
      toast.success("Новый токен создан и сопоставлен.");
      qc.invalidateQueries({ queryKey: ["doc-token-registry-all"] });
      qc.invalidateQueries({ queryKey: ["doc-template-versions", templateId] });
      onMapped?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Не удалось создать токен: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Сопоставить токен <code className="text-sm bg-muted px-1.5 py-0.5 rounded">{`{{${token}}}`}</code></DialogTitle>
          <DialogDescription>
            Можно сопоставить с существующим canonical-токеном, создать новый или просто скопировать имя для ручной правки DOCX.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="map">Сопоставить</TabsTrigger>
            <TabsTrigger value="create">Создать токен</TabsTrigger>
            <TabsTrigger value="copy">Скопировать</TabsTrigger>
          </TabsList>

          <TabsContent value="map" className="space-y-3">
            <Input placeholder="Поиск по token_key или label…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-72 overflow-auto border rounded-md divide-y">
              {filtered.map((g) => (
                <div key={g.category} className="p-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">{g.category}</div>
                  {g.items.map((r: any) => (
                    <button
                      key={r.token_key}
                      type="button"
                      onClick={() => setSelectedCanonical(r.token_key)}
                      className={`w-full text-left text-xs px-2 py-1 rounded hover:bg-muted/60 flex items-center gap-2 ${selectedCanonical === r.token_key ? "bg-primary/10" : ""}`}
                    >
                      <code className="font-mono text-[11px]">{r.token_key}</code>
                      <span className="text-muted-foreground truncate">— {r.ui_label}</span>
                      {r.is_required && <Badge variant="outline" className="border-rose-300 text-rose-700 ml-auto text-[10px]">required</Badge>}
                    </button>
                  ))}
                </div>
              ))}
              {filtered.length === 0 && <div className="p-3 text-xs text-muted-foreground">Ничего не найдено</div>}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Label>Scope:</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as any)}>
                <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="version">Только эта версия</SelectItem>
                  <SelectItem value="template">Весь шаблон</SelectItem>
                  <SelectItem value="global">Глобально</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="create" className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">canonical_key</Label>
                <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} className="font-mono text-xs" />
              </div>
              <div>
                <Label className="text-xs">ui_label</Label>
                <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Название для UI" />
              </div>
              <div>
                <Label className="text-xs">category</Label>
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_ORDER.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">data_type</Label>
                <Select value={newDataType} onValueChange={setNewDataType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["text","number","date","money","boolean"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} />
              is_required
            </label>
            {fuzzyDuplicates.length > 0 && (
              <div className="border border-amber-300 bg-amber-50/40 rounded-md p-2 text-xs">
                <div className="flex items-center gap-1 text-amber-800 font-semibold mb-1">
                  <AlertTriangle className="h-3 w-3" /> Возможные дубли — рассмотрите сопоставление вместо создания:
                </div>
                {fuzzyDuplicates.map((r: any) => (
                  <div key={r.token_key} className="text-amber-900">
                    <code className="font-mono">{r.token_key}</code> — {r.ui_label}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="copy" className="space-y-2">
            <div className="text-sm">Скопируйте токен, чтобы заменить его в DOCX вручную:</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-sm bg-muted px-3 py-2 rounded">{`{{${token}}}`}</code>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(`{{${token}}}`); toast.success("Скопировано"); }}>
                <Copy className="h-3 w-3 mr-1" /> Копировать
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          {tab === "map" && (
            <Button onClick={handleCreateAlias} disabled={busy || !selectedCanonical}>
              {busy && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Создать alias
            </Button>
          )}
          {tab === "create" && (
            <Button onClick={handleCreateRegistry} disabled={busy || !newKey || !newLabel}>
              {busy && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Создать токен
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
