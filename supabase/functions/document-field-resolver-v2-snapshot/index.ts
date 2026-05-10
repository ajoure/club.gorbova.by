// ============================================================================
// document-field-resolver-v2-snapshot
// PATCH E.2. Writes resolver v2 results to orders_v2.meta.document_data.fields
// with scope_lock=true. Idempotent. Supports apply / rebuild × dry_run.
//
// POST {
//   order_id: uuid,
//   template_id?: uuid,
//   mode: 'apply' | 'rebuild' (default 'apply'),
//   dry_run?: boolean (default false),
//   include_manual_overrides?: boolean (default false; only effective with mode=rebuild)
// }
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

    // System-actor proof bypass: x-admin-proof-secret = CRON_SECRET.
    // Audit records actor_type='system'. Used for E.2 proofs and ops scripts.
    const proofSecret = req.headers.get('x-admin-proof-secret');
    const cronSecret = Deno.env.get('CRON_SECRET') || '';
    let userId: string | null = null;
    let actorType: 'admin' | 'system' = 'admin';

    if (proofSecret && cronSecret && proofSecret === cronSecret) {
      actorType = 'system';
      userId = null;
    } else {
      const auth = req.headers.get('Authorization');
      if (!auth?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
      const { data: ud } = await supabase.auth.getUser(auth.slice(7));
      if (!ud?.user) return json({ error: 'unauthorized' }, 401);
      userId = ud.user.id;
      const { data: roleRows } = await supabase
        .from('user_roles_v2').select('roles!inner(code)').eq('user_id', userId);
      const codes = (roleRows || []).map((r: any) => r.roles?.code);
      const isAdmin = codes.includes('admin') || codes.includes('super_admin') || codes.includes('owner');
      if (!isAdmin) return json({ error: 'forbidden' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const orderId: string | null = body?.order_id || null;
    const templateId: string | null = body?.template_id || null;
    const mode: 'apply' | 'rebuild' = body?.mode === 'rebuild' ? 'rebuild' : 'apply';
    const dryRun: boolean = body?.dry_run === true;
    const includeManualOverrides: boolean = mode === 'rebuild' && body?.include_manual_overrides === true;
    if (!orderId) return json({ error: 'order_id_required' }, 400);

    // 1) Catalog.
    const catalog = await loadCatalog(supabase);

    // 2) Order.
    const { data: order, error: oErr } = await supabase
      .from('orders_v2')
      .select('id, user_id, order_number, final_price, base_price, currency, paid_at, created_at, meta')
      .eq('id', orderId).maybeSingle();
    if (oErr) return json({ error: `order_load_failed:${oErr.message}` }, 500);
    if (!order) return json({ error: 'order_not_found' }, 404);

    // 3) Requisites.
    const ownerUserId = order.user_id;
    let legalReq: any = null, indReq: any = null;
    if (ownerUserId) {
      const { data: legal } = await supabase
        .from('legal_entities_requisites')
        .select('id, data, is_default, updated_at')
        .eq('owner_user_id', ownerUserId)
        .order('is_default', { ascending: false }).order('updated_at', { ascending: false }).limit(1);
      legalReq = (legal && legal[0]) ? { id: legal[0].id, data: legal[0].data || {} } : null;
      const { data: ind } = await supabase
        .from('individual_requisites')
        .select('id, data, is_default, updated_at')
        .eq('owner_user_id', ownerUserId)
        .order('is_default', { ascending: false }).order('updated_at', { ascending: false }).limit(1);
      indReq = (ind && ind[0]) ? { id: ind[0].id, data: ind[0].data || {} } : null;
    }

    // 4) Executor.
    const { data: execs } = await supabase
      .from('executors').select('*')
      .eq('is_active', true)
      .order('is_default', { ascending: false }).order('updated_at', { ascending: false }).limit(1);
    const executor = execs && execs[0] ? execs[0] : null;

    // 5) Optional template manifest scope.
    let scopePublicIds: Set<string> | null = null;
    if (templateId) {
      const { data: tpl } = await supabase
        .from('document_templates').select('id, current_version_id')
        .eq('id', templateId).maybeSingle();
      if (tpl?.current_version_id) {
        const { data: ver } = await supabase
          .from('document_template_versions').select('token_manifest')
          .eq('id', tpl.current_version_id).maybeSingle();
        const manifest = (ver?.token_manifest || []) as any[];
        const ids = manifest.map(t => t.field_public_id).filter((x: any) => typeof x === 'string' && /^FLD-\d+$/.test(x));
        if (ids.length > 0) scopePublicIds = new Set(ids);
      }
    }

    const orderInput: OrderInput = {
      id: order.id, user_id: order.user_id, order_number: order.order_number,
      final_price: order.final_price, base_price: order.base_price, currency: order.currency,
      paid_at: order.paid_at, created_at: order.created_at, meta: order.meta || {},
    };
    const existingSnapshot = ((order.meta as any)?.document_data?.fields || {}) as Record<string, any>;

    const result = resolveFields(catalog, {
      order: orderInput,
      requisites: { legal: legalReq, individual: indReq },
      executor,
      existingSnapshot,
      resolverVersion: RESOLVER_VERSION,
    }, { rebuild: mode === 'rebuild', includeManualOverrides, scopePublicIds });

    const fieldsChanged = Object.keys(result.resolved);
    const counts = {
      written: dryRun ? 0 : fieldsChanged.length,
      would_write: fieldsChanged.length,
      skipped_locked: result.locked.length,
      skipped_manual_override: result.locked_manual_override.length,
      source_unmapped: result.source_unmapped.length,
      missing: result.missing.length,
      conflicts_blocked: result.conflicts_blocked.length,
      warnings: catalog.warnings.length,
    };

    if (!dryRun && fieldsChanged.length > 0) {
      // Write back to orders_v2.meta.document_data.fields, merging.
      const meta = (order.meta || {}) as any;
      const docData = meta.document_data || {};
      const fields = { ...(docData.fields || {}) };
      for (const fid of fieldsChanged) fields[fid] = result.resolved[fid];
      const newMeta = {
        ...meta,
        document_data: {
          ...docData,
          fields,
          last_resolver_v2_run_at: new Date().toISOString(),
          last_resolver_v2_version: RESOLVER_VERSION,
        },
      };
      const { error: uErr } = await supabase
        .from('orders_v2').update({ meta: newMeta }).eq('id', orderId);
      if (uErr) return json({ error: `snapshot_write_failed:${uErr.message}` }, 500);
    }

    // 6) Audit (whitelist meta only — no PII).
    await supabase.from('audit_logs').insert({
      actor_user_id: userId,
      actor_type: actorType,
      actor_label: actorType === 'system' ? 'document_field_resolver_v2_proof' : 'document_field_resolver_v2',
      action: dryRun ? 'document_field_resolver_v2.snapshot_dry_run' : 'document_field_resolver_v2.snapshot_applied',
      meta: {
        order_id: orderId,
        template_id: templateId,
        resolver_version: RESOLVER_VERSION,
        mode,
        force_rebuild: mode === 'rebuild',
        dry_run: dryRun,
        include_manual_overrides: includeManualOverrides,
        scope_lock_term: 'scope_lock',
        counts,
        field_public_ids_changed: fieldsChanged,
      },
    });

    return json({
      ok: true,
      mode,
      dry_run: dryRun,
      include_manual_overrides: includeManualOverrides,
      resolver_version: RESOLVER_VERSION,
      order_id: orderId,
      template_id: templateId,
      counts,
      catalog_totals: catalog.totals,
      warnings: catalog.warnings,
      conflicts_within_scope: catalog.conflicts,
      fields_changed: fieldsChanged,
      fields_skipped_locked: result.locked,
      fields_skipped_manual_override: result.locked_manual_override,
      fields_source_unmapped: result.source_unmapped,
      fields_missing: result.missing,
      source_trace: result.source_trace,
    });
  } catch (e: any) {
    return json({ error: 'internal_error', message: String(e?.message || e) }, 500);
  }
});
