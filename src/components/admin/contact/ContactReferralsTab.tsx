/* eslint-disable @typescript-eslint/no-explicit-any -- removed after Lovable regenerates Supabase types */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, History, Link2, Loader2, Pencil, ReceiptText, RotateCcw, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildReferralLink, formatBynMinor, referralStatusLabel } from "@/lib/referrals";
import { ContactPickerDialog, type PickedContact } from "@/components/admin/shared/pickers/ContactPickerDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAdminAccess } from "@/hooks/useAdminAccess";

type PickerMode = "partner" | "referred" | "replace-partner" | null;
type SaleCorrection = { saleId: string; action: "reverse" | "restore"; label: string };

export function ContactReferralsTab({ profileId }: { profileId: string }) {
  const qc = useQueryClient();
  const access = useAdminAccess();
  const canEdit = access.canAccessSection("referrals", "edit");
  const canManage = access.canAccessSection("referrals", "manage");
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [pickedContact, setPickedContact] = useState<PickedContact | null>(null);
  const [linkReason, setLinkReason] = useState("");
  const [historicalRelationshipId, setHistoricalRelationshipId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [creditReason, setCreditReason] = useState("");
  const [relationshipForCorrection, setRelationshipForCorrection] = useState<any | null>(null);
  const [relationshipAction, setRelationshipAction] = useState<"revoke" | null>(null);
  const [saleCorrection, setSaleCorrection] = useState<SaleCorrection | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const query = useQuery({
    queryKey: ["contact-referrals", profileId],
    queryFn: async () => {
      const client = supabase as any;
      const [partnerResult, referredByResult] = await Promise.all([
        client.from("referral_partners").select("*").eq("profile_id", profileId).maybeSingle(),
        client.from("referral_relationships").select("id,public_id,partner_id,source,manual_reason,metadata,attached_at,partner:partner_id(partner_code,profiles:profile_id(full_name,email))").eq("referred_profile_id", profileId).eq("status", "active").maybeSingle(),
      ]);
      if (partnerResult.error) throw partnerResult.error;
      if (referredByResult.error) throw referredByResult.error;
      const partner = partnerResult.data;
      const referredBy = referredByResult.data;
      if (!partner) return { partner: null, referredBy, referrals: [], sales: [], entries: [] };
      const [relationships, sales, entries] = await Promise.all([
        client.from("referral_relationships").select("id, referred_profile_id, attached_at, status, source, manual_reason, metadata, profiles:referred_profile_id(full_name,email)").eq("partner_id", partner.id).order("attached_at", { ascending: false }),
        client.from("referral_sale_attributions").select("id, public_id, order_id, relationship_id, status, commission_minor, reversed_minor, created_at, metadata, products_v2(name)").eq("partner_id", partner.id).order("created_at", { ascending: false }),
        client.from("referral_balance_entries").select("bucket,amount_minor").eq("partner_id", partner.id),
      ]);
      if (relationships.error) throw relationships.error;
      if (sales.error) throw sales.error;
      if (entries.error) throw entries.error;
      return { partner, referredBy, referrals: relationships.data ?? [], sales: sales.data ?? [], entries: entries.data ?? [] };
    },
  });

  const createPartner = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("referral_admin_ensure_partner", { p_profile_id: profileId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Реферальный кабинет подключён");
      qc.invalidateQueries({ queryKey: ["contact-referrals", profileId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const attachHistorical = useMutation({
    mutationFn: async () => {
      if (!pickedContact || !pickerMode) throw new Error("Выберите контакт");
      if (!linkReason.trim()) throw new Error("Укажите основание ручной привязки");
      const args = {
        p_partner_profile_id: pickerMode === "partner" ? pickedContact.id : profileId,
        p_referred_profile_id: pickerMode === "referred" ? pickedContact.id : profileId,
        p_reason: linkReason.trim(),
      };
      const { data, error } = pickerMode === "replace-partner"
        ? await (supabase.rpc as any)("referral_admin_reassign_relationship", {
          p_relationship_id: relationshipForCorrection?.id,
          p_new_partner_profile_id: pickedContact.id,
          p_reason: linkReason.trim(),
        })
        : await (supabase.rpc as any)("referral_admin_attach_historical_profile", args);
      if (error) throw error;
      return data as string;
    },
    onSuccess: (relationshipId) => {
      toast.success(relationshipForCorrection ? "Рекомендатель изменён. Историю начислений можно восстановить при необходимости." : "Историческая рекомендация добавлена. Теперь выберите покупки для начисления.");
      setHistoricalRelationshipId(relationshipId);
      setPickedContact(null);
      setPickerMode(null);
      setLinkReason("");
      setRelationshipForCorrection(null);
      qc.invalidateQueries({ queryKey: ["contact-referrals", profileId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const referredRelationshipId = query.data?.referredBy?.id as string | undefined;
  const activeHistoricalRelationshipId = historicalRelationshipId ?? referredRelationshipId;
  const historicalOrders = useQuery({
    queryKey: ["contact-referral-historical-orders", activeHistoricalRelationshipId],
    enabled: Boolean(activeHistoricalRelationshipId),
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("referral_admin_list_historical_orders", { p_relationship_id: activeHistoricalRelationshipId });
      if (error) throw error;
      return data ?? [];
    },
  });

  const creditHistoricalOrder = useMutation({
    mutationFn: async () => {
      if (!selectedOrder || !activeHistoricalRelationshipId) throw new Error("Покупка не выбрана");
      if (!creditReason.trim()) throw new Error("Укажите основание начисления");
      const { error } = await (supabase.rpc as any)("referral_admin_credit_historical_order", {
        p_relationship_id: activeHistoricalRelationshipId,
        p_order_id: selectedOrder.order_id,
        p_reason: creditReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Реферальное начисление добавлено по правилам продукта");
      setSelectedOrder(null);
      setCreditReason("");
      qc.invalidateQueries({ queryKey: ["contact-referral-historical-orders", activeHistoricalRelationshipId] });
      qc.invalidateQueries({ queryKey: ["contact-referrals", profileId] });
      qc.invalidateQueries({ queryKey: ["admin-referrals-overview"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const correctSale = useMutation({
    mutationFn: async () => {
      if (!saleCorrection) throw new Error("Начисление не выбрано");
      if (!correctionReason.trim()) throw new Error("Укажите основание корректировки");
      const rpc = saleCorrection.action === "reverse"
        ? "referral_admin_reverse_sale_attribution"
        : "referral_admin_restore_sale_attribution";
      const { error } = await (supabase.rpc as any)(rpc, {
        p_sale_id: saleCorrection.saleId,
        p_reason: correctionReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(saleCorrection?.action === "reverse" ? "Покупка исключена из реферального расчёта" : "Реферальное начисление восстановлено");
      setSaleCorrection(null);
      setCorrectionReason("");
      qc.invalidateQueries({ queryKey: ["contact-referral-historical-orders", activeHistoricalRelationshipId] });
      qc.invalidateQueries({ queryKey: ["contact-referrals", profileId] });
      qc.invalidateQueries({ queryKey: ["admin-referrals-overview"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revokeRelationship = useMutation({
    mutationFn: async () => {
      if (!relationshipForCorrection) throw new Error("Рекомендация не выбрана");
      if (!correctionReason.trim()) throw new Error("Укажите основание отзыва");
      const { error } = await (supabase.rpc as any)("referral_admin_revoke_relationship", {
        p_relationship_id: relationshipForCorrection.id,
        p_reason: correctionReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Рекомендация отозвана");
      setRelationshipAction(null);
      setRelationshipForCorrection(null);
      setCorrectionReason("");
      setHistoricalRelationshipId(null);
      qc.invalidateQueries({ queryKey: ["contact-referrals", profileId] });
      qc.invalidateQueries({ queryKey: ["admin-referrals-overview"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (query.isLoading) return <div className="py-12 flex justify-center"><Loader2 className="animate-spin" /></div>;
  if (query.error) return <p className="text-sm text-destructive">Не удалось загрузить реферальные данные.</p>;
  const data = query.data!;

  const totals = data.entries.reduce((acc: Record<string, number>, row: any) => {
    acc[row.bucket] = (acc[row.bucket] ?? 0) + Number(row.amount_minor);
    return acc;
  }, {});
  const link = data.partner ? buildReferralLink(data.partner.partner_code) : null;

  return <div className="space-y-4">
    {data.partner ? <Card><CardHeader><CardTitle className="text-base flex items-center justify-between gap-2">Партнёр <Badge>{referralStatusLabel(data.partner.status)}</Badge></CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2"><div className="flex-1 min-w-0 border rounded-md px-3 py-2 font-mono text-xs truncate">{link}</div><Button variant="outline" size="icon" onClick={async () => { await navigator.clipboard.writeText(link!); toast.success("Ссылка скопирована"); }}><Copy className="h-4 w-4" /></Button></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <Metric label="Ожидает" value={formatBynMinor(totals.pending)} />
          <Metric label="К выплате" value={formatBynMinor(totals.available)} />
          <Metric label="В резерве" value={formatBynMinor(totals.held)} />
          <Metric label="Выплачено" value={formatBynMinor(totals.paid)} />
        </div>
        {canEdit && <Button variant="outline" size="sm" className="gap-2" onClick={() => setPickerMode("referred")}><Link2 className="h-4 w-4" /> Добавить существующего клиента</Button>}
      </CardContent>
    </Card> : <Card><CardContent className="py-8 text-center space-y-3">
      <Users className="h-8 w-8 mx-auto text-muted-foreground" />
      <div><p className="font-medium">Реферальный кабинет не подключён</p><p className="text-sm text-muted-foreground">Подключите контакт, чтобы использовать его как партнёра.</p></div>
      {canEdit && <Button onClick={() => createPartner.mutate()} disabled={createPartner.isPending} className="gap-2"><UserPlus className="h-4 w-4" /> Подключить</Button>}
    </CardContent></Card>}

    <Card><CardHeader><CardTitle className="text-base flex items-center justify-between gap-2">Кто рекомендовал</CardTitle></CardHeader><CardContent className="space-y-3">
      {data.referredBy ? <div className="rounded-md border p-3 text-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{data.referredBy.partner?.profiles?.full_name || data.referredBy.partner?.profiles?.email || data.referredBy.partner?.partner_code || "Партнёр"}</p><p className="text-xs text-muted-foreground">Связь создана {new Date(data.referredBy.attached_at).toLocaleDateString("ru-BY")}</p></div>{data.referredBy.metadata?.administrative_historical && <Badge variant="secondary">Внесено администратором</Badge>}</div>{data.referredBy.manual_reason && <p className="mt-2 text-xs text-muted-foreground">Основание: {data.referredBy.manual_reason}</p>}{canEdit && <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setRelationshipForCorrection(data.referredBy); setPickerMode("replace-partner"); }}><Pencil className="h-3.5 w-3.5" /> Изменить рекомендателя</Button>{canManage && <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => { setRelationshipForCorrection(data.referredBy); setRelationshipAction("revoke"); }}><Trash2 className="h-3.5 w-3.5" /> Отозвать рекомендацию</Button>}</div>}</div> : <><p className="text-sm text-muted-foreground">Рекомендатель не указан.</p>{canEdit && <Button variant="outline" size="sm" className="gap-2" onClick={() => setPickerMode("partner")}><Link2 className="h-4 w-4" /> Указать рекомендателя</Button>}</>}
    </CardContent></Card>

    {(data.referredBy || historicalRelationshipId) && <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> Исторические покупки</CardTitle><p className="text-sm text-muted-foreground">Выберите только подтверждённые покупки. Комиссия рассчитывается по действующим правилам продукта; автопродления не попадут в список.</p></CardHeader><CardContent className="space-y-2">
      {historicalOrders.isLoading && <div className="py-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin" /></div>}
      {historicalOrders.data?.map((order: any) => <div key={order.order_id} className="flex flex-col gap-2 rounded-md border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{order.product_name}</p><p className="text-xs text-muted-foreground">{order.order_number} · {new Date(order.created_at).toLocaleDateString("ru-BY")} · {order.payments_count} платёж(ей)</p><p className="mt-1 font-medium">{formatBynMinor(Number(order.paid_minor))}</p>{order.credit_action === "credited" && <Badge variant="secondary" className="mt-2">Уже начислено</Badge>}{order.credit_action === "restore" && <Badge variant="outline" className="mt-2">Исключено администратором</Badge>}</div>{canManage && (order.credit_action === "credit" ? <Button size="sm" className="gap-1.5" disabled={!order.commissionable} onClick={() => setSelectedOrder(order)}><ReceiptText className="h-3.5 w-3.5" /> Начислить</Button> : order.credit_action === "restore" ? <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSaleCorrection({ saleId: order.sale_id, action: "restore", label: order.product_name })}><RotateCcw className="h-3.5 w-3.5" /> Восстановить</Button> : order.can_reverse ? <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setSaleCorrection({ saleId: order.sale_id, action: "reverse", label: order.product_name })}><Trash2 className="h-3.5 w-3.5" /> Исключить</Button> : <Badge variant="secondary">{order.credit_action === "credited" ? "Начислено" : "Не участвует"}</Badge>)}</div>)}
      {!historicalOrders.isLoading && !historicalOrders.data?.length && <p className="py-4 text-center text-sm text-muted-foreground">Подходящих оплаченных покупок нет.</p>}
    </CardContent></Card>}

    {data.partner && <Card><CardHeader><CardTitle className="text-base">Приглашённые ({data.referrals.length})</CardTitle></CardHeader><CardContent className="space-y-2">
      {data.referrals.map((row: any) => <div key={row.id} className="border rounded-md p-3 text-sm flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{row.profiles?.full_name || "Пользователь"}</p><p className="text-muted-foreground">{row.profiles?.email || "Email не указан"}</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{referralStatusLabel(row.status)}</Badge><Button variant="outline" size="sm" className="gap-1.5" onClick={() => setHistoricalRelationshipId(row.id)}><History className="h-3.5 w-3.5" /> Покупки</Button>{canEdit && <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setRelationshipForCorrection(row); setPickerMode("replace-partner"); }}><Pencil className="h-3.5 w-3.5" /> Изменить</Button>}{canManage && <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => { setRelationshipForCorrection(row); setRelationshipAction("revoke"); }}><Trash2 className="h-3.5 w-3.5" /> Отозвать</Button>}</div></div>)}
      {!data.referrals.length && <p className="text-sm text-muted-foreground">Приглашённых пока нет.</p>}
    </CardContent></Card>}
    {data.partner && <Card><CardHeader><CardTitle className="text-base">Начисления</CardTitle></CardHeader><CardContent className="space-y-2">
      {data.sales.map((sale: any) => <div key={sale.id} className="border rounded-md p-3 text-sm flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{sale.products_v2?.name || "Продукт"}</p><div className="mt-1 flex flex-wrap gap-1"><Badge variant="secondary">{referralStatusLabel(sale.status)}</Badge>{sale.metadata?.administrative_historical && <Badge variant="outline">Внесено администратором</Badge>}</div></div><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{formatBynMinor(Number(sale.commission_minor) - Number(sale.reversed_minor))}</span>{canManage && (sale.status === "reversed" && sale.metadata?.admin_can_restore ? <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSaleCorrection({ saleId: sale.id, action: "restore", label: sale.products_v2?.name || "Продукт" })}><RotateCcw className="h-3.5 w-3.5" /> Восстановить</Button> : ["pending", "shadow"].includes(sale.status) && Number(sale.reversed_minor) < Number(sale.commission_minor) ? <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setSaleCorrection({ saleId: sale.id, action: "reverse", label: sale.products_v2?.name || "Продукт" })}><Trash2 className="h-3.5 w-3.5" /> Исключить</Button> : null)}</div></div>)}
      {!data.sales.length && <p className="text-sm text-muted-foreground">Начислений пока нет.</p>}
    </CardContent></Card>}

    <ContactPickerDialog
      open={pickerMode !== null && pickedContact === null}
      onOpenChange={(open) => { if (!open) setPickerMode(null); }}
      onPick={(contact) => setPickedContact(contact)}
      options={{ title: pickerMode === "partner" || pickerMode === "replace-partner" ? "Выберите рекомендателя" : "Выберите приглашённого клиента", helperText: pickerMode === "replace-partner" ? "Связь будет переназначена только после исключения всех действующих начислений." : "Будет создана ручная историческая связь с обязательной отметкой администратора." }}
    />
    <Dialog open={pickedContact !== null} onOpenChange={(open) => { if (!open) { setPickedContact(null); setPickerMode(null); setLinkReason(""); } }}>
      <DialogContent><DialogHeader><DialogTitle>{pickerMode === "replace-partner" ? "Изменить рекомендателя" : "Подтвердить историческую рекомендацию"}</DialogTitle><DialogDescription>{pickerMode === "replace-partner" ? "Действующие начисления сначала нужно исключить из реферального расчёта. Клиентские покупки при этом не отменяются." : "Связь будет внесена администратором и не начислит покупки автоматически: их нужно выбрать отдельно."}</DialogDescription></DialogHeader><div className="space-y-2"><Label>Основание</Label><Textarea value={linkReason} onChange={(event) => setLinkReason(event.target.value)} placeholder="Например: рекомендация подтверждена менеджером 25.07.2026" /></div><DialogFooter><Button variant="outline" onClick={() => { setPickedContact(null); setPickerMode(null); setRelationshipForCorrection(null); }}>Отмена</Button><Button disabled={attachHistorical.isPending || !linkReason.trim()} onClick={() => attachHistorical.mutate()}>{pickerMode === "replace-partner" ? "Изменить рекомендателя" : "Сохранить связь"}</Button></DialogFooter></DialogContent>
    </Dialog>
    <Dialog open={selectedOrder !== null} onOpenChange={(open) => { if (!open) { setSelectedOrder(null); setCreditReason(""); } }}>
      <DialogContent><DialogHeader><DialogTitle>Подтвердить начисление</DialogTitle><DialogDescription>Будет создана реферальная операция с пометкой «внесено администратором». Сумма и распределение 60/40 рассчитываются сервером.</DialogDescription></DialogHeader><div className="space-y-2"><Label>Основание</Label><Textarea value={creditReason} onChange={(event) => setCreditReason(event.target.value)} placeholder="Например: историческая покупка подтверждена по договору" /></div><DialogFooter><Button variant="outline" onClick={() => setSelectedOrder(null)}>Отмена</Button><Button disabled={creditHistoricalOrder.isPending || !creditReason.trim()} onClick={() => creditHistoricalOrder.mutate()}>Начислить</Button></DialogFooter></DialogContent>
    </Dialog>
    <Dialog open={saleCorrection !== null} onOpenChange={(open) => { if (!open) { setSaleCorrection(null); setCorrectionReason(""); } }}>
      <DialogContent><DialogHeader><DialogTitle>{saleCorrection?.action === "reverse" ? "Исключить покупку из реферального расчёта" : "Восстановить реферальное начисление"}</DialogTitle><DialogDescription>{saleCorrection?.action === "reverse" ? "Покупка клиента и её оплата не отменяются. Будет отменено только ожидающее реферальное начисление; операция останется в истории." : "Будет восстановлено то же начисление по сохранённым правилам продукта."}</DialogDescription></DialogHeader><p className="text-sm font-medium">{saleCorrection?.label}</p><div className="space-y-2"><Label>Основание</Label><Textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Например: покупка не относится к рекомендации" /></div><DialogFooter><Button variant="outline" onClick={() => setSaleCorrection(null)}>Отмена</Button><Button disabled={correctSale.isPending || !correctionReason.trim()} variant={saleCorrection?.action === "reverse" ? "destructive" : "default"} onClick={() => correctSale.mutate()}>{saleCorrection?.action === "reverse" ? "Исключить" : "Восстановить"}</Button></DialogFooter></DialogContent>
    </Dialog>
    <Dialog open={relationshipAction === "revoke"} onOpenChange={(open) => { if (!open) { setRelationshipAction(null); setRelationshipForCorrection(null); setCorrectionReason(""); } }}>
      <DialogContent><DialogHeader><DialogTitle>Отозвать рекомендацию</DialogTitle><DialogDescription>Связь будет сохранена в истории как отозванная. Сначала исключите все ожидающие начисления по ней. Покупки клиента не будут удалены или отменены.</DialogDescription></DialogHeader><div className="space-y-2"><Label>Основание</Label><Textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Например: рекомендация указана ошибочно" /></div><DialogFooter><Button variant="outline" onClick={() => setRelationshipAction(null)}>Отмена</Button><Button disabled={revokeRelationship.isPending || !correctionReason.trim()} variant="destructive" onClick={() => revokeRelationship.mutate()}>Отозвать рекомендацию</Button></DialogFooter></DialogContent>
    </Dialog>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border rounded-md p-2"><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium mt-1">{value}</p></div>;
}
