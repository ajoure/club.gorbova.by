import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatBynMinor } from "@/lib/referrals";
import { bonusEntryLabel, bonusErrorMessage, matchesBonusRequest, parseBonusMinor, readAdminBonusWallet, type BonusRequest } from "@/lib/customer-bonus";

function loadPending(key: string, profileId: string): { request: BonusRequest | null; blocked: boolean } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { request: null, blocked: false };
    const value = JSON.parse(raw) as BonusRequest;
    if (value.profileId === profileId && typeof value.requestId === "string" && typeof value.reason === "string"
      && Number.isSafeInteger(value.amountMinor) && value.amountMinor > 0
      && (value.paymentId === null || typeof value.paymentId === "string")) return { request: value, blocked: false };
  } catch { /* Keep the storage boundary closed: never dispatch from unreadable data. */ }
  return { request: null, blocked: true };
}

export function ContactBonusesTab({ profileId, contactName }: { profileId: string; contactName: string }) {
  const { user } = useAuth();
  const access = useAdminAccess();
  const isAdmin = !access.isLoading && (access.isAdmin || access.isSuperAdmin);
  const qc = useQueryClient();
  const storageKey = `customer-bonus-pending:${user?.id}:${profileId}`;
  const [saved] = useState(() => loadPending(storageKey, profileId));
  const [pending, setPending] = useState<BonusRequest | null>(saved.request);
  const [storageBlocked, setStorageBlocked] = useState(saved.blocked);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const dispatching = useRef(false);
  const amountMinor = parseBonusMinor(amount);
  const wallet = useQuery({
    queryKey: ["contact-bonus-wallet", profileId], enabled: isAdmin,
    queryFn: () => readAdminBonusWallet(profileId), retry: false,
  });

  const finishVerified = () => {
    // An unavailable storage must never convert a verified result into a
    // reason to retry the write. A stale key can only trigger read reconciliation.
    try { localStorage.removeItem(storageKey); } catch { /* No write retry. */ }
    setPending(null); setConfirming(false); setAmount(""); setReason(""); setPaymentId(""); setMessage("");
    void qc.invalidateQueries({ queryKey: ["contact-bonus-wallet", profileId] });
    void qc.invalidateQueries({ queryKey: ["customer-bonus-wallet"] });
    void qc.invalidateQueries({ queryKey: ["referral-customer-credit"] });
    toast.success("Бонус начислен и проверен в истории");
  };

  const credit = useMutation({
    retry: false,
    mutationFn: async (request: BonusRequest) => {
      const { data, error } = await supabase.rpc("admin_credit_customer_bonus", {
        p_profile_id: request.profileId, p_amount_minor: request.amountMinor, p_reason: request.reason,
        p_request_id: request.requestId, p_source_payment_id: request.paymentId,
      });
      if (error) {
        // PostgreSQL exceptions roll the transaction back. Transport failures
        // have an unknown outcome and retain the same frozen pending request.
        if ((error.code === "P0001" || error.code === "42501") && !error.message.includes("bonus_request_conflict")) {
          try { localStorage.removeItem(storageKey); } catch { setStorageBlocked(true); }
          setPending(null);
        }
        throw error;
      }
      const result = data as { entry_id?: string } | null;
      if (!result?.entry_id) throw new Error("bonus_result_unconfirmed");
      const readback = await readAdminBonusWallet(profileId, request.requestId);
      if (!matchesBonusRequest(readback, request, result.entry_id)) throw new Error("bonus_readback_unconfirmed");
    },
    onSuccess: finishVerified,
    onError: (error) => { setConfirming(false); setMessage(bonusErrorMessage(error)); void wallet.refetch(); },
    onSettled: () => { dispatching.current = false; },
  });

  const reconcile = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!pending) return false;
      const readback = await readAdminBonusWallet(profileId, pending.requestId);
      return matchesBonusRequest(readback, pending);
    },
    onSuccess: (verified) => {
      if (verified) finishVerified();
      else setMessage("Запись начисления пока не подтверждена. Операция сохранена для проверки; повторное начисление заблокировано.");
    },
    onError: () => setMessage("История пока недоступна. Сохранённая операция остаётся на проверке."),
  });

  const submit = () => {
    if (dispatching.current || pending || storageBlocked || !isAdmin || !amountMinor || !reason.trim()) return;
    const existing = loadPending(storageKey, profileId);
    if (existing.blocked) { setStorageBlocked(true); return; }
    if (existing.request) { setPending(existing.request); setConfirming(false); return; }
    const request: BonusRequest = { requestId: crypto.randomUUID(), profileId, amountMinor, reason: reason.trim(), paymentId: paymentId || null };
    // Save before dispatch, so closing or refreshing the card cannot lose an
    // uncertain action and issue a fresh key for the same attempted bonus.
    try { localStorage.setItem(storageKey, JSON.stringify(request)); }
    catch { setMessage("Не удалось сохранить операцию для проверки. Начисление не отправлено."); return; }
    dispatching.current = true;
    setPending(request);
    credit.mutate(request);
  };

  if (!isAdmin) return <p className="text-sm text-muted-foreground">Бонусы контакта доступны администратору.</p>;
  if (wallet.isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (wallet.error) return <div role="alert" className="space-y-3 p-4 text-sm"><p>Не удалось загрузить бонусный баланс.</p><Button variant="outline" onClick={() => void wallet.refetch()}>Обновить</Button></div>;
  const selectedPayment = wallet.data?.payments?.find((payment) => payment.id === paymentId);
  const invalidPayment = !!selectedPayment && (selectedPayment.already_credited || (!!amountMinor && amountMinor > Number(selectedPayment.amount_minor)));

  return <div className="space-y-4" data-bonus-profile-id={profileId}>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Gift className="h-4 w-4" /> Бонусы клиента</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div><p className="text-sm text-muted-foreground">Доступно для покупок</p><p className="text-2xl font-semibold">{formatBynMinor(Number(wallet.data?.available_minor ?? 0))}</p></div>
        {storageBlocked ? <p role="alert" className="text-sm text-destructive">Не удалось прочитать сохранённую операцию. Начисление заблокировано до сверки истории администратором.</p> : pending ? <div role="status" className="space-y-3 rounded-lg border p-3 text-sm">
          <p>Проверяется начисление {formatBynMinor(pending.amountMinor)}. Повторная отправка заблокирована.</p>
          <p className="break-words text-muted-foreground">{pending.reason}</p>
          <Button variant="outline" disabled={credit.isPending || reconcile.isPending} onClick={() => reconcile.mutate()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Проверить результат
          </Button>
        </div> : <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="bonus-amount">Сумма бонуса, BYN</Label>
            <Input id="bonus-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="150,00" />
          </div>
          <div className="space-y-1.5"><Label htmlFor="bonus-payment">Платёж-основание</Label>
            <select id="bonus-payment" value={paymentId} onChange={(event) => setPaymentId(event.target.value)} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Без привязки к платежу</option>
              {(wallet.data?.payments ?? []).map((payment) => <option key={payment.id} value={payment.id} disabled={payment.already_credited}>
                {payment.paid_at ? new Date(payment.paid_at).toLocaleDateString("ru-BY") : "Без даты"} · {payment.product_name} · {formatBynMinor(Number(payment.amount_minor))}{payment.already_credited ? " · уже начислено" : ""}
              </option>)}
            </select>
            <p className="text-xs text-muted-foreground">Последние 100 успешных оплат в BYN. Привязка защищает от повторного бонуса за ту же оплату.</p>
            {invalidPayment && <p role="alert" className="text-sm text-destructive">Проверьте сумму и ранее начисленный бонус по выбранному платежу.</p>}
          </div>
          <div className="space-y-1.5"><Label htmlFor="bonus-reason">Основание начисления</Label>
            <Textarea id="bonus-reason" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Например: бонус 10% за консультацию по решению руководителя" />
          </div>
          <Button className="w-full sm:w-auto" disabled={!amountMinor || !reason.trim() || invalidPayment || credit.isPending} onClick={() => setConfirming(true)}>Начислить бонус</Button>
        </div>}
        {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      </CardContent>
    </Card>
    <Card><CardHeader><CardTitle className="text-base">История бонусов</CardTitle></CardHeader><CardContent className="space-y-3">
      {(wallet.data?.entries ?? []).length === 0 && <p className="text-sm text-muted-foreground">Бонусных операций пока нет.</p>}
      {(wallet.data?.entries ?? []).map((entry) => <div key={entry.id} className="space-y-1 rounded-lg border p-3 text-sm" data-bonus-entry-id={entry.id} data-bonus-request-id={entry.request_id || undefined} data-bonus-source-payment-id={entry.source_payment_id || undefined}>
        <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-medium">{bonusEntryLabel(entry.entry_type)}</p><p className="font-semibold">{entry.amount_minor > 0 ? "+" : ""}{formatBynMinor(Number(entry.amount_minor))}</p></div>
        <p className="text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleString("ru-BY")}{entry.status === "released" ? " · резерв снят" : ""}</p>
        {entry.reason && <p className="break-words">{entry.reason}</p>}
        {entry.source_payment_id && <p className="text-xs text-muted-foreground">За оплату: {wallet.data?.payments?.find((payment) => payment.id === entry.source_payment_id)?.product_name || "подтверждённый платёж"}</p>}
      </div>)}
    </CardContent></Card>
    <Dialog open={confirming} onOpenChange={(open) => { if (!credit.isPending) setConfirming(open); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Подтвердить бонус</DialogTitle>
        <DialogDescription>Бонус поступит на баланс выбранного контакта и появится в личном кабинете.</DialogDescription></DialogHeader>
        <div className="space-y-2 break-words text-sm"><p>Контакт: <strong>{contactName}</strong></p><p>Сумма: <strong>{formatBynMinor(amountMinor ?? 0)}</strong></p>
          {selectedPayment && <p>Платёж: {selectedPayment.product_name} · {formatBynMinor(Number(selectedPayment.amount_minor))}</p>}<p>Основание: {reason.trim()}</p>
        </div>
        <DialogFooter><Button variant="outline" disabled={credit.isPending} onClick={() => setConfirming(false)}>Отмена</Button>
          <Button disabled={credit.isPending || !!pending || invalidPayment || !amountMinor || !reason.trim()} onClick={submit}>Подтвердить начисление</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
