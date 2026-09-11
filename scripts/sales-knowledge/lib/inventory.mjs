const opaque = (value) => typeof value === 'string' && /^[\w-]{1,128}$/.test(value);

/** Preserve UUIDs and short player IDs; never expose query strings or accept lookalike hosts. */
export function kinescopeReference(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.startsWith('kinescope.io/') ? `https://${value}` : value);
    if (url.protocol !== 'https:' || url.hostname !== 'kinescope.io' || url.port || url.username || url.password) return null;
    const match = url.pathname.match(/^\/(?:embed\/)?([\w-]{6,128})\/?$/);
    return match?.[1] ?? null;
  } catch { return null; }
}

function uniqueMap(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`invalid_${label}`);
  const result = new Map();
  for (const row of rows) {
    if (!row || !opaque(row.id) || result.has(row.id)) throw new Error(`duplicate_or_invalid_${label}`);
    result.set(row.id, row);
  }
  return result;
}

/** Canonical export adapter. Product bindings are verified upstream, not guessed from titles. */
export function buildInventory(input) {
  if (input?.schema_version !== 1) throw new Error('invalid_export_version');
  const lessons = uniqueMap(input.lessons, 'lessons');
  const modules = uniqueMap(input.modules, 'modules');
  const blocks = uniqueMap(input.blocks, 'blocks');
  const bindings = uniqueMap(input.bindings, 'bindings'); // id = lesson id
  const issues = [];
  const add = (code, ref) => issues.push({ code, ref });
  const aliases = new Map();
  for (const video of input.video_catalog ?? []) {
    if (!opaque(video.source_id) || !opaque(video.source_revision)) throw new Error('invalid_video_catalog');
    for (const alias of [video.source_id, ...(video.aliases ?? [])]) {
      if (!opaque(alias) || (aliases.has(alias) && aliases.get(alias).source_id !== video.source_id)) {
        throw new Error('ambiguous_video_alias');
      }
      if (aliases.has(alias) && JSON.stringify(aliases.get(alias)) !== JSON.stringify(video)) throw new Error('conflicting_video_catalog');
      aliases.set(alias, video);
    }
  }
  // Validate flat parent_id trees, including videos nested inside container blocks.
  for (const block of blocks.values()) {
    if (!lessons.has(block.lesson_id)) { add('orphan_block', block.id); continue; }
    const seen = new Set([block.id]);
    let cursor = block;
    while (cursor.parent_id) {
      const parent = blocks.get(cursor.parent_id);
      if (!parent || parent.lesson_id !== block.lesson_id || seen.has(parent.id)) {
        add('invalid_block_parent', block.id); break;
      }
      seen.add(parent.id); cursor = parent;
    }
  }
  const normalized = [];
  for (const lesson of lessons.values()) {
    const before = issues.length;
    const candidates = new Set(lesson.product_id ? [lesson.product_id] : []);
    const visited = new Set();
    let moduleId = lesson.module_id;
    while (moduleId) {
      const module = modules.get(moduleId);
      if (!module || visited.has(moduleId)) { add('unresolved_module_ancestry', lesson.id); break; }
      visited.add(moduleId);
      if (module.product_id) candidates.add(module.product_id);
      moduleId = module.parent_module_id;
    }
    const binding = bindings.get(lesson.id);
    const mapped = binding?.verified === true && Array.isArray(binding.product_ids)
      && binding.product_ids.length > 0 && binding.product_ids.every(opaque)
      && ['direct', 'module_ancestry', 'access_rule'].includes(binding.basis)
      && (binding.basis === 'access_rule' ? opaque(binding.evidence_id)
        : binding.product_ids.every((product) => candidates.has(product)));
    if (!mapped) add('unverified_product_binding', lesson.id);
    const references = new Set();
    const collectUrl = (url, ref) => {
      if (!url) return;
      const videoRef = kinescopeReference(url);
      if (videoRef) references.add(videoRef);
      else add('unsupported_or_invalid_video', ref);
    };
    collectUrl(lesson.video_url, lesson.id);
    // HTML containers can contain legacy iframe/video markup. Reject unrecognized media.
    const scan = (value, ref) => {
      if (typeof value === 'string') {
        const tags = value.match(/<(?:iframe|video|source)\b[^>]*>/gi) ?? [];
        for (const tag of tags) {
          const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
          if (!src) add('unresolved_embedded_media', ref);
          else collectUrl(src.replaceAll('&amp;', '&'), ref);
        }
      } else if (Array.isArray(value)) value.forEach((item) => scan(item, ref));
      else if (value && typeof value === 'object') Object.values(value).forEach((item) => scan(item, ref));
    };
    scan(lesson.content, lesson.id);
    for (const block of blocks.values()) {
      if (block.lesson_id !== lesson.id) continue;
      if (['video', 'video_unskippable'].includes(block.block_type)) {
        if (!block.content?.url) add('empty_video_block', block.id);
        else collectUrl(block.content.url, block.id);
      } else if (block.block_type === 'embed' && block.content?.url) {
        // External embeds require review, even if their purpose cannot be determined locally.
        collectUrl(block.content.url, block.id);
      }
      scan(block.content, block.id);
    }
    const videos = [];
    const seenSources = new Set();
    for (const ref of references) {
      const video = aliases.get(ref);
      if (!video) { add('missing_provider_metadata', lesson.id); continue; }
      if (seenSources.has(video.source_id)) continue;
      seenSources.add(video.source_id);
      videos.push({ source_id: video.source_id, source_revision: video.source_revision,
        audio_status: video.audio_status, duration_ms: video.duration_ms,
        transcript: video.transcript ? {
          status: video.transcript.status, has_text: video.transcript.has_text,
          source_revision: video.transcript.source_revision,
          coverage_verified: video.transcript.coverage_verified,
        } : undefined });
    }
    normalized.push({ id: lesson.id, product_ids: mapped ? [...binding.product_ids] : [],
      mapping_verified: Boolean(mapped), media_inventory_complete: input.complete === true && issues.length === before,
      non_video_content_verified: lesson.non_video_content_verified === true, videos });
  }
  for (const key of ['lessons', 'modules', 'blocks']) {
    if (!Number.isSafeInteger(input.expected_counts?.[key]) || input.expected_counts[key] !== input[key].length) {
      add('export_count_mismatch', key);
    }
  }
  return { schema_version: 1, captured_at: input.captured_at,
    complete: input.complete === true && issues.length === 0,
    selected_product_ids: input.selected_product_ids,
    expected_lesson_count: input.expected_counts?.lessons,
    lessons: normalized, discovery_issues: issues };
}
