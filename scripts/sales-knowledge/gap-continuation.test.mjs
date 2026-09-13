import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {sha} from './lib/course-stt.mjs';
import {prepareGapAudit} from './lib/gap-audit.mjs';
import {prepareGapContinuation,executeGapContinuation} from './lib/gap-continuation.mjs';
import {COURSE_PRODUCT_IDS} from './lib/course-provider-import.mjs';
const owner='00000000-0000-4000-8000-000000000001',staff='00000000-0000-4000-8000-000000000002';
const lesson='11111111-1111-4111-8111-111111111111',block='22222222-2222-4222-8222-222222222222';
const heldText='Unverified English response.',heldHash=sha(heldText);
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const digest=v=>sha(canonical(v));
let db;
before(async()=>{
 db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${owner}'),('${staff}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION public.has_role_v2(_user_id uuid,_role_code text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT _user_id='${owner}'::uuid AND _role_code='super_admin' $$;
 GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
 CREATE TABLE public.training_lessons(id uuid PRIMARY KEY);INSERT INTO training_lessons VALUES('${lesson}');
 CREATE TABLE public.lesson_blocks(id uuid PRIMARY KEY);INSERT INTO lesson_blocks VALUES('${block}');
 CREATE TABLE public.products_v2(id uuid PRIMARY KEY);INSERT INTO products_v2 VALUES('${COURSE_PRODUCT_IDS[1]}');`);
 for(const f of ['20260911172902_90aeec8b-4b8d-4ff2-b180-19e2d6ad992a.sql','20260911184123_9c93b1c8-09c9-4f6a-9f80-d1490ed4f009.sql','20260911200704_62084073-0485-4613-8b9f-38c2cdf67e1b.sql','20260911202441_course_gap_continuation.sql'])
   await db.exec(await readFile(new URL('../../supabase/migrations/'+f,import.meta.url),'utf8'));
});
after(async()=>await db?.close());
const one=async(q,p=[]) =>(await db.query(q,p)).rows[0];
async function rpc(name,args){await db.exec('SET ROLE service_role');try{return (await one(`SELECT public.${name}(${Object.values(args).map((_,i)=>'$'+(i+1)).join(',')}) r`,Object.values(args).map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v))).r;}finally{await db.exec('RESET ROLE');}}

async function fixture(){
 const video=randomUUID(),sourceId=randomUUID(),state={revision:1,paid:0};
 const raw='WEBVTT\n\n'+[['00:00:00.000','00:01:40.000'],['00:03:50.000','00:05:30.000'],['00:08:40.000','00:10:20.000'],['00:12:30.000','00:16:40.000']].map(([a,b])=>`${a} --> ${b}\nУчебная конференция, обсуждение вопросов по программе курса.`).join('\n\n')+'\n';
 const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"';
 const playlist='#EXTM3U\n#EXT-X-MAP:URI="audio.m4a",BYTERANGE="4@0"\n'+Array.from({length:250},(_,i)=>`#EXTINF:4,\n#EXT-X-BYTERANGE:4@${4+i*4}\naudio.m4a`).join('\n')+'\n#EXT-X-ENDLIST';
 const mock={training_modules:[{id:'m',product_id:COURSE_PRODUCT_IDS[1],is_active:true}],training_lessons:[{id:lesson,module_id:'m',product_id:COURSE_PRODUCT_IDS[1],is_active:true}],
   lesson_blocks:[{id:block,lesson_id:lesson,block_type:'video',content:{url:'https://kinescope.io/testAlias'},updated_at:'2026-01-01T00:00:00.000Z'}],integration_instances:[{id:'i',config:{api_token:'synthetic-only'}}]};
 const io={rpc,async rows(table,select,filters={}){
   if(mock[table])return mock[table];assert.match(table,/^course_(transcription_sources|transcription_bindings|caption_gap_audits|caption_gap_parts|gap_evidence_annotations|gap_continuations)$/);
   const entries=Object.entries(filters).filter(([k])=>k!=='order'),values=entries.map(([,v])=>v.slice(3));
   const where=entries.map(([k],i)=>`${k}=$${i+1}`).join(' AND '),order=filters.order?' ORDER BY part_index':'';
   return (await db.query(`SELECT ${select} FROM public.${table}${where?' WHERE '+where:''}${order}`,values)).rows;
 },async provider(){return {data:{id:video,duration:1000,version:state.revision,updated_at:'2026-01-01',audio_tracks:[{id:'44444444-4444-4444-8444-444444444444',file_size:100000000,download_link:'https://kinescopecdn.net/audio'}]}};}};
 const pub={page:async()=>`playerOptions = ${JSON.stringify({playlist:[{id:video,meta:{duration:1000},vtt:[{srcLang:'ru',src:'https://kinescopecdn.net/ru.vtt'}],sources:{hls:{src:'https://kinescopecdn.net/master.m3u8'}}}]})};`,caption:async u=>u.endsWith('ru.vtt')?raw:u.endsWith('master.m3u8')?master:playlist};
 const media={range:async(u,o,n)=>Buffer.alloc(n,1),decode:async(b,t,d)=>Buffer.alloc(d*32,1)};
 const initial=await prepareGapAudit(io,pub,owner,'testAlias',media),original=initial.manifest,s=original.source;
 await db.query(`INSERT INTO course_transcription_sources(id,provider,video_id,source_revision,duration_ms,audio_track_id,audio_bytes,enabled,created_by) VALUES($1,'kinescope',$2,$3,$4,$5,$6,true,$7)`,[sourceId,s.video_id,s.source_revision,s.duration_ms,s.audio_track_id,s.audio_bytes,owner]);
 await db.query('INSERT INTO course_transcription_bindings(source_id,lesson_id,block_id,product_id,block_updated_at) VALUES($1,$2,$3,$4,$5)',[sourceId,lesson,block,COURSE_PRODUCT_IDS[1],s.bindings[0].block_updated_at]);
 const parts=original.parts.map(p=>Object.fromEntries(['part_index','gap_index','start_ms','end_ms','audio_sha256'].map(k=>[k,p[k]])));
 const a=await rpc('course_gap_audit_create',{source:sourceId,actor:owner,revision:s.source_revision,raw,caption:s.caption_sha256,manifest:digest(original),parts});
 const first=await rpc('course_gap_claim',{audit:a.audit_id,index:0,audio:parts[0].audio_sha256,manifest:digest(original)});
 await rpc('course_gap_finish',{audit:a.audit_id,index:0,token:first.claim_token,text:heldText,error:'asr_outcome_uncertain'});
 const prepared=await prepareGapContinuation(io,pub,owner,original,sha(JSON.stringify(original,null,2)+'\n'),a.audit_id,heldHash,media);
 const call=async()=>{state.paid++;return state.paid%2?'Unverified foreign response.':'Непроверенная реплика.';};
 return {io,pub,media,state,prepared,original,auditId:a.audit_id,sourceId,call};
}
const execute=(f,call=f.call)=>executeGapContinuation(f.io,f.pub,owner,f.prepared.manifest,f.prepared,call);
const held=async f=>(await db.query('SELECT * FROM course_caption_gap_parts WHERE audit_id=$1 AND part_index=0',[f.auditId])).rows[0];
const authorize=async f=>rpc('course_gap_continue_authorize',{audit:f.auditId,actor:owner,approval:digest(f.prepared.manifest),revision:f.original.source.source_revision,caption:f.original.source.caption_sha256,manifest:digest(f.original),held:heldHash});
const claim=(f,c,i)=>rpc('course_gap_continue_claim',{continuation:c.continuation_id,approval:digest(f.prepared.manifest),index:i,audio:f.original.parts[i]?.audio_sha256||'a'.repeat(64)});

test('continuation dry-run has no writes/calls and contains no held text, URLs or claim tokens',async()=>{
 const f=await fixture();assert.equal(f.state.paid,0);assert.equal((await one('SELECT count(*)::int n FROM course_gap_continuations WHERE audit_id=$1',[f.auditId])).n,0);
 assert.doesNotMatch(JSON.stringify(f.prepared.manifest),/Unverified|claim_token|https:|synthetic/);
 assert.deepEqual(f.prepared.manifest.selected_parts,[1,2,3,4,5,6]);
});
test('six first calls collect flagged evidence; held part/audit untouched, replay has zero calls/rows',async()=>{
 const f=await fixture(),before=await held(f),auditBefore=await one('SELECT * FROM course_caption_gap_audits WHERE id=$1',[f.auditId]);
 const r=await execute(f);assert.equal(r.stt_calls,6);assert.equal(f.state.paid,6);assert.equal(r.audit_status,'review_required');assert.equal(r.held_part_unchanged,true);
 assert.deepEqual(await held(f),before);assert.deepEqual(await one('SELECT * FROM course_caption_gap_audits WHERE id=$1',[f.auditId]),auditBefore);
 assert.equal(r.parts.filter(p=>p.alphabet_flag==='no_cyrillic').length,3);assert.equal(r.not_quality_approval,true);
 const again=await execute(f);assert.equal(again.stt_calls,0);assert.equal(again.cached,true);assert.equal(f.state.paid,6);
 assert.equal((await one('SELECT count(*)::int n FROM course_gap_evidence_annotations WHERE audit_id=$1',[f.auditId])).n,6);
 assert.equal((await one('SELECT count(*)::int n FROM course_transcription_jobs')).n,0);assert.equal((await one('SELECT count(*)::int n FROM course_transcripts')).n,0);
});
test('RPC rejects held part0/outside selection, concurrent claims and expired attempts; no reset',async()=>{
 const f=await fixture(),c=await authorize(f);await assert.rejects(claim(f,c,0),/selection_rejected/);await assert.rejects(claim(f,c,7),/selection_rejected/);
 assert.equal((await claim(f,c,1)).action,'transcribe');assert.equal((await claim(f,c,1)).action,'hold');assert.equal((await claim(f,c,2)).action,'hold');
 await db.query("UPDATE course_caption_gap_parts SET lease_until=now()-interval '1 minute' WHERE audit_id=$1 AND part_index=1",[f.auditId]);
 assert.equal((await claim(f,c,2)).action,'hold');assert.equal((await one('SELECT status FROM course_gap_continuations WHERE id=$1',[c.continuation_id])).status,'held');
 assert.equal((await one('SELECT attempts FROM course_caption_gap_parts WHERE audit_id=$1 AND part_index=1',[f.auditId])).attempts,1);assert.equal((await held(f)).attempts,1);
});
for(const result of ['',null,new Error('timeout')])test(`new uncertain ${String(result)} stops remaining calls and replay`,async()=>{
 const f=await fixture(),before=await held(f),call=async()=>{f.state.paid++;if(result instanceof Error)throw result;return result;};
 await assert.rejects(execute(f,call),/continuation_asr_uncertain/);assert.equal(f.state.paid,1);await assert.rejects(execute(f,call),/continuation_held/);assert.equal(f.state.paid,1);assert.deepEqual(await held(f),before);
 assert.equal((await one("SELECT count(*)::int n FROM course_caption_gap_parts WHERE audit_id=$1 AND part_index>1 AND status='pending' AND attempts=0",[f.auditId])).n,5);
});
test('changed approval, held evidence and provider revision block billing',async()=>{
 for(const kind of ['approval','held','provider']){
   const f=await fixture();if(kind==='approval')f.prepared.manifest.selected_parts=[0,1,2,3,4,5];
   if(kind==='held')await db.query('UPDATE course_caption_gap_parts SET asr_text=$2,text_sha256=$3 WHERE audit_id=$1 AND part_index=0',[f.auditId,'Changed evidence.',sha('Changed evidence.')]);
   if(kind==='provider')f.state.revision++;
   await assert.rejects(execute(f));assert.equal(f.state.paid,0);
 }
});
test('RPC binds immutable audit context and rejects part0 finish or revoked owner',async()=>{
 const f=await fixture(),c=await authorize(f);
 await assert.rejects(rpc('course_gap_continue_finish',{continuation:c.continuation_id,index:0,token:randomUUID(),text:'Unverified',error:null}),/selection_rejected/);
 await db.query('UPDATE course_caption_gap_audits SET manifest_sha256=$2 WHERE id=$1',[f.auditId,'f'.repeat(64)]);
 await assert.rejects(claim(f,c,1),/context_changed/);
 const other=await fixture(),otherC=await authorize(other);
 await db.query('UPDATE course_gap_continuations SET reviewed_by=$2 WHERE id=$1',[otherC.continuation_id,staff]);
 await assert.rejects(claim(other,otherC,1),/owner_required/);
});
test('new tables and RPC remain owner-read/service-write, never browser callable',async()=>{
 const f=await fixture();await authorize(f);
 for(const table of ['course_gap_continuations','course_gap_evidence_annotations']){
   await db.exec(`SET ROLE authenticated;SET request.jwt.claim.sub='${owner}'`);await db.query('SELECT * FROM '+table);
   await assert.rejects(db.exec('DELETE FROM '+table),/permission denied/);await db.exec(`SET request.jwt.claim.sub='${staff}'`);
   assert.equal((await one('SELECT count(*)::int n FROM '+table)).n,0);await db.exec('RESET ROLE;SET ROLE anon');await assert.rejects(db.exec('SELECT * FROM '+table),/permission denied/);await db.exec('RESET ROLE');
 }
 const routines=(await db.query("SELECT prosecdef,has_function_privilege('authenticated',oid,'execute') browser,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service FROM pg_proc WHERE proname LIKE 'course_gap_continue_%'")).rows;
 assert.equal(routines.length,3);for(const r of routines){assert.equal(r.prosecdef,false);assert.equal(r.browser,false);assert.equal(r.anon,false);assert.equal(r.service,true);}
});
