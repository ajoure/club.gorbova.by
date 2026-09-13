import test from 'node:test';
import assert from 'node:assert/strict';
import { planTranscriptions } from './plan-transcriptions.mjs';

const source = () => ({ source_id: 'video-a', source_revision: 'revision-1', audio_status: 'ready', duration_ms: 90000 });
const lesson = (id = 'lesson-a') => ({ id, product_ids: ['product-a'], mapping_verified: true,
  media_inventory_complete: true, videos: [source()] });
const snapshot = (lessons = [lesson()]) => ({ schema_version: 1, complete: true,
  captured_at: '2026-09-11T12:00:00Z', expected_lesson_count: lessons.length,
  selected_product_ids: ['product-a'], lessons });

test('one source reused in multiple lessons incurs one transcription', () => {
  const result = planTranscriptions(snapshot([lesson(), lesson('lesson-b')]));
  assert.equal(result.counts.transcribe, 1);
  assert.equal(result.counts.new_audio_ms, 90000);
  assert.deepEqual(result.jobs[0].lesson_ids, ['lesson-a', 'lesson-b']);
  assert.equal(result.execution_authorized, false);
});
test('ready text is reused only for a matching source with verified complete coverage', () => {
  const data = snapshot();
  data.lessons[0].videos[0].transcript = { status: 'ready', has_text: true,
    source_revision: 'revision-1', coverage_verified: true };
  assert.equal(planTranscriptions(data).counts.reuse, 1);
  for (const change of [{ source_revision: 'old' }, { coverage_verified: false },
    { has_text: false }, { status: 'truncated' }]) {
    const copy = structuredClone(data);
    Object.assign(copy.lessons[0].videos[0].transcript, change);
    assert.equal(planTranscriptions(copy).counts.transcribe, 1);
  }
});
test('incomplete pagination and count mismatches block the entire run', () => {
  for (const change of [{ complete: false }, { expected_lesson_count: 2 }]) {
    const result = planTranscriptions({ ...snapshot(), ...change });
    assert.equal(result.status, 'blocked');
    assert.ok(result.jobs.every((job) => !job.eligible_after_review));
  }
});
test('unknown or unrelated product mapping cannot silently drop a lesson', () => {
  for (const change of [{ mapping_verified: false }, { product_ids: ['other-product'] }]) {
    const data = snapshot(); Object.assign(data.lessons[0], change);
    assert.equal(planTranscriptions(data).status, 'blocked');
  }
});
test('a conflicting revision of a shared video blocks all jobs', () => {
  const data = snapshot([lesson(), lesson('lesson-b')]);
  data.lessons[1].videos[0].source_revision = 'revision-2';
  const result = planTranscriptions(data);
  assert.ok(result.issues.some((issue) => issue.code === 'conflicting_source_metadata'));
  assert.ok(result.jobs.every((job) => !job.eligible_after_review));
});
test('no audio or unknown duration cannot become a runnable paid transcription', () => {
  for (const change of [{ audio_status: 'unknown' }, { duration_ms: null }, { duration_ms: -1 }]) {
    const data = snapshot(); Object.assign(data.lessons[0].videos[0], change);
    assert.equal(planTranscriptions(data).jobs[0].action, 'blocked');
  }
});
test('nested media completeness and non-video lessons must be explicitly verified', () => {
  const data = snapshot(); data.lessons[0].videos = [];
  assert.equal(planTranscriptions(data).status, 'blocked');
  data.lessons[0].non_video_content_verified = true;
  assert.equal(planTranscriptions(data).status, 'ready_for_review');
  data.lessons[0].media_inventory_complete = false;
  assert.equal(planTranscriptions(data).status, 'blocked');
});
test('output omits raw paid content, personal data, signed URLs and arbitrary fields', () => {
  const data = snapshot();
  data.lessons[0].title = 'PRIVATE_LESSON_TITLE';
  data.lessons[0].customer = 'PRIVATE_CUSTOMER';
  Object.assign(data.lessons[0].videos[0], { download_url: 'https://example.invalid/?secret=PRIVATE_TOKEN',
    transcript: { text: 'PRIVATE_PAID_LESSON' } });
  const serialized = JSON.stringify(planTranscriptions(data));
  assert.doesNotMatch(serialized, /PRIVATE_|download_url|"text"/);
});
test('duplicate lesson rows and URL-shaped identifiers are rejected', () => {
  assert.equal(planTranscriptions(snapshot([lesson(), lesson()])).status, 'blocked');
  const data = snapshot(); data.lessons[0].videos[0].source_id = 'https://example.invalid/?secret=x';
  assert.equal(planTranscriptions(data).status, 'blocked');
  assert.doesNotMatch(JSON.stringify(planTranscriptions(data)), /secret=x/);
});
test('an empty course inventory is not mistaken for full coverage', () => {
  assert.equal(planTranscriptions(snapshot([])).status, 'blocked');
});
