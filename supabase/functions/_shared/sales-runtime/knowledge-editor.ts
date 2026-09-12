import {DB,read,rpc} from './db.ts';
import {loadPublicTariffAccess} from '../public-tariff-access.ts';

/** Owner editor metadata only. Provider URLs stay on this server for equality checks. */
export async function knowledgeEditor(db:DB,campaign:any,actorId:string,body:any) {
  if(await rpc(db,'has_role_v2',{_user_id:actorId,_role_code:'super_admin'})!==true) throw Error('owner_required');
  const snapshot=await rpc(db,'sales_knowledge_snapshot',{p_campaign:campaign.id,p_actor:actorId});
  async function coveredModules(){
    const tariffs=await read(db.from('tariffs').select('id,access_days').eq('product_id',snapshot.product_id).eq('is_active',true));
    const access=await loadPublicTariffAccess(db,snapshot.product_id,tariffs);
    return new Set<string>(Object.values(access).flatMap((a:any)=>a.modules.filter((m:any)=>m.included).map((m:any)=>m.id)));
  }
  if(body.action==='knowledge_preview'||body.action==='knowledge_apply') {
    const covered=await coveredModules();
    if(Array.isArray(body.facts)) {
      const errors=body.facts.filter((f:any)=>f&&f.scope!=='background'&&!covered.has(f.module_id))
        .map((f:any)=>({fact_id:typeof f.id==='string'&&f.id.length<=100?f.id:null,reason:'module_not_in_product'}));
      if(errors.length)return {valid:false,errors};
    }
    return await rpc(db,'sales_replace_knowledge_facts',{
      p_campaign:campaign.id,p_actor:actorId,p_facts:body.facts,
      p_expected_knowledge_version:body.expected_knowledge_version,
      p_expected_facts_sha:body.expected_facts_sha,
      p_apply:body.action==='knowledge_apply',p_approved_facts_sha:body.approved_facts_sha??null,
    });
  }
  if(body.action==='knowledge_version') {
    if(!/^[0-9a-f-]{36}$/i.test(body.version_id??'')) throw Error('version_required');
    const version=await read(db.from('sales_knowledge_versions').select('facts').eq('id',body.version_id).eq('campaign_id',campaign.id).single());
    return {facts:version.facts};
  }
  if(body.action!=='knowledge_status') throw Error('invalid_knowledge_action');
  async function pages(table:string,select:string,filter:(q:any)=>any=(q)=>q) {
    const rows:any[]=[];
    for(let from=0;from<10000;from+=500) {
      const data=await read<any[]>(filter(db.from(table).select(select)).range(from,from+499));
      rows.push(...data);if(data.length<500)return rows;
    }
    throw Error('knowledge_catalog_incomplete');
  }
  const [sources,bindings,modules,gaps,covered]=await Promise.all([
    pages('course_transcription_sources','id,source_revision,enabled,provider',q=>q.order('id')),
    pages('course_transcription_bindings','source_id,block_id,lesson_id,block_updated_at',q=>q.order('source_id').order('block_id')),
    pages('training_modules','id,title,is_active',q=>q.eq('parent_module_id',snapshot.root_module_id).eq('product_id',snapshot.product_id).order('id')),
    pages('course_caption_gap_audits','id,source_id,source_revision,status',q=>q.in('status',['pending','review_required']).order('id')),
    coveredModules(),
  ]);
  const transcripts=sources.length?await pages('course_transcripts','source_id,source_revision,content_sha256,quality_status',q=>q.in('source_id',sources.map(s=>s.id)).order('source_id')):[];
  const targetLessons=modules.length?await pages('training_lessons','id,module_id,title,is_active',q=>q.in('module_id',modules.map(m=>m.id)).order('id')):[];
  const targetBlocks=targetLessons.length?await pages('lesson_blocks','id,lesson_id,content,updated_at',q=>q.in('lesson_id',targetLessons.map(l=>l.id)).eq('block_type','video').order('id')):[];
  const sourceBlocks=bindings.length?await pages('lesson_blocks','id,lesson_id,content,updated_at',q=>q.in('id',bindings.map(b=>b.block_id)).eq('block_type','video').order('id')):[];
  const sourceLessons=bindings.length?await pages('training_lessons','id,module_id,title',q=>q.in('id',[...new Set(bindings.map(b=>b.lesson_id))]).order('id')):[];
  const sourceModules=sourceLessons.length?await pages('training_modules','id,title',q=>q.in('id',[...new Set(sourceLessons.map(l=>l.module_id))]).order('id')):[];
  const catalog=sources.map(s=>{
    const t=transcripts.find(t=>t.source_id===s.id);
    const bs=bindings.filter(b=>b.source_id===s.id).map(b=>({b,block:sourceBlocks.find(x=>x.id===b.block_id)}))
      .filter(({b,block})=>block&&block.lesson_id===b.lesson_id&&Date.parse(block.updated_at)===Date.parse(b.block_updated_at));
    const lesson=sourceLessons.find(l=>l.id===bs[0]?.b.lesson_id);
    const module=sourceModules.find(m=>m.id===lesson?.module_id);
    const targets=targetBlocks.filter(block=>bs.some(({block:source})=>!!source.content?.url&&source.content.url===block.content?.url&&(source.content.provider??'')===(block.content?.provider??'')))
      .map(block=>{const lesson=targetLessons.find(l=>l.id===block.lesson_id)!;const module=modules.find(m=>m.id===lesson.module_id)!;
        return {block_id:block.id,module_id:module.id,title:module.title+' — '+lesson.title,open_now:module.is_active&&lesson.is_active,in_product:covered.has(module.id)};});
    return {id:s.id,title:[module?.title,lesson?.title].filter(Boolean).join(' — ')||'Источник без действующей привязки',
      source_revision:s.source_revision,source_sha256:t?.content_sha256??null,
      ready:!!s.enabled&&s.provider==='kinescope'&&!!t&&t.quality_status!=='rejected'&&t.source_revision===s.source_revision&&bs.length>0&&!gaps.some(g=>g.source_id===s.id&&g.source_revision===s.source_revision),targets};
  });
  return {...snapshot,sources:catalog};
}
