import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {sha} from './lib/course-stt.mjs';
import {captionGaps} from './lib/gap-media.mjs';
import {normalizeReviewedCaption} from './lib/reviewed-captions.mjs';
import {inspectGapSource} from './lib/gap-audit.mjs';
import {COURSE_PRODUCT_IDS} from './lib/course-provider-import.mjs';
import {prepareEvidenceGapPublication,publishEvidenceGap} from './lib/evidence-gap-publication.mjs';
import {assembleReviewedGaps} from './lib/reviewed-gap-assembly.mjs';
const actor='00000000-0000-4000-8000-000000000001',sourceId='11111111-1111-4111-8111-111111111111',auditId='22222222-2222-4222-8222-222222222222',videoId='44444444-4444-4444-8444-444444444444';
const raw='WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nНачало занятия по бухгалтерии\n\n00:02:20.000 --> 00:05:00.000\nЗавершение занятия по бухгалтерии\n';
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
let db;
before(async()=>{
 db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${actor}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION public.has_role_v2(_user_id uuid,_role_code text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT _user_id='${actor}'::uuid AND _role_code='super_admin'$$;
 GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
 CREATE TABLE training_lessons(id uuid PRIMARY KEY);CREATE TABLE lesson_blocks(id uuid PRIMARY KEY);CREATE TABLE products_v2(id uuid PRIMARY KEY);`);
 for(const name of ['20260911172902_90aeec8b-4b8d-4ff2-b180-19e2d6ad992a.sql','20260911184123_9c93b1c8-09c9-4f6a-9f80-d1490ed4f009.sql',
 '20260911200704_62084073-0485-4613-8b9f-38c2cdf67e1b.sql','20260911202441_course_gap_continuation.sql','20260925130513_8838204f-2a91-406e-90c5-d7a510a87ca9.sql'])
 await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`INSERT INTO training_lessons VALUES('77777777-7777-4777-8777-777777777777');INSERT INTO lesson_blocks VALUES('55555555-5555-4555-8555-555555555555');INSERT INTO products_v2 VALUES('${COURSE_PRODUCT_IDS[1]}');`);
 await db.exec("ALTER TABLE course_transcription_sources ADD COLUMN source_scope text NOT NULL DEFAULT 'course'");
 await db.exec(await readFile(new URL('../../supabase/migrations/20260925215112_cb21_evidence_gap_publication.sql',import.meta.url),'utf8'));
});
after(async()=>db?.close());beforeEach(async()=>db.exec('TRUNCATE course_transcription_sources CASCADE'));
async function rpc(args,role='service_role'){
 await db.exec('SET ROLE '+role);try{return (await db.query('SELECT course_gap_publish_evidence($1,$2,$3,$4,$5,$6,$7) AS result',args)).rows[0].result;}
 finally{await db.exec('RESET ROLE');}
}
const blockId='55555555-5555-4555-8555-555555555555';
const selection={block_ids:[blockId],allow_closed:true,allow_cue_order_review:false};
const readIo={
 async rows(table){return ({training_modules:[{id:'m',product_id:COURSE_PRODUCT_IDS[1],is_active:false}],
 training_lessons:[{id:'77777777-7777-4777-8777-777777777777',module_id:'m',product_id:COURSE_PRODUCT_IDS[1],is_active:true}],
 lesson_blocks:[{id:blockId,lesson_id:'77777777-7777-4777-8777-777777777777',block_type:'video',content:{url:'https://kinescope.io/testAlias'},updated_at:'2026-01-01T00:00:00Z'}],
 integration_instances:[{config:{api_token:'synthetic'}}]})[table]??(await db.query('SELECT * FROM '+table)).rows;},
 async rpc(name,args){if(name==='has_role_v2')return args._user_id===actor;
 if(name==='course_gap_publish_evidence')return rpc([args._audit_id,args._actor,args._manifest_sha256,args._decisions,args._transcript_text,args._metadata,args._capture_manifest]);
 throw Error('unexpected_rpc');},
 async provider(){return {data:{id:videoId,duration:300,version:1,updated_at:'2026-01-01T00:00:00Z',audio_tracks:[{id:'66666666-6666-4666-8666-666666666666',file_size:10000,download_link:'https://kinescope.io/audio'}]}};}
};
const publicIo={page:async()=>`playerOptions = ${JSON.stringify({playlist:[{id:videoId,meta:{duration:300},vtt:[{srcLang:'ru',src:'https://kinescope.io/ru.vtt'}],sources:{hls:{src:'https://kinescope.io/master.m3u8'}}}]})};`,caption:async()=>raw};
async function fixture(){
 const source=(await inspectGapSource(readIo,publicIo,actor,'testAlias',selection)).identity;
 const bounds=[10000,100000,140000],parts=[0,1].map(i=>({part_index:i,gap_index:0,start_ms:bounds[i],end_ms:bounds[i+1],audio_sha256:String(i+1).repeat(64),asr_text:'Проверенная речь '+i,status:'evidence',attempts:1}));
 parts.forEach(p=>p.text_sha256=sha(p.asr_text));
 const capture={schema_version:1,mode:'caption_gap_dry_run',source,parts:parts.map(({part_index,gap_index,start_ms,end_ms,audio_sha256})=>({part_index,gap_index,start_ms,end_ms,audio_sha256}))};
 const captureText=canonical(capture);
 await db.query("INSERT INTO course_transcription_sources(id,provider,video_id,source_revision,duration_ms,enabled,created_by) VALUES($1,'kinescope',$2,$3,300000,true,$4)",[sourceId,videoId,source.source_revision,actor]);
 await db.query("INSERT INTO course_caption_gap_audits(id,source_id,requested_by,source_revision,caption_sha256,raw_vtt,manifest_sha256,expected_parts,status) VALUES($1,$2,$3,$4,$5,$6,$7,2,'evidence')",[auditId,sourceId,actor,source.source_revision,sha(raw),raw,sha(captureText)]);
 await db.query('INSERT INTO course_transcription_bindings(source_id,lesson_id,block_id,product_id,block_updated_at) VALUES($1,$2,$3,$4,$5)',[sourceId,source.bindings[0].lesson_id,blockId,source.bindings[0].product_id,source.bindings[0].block_updated_at]);
 for(const p of parts)await db.query("INSERT INTO course_caption_gap_parts(audit_id,part_index,gap_index,start_ms,end_ms,audio_sha256,status,attempts,asr_text,text_sha256) VALUES($1,$2,0,$3,$4,$5,'evidence',1,$6,$7)",[auditId,p.part_index,p.start_ms,p.end_ms,p.audio_sha256,p.asr_text,p.text_sha256]);
 const decisions=parts.map(p=>({part_index:p.part_index,kind:'speech',text:p.asr_text,evidence_sha256:p.text_sha256,audio_sha256:p.audio_sha256,reviewer_id:actor,note:'Речь проверена по записи'}));
 const assembled=assembleReviewedGaps({raw_vtt:raw,duration_ms:300000,source,parts,decisions,reviewer_id:actor});
 return {capture,parts,source,decisions,args:[auditId,actor,'c'.repeat(64),decisions,assembled.text,assembled.metadata,captureText]};
}
test('two evidence parts publish privately once; replay validates exact metadata and provenance',async()=>{
 const f=await fixture();assert.equal((await rpc(f.args)).reused,false);assert.equal((await rpc(f.args)).reused,true);
 const t=(await db.query('SELECT * FROM course_transcripts')).rows[0];assert.equal(t.classification,'paid_private');assert.equal(t.quality_status,'unreviewed');assert.equal(t.caption_provenance.capture_manifest_sha256,sha(f.args[6]));
 const changed=structuredClone(f.args);changed[5].extra='changed';await assert.rejects(rpc(changed),/review_publication_conflict/);
});
for(const role of ['anon','authenticated'])test('browser cannot publish: '+role,async()=>{const f=await fixture();await assert.rejects(rpc(f.args,role),/permission denied/);});
test('capture hash prevents substituted normalization or selection',async()=>{
 const f=await fixture();f.capture.source.caption_provenance.normalized_sha256='a'.repeat(64);f.args[6]=canonical(f.capture);
 await assert.rejects(rpc(f.args),/evidence_capture_manifest_changed/);
});
test('even a hash-bound no-transform provenance cannot claim a changed normalized hash',async()=>{
 const f=await fixture();f.capture.source.caption_provenance.normalized_sha256='a'.repeat(64);f.args[6]=canonical(f.capture);
 await db.query('UPDATE course_caption_gap_audits SET manifest_sha256=$1',[sha(f.args[6])]);await assert.rejects(rpc(f.args),/evidence_normalization_invalid/);
});
for(const mutation of ["UPDATE course_caption_gap_audits SET status='review_required'","UPDATE course_caption_gap_parts SET status='pending' WHERE part_index=0",'DELETE FROM course_caption_gap_parts WHERE part_index=1'])test('incomplete or held evidence is rejected: '+mutation,async()=>{
 const f=await fixture();await db.exec(mutation);await assert.rejects(rpc(f.args),/review_audit_changed|review_decision_invalid|review_evidence_incomplete/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM course_transcripts')).rows[0].n,0);
});

test('managed preparation and publication bind fresh source, capture and review with readback/replay',async()=>{
 const f=await fixture(),review={schema_version:1,mode:'reviewed_gap_assembly',audit_id:auditId,reviewer_id:actor,decisions:f.decisions};
 const prepared=await prepareEvidenceGapPublication(readIo,publicIo,actor,f.capture,review,'a'.repeat(64));
 assert.equal(prepared.alreadyPublished,false);assert.equal(prepared.manifest.stt_calls,0);
 const result=await publishEvidenceGap(readIo,actor,prepared.manifest,prepared,review,'c'.repeat(64));assert.equal(result.published,true);
 const again=await prepareEvidenceGapPublication(readIo,publicIo,actor,f.capture,review,'a'.repeat(64));assert.equal(again.alreadyPublished,true);
 const changed={...publicIo,caption:async()=>raw.replace('Начало','Другое начало')};
 await assert.rejects(prepareEvidenceGapPublication(readIo,changed,actor,f.capture,review,'a'.repeat(64)),/review_source_changed/);
});
test('assembly repeats bounded sorting while preserving raw hash and rejects changed provenance',async()=>{
 const f=await fixture();
 const unordered='WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nНачало занятия\n\n00:02:25.000 --> 00:02:26.000\nПоздняя реплика\n\n00:02:20.000 --> 00:02:21.000\nРанняя реплика\n\n00:02:26.000 --> 00:05:00.000\nЗавершение занятия по бухгалтерии\n';
 const normalized=normalizeReviewedCaption(unordered,300000,{allowCueOrderReview:true});
 const source={...captionGaps(normalized.normalized,300000),duration_ms:300000,caption_sha256:sha(unordered),
  reviewed_selection:{allow_cue_order_review:true},caption_provenance:{...normalized.reviewed.provenance,revision_basis:'provider_api'}};
 const args={raw_vtt:unordered,duration_ms:300000,source,parts:f.parts,decisions:f.decisions,reviewer_id:actor};
 const result=assembleReviewedGaps(args);assert.ok(result.text.indexOf('Ранняя')<result.text.indexOf('Поздняя'));
 assert.equal(result.metadata.subtitle_sha256,sha(unordered));assert.equal(result.metadata.normalized_caption_sha256,sha(normalized.normalized));
 source.caption_provenance.normalized_sha256='b'.repeat(64);assert.throws(()=>assembleReviewedGaps(args),/review_normalization_changed/);
});

test('changed stored source bindings are rejected before publication',async()=>{
 const f=await fixture();await db.exec('DELETE FROM course_transcription_bindings');await assert.rejects(rpc(f.args),/review_binding_changed/);
});
test('continuation audits cannot enter the complete-evidence publication path',async()=>{
 const f=await fixture();await db.query("INSERT INTO course_gap_continuations(audit_id,reviewed_by,approval_sha256,held_part_snapshot,audit_context) VALUES($1,$2,$3,'{}','{}')",[auditId,actor,'d'.repeat(64)]);
 await assert.rejects(rpc(f.args),/evidence_has_continuation/);
});
