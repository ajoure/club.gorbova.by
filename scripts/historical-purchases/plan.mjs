import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildSourceCohort } from './cohort.mjs';

export const BATCH = 'hist-cb17-18-20260911-v1';
const sameSet = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
const flagIsSet = value => value === true || value === 'true' || value === 1 || value === '1';

export function hasPaidBusinessWindow(subscription, asOf) {
  const now = Date.parse(asOf), end = Date.parse(subscription.access_end_at);
  if (!Number.isFinite(now)) throw new Error('An explicit valid audit timestamp is required');
  return Number.isFinite(end) && end > now
    // canceled means rebilling stopped; the paid window is still valid.
    && ['active', 'past_due', 'canceled'].includes(subscription.status)
    && subscription.verified_paid_250 === true && subscription.order_status === 'paid'
    && subscription.order_deleted === false && subscription.order_is_trial === false
    && subscription.order_tariff_is_business === true
    && !['test', 'sandbox', 'gift'].some(key => flagIsSet(subscription.order_flags?.[key]));
}
function stableId(key) {
  const h = createHash('sha256').update(key).digest('hex').split('');
  h[12] = '8'; h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  const s = h.join('').slice(0,32);
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}

/** Produces a proposal, never executes SQL, creates contacts, or grants access. */
export function planMissingHistory(source, inventory, catalog, decisions = {}, asOf = new Date().toISOString()) {
  const rows = buildSourceCohort(source, catalog), actions = [], review = [], eligible = [];
  if (inventory.length !== rows.length) throw new Error('Inventory cohort count mismatch');
  const seen = new Set();
  for (const row of rows) {
    const matches = inventory.filter(x => x.refs.includes(row.refs[0]));
    if (matches.length !== 1 || !sameSet(matches[0].refs, row.refs)) throw new Error('Inventory source references mismatch');
    const current = matches[0];
    if (seen.has(current)) throw new Error('Inventory row reused');
    seen.add(current);
    if (!sameSet(row.module_product_ids, current.module_list_requested_SOURCE_JSON_not_db)) throw new Error('Inventory module selection changed');
    const missingModules = row.module_product_ids.filter(id => !current.existing_module_coverage_db.includes(id));
    if (!sameSet(missingModules, current.missing_historical_fact)) throw new Error('Inventory coverage discrepancy');
    const conflictApproved = row.refs.every(ref => decisions.email_priority_refs?.includes(ref));
    if (!current.profile_id || current.match_status === 'ambiguous_email'
        || (current.phone_points_to_other_profile && !conflictApproved)
        || current.profile_merged_to) {
      review.push({refs:row.refs, reason: current.match_status === 'ambiguous_email' ? 'ambiguous_identity' : 'identity_review', missing_modules:missingModules.length});
      continue;
    }
    // A missing phone is not a shared identity. Real shared phones still need no
    // purchase action when the unique email already has the requested facts.
    const owned = o => o.profile_id === current.profile_id;
    const rootExists = row.tariff_id && current.existing_paid_root_orders_db.some(o =>
      o.tariff_id === row.tariff_id && o.hist_type !== 'module_only_standalone' && owned(o));
    const facts = missingModules.map(product_id => ({product_id, tariff_id:null, kind:'module_only_standalone'}));
    if (row.tariff_id && !rootExists) facts.push({product_id:row.product_id, tariff_id:row.tariff_id, kind:'base_tariff_purchase'});
    for (const fact of facts) {
      const key = `${BATCH}:${row.cohort}:${current.profile_id}:${fact.product_id}:${fact.tariff_id || 'module'}`;
      actions.push({id:stableId(key), idempotency_key:key, refs:row.refs, cohort:row.cohort,
        profile_id:current.profile_id, user_id:current.user_id, ...fact,
        flow_id:fact.kind==='base_tariff_purchase'?row.flow_id:null,
        // These are access-history facts, not new cash receipts or checkout orders.
        history_only:true, owner_confirmed_paid:true, create_payment:false, grant_access:false});
    }
    if (current.user_id) {
      const paid = current.club_business_subscriptions.filter(s => hasPaidBusinessWindow(s, asOf));
      if (paid.length) eligible.push({refs:row.refs,user_id:current.user_id,profile_id:current.profile_id,
        source_subscriptions:paid.map(s=>({id:s.subscription_id,order_id:s.source_order_id,status:s.status,access_end_at:s.access_end_at}))});
    }
  }
  if (new Set(actions.map(a=>a.id)).size !== actions.length) throw new Error('Duplicate proposed history fact');
  return {batch:BATCH,execute_ready:false,actions,review,eligible_business_candidates:eligible,
    summary:{source_rows:141,cohort_rows:rows.length,module_inserts:actions.filter(a=>a.kind==='module_only_standalone').length,
      course_inserts:actions.filter(a=>a.kind==='base_tariff_purchase').length,identity_review_rows:review.length,
      verified_business_candidates:eligible.length}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , manifest, inventory, catalog, out, decisionPath] = process.argv;
  if (!out) throw new Error('Usage: node plan.mjs <hash-manifest> <inventory> <catalog> <out> [decisions]');
  const read = p => JSON.parse(readFileSync(p,'utf8'));
  const plan=planMissingHistory(read(manifest),read(inventory),read(catalog),decisionPath?read(decisionPath):{});
  writeFileSync(out,JSON.stringify(plan,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(plan.summary,null,2));
}
