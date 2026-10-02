/* eslint-disable @typescript-eslint/no-explicit-any -- managed RPC JSON contracts */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRbac } from "@/hooks/useRbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBynMinor, parseBynMinor } from "@/lib/referrals";

const rpc=async(name:string,args?:Record<string,unknown>)=>{const {data,error}=await (supabase.rpc as any)(name,args);if(error)throw error;return data;};
const date=(value:string)=>new Date(value).toLocaleString("ru-BY",{timeZone:"Europe/Minsk",dateStyle:"medium",timeStyle:"short"});
type CatalogItem={product_id:string;product_name:string;tariff_id:string;tariff_name:string;offer_id:string;amount_minor:number;recurring:Record<string,unknown>;eligible:boolean};
type CartItem={key:string;offerId:string;unit:string;count:number;startMode:string;start:string;end:string;price:string};
const fresh=():CartItem=>({key:crypto.randomUUID(),offerId:"",unit:"months",count:12,startMode:"now",start:"",end:"",price:""});
const messages:Record<string,string>={quote_stale:"Баланс, каталог или доступы изменились. Выполните расчёт заново.",quote_expired:"Срок расчёта истёк. Выполните расчёт заново.",insufficient_bonus:"Бонусов не хватает. Уменьшите стоимость или разрешите подарок компании.",invalid_cash_conversion:"Сумма конвертации превышает доступную денежную часть или стоимость продуктов.",provider_subscription_acknowledgement_required:"Подтвердите сохранение существующей подписки и ознакомление с риском автосписания.",legacy_access_requires_reconciliation:"Есть старый доступ без источника. Требуется его сверка перед выдачей.",registered_account_required:"Для выдачи нужен зарегистрированный аккаунт клиента.",forbidden:"Нет права на эту операцию.",invalid_price:"Укажите корректную стоимость выбранного периода.",consumed_access_requires_explicit_decision:"Доступ уже начался. Для отмены требуется отдельное решение об использованном доступе."};
const errorText=(e:Error)=>messages[e.message]||e.message;

export function ReferralRedemptionPanel({partnerId}:{partnerId:string}){
 const rbac=useRbac();const qc=useQueryClient();
 const allowed=rbac.hasPermission("referral.redeem");
 const [open,setOpen]=useState(false);const [cart,setCart]=useState<CartItem[]>([fresh()]);
 const [reason,setReason]=useState("");const [cash,setCash]=useState("0");const [consent,setConsent]=useState("");
 const [gift,setGift]=useState(false);const [providerAck,setProviderAck]=useState(false);const [quote,setQuote]=useState<any>(null);
 const [reverse,setReverse]=useState<string|null>(null);const [reverseReason,setReverseReason]=useState("");const [allowUsed,setAllowUsed]=useState(false);
 const context=useQuery({queryKey:["referral-redemption-context",partnerId],enabled:allowed,queryFn:()=>rpc("referral_admin_redemption_context",{p_partner_id:partnerId})});
 const refresh=()=>{qc.invalidateQueries({queryKey:["referral-redemption-context",partnerId]});qc.invalidateQueries({queryKey:["contact-referrals"]});qc.invalidateQueries({queryKey:["contact-entitlement-sources"]});qc.invalidateQueries({queryKey:["admin-referrals-overview"]});qc.invalidateQueries({queryKey:["contact-orders"]});qc.invalidateQueries({queryKey:["contact-entitlements"]});qc.invalidateQueries({queryKey:["contact-subscriptions"]});};
 const catalog:CatalogItem[]=context.data?.catalog??[];const permissions=context.data?.permissions??{};
 const change=(key:string,patch:Partial<CartItem>)=>{setCart(rows=>rows.map(row=>row.key===key?{...row,...patch}:row));setQuote(null);};
 const selected=cart.map(row=>catalog.find(item=>item.offer_id===row.offerId));
 const providerWarning=selected.some(item=>item&&(context.data?.provider_product_ids??[]).includes(item.product_id));
 const busy=context.isLoading;
 const calculate=useMutation({mutationFn:async()=>{
  const items=cart.map((row,index)=>{const item=selected[index];if(!item)throw new Error("Выберите продукт и тариф для каждой позиции");
   return {product_id:item.product_id,tariff_id:item.tariff_id,offer_id:item.offer_id,period_unit:row.unit,period_count:row.count,start_mode:row.startMode,
    starts_at:row.start?new Date(row.start).toISOString():undefined,expires_at:row.end?new Date(row.end).toISOString():undefined,
    price_minor:row.price.trim()?parseBynMinor(row.price):undefined};});
  return rpc("referral_admin_quote_redemption",{p_partner_id:partnerId,p_request:{items,reason,cash_minor:parseBynMinor(cash),consent_reference:consent,allow_subsidy:gift,provider_acknowledged:providerAck}});
 },onSuccess:setQuote,onError:(e:Error)=>{setQuote(null);toast.error(errorText(e));}});
 const commit=useMutation({mutationFn:async()=>{
  const result=await rpc("referral_admin_commit_redemption",{p_quote_id:quote.quote_id});
  // Read back the authoritative journal before reporting success.
  const state=await rpc("referral_admin_redemption_context",{p_partner_id:partnerId});
  if(!state.history.some((r:any)=>r.id===result.redemption_id&&r.status==="completed"))throw new Error("Запись операции пока не подтверждена. Не повторяйте выдачу; обновите историю.");
  return result;
 },onSuccess:()=>{toast.success("Бонусы списаны, доступы оформлены. Состояние внешней синхронизации видно в истории.");setOpen(false);setQuote(null);setCart([fresh()]);setReason("");setCash("0");setConsent("");setGift(false);setProviderAck(false);refresh();},onError:(e:Error)=>{toast.error(errorText(e));if(e.message==="quote_stale"||e.message==="quote_expired")setQuote(null);refresh();}});
 const undo=useMutation({mutationFn:()=>rpc("referral_admin_reverse_redemption",{p_redemption_id:reverse,p_reason:reverseReason,p_allow_consumed:allowUsed}),onSuccess:()=>{toast.success("Операция отменена. Исходные бонусы и денежная часть восстановлены.");setReverse(null);setReverseReason("");setAllowUsed(false);refresh();},onError:(e:Error)=>toast.error(errorText(e))});
 if(!allowed)return null;
 return <section className="space-y-3" aria-label="Продукты за реферальные бонусы">
  <Button variant="outline" className="gap-2 w-full sm:w-auto" disabled={busy||!context.data?.registered} onClick={()=>{setQuote(null);setOpen(true);}}><Gift className="h-4 w-4"/>Выдать продукты за бонусы</Button>
  {context.isError&&<p className="text-sm text-destructive">Не удалось проверить права и баланс. Выдача недоступна.</p>}
  {context.data&&!context.data.registered&&<p className="text-sm text-muted-foreground">Для выдачи нужен зарегистрированный аккаунт клиента.</p>}
  {(context.data?.history??[]).map((r:any)=><div key={r.id} className="rounded-md border p-3 space-y-2 text-sm">
   <div className="flex flex-wrap justify-between gap-2"><strong>Доступ по реферальной программе</strong><Badge variant="secondary">{r.status==="reversed"?"Отменён":"Оформлен"}</Badge></div>
   {r.items.map((item:any,index:number)=><p key={index}>{item.product_name} · {item.tariff_name}<br/><span className="text-xs text-muted-foreground">{date(item.starts_at)} — {date(item.expires_at)}</span></p>)}
   <p>Бонусы: {formatBynMinor(r.internal_minor+r.converted_cash_minor)} · Подарок компании: {formatBynMinor(r.subsidy_minor)}</p>
   <p className="text-xs text-muted-foreground">{date(r.created_at)} · {r.actor_name||"Администратор"} · {r.reason}</p>
   {Number(r.pending_projections)>0&&<p className="text-xs text-amber-700">Внешняя синхронизация: ожидает завершения ({r.pending_projections})</p>}
   {permissions.reverse&&r.status==="completed"&&<Button variant="outline" size="sm" onClick={()=>{setReverse(r.id);setReverseReason("");setAllowUsed(false);}}>Отменить выдачу</Button>}
  </div>)}
  <Dialog open={open} onOpenChange={value=>{if(!commit.isPending&&!calculate.isPending)setOpen(value);}}><DialogContent className="sm:max-w-3xl max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Продукты за реферальные бонусы</DialogTitle><DialogDescription>Отдельный доступ без платежа и автопродления. Все позиции оформляются вместе. Время доступа — Минск. Выдача действует в нашем приложении; доступ в GetCourse автоматически не выдаётся.</DialogDescription></DialogHeader>
   <div className="grid grid-cols-2 gap-2 text-sm rounded-md bg-muted p-3"><p>На продукты: <strong>{formatBynMinor(context.data?.balances.internal??0)}</strong></p><p>К выплате: <strong>{formatBynMinor(context.data?.balances.available??0)}</strong></p><p>Ожидает: {formatBynMinor((context.data?.balances.pending??0)+(context.data?.balances.internal_pending??0))}</p><p>В резерве: {formatBynMinor((context.data?.balances.held??0)+(context.data?.balances.internal_held??0))}</p></div>
   <fieldset disabled={commit.isPending||calculate.isPending} className="space-y-3">
   {cart.map(row=><div key={row.key} className="rounded-md border p-3 space-y-3">
    <div className="flex gap-2"><div className="min-w-0 flex-1"><Label htmlFor={`offer-${row.key}`}>Продукт, тариф и предложение</Label><select id={`offer-${row.key}`} className="mt-1 flex h-10 w-full rounded-md border bg-background px-2 text-sm" value={row.offerId} onChange={e=>change(row.key,{offerId:e.target.value,price:""})}><option value="">Выберите продукт</option>{catalog.filter(item=>item.eligible||permissions.override_catalog).map(item=><option key={item.offer_id} value={item.offer_id}>{item.product_name} · {item.tariff_name} · {formatBynMinor(item.amount_minor)}{!item.eligible?" · исключение":""}</option>)}</select></div><Button variant="ghost" size="icon" aria-label="Удалить позицию" className="mt-6 shrink-0" disabled={cart.length===1} onClick={()=>{setCart(rows=>rows.filter(x=>x.key!==row.key));setQuote(null);}}><Trash2 className="h-4 w-4"/></Button></div>
    <div className="grid sm:grid-cols-2 gap-3"><div><Label htmlFor={`unit-${row.key}`}>Срок</Label><div className="flex gap-2 mt-1"><Input aria-label="Количество месяцев или дней" type="number" min={1} max={row.unit==="months"?120:3660} value={row.count} onChange={e=>change(row.key,{count:Number(e.target.value)})}/><select id={`unit-${row.key}`} className="rounded-md border bg-background px-2 text-sm" value={row.unit} onChange={e=>change(row.key,{unit:e.target.value})}><option value="months">Месяцы</option><option value="days">Дни</option><option value="dates">Точные даты</option></select></div></div>
    <div><Label htmlFor={`start-${row.key}`}>Начало доступа</Label><select id={`start-${row.key}`} className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" value={row.startMode} onChange={e=>change(row.key,{startMode:e.target.value})}><option value="now">Сейчас</option><option value="after_current">После текущего доступа</option><option value="date">Указанная дата</option></select></div></div>
    {row.startMode==="date"&&<div><Label htmlFor={`date-${row.key}`}>Начало (часовой пояс устройства)</Label><Input id={`date-${row.key}`} type="datetime-local" value={row.start} onChange={e=>change(row.key,{start:e.target.value})}/></div>}
    {row.unit==="dates"&&<div><Label htmlFor={`end-${row.key}`}>Окончание (часовой пояс устройства)</Label><Input id={`end-${row.key}`} type="datetime-local" value={row.end} onChange={e=>change(row.key,{end:e.target.value})}/></div>}
    {permissions.override_catalog&&<div><Label htmlFor={`price-${row.key}`}>Стоимость всего периода, BYN (пусто — по каталогу)</Label><Input id={`price-${row.key}`} inputMode="decimal" value={row.price} onChange={e=>change(row.key,{price:e.target.value})}/><p className="text-xs text-muted-foreground mt-1">Для нестандартного периода регулярной подписки укажите согласованную стоимость. Изменение цены сохраняется в истории.</p></div>}
   </div>)}
   <Button variant="outline" size="sm" disabled={cart.length>=20} onClick={()=>{setCart(rows=>[...rows,fresh()]);setQuote(null);}} className="gap-1"><Plus className="h-4 w-4"/>Добавить продукт</Button>
   {permissions.convert_cash&&<div className="space-y-2 rounded-md border p-3"><Label htmlFor="referral-cash">Перевести денежную часть в бонусы, BYN</Label><Input id="referral-cash" inputMode="decimal" value={cash} onChange={e=>{setCash(e.target.value);setQuote(null);}}/>{Number(cash.replace(",","."))>0&&<><Label htmlFor="referral-consent">Подтверждение согласия клиента</Label><Textarea id="referral-consent" placeholder="Ссылка или дата согласия в переписке. Эта сумма больше не доступна к выплате." value={consent} onChange={e=>{setConsent(e.target.value);setQuote(null);}}/></>}</div>}
   {permissions.subsidy&&<label className="flex items-start gap-2 text-sm"><Checkbox checked={gift} onCheckedChange={value=>{setGift(value===true);setQuote(null);}}/><span>Покрыть недостающую сумму подарком компании. Я принимаю ответственность за решение.</span></label>}
   {providerWarning&&<div className="rounded-md border border-amber-400 bg-amber-50/50 p-3 space-y-2 text-sm"><p>У выбранного продукта есть привязка к регулярной подписке. Бонусный доступ не отменяет автосписания. Живой статус у провайдера этим экраном не проверен.</p><label className="flex items-start gap-2"><Checkbox checked={providerAck} onCheckedChange={value=>{setProviderAck(value===true);setQuote(null);}}/><span>Сохранить существующую подписку без изменений. Риск повторной оплаты проверен отдельно.</span></label></div>}
   <div><Label htmlFor="referral-reason">Основание выдачи и исключений</Label><Textarea id="referral-reason" value={reason} onChange={e=>{setReason(e.target.value);setQuote(null);}} placeholder="Почему выдаём доступ, согласованная цена и причина подарка"/></div>
   </fieldset>
   {quote&&<div className="rounded-md border bg-primary/5 p-3 space-y-2 text-sm" aria-live="polite"><strong>Проверьте перед подтверждением</strong>{quote.items.map((item:any,index:number)=><p key={index}>{item.product_name} · {item.tariff_name} · {formatBynMinor(item.price_minor)}<br/>{date(item.starts_at)} — {date(item.expires_at)}</p>)}<p>Всего: <strong>{formatBynMinor(quote.total_minor)}</strong></p><p>Бонусы: {formatBynMinor(quote.internal_minor)} · Конвертация: {formatBynMinor(quote.converted_cash_minor)} · Подарок: <strong>{formatBynMinor(quote.subsidy_minor)}</strong></p><p>Остаток на продукты: {formatBynMinor(quote.balances.internal-quote.internal_minor)} · К выплате: {formatBynMinor(quote.balances.available-quote.converted_cash_minor)}</p><p className="text-xs text-muted-foreground">Расчёт действует до {date(quote.expires_at)}. Денежного платежа не будет.</p></div>}
   <DialogFooter className="gap-2"><Button variant="outline" disabled={commit.isPending||calculate.isPending} onClick={()=>setOpen(false)}>Закрыть</Button><Button variant={quote?"outline":"default"} disabled={calculate.isPending||commit.isPending||reason.trim().length<5} onClick={()=>calculate.mutate()}>{calculate.isPending?<Loader2 className="h-4 w-4 animate-spin"/>:"Рассчитать"}</Button>{quote&&<Button disabled={commit.isPending||calculate.isPending} onClick={()=>commit.mutate()}>{commit.isPending?"Оформляем…":"Списать бонусы и выдать доступы"}</Button>}</DialogFooter>
  </DialogContent></Dialog>
  <Dialog open={reverse!==null} onOpenChange={value=>{if(!value&&!undo.isPending)setReverse(null);}}><DialogContent><DialogHeader><DialogTitle>Отменить реферальную выдачу</DialogTitle><DialogDescription>Будут отозваны только доступы этой операции. Бонусы и денежная часть вернутся в исходные балансы. Подарок компании не зачисляется на счёт клиента.</DialogDescription></DialogHeader><Label htmlFor="reverse-reason">Основание отмены</Label><Textarea id="reverse-reason" value={reverseReason} onChange={e=>setReverseReason(e.target.value)}/><label className="flex items-start gap-2 text-sm"><Checkbox checked={allowUsed} onCheckedChange={v=>setAllowUsed(v===true)}/><span>Разрешаю полную компенсацию, даже если доступ уже начался, и принимаю ответственность за это решение.</span></label><DialogFooter><Button variant="outline" disabled={undo.isPending} onClick={()=>setReverse(null)}>Закрыть</Button><Button variant="destructive" disabled={undo.isPending||reverseReason.trim().length<5} onClick={()=>undo.mutate()}>Отменить выдачу</Button></DialogFooter></DialogContent></Dialog>
 </section>;
}
