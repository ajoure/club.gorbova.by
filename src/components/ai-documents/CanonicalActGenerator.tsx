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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FileText, Eye, Download, AlertTriangle, CheckCircle2, Lock, Search, X, Package, User, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { DocumentsHowItWorks } from "./DocumentsHowItWorks";
import { OrderPickerDialog, type OrderPickResult } from "./OrderPickerDialog";
import { LegalDetailsPickerDialog, type LegalDetailsPickResult } from "./LegalDetailsPickerDialog";

function FieldHint({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="inline-flex text-muted-foreground/70 hover:text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

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
  const [orderPick, setOrderPick] = useState<OrderPickResult | null>(null);
  const [legalPick, setLegalPick] = useState<LegalDetailsPickResult | null>(null);
  const [orderPickerOpen, setOrderPickerOpen] = useState(false);
  const [legalPickerOpen, setLegalPickerOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<{ document_number: string; download_url?: string; reused?: boolean } | null>(null);

  const contextId = orderPick?.id ?? "";
  const legalDetailsId = legalPick?.id ?? "";

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
      toast.success(`Документ сформирован: ${data.document_number}${data.reused ? " (загружен из истории)" : ""}`);
      setLastGenerated({
        document_number: data.document_number,
        download_url: data.download_url,
        reused: !!data.reused,
      });
    } catch (e: any) {
      toast.error(`Ошибка генерации: ${e?.message || e}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const canGenerate = !!preview && preview.missing_tokens.length === 0 && featureEnabled;

  return (
    <div className="space-y-4">
      <DocumentsHowItWorks />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            Акты выполненных работ
            {featureEnabled ? (
              <Badge variant="outline" className="ml-auto text-emerald-600 border-emerald-300">Модуль включён</Badge>
            ) : (
              <Badge variant="outline" className="ml-auto text-amber-600 border-amber-300">
                <Lock className="h-3 w-3 mr-1" /> Модуль выключен
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                Шаблон DOCX
                <FieldHint text="Выберите Word-шаблон, по которому будет создан акт. В шаблоне должны быть плейсхолдеры вида {{customer.name}}, {{deal.amount}} и т.д." />
              </Label>
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
              <Label className="flex items-center gap-1.5">
                Источник данных
                <FieldHint text="Откуда система возьмёт данные для заполнения документа: из заказа или вручную (по реквизитам клиента)." />
              </Label>
              <Select value={contextType} onValueChange={(v) => setContextType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Вручную (без заказа)</SelectItem>
                  <SelectItem value="order">Из заказа</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {contextType === "order" && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  Заказ
                  <FieldHint text="Найдите заказ по номеру или email клиента. Система возьмёт сумму, продукт, тариф и клиента из этого заказа." />
                </Label>
                {orderPick ? (
                  <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-2">
                    <Package className="h-4 w-4 mt-0.5 text-indigo-500" />
                    <div className="flex-1 min-w-0 text-xs">
                      <div className="font-mono font-medium">{orderPick.order_number}</div>
                      <div className="text-muted-foreground truncate">
                        {orderPick.product_name || "—"} · {orderPick.final_price.toFixed(2)} {orderPick.currency}
                        {orderPick.customer_email ? ` · ${orderPick.customer_email}` : ""}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setOrderPickerOpen(true)}>Изменить</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setOrderPick(null); setPreview(null); }}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full justify-start" onClick={() => setOrderPickerOpen(true)}>
                    <Search className="h-4 w-4 mr-2" /> Выбрать заказ
                  </Button>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                Реквизиты клиента (необязательно)
                <FieldHint text="Если у клиента несколько комплектов реквизитов — выберите нужный. Иначе система возьмёт реквизиты по умолчанию." />
              </Label>
              {legalPick ? (
                <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-2">
                  {legalPick.client_type === "individual"
                    ? <User className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    : <Building2 className="h-4 w-4 mt-0.5 text-indigo-500" />}
                  <div className="flex-1 min-w-0 text-xs">
                    <div className="font-medium truncate">{legalPick.display_name}</div>
                    <div className="text-muted-foreground truncate">
                      {legalPick.display_unp ? `УНП ${legalPick.display_unp}` : ""}
                      {legalPick.email ? ` · ${legalPick.email}` : ""}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setLegalPickerOpen(true)}>Изменить</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setLegalPick(null); setPreview(null); }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <Button variant="outline" className="w-full justify-start" onClick={() => setLegalPickerOpen(true)}>
                  <Search className="h-4 w-4 mr-2" /> Выбрать реквизиты
                </Button>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={handlePreview} disabled={isLoading || !templateId} variant="outline">
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                    Предпросмотр данных
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">Проверить, какие данные будут подставлены в документ, без создания файла.</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={handleGenerate} disabled={!canGenerate || isGenerating}>
                    {isGenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                    Сформировать DOCX
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">Создать Word-файл акта и сохранить его в истории документов.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {!featureEnabled && (
            <div className="text-xs text-amber-900 rounded-md bg-amber-50 border border-amber-200 p-3">
              <b>Новый генератор документов пока выключен.</b> Его можно тестировать в режиме предпросмотра, но создание файлов заблокировано до включения настройки администратором.
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
              Предпросмотр данных
              <Badge variant="outline" className="ml-2">
                Версия шаблона: {preview.template.version_number ?? "—"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.missing_tokens.length > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm space-y-2">
                <div className="font-medium text-amber-800">
                  Не заполнены обязательные поля ({preview.missing_tokens.length}). Документ нельзя сформировать, пока их не заполнить.
                </div>
                <ul className="space-y-1">
                  {preview.missing_tokens.map((t) => {
                    const trace = preview.source_trace?.[t];
                    return (
                      <li key={t} className="text-xs text-amber-900">
                        <code className="font-mono">{t}</code>
                        {trace?.source && <span className="text-amber-700"> ← {trace.source}</span>}
                        {MISSING_HINTS[t] && <div className="text-amber-700/90 italic mt-0.5">{MISSING_HINTS[t]}</div>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {preview.unmapped_template_tokens.length > 0 && (
              <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-sm space-y-2">
                <div className="font-medium text-slate-800">
                  В шаблоне есть несопоставленные плейсхолдеры ({preview.unmapped_template_tokens.length}). Они будут пустыми в документе. Сопоставьте их с полями системы на вкладке «Связи плейсхолдеров» или замените в файле.
                </div>
                <div className="flex flex-wrap gap-1">
                  {preview.unmapped_template_tokens.map((t) => {
                    const loc = preview.token_manifest?.find((m) => m.token === t)?.locations;
                    return (
                      <Badge key={t} variant="outline" className="border-slate-300 text-slate-700" title={loc?.map(l => `${l.part} ×${l.count}`).join(", ")}>
                        {t}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}

            {TOKEN_GROUPS.map((group, gi) => {
              // Distribute tokens to first matching group; "unknown" catches the rest
              const seen = new Set<string>();
              for (let i = 0; i < gi; i++) {
                for (const t of preview.template_tokens) if (TOKEN_GROUPS[i].match(t)) seen.add(t);
              }
              const tokens = (preview.template_tokens.length
                ? preview.template_tokens
                : Object.keys(preview.resolved_tokens)
              ).filter((t) => !seen.has(t) && group.match(t));
              if (!tokens.length) return null;
              return (
                <div key={group.key} className="border rounded-md overflow-hidden">
                  <div className="bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide">
                    {group.label} <span className="text-muted-foreground">({tokens.length})</span>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {tokens.sort().map((k) => {
                        const v = preview.resolved_tokens[k];
                        const trace = preview.source_trace?.[k];
                        const loc = preview.token_manifest?.find((m) => m.token === k)?.locations;
                        const isMissing = trace?.status === "missing" && trace.required;
                        const isUnmapped = trace?.status === "unmapped";
                        return (
                          <tr key={k} className="border-t">
                            <td className="p-2 align-top w-1/3">
                              <div className="font-mono text-[11px] text-muted-foreground break-all">{k}</div>
                              {trace?.source && (
                                <div className="text-[10px] text-muted-foreground mt-0.5">← {trace.source}</div>
                              )}
                              {loc?.length ? (
                                <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                                  {loc.map((l) => `${l.part.replace("word/", "")} ×${l.count}`).join(", ")}
                                </div>
                              ) : null}
                            </td>
                            <td className="p-2 align-top">
                              {v ? (
                                <span>{v}</span>
                              ) : isUnmapped ? (
                                <span className="text-slate-500 italic">не сопоставлен — нет в реестре полей</span>
                              ) : isMissing ? (
                                <span className="text-amber-700 italic">обязательное поле — не заполнено</span>
                              ) : (
                                <span className="text-muted-foreground italic">пусто</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
