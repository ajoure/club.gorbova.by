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
import { downloadDocumentBlob } from "@/utils/downloadDocumentBlob";

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

  // Расширенный fallback offer_id + snapshot-from-provenance — закрываем UI
  // ситуацию «Источник не задан» для админ-тест/public-link заказов и для случаев,
  // когда tariff_offers.meta не загрузился, но backend resolver уже зафиксировал
  // финальный template/executor в orders_v2.meta.document_data._provenance.
  const [offerMetaLoaded, setOfferMetaLoaded] = useState(false);
  const [resolvedOfferId, setResolvedOfferId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: o } = await supabase
      .from("orders_v2")
      .select("id, user_id, offer_id, payer_type, meta")
      .eq("id", orderId)
      .maybeSingle();
    setOrder(o as OrderRow | null);

    // Robust meta parse (на случай если в части ответов meta придёт строкой).
    const rawMeta = (o as any)?.meta;
    const meta = typeof rawMeta === "string"
      ? (() => { try { return JSON.parse(rawMeta); } catch { return {}; } })()
      : (rawMeta || {});

    // Полная fallback цепочка для offer_id (закрывает admin-test / public-link,
    // где column NULL): column → top-level meta → CRM snapshot → checkout/payment
    // → document_data provenance.
    const offerId: string | null =
      (o as any)?.offer_id
      || meta?.offer_id
      || meta?.tariff_offer_id
      || meta?.crm_routing_snapshot?.offer_id
      || meta?.checkout?.offer_id
      || meta?.payment?.offer_id
      || meta?.document_data?._provenance?.offer_id
      || null;
    setResolvedOfferId(offerId);

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
        .is("deleted_at", null)
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
    const fetchedOfferMeta = (offerRes as any)?.data?.meta || null;
    setOfferMeta(fetchedOfferMeta);
    setOfferMetaLoaded(!!fetchedOfferMeta);

    // Debug-proof — без visible UI.
    // eslint-disable-next-line no-console
    console.debug("[DealPayerDocumentsCard] offer resolution", {
      orderId: (o as any)?.id,
      columnOfferId: (o as any)?.offer_id,
      metaOfferId: meta?.offer_id,
      crmOfferId: meta?.crm_routing_snapshot?.offer_id,
      provenanceOfferId: meta?.document_data?._provenance?.offer_id,
      finalOfferId: offerId,
      offerMetaLoaded: !!fetchedOfferMeta,
    });

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

  // Backend snapshot fallback: если live-resolver не получил template/executor
  // (offerMeta не загрузился), но backend уже зафиксировал финальное решение в
  // orders_v2.meta.document_data._provenance — используем его как источник.
  const provenance = ((order?.meta as any)?.document_data?._provenance) || null;
  const snapshotTemplateId: string | null = provenance?.template_resolution?.final_template_id || null;
  const snapshotExecutorId: string | null = provenance?.executor_resolution?.final_executor_id || null;
  const snapshotSource: string | null = provenance?.scenario?.source || provenance?.template_resolution?.source || null;
  const usingSnapshotTemplate = !resolved.template_id && !!snapshotTemplateId;
  const usingSnapshotExecutor = !resolved.executor_id && !!snapshotExecutorId;

  // Guard: если templateOverride указывает на удалённый/неактивный шаблон — не используем его.
  const overrideTemplateExists = templateOverride ? templates.some((t) => t.id === templateOverride) : true;
  const templateOverrideDeleted = !!templateOverride && !overrideTemplateExists;
  const effectiveTemplateId =
    (overrideTemplateExists ? templateOverride : null)
    || resolved.template_id
    || snapshotTemplateId;
  const effectiveExecutorId =
    executorOverride
    || resolved.executor_id
    || snapshotExecutorId;
  const effectivePayerType: PayerType = (order?.payer_type as PayerType) || resolved.payer_type || "individual";

  // Статус — гранулярные причины (offer/scenario/template/executor).
  const statusItems = useMemo(() => {
    const items: { kind: "ok" | "warn" | "err"; text: string }[] = [];
    if (templateOverride && !overrideTemplateExists) {
      items.push({ kind: "warn", text: "Выбранный ранее шаблон удалён или деактивирован — используется шаблон по сценарию. Сохраните выбор шаблона заново." });
    }

    // Диагностика отсутствия шаблона/исполнителя — отделяем «нет оффера», «meta не загрузилась»,
    // «scenario без шаблона», «scenario без исполнителя».
    if (!effectiveTemplateId || !effectiveExecutorId) {
      if (!resolvedOfferId) {
        items.push({
          kind: "err",
          text: "Не удалось определить оффер сделки (offer_id отсутствует). Свяжите сделку с офером кнопки или выберите шаблон/исполнителя вручную.",
        });
      } else if (!offerMetaLoaded) {
        items.push({
          kind: "err",
          text: "Не удалось загрузить настройки кнопки (tariff_offers). Проверьте, что оффер активен, или выберите шаблон/исполнителя вручную.",
        });
      } else if (resolved.source === "none") {
        items.push({
          kind: "err",
          text: "Для выбранного типа плательщика и способа оплаты нет подходящего сценария в кнопке.",
        });
      } else {
        if (!effectiveTemplateId) {
          items.push({ kind: "err", text: "В сценарии кнопки не задан шаблон документа." });
        }
        if (!effectiveExecutorId) {
          items.push({ kind: "err", text: "В сценарии кнопки не задан исполнитель." });
        }
      }
    }

    // Реквизиты: ФЛ берёт individuals; ИП/ЮЛ — legalEntities (там лежат ent_* / leg_* в одной таблице)
    const list = effectivePayerType === "individual" ? individuals : legalEntities;
    const hasRequisites = list.length > 0;
    if (!hasRequisites) {
      items.push({ kind: "err", text: "Не заполнены обязательные реквизиты" });
    } else if (items.filter(i => i.kind === "err").length === 0) {
      items.push({ kind: "ok", text: "Реквизиты заполнены" });
    }
    return items;
  }, [effectiveTemplateId, effectiveExecutorId, effectivePayerType, individuals, legalEntities, templateOverride, overrideTemplateExists, resolvedOfferId, offerMetaLoaded, resolved.source]);

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
      const documentId = (data as any)?.document_id as string | undefined;
      if (!documentId) throw new Error("document_id_missing");
      toast.success("Документ создан");
      // ID-first: качаем blob через canonical edge function, не открываем download_url.
      const r = await downloadDocumentBlob(documentId, "pdf");
      if (r.ok === false) toast.error(r.message);
      await load();
    } catch (e: any) {
      toast.error(`Создание документа: ${normalizeEdgeFunctionError(e, e?.context?.body ?? null)}`);
    } finally {
      setGenerating(false);
    }
  };

  const downloadHistoryItem = async (h: HistoryDoc) => {
    // ID-first download — не используем storage_bucket / file_path.
    const r = await downloadDocumentBlob(h.id, "pdf");
    if (r.ok === false) toast.error(r.message);
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
              <SelectItem value="entrepreneur">ИП</SelectItem>
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
              {(() => {
                const isEntrepreneur = (r: ReqRow) => {
                  const d = (r.data || {}) as any;
                  return !!(d.ent_name || d.ent_unp || d.ent_short_name || d.is_entrepreneur === true || d.subject_type === 'entrepreneur');
                };
                const ips = legalEntities.filter(isEntrepreneur);
                const legs = legalEntities.filter((r) => !isEntrepreneur(r));
                return (
                  <>
                    {ips.length > 0 && (
                      <>
                        <div className="px-2 pt-1 text-[10px] uppercase text-muted-foreground">ИП</div>
                        {ips.map((r) => (
                          <SelectItem key={`ip-${r.id}`} value={`entrepreneur:${r.id}`}>
                            {reqLabel(r)}{r.is_default ? " · по умолчанию" : ""}
                          </SelectItem>
                        ))}
                      </>
                    )}
                    {legs.length > 0 && (
                      <>
                        <div className="px-2 pt-1 text-[10px] uppercase text-muted-foreground">Юрлицо</div>
                        {legs.map((r) => (
                          <SelectItem key={`le-${r.id}`} value={`legal_entity:${r.id}`}>
                            {reqLabel(r)}{r.is_default ? " · по умолчанию" : ""}
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </>
                );
              })()}
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
          {templateOverrideDeleted && (
            <div className="rounded border border-amber-300 bg-amber-50 text-amber-800 px-2 py-1.5 text-xs flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Шаблон удалён, выберите другой. Создание документа заблокировано до сохранения нового выбора.</span>
            </div>
          )}
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
              disabled={!canEdit || generating || saving || dirty || !effectiveTemplateId || !effectiveExecutorId || templateOverrideDeleted}
              title={
                templateOverrideDeleted
                  ? "Выберите новый шаблон — текущий удалён"
                  : dirty ? "Сначала сохраните изменения" : undefined
              }
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
