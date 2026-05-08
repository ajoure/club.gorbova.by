// ============================================================================
// canonical-deal-fields-update (Sprint 11 C3)
// ----------------------------------------------------------------------------
// Update document field snapshot at orders_v2.meta.document_data.fields[FLD-XXXXXX].
//
// Schema convention (canonical):
//   orders_v2.meta = {
//     ...,
//     document_data: {
//       fields: {
//         "FLD-000123": {
//           value: <string|number|boolean|null>,
//           source: 'manual_override' | 'product' | 'tariff' | 'computed' | 'button' | ...,
//           updated_at: <iso>,
//           updated_by: <user_id>,
//           manual_override: true | false
//         }
//       }
//     }
//   }
//
// This function ONLY mutates document_data.fields. Никогда не трогает product/
// tariff/order_number/final_price/etc. Каждая правка = manual_override + audit.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FLD_RE = /^FLD-\d+$/;

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
    const updates = body?.updates;
    if (!orderId || typeof orderId !== 'string') return json({ error: 'order_id_required' }, 400);
    if (!Array.isArray(updates) || updates.length === 0) return json({ error: 'updates_required' }, 400);

    // Validate every update
    const valid: Array<{ field_public_id: string; value: any }> = [];
    for (const u of updates) {
      const fid = u?.field_public_id;
      if (!fid || typeof fid !== 'string' || !FLD_RE.test(fid)) {
        return json({ error: 'invalid_field_public_id', detail: fid }, 400);
      }
      valid.push({ field_public_id: fid, value: u.value === undefined ? null : u.value });
    }

    // Verify all FLDs exist in registry (active)
    const fids = valid.map((v) => v.field_public_id);
    const { data: regs } = await supabase
      .from('fields_registry')
      .select('public_id')
      .in('public_id', fids)
      .is('archived_at', null);
    const knownIds = new Set((regs || []).map((r: any) => r.public_id));
    const unknown = fids.filter((f) => !knownIds.has(f));
    if (unknown.length > 0) return json({ error: 'unknown_field_public_ids', unknown }, 400);

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
      meta: {
        order_id: orderId,
        updated_fields: fids,
        before,
        after,
      },
    });

    return json({ success: true, updated: fids, document_data: newMeta.document_data });
  } catch (e: any) {
    console.error('canonical-deal-fields-update error:', e);
    return json({ error: e?.message || 'internal_error' }, 500);
  }
});
