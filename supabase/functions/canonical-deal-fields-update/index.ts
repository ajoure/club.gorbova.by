// ============================================================================
// canonical-deal-fields-update (Sprint 11 C3 + Hide-Executor)
// ----------------------------------------------------------------------------
// Two modes:
//
//   1) default (no `mode`): manual edit of customer.*/deal.*/cf.* fields.
//      - entity_type='executor' fields are FORBIDDEN here → 400
//        executor_field_not_editable + audit
//        document_data.executor_manual_edit_blocked.
//
//   2) mode='rebuild_executor': re-resolve executor (offer.executor_id →
//      default executor) and rewrite ONLY entity_type='executor' FLDs.
//      - Preserves manual_override entries.
//      - Touches NOTHING else (customer/deal/cf untouched).
//      - Emits document_data.executor_rebuilt.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  resolveExecutorForOrder,
  buildExecutorFieldValues,
  mergeExecutorIntoFields,
  EXECUTOR_FLD_IDS,
} from '../_shared/executor-fields.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FLD_RE = /^FLD-\d+$/;
const EXECUTOR_FLD_SET = new Set<string>(EXECUTOR_FLD_IDS);

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
    const { data: ud } = await supabase.auth.getUser(auth.slice(7));
    if (!ud?.user) return json({ error: 'unauthorized' }, 401);
    const userId = ud.user.id;

    const { data: roleRows } = await supabase
      .from('user_roles_v2')
      .select('roles!inner(code)')
      .eq('user_id', userId);
    const codes = (roleRows || []).map((r: any) => r.roles?.code);
    const isAdmin = codes.includes('admin') || codes.includes('super_admin') || codes.includes('owner');
    if (!isAdmin) return json({ error: 'forbidden' }, 403);

    const body = await req.json().catch(() => ({}));
    const orderId = body?.order_id;
    if (!orderId || typeof orderId !== 'string') return json({ error: 'order_id_required' }, 400);

    const mode = typeof body?.mode === 'string' ? body.mode : 'manual_update';

    const { data: order, error: oErr } = await supabase
      .from('orders_v2')
      .select('id, meta')
      .eq('id', orderId)
      .maybeSingle();
    if (oErr) return json({ error: oErr.message }, 500);
    if (!order) return json({ error: 'order_not_found' }, 404);

    const meta = (order.meta || {}) as any;
    const doc = (meta.document_data || {}) as any;
    const fields = (doc.fields || {}) as Record<string, any>;
    const nowIso = new Date().toISOString();

    // ── MODE: rebuild_executor ─────────────────────────────────────────
    if (mode === 'rebuild_executor') {
      // Resolve executor: offer.executor_id wins, fallback to default.
      const offerId = doc?.source?.offer_id || null;
      let explicitExecutorId: string | null = doc?.executor_id || null;
      if (offerId) {
        const { data: o } = await supabase
          .from('tariff_offers').select('meta').eq('id', offerId).maybeSingle();
        const fromOffer = (o?.meta as any)?.document_defaults?.executor_id || null;
        if (fromOffer) explicitExecutorId = fromOffer;
      }

      const { executor, source, executor_id } = await resolveExecutorForOrder(supabase, explicitExecutorId);
      if (!executor || !source || !executor_id) {
        await supabase.from('audit_logs').insert({
          actor_user_id: userId, actor_type: 'user',
          action: 'document_data.snapshot_executor_missing',
          meta: { order_id: orderId, explicit_executor_id: explicitExecutorId, trigger: 'rebuild_executor' },
        });
        return json({ error: 'executor_not_found', detail: 'no offer executor and no default executor' }, 400);
      }

      const values = buildExecutorFieldValues(executor);
      const merged = mergeExecutorIntoFields(fields, values, source, executor_id, nowIso);

      const newDoc = {
        ...doc,
        fields: merged.fields,
        executor_id,
        executor_source: source,
        last_updated_at: nowIso,
        last_updated_by: userId,
      };
      const newMeta = { ...meta, document_data: newDoc };
      const { error: upErr } = await supabase.from('orders_v2').update({ meta: newMeta }).eq('id', orderId);
      if (upErr) return json({ error: upErr.message }, 500);

      await supabase.from('audit_logs').insert({
        actor_user_id: userId, actor_type: 'user',
        action: 'document_data.executor_rebuilt',
        meta: {
          order_id: orderId,
          executor_id,
          executor_source: source,
          trace: merged.trace,
        },
      });

      return json({
        success: true,
        mode: 'rebuild_executor',
        executor_id,
        executor_source: source,
        trace: merged.trace,
        document_data: newDoc,
      });
    }

    // ── MODE: manual update (default) ──────────────────────────────────
    const updates = body?.updates;
    if (!Array.isArray(updates) || updates.length === 0) return json({ error: 'updates_required' }, 400);

    const valid: Array<{ field_public_id: string; value: any }> = [];
    for (const u of updates) {
      const fid = u?.field_public_id;
      if (!fid || typeof fid !== 'string' || !FLD_RE.test(fid)) {
        return json({ error: 'invalid_field_public_id', detail: fid }, 400);
      }
      valid.push({ field_public_id: fid, value: u.value === undefined ? null : u.value });
    }

    // Guard: refuse executor.* by hardcoded set (fast path).
    const blockedHardcoded = valid.map((u) => u.field_public_id).filter((f) => EXECUTOR_FLD_SET.has(f));

    const fids = valid.map((v) => v.field_public_id);
    const { data: regs } = await supabase
      .from('fields_registry')
      .select('public_id, entity_type')
      .in('public_id', fids)
      .is('archived_at', null);
    const knownIds = new Set((regs || []).map((r: any) => r.public_id));
    const unknown = fids.filter((f) => !knownIds.has(f));
    if (unknown.length > 0) return json({ error: 'unknown_field_public_ids', unknown }, 400);

    // Guard: refuse anything with entity_type='executor' (registry-driven).
    const executorByRegistry = (regs || [])
      .filter((r: any) => r.entity_type === 'executor')
      .map((r: any) => r.public_id);
    const blocked = Array.from(new Set([...blockedHardcoded, ...executorByRegistry]));
    if (blocked.length > 0) {
      await supabase.from('audit_logs').insert({
        actor_user_id: userId, actor_type: 'user',
        action: 'document_data.executor_manual_edit_blocked',
        meta: { order_id: orderId, attempted_fields: blocked },
      });
      return json({
        error: 'executor_field_not_editable',
        blocked,
        hint: 'Используйте mode="rebuild_executor" или измените исполнителя в настройках оффера.',
      }, 400);
    }

    const before: Record<string, any> = {};
    const after: Record<string, any> = {};
    for (const u of valid) {
      const prev = fields[u.field_public_id];
      before[u.field_public_id] = prev?.value ?? null;
      fields[u.field_public_id] = {
        value: u.value,
        source: 'manual_override',
        manual_override: true,
        updated_at: nowIso,
        updated_by: userId,
      };
      after[u.field_public_id] = u.value;
    }

    const newMeta = {
      ...meta,
      document_data: { ...doc, fields, last_updated_at: nowIso, last_updated_by: userId },
    };

    const { error: upErr } = await supabase.from('orders_v2').update({ meta: newMeta }).eq('id', orderId);
    if (upErr) return json({ error: upErr.message }, 500);

    await supabase.from('audit_logs').insert({
      actor_user_id: userId,
      actor_type: 'user',
      action: 'document_data.field_updated',
      meta: { order_id: orderId, updated_fields: fids, before, after },
    });

    return json({ success: true, updated: fids, document_data: newMeta.document_data });
  } catch (e: any) {
    console.error('canonical-deal-fields-update error:', e);
    return json({ error: e?.message || 'internal_error' }, 500);
  }
});
