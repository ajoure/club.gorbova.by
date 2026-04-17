/**
 * CRM Routing — единая логика для:
 *  1) Резолва crm_routing из tariff_offers.meta
 *  2) Сборки snapshot для orders_v2.meta.crm_routing_snapshot
 *  3) Применения terminal-стадии (success/failed) с manual-override guard
 *
 * Scope (Layer A): только offer-driven первичная оплата.
 * Recurring/rebill/refund — вне scope. site-form-submit — отдельный follow-up.
 */

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface CrmRoutingConfig {
  enabled: boolean;
  pipeline_id: string;
  stage_on_pending: string;
  stage_on_success: string;
  stage_on_failed: string;
}

export interface CrmRoutingSnapshot extends CrmRoutingConfig {
  offer_id: string;
  offer_updated_at: string | null;
  pipeline_name: string | null;
  stage_names: {
    pending: string | null;
    success: string | null;
    failed: string | null;
  };
  stage_types: {
    pending: string | null;
    success: string | null;
    failed: string | null;
  };
  offer_title: string | null;
}

export interface ResolvedRouting {
  ok: boolean;
  reason?: string;
  snapshot?: CrmRoutingSnapshot;
  /** How resolution happened — for audit/snapshot transparency. */
  resolved_via?: 'offer_id' | 'tariff_fallback';
  /** Number of routing-enabled candidates considered during fallback. */
  candidates_count?: number;
}

/**
 * Negative (structured) snapshot, written to orders_v2.meta.crm_routing_snapshot
 * when routing cannot be applied. B.0 invariant: snapshot is ALWAYS present in
 * meta after order materialize — positive (CrmRoutingSnapshot) or negative.
 */
export interface NegativeRoutingSnapshot {
  enabled: false;
  reason: string;
  resolved_at: string;
  offer_id: string | null;
  tariff_id: string | null;
  resolved_via: 'offer_id' | 'tariff_fallback' | 'none';
  candidates_count: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * Resolve & validate offer.meta.crm_routing strictly by IDs.
 * Returns { ok:false, reason } or { ok:true, snapshot }.
 */
export async function resolveOfferRouting(
  supabase: SupabaseClient,
  offerId: string | null | undefined,
): Promise<ResolvedRouting> {
  if (!offerId || !isUuid(offerId)) {
    return { ok: false, reason: 'no_offer_id' };
  }

  // 1. Read offer
  const { data: offer, error: offerErr } = await supabase
    .from('tariff_offers')
    .select('id, button_label, meta, updated_at, tariff_id')
    .eq('id', offerId)
    .maybeSingle();

  if (offerErr || !offer) return { ok: false, reason: 'offer_not_found' };

  const meta = (offer.meta && typeof offer.meta === 'object') ? offer.meta as any : {};
  const routing = meta.crm_routing as CrmRoutingConfig | undefined;

  if (!routing || routing.enabled !== true) {
    return { ok: false, reason: 'routing_disabled_or_missing' };
  }

  // 2. Validate UUIDs and uniqueness
  const { pipeline_id, stage_on_pending, stage_on_success, stage_on_failed } = routing;
  if (![pipeline_id, stage_on_pending, stage_on_success, stage_on_failed].every(isUuid)) {
    return { ok: false, reason: 'invalid_uuids_in_routing' };
  }
  const stageSet = new Set([stage_on_pending, stage_on_success, stage_on_failed]);
  if (stageSet.size !== 3) {
    return { ok: false, reason: 'duplicate_stage_ids' };
  }

  // 3. Load pipeline + stages, validate semantics
  const [{ data: pipeline }, { data: stages }] = await Promise.all([
    supabase.from('crm_pipelines').select('id, name').eq('id', pipeline_id).maybeSingle(),
    supabase
      .from('crm_pipeline_stages')
      .select('id, name, stage_type, pipeline_id')
      .in('id', [stage_on_pending, stage_on_success, stage_on_failed]),
  ]);

  if (!pipeline) return { ok: false, reason: 'pipeline_not_found' };
  if (!stages || stages.length !== 3) return { ok: false, reason: 'stages_not_found' };

  const byId: Record<string, { id: string; name: string; stage_type: string; pipeline_id: string }> = {};
  for (const s of stages) byId[s.id] = s as any;

  const sPending = byId[stage_on_pending];
  const sSuccess = byId[stage_on_success];
  const sFailed = byId[stage_on_failed];

  // All stages must belong to selected pipeline
  if (sPending.pipeline_id !== pipeline_id || sSuccess.pipeline_id !== pipeline_id || sFailed.pipeline_id !== pipeline_id) {
    return { ok: false, reason: 'stage_pipeline_mismatch' };
  }
  // v2: snyat хардкод stage_type — менеджер выбирает любые стадии для маппинга
  // success/failed/pending. Контракт остаётся только структурный: 3 разных стадии
  // одной воронки.

  const snapshot: CrmRoutingSnapshot = {
    enabled: true,
    pipeline_id,
    stage_on_pending,
    stage_on_success,
    stage_on_failed,
    offer_id: offer.id,
    offer_updated_at: offer.updated_at ?? null,
    pipeline_name: pipeline.name ?? null,
    stage_names: {
      pending: sPending.name ?? null,
      success: sSuccess.name ?? null,
      failed: sFailed.name ?? null,
    },
    stage_types: {
      pending: sPending.stage_type,
      success: sSuccess.stage_type,
      failed: sFailed.stage_type,
    },
    offer_title: offer.button_label ?? null,
  };

  return { ok: true, snapshot };
}

/**
 * Apply terminal stage with manual-override guard.
 * Idempotent: no-op if already at target stage.
 *
 * SOT: order.meta.crm_routing_snapshot. NO fallback to current offer.meta —
 * snapshot is taken at creation time and is immutable for routing decisions.
 */
export async function applyCrmStageOnTerminal(
  supabase: SupabaseClient,
  orderId: string,
  terminalKind: 'success' | 'failed',
  trigger: string,
): Promise<{ applied: boolean; reason: string }> {
  // 1. Load order
  const { data: order, error: orderErr } = await supabase
    .from('orders_v2')
    .select('id, pipeline_id, pipeline_stage_id, meta, offer_id')
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) {
    await audit(supabase, 'crm_stage_apply_skipped_invalid_config', {
      order_id: orderId, terminal_kind: terminalKind, trigger,
      reason: 'order_not_found', error: orderErr?.message ?? null,
    });
    return { applied: false, reason: 'order_not_found' };
  }

  const meta = (order.meta && typeof order.meta === 'object') ? order.meta as any : {};
  const snapshot = meta.crm_routing_snapshot as CrmRoutingSnapshot | undefined;

  // 2. SOT check — snapshot only (no current-offer fallback per spec).
  if (!snapshot || snapshot.enabled !== true) {
    await audit(supabase, 'crm_stage_apply_skipped_invalid_config', {
      order_id: orderId, terminal_kind: terminalKind, trigger,
      reason: 'no_snapshot_in_order_meta',
    });
    return { applied: false, reason: 'no_snapshot' };
  }

  const targetStageId = terminalKind === 'success' ? snapshot.stage_on_success : snapshot.stage_on_failed;
  const targetStageName = terminalKind === 'success' ? snapshot.stage_names.success : snapshot.stage_names.failed;

  // 3. Manual-override guard
  // 3a. Different pipeline → manual move
  if (order.pipeline_id && order.pipeline_id !== snapshot.pipeline_id) {
    await audit(supabase, 'crm_stage_apply_skipped_manual_override', {
      order_id: orderId, terminal_kind: terminalKind, trigger,
      reason: 'pipeline_changed_manually',
      expected_pipeline: snapshot.pipeline_id,
      actual_pipeline: order.pipeline_id,
      pipeline_name: snapshot.pipeline_name,
    });
    return { applied: false, reason: 'manual_pipeline_change' };
  }
  // 3b. Stage diverged from initial pending → manual move
  if (order.pipeline_stage_id && order.pipeline_stage_id !== snapshot.stage_on_pending) {
    // Idempotent: already at target → skip silently with audit
    if (order.pipeline_stage_id === targetStageId) {
      await audit(supabase, `crm_stage_applied_${terminalKind}`, {
        order_id: orderId, terminal_kind: terminalKind, trigger,
        result: 'idempotent_already_at_target',
        target_stage_id: targetStageId, target_stage_name: targetStageName,
        pipeline_name: snapshot.pipeline_name,
      });
      return { applied: false, reason: 'idempotent' };
    }
    await audit(supabase, 'crm_stage_apply_skipped_manual_override', {
      order_id: orderId, terminal_kind: terminalKind, trigger,
      reason: 'stage_changed_manually',
      expected_stage: snapshot.stage_on_pending,
      actual_stage: order.pipeline_stage_id,
      pipeline_name: snapshot.pipeline_name,
    });
    return { applied: false, reason: 'manual_stage_change' };
  }
  // 3c. pipeline_id NULL but should be set — anomaly, skip
  if (!order.pipeline_id) {
    await audit(supabase, 'crm_stage_apply_skipped_manual_override', {
      order_id: orderId, terminal_kind: terminalKind, trigger,
      reason: 'pipeline_id_null_anomaly',
      expected_pipeline: snapshot.pipeline_id,
    });
    return { applied: false, reason: 'pipeline_null_anomaly' };
  }

  // 4. Apply
  const { error: updErr } = await supabase
    .from('orders_v2')
    .update({
      pipeline_stage_id: targetStageId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  if (updErr) {
    await audit(supabase, 'crm_stage_apply_skipped_invalid_config', {
      order_id: orderId, terminal_kind: terminalKind, trigger,
      reason: 'update_failed', error: updErr.message,
    });
    return { applied: false, reason: 'update_error' };
  }

  await audit(supabase, `crm_stage_applied_${terminalKind}`, {
    order_id: orderId, terminal_kind: terminalKind, trigger,
    pipeline_id: snapshot.pipeline_id,
    pipeline_name: snapshot.pipeline_name,
    from_stage_id: order.pipeline_stage_id,
    from_stage_name: snapshot.stage_names.pending,
    to_stage_id: targetStageId,
    to_stage_name: targetStageName,
    offer_id: snapshot.offer_id,
    offer_title: snapshot.offer_title,
  });

  return { applied: true, reason: 'ok' };
}

async function audit(
  supabase: SupabaseClient,
  action: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_label: 'crm-routing',
      action,
      meta,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[crm-routing] audit insert failed:', e);
  }
}

// ============================================================================
// B.0 — Snapshot invariant helpers (Combined: offer_id-first + tariff fallback)
// ============================================================================

/**
 * Resolve routing with fallback: if offer_id is provided → strict resolveOfferRouting.
 * Otherwise → search tariff_offers by tariff_id with strict filter:
 *   is_active = true AND offer_type = 'pay_now' AND meta->crm_routing->>'enabled' = 'true'
 *
 * Outcomes:
 *  - exactly 1 candidate → resolve via that offer_id, returns positive snapshot.
 *  - 0 candidates → { ok:false, reason:'no_offer_for_tariff', resolved_via:'tariff_fallback', candidates_count:0 }
 *  - >1 candidates → { ok:false, reason:'ambiguous_offers_for_tariff', resolved_via:'tariff_fallback', candidates_count:N }
 *
 * NOTE: writes nothing to DB; pure resolver. Snapshot persistence is the caller's job
 * via buildNegativeSnapshot() + INSERT into orders_v2.
 */
export async function resolveOfferRoutingWithFallback(
  supabase: SupabaseClient,
  args: { offer_id?: string | null; tariff_id?: string | null },
): Promise<ResolvedRouting> {
  const { offer_id, tariff_id } = args;

  if (offer_id && isUuid(offer_id)) {
    const r = await resolveOfferRouting(supabase, offer_id);
    return { ...r, resolved_via: 'offer_id', candidates_count: r.ok ? 1 : 0 };
  }

  if (!tariff_id || !isUuid(tariff_id)) {
    return { ok: false, reason: 'no_offer_id', resolved_via: 'tariff_fallback', candidates_count: 0 };
  }

  // Strict candidate filter — see method doc
  const { data: candidates, error } = await supabase
    .from('tariff_offers')
    .select('id, meta')
    .eq('tariff_id', tariff_id)
    .eq('is_active', true)
    .eq('offer_type', 'pay_now');

  if (error) {
    return { ok: false, reason: 'tariff_lookup_error', resolved_via: 'tariff_fallback', candidates_count: 0 };
  }

  const enabledCandidates = (candidates ?? []).filter((c: any) => {
    const m = (c.meta && typeof c.meta === 'object') ? c.meta as any : {};
    return m.crm_routing && m.crm_routing.enabled === true;
  });

  if (enabledCandidates.length === 0) {
    return { ok: false, reason: 'no_offer_for_tariff', resolved_via: 'tariff_fallback', candidates_count: 0 };
  }
  if (enabledCandidates.length > 1) {
    return { ok: false, reason: 'ambiguous_offers_for_tariff', resolved_via: 'tariff_fallback', candidates_count: enabledCandidates.length };
  }

  const r = await resolveOfferRouting(supabase, enabledCandidates[0].id as string);
  return { ...r, resolved_via: 'tariff_fallback', candidates_count: 1 };
}

/**
 * Build a structural negative snapshot. Always present in orders_v2.meta when
 * routing was not resolved positively. Provides full debug context for B.1.
 */
export function buildNegativeSnapshot(args: {
  reason: string;
  offer_id?: string | null;
  tariff_id?: string | null;
  resolved_via?: 'offer_id' | 'tariff_fallback' | 'none';
  candidates_count?: number;
}): NegativeRoutingSnapshot {
  return {
    enabled: false,
    reason: args.reason,
    resolved_at: new Date().toISOString(),
    offer_id: args.offer_id ?? null,
    tariff_id: args.tariff_id ?? null,
    resolved_via: args.resolved_via ?? 'none',
    candidates_count: args.candidates_count ?? 0,
  };
}

/**
 * Audit a negative snapshot post-INSERT. Non-blocking; failures are logged.
 */
export async function auditNegativeSnapshot(
  supabase: SupabaseClient,
  args: {
    order_id: string;
    offer_id: string | null;
    tariff_id: string | null;
    reason: string;
    resolved_via: 'offer_id' | 'tariff_fallback' | 'none';
    candidates_count: number;
  },
): Promise<void> {
  await audit(supabase, 'crm_routing_snapshot_negative', {
    order_id: args.order_id,
    offer_id: args.offer_id,
    tariff_id: args.tariff_id,
    reason: args.reason,
    resolved_via: args.resolved_via,
    candidates_count: args.candidates_count,
  });
}
