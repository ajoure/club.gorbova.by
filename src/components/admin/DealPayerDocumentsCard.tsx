/**
 * DealPayerDocumentsCard — единая карточка «Документы / плательщик».
 *
 * SOT источников для авто-значений (шаблон / исполнитель / тип плательщика):
 *   1) orders_v2.meta.documents.template_override / executor_override (ручное)
 *   2) tariff_offers.meta.document_scenarios[]  — live matched scenario
 *   3) tariff_offers.meta.document_defaults     — fallback
 *   4) block/warning, если значения нет
 *
 * Если admin не менял вручную — карточка показывает live matched scenario.
 * Override отображается только при фактическом ручном изменении.
 *
 * Ручные изменения админа пишутся ТОЛЬКО в orders_v2.meta.documents.* через
 * canonical-deal-document-overrides (JWT actor + audit). payments_v2 не трогается.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, UserCog, CreditCard, RefreshCw, AlertCircle, CheckCircle2, FileDown, FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import { useHasRoleV2 } from "@/hooks/useHasRoleV2";
import { derivePaymentChannel, CHANNEL_LABELS_RU, type PaymentChannel } from "@/utils/derivePaymentChannel";
import { resolveDocumentScenario, sourceLabelRu, type PayerType as ResolverPayerType } from "@/utils/resolveDocumentScenario";

const SUCCEEDED = new Set(["succeeded"]);

type PayerType = ResolverPayerType;

interface OrderRow {
  id: string;
  user_id: string | null;
  offer_id: string | null;
  payer_type: PayerType | string;
  meta: any;
}
interface PaymentRow {
  id: string; status: string;
  card_brand: string | null; card_last4: string | null; card_holder: string | null;
  paid_at: string | null; created_at: string;
  meta: any; provider: string | null;
}
interface ReqRow { id: string; data: any; is_default: boolean | null; }
interface TemplateRow { id: string; name: string; }
interface ExecutorRow { id: string; full_name: string | null; short_name: string | null; }
interface HistoryDoc {
  id: string; title: string | null;
  file_path: string | null; storage_bucket: string | null;
  created_at: string; document_number: string | null;
}

function reqLabel(r: ReqRow): string {
  const d = (r.data || {}) as any;
  const ind =
    d.ind_full_name ||
    [d.ind_last_name, d.ind_first_name, d.ind_middle_name].filter(Boolean).join(" ").trim();
  const leg =
    d.leg_short_name || d.leg_name ||
    d.ent_short_name || d.ent_name ||
    d.grp_short_name || d.grp_full_name;
  const generic = d.short_name || d.full_name || d.name || d.fio;
  return ind || leg || generic || `Карточка ${r.id.slice(0, 8)}`;
}


export function DealPayerDocumentsCard({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [payment, setPayment] = useState<PaymentRow | null>(null);
  const [offerMeta, setOfferMeta] = useState<any>(null);
  const [individuals, setIndividuals] = useState<ReqRow[]>([]);
  const [legalEntities, setLegalEntities] = useState<ReqRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [executors, setExecutors] = useState<ExecutorRow[]>([]);
  const [history, setHistory] = useState<HistoryDoc[]>([]);
  const [generating, setGenerating] = useState(false);

  const [edPayerType, setEdPayerType] = useState<PayerType | null>(null);
  const [edEntityKey, setEdEntityKey] = useState<string | null>(null);
  const [edTemplate, setEdTemplate] = useState<string | null>(null);
  const [edExecutor, setEdExecutor] = useState<string | null>(null);

  const { hasRole: isAdmin } = useHasRoleV2("admin");
  const { hasRole: isSuper } = useHasRoleV2("super_admin");
  const canEdit = isAdmin || isSuper;

  const load = async () => {
    setLoading(true);
    const { data: o } = await supabase
      .from("orders_v2")
      .select("id, user_id, offer_id, payer_type, meta")
      .eq("id", orderId)
      .maybeSingle();
    setOrder(o as OrderRow | null);

    const offerId = (o as any)?.offer_id || null;
    const [{ data: pays }, { data: tmpls }, { data: execs }, offerRes] = await Promise.all([
      supabase.from("payments_v2")
        .select("id, status, card_brand, card_last4, card_holder, paid_at, created_at, meta, provider")
        .eq("order_id", orderId)
        .order("paid_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase.from("document_templates")
        .select("id, name, current_version_id, template_status")
        .not("current_version_id", "is", null)
        .eq("template_status", "active")
        .order("name"),
      supabase.from("executors").select("id, full_name, short_name").eq("is_active", true).order("full_name"),
      offerId
        ? supabase.from("tariff_offers").select("meta").eq("id", offerId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const succ = (pays || []).find((p: any) => SUCCEEDED.has(p.status)) || null;
    setPayment(succ as PaymentRow | null);
    setTemplates((tmpls || []) as TemplateRow[]);
    setExecutors((execs || []) as ExecutorRow[]);
    setOfferMeta((offerRes as any)?.data?.meta || null);

    const { data: docs } = await supabase
      .from("ai_generated_documents")
      .select("id, title, file_path, storage_bucket, created_at, document_number")
      .eq("context_type", "order")
      .eq("context_id", orderId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    setHistory((docs || []) as HistoryDoc[]);

    const userId = (o as any)?.user_id;
    if (userId) {
      const [{ data: ind }, { data: le }] = await Promise.all([
        supabase.from("individual_requisites")
          .select("id, data, is_default")
          .eq("owner_user_id", userId)
          .order("is_default", { ascending: false }),
        supabase.from("legal_entities_requisites")
          .select("id, data, is_default")
          .eq("owner_user_id", userId)
          .order("is_default", { ascending: false }),
      ]);
      setIndividuals((ind || []) as ReqRow[]);
      setLegalEntities((le || []) as ReqRow[]);
    } else {
      setIndividuals([]); setLegalEntities([]);
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [orderId]);

  const documents = (order?.meta as any)?.documents || {};
  const payerTypeSource: string = documents.payer_type_source || "auto";
  const payerEntityOverride = documents.payer_entity_override as { kind: string; id: string } | null;
  const templateOverride: string | null = documents.template_override || null;
  const executorOverride: string | null = documents.executor_override || null;

  const channel = useMemo(() => derivePaymentChannel(payment as any), [payment]);
  // Live matched scenario: payer_type для матча берём из orders_v2.payer_type
  // (SOT-колонка). Если null — fallback 'individual'.
  const resolverPayerType: PayerType = (order?.payer_type as PayerType) || "individual";
  const resolved = useMemo(
    () => resolveDocumentScenario(offerMeta as any, channel as PaymentChannel | null, resolverPayerType),
    [offerMeta, channel, resolverPayerType],
  );

  useEffect(() => {
    if (!order) return;
    setEdPayerType((order.payer_type as PayerType) || resolved.payer_type || "individual");
    setEdEntityKey(payerEntityOverride ? `${payerEntityOverride.kind}:${payerEntityOverride.id}` : "auto");
    setEdTemplate(templateOverride || "auto");
    setEdExecutor(executorOverride || "auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  const dirty = useMemo(() => {
    if (!order) return false;
    if (edPayerType && edPayerType !== order.payer_type) return true;
    const curEntity = payerEntityOverride ? `${payerEntityOverride.kind}:${payerEntityOverride.id}` : "auto";
    if ((edEntityKey || "auto") !== curEntity) return true;
    if ((edTemplate || "auto") !== (templateOverride || "auto")) return true;
    if ((edExecutor || "auto") !== (executorOverride || "auto")) return true;
    return false;
  }, [order, edPayerType, edEntityKey, edTemplate, edExecutor, payerEntityOverride, templateOverride, executorOverride]);

  const hasManualOverrides = !!(payerEntityOverride || templateOverride || executorOverride || payerTypeSource === "admin_override");

  const effectiveTemplateId = templateOverride || resolved.template_id;
  const effectiveExecutorId = executorOverride || resolved.executor_id;
  const effectivePayerType: PayerType = (order?.payer_type as PayerType) || resolved.payer_type || "individual";

  // Статус
  const statusItems = useMemo(() => {
    const items: { kind: "ok" | "warn" | "err"; text: string }[] = [];
    if (!effectiveTemplateId) {
      items.push({ kind: "err", text: "Документ не может быть сформирован — не выбран шаблон" });
    }
    if (!effectiveExecutorId) {
      items.push({ kind: "err", text: "Документ не может быть сформирован — не выбран исполнитель" });
    }
    // Реквизиты
    const list = effectivePayerType === "legal_entity" ? legalEntities : individuals;
    const hasRequisites = list.length > 0;
    if (!hasRequisites) {
      items.push({ kind: "err", text: "Не заполнены обязательные реквизиты" });
    } else if (items.length === 0) {
      items.push({ kind: "ok", text: "Реквизиты заполнены" });
    }
    return items;
  }, [effectiveTemplateId, effectiveExecutorId, effectivePayerType, individuals, legalEntities]);

  const save = async () => {
    if (!order || !canEdit) return;
    const changes: Record<string, unknown> = {};
    if (edPayerType && edPayerType !== order.payer_type) changes.payer_type = edPayerType;

    const curEntity = payerEntityOverride ? `${payerEntityOverride.kind}:${payerEntityOverride.id}` : "auto";
    if ((edEntityKey || "auto") !== curEntity) {
      if (!edEntityKey || edEntityKey === "auto") changes.payer_entity_override = null;
      else {
        const [kind, id] = edEntityKey.split(":");
        changes.payer_entity_override = { kind, id };
      }
    }
    if ((edTemplate || "auto") !== (templateOverride || "auto")) {
      changes.template_override = edTemplate === "auto" ? null : edTemplate;
    }
    if ((edExecutor || "auto") !== (executorOverride || "auto")) {
      changes.executor_override = edExecutor === "auto" ? null : edExecutor;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-deal-document-overrides", {
        body: { order_id: order.id, changes },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Изменения сохранены");
      await load();
    } catch (e: any) {
      toast.error(`Сохранение: ${normalizeEdgeFunctionError(e, e?.context?.body ?? null)}`);
    } finally {
      setSaving(false);
    }
  };

  const resetAll = async () => {
    if (!order || !canEdit) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-deal-document-overrides", {
        body: {
          order_id: order.id,
          changes: {
            payer_entity_override: null,
            template_override: null,
            executor_override: null,
          },
          clear_payer_override: true,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Ручные изменения сброшены");
      await load();
    } catch (e: any) {
      toast.error(`Сброс: ${normalizeEdgeFunctionError(e, e?.context?.body ?? null)}`);
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    if (!order || !effectiveTemplateId) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-document-generate-strict", {
        body: { mode: "generate", order_id: order.id, template_id: effectiveTemplateId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Документ создан");
      const url = (data as any)?.download_url;
      if (url) window.open(url, "_blank");
      await load();
    } catch (e: any) {
      toast.error(`Создание документа: ${normalizeEdgeFunctionError(e, e?.context?.body ?? null)}`);
    } finally {
      setGenerating(false);
    }
  };

  const downloadHistoryItem = async (h: HistoryDoc) => {
    if (!h.file_path || !h.storage_bucket) { toast.error("Файл недоступен"); return; }
    const { data, error } = await supabase.storage.from(h.storage_bucket).createSignedUrl(h.file_path, 3600);
    if (error || !data?.signedUrl) { toast.error("Не удалось получить ссылку"); return; }
    window.open(data.signedUrl, "_blank");
  };

  if (loading || !order) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCog className="h-4 w-4 text-primary" /> Документы / плательщик
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
        </CardContent>
      </Card>
    );
  }

  const channelLabel = channel ? CHANNEL_LABELS_RU[channel as PaymentChannel] || "Иное" : "—";
  const cardSuffix =
    payment?.card_last4 ? `•••• ${payment.card_last4}${payment.card_brand ? ` ${payment.card_brand}` : ""}` : null;

  const payerSourceBadge = payerTypeSource === "admin_override"
    ? "Изменено вручную администратором"
    : "Определено автоматически";
  // Override бейдж показывается ТОЛЬКО при фактическом ручном изменении.
  // Иначе — live matched scenario (или defaults / none).
  const templateSourceBadge = templateOverride
    ? "Изменено вручную администратором"
    : sourceLabelRu(resolved.source);
  const executorSourceBadge = executorOverride
    ? "Изменено вручную администратором"
    : sourceLabelRu(resolved.source);
  const entitySourceBadge = payerEntityOverride
    ? "Изменено вручную администратором"
    : "По умолчанию";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <UserCog className="h-4 w-4 text-primary" /> Документы / плательщик
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Способ оплаты — read-only */}
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Способ оплаты:</span>
          <Badge variant="outline">{channelLabel}</Badge>
          {cardSuffix && <span className="text-xs text-muted-foreground">{cardSuffix}</span>}
          {payment?.card_holder && <span className="text-xs text-muted-foreground">· {payment.card_holder}</span>}
          {!payment && (
            <span className="text-xs text-amber-600 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> Успешного платежа нет
            </span>
          )}
        </div>

        {/* Тип плательщика */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Тип плательщика</span>
            <Badge variant={payerTypeSource === "admin_override" ? "default" : "outline"} className="text-[10px]">
              {payerSourceBadge}
            </Badge>
          </div>
          <Select
            value={edPayerType || "individual"}
            onValueChange={(v) => setEdPayerType(v as PayerType)}
            disabled={!canEdit || saving}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="individual">Физлицо</SelectItem>
              <SelectItem value="legal_entity">Юрлицо</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Карточка реквизитов плательщика */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Карточка реквизитов плательщика</span>
            <Badge variant={payerEntityOverride ? "default" : "outline"} className="text-[10px]">
              {entitySourceBadge}
            </Badge>
          </div>
          <Select
            value={edEntityKey || "auto"}
            onValueChange={(v) => setEdEntityKey(v)}
            disabled={!canEdit || saving}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">По умолчанию (карточка пользователя)</SelectItem>
              {individuals.length > 0 && (
                <>
                  <div className="px-2 pt-1 text-[10px] uppercase text-muted-foreground">Физлицо</div>
                  {individuals.map((r) => (
                    <SelectItem key={`ind-${r.id}`} value={`individual:${r.id}`}>
                      {reqLabel(r)}{r.is_default ? " · по умолчанию" : ""}
                    </SelectItem>
                  ))}
                </>
              )}
              {legalEntities.length > 0 && (
                <>
                  <div className="px-2 pt-1 text-[10px] uppercase text-muted-foreground">Юрлицо</div>
                  {legalEntities.map((r) => (
                    <SelectItem key={`le-${r.id}`} value={`legal_entity:${r.id}`}>
                      {reqLabel(r)}{r.is_default ? " · по умолчанию" : ""}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Шаблон документа */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Шаблон документа</span>
            <Badge variant={templateOverride ? "default" : "outline"} className="text-[10px]">
              {templateSourceBadge}
            </Badge>
          </div>
          <Select value={edTemplate || "auto"} onValueChange={setEdTemplate} disabled={!canEdit || saving}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                {resolved.template_id
                  ? `${sourceLabelRu(resolved.source)} · ${templates.find((t) => t.id === resolved.template_id)?.name || "шаблон"}`
                  : "Автоматически (не задан в кнопке)"}
              </SelectItem>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Исполнитель */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Исполнитель</span>
            <Badge variant={executorOverride ? "default" : "outline"} className="text-[10px]">
              {executorSourceBadge}
            </Badge>
          </div>
          <Select value={edExecutor || "auto"} onValueChange={setEdExecutor} disabled={!canEdit || saving}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                {resolved.executor_id
                  ? `${sourceLabelRu(resolved.source)} · ${
                      executors.find((e) => e.id === resolved.executor_id)?.short_name
                      || executors.find((e) => e.id === resolved.executor_id)?.full_name
                      || "исполнитель"
                    }`
                  : "Автоматически (не задан в кнопке)"}
              </SelectItem>
              {executors.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.short_name || e.full_name || e.id.slice(0, 8)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Статус */}
        <div className="space-y-1 pt-2 border-t">
          <div className="text-xs font-medium text-muted-foreground">Статус</div>
          {statusItems.map((s, i) => (
            <div key={i} className={`text-xs flex items-center gap-1.5 ${
              s.kind === "ok" ? "text-emerald-600"
              : s.kind === "warn" ? "text-amber-600"
              : "text-rose-600"
            }`}>
              {s.kind === "ok" ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              <span>{s.text}</span>
            </div>
          ))}
        </div>

        {/* Создание документа */}
        <div className="pt-2 border-t space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-muted-foreground">
              {effectiveTemplateId && effectiveExecutorId
                ? "Готово к созданию документа"
                : "Заполните шаблон и исполнителя, чтобы создать документ"}
            </div>
            <Button
              size="sm"
              onClick={generate}
              disabled={!canEdit || generating || saving || dirty || !effectiveTemplateId || !effectiveExecutorId}
              title={dirty ? "Сначала сохраните изменения" : undefined}
            >
              {generating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FilePlus2 className="h-3 w-3 mr-1" />}
              Создать документ
            </Button>
          </div>
          {history.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">История ({history.length})</div>
              {history.slice(0, 5).map((h) => (
                <div key={h.id} className="flex items-center justify-between text-xs gap-2 bg-muted/40 rounded px-2 py-1">
                  <div className="truncate">
                    <span className="font-medium">{h.document_number || h.title || "Документ"}</span>
                    <span className="text-muted-foreground ml-2">
                      {new Date(h.created_at).toLocaleString("ru-RU")}
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => downloadHistoryItem(h)}>
                    <FileDown className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t gap-2 flex-wrap">
          <div className="text-xs text-muted-foreground">Платежные данные не изменяются</div>
          <div className="flex gap-2">
            {hasManualOverrides && canEdit && (
              <Button size="sm" variant="ghost" onClick={resetAll} disabled={saving}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Сбросить ручные изменения
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={!canEdit || saving || !dirty}>
              {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
              Сохранить изменения
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
