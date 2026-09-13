import { resolveTrainingContentFilters } from './access-resolver.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** Public description only. Actual grants remain exclusively in access-resolver.
 * No lesson text, URLs, private rule notes or purchaser information is exposed. */
export async function loadPublicTariffAccess(db:SupabaseClient,productId:string,tariffs:{id:string;access_days:number}[]) {
  const result:Record<string,any>={};
  if(!tariffs.length)return result;
  const {data:rules,error}=await db.from('access_rules').select('id,tariff_id,grant_target_type,target_ref,target_label,duration_days,conditions,priority')
    .eq('product_id',productId).eq('is_active',true).order('priority',{ascending:false});
  if(error)throw Error('public_access_rules_unavailable');
  if(!rules?.some(r=>r.grant_target_type==='training_content'))return result;
  const roots=[...new Set(rules.filter(r=>r.grant_target_type==='training_content').map(r=>r.target_ref))];
  const {data:modules,error:moduleError}=await db.from('training_modules').select('id,parent_module_id,title,sort_order').in('parent_module_id',roots).order('sort_order');
  if(moduleError)throw Error('public_access_modules_unavailable');
  const clubIds=rules.filter(r=>r.grant_target_type==='club').map(r=>r.target_ref);
  const sectionIds=rules.filter(r=>r.grant_target_type==='section_access').map(r=>r.target_ref);
  const grantTariffIds=rules.map(r=>(r.conditions as any)?.grant_tariff_id).filter(Boolean);
  const load=async(table:string,columns:string,ids:string[])=>{
    if(!ids.length)return [];
    const {data,error}=await db.from(table).select(columns).in('id',ids);
    if(error)throw Error('public_access_labels_unavailable');
    return data as any[];
  };
  const [clubs,sections,grantTariffs]=await Promise.all([
    load('telegram_clubs','id,club_name',clubIds),load('app_sections','id,label',sectionIds),load('tariffs','id,name',grantTariffIds),
  ]);
  const title=(r:any)=>{
    const label=r.grant_target_type==='club'?clubs.find(c=>c.id===r.target_ref)?.club_name:
      r.grant_target_type==='section_access'?sections.find(c=>c.id===r.target_ref)?.label:r.target_label;
    const grantTariff=grantTariffs.find(t=>t.id===r.conditions?.grant_tariff_id)?.name;
    return (label||r.target_label||'Доступ')+(grantTariff?` — тариф «${grantTariff}»`:'');
  };
  for(const tariff of tariffs){
    const filters=await resolveTrainingContentFilters(db,productId,tariff.id);
    const applicable=[...rules.filter(r=>r.tariff_id===tariff.id),...rules.filter(r=>!r.tariff_id)];
    const covered=new Set<string>();
    const grants=applicable.filter(r=>{const key=r.grant_target_type+':'+r.target_ref;if(covered.has(key))return false;covered.add(key);return true;});
    result[tariff.id]={
      modules:filters.flatMap(f=>(modules||[]).filter(m=>m.parent_module_id===f.root_module_id
        && ((rules.find(r=>r.id===f.rule_id)?.conditions as any)?.rule_purpose!=='bonus'||f.access_mode==='full'||f.allowed_module_ids.includes(m.id))).map(m=>({
        id:m.id,title:m.title+((rules.find(r=>r.id===f.rule_id)?.conditions as any)?.rule_purpose==='bonus' ? ` (бонус, ${rules.find(r=>r.id===f.rule_id)?.duration_days ?? tariff.access_days} дней)` : ''),included:f.access_mode==='full'||f.allowed_module_ids.includes(m.id),
        conditional:f.match_purchase_month,
      }))),
      benefits:grants.filter(r=>['club','section_access','product_access','entitlement'].includes(r.grant_target_type)).map(r=>({
        title:title(r),days:r.duration_days??tariff.access_days,
        conditional:!!(r.conditions as any)?.condition_type,
      })),
    };
  }
  return result;
}
