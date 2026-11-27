import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type Preview = { before_hash: string; source_new_end: string; target_old_end: string; target_new_end: string; applied?: boolean };
const date = (value: string) => new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Minsk" });
// The server resolves the existing target purchase and exact receipt graph.
// Neither prices nor periods can be typed into this correction form.
export function PaymentReallocationDialog({ profileId, paymentId }: { profileId: string; paymentId: string }) {
  const access = useAdminAccess();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const storageKey = `payment-reallocation:${profileId}:${paymentId}`;
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  if (!access.isAdmin && !access.isSuperAdmin) return null;
  async function inspect() {
    setBusy(true); setError("");
    try {
      const existing = await rpc("admin_get_payment_reallocation", { p_profile_id: profileId, p_payment_id: paymentId });
      if (existing.error) throw existing.error;
      if (existing.data) { setPreview(existing.data as Preview); setUncertain(false); localStorage.removeItem(storageKey); return; }
      if (localStorage.getItem(storageKey)) { setUncertain(true); setError("Результат ещё не подтверждён. Повторная отправка заблокирована. Проверьте результат позднее."); return; }
      const result = await rpc("admin_preview_payment_reallocation", { p_profile_id: profileId, p_payment_id: paymentId });
      if (result.error) throw result.error;
      setPreview(result.data as Preview); setUncertain(false);
    } catch { setError("Не удалось подтвердить возможность переноса. Ничего не изменено этим просмотром; требуется проверка условий."); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!preview || busy || uncertain || preview.applied || reason.trim().length < 10) return;
    const requestId = crypto.randomUUID();
    // Persist BEFORE dispatch. An unknown result never becomes permission to retry.
    try { localStorage.setItem(storageKey, requestId); }
    catch { setError("Не удалось сохранить номер операции. Перенос не отправлен."); return; }
    setBusy(true); setError(""); setUncertain(true);
    try {
      const result = await rpc("admin_commit_payment_reallocation", { p_request_id: requestId, p_profile_id: profileId,
        p_payment_id: paymentId, p_before_hash: preview.before_hash, p_reason: reason.trim() });
      if (result.error || !(result.data as Preview)?.applied) throw result.error;
      setPreview(result.data as Preview); localStorage.removeItem(storageKey); setUncertain(false);
      void cache.invalidateQueries({ queryKey: ["contact-payments", profileId] });
      void cache.invalidateQueries({ queryKey: ["contact-subscriptions"] });
    } catch { setError("Результат операции не подтверждён. Проверьте его по кнопке ниже; повторный перенос заблокирован."); }
    finally { setBusy(false); }
  }
  return <><Button variant="outline" size="sm" onClick={() => { setOpen(true); void inspect(); }}>Исправить продукт оплаты</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Перенос ошибочной оплаты</DialogTitle><DialogDescription>
        Исправление полной оплаты 250 BYN из Клуба в следующий период «Бухгалтерии как бизнес». Ранее оплаченный Клуб сохраняется.
      </DialogDescription></DialogHeader>
      {preview && <div className="space-y-2 text-sm">
        <p>Клуб останется оплачен до {date(preview.source_new_end)}.</p>
        <p>«Бухгалтерия как бизнес»: {date(preview.target_old_end)} — {date(preview.target_new_end)}.</p>
        <p>Новых списаний и возвратов не будет. Банковская подписка этим действием не отменяется.</p>
      </div>}
      {preview?.applied ? <p role="status">Перенос подтверждён. Проверьте подписки в карточке контакта.</p> : <>
        <Textarea aria-label="Причина переноса" placeholder="Укажите причину и основание согласования" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} disabled={busy || uncertain}/>
        <Button onClick={() => void commit()} disabled={!preview || busy || uncertain || reason.trim().length < 10}>Подтвердить перенос 250 BYN</Button>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button variant="outline" onClick={() => void inspect()} disabled={busy}>Проверить результат</Button>
    </DialogContent></Dialog></>;
}
