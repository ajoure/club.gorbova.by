import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleReviewedGaps} from './lib/reviewed-gap-assembly.mjs';
import {captionGaps} from './lib/gap-media.mjs';
import {sha} from './lib/course-stt.mjs';

const raw='WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nНачало занятия по бухгалтерии\n\n00:02:20.000 --> 00:05:00.000\nЗавершение занятия по бухгалтерии\n';
const duration=300000;
const source={...captionGaps(raw,duration),duration_ms:duration};
const parts=[
  {part_index:0,gap_index:0,start_ms:10000,end_ms:100000,attempts:1,status:'uncertain',audio_sha256:'a'.repeat(64),asr_text:'hello',text_sha256:sha('hello')},
  {part_index:1,gap_index:0,start_ms:100000,end_ms:140000,attempts:1,status:'evidence',audio_sha256:'b'.repeat(64),asr_text:'Продолжение',text_sha256:sha('Продолжение')},
];
const decisions=[
  {part_index:0,kind:'non_speech',text:null,evidence_sha256:parts[0].text_sha256,audio_sha256:parts[0].audio_sha256,reviewer_id:'owner',note:'Прослушано: речи нет'},
  {part_index:1,kind:'speech',text:'Ручная правка речи',evidence_sha256:parts[1].text_sha256,audio_sha256:parts[1].audio_sha256,reviewer_id:'owner',note:'Сверено с плеером'},
];
const input={raw_vtt:raw,duration_ms:duration,source,parts,decisions,reviewer_id:'owner'};

test('reviewed assembly keeps caption order, inserts only reviewed speech and retains private provenance',()=>{
  const result=assembleReviewedGaps(input);
  assert.equal(result.text,'Начало занятия по бухгалтерии\nРучная правка речи\nЗавершение занятия по бухгалтерии');
  assert.equal(result.metadata.reviewed_gap_parts,2);
  assert.equal(result.metadata.reviewed_speech_parts,1);
  assert.deepEqual(result.metadata.quality_flags,['long_gap']);
  assert.equal(result.metadata.subtitle_sha256,sha(raw));
  const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)
    ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
  assert.equal(result.metadata.review_decisions_sha256,sha(canonical(decisions)));
});

test('missing review, changed evidence and incomplete gap coverage fail closed',()=>{
  assert.throws(()=>assembleReviewedGaps({...input,decisions:decisions.slice(1)}),/review_input_invalid/);
  assert.throws(()=>assembleReviewedGaps({...input,parts:[{...parts[0],asr_text:'changed'},parts[1]]}),/review_part_invalid/);
  assert.throws(()=>assembleReviewedGaps({...input,parts:[parts[0],{...parts[1],start_ms:110000}]}),/review_gap_uncovered/);
  assert.throws(()=>assembleReviewedGaps({...input,decisions:[{...decisions[0],kind:'speech',text:'hello'},decisions[1]]}),/review_speech_invalid/);
});

test('historical leading gap accepts three reviewed parts only in historical scope',()=>{
  const historicalRaw='WEBVTT\n\n00:03:03.360 --> 01:00:00.000\nПродолжение конференции после отсутствующего начала.\n';
  const durationMs=3600000;
  const historicalSource={...captionGaps(historicalRaw,durationMs,{historicalLeadingGap:true}),
    duration_ms:durationMs,source_scope:'historical_live_event'};
  const boundaries=[[0,90000],[90000,180000],[180000,183360]];
  const evidence=boundaries.map(([start_ms,end_ms],part_index)=>({part_index,gap_index:0,
    start_ms,end_ms,attempts:1,status:'evidence',audio_sha256:String(part_index+1).repeat(64),
    asr_text:'Начало конференции',text_sha256:sha('Начало конференции')}));
  const review=evidence.map(p=>({part_index:p.part_index,kind:'speech',text:'Проверенная речь в начале',
    evidence_sha256:p.text_sha256,audio_sha256:p.audio_sha256,reviewer_id:'owner',
    note:'Сверено с исходным аудио'}));
  assert.throws(()=>captionGaps(historicalRaw,durationMs),/other_caption_quality_flags/);
  const result=assembleReviewedGaps({raw_vtt:historicalRaw,duration_ms:durationMs,
    source:historicalSource,parts:evidence,decisions:review,reviewer_id:'owner'});
  assert.equal(result.metadata.reviewed_gap_parts,3);
  assert.equal(result.metadata.reviewed_speech_parts,3);
  assert.match(result.text,/Проверенная речь в начале/);
  assert.throws(()=>assembleReviewedGaps({raw_vtt:historicalRaw,duration_ms:durationMs,
    source:{...historicalSource,source_scope:'course'},parts:evidence,decisions:review,reviewer_id:'owner'}),
  /other_caption_quality_flags/);
});
