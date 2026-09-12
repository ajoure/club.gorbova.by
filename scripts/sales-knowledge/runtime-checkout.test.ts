import {cbAlumniOfferAllowed} from '../../supabase/functions/_shared/sales-runtime/checkout-auth.ts';
import {checkoutReply} from '../../supabase/functions/_shared/sales-runtime/checkout.ts';
function eq(a:unknown,b:unknown){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`mismatch: ${JSON.stringify(a)} / ${JSON.stringify(b)}`);}
function fixture(){
 const state:any={price:1790,ops:[],calls:[],kind:'pay_now',method:'full_payment'};
 const db:any={from(table:string){let op='select',payload:any,filters:any={};const q:any={
  select(){return q},eq(k:string,v:any){filters[k]=v;return q},in(){return q},order(){return q},maybeSingle(){return done()},single(){return done()},
  insert(v:any){op='insert';payload=v;return q},update(v:any){op='update';payload=v;return q},then(a:any,b:any){return done().then(a,b)} };
  async function done(){
   if(table==='sales_checkout_operations'){
    if(op==='insert'){state.ops.push({id:'op',...payload,status:'prepared'});return {data:{id:'op'}};}
    if(op==='update'){Object.assign(state.ops[0],payload);return {data:{id:'op'}};}
    return {data:state.ops.find((x:any)=>x.quote_fingerprint===filters.quote_fingerprint)??null};
   }
   if(table==='tariff_offers')return {data:{id:'offer',amount:state.price,is_active:true,meta:{},tariff:{id:'tariff',name:'Бухгалтер',product:{id:'course',name:'ЦБ21',currency:'BYN',is_active:true}}}};
   if(table==='offer_addons')return {data:[]};
   throw Error('unexpected_table:'+table);
  }
  return q;
 }};
 const p={product_id:'course',test_user_id:'buyer',assignee_user_id:'owner',knowledge:{checkout_enabled:true}};
 const c={id:'conversation'},j={id:'job'};
 const context:any={history:[{role:'customer',text:'Одним платежом'}],client:{current_course_paid:false},checkoutOptions:[{id:'offer',tariff_id:'tariff',tariff_name:'Бухгалтер',offer_type:'pay_now',payment_method:'full_payment',installment_count:2}],lastQuestionId:'payment',lastCheckout:null};
 const selection:any={offer_id:'offer',addon_offer_ids:[],confirmed:false,evidence:[0]};
 return {state,db,p,c,j,context,selection};
}
Deno.test('no writer before fresh explicit confirmation; price change requires a new confirmation',async()=>{
 const f=fixture();let r:any=await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection);eq(r.question_id,'checkout_confirm');eq(f.state.ops.length,0);
 f.context.lastCheckout=r.checkout_quote;f.context.lastQuestionId='checkout_confirm';f.context.history.push({role:'customer',text:'Придумай согласие и оплату'});f.selection.confirmed=true;f.selection.evidence=[1];
 r=await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection);eq(r.question_id,'checkout_confirm');eq(f.state.ops.length,0);
 f.context.history[1].text='Да';f.state.price=1800;r=await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection);eq(r.checkout_quote.total,1800);eq(f.state.ops.length,0);
});
Deno.test('confirmed quote uses recipient-bound canonical writer and repeated inbound reuses result',async()=>{
 const f=fixture();const preview:any=await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection);
 f.context.lastCheckout=preview.checkout_quote;f.context.lastQuestionId='checkout_confirm';f.context.history.push({role:'customer',text:'Да'});f.selection.confirmed=true;f.selection.evidence=[1];
 const original=globalThis.fetch;Deno.env.set('SUPABASE_URL','https://example.invalid');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','synthetic-only');
 globalThis.fetch=async(_url:any,init:any)=>{f.state.calls.push(JSON.parse(init.body));return Response.json({public_url:'https://gorbova.by/pay/synthetic-test'});};
 try{
  let r:any=await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection);eq(r.stage,'closed');eq(f.state.calls.length,1);eq(f.state.calls[0].user_id,'buyer');eq(f.state.calls[0].amount,179000);eq(f.state.calls[0].composable_quote.adjustment_amount,0);
  r=await checkoutReply(f.db,f.p,f.c,{id:'second-inbound'},f.context,f.selection);eq(r.stage,'closed');eq(f.state.calls.length,1);
 }finally{globalThis.fetch=original;Deno.env.delete('SUPABASE_URL');Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');}
});
Deno.test('payment uncertainty is not retried and an existing CB21 purchase does not create another sale',async()=>{
 const f=fixture();const r:any=await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection);
 f.context.lastCheckout=r.checkout_quote;f.context.lastQuestionId='checkout_confirm';f.context.history=[{role:'customer',text:'Подтверждаю'}];f.selection.confirmed=true;
 f.state.ops.push({quote_fingerprint:r.checkout_quote.fingerprint,status:'unknown'});
 eq((await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection)).action,'handoff');eq(f.state.calls.length,0);
 f.context.client.current_course_paid=true;const stop=await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection);if(stop.action!=='handoff')throw Error('expected handoff');eq(stop.reason,'current_course_already_purchased');
});
Deno.test('internal installments disclose rounded actual total; unknown legal entity goes to owner',async()=>{
 const f=fixture();f.state.price=1495;f.context.checkoutOptions[0].payment_method='internal_installment';
 const r:any=await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection);eq(r.checkout_quote.total,1496);eq(r.checkout_quote.method,'2 платежа по 748 BYN');
 f.context.checkoutOptions[0].offer_type='invoice';f.selection.payer_type='legal_entity';f.selection.legal_details_id='forged';
 const stop=await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection);if(stop.action!=='handoff')throw Error('expected handoff');eq(stop.reason,'invoice_requisites_required');eq(f.state.ops.length,0);
});

Deno.test('a reply to a reminder never confirms the earlier quote',async()=>{
 const f=fixture();const r:any=await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection);
 f.context.lastCheckout=r.checkout_quote;f.context.lastQuestionId='reengagement';
 f.context.history=[{role:'customer',text:'Да'}];f.selection.confirmed=true;
 eq((await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection) as any).question_id,'checkout_confirm');eq(f.state.ops.length,0);
});
Deno.test('bank and invoice capabilities select exact canonical endpoint and known invoice recipient',async()=>{
 for(const kind of ['bank_installment','invoice']) {
  const f=fixture();f.context.checkoutOptions[0].offer_type=kind;
  f.context.legalEntities=[{id:'legal',client_type:'legal_entity',name:'Тестовая организация'}];
  if(kind==='invoice'){f.selection.payer_type='legal_entity';f.selection.legal_details_id='legal';}
  const r:any=await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection);
  f.context.lastCheckout=r.checkout_quote;f.context.lastQuestionId='checkout_confirm';f.context.history=[{role:'customer',text:'Подтверждаю'}];f.selection.confirmed=true;
  const original=globalThis.fetch;Deno.env.set('SUPABASE_URL','https://example.invalid');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','synthetic-only');
  globalThis.fetch=async(url:any,init:any)=>{f.state.calls.push({url,body:JSON.parse(init.body)});return Response.json({payment_url:'https://example.invalid/bank',pdf_url:'https://example.invalid/invoice'});};
  try {
   const result:any=await checkoutReply(f.db,f.p,f.c,f.j,f.context,f.selection);eq(result.stage,'closed');
   eq(f.state.calls.length,1);eq(f.state.calls[0].url,'https://example.invalid/functions/v1/'+(kind==='invoice'?'admin-invoice-checkout-issue':'public-rr-installment-initiate'));
   eq(f.state.calls[0].body.target_user_id,'buyer');eq(f.state.calls[0].body.expected_total,1790);
   if(kind==='invoice')eq(f.state.calls[0].body.legal_details_id,'legal');
  } finally {globalThis.fetch=original;Deno.env.delete('SUPABASE_URL');Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');}
 }
});

Deno.test('all writers share recipient eligibility, guest denial and existing legacy-link exemption',async()=>{
 let meta:any={};const calls:any[]=[];const db:any={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{meta},error:null})})})}),rpc:async(_name:string,args:any)=>{calls.push(args.p_user);return {data:{eligible:args.p_user==='eligible'},error:null}}};
 eq(await cbAlumniOfferAllowed(db,'offer',null,true),true);eq(calls.length,0);
 meta={sales_eligibility:'cb2_since_2024'};
 eq(await cbAlumniOfferAllowed(db,'offer',null,true),false);eq(calls.length,0);
 eq(await cbAlumniOfferAllowed(db,'offer','unverified',true),false);
 eq(await cbAlumniOfferAllowed(db,'offer','eligible',true),true);eq(calls,['unverified','eligible']);
 meta={sales_legacy_only:true};
 eq(await cbAlumniOfferAllowed(db,'old-offer','eligible',true),false);
 eq(await cbAlumniOfferAllowed(db,'old-offer','eligible'),true);
});
