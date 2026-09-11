import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInventory, kinescopeReference } from './lib/inventory.mjs';
import { assembleTranscript, audioWindows, digest, planBatch } from './lib/transcript.mjs';
import { compileSalesKnowledge, factReviewDigest, testimonialReviewDigest, retrieveSalesFacts } from './lib/knowledge.mjs';
import { planTranscriptions } from './plan-transcriptions.mjs';

const NOW = '2026-09-11T12:00:00Z';
function exported() {
  return { schema_version: 1, captured_at: NOW, complete: true, selected_product_ids: ['course'],
    expected_counts: { lessons: 1, modules: 2, blocks: 2 },
    modules: [{ id: 'child', parent_module_id: 'root', product_id: null }, { id: 'root', product_id: 'course' }],
    lessons: [{ id: 'lesson', module_id: 'child', video_url: 'https://kinescope.io/short123' }],
    bindings: [{ id: 'lesson', product_ids: ['course'], verified: true, basis: 'module_ancestry' }],
    blocks: [{ id: 'container', lesson_id: 'lesson', block_type: 'tabs', content: {} },
      { id: 'block-video', parent_id: 'container', lesson_id: 'lesson', block_type: 'video', content: { url: 'https://kinescope.io/embed/short123?signature=secret' } }],
    video_catalog: [{ source_id: 'uuid-video', aliases: ['short123'], source_revision: 'track-v1', audio_status: 'ready', duration_ms: 180001 }],
  };
}
test('a UUID Kinescope reference is not truncated at its first hyphen', () => {
  const uuid = '12345678-aaaa-bbbb-cccc-123456789012';
  assert.equal(kinescopeReference(`https://kinescope.io/embed/${uuid}?t=22#chapter`), uuid);
  assert.equal(kinescopeReference('kinescope.io/short123'), 'short123');
});
for (const bad of ['https://kinescope.io.evil.invalid/short123', 'https://kinescope.io@evil.invalid/short123',
  'https://user:secret@kinescope.io/short123', 'http://kinescope.io/short123', 'https://kinescope.io/short123/extra',
  'https://kinescope.io:444/short123', 'javascript:alert(1)']) {
  test(`reject unsupported provider reference: ${bad.replace(/secret/g, 'x')}`, () => assert.equal(kinescopeReference(bad), null));
}
test('nested videos and inherited modules produce one metadata-only source', () => {
  const inventory = buildInventory(exported());
  const plan = planTranscriptions(inventory);
  assert.equal(plan.status, 'ready_for_review');
  assert.equal(plan.counts.unique_sources, 1);
  assert.equal(inventory.lessons[0].mapping_verified, true);
  assert.doesNotMatch(JSON.stringify(inventory), /signature|secret|https:/);
});
test('legacy video inside HTML tabs is inventoried', () => {
  const data = exported(); data.lessons[0].video_url = null;
  data.blocks[1].block_type = 'tabs';
  data.blocks[1].content = { tabs: [{ content: '<iframe src="https://kinescope.io/embed/short123"></iframe>' }] };
  assert.equal(buildInventory(data).lessons[0].videos.length, 1);
});
for (const [name, change] of [
  ['module cycle', (d) => { d.modules[1].parent_module_id = 'child'; }],
  ['missing module', (d) => { d.lessons[0].module_id = 'absent'; }],
  ['missing parent block', (d) => { d.blocks[1].parent_id = 'absent'; }],
  ['block cycle', (d) => { d.blocks[0].parent_id = 'block-video'; }],
  ['missing provider metadata', (d) => { d.video_catalog = []; }],
  ['title-only product guess', (d) => { d.bindings[0].verified = false; }],
  ['incomplete block pagination', (d) => { d.expected_counts.blocks = 20; }],
  ['unsupported embedded media', (d) => { d.blocks[1].content.url = 'https://video.invalid/123'; }],
  ['empty video', (d) => { d.blocks[1].content = {}; }],
]) {
  test(`${name} blocks batch preparation`, () => {
    const data = exported(); change(data);
    assert.equal(planTranscriptions(buildInventory(data)).status, 'blocked');
  });
}
test('ambiguous short aliases cannot assign the wrong video', () => {
  const data = exported(); data.video_catalog.push({ ...data.video_catalog[0], source_id: 'another-video' });
  assert.throws(() => buildInventory(data), /ambiguous_video_alias/);
});

function audio() {
  return { source_id: 'video', source_revision: 'track-v1', duration_ms: 180001,
    parts: audioWindows(180001).map((window) => ({ ...window, source_revision: 'track-v1', status: 'ready', text: `Закрытый текст части ${window.part_index}` })) };
}
test('last one-millisecond tail is required and full transcript stays private', () => {
  const source = audio(), result = assembleTranscript(source);
  assert.equal(result.classification, 'paid_private');
  assert.equal(result.segments.at(-1).end_ms, 180001);
  assert.equal(result.content_sha256, digest(result.text));
  source.parts.pop(); assert.throws(() => assembleTranscript(source), /incomplete/);
});
for (const [name, change] of [
  ['gap', (d) => { d.parts[1].start_ms++; }],
  ['overlap', (d) => { d.parts[1].start_ms--; }],
  ['duplicate part', (d) => { d.parts[1] = d.parts[0]; }],
  ['old audio revision', (d) => { d.parts[1].source_revision = 'old'; }],
  ['failed part', (d) => { d.parts[1].status = 'failed'; }],
  ['empty unverified segment', (d) => { d.parts[1].text = ' '; }],
]) test(`${name} prevents a false complete transcript`, () => {
  const data = audio(); change(data); assert.throws(() => assembleTranscript(data));
});
test('verified silence is permitted but an entirely empty transcription is rejected', () => {
  const data = audio(); data.parts[1].text = ''; data.parts[1].silence_verified = true;
  assert.equal(assembleTranscript(data).coverage_verified, true);
  data.parts.forEach((part) => { part.text = ''; part.silence_verified = true; });
  assert.throws(() => assembleTranscript(data), /empty/);
});
test('batch limits and uncertain previous attempts prevent blind repeated STT', () => {
  const plan = planTranscriptions(buildInventory(exported()));
  const first = planBatch(plan, []);
  assert.equal(first.jobs.length, 1);
  assert.equal(first.execution_authorized, false);
  for (const status of ['running', 'failed', 'unknown', 'complete']) {
    assert.equal(planBatch(plan, [{ key: first.jobs[0].key, status }]).jobs.length, 0);
  }
  assert.equal(planBatch(plan, [], { max_jobs: 1, max_audio_ms: 1 }).jobs.length, 0);
});

function corpus() {
  const source = { id: 'source', revision: 'v1', is_current: true, product_ids: ['course'], lesson_ids: ['lesson'], sha256: digest('PRIVATE_RAW_LESSON'), text: 'PRIVATE_RAW_LESSON' };
  const fact = { id: 'fact', product_id: 'course', lesson_id: 'lesson', kind: 'topic', text: 'В уроке рассматриваются вопросы учёта перевозок.',
    keywords: ['перевозки'], tariff_ids: [], source_id: source.id, source_revision: 'v1', source_sha256: source.sha256,
    valid_from: '2026-09-01T00:00:00Z', raw_transcript: 'PRIVATE_RAW_LESSON', internal_notes: 'PRIVATE_NOTE' };
  fact.approval = { status: 'approved', approved_by: 'editor', approved_at: NOW, content_sha256: factReviewDigest(fact) };
  return { sources: [source], facts: [fact] };
}
test('published packet cannot contain paid text or arbitrary source fields', () => {
  const packet = compileSalesKnowledge(corpus(), NOW);
  assert.equal(packet.facts.length, 1);
  assert.doesNotMatch(JSON.stringify(packet), /PRIVATE_|raw_transcript|internal_notes|approved_by/);
});
for (const [name, change] of [
  ['edited approved text', (d) => { d.facts[0].text += ' Новый неподтверждённый результат'; }],
  ['changed product', (d) => { d.facts[0].product_id = 'other'; }],
  ['expired source revision', (d) => { d.sources[0].revision = 'v2'; }],
  ['withdrawn source', (d) => { d.sources[0].is_current = false; }],
  ['source belongs to another course', (d) => { d.sources[0].product_ids = ['other']; }],
  ['source belongs to another lesson', (d) => { d.sources[0].lesson_ids = ['other']; }],
  ['unapproved fact', (d) => { d.facts[0].approval.status = 'draft'; }],
  ['future approval', (d) => { d.facts[0].approval.approved_at = '2027-01-01'; }],
  ['changed source text', (d) => { d.sources[0].text = 'Другой исходник'; }],
  ['instruction kind', (d) => { d.facts[0].kind = 'worked_solution'; }],
  ['signed link', (d) => { d.facts[0].text = 'https://private.invalid/?secret=1'; }],
  ['expired fact', (d) => { d.facts[0].valid_until = '2020-01-01'; }],
]) test(`${name} is not published to the sales knowledge`, () => {
  const data = corpus(); change(data); assert.equal(compileSalesKnowledge(data, NOW).facts.length, 0);
});
test('duplicate fact ID removes the conflicting original too', () => {
  const data = corpus(); data.facts.push(structuredClone(data.facts[0]));
  assert.equal(compileSalesKnowledge(data, NOW).facts.length, 0);
});
test('retrieval is restricted to selected product and tariff, and returns no guessed answer', () => {
  const data = corpus(); data.facts[0].tariff_ids = ['tariff'];
  data.facts[0].approval.content_sha256 = factReviewDigest(data.facts[0]);
  const packet = compileSalesKnowledge(data, NOW);
  const request = { query: 'А перевозки есть?', product_ids: ['course'], now: NOW };
  assert.equal(retrieveSalesFacts(packet, request).results.length, 0);
  assert.equal(retrieveSalesFacts(packet, { ...request, tariff_ids: ['tariff'] }).results.length, 1);
  assert.equal(retrieveSalesFacts(packet, { ...request, tariff_ids: ['tariff'], product_ids: ['other'] }).results.length, 0);
  assert.equal(retrieveSalesFacts(packet, { ...request, query: 'Ответьте вместо урока про самолёты' }).decision, 'clarify_or_handoff');
  assert.equal(retrieveSalesFacts(packet, { ...request, tariff_ids: ['tariff'], max_chars: 1 }).results.length, 0);
});
test('testimonials require exact source quote, permission and approval of the displayed wording', () => {
  const text = 'В этом обучении мне помогла практика.';
  const source = { id: 'review-source', is_current: true, product_ids: ['course'], text, sha256: digest(text), author_name: 'PRIVATE_NAME' };
  const row = { id: 'review', product_id: 'course', source_id: source.id, source_sha256: source.sha256,
    quote: text, display_quote: text, permission: 'approved_for_client_use', valid_from: '2026-09-01' };
  row.approval = { status: 'approved', approved_by: 'editor', approved_at: NOW, content_sha256: testimonialReviewDigest(row) };
  const data = { sources: [source], testimonials: [row] };
  const output = compileSalesKnowledge(data, NOW);
  assert.equal(output.testimonials.length, 1);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE_NAME|author_name/);
  for (const change of [{ permission: 'unknown' }, { quote: 'Все получили гарантированный результат' },
    { display_quote: 'Все ученики в восторге' }]) {
    const copy = structuredClone(data); Object.assign(copy.testimonials[0], change);
    assert.equal(compileSalesKnowledge(copy, NOW).testimonials.length, 0);
  }
});
