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
  assert.equal(result.metadata.subtitle_sha256,sha(raw));
  assert.equal(result.metadata.review_decisions_sha256,sha(JSON.stringify(decisions)));
});

test('missing review, changed evidence and incomplete gap coverage fail closed',()=>{
  assert.throws(()=>assembleReviewedGaps({...input,decisions:decisions.slice(1)}),/review_input_invalid/);
  assert.throws(()=>assembleReviewedGaps({...input,parts:[{...parts[0],asr_text:'changed'},parts[1]]}),/review_part_invalid/);
  assert.throws(()=>assembleReviewedGaps({...input,parts:[parts[0],{...parts[1],start_ms:110000}]}),/review_gap_uncovered/);
  assert.throws(()=>assembleReviewedGaps({...input,decisions:[{...decisions[0],kind:'speech',text:'hello'},decisions[1]]}),/review_speech_invalid/);
});
