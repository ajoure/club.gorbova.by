import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSubtitles,providerRevision } from './lib/subtitles.mjs';
const russian='Сегодня разбираем вопросы обучения и программу курса.';
test('VTT keeps actual text and timing metrics separate from editorial approval',()=>{
  const r=inspectSubtitles(`WEBVTT\n\n00:00.000 --> 00:45.000\n<v Катерина>${russian}</v>\n\n00:45.000 --> 01:30.000\nВторая часть &amp; продолжение.`,90000);
  assert.equal(r.metadata.cue_count,2);assert.equal(r.metadata.covered_ms,90000);
  assert.equal(r.quality_status,'unreviewed');assert.deepEqual(r.quality_flags,[]);
  assert.equal(r.text,`${russian}\nВторая часть & продолжение.`);
});
test('SRT and UTF8 BOM/CRLF accepted; styling and cue numbers not included',()=>{
  const r=inspectSubtitles(`\uFEFF1\r\n00:00:00,000 --> 00:00:30,000\r\n<b>${russian}</b>\r\n`,30000);
  assert.equal(r.text,russian);
});
test('overlapping cues use interval union and preserve repeated spoken text',()=>{
  const r=inspectSubtitles(`WEBVTT\n\n00:00.000 --> 00:20.000\n${russian}\n\n00:10.000 --> 00:30.000\n${russian}`,30000);
  assert.equal(r.metadata.covered_ms,30000);assert.equal(r.text,`${russian}\n${russian}`);
});
test('missing tail, long gaps, non-Russian text need review',()=>{
  const r=inspectSubtitles('WEBVTT\n\n00:00.000 --> 00:02.000\nHello world',300000);
  assert.ok(r.quality_flags.includes('early_end'));assert.ok(r.quality_flags.includes('language_review'));assert.ok(r.quality_flags.includes('long_gap'));
});
test('fail closed on HTML errors, unknown blocks, invalid/reversed/beyond-source cues',()=>{
  for(const text of ['<html>Denied</html>','WEBVTT\n\nforgotten text','WEBVTT\n\n00:65.000 --> 00:70.000\nx','WEBVTT\n\n00:03.000 --> 00:01.000\nx','WEBVTT\n\n00:00.000 --> 00:50.000\nx']){
    assert.throws(()=>inspectSubtitles(text,10000));
  }
});
test('revision requires actual provider metadata and changes with video updates',()=>{
  const v={id:'11111111-1111-4111-8111-111111111111',version:1,updated_at:'2024-01-01',duration:60};
  assert.equal(providerRevision(v),providerRevision({...v,poster:'ignored'}));
  assert.notEqual(providerRevision(v),providerRevision({...v,version:2}));
  assert.throws(()=>providerRevision({...v,updated_at:null}));
});
