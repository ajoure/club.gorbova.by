/**
 * DealPayerDocumentsCard — единая карточка «Документы / плательщик».
 *
 * SOT источников для авто-значений (шаблон / исполнитель / тип плательщика):
 *   1) tariff_offers.meta.document_scenarios[]  — сценарий по способу оплаты + типу плательщика
 *   2) tariff_offers.meta.document_defaults     — fallback (legacy)
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

const SUCCEEDED = new Set(["succeeded"]);

type PayerType = "individual" | "legal_entity";

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

const PAYMENT_LABEL: Record<string, string> = {
  card: "Карта",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  erip: "ЕРИП",
  bank_transfer: "Банковский перевод",
  other: "Иное",
};

function derivePaymentChannel(p: PaymentRow | null): string | null {
  if (!p) return null;
  const m = (p.meta || {}) as any;
  if (m?.is_erip === true || m?.payment_method === "erip") return "erip";
  const pm = (m?.payment_method || "").toString().toLowerCase();
  if (["apple_pay", "google_pay", "bank_transfer"].includes(pm)) return pm;
  if (["credit_card", "card"].includes(pm)) return "card";
  if (p.card_last4) return "card";
  if (p.provider === "admin" || p.provider === "admin_test") return "other";
  return "other";
}

function reqLabel(r: ReqRow): string {
  const d = (r.data || {}) as any;
  // Физлицо
  const ind =
    d.ind_full_name ||
    [d.ind_last_name, d.ind_first_name, d.ind_middle_name].filter(Boolean).join(" ").trim();
  // Юрлицо / ИП
  const leg =
    d.leg_short_name || d.leg_name ||
    d.ent_short_name || d.ent_name ||
    d.grp_short_name || d.grp_full_name;
  // Универсальные
  const generic = d.short_name || d.full_name || d.name || d.fio;
  return ind || leg || generic || `Карточка ${r.id.slice(0, 8)}`;
}

interface ResolvedScenario {
  source: "scenario" | "defaults" | "none";
  payer_type: PayerType | null;
  template_id: string | null;
  executor_id: string | null;
}

function resolveScenario(offerMeta: any, channel: string | null): ResolvedScenario {
  const scenarios: any[] = Array.isArray(offerMeta?.document_scenarios) ? offerMeta.document_scenarios : [];
  if (channel && scenarios.length > 0) {
    const match = scenarios.find((s) => {
      const methods: string[] = Array.isArray(s?.payment_methods) ? s.payment_methods : [];
      return methods.length === 0 || methods.includes(channel);
    });
    if (match) {
      return {
        source: "scenario",
        payer_type: (match.payer_type as PayerType) || null,
        template_id: match.template_id || null,
        executor_id: match.executor_id || null,
      };
    }
  }
  const defs = offerMeta?.document_defaults;
  if (defs && (defs.template_id || defs.executor_id)) {
    return {
      source: "defaults",
      payer_type: (defs.payer_type as PayerType) || null,
      template_id: defs.template_id || null,
      executor_id: defs.executor_id || null,
    };
  }
  return { source: "none", payer_type: null, template_id: null, executor_id: null };
}

function sourceLabel(s: ResolvedScenario["source"]): string {
  if (s === "scenario") return "По сценарию кнопки";
  if (s === "defaults") return "По умолчанию";
  return "Источник не задан";
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
      supabase.from("executors").select("id, full_name, short_name").order("full_name"),
      offerId
        ? supabase.from("tariff_offers").select("meta").eq("id", offerId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const succ = (pays || []).find((p: any) => SUCCEEDED.has(p.status)) || null;
    setPayment(succ as PaymentRow | null);
    setTemplates((tmpls || []) as TemplateRow[]);
    setExecutors((execs || []) as ExecutorRow[]);
    setOfferMeta((offerRes as any)?.data?.meta || null);

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

  const channel = useMemo(() => derivePaymentChannel(payment), [payment]);
  const resolved = useMemo(() => resolveScenario(offerMeta, channel), [offerMeta, channel]);

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

  const channelLabel = channel ? PAYMENT_LABEL[channel] || "Иное" : "—";
  const cardSuffix =
    payment?.card_last4 ? `•••• ${payment.card_last4}${payment.card_brand ? ` ${payment.card_brand}` : ""}` : null;

  const payerSourceBadge = payerTypeSource === "admin_override"
    ? "Изменено вручную администратором"
    : "Определено автоматически";
  const templateSourceBadge = templateOverride
    ? "Изменено вручную администратором"
    : sourceLabel(resolved.source);
  const executorSourceBadge = executorOverride
    ? "Изменено вручную администратором"
    : sourceLabel(resolved.source);
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
                  ? `${sourceLabel(resolved.source)} · ${templates.find((t) => t.id === resolved.template_id)?.name || "шаблон"}`
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
                  ? `${sourceLabel(resolved.source)} · ${
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
