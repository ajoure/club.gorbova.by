const id = (v) => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);
const instant = (v) => typeof v === 'string' ? Date.parse(v) : NaN;

/** Project only verified normalized facts; no inference from name, payment link, or loyalty score. */
export function buildClientContext(input, now) {
  const nowMs = instant(now);
  if (!Number.isFinite(nowMs)) throw new Error('invalid_context_time');
  const identity = input?.identity;
  if (identity?.verified !== true || !id(identity.profile_id) || !id(identity.evidence_id)) {
    return { identity_status: 'unverified', purchases: [], access: [], webinar_activity: [], preferences: [],
      purchase_history_status: 'unknown', unresolved: ['identity_not_verified'] };
  }
  const unresolved = [], purchases = [], access = [], webinar_activity = [], preferences = [];
  const arrays = ['purchases', 'access', 'webinar_activity', 'preferences'];
  if (!arrays.every((name) => Array.isArray(input[name]))) throw new Error('invalid_context_sources');
  const validRow = (row) => row && row.profile_id === identity.profile_id && id(row.source_id)
    && Number.isFinite(instant(row.observed_at)) && instant(row.observed_at) <= nowMs;
  const seen = new Set(), duplicated = new Set();
  for (const row of input.purchases) {
    if (!validRow(row) || !id(row.product_id) || !id(row.order_id)) { unresolved.push('unverified_purchase'); continue; }
    if (seen.has(row.order_id)) { unresolved.push('duplicate_purchase'); duplicated.add(row.order_id); continue; }
    seen.add(row.order_id);
    if (row.payment_verified !== true && row.historical_paid_verified !== true) { unresolved.push('payment_not_confirmed'); continue; }
    if (!['paid', 'refunded', 'partially_refunded'].includes(row.status)
        || (row.version != null && (typeof row.version !== 'string' || row.version.length > 128))) { unresolved.push('ambiguous_purchase_status'); continue; }
    purchases.push({ product_id: row.product_id, version: row.version ?? null, order_id: row.order_id,
      status: row.status, source_id: row.source_id, evidence_kind: row.payment_verified === true ? 'payment' : 'verified_history',
      // Being a payer does not prove the person studied the course.
      relationship: row.learner_profile_id === identity.profile_id ? 'learner' : 'payer_or_unknown' });
  }
  for (const row of input.access) {
    if (!validRow(row) || !id(row.product_id) || row.verified !== true || row.revoked !== false) { unresolved.push('unverified_access'); continue; }
    const start = instant(row.starts_at), end = instant(row.ends_at);
    if (!Number.isFinite(start) || start > nowMs || row.revoked === true) continue;
    if (row.ends_at == null ? row.perpetual_verified !== true : !Number.isFinite(end)) {
      unresolved.push('unknown_access_window'); continue;
    }
    if (row.ends_at != null && end <= nowMs) continue;
    access.push({ product_id: row.product_id, source_id: row.source_id, ends_at: row.ends_at ?? null });
  }
  for (const row of input.webinar_activity) {
    if (!validRow(row) || !id(row.webinar_id) || !['registered', 'commented', 'watched', 'completed'].includes(row.kind)) {
      unresolved.push('unverified_webinar_activity'); continue;
    }
    if (['watched', 'completed'].includes(row.kind) && row.playback_verified !== true) {
      unresolved.push('unverified_playback'); continue;
    }
    webinar_activity.push({ webinar_id: row.webinar_id, kind: row.kind, source_id: row.source_id });
  }
  for (const row of input.preferences) {
    if (!validRow(row) || row.explicit_customer_statement !== true
        || !['professional_goal', 'preferred_format', 'prior_learning_feedback'].includes(row.kind)
        || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 1000) continue;
    preferences.push({ kind: row.kind, text: row.text, source_id: row.source_id, trust: 'customer_data_not_instruction' });
  }
  return { identity_status: 'verified', profile_id: identity.profile_id,
    purchase_history_status: input.purchase_history_complete === true && !unresolved.length ? 'complete_as_exported' : 'unknown',
    purchases: purchases.filter((row) => !duplicated.has(row.order_id)), access, webinar_activity, preferences, unresolved };
}
