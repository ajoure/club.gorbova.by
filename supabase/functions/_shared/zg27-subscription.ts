import { validateZg27HostedMeta } from './zg27-hosted-installments.ts';
/** A pending finite subscription owns the initial CIT, without granting any access. */
export async function ensureZg27PendingSubscription(db:any,order:any,profileId:string|null) {
  const plan=validateZg27HostedMeta(order.meta,order.product_id,order.tariff_id,order.user_id);
  const {data:prior,error}=await db.from('subscriptions_v2').select('*').eq('order_id',order.id).maybeSingle();
  if(error)throw Error('zg27_subscription_read_failed');
  if(prior){
    if(prior.user_id!==order.user_id||prior.product_id!==order.product_id||prior.tariff_id!==order.tariff_id
      ||prior.billing_type!=='mit'||prior.auto_renew!==false||prior.meta?.model!=='zg27_application_managed_v1')throw Error('zg27_subscription_conflict');
    return prior;
  }
  const {data:sub,error:ie}=await db.from('subscriptions_v2').insert({user_id:order.user_id,profile_id:profileId,
    order_id:order.id,product_id:order.product_id,tariff_id:order.tariff_id,status:'past_due',billing_type:'mit',auto_renew:false,
    meta:{model:'zg27_application_managed_v1',zg27_setup:'pending_mandate',zg27_autopay_required:true,installment_count:plan.amounts_minor.length,checkout_order_id:order.id}}).select('*').single();
  if(ie||!sub)throw Error('zg27_subscription_create_failed');return sub;
}
/** Read-only proof before ANY access mutation, including trigger-driven grant replays. */
export async function requireZg27ReadySubscription(db:any,order:any) {
  validateZg27HostedMeta(order.meta,order.product_id,order.tariff_id,order.user_id);
  const {data:sub,error}=await db.from('subscriptions_v2').select('*').eq('order_id',order.id).maybeSingle();
  const binding=sub?.meta?.zg27_installment_orders?.[order.id];
  if(error||!sub||sub.user_id!==order.user_id||sub.product_id!==order.product_id||sub.tariff_id!==order.tariff_id
    ||!['past_due','active','expired'].includes(sub.status)||sub.billing_type!=='mit'||sub.auto_renew!==false
    ||sub.meta?.model!=='zg27_application_managed_v1'||sub.meta?.zg27_autopay_required!==true||sub.meta?.zg27_hosted_recurring_consent!==true
    ||binding?.payment_method_id!==sub.payment_method_id||!binding?.payment_id)throw Error('zg27_subscription_not_ready');
  const {data:pay,error:pe}=await db.from('payments_v2').select('*').eq('id',binding.payment_id).maybeSingle();
  const {data:card,error:ce}=await db.from('payment_methods').select('*').eq('id',binding.payment_method_id).maybeSingle();
  const plan=order.meta.zg27_installment;
  if(pe||ce||!pay||!card||pay.order_id!==order.id||pay.user_id!==order.user_id||pay.status!=='succeeded'||pay.provider!=='bepaid'
    ||pay.currency!=='BYN'||pay.is_deleted||Number(pay.refunded_amount||0)!==0||Math.round(Number(pay.amount)*100)!==plan.amounts_minor[0]
    ||card.user_id!==order.user_id||card.provider!=='bepaid'||card.status!=='active'||!card.provider_token)throw Error('zg27_subscription_not_ready');
  const {data:rows,error:se}=await db.from('installment_payments').select('*').eq('order_id',order.id);
  if(se||rows?.length!==plan.amounts_minor.length||!plan.amounts_minor.every((minor:number,i:number)=>{
    const found=rows.filter((r:any)=>r.payment_number===i+1);
    return found.length===1&&found[0].subscription_id===sub.id&&found[0].user_id===order.user_id
      &&Math.round(Number(found[0].amount)*100)===minor&&found[0].currency==='BYN'
      &&Date.parse(found[0].due_date)===Date.parse(pay.paid_at)+i*30*86400000;
  }))throw Error('zg27_subscription_schedule_incomplete');
  const next=rows.filter((r:any)=>['pending','processing'].includes(r.status)).sort((a:any,b:any)=>Date.parse(a.due_date)-Date.parse(b.due_date))[0];
  return {...sub,zg27_next_charge_at:next?.due_date||null};
}

export async function requireZg27ActivatedSubscription(db:any,order:any) {
  const sub=await requireZg27ReadySubscription(db,order);
  const end='2027-04-30T21:00:00.000Z';
  const {data:ent,error}=await db.from('entitlements').select('user_id,product_id,status,expires_at')
    .eq('user_id',order.user_id).eq('product_id',order.product_id).eq('status','active').maybeSingle();
  if(error||sub.status!=='active'||new Date(sub.access_end_at).toISOString()!==end||!ent
    ||ent.user_id!==order.user_id||ent.product_id!==order.product_id||ent.status!=='active'
    ||new Date(ent.expires_at).toISOString()!==end)throw Error('zg27_subscription_activation_incomplete');
  return sub;
}
