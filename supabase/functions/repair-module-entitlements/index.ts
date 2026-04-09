/**
 * repair-module-entitlements — Canonical idempotent repair path
 * for historical standalone module purchases.
 *
 * Source: orders_v2 WHERE purchase_snapshot.historical_purchase_type = 'module_only_standalone'
 *         AND module_list_mapped contains exactly 1 UUID
 *
 * Actions per (user_id, module_product_id):
 *   skip_active        — entitlement already active
 *   reactivate         — entitlement exists but expired/inactive → UPDATE status='active', merge meta
 *   create             — no entitlement → INSERT
 *   manual_review      — conflict (>1 entitlement, revoked/cancelled, multi-module, malformed UUID)
 *   skip_multi_module  — module_list_mapped.length > 1
 *
 * Hard rules:
 *   - Only UUID from module_list_mapped (no text heuristics)
 *   - Multi-module orders excluded from auto-execute
 *   - Duplicate entitlements (>1 for same user+product) → manual_review
 *   - Revoked/cancelled/manual_blocked statuses → manual_review (no auto-reactivate)
 *   - expires_at: for skip_active → NEVER change; for reactivate → preserve existing; for create → NULL
 *   - Repeat calls = 0 changes (idempotent)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RepairItem {
  user_id: string;
  profile_id: string | null;
  module_product_id: string;
  product_code: string | null;
  product_name: string | null;
  orders_count: number;
  first_order_id: string;
  first_order_number: string;
  action: 'skip_active' | 'reactivate' | 'create' | 'manual_review' | 'skip_multi_module';
  review_reason?: string;
  entitlement_id?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DANGEROUS_STATUSES = ['revoked', 'cancelled', 'manual_blocked'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const mode: 'dry_run' | 'execute' = body.mode || 'dry_run';
    const filterUserId: string | undefined = body.filter_user_id;
    const batchId = crypto.randomUUID();

    // ── Step 1: Fetch all module_only_standalone orders ──
    let query = supabase
      .from('orders_v2')
      .select('id, order_number, user_id, profile_id, product_id, purchase_snapshot')
      .eq('status', 'paid')
      .not('purchase_snapshot', 'is', null);

    if (filterUserId) {
      query = query.eq('user_id', filterUserId);
    }

    const QUERY_LIMIT = 2000;
    const { data: orders, error: ordersErr } = await query.limit(QUERY_LIMIT);
    if (ordersErr) throw new Error(`Failed to fetch orders: ${ordersErr.message}`);

    // STOP-guard: hard-fail if limit reached (possible silent truncation)
    if ((orders || []).length >= QUERY_LIMIT) {
      return new Response(JSON.stringify({
        error: `HARD FAIL: query returned ${QUERY_LIMIT} rows — possible truncation. Implement pagination before proceeding.`,
        rows_returned: (orders || []).length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 422,
      });
    }

    // Filter to module_only_standalone with valid module_list_mapped
    const moduleOrders = (orders || []).filter((o: any) => {
      const snap = o.purchase_snapshot as any;
      return snap?.historical_purchase_type === 'module_only_standalone'
        && Array.isArray(snap?.module_list_mapped)
        && snap.module_list_mapped.length > 0;
    });

    // ── Step 2: Group by (user_id, module_product_id) with dedup ──
    const grouped = new Map<string, {
      user_id: string;
      profile_id: string | null;
      module_product_id: string;
      orders: { id: string; order_number: string }[];
      is_multi_module: boolean;
    }>();

    for (const order of moduleOrders) {
      const snap = order.purchase_snapshot as any;
      const moduleIds: string[] = snap.module_list_mapped;
      const isMulti = moduleIds.length > 1;

      for (const mid of moduleIds) {
        if (!UUID_RE.test(mid)) continue; // skip malformed

        const key = `${order.user_id}::${mid}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.orders.push({ id: order.id, order_number: order.order_number });
          if (isMulti) existing.is_multi_module = true;
        } else {
          grouped.set(key, {
            user_id: order.user_id,
            profile_id: order.profile_id,
            module_product_id: mid,
            orders: [{ id: order.id, order_number: order.order_number }],
            is_multi_module: isMulti,
          });
        }
      }
    }

    // ── Step 3: Resolve product_code & product_name for each module_product_id ──
    const uniqueProductIds = [...new Set([...grouped.values()].map(g => g.module_product_id))];
    const productMap = new Map<string, { code: string | null; name: string | null }>();

    if (uniqueProductIds.length > 0) {
      const { data: products } = await supabase
        .from('products_v2')
        .select('id, code, name')
        .in('id', uniqueProductIds);

      for (const p of (products || [])) {
        productMap.set(p.id, { code: p.code, name: p.name });
      }
    }

    // ── Step 4: Classify each (user_id, module_product_id) pair ──
    const results: RepairItem[] = [];
    let executeCount = 0;

    for (const [, group] of grouped) {
      const prodInfo = productMap.get(group.module_product_id) || { code: null, name: null };

      const item: RepairItem = {
        user_id: group.user_id,
        profile_id: group.profile_id,
        module_product_id: group.module_product_id,
        product_code: prodInfo.code,
        product_name: prodInfo.name,
        orders_count: group.orders.length,
        first_order_id: group.orders[0].id,
        first_order_number: group.orders[0].order_number,
        action: 'create', // default, will be reclassified
      };

      // Multi-module guard
      if (group.is_multi_module) {
        item.action = 'skip_multi_module';
        item.review_reason = 'order has module_list_mapped.length > 1';
        results.push(item);
        continue;
      }

      // Check existing entitlements for this user + product_id
      const { data: existingEnts } = await supabase
        .from('entitlements')
        .select('id, status, expires_at, meta, product_code')
        .eq('user_id', group.user_id)
        .eq('product_id', group.module_product_id);

      const ents = existingEnts || [];

      // STOP-guard: >1 entitlement for same (user_id, product_id) → manual_review
      if (ents.length > 1) {
        item.action = 'manual_review';
        item.review_reason = `${ents.length} duplicate entitlements exist for same user+product`;
        results.push(item);
        continue;
      }

      if (ents.length === 1) {
        const ent = ents[0];
        item.entitlement_id = ent.id;

        if (ent.status === 'active') {
          item.action = 'skip_active';
          results.push(item);
          continue;
        }

        // Dangerous statuses → manual_review, no auto-reactivate
        if (DANGEROUS_STATUSES.includes(ent.status)) {
          item.action = 'manual_review';
          item.review_reason = `entitlement has status '${ent.status}' — cannot auto-reactivate`;
          results.push(item);
          continue;
        }

        // Expired/inactive → reactivate
        item.action = 'reactivate';
      } else {
        item.action = 'create';
      }

      // ── Execute if not dry_run ──
      if (mode === 'execute') {
        const meta = {
          source_type: 'historical_module_repair',
          source_order_id: item.first_order_id,
          source_order_number: item.first_order_number,
          repair_batch_id: batchId,
          repaired_at: new Date().toISOString(),
        };

        if (item.action === 'create') {
          const { data: inserted, error: insertErr } = await supabase
            .from('entitlements')
            .insert({
              user_id: group.user_id,
              profile_id: group.profile_id,
              product_id: group.module_product_id,
              product_code: prodInfo.code,
              status: 'active',
              expires_at: null, // Policy: historical standalone modules have no tariff/access_days — NULL confirmed by data audit (all 127 orders have tariff_id=NULL)
              order_id: item.first_order_id,
              meta,
            })
            .select('id')
            .single();

          if (insertErr) {
            item.action = 'manual_review';
            item.review_reason = `insert failed: ${insertErr.message}`;
            results.push(item);
            continue;
          }

          item.entitlement_id = inserted.id;
          executeCount++;

          // Audit
          await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'repair-module-entitlements',
            action: 'entitlement.historical_module_repair',
            target_user_id: group.user_id,
            meta: {
              entitlement_id: inserted.id,
              module_product_id: group.module_product_id,
              product_code: prodInfo.code,
              sync_action: 'created',
              source_order_id: item.first_order_id,
              source_order_number: item.first_order_number,
              batch_id: batchId,
            },
          });

        } else if (item.action === 'reactivate') {
          const ent = ents[0];
          // Merge meta, preserve existing expires_at
          const existingMeta = (ent.meta as Record<string, unknown>) || {};
          const mergedMeta = { ...existingMeta, ...meta };

          const { error: updateErr } = await supabase
            .from('entitlements')
            .update({
              status: 'active',
              meta: mergedMeta,
              updated_at: new Date().toISOString(),
              // Do NOT change expires_at — preserve existing value
            })
            .eq('id', ent.id);

          if (updateErr) {
            item.action = 'manual_review';
            item.review_reason = `reactivate failed: ${updateErr.message}`;
            results.push(item);
            continue;
          }

          executeCount++;

          // Audit
          await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'repair-module-entitlements',
            action: 'entitlement.historical_module_repair',
            target_user_id: group.user_id,
            meta: {
              entitlement_id: ent.id,
              module_product_id: group.module_product_id,
              product_code: prodInfo.code,
              sync_action: 'reactivated',
              previous_status: ent.status,
              previous_expires_at: ent.expires_at,
              source_order_id: item.first_order_id,
              source_order_number: item.first_order_number,
              batch_id: batchId,
            },
          });
        }
      }

      results.push(item);
    }

    // ── Summary ──
    const summary = {
      mode,
      batch_id: batchId,
      filter_user_id: filterUserId || null,
      total_orders_scanned: moduleOrders.length,
      distinct_pairs: results.length,
      actions: {
        skip_active: results.filter(r => r.action === 'skip_active').length,
        reactivate: results.filter(r => r.action === 'reactivate').length,
        create: results.filter(r => r.action === 'create').length,
        manual_review: results.filter(r => r.action === 'manual_review').length,
        skip_multi_module: results.filter(r => r.action === 'skip_multi_module').length,
      },
      executed_changes: mode === 'execute' ? executeCount : 'N/A (dry_run)',
      items: results,
    };

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err) {
    console.error('[repair-module-entitlements] Error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
