import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { factReviewDigest } from './lib/knowledge.mjs';

const cli = fileURLToPath(new URL('./offline.mjs', import.meta.url));
test('offline file workflow assembles privately and retrieves only an approved sales description', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-test-'));
  try {
    const run = (command, data) => {
      const input = join(dir, `${command}.input.json`), output = join(dir, `${command}.output.json`);
      writeFileSync(input, JSON.stringify(data), { mode: 0o600 });
      const result = spawnSync(process.execPath, [cli, command, input, output], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_|Закрытый|\?secret=/);
      assert.equal(statSync(output).mode & 0o777, 0o600);
      return JSON.parse(readFileSync(output, 'utf8'));
    };
    const metadata = { schema_version: 1, complete: true, captured_at: '2026-09-11T12:00:00Z', selected_product_ids: ['demo-product'],
      expected_counts: { lessons: 1, modules: 1, blocks: 0 }, modules: [{ id: 'module', product_id: 'demo-product' }],
      lessons: [{ id: 'lesson', module_id: 'module', video_url: 'https://kinescope.io/demo123?secret=PRIVATE_TOKEN' }], blocks: [],
      bindings: [{ id: 'lesson', verified: true, basis: 'module_ancestry', product_ids: ['demo-product'] }],
      video_catalog: [{ source_id: 'demo123', source_revision: 'v1', duration_ms: 5000, audio_status: 'ready' }] };
    const { plan } = run('inventory', metadata);
    assert.equal(plan.counts.transcribe, 1);
    const batch = run('batch', { plan, ledger: [] });
    assert.equal(batch.jobs.length, 1); assert.equal(batch.execution_authorized, false);
    const assembled = run('assemble', { source_id: 'demo123', source_revision: 'v1', duration_ms: 5000,
      parts: [{ part_index: 0, start_ms: 0, end_ms: 5000, source_revision: 'v1', status: 'ready', text: 'PRIVATE_PAID_TRANSCRIPT' }] });
    assert.equal(assembled.classification, 'paid_private');
    const source = { id: 'source', product_ids: ['demo-product'], lesson_ids: ['lesson'], revision: 'v1', is_current: true,
      sha256: assembled.content_sha256, text: assembled.text };
    const fact = { id: 'demo-fact', product_id: 'demo-product', lesson_id: 'lesson', kind: 'topic', tariff_ids: [],
      text: 'В демонстрационном уроке рассматривается учёт перевозок.', keywords: ['перевозки'], source_id: 'source', source_revision: 'v1',
      source_sha256: source.sha256, valid_from: metadata.captured_at };
    // Synthetic trusted-editor approval for this test, never an approval imported from an LLM.
    fact.approval = { status: 'approved', approved_by: 'test-editor', approved_at: metadata.captured_at, content_sha256: factReviewDigest(fact) };
    const packet = run('compile', { now: metadata.captured_at, corpus: { facts: [fact], sources: [source] } });
    const retrieved = run('retrieve', { packet, request: { query: 'Есть перевозки?', product_ids: ['demo-product'], now: metadata.captured_at } });
    assert.equal(retrieved.results.length, 1);
    assert.doesNotMatch(JSON.stringify(packet) + JSON.stringify(retrieved), /PRIVATE_|transcript/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('CLI cannot overwrite a prior artifact and suppresses malformed input details', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-failure-test-'));
  try {
    const input = join(dir, 'input.json'), output = join(dir, 'output.json');
    writeFileSync(input, JSON.stringify({ now: '2026-09-11', context: { identity: { verified: false } } }));
    writeFileSync(output, 'KEEP');
    assert.equal(spawnSync(process.execPath, [cli, 'context', input, output]).status, 1);
    assert.equal(readFileSync(output, 'utf8'), 'KEEP');
    const other = join(dir, 'other.json'); writeFileSync(input, 'PRIVATE_BAD_INPUT');
    const result = spawnSync(process.execPath, [cli, 'compile', input, other], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(existsSync(other), false);
    assert.doesNotMatch(result.stderr + result.stdout, /PRIVATE_BAD_INPUT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
