// ============================================================================
// canonical-deal-document-overrides
// ----------------------------------------------------------------------------
// Admin-only document-level overrides for an order:
//   - payer_type (column orders_v2.payer_type)
//   - meta.documents.payer_type_source ('auto' | 'admin_override')
//   - meta.documents.payer_entity_override ({kind,id} | null)
//   - meta.documents.template_override (uuid | null)
//   - meta.documents.executor_override (uuid | null)
//
// STOP-guards:
//   - NEVER touches payments_v2 / actual payment channel / provider data.
//   - NEVER touches order amount, status, dates, product/tariff.
//   - JWT actor (admin|super_admin|owner). user_id NOT taken from body.
//
// Audit:
//   - deal.payer_type.override
//   - deal.payer_entity.override
//   - deal.document_template.override
//   - deal.executor.override
//
// Body: { order_id, changes: { payer_type?, payer_entity_override?, template_override?, executor_override? } }
// `payer_entity_override`/`template_override`/`executor_override` accept `null` to clear.
// `payer_type` setting => payer_type_source = 'admin_override'.
// Sending no `payer_type` change but explicit `clear_payer_override: true` resets to 'auto'.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import { snapshotOrderDocumentData } from '../_shared/document-data-snapshot.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_PAYER_TYPES = new Set(['individual', 'legal_entity']);
const VALID_ENTITY_KINDS = new Set(['individual', 'legal_entity']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const actorLabel = ud.user.email || ud.user.id;

    // Canonical RBAC via has_role_v2 (no manual user_roles_v2 walk).
    const [adminRes, superRes, ownerRes] = await Promise.all([
      supabase.rpc('has_role_v2', { _user_id: userId, _role_code: 'admin' }),
      supabase.rpc('has_role_v2', { _user_id: userId, _role_code: 'super_admin' }),
      supabase.rpc('has_role_v2', { _user_id: userId, _role_code: 'owner' }),
    ]);
    const isAdmin = adminRes.data === true || superRes.data === true || ownerRes.data === true;
    if (!isAdmin) return json({ error: 'forbidden' }, 403);

    const body = await req.json().catch(() => ({}));
    const orderId = body?.order_id;
    if (!orderId || typeof orderId !== 'string') return json({ error: 'order_id_required' }, 400);

    const changes = (body?.changes || {}) as Record<string, any>;
    const clearPayerOverride = body?.clear_payer_override === true;

    // Validate
    if ('payer_type' in changes && !VALID_PAYER_TYPES.has(changes.payer_type)) {
      return json({ error: 'invalid_payer_type' }, 400);
    }
    if ('payer_entity_override' in changes && changes.payer_entity_override !== null) {
      const e = changes.payer_entity_override;
      if (!e || !VALID_ENTITY_KINDS.has(e.kind) || !UUID_RE.test(String(e.id || ''))) {
        return json({ error: 'invalid_payer_entity_override' }, 400);
      }
    }
    for (const key of ['template_override', 'executor_override']) {
      if (key in changes && changes[key] !== null && !UUID_RE.test(String(changes[key] || ''))) {
        return json({ error: `invalid_${key}` }, 400);
      }
    }

    // Load current state
    const { data: order, error: oErr } = await supabase
      .from('orders_v2').select('id, payer_type, meta').eq('id', orderId).maybeSingle();
    if (oErr) return json({ error: oErr.message }, 500);
    if (!order) return json({ error: 'order_not_found' }, 404);

    const meta = (order.meta || {}) as any;
    const documents = (meta.documents || {}) as any;
    const before = {
      payer_type: order.payer_type,
      payer_type_source: documents.payer_type_source ?? 'auto',
      payer_entity_override: documents.payer_entity_override ?? null,
      template_override: documents.template_override ?? null,
      executor_override: documents.executor_override ?? null,
    };

    const newDocuments = { ...documents };
    let newPayerType: string = order.payer_type;
    const auditEntries: Array<{ action: string; meta: Record<string, unknown> }> = [];

    if ('payer_type' in changes && changes.payer_type !== before.payer_type) {
      newPayerType = changes.payer_type;
      newDocuments.payer_type_source = 'admin_override';
      auditEntries.push({
        action: 'deal.payer_type.override',
        meta: { order_id: orderId, before: before.payer_type, after: newPayerType, source: 'admin_override' },
      });
    } else if (clearPayerOverride && before.payer_type_source === 'admin_override') {
      newDocuments.payer_type_source = 'auto';
      auditEntries.push({
        action: 'deal.payer_type.override',
        meta: { order_id: orderId, before: before.payer_type, after: newPayerType, cleared: true },
      });
    }

    if ('payer_entity_override' in changes) {
      const next = changes.payer_entity_override;
      const equal = JSON.stringify(next) === JSON.stringify(before.payer_entity_override);
      if (!equal) {
        newDocuments.payer_entity_override = next;
        auditEntries.push({
          action: 'deal.payer_entity.override',
          meta: { order_id: orderId, before: before.payer_entity_override, after: next },
        });
      }
    }
    if ('template_override' in changes && changes.template_override !== before.template_override) {
      newDocuments.template_override = changes.template_override;
      auditEntries.push({
        action: 'deal.document_template.override',
        meta: { order_id: orderId, before: before.template_override, after: changes.template_override },
      });
    }
    if ('executor_override' in changes && changes.executor_override !== before.executor_override) {
      newDocuments.executor_override = changes.executor_override;
      auditEntries.push({
        action: 'deal.executor.override',
        meta: { order_id: orderId, before: before.executor_override, after: changes.executor_override },
      });
    }

    if (auditEntries.length === 0) {
      return json({ ok: true, no_changes: true });
    }

    // Persist (orders_v2 only; payments_v2 untouched).
    const newMeta = { ...meta, documents: newDocuments };
    const { error: uErr } = await supabase
      .from('orders_v2')
      .update({ payer_type: newPayerType, meta: newMeta })
      .eq('id', orderId);
    if (uErr) return json({ error: uErr.message }, 500);

    // Server-side audit (JWT actor). If audit insert fails, surface 500 — the
    // override is not considered successful without a traceability record.
    const { error: auditErr } = await supabase.from('audit_logs').insert(
      auditEntries.map((a) => ({
        actor_user_id: userId,
        actor_type: 'user',
        actor_label: actorLabel,
        action: a.action,
        target_user_id: null,
        meta: a.meta,
      })),
    );
    if (auditErr) return json({ error: `audit_failed: ${auditErr.message}` }, 500);

    return json({
      ok: true,
      payer_type: newPayerType,
      documents: newDocuments,
      audit_count: auditEntries.length,
    });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
