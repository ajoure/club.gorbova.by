/**
 * DealPayerDocumentsCard
 * ----------------------
 * Document-level admin overrides for an order:
 *  - payer_type (individual | legal_entity), with auto vs admin_override badge;
 *  - payer entity (individual_requisites / legal_entities_requisites);
 *  - document template override;
 *  - executor override.
 *
 * Read-only display of:
 *  - canonical successful payment (payment_channel + brand/last4) — derived
 *    client-side, NEVER mutated.
 *
 * STOP-guards (mirrored from edge function):
 *  - never touches payments_v2;
 *  - admin override only — does NOT change real payment channel;
 *  - all writes go through `canonical-deal-document-overrides` (JWT actor + audit).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, UserCog, CreditCard, RefreshCw, FileType2, Wand2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import { useHasRoleV2 } from "@/hooks/useHasRoleV2";

const SUCCEEDED = new Set(["succeeded"]);

type PayerType = "individual" | "legal_entity";

interface OrderRow {
  id: string;
  user_id: string | null;
  payer_type: PayerType | string;
  meta: any;
}
interface PaymentRow {
  id: string;
  status: string;
  card_brand: string | null;
  card_last4: string | null;
  card_holder: string | null;
  paid_at: string | null;
  created_at: string;
  meta: any;
  provider: string | null;
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
  const d = r.data || {};
  return (
    d.short_name || d.full_name || d.name || d.fio ||
    `${d.last_name || ""} ${d.first_name || ""}`.trim() ||
    r.id.slice(0, 8)
  );
}

export function DealPayerDocumentsCard({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [payment, setPayment] = useState<PaymentRow | null>(null);
  const [individuals, setIndividuals] = useState<ReqRow[]>([]);
  const [legalEntities, setLegalEntities] = useState<ReqRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [executors, setExecutors] = useState<ExecutorRow[]>([]);

  // pending edits
  const [edPayerType, setEdPayerType] = useState<PayerType | null>(null);
  const [edEntityKey, setEdEntityKey] = useState<string | null>(null); // "auto" | "{kind}:{id}"
  const [edTemplate, setEdTemplate] = useState<string | null>(null); // "auto" | uuid
  const [edExecutor, setEdExecutor] = useState<string | null>(null); // "auto" | uuid

  const { hasRole: isAdmin } = useHasRoleV2("admin");
  const { hasRole: isSuper } = useHasRoleV2("super_admin");
  const canEdit = isAdmin || isSuper;

  const load = async () => {
    setLoading(true);
    const { data: o } = await supabase
      .from("orders_v2")
      .select("id, user_id, payer_type, meta")
      .eq("id", orderId)
      .maybeSingle();
    setOrder(o as OrderRow | null);

    const [{ data: pays }, { data: tmpls }, { data: execs }] = await Promise.all([
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
    ]);
    const succ = (pays || []).find((p: any) => SUCCEEDED.has(p.status)) || null;
    setPayment(succ as PaymentRow | null);
    setTemplates((tmpls || []) as TemplateRow[]);
    setExecutors((execs || []) as ExecutorRow[]);

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

  // initialise edits from current state when order loads
  useEffect(() => {
    if (!order) return;
    setEdPayerType((order.payer_type as PayerType) || "individual");
    setEdEntityKey(payerEntityOverride ? `${payerEntityOverride.kind}:${payerEntityOverride.id}` : "auto");
    setEdTemplate(templateOverride || "auto");
    setEdExecutor(executorOverride || "auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  const channel = useMemo(() => derivePaymentChannel(payment), [payment]);

  const dirty = useMemo(() => {
    if (!order) return false;
    if (edPayerType && edPayerType !== order.payer_type) return true;
    const curEntity = payerEntityOverride ? `${payerEntityOverride.kind}:${payerEntityOverride.id}` : "auto";
    if ((edEntityKey || "auto") !== curEntity) return true;
    if ((edTemplate || "auto") !== (templateOverride || "auto")) return true;
    if ((edExecutor || "auto") !== (executorOverride || "auto")) return true;
    return false;
  }, [order, edPayerType, edEntityKey, edTemplate, edExecutor, payerEntityOverride, templateOverride, executorOverride]);

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
      toast.success(`Сохранено (${(data as any).audit_count} запис(ей) в audit)`);
      await load();
    } catch (e: any) {
      toast.error(`Сохранение: ${normalizeEdgeFunctionError(e, e?.context?.body ?? null)}`);
    } finally {
      setSaving(false);
    }
  };

  const clearPayerOverride = async () => {
    if (!order || !canEdit) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-deal-document-overrides", {
        body: { order_id: order.id, changes: {}, clear_payer_override: true },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Тип плательщика возвращён в auto");
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

  const channelLabel = channel ? PAYMENT_LABEL[channel] || channel : "—";
  const cardSuffix =
    payment?.card_last4 ? `•••• ${payment.card_last4}${payment.card_brand ? ` ${payment.card_brand}` : ""}` : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <UserCog className="h-4 w-4 text-primary" /> Документы / плательщик
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Payment (read-only) */}
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Способ оплаты:</span>
          <Badge variant="outline">{channelLabel}</Badge>
          {cardSuffix && <span className="text-xs text-muted-foreground">{cardSuffix}</span>}
          {payment?.card_holder && <span className="text-xs text-muted-foreground">· {payment.card_holder}</span>}
          {!payment && <span className="text-xs text-amber-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Успешного платежа нет</span>}
        </div>

        {/* Payer type */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Тип плательщика</span>
            <Badge variant={payerTypeSource === "admin_override" ? "default" : "outline"} className="text-[10px]">
              {payerTypeSource === "admin_override" ? "admin override" : "auto"}
            </Badge>
            {payerTypeSource === "admin_override" && canEdit && (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={clearPayerOverride} disabled={saving}>
                <RefreshCw className="h-3 w-3 mr-1" /> Сбросить в auto
              </Button>
            )}
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

        {/* Payer entity */}
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Карточка реквизитов плательщика</div>
          <Select
            value={edEntityKey || "auto"}
            onValueChange={(v) => setEdEntityKey(v)}
            disabled={!canEdit || saving}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">По умолчанию (default карточка пользователя)</SelectItem>
              {individuals.length > 0 && (
                <>
                  <div className="px-2 pt-1 text-[10px] uppercase text-muted-foreground">Физлицо</div>
                  {individuals.map((r) => (
                    <SelectItem key={`ind-${r.id}`} value={`individual:${r.id}`}>
                      {reqLabel(r)}{r.is_default ? " · default" : ""}
                    </SelectItem>
                  ))}
                </>
              )}
              {legalEntities.length > 0 && (
                <>
                  <div className="px-2 pt-1 text-[10px] uppercase text-muted-foreground">Юрлицо</div>
                  {legalEntities.map((r) => (
                    <SelectItem key={`le-${r.id}`} value={`legal_entity:${r.id}`}>
                      {reqLabel(r)}{r.is_default ? " · default" : ""}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Template: auto-resolved from tariff_offers.meta.document_defaults.template_id.
            Ручной выбор шаблона теперь живёт ТОЛЬКО в карточке «Документы (strict ID-first)» ниже,
            а привязка «оплата → шаблон акта» настраивается в редакторе тарифа/оффера
            (tariff_offers.meta.document_defaults.template_id). */}

        {/* Executor override */}
        <div className="space-y-1.5">
          <div className="text-sm font-medium flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5" /> Исполнитель (override)
          </div>
          <Select value={edExecutor || "auto"} onValueChange={setEdExecutor} disabled={!canEdit || saving}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">По сценарию / по умолчанию</SelectItem>
              {executors.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.short_name || e.full_name || e.id.slice(0, 8)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <div className="text-xs text-muted-foreground">
            Изменения пишутся в `orders_v2.meta.documents` и audit_logs. payments_v2 не затрагивается.
          </div>
          <Button size="sm" onClick={save} disabled={!canEdit || saving || !dirty}>
            {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Сохранить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
