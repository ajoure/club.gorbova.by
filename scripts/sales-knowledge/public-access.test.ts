import {loadPublicTariffAccess} from '../../supabase/functions/_shared/public-tariff-access.ts';
const eq=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(JSON.stringify({a,b}));};
Deno.test('public and bot summaries follow canonical rule changes, bonus durations and current grant names',async()=>{
 const state:any={access_rules:[
  {id:'main',product_id:'p',tariff_id:'t',is_active:true,grant_target_type:'training_content',target_ref:'root',conditions:{access_mode:'partial',allowed_module_ids:['a']}},
  {id:'bonus',product_id:'p',tariff_id:'t',is_active:true,grant_target_type:'club',target_ref:'club',duration_days:30,conditions:{grant_tariff_id:'club-t'}},
 ],training_modules:[{id:'a',parent_module_id:'root',title:'Тема А'},{id:'b',parent_module_id:'root',title:'Тема Б'}],telegram_clubs:[{id:'club',club_name:'Клуб'}],tariffs:[{id:'club-t',name:'Full'}]};
 const db:any={from:(table:string)=>{const filters:((row:any)=>boolean)[]=[];const q:any={select:()=>q,order:()=>q,eq:(k:string,v:any)=>{filters.push(r=>r[k]===v);return q},in:(k:string,v:any[])=>{filters.push(r=>v.includes(r[k]));return q},then:(resolve:any)=>resolve({data:(state[table]||[]).filter((r:any)=>filters.every(f=>f(r))),error:null})};return q;}};
 let summary=(await loadPublicTariffAccess(db,'p',[{id:'t',access_days:180}])).t;
 eq(summary.modules.map((m:any)=>m.included),[true,false]);eq(summary.benefits[0],{title:'Клуб — тариф «Full»',days:30,conditional:false});
 state.access_rules[0].conditions.allowed_module_ids=['a','b'];state.access_rules[1].duration_days=14;state.tariffs[0].name='Business';
 summary=(await loadPublicTariffAccess(db,'p',[{id:'t',access_days:180}])).t;
 eq(summary.modules.map((m:any)=>m.included),[true,true]);eq(summary.benefits[0].days,14);eq(summary.benefits[0].title,'Клуб — тариф «Business»');
 state.access_rules[1].is_active=false;
 eq((await loadPublicTariffAccess(db,'p',[{id:'t',access_days:180}])).t.benefits,[]);
});
Deno.test('unavailable rules fail closed instead of showing stale entitlement claims',async()=>{
 const q:any={select:()=>q,eq:()=>q,order:()=>q,then:(f:any)=>f({data:null,error:{message:'unavailable'}})};
 let failed=false;try{await loadPublicTariffAccess({from:()=>q} as any,'p',[{id:'t',access_days:180}]);}catch{failed=true;}eq(failed,true);
});
