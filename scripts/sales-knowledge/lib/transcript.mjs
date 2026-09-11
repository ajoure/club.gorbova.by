import { createHash } from 'node:crypto';

export const digest = (value) => createHash('sha256').update(value).digest('hex');

export function audioWindows(durationMs, windowMs = 90000) {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 86400000
      || !Number.isSafeInteger(windowMs) || windowMs < 5000 || windowMs > 300000) throw new Error('invalid_audio_window');
  return Array.from({ length: Math.ceil(durationMs / windowMs) }, (_, index) => ({
    part_index: index, start_ms: index * windowMs, end_ms: Math.min(durationMs, (index + 1) * windowMs),
  }));
}

/** Private assembly: exact coverage and revision are mandatory before status ready. */
export function assembleTranscript({ source_id, source_revision, duration_ms, window_ms = 90000, parts }) {
  const planned = audioWindows(duration_ms, window_ms);
  if (typeof source_id !== 'string' || typeof source_revision !== 'string'
      || !/^[\w-]{1,128}$/.test(source_id) || !/^[\w-]{1,128}$/.test(source_revision)
      || !Array.isArray(parts) || parts.length !== planned.length) throw new Error('incomplete_transcript');
  const sorted = [...parts].sort((a, b) => a.part_index - b.part_index);
  for (const [i, part] of sorted.entries()) {
    const expected = planned[i];
    if (part.part_index !== expected.part_index || part.start_ms !== expected.start_ms
        || part.end_ms !== expected.end_ms || part.source_revision !== source_revision
        || part.status !== 'ready' || typeof part.text !== 'string'
        || (!part.text.trim() && part.silence_verified !== true)) throw new Error('invalid_transcript_coverage');
  }
  const text = sorted.map((part) => part.text.trim()).filter(Boolean).join('\n\n');
  if (!text) throw new Error('empty_transcript');
  return { classification: 'paid_private', source_id, source_revision, duration_ms,
    coverage_verified: true, status: 'ready', text, content_sha256: digest(text),
    segments: sorted.map(({ part_index, start_ms, end_ms, text }) => ({ part_index, start_ms, end_ms, text })) };
}

/** A bounded dry-run only. Running/uncertain work is never blindly retried. */
export function planBatch(plan, ledger, { max_jobs = 3, max_audio_ms = 1800000 } = {}) {
  if (plan?.status !== 'ready_for_review' || !Array.isArray(plan.jobs) || !Array.isArray(ledger)
      || !Number.isSafeInteger(max_jobs) || max_jobs <= 0
      || !Number.isSafeInteger(max_audio_ms) || max_audio_ms <= 0) throw new Error('batch_not_reviewable');
  const states = new Map();
  for (const row of ledger) {
    if (!row || typeof row.key !== 'string' || states.has(row.key)) throw new Error('ambiguous_ledger');
    states.set(row.key, row.status);
  }
  const jobs = [], held = [];
  let total = 0;
  const seen = new Set();
  for (const job of plan.jobs) {
    const key = digest(JSON.stringify(['kinescope', job.source_id, job.source_revision, 'transcribe-v1']));
    if (seen.has(key)) throw new Error('duplicate_batch_job');
    seen.add(key);
    if (job.action === 'reuse') continue;
    if (job.action !== 'transcribe' || job.eligible_after_review !== true
        || !Number.isSafeInteger(job.duration_ms) || job.duration_ms <= 0) throw new Error('invalid_batch_job');
    if (states.has(key)) {
      if (states.get(key) !== 'complete') held.push({ key, reason: 'existing_attempt_requires_reconciliation' });
      continue;
    }
    if (jobs.length >= max_jobs || total + job.duration_ms > max_audio_ms) {
      held.push({ key, reason: 'batch_limit' }); continue;
    }
    total += job.duration_ms;
    jobs.push({ key, source_id: job.source_id, source_revision: job.source_revision, duration_ms: job.duration_ms });
  }
  return { execution_authorized: false, audio_ms: total, jobs, held };
}
