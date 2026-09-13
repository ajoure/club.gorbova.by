import { digest } from './transcript.mjs';

const id = (v) => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);
const kinds = new Set(['topic', 'learning_outcome', 'format', 'prerequisite', 'exclusion', 'tariff_content']);
const timestamp = (v) => typeof v === 'string' ? Date.parse(v) : NaN;
const plain = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
  && !/[<>\u0000-\u0008]/.test(v) && !/https?:\/\//i.test(v);

// Construct an explicit sales-only shape. Never spread an imported source or transcript.
function factShape(fact) {
  return { id: fact.id, product_id: fact.product_id, lesson_id: fact.lesson_id ?? null,
    tariff_ids: [...(fact.tariff_ids ?? [])].sort(), kind: fact.kind,
    text: fact.text, keywords: [...(fact.keywords ?? [])].sort(),
    source_id: fact.source_id, source_revision: fact.source_revision,
    source_sha256: fact.source_sha256, valid_from: fact.valid_from, valid_until: fact.valid_until ?? null };
}

/** Content digest, NOT authorization. Only a trusted editor service may persist approvals. */
export function factReviewDigest(fact) { return digest(JSON.stringify(factShape(fact))); }
export function testimonialReviewDigest(row) {
  return digest(JSON.stringify({ id: row.id, product_id: row.product_id, source_id: row.source_id,
    source_sha256: row.source_sha256, quote: row.quote, display_quote: row.display_quote,
    permission: row.permission, valid_from: row.valid_from, valid_until: row.valid_until ?? null }));
}
function approved(approval, expected, now) {
  return approval?.status === 'approved' && id(approval.approved_by)
    && Number.isFinite(timestamp(approval.approved_at)) && timestamp(approval.approved_at) <= now
    && approval.content_sha256 === expected;
}
function current(row, now) {
  const from = timestamp(row.valid_from), until = timestamp(row.valid_until);
  return Number.isFinite(from) && from <= now && (row.valid_until == null || (Number.isFinite(until) && until > now));
}

/** Publication boundary for a trusted internal editor. Returned packet contains no raw corpus. */
export function compileSalesKnowledge({ facts = [], sources = [], testimonials = [] }, nowIso) {
  const now = timestamp(nowIso);
  if (!Number.isFinite(now) || ![facts, sources, testimonials].every(Array.isArray)) throw new Error('invalid_knowledge_input');
  const sourceMap = new Map();
  for (const source of sources) {
    if (!id(source.id) || sourceMap.has(source.id)) throw new Error('ambiguous_knowledge_source');
    sourceMap.set(source.id, source);
  }
  const accepted = [], rejected = [], seen = new Set();
  const reject = (reason, row) => rejected.push({ reason, ...(id(row?.id) ? { id: row.id } : {}) });
  for (const fact of facts) {
    if (!fact || !id(fact.id) || seen.has(fact.id)) { reject('invalid_or_duplicate_fact', fact); continue; }
    seen.add(fact.id);
    if (!id(fact.product_id) || (fact.lesson_id != null && !id(fact.lesson_id))
        || !kinds.has(fact.kind) || !plain(fact.text, 600)
        || !Array.isArray(fact.tariff_ids) || !fact.tariff_ids.every(id)
        || !Array.isArray(fact.keywords) || fact.keywords.length > 20
        || !fact.keywords.every((word) => plain(word, 60))) { reject('invalid_sales_fact', fact); continue; }
    const source = sourceMap.get(fact.source_id);
    if (!source || source.is_current !== true || !Array.isArray(source.product_ids)
        || !source.product_ids.includes(fact.product_id)
        || (fact.lesson_id && (!Array.isArray(source.lesson_ids) || !source.lesson_ids.includes(fact.lesson_id)))
        || source.revision !== fact.source_revision
        || source.sha256 !== fact.source_sha256 || !/^[a-f0-9]{64}$/.test(source.sha256 ?? '')
        || (typeof source.text === 'string' && digest(source.text) !== source.sha256)) {
      reject('stale_or_missing_source', fact); continue;
    }
    if (!current(fact, now) || !approved(fact.approval, factReviewDigest(fact), now)) {
      reject('unapproved_or_expired_fact', fact); continue;
    }
    accepted.push(factShape(fact));
  }
  const quotes = [];
  for (const row of testimonials) {
    if (!row || !id(row.id) || seen.has(row.id)) { reject('invalid_or_duplicate_testimonial', row); continue; }
    seen.add(row.id);
    const source = sourceMap.get(row.source_id);
    if (!id(row.product_id) || !plain(row.quote, 1000) || !plain(row.display_quote, 600)
        || !source || source.is_current !== true || !Array.isArray(source.product_ids)
        || !source.product_ids.includes(row.product_id) || typeof source.text !== 'string'
        || digest(source.text) !== source.sha256 || source.sha256 !== row.source_sha256
        || !source.text.includes(row.quote) || row.permission !== 'approved_for_client_use'
        || !current(row, now) || !approved(row.approval, testimonialReviewDigest(row), now)) {
      reject('testimonial_not_cleared', row); continue;
    }
    quotes.push({ id: row.id, product_id: row.product_id, kind: 'testimonial', text: row.display_quote,
      source_id: row.source_id, source_sha256: row.source_sha256,
      valid_from: row.valid_from, valid_until: row.valid_until ?? null });
  }
  // Conflicts cannot be resolved by silently taking the first item with a duplicated ID.
  const duplicated = new Set(rejected.filter((r) => /duplicate/.test(r.reason)).map((r) => r.id));
  return { schema_version: 1, audience: 'sales', compiled_at: nowIso,
    facts: accepted.filter((r) => !duplicated.has(r.id)),
    testimonials: quotes.filter((r) => !duplicated.has(r.id)), rejected };
}

const stop = new Set(['как', 'что', 'это', 'есть', 'для', 'или', 'мне', 'вас', 'курс', 'урок', 'можно', 'будет']);
const words = (text) => new Set((text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [])
  .filter((word) => word.length >= 3 && !stop.has(word)).map((word) => word.slice(0, 5)));

/** Deterministic retrieval over the published sales projection; never query raw sources. */
export function retrieveSalesFacts(packet, { query, product_ids, tariff_ids = [], now, max_chars = 4000, limit = 6 }) {
  if (packet?.schema_version !== 1 || packet.audience !== 'sales' || !Array.isArray(packet.facts)
      || typeof query !== 'string' || query.length > 4000 || !Array.isArray(product_ids)
      || !product_ids.length || !product_ids.every(id) || !Array.isArray(tariff_ids) || !tariff_ids.every(id)
      || !Number.isFinite(timestamp(now)) || !Number.isSafeInteger(max_chars) || max_chars < 1
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error('invalid_retrieval_scope');
  const terms = words(query), ranked = [];
  for (const fact of packet.facts) {
    if (!product_ids.includes(fact.product_id) || !current(fact, timestamp(now))) continue;
    if (fact.tariff_ids.length && !fact.tariff_ids.some((tariff) => tariff_ids.includes(tariff))) continue;
    const textTerms = words([fact.text, ...fact.keywords].join(' '));
    const score = [...terms].filter((term) => textTerms.has(term)).length;
    if (score) ranked.push({ fact, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.fact.id.localeCompare(b.fact.id));
  const results = []; let chars = 0;
  for (const { fact } of ranked) {
    if (results.length >= limit) break;
    if (chars + fact.text.length > max_chars) continue;
    chars += fact.text.length;
    results.push({ id: fact.id, kind: fact.kind, product_id: fact.product_id, lesson_id: fact.lesson_id,
      text: fact.text, source_id: fact.source_id, source_revision: fact.source_revision });
  }
  return { decision: results.length ? 'grounded_context' : 'clarify_or_handoff', results, chars };
}
