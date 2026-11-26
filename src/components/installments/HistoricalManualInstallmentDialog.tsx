import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeAuthenticatedFunction } from '@/utils/invokeAuthenticatedFunction';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAdminAccess } from '@/hooks/useAdminAccess';

type Preview={success:boolean;confirmed:boolean;fingerprint?:string;order_id:string;total_byn:number;paid_byn:number;
  remaining_byn:number;second_due_at:string;error?:string};
export function HistoricalManualInstallmentDialog({profileId,userId}:{profileId?:string|null;userId?:string|null}) {
  const access=useAdminAccess(); const cache=useQueryClient();
  const [open,setOpen]=useState(false),[orderId,setOrderId]=useState(''),[total,setTotal]=useState(''),
    [interval,setInterval]=useState('30'),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),
    [preview,setPreview]=useState<Preview|null>(null),[message,setMessage]=useState('');
  const requestId=useRef(crypto.randomUUID());
  const orders=useQuery({queryKey:['historical-manual-orders',profileId,userId],enabled:open && !!profileId && !!userId,
    queryFn:async()=>{
      const {data,error}=await supabase.from('orders_v2').select('id,order_number,final_price,paid_amount,product_id,products_v2(name),payments_v2(id,status,amount,is_deleted)')
        .eq('profile_id',profileId!).eq('user_id',userId!).eq('is_deleted',false).in('status',['paid','partial']).gt('paid_amount',0).order('created_at',{ascending:false});
      if(error)throw error;return data;
    }});
  if(!profileId || !userId || !access.canAccessSection('payments','edit')) return null;
  const order=orders.data?.find(o=>o.id===orderId);
  const receipt=order?.payments_v2.filter(p=>p.status==='succeeded' && !p.is_deleted && Number(p.amount)>0);
  const reset=()=>{setPreview(null);setMessage('');};
  const invalidate=()=>{cache.invalidateQueries({queryKey:['contact-internal-installments']});cache.invalidateQueries({queryKey:['contact-deals']});cache.invalidateQueries({queryKey:['admin-deals']});};
  const send=async(action:'preview'|'confirm'|'ensure_access')=>{
    if(!orderId || (action!=='ensure_access' && receipt?.length!==1))return;
    setBusy(true);setMessage('');
    try {
      const {data,error}=await invokeAuthenticatedFunction<Preview & {access?:{state:string};agreement_saved?:boolean}>('admin-historical-manual-installment',{action,
        profile_id:profileId,order_id:orderId,first_payment_id:receipt?.[0]?.id,total_byn:Number(total),interval_days:Number(interval),
        reason,request_id:requestId.current,fingerprint:preview?.fingerprint});
      if(error || data?.error || !data?.success)throw Error(data?.error || 'Операция не подтверждена. Обновите данные и проверьте исходную сделку.');
      if(action==='ensure_access')setMessage(data.access?.state==='complete'?'Доступ по исходной сделке проверен.':'Выдача уже запускалась; требуется проверка результата. Повторно не запускаем.');
      else setPreview(data);
      if(action!=='preview')invalidate();
    }catch(e){setMessage(e instanceof Error?e.message:'Не удалось проверить операцию');}finally{setBusy(false);}
  };
  return <Dialog open={open} onOpenChange={v=>{if(!busy)setOpen(v);}}><DialogTrigger asChild>
    <Button variant="outline" size="sm">Оформить историческую рассрочку</Button>
  </DialogTrigger><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader>
    <DialogTitle>Подтверждённая ручная рассрочка</DialogTitle>
    <DialogDescription>Только ранее согласованные два взноса по существующей покупке. Первый взнос должен быть зарегистрирован. Новая покупка и автосписание не создаются.</DialogDescription>
  </DialogHeader><div className="space-y-4">
    <div className="space-y-2"><Label htmlFor="historical-order">Исходная сделка</Label>
      <select id="historical-order" className="w-full rounded-md border bg-background p-2" disabled={busy || !!preview?.confirmed} value={orderId} onChange={e=>{
        setOrderId(e.target.value); const o=orders.data?.find(o=>o.id===e.target.value);setTotal(o?String(Number(o.paid_amount)*2):'');reset();requestId.current=crypto.randomUUID();
      }}><option value="">Выберите сделку</option>{orders.data?.map(o=><option key={o.id} value={o.id}>{o.order_number} · {o.products_v2?.name} · оплачено {o.paid_amount} BYN</option>)}</select>
      {orders.isError && <p role="alert">Не удалось загрузить сделки. Закройте окно и повторите проверку.</p>}
    </div>
    <div className="space-y-2"><Label htmlFor="historical-total">Подтверждённая общая сумма, BYN</Label><Input id="historical-total" type="number" min="1" step="0.01" disabled={busy || !!preview?.confirmed} value={total} onChange={e=>{setTotal(e.target.value);reset();}}/></div>
    <div className="space-y-2"><Label htmlFor="historical-interval">Срок второго взноса, дней от первой оплаты</Label><Input id="historical-interval" type="number" min="1" max="366" disabled={busy || !!preview?.confirmed} value={interval} onChange={e=>{setInterval(e.target.value);reset();}}/></div>
    <div className="space-y-2"><Label htmlFor="historical-reason">Решение владельца и основание</Label><Textarea id="historical-reason" disabled={busy || !!preview?.confirmed} value={reason} onChange={e=>{setReason(e.target.value);reset();}} placeholder="Укажите подтверждённые условия и основание исправления"/></div>
    {preview && <div className="rounded-lg border p-3 text-sm space-y-1" aria-live="polite"><p>Общая сумма: {preview.total_byn} BYN</p><p>Подтверждено оплатами: {preview.paid_byn} BYN</p><p>Осталось: {preview.remaining_byn} BYN</p><p>Второй взнос: до {new Date(preview.second_due_at).toLocaleDateString('ru-RU',{timeZone:'Europe/Minsk'})}</p><p>Доступ и платежи сохраняются. По остатку будет доступна только разовая ссылка.</p></div>}
    {message && <p role="status" className="text-sm break-words">{message}</p>}
    <div className="flex flex-wrap gap-2">
      {!preview?.confirmed && <Button variant="outline" disabled={busy || !orderId || reason.trim().length<10 || receipt?.length!==1} onClick={()=>send('preview')}>Проверить расчёт</Button>}
      {preview && !preview.confirmed && <Button disabled={busy} onClick={()=>send('confirm')}>Подтвердить условия</Button>}
      {preview?.confirmed && <Button disabled={busy} onClick={()=>send('ensure_access')}>Проверить доступ по первому взносу</Button>}
    </div>
  </div></DialogContent></Dialog>;
}
