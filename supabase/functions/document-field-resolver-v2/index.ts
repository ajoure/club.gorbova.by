// ============================================================================
// document-field-resolver-v2 — preview-only.
// PATCH E.2. Strict ID-first resolver shadow layer.
//
// POST { order_id: uuid, template_id?: uuid }
//   → { resolved, source_trace, warnings, conflicts, missing, locked,
//       locked_manual_override, source_unmapped, catalog_totals }
//
// Production resolver (canonical-document-generate-strict) is NOT touched.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import { loadCatalog } from '../_shared/document-resolver-v2/catalog.ts';
import { resolveFields, type OrderInput } from '../_shared/document-resolver-v2/resolver.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESOLVER_VERSION = 'v2-1.0.0';

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
      .from('user_roles_v2').select('roles!inner(code)').eq('user_id', userId);
    const codes = (roleRows || []).map((r: any) => r.roles?.code);
    const isAdmin = codes.includes('admin') || codes.includes('super_admin') || codes.includes('owner');
    if (!isAdmin) return json({ error: 'forbidden' }, 403);

    const body = await req.json().catch(() => ({}));
    const orderId: string | null = body?.order_id || null;
    const templateId: string | null = body?.template_id || null;
    if (!orderId) return json({ error: 'order_id_required' }, 400);

    // 1) Catalog (active, non-deprecated).
    const catalog = await loadCatalog(supabase);

    // 2) Order.
    const { data: order, error: oErr } = await supabase
      .from('orders_v2')
      .select('id, user_id, order_number, final_price, base_price, currency, deal_date, created_at, meta')
      .eq('id', orderId)
      .maybeSingle();
    if (oErr) return json({ error: `order_load_failed:${oErr.message}` }, 500);
    if (!order) return json({ error: 'order_not_found' }, 404);

    // 3) Requisites (default per owner).
    const ownerUserId = order.user_id;
    let legalReq: any = null, indReq: any = null;
    if (ownerUserId) {
      const { data: legal } = await supabase
        .from('legal_entities_requisites')
        .select('id, data, is_default, updated_at')
        .eq('owner_user_id', ownerUserId)
        .order('is_default', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1);
      legalReq = (legal && legal[0]) ? { id: legal[0].id, data: legal[0].data || {} } : null;

      const { data: ind } = await supabase
        .from('individual_requisites')
        .select('id, data, is_default, updated_at')
        .eq('owner_user_id', ownerUserId)
        .order('is_default', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1);
      indReq = (ind && ind[0]) ? { id: ind[0].id, data: ind[0].data || {} } : null;
    }

    // 4) Default executor.
    const { data: execs } = await supabase
      .from('executors')
      .select('*')
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(1);
    const executor = execs && execs[0] ? execs[0] : null;

    // 5) Template manifest → optional FLD subset.
    let scopePublicIds: Set<string> | null = null;
    if (templateId) {
      const { data: tpl } = await supabase
        .from('document_templates')
        .select('id, current_version_id')
        .eq('id', templateId)
        .maybeSingle();
      if (tpl?.current_version_id) {
        const { data: ver } = await supabase
          .from('document_template_versions')
          .select('token_manifest')
          .eq('id', tpl.current_version_id)
          .maybeSingle();
        const manifest = (ver?.token_manifest || []) as any[];
        const ids = manifest.map(t => t.field_public_id).filter((x: any) => typeof x === 'string' && /^FLD-\d+$/.test(x));
        if (ids.length > 0) scopePublicIds = new Set(ids);
      }
    }

    const orderInput: OrderInput = {
      id: order.id,
      user_id: order.user_id,
      order_number: order.order_number,
      final_price: order.final_price,
      base_price: order.base_price,
      currency: order.currency,
      paid_at: order.deal_date,
      created_at: order.created_at,
      meta: order.meta || {},
    };
    const existingSnapshot = ((order.meta as any)?.document_data?.fields || {}) as Record<string, any>;

    const result = resolveFields(catalog, {
      order: orderInput,
      requisites: { legal: legalReq, individual: indReq },
      executor,
      existingSnapshot,
      resolverVersion: RESOLVER_VERSION,
    }, { rebuild: false, includeManualOverrides: false, scopePublicIds });

    return json({
      ok: true,
      mode: 'preview',
      resolver_version: RESOLVER_VERSION,
      order_id: orderId,
      template_id: templateId,
      catalog_totals: catalog.totals,
      warnings: catalog.warnings,
      conflicts: catalog.conflicts,
      counts: {
        resolved: Object.keys(result.resolved).length,
        locked: result.locked.length,
        locked_manual_override: result.locked_manual_override.length,
        source_unmapped: result.source_unmapped.length,
        missing: result.missing.length,
        conflicts_blocked: result.conflicts_blocked.length,
      },
      resolved: result.resolved,
      source_trace: result.source_trace,
      locked: result.locked,
      locked_manual_override: result.locked_manual_override,
      source_unmapped: result.source_unmapped,
      missing: result.missing,
      conflicts_blocked: result.conflicts_blocked,
    });
  } catch (e: any) {
    return json({ error: 'internal_error', message: String(e?.message || e) }, 500);
  }
});
