import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const id = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;

/** Pure preflight over a normalized, metadata-only export. Never calls STT or a database. */
export function planTranscriptions(snapshot) {
  if (snapshot?.schema_version !== 1 || !Array.isArray(snapshot.lessons)
      || !Array.isArray(snapshot.selected_product_ids)
      || !snapshot.selected_product_ids.length || !snapshot.selected_product_ids.every(id)) {
    throw new Error('invalid_snapshot');
  }
  const issues = [];
  const issue = (code, ref) => issues.push({ code, ...(ref ? { ref } : {}) });
  if (!snapshot.lessons.length) issue('empty_lesson_inventory');
  if (snapshot.complete !== true) issue('incomplete_export');
  if (!Number.isSafeInteger(snapshot.expected_lesson_count)
      || snapshot.expected_lesson_count !== snapshot.lessons.length) issue('lesson_count_mismatch');
  if (typeof snapshot.captured_at !== 'string' || !Number.isFinite(Date.parse(snapshot.captured_at))) {
    issue('missing_snapshot_time');
  }

  const selected = new Set(snapshot.selected_product_ids);
  const seenLessons = new Set();
  const sources = new Map();
  const lessonPlans = [];
  for (const lesson of snapshot.lessons) {
    if (!id(lesson.id)) { issue('invalid_lesson_id'); continue; }
    if (seenLessons.has(lesson.id)) { issue('duplicate_lesson', lesson.id); continue; }
    seenLessons.add(lesson.id);
    if (lesson.mapping_verified !== true || !Array.isArray(lesson.product_ids)
        || !lesson.product_ids.some((product) => selected.has(product))) {
      issue('unverified_product_mapping', lesson.id);
      continue;
    }
    if (!Array.isArray(lesson.videos) || lesson.media_inventory_complete !== true) {
      issue('incomplete_lesson_media_inventory', lesson.id);
      continue;
    }
    if (!lesson.videos.length && lesson.non_video_content_verified !== true) {
      issue('lesson_without_verified_content', lesson.id);
    }
    const sourceIds = new Set();
    for (const video of lesson.videos) {
      if (!id(video.source_id) || !id(video.source_revision)) {
        issue('invalid_source_identity', lesson.id); continue;
      }
      sourceIds.add(video.source_id);
      const transcript = video.transcript;
      const reusable = transcript?.status === 'ready' && transcript.has_text === true
        && transcript.source_revision === video.source_revision
        && transcript.coverage_verified === true;
      const audioReady = video.audio_status === 'ready';
      const duration = positive(video.duration_ms) ? video.duration_ms : null;
      const action = reusable ? 'reuse' : audioReady && duration ? 'transcribe' : 'blocked';
      const metadata = {
        source_revision: video.source_revision, action, duration_ms: duration,
      };
      const existing = sources.get(video.source_id);
      if (existing && JSON.stringify(existing.metadata) !== JSON.stringify(metadata)) {
        issue('conflicting_source_metadata', video.source_id);
      } else if (existing) {
        existing.lesson_ids.add(lesson.id);
      } else {
        sources.set(video.source_id, { metadata, lesson_ids: new Set([lesson.id]) });
      }
      if (action === 'blocked') issue(audioReady ? 'unknown_audio_duration' : 'audio_not_ready', video.source_id);
    }
    lessonPlans.push({ lesson_id: lesson.id, source_ids: [...sourceIds].sort() });
  }
  const jobs = [...sources].sort(([a], [b]) => a.localeCompare(b)).map(([source_id, row]) => ({
    source_id, ...row.metadata, lesson_ids: [...row.lesson_ids].sort(),
  }));
  const ok = issues.length === 0;
  return {
    schema_version: 1,
    status: ok ? 'ready_for_review' : 'blocked',
    execution_authorized: false,
    captured_at: typeof snapshot.captured_at === 'string' ? snapshot.captured_at : null,
    counts: {
      lessons: snapshot.lessons.length,
      unique_sources: jobs.length,
      reuse: jobs.filter((job) => job.action === 'reuse').length,
      transcribe: jobs.filter((job) => job.action === 'transcribe').length,
      blocked: jobs.filter((job) => job.action === 'blocked').length,
      new_audio_ms: jobs.filter((job) => job.action === 'transcribe')
        .reduce((sum, job) => sum + job.duration_ms, 0),
    },
    issues,
    // Even valid individual rows cannot be executed from a partial/conflicting snapshot.
    jobs: jobs.map((job) => ({ ...job, eligible_after_review: ok && job.action !== 'blocked' })),
    lessons: lessonPlans,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [input, output] = process.argv.slice(2);
    if (!input || !output || process.argv.length !== 4) throw new Error('usage');
    const result = planTranscriptions(JSON.parse(await readFile(input, 'utf8')));
    // Never overwrite a previous run, and never emit source payloads or paths to stdout.
    await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: result.status, counts: result.counts, issue_count: result.issues.length }));
    if (result.status === 'blocked') process.exitCode = 2;
  } catch {
    console.error('Preflight failed. Check the metadata schema and use a new output file.');
    process.exitCode = 1;
  }
}
