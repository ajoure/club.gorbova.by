/**
 * CanonicalActGenerator — Sprint 1 MVP
 *
 * Назначение: создать DOCX-акт выполненных работ через canonical pipeline.
 * 1. Выбор шаблона (document_templates)
 * 2. Контекст: Order ID (опционально) или ручной customer (legal_details_id)
 * 3. Кнопка "Предпросмотр" → вызывает canonical-document-generate (mode=preview)
 * 4. Таблица токенов (resolved / missing / unmapped)
 * 5. Кнопка "Сформировать DOCX" — gated по feature flag и отсутствию missing
 *
 * Feature-flag: app_settings.documents_canonical_generation_enabled.
 * Если флаг false — generate возвращает ошибку, кнопка disabled.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FileText, Eye, Download, AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { toast } from "sonner";

interface SourceTraceEntry {
  source: string;
  resolver_key?: string;
  field_id?: string | null;
  status: "resolved" | "missing" | "unmapped";
  required: boolean;
}

interface TokenManifestEntry {
  token: string;
  locations: { part: string; count: number; raw_example?: string }[];
  total_count: number;
}

interface PreviewPayload {
  success: boolean;
  feature_enabled?: boolean;
  resolved_tokens: Record<string, string>;
  missing_tokens: string[];
  unmapped_template_tokens: string[];
  warnings: string[];
  template: { id: string; name: string; version_id: string | null; version_number: number | null };
  template_tokens: string[];
  token_manifest?: TokenManifestEntry[];
  source_trace?: Record<string, SourceTraceEntry>;
}

const TOKEN_GROUPS: { key: string; label: string; match: (t: string) => boolean }[] = [
  { key: "executor", label: "Исполнитель", match: (t) => t.startsWith("executor.") },
  { key: "customer", label: "Заказчик", match: (t) => t.startsWith("customer.") },
  { key: "deal", label: "Сделка", match: (t) => t.startsWith("deal.") },
  { key: "document", label: "Документ", match: (t) => t.startsWith("document.") },
  { key: "system", label: "Системные", match: (t) => t.startsWith("system.") },
  { key: "legal_details", label: "Реквизиты (custom)", match: (t) => t.startsWith("legal_details.") },
  { key: "unknown", label: "Неизвестные", match: () => true },
];

const MISSING_HINTS: Record<string, string> = {
  "deal.product_name": "Заполните продукт в сделке (orders_v2.product_id).",
  "deal.amount": "Заполните сумму сделки (orders_v2.final_price).",
  "deal.amount_words": "Сумма прописью считается из deal.amount + deal.currency.",
  "customer.name": "Выберите реквизиты клиента или добавьте подписанта.",
  "customer.unp": "Заполните УНП клиента в его юридических реквизитах.",
  "executor.name": "Не задан исполнитель по умолчанию (executors.is_default).",
  "executor.unp": "Заполните УНП в карточке исполнителя.",
  "document.number": "Номер генерируется автоматически — обратитесь к админу.",
  "document.date": "Дата документа генерируется автоматически.",
};

export function CanonicalActGenerator() {
  const [templateId, setTemplateId] = useState<string>("");
  const [contextType, setContextType] = useState<"none" | "order">("none");
  const [contextId, setContextId] = useState<string>("");
  const [legalDetailsId, setLegalDetailsId] = useState<string>("");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: flagRow } = useQuery({
    queryKey: ["docs-canonical-flag"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "documents_canonical_generation_enabled").maybeSingle();
      return data;
    },
  });
  const featureEnabled = flagRow?.value === true;

  const { data: templates = [] } = useQuery({
    queryKey: ["doc-templates-canonical"],
    queryFn: async () => {
      const { data } = await supabase
        .from("document_templates")
        .select("id, name, code, document_type, template_path")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  const handlePreview = async () => {
    if (!templateId) { toast.error("Выберите шаблон"); return; }
    setIsLoading(true);
    setPreview(null);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-document-generate", {
        body: {
          mode: "preview",
          template_id: templateId,
          context_type: contextType === "order" ? "order" : null,
          context_id: contextType === "order" ? contextId || null : null,
          legal_details_id: legalDetailsId || null,
        },
      });
      if (error) throw error;
      setPreview(data);
    } catch (e: any) {
      toast.error(`Ошибка предпросмотра: ${e?.message || e}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!templateId) return;
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-document-generate", {
        body: {
          mode: "generate",
          template_id: templateId,
          context_type: contextType === "order" ? "order" : null,
          context_id: contextType === "order" ? contextId || null : null,
          legal_details_id: legalDetailsId || null,
        },
      });
      if (error) throw error;
      if (!data?.success) {
        toast.error(`Не удалось сформировать: ${data?.error || "unknown"}`);
        return;
      }
      toast.success(`Документ сформирован: ${data.document_number}${data.reused ? " (из кэша)" : ""}`);
      if (data.download_url) {
        const a = document.createElement("a");
        a.href = data.download_url;
        a.download = `${data.document_number}.docx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (e: any) {
      toast.error(`Ошибка генерации: ${e?.message || e}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const canGenerate = !!preview && preview.missing_tokens.length === 0 && featureEnabled;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            Канонический генератор актов (Sprint 1 MVP)
            {featureEnabled ? (
              <Badge variant="outline" className="ml-auto text-emerald-600 border-emerald-300">Feature flag: ON</Badge>
            ) : (
              <Badge variant="outline" className="ml-auto text-amber-600 border-amber-300">
                <Lock className="h-3 w-3 mr-1" /> Feature flag: OFF
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Шаблон DOCX</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="Выберите шаблон" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} {t.code ? `· ${t.code}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Контекст</Label>
              <Select value={contextType} onValueChange={(v) => setContextType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Без контекста (ручной)</SelectItem>
                  <SelectItem value="order">Заказ (orders_v2)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {contextType === "order" && (
              <div className="space-y-1.5">
                <Label>Order ID</Label>
                <Input value={contextId} onChange={(e) => setContextId(e.target.value)} placeholder="UUID заказа" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Customer Legal Details ID (опционально)</Label>
              <Input value={legalDetailsId} onChange={(e) => setLegalDetailsId(e.target.value)} placeholder="UUID реквизитов" />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handlePreview} disabled={isLoading || !templateId} variant="outline">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
              Предпросмотр данных
            </Button>
            <Button onClick={handleGenerate} disabled={!canGenerate || isGenerating}>
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
              Сформировать DOCX
            </Button>
          </div>

          {!featureEnabled && (
            <div className="text-xs text-muted-foreground rounded-md bg-amber-50 border border-amber-200 p-2">
              Генерация выключена feature-flag. Включите <code>documents_canonical_generation_enabled</code> в app_settings.
            </div>
          )}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {preview.missing_tokens.length === 0
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                : <AlertTriangle className="h-4 w-4 text-amber-600" />}
              Резолв токенов
              <Badge variant="outline" className="ml-2">
                version: {preview.template.version_number ?? "—"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.missing_tokens.length > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-2 text-sm">
                <div className="font-medium text-amber-800 mb-1">Не хватает обязательных токенов:</div>
                <div className="flex flex-wrap gap-1">
                  {preview.missing_tokens.map((t) => (
                    <Badge key={t} variant="outline" className="border-amber-300 text-amber-700">{t}</Badge>
                  ))}
                </div>
              </div>
            )}

            {preview.unmapped_template_tokens.length > 0 && (
              <div className="rounded-md bg-slate-50 border border-slate-200 p-2 text-sm">
                <div className="font-medium text-slate-800 mb-1">Токены в шаблоне без маппинга в реестре (передадутся пустыми):</div>
                <div className="flex flex-wrap gap-1">
                  {preview.unmapped_template_tokens.map((t) => (
                    <Badge key={t} variant="outline" className="border-slate-300 text-slate-700">{t}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="overflow-auto max-h-[400px] border rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="text-left p-2 font-medium">Токен</th>
                    <th className="text-left p-2 font-medium">Значение</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(preview.resolved_tokens)
                    .filter(([k]) => preview.template_tokens.length === 0 || preview.template_tokens.includes(k))
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, v]) => (
                      <tr key={k} className="border-t">
                        <td className="p-2 font-mono text-[11px] text-muted-foreground">{k}</td>
                        <td className="p-2">{v || <span className="text-muted-foreground italic">пусто</span>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
