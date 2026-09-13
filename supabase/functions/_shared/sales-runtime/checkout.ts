import {DB,read} from './db.ts';
import {resolveComposableCheckout} from '../resolve-composable-checkout.ts';
import {calculateInstallmentPlan} from '../calculate-installment-plan.ts';
import {cbAlumniOfferAllowed,sha256} from './checkout-auth.ts';
const held=(reason:string)=>({action:'handoff' as const,reason});
function reply(text:string,question_id:string,stage:string,extra:Record<string,unknown>={}) {
 return {action:'reply' as const,text,question_id,stage,fact_ids:[],intent:'product_information',new_question_count:question_id==='none'?0:1,
   facts_verified:true,contains_paid_instruction:false,offer_verified:true,dialogue_version:'cb21-v2',...extra};
}
export async function checkoutReply(db:DB,p:any,c:any,job:any,context:any,selection:any) {
 if(context.client?.current_course_paid)return held('current_course_already_purchased');
 if(context.client?.current_course_checkout_hold)return held('current_course_existing_record_requires_review');
 const options=context.checkoutOptions??[];
 if(!selection?.offer_id) return reply('Планируете оплатить одним платежом, частями на платформе или оформить рассрочку банка «Ресурс развития»?','payment_kind','payment');
 const offer=options.find((o:any)=>o.id===selection.offer_id);
 if(!offer || !Array.isArray(selection.addon_offer_ids) || selection.addon_offer_ids.some((id:any)=>typeof id!=='string')) return held('checkout_selection_unverified');
 const invoice=offer.offer_type==='invoice';
 const payerType=selection.payer_type;
 const legal=context.legalEntities?.find((x:any)=>x.id===selection.legal_details_id);
 if(invoice&&!['individual','legal_entity','entrepreneur'].includes(payerType)) return reply('На кого оформляем счёт: на физическое лицо, ИП или организацию?','invoice_payer','payment');
 if(invoice&&payerType!=='individual'&&(!legal||legal.client_type!==payerType))return held('invoice_requisites_required');
 if(!['pay_now','bank_installment','invoice'].includes(offer.offer_type))return held('payment_method_unavailable');
 if(!await cbAlumniOfferAllowed(db,offer.id,p.test_user_id,true))return held('alumni_eligibility_unverified');
 const canonical=await resolveComposableCheckout(db,{parentOfferId:offer.id,addonOfferIds:selection.addon_offer_ids});
 if(canonical.adjustment_amount!==0||canonical.currency!=='BYN'||canonical.total<=0) return held('checkout_quote_invalid');
 const installment=offer.offer_type==='pay_now'&&offer.payment_method==='internal_installment';
 const plan=installment?calculateInstallmentPlan({total_amount_kopecks:Math.round(canonical.total*100),selected_cycles:offer.installment_count}):null;
 const method=invoice?`Счёт: ${legal?.name??'физическое лицо'}`:offer.offer_type==='bank_installment'?'Рассрочка банка «Ресурс развития»':installment?`${offer.installment_count} платежа по ${plan!.per_payment_kopecks/100} BYN`:'Одним платежом';
 const quote={offer_id:offer.id,tariff_id:offer.tariff_id,addon_offer_ids:[...selection.addon_offer_ids].sort(),
   total:plan?plan.effective_total_kopecks/100:canonical.total,currency:canonical.currency,method,
   items:canonical.items.map(i=>({product_id:i.product_id,offer_id:i.offer_id,name:i.role==='primary'?offer.tariff_name:i.product_name,amount:i.final_amount})),
   installment_count:plan?offer.installment_count:null, payer_type:invoice?payerType:null, legal_details_id:invoice?legal?.id??null:null};
 const fingerprint=await sha256(JSON.stringify(quote));
 const previous=context.lastCheckout;
 const lastCustomerIndex=context.history.findLastIndex((m:any)=>m.role==='customer');
 const confirmsFresh=/^(да([, ]+(всё верно|все верно|подтверждаю|согласен|согласна))?|подтверждаю|согласен|согласна|оформляйте|давайте)[.!\s]*$/iu.test(context.history[lastCustomerIndex]?.text?.trim()??'')&&selection.confirmed===true&&selection.evidence?.includes(lastCustomerIndex)&&context.lastQuestionId==='checkout_confirm';
 if(!confirmsFresh||previous?.fingerprint!==fingerprint) {
  const items=quote.items.map((i:any)=>`• ${i.name} — ${i.amount} BYN`).join('\n');
  return reply(`${items}\n\n${method}. Итого ${quote.total} BYN.\n\nПодтверждаете этот состав и способ оплаты?`,'checkout_confirm','checkout_confirm',{checkout_quote:{...quote,fingerprint}});
 }
 if(p.knowledge?.checkout_enabled!==true)return held('checkout_not_enabled');
 // One operation per inbound job. An uncertain canonical response is never retried.
 const {data:prior,error:priorError}=await db.from('sales_checkout_operations').select('status,result_url').eq('conversation_id',c.id).eq('quote_fingerprint',fingerprint).maybeSingle();
 if(priorError)throw Error('checkout_history_unavailable');
 if(prior) return prior.status==='completed'&&prior.result_url?reply(`Ссылка для оформления:\n${prior.result_url}`,'none','closed'):held('checkout_operation_needs_review');
 const endpoint=invoice?'admin-invoice-checkout-issue':offer.offer_type==='bank_installment'?'public-rr-installment-initiate':'admin-create-public-link';
 const requestBody=invoice?{target_user_id:p.test_user_id,product_id:p.product_id,offer_id:offer.id,addon_offer_ids:selection.addon_offer_ids,payer_type:payerType,legal_details_id:legal?.id??null,expected_total:canonical.total,responsible_user_id:p.assignee_user_id,adjustment_amount:0}:endpoint==='public-rr-installment-initiate'?{
   tariff_offer_id:offer.id,addon_offer_ids:selection.addon_offer_ids,target_user_id:p.test_user_id,responsible_user_id:p.assignee_user_id,
   adjustment_amount:0,adjustment_reason:null,expected_total:canonical.total,
 }: {product_id:p.product_id,tariff_id:offer.tariff_id,offer_id:offer.id,amount:Math.round(canonical.total*100),currency:'BYN',
   user_id:p.test_user_id,responsible_user_id:p.assignee_user_id,payment_type:installment?'subscription':'one_time',
   installment_offer:installment,selected_installment_months:installment?offer.installment_count:undefined,
   composable_quote:{selected_addon_offer_ids:selection.addon_offer_ids,adjustment_amount:0,adjustment_reason:null},
   max_uses:1,expires_at:new Date(Date.now()+24*3600000).toISOString(),resolved_mode:'canonical',cta_source:'sales_runtime',provider_choice_source:'auto'};
 const token=[...crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const op=await read(db.from('sales_checkout_operations').insert({job_id:job.id,conversation_id:c.id,quote_fingerprint:fingerprint,endpoint,token_hash:await sha256(token),request_body:requestBody}).select('id').single());
 try {
  const response=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,'x-sales-checkout-capability':token},body:JSON.stringify(requestBody),signal:AbortSignal.timeout(35000)});
  const result=await response.json();
  const url=invoice?result.pdf_url:endpoint==='admin-create-public-link'?result.public_url:result.payment_url;
  if(!response.ok||typeof url!=='string'||!url.startsWith('https://'))throw Error('canonical_checkout_unconfirmed');
  await read(db.from('sales_checkout_operations').update({status:'completed',result_url:url}).eq('id',op.id).select('id').single());
  return reply(`Ссылка для оформления:\n${url}`,'none','closed',{checkout_quote:{...quote,fingerprint},intent:'checkout_link'});
 } catch {
  await read(db.from('sales_checkout_operations').update({status:'unknown'}).eq('id',op.id).select('id').single());
  return held('checkout_operation_needs_review');
 }
}
