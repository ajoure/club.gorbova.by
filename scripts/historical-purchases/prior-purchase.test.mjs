import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkPriorPurchase} from '../../supabase/functions/_shared/check-prior-purchase.ts';
import {hasHistoricalComponent,isModuleOnlyHistory} from '../../supabase/functions/_shared/historical-component-purchase.ts';

function client(orders,profiles=[]) {
  const value=(row,key)=>key.includes('->>')?row[key.split('->>')[0]]?.[key.split('->>')[1]]:row[key];
  return {from(table){
    let predicates=[],start=0,end=Infinity,sortKey;
    const run=()=>{
      let data=(table==='profiles'?profiles:orders).filter(row=>predicates.every(p=>p(row)));
      if(sortKey)data=[...data].sort((a,b)=>String(a[sortKey]).localeCompare(String(b[sortKey])));
      return {data:data.slice(start,end+1),error:null};
    };
    const q={
      select(){return q;},
      eq(k,v){predicates.push(r=>value(r,k)===v);return q;},
      neq(k,v){predicates.push(r=>value(r,k)!==v);return q;},
      in(k,vs){predicates.push(r=>vs.includes(value(r,k)));return q;},
      not(k,op,v){assert.equal(op,'is');predicates.push(r=>value(r,k)!==v);return q;},
      contains(k,v){predicates.push(r=>Object.entries(v).every(([key,list])=>list.every(x=>r[k]?.[key]?.includes(x))));return q;},
      order(k){sortKey=k;return q;},
      range(a,b){start=a;end=b;return q;},
      then(resolve,reject){return Promise.resolve(run()).then(resolve,reject);},
    };return q;
  }};
}
const paid=(id,product='module-a',overrides={})=>({id,product_id:product,user_id:'buyer',profile_id:'contact',
  status:'paid',is_deleted:false,tariff_id:null,purchase_snapshot:null,...overrides});

test('deleted paid orders cannot establish prior purchase; NULL deletion remains nondeleted',async()=>{
  const c=client([paid('deleted','module-a',{is_deleted:true}),paid('valid','module-a',{is_deleted:null})]);
  const r=await checkPriorPurchase(c,'buyer','module-a','current');
  assert.equal(r.order_id,'valid');
  assert.equal((await checkPriorPurchase(client([paid('deleted','module-a',{is_deleted:true})]),'buyer','module-a','current')).found,false);
});

test('a mapped component in a split-child or multi-module order is recognized without a duplicate order',async()=>{
  for (const type of ['module_child_purchase','module_only_standalone','base_tariff_purchase']) {
    const c=client([paid('parent','course',{purchase_snapshot:{historical_purchase_type:type,module_list_mapped:['module-a','module-b']}})]);
    const r=await checkPriorPurchase(c,'buyer','module-b','current');
    assert.equal(r.found,true);assert.equal(r.match_type,'module_list_mapped');assert.equal(r.order_id,'parent');
    assert.equal((await checkPriorPurchase(c,'buyer','not-purchased','current')).found,false);
  }
});

test('profiles resolve legacy ownership without borrowing another account purchase',async()=>{
  const c=client([paid('legacy','module-a',{user_id:null}),paid('foreign','module-b',{user_id:'other',profile_id:'other-contact'})],
    [{id:'contact',user_id:'buyer'}]);
  assert.equal((await checkPriorPurchase(c,'buyer','module-a','current')).order_id,'legacy');
  assert.equal((await checkPriorPurchase(c,'buyer','module-b','current')).found,false);
});

test('a full tariff order after the first page wins over parent-shaped module-only orders',async()=>{
  const rows=Array.from({length:1001},(_,i)=>paid(`a-${String(i).padStart(5,'0')}`,'course',
    {tariff_id:'parent-tier',purchase_snapshot:{historical_purchase_type:'module_child_purchase',module_list_mapped:['module-a']}}));
  rows.push(paid('z-full','course',{tariff_id:'full-tier',purchase_snapshot:{historical_purchase_type:'base_tariff_purchase'}}));
  const r=await checkPriorPurchase(client(rows),'buyer','course','current');
  assert.equal(r.order_id,'z-full');
});

test('unknown component formats and plain names never invent mapped purchases',()=>{
  assert.equal(hasHistoricalComponent({historical_purchase_type:'unknown',module_list_mapped:['module-a']},'module-a'),false);
  assert.equal(hasHistoricalComponent({historical_purchase_type:'base_tariff_purchase',title:'module-a'},'module-a'),false);
  assert.equal(isModuleOnlyHistory('module_child_purchase'),true);
});
