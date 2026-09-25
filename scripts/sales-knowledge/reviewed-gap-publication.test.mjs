import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {sha} from './lib/course-stt.mjs';
import {captionGaps} from './lib/gap-media.mjs';
import {assembleReviewedGaps} from './lib/reviewed-gap-assembly.mjs';

const actor='00000000-0000-4000-8000-000000000001';
const sourceId='11111111-1111-4111-8111-111111111111';
const auditId='22222222-2222-4222-8222-222222222222';
const continuationId='33333333-3333-4333-8333-333333333333';
const videoId='44444444-4444-4444-8444-444444444444';
const raw='WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nНачало занятия по бухгалтерии\n\n00:02:20.000 --> 00:05:00.000\nЗавершение занятия по бухгалтерии\n';
const duration=300000, revision='f'.repeat(64);
const gap=captionGaps(raw,duration);
let db;
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${actor}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.has_role_v2(_user_id uuid,_role_code text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT _user_id='${actor}'::uuid AND _role_code='super_admin' $$;
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
    CREATE TABLE public.training_lessons(id uuid PRIMARY KEY);
    CREATE TABLE public.lesson_blocks(id uuid PRIMARY KEY);
    CREATE TABLE public.products_v2(id uuid PRIMARY KEY);`);
  for(const f of ['20260911172902_90aeec8b-4b8d-4ff2-b180-19e2d6ad992a.sql',
    '20260911184123_9c93b1c8-09c9-4f6a-9f80-d1490ed4f009.sql',
    '20260911200704_62084073-0485-4613-8b9f-38c2cdf67e1b.sql',
    '20260911202441_course_gap_continuation.sql',
    '20260925123647_course_gap_reviewed_assembly.sql'])
    await db.exec(await readFile(new URL('../../supabase/migrations/'+f,import.meta.url),'utf8'));
});
after(async()=>await db?.close());
const one=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
const rpc=async(args)=>{await db.exec('SET ROLE service_role');try{
  return (await one('SELECT public.course_gap_publish_reviewed($1,$2,$3,$4,$5,$6) AS result',args)).result;
}finally{await db.exec('RESET ROLE');}};

async function fixture(){
  await db.query('INSERT INTO course_transcription_sources(id,provider,video_id,source_revision,duration_ms,enabled,created_by) VALUES($1,\'kinescope\',$2,$3,$4,true,$5)',
    [sourceId,videoId,revision,duration,actor]);
  await db.query(`INSERT INTO course_caption_gap_audits(id,source_id,requested_by,source_revision,caption_sha256,raw_vtt,manifest_sha256,expected_parts,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,7,'review_required')`,[auditId,sourceId,actor,revision,sha(raw),raw,'e'.repeat(64)]);
  const bounds=[10000,30000,50000,70000,90000,110000,130000,140000],parts=[];
  for(let i=0;i<7;i++){
    const asr=i===0?'Unverified English response.':`Проверенная речь ${i}`;
    const p={part_index:i,gap_index:0,start_ms:bounds[i],end_ms:bounds[i+1],
      audio_sha256:String(i+1).repeat(64),asr_text:asr,text_sha256:sha(asr),
      status:i===0?'uncertain':'evidence',attempts:1};
    await db.query(`INSERT INTO course_caption_gap_parts(audit_id,part_index,gap_index,start_ms,end_ms,audio_sha256,status,attempts,asr_text,text_sha256,error_code)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10)`,[auditId,i,0,p.start_ms,p.end_ms,p.audio_sha256,p.status,asr,p.text_sha256,i===0?'asr_outcome_uncertain':null]);
    parts.push(p);
  }
  await db.query(`INSERT INTO course_gap_continuations(id,audit_id,reviewed_by,approval_sha256,held_part_snapshot,audit_context,status)
    SELECT $1,$2,$3,$4,to_jsonb(p),(to_jsonb(a)-'raw_vtt'-'created_at'),'collected'
    FROM course_caption_gap_audits a JOIN course_caption_gap_parts p ON p.audit_id=a.id AND p.part_index=0 WHERE a.id=$2`,
  [continuationId,auditId,actor,'d'.repeat(64)]);
  for(let i=1;i<7;i++)await db.query(`INSERT INTO course_gap_evidence_annotations(audit_id,part_index,continuation_id,text_sha256,alphabet_flag)
    VALUES($1,$2,$3,$4,'cyrillic_present')`,[auditId,i,continuationId,parts[i].text_sha256]);
  const decisions=parts.map((p,i)=>({part_index:i,kind:i===0?'non_speech':'speech',
    text:i===0?null:p.asr_text,evidence_sha256:p.text_sha256,audio_sha256:p.audio_sha256,
    reviewer_id:actor,note:i===0?'Прослушано: речи нет':'Сверено с плеером урока'}));
  const assembled=assembleReviewedGaps({raw_vtt:raw,duration_ms:duration,
    source:{...gap,duration_ms:duration},parts,decisions,reviewer_id:actor});
  return {parts,decisions,assembled,args:[auditId,actor,'c'.repeat(64),decisions,assembled.text,assembled.metadata]};
}

test('service-only review publishes one private unreviewed transcript and replays without mutation',async()=>{
  const f=await fixture();
  await assert.rejects(rpc([...f.args.slice(0,3),
    [{...f.decisions[0],kind:'speech',text:'English only'},...f.decisions.slice(1)],...f.args.slice(4)]),
  /review_decision_invalid/);
  assert.equal((await one('SELECT count(*)::int n FROM course_transcripts')).n,0);
  const first=await rpc(f.args),again=await rpc(f.args);
  assert.equal(first.reused,false);assert.equal(again.reused,true);
  const row=await one('SELECT * FROM course_transcripts WHERE source_id=$1',[sourceId]);
  assert.equal(row.transcript_text,f.assembled.text);
  assert.equal(row.classification,'paid_private');assert.equal(row.quality_status,'unreviewed');
  assert.equal((await one('SELECT count(*)::int n FROM course_transcripts')).n,1);
  assert.equal((await one('SELECT count(*)::int n FROM course_gap_reviews')).n,1);
  await assert.rejects(rpc([...f.args.slice(0,3),[{...f.decisions[0],note:'Подмена решения'},...f.decisions.slice(1)],...f.args.slice(4)]),/review_publication_conflict/);
});

test('browser roles cannot publish or read private review rows',async()=>{
  await db.exec(`SET ROLE authenticated;SET request.jwt.claim.sub='${actor}'`);
  assert.equal((await one('SELECT count(*)::int n FROM course_gap_reviews')).n,1);
  await assert.rejects(db.query('SELECT public.course_gap_publish_reviewed($1,$2,$3,$4,$5,$6)',
    [auditId,actor,'c'.repeat(64),[],raw,{}]),/permission denied/);
  await assert.rejects(db.exec('DELETE FROM course_gap_reviews'),/permission denied/);
  await db.exec('RESET ROLE;SET ROLE anon');
  await assert.rejects(db.exec('SELECT * FROM course_gap_reviews'),/permission denied/);
  await db.exec('RESET ROLE');
});
