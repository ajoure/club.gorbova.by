import {readFileSync} from 'node:fs';
const modules=['64d9f812-617c-41a8-b3dc-bb113156d6f3','ea98d043-e852-443f-8807-6e77de6a5e1f','99f1f156-f384-417e-bdf8-9203eb3c9d42','d7effaf4-9be0-4ce2-971b-e02fe2a85a9a','abee24cd-5c8b-4111-a6cb-7dee7acf168c','9187db54-8f57-42eb-bbcb-d7103d2459a9','064dd768-de8b-40db-89bc-f8d4a7e442ba','f833c846-a78d-4096-9dac-b8417d588371'];
export function sourceTimestamp(value){
 if(!value)return null;
 const m=/^(2024)-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
 if(!m)throw Error('Unexpected source timestamp');
 const iso=`${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2,'0')}:${m[5]}:${m[6]}+03:00`;
 if(!Number.isFinite(Date.parse(iso))||new Date(Date.parse(iso)+10800000).toISOString().slice(0,19)!==iso.slice(0,19))throw Error('Invalid source timestamp');
 return iso;
}
export function buildDateRepair(actions,source){
 if(source.timezone!=='Europe/Moscow'||source.date_column!=='D'||source.paid_column!=='E'||source.spreadsheet_id!=='1dw8ljnBwfyNn26INHdwxt7MdRGs7aX5qkby7V1wWUq8')throw Error('Unexpected source contract');
 const map=new Map(source.rows.map(r=>[r.ref,r]));if(map.size!==source.rows.length)throw Error('Duplicate source ref');
 const items=[],unknown=[];
 for(const a of actions){
  const rows=a.refs.map(ref=>{if(!map.has(ref))throw Error('Missing source ref');return map.get(ref)});
  const index=modules.indexOf(a.product_id);
  if(a.kind==='module_only_standalone'&&index<0)throw Error('Unknown module');
  const selected=a.kind==='module_only_standalone'?rows.filter(r=>r.module_flags[index]===1||r.module_flags[index]==='1'):rows;
  if(!selected.length)throw Error('No source purchase flag');
  const dated=selected.map(r=>({...r,date:sourceTimestamp(r.created_at)})).filter(r=>r.date).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
  if(!dated.length){unknown.push({id:a.id,refs:a.refs});continue;}
  const first=dated[0];
  items.push({id:a.id,product_id:a.product_id,refs:a.refs,deal_date:first.date,source_date_ref:first.ref,source_paid_at:sourceTimestamp(first.paid_at)});
 }
 if(new Set(items.map(a=>a.id)).size!==items.length)throw Error('Duplicate repair ID');
 return{items,unknown};
}
export function renderDateMigration(hashes){
 if(!hashes.length||hashes.some(h=>!/^[a-f0-9]{64}$/.test(h)))throw Error('Expected fixed payload hashes');
 const trigger=readFileSync(new URL('../../supabase/migrations/20260911142000_historical_unknown_purchase_month.sql',import.meta.url),'utf8')
  .replace("AND current_meta->>'history_only' = 'true'\n     AND current_meta->>'source_purchase_date_unknown' = 'true'", "AND current_meta->>'history_only' = 'true'")
  .replace('-- This owner-approved history has no known purchase date. The import month\n  -- must not become a current-month purchase or unlock monthly content.', '-- History-only facts never unlock monthly content, even after restoring\n  -- their actual source date. Keep the existing no-month access boundary.');
 const body=readFileSync(new URL('./date-repair.sql',import.meta.url),'utf8');
 return trigger+'\n'+body.replace('/* FIXED_HASHES */',hashes.map(h=>`'${h}'`).join(','));
}
