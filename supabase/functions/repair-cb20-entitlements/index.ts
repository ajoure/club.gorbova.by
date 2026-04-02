import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// BUSINESS tariff and cb20 product IDs (canonical)
const BUSINESS_TARIFF_ID = '7c748940-dcad-4c7c-a92e-76a2344622d3';
const CB20_PRODUCT_ID = '7101ed3c-7839-4a74-ad95-aa0660369b22';

// Staff emails — separate bucket, not mixed with manual_review
const STAFF_EMAILS = [
  'a.bruylo@ajoure.by',
  'nrokhmistrov@gmail.com',
  'ceo@ajoure.by',
  'irenessa@yandex.ru',
];

type ActionBucket = 'create' | 'align_to_business' | 'repair_metadata_only' | 'repair_metadata_and_align' | 'noop' | 'manual_review' | 'staff_skip';
type ScopeBucket = 'full_tariff_scope' | 'module_scope_only' | 'union_scope' | 'no_scope' | 'manual_review';

interface RepairPlan {
  profile_id: string;
  user_id: string;
  email: string | null;
  business_subscription_id: string | null;
  business_access_end_at: string | null;
  historical_class: string;
  historical_tariff_id: string | null;
  historical_module_product_ids: string[];
  current_entitlement_id: string | null;
  current_entitlement_expires_at: string | null;
  current_meta_status: 'has_meta' | 'no_meta';
  planned_action: ActionBucket;
  scope_bucket: ScopeBucket;
  reason: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const dryRun = body.dry_run !== false; // default = dry_run
    const batchId = `batch_business_cb20_repair_v1_${Date.now()}`;

    console.log(`[repair-cb20] Starting ${dryRun ? 'DRY RUN' : 'EXECUTE'}, batchId=${batchId}`);

    // 1. Get all active BUSINESS subscribers
    const { data: businessSubs, error: subErr } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, status, access_end_at, tariff_id')
      .eq('tariff_id', BUSINESS_TARIFF_ID)
      .in('status', ['active', 'past_due'])
      .order('access_end_at', { ascending: false });

    if (subErr) throw subErr;

    // Deduplicate by user_id — take MAX access_end_at
    const userBusinessMap = new Map<string, { sub_id: string; access_end_at: string | null }>();
    for (const sub of (businessSubs || [])) {
      const existing = userBusinessMap.get(sub.user_id);
      if (!existing || (sub.access_end_at && (!existing.access_end_at || new Date(sub.access_end_at) > new Date(existing.access_end_at)))) {
        userBusinessMap.set(sub.user_id, { sub_id: sub.id, access_end_at: sub.access_end_at });
      }
    }

    const businessUserIds = [...userBusinessMap.keys()];
    console.log(`[repair-cb20] Found ${businessUserIds.length} active BUSINESS users`);

    // 2. Get profiles for staff filtering
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email')
      .in('id', businessUserIds);

    const profileEmailMap = new Map<string, string>();
    (profiles || []).forEach(p => {
      if (p.email) profileEmailMap.set(p.id, p.email);
    });

    // 3. Get existing cb20 entitlements
    const { data: existingEnts } = await supabase
      .from('entitlements')
      .select('id, user_id, product_code, product_id, expires_at, meta, order_id')
      .eq('product_id', CB20_PRODUCT_ID)
      .in('user_id', businessUserIds);

    const entByUser = new Map<string, typeof existingEnts extends (infer T)[] | null ? T : never>();
    (existingEnts || []).forEach(e => entByUser.set(e.user_id, e));

    // 4. Get historical cb20 purchases for all BUSINESS users
    // Use both profile_id and user_id join paths
    const { data: historicalOrders } = await supabase
      .from('orders_v2')
      .select('profile_id, user_id, tariff_id, product_id, purchase_snapshot, status')
      .eq('product_id', CB20_PRODUCT_ID)
      .eq('status', 'paid')
      .in('profile_id', businessUserIds)
      .order('created_at', { ascending: false });

    const { data: historicalOrdersByUser } = await supabase
      .from('orders_v2')
      .select('profile_id, user_id, tariff_id, product_id, purchase_snapshot, status')
      .eq('product_id', CB20_PRODUCT_ID)
      .eq('status', 'paid')
      .in('user_id', businessUserIds)
      .order('created_at', { ascending: false });

    // Merge and deduplicate
    const allOrders = [...(historicalOrders || []), ...(historicalOrdersByUser || [])];
    const seenOrderKeys = new Set<string>();
    const uniqueOrders = allOrders.filter(o => {
      const key = `${o.profile_id}:${o.user_id}:${o.tariff_id || 'null'}`;
      if (seenOrderKeys.has(key)) return false;
      seenOrderKeys.add(key);
      return true;
    });

    // Map orders by user_id
    const ordersByUser = new Map<string, typeof uniqueOrders>();
    uniqueOrders.forEach(o => {
      const uid = businessUserIds.includes(o.profile_id) ? o.profile_id : o.user_id;
      if (!uid) return;
      const existing = ordersByUser.get(uid) || [];
      existing.push(o);
      ordersByUser.set(uid, existing);
    });

    // 5. Build repair plan for each BUSINESS user
    const plans: RepairPlan[] = [];

    for (const userId of businessUserIds) {
      const email = profileEmailMap.get(userId) || null;
      const businessInfo = userBusinessMap.get(userId)!;
      const ent = entByUser.get(userId);
      const orders = ordersByUser.get(userId) || [];

      // Staff skip — separate bucket, NOT mixed with manual_review
      if (email && STAFF_EMAILS.some(s => email.toLowerCase() === s.toLowerCase())) {
        plans.push({
          profile_id: userId, user_id: userId, email,
          business_subscription_id: businessInfo.sub_id,
          business_access_end_at: businessInfo.access_end_at,
          historical_class: 'staff_skip',
          historical_tariff_id: null,
          historical_module_product_ids: [],
          current_entitlement_id: ent?.id || null,
          current_entitlement_expires_at: ent?.expires_at || null,
          current_meta_status: ent?.meta && (ent.meta as any).scope_resolution_mode ? 'has_meta' : 'no_meta',
          planned_action: 'staff_skip',
          scope_bucket: 'manual_review',
          reason: 'Staff account — skipped (separate from manual_review)',
        });
        continue;
      }

      // Classify historical purchase
      let historicalClass = 'no_cb_purchase';
      let scopeBucket: ScopeBucket = 'no_scope';
      let historicalBasisProductIds: string[] = [];
      let historicalTariffId: string | null = null;

      if (orders.length > 0) {
        const hasBaseTariff = orders.some(o => o.tariff_id != null);
        // Collect module_list_mapped from ALL orders for this user
        const allModuleIds = new Set<string>();
        for (const order of orders) {
          const snapshot = (order.purchase_snapshot || {}) as Record<string, any>;
          const moduleList = Array.isArray(snapshot.module_list_mapped) ? snapshot.module_list_mapped : [];
          moduleList.forEach((id: string) => allModuleIds.add(id));
        }
        const moduleList = [...allModuleIds];

        if (hasBaseTariff && moduleList.length > 0) {
          historicalClass = 'base_tariff_plus_standalone';
          scopeBucket = 'union_scope';
          historicalBasisProductIds = moduleList;
          historicalTariffId = orders.find(o => o.tariff_id)?.tariff_id || null;
        } else if (hasBaseTariff) {
          historicalClass = 'base_tariff_purchase';
          scopeBucket = 'full_tariff_scope';
          historicalTariffId = orders.find(o => o.tariff_id)?.tariff_id || null;
        } else if (moduleList.length > 0) {
          historicalClass = 'module_only_standalone';
          scopeBucket = 'module_scope_only';
          historicalBasisProductIds = moduleList;
        } else {
          historicalClass = 'unclassified';
          scopeBucket = 'manual_review';
        }
      }

      // Determine action
      let action: ActionBucket;
      let reason: string;
      const metaStatus: 'has_meta' | 'no_meta' = ent?.meta && (ent.meta as any).scope_resolution_mode ? 'has_meta' : 'no_meta';

      // STOP-guard: business_access_end_at IS NULL → only manual_review
      if (!businessInfo.access_end_at) {
        plans.push({
          profile_id: userId, user_id: userId, email,
          business_subscription_id: businessInfo.sub_id,
          business_access_end_at: null,
          historical_class: historicalClass,
          historical_tariff_id: historicalTariffId,
          historical_module_product_ids: historicalBasisProductIds,
          current_entitlement_id: ent?.id || null,
          current_entitlement_expires_at: ent?.expires_at || null,
          current_meta_status: metaStatus,
          planned_action: 'manual_review',
          scope_bucket: scopeBucket,
          reason: 'STOP-guard: business_access_end_at IS NULL',
        });
        continue;
      }

      // STOP-guard: historical_class = unclassified → only manual_review
      if (historicalClass === 'unclassified') {
        plans.push({
          profile_id: userId, user_id: userId, email,
          business_subscription_id: businessInfo.sub_id,
          business_access_end_at: businessInfo.access_end_at,
          historical_class: historicalClass,
          historical_tariff_id: historicalTariffId,
          historical_module_product_ids: historicalBasisProductIds,
          current_entitlement_id: ent?.id || null,
          current_entitlement_expires_at: ent?.expires_at || null,
          current_meta_status: metaStatus,
          planned_action: 'manual_review',
          scope_bucket: scopeBucket,
          reason: 'STOP-guard: historical_class = unclassified',
        });
        continue;
      }

      // STOP-guard: scope_bucket = manual_review → execute forbidden
      if (scopeBucket === 'manual_review') {
        plans.push({
          profile_id: userId, user_id: userId, email,
          business_subscription_id: businessInfo.sub_id,
          business_access_end_at: businessInfo.access_end_at,
          historical_class: historicalClass,
          historical_tariff_id: historicalTariffId,
          historical_module_product_ids: historicalBasisProductIds,
          current_entitlement_id: ent?.id || null,
          current_entitlement_expires_at: ent?.expires_at || null,
          current_meta_status: metaStatus,
          planned_action: 'manual_review',
          scope_bucket: 'manual_review',
          reason: 'STOP-guard: scope_bucket = manual_review',
        });
        continue;
      }

      if (!ent) {
        // No entitlement exists
        if (historicalClass === 'no_cb_purchase') {
          action = 'noop';
          reason = 'No cb20 purchase history, no entitlement to create';
        } else {
          action = 'create';
          reason = `Historical class: ${historicalClass}, creating new entitlement`;
        }
      } else if (metaStatus === 'has_meta') {
        // Has meta — check alignment
        const expiresMatch = ent.expires_at === businessInfo.access_end_at;
        if (expiresMatch) {
          action = 'noop';
          reason = 'Meta present, expires aligned';
        } else {
          action = 'align_to_business';
          reason = `Meta present but expires mismatch: ${ent.expires_at} vs ${businessInfo.access_end_at}`;
        }
      } else {
        // No meta — MUST repair (even if expires happens to match)
        // entitlement without mandatory meta cannot be noop
        const expiresMatch = ent.expires_at === businessInfo.access_end_at;
        if (expiresMatch) {
          action = 'repair_metadata_only';
          reason = `Missing mandatory meta (scope_resolution_mode), expires happen to match — still must repair meta`;
        } else {
          action = 'repair_metadata_and_align';
          reason = `Missing mandatory meta AND expires mismatch: ${ent.expires_at} vs ${businessInfo.access_end_at}`;
        }
      }

      plans.push({
        profile_id: userId, user_id: userId, email,
        business_subscription_id: businessInfo.sub_id,
        business_access_end_at: businessInfo.access_end_at,
        historical_class: historicalClass,
        historical_tariff_id: historicalTariffId,
        historical_module_product_ids: historicalBasisProductIds,
        current_entitlement_id: ent?.id || null,
        current_entitlement_expires_at: ent?.expires_at || null,
        current_meta_status: metaStatus,
        planned_action: action,
        scope_bucket: scopeBucket,
        reason,
      });
    }

    // 6. Build matrix summary (action × scope)
    const actionBuckets: ActionBucket[] = ['create', 'align_to_business', 'repair_metadata_only', 'repair_metadata_and_align', 'noop', 'manual_review', 'staff_skip'];
    const scopeBuckets: ScopeBucket[] = ['full_tariff_scope', 'module_scope_only', 'union_scope', 'no_scope', 'manual_review'];
    
    const matrix: Record<string, Record<string, number>> = {};
    for (const a of actionBuckets) {
      matrix[a] = {};
      for (const s of scopeBuckets) {
        matrix[a][s] = plans.filter(p => p.planned_action === a && p.scope_bucket === s).length;
      }
    }

    // 7. Execute if not dry_run
    const executeResults: Array<{ user_id: string; email: string | null; action: string; result: string; error: string | null }> = [];
    if (!dryRun) {
      const executablePlans = plans.filter(p => 
        p.planned_action !== 'noop' && 
        p.planned_action !== 'manual_review' &&
        p.planned_action !== 'staff_skip'
      );

      console.log(`[repair-cb20] Executing ${executablePlans.length} repairs`);

      for (const plan of executablePlans) {
        const enrichedMeta = {
          source_rule_id: '1b497fba-031a-4318-8d9f-2530f1bac116',
          business_subscription_id: plan.business_subscription_id,
          business_tariff_id: BUSINESS_TARIFF_ID,
          source_access_end_at: plan.business_access_end_at,
          historical_purchase_type: plan.historical_class,
          historical_tariff_id: plan.historical_tariff_id,
          historical_module_product_ids: plan.historical_module_product_ids,
          scope_resolution_mode: plan.scope_bucket,
          source_window_rule: 'align_with_source',
          repaired_by: batchId,
          repaired_at: new Date().toISOString(),
        };

        try {
          if (plan.planned_action === 'create') {
            const { error } = await supabase.from('entitlements').insert({
              user_id: plan.user_id,
              product_code: 'cb20',
              product_id: CB20_PRODUCT_ID,
              profile_id: plan.profile_id,
              status: 'active',
              expires_at: plan.business_access_end_at,
              meta: enrichedMeta,
            });
            executeResults.push({ user_id: plan.user_id, email: plan.email, action: 'created', result: error ? 'error' : 'success', error: error?.message || null });
          } else if (plan.current_entitlement_id) {
            const updateData: Record<string, any> = {
              meta: enrichedMeta,
              updated_at: new Date().toISOString(),
            };
            if (plan.planned_action !== 'repair_metadata_only') {
              updateData.expires_at = plan.business_access_end_at;
            }
            const { error } = await supabase
              .from('entitlements')
              .update(updateData)
              .eq('id', plan.current_entitlement_id);
            executeResults.push({ user_id: plan.user_id, email: plan.email, action: plan.planned_action, result: error ? 'error' : 'success', error: error?.message || null });
          }
        } catch (err) {
          executeResults.push({ user_id: plan.user_id, email: plan.email, action: plan.planned_action, result: 'exception', error: String(err) });
        }
      }

      // Audit log — canonical actor standard
      await supabase.from('audit_logs').insert({
        action: 'batch.repair_cb20_entitlements',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'batch_business_cb20_repair_v1',
        meta: {
          batch_id: batchId,
          total_business_users: businessUserIds.length,
          executed: executablePlans.length,
          results_summary: {
            created: executeResults.filter(r => r.action === 'created' && r.result === 'success').length,
            aligned: executeResults.filter(r => r.action === 'align_to_business' && r.result === 'success').length,
            repaired: executeResults.filter(r => (r.action === 'repair_metadata_only' || r.action === 'repair_metadata_and_align') && r.result === 'success').length,
            skipped_manual_review: plans.filter(p => p.planned_action === 'manual_review').length,
            skipped_staff: plans.filter(p => p.planned_action === 'staff_skip').length,
            skipped_noop: plans.filter(p => p.planned_action === 'noop').length,
            errors: executeResults.filter(r => r.result !== 'success').length,
          },
          matrix,
        },
      });
    }

    // 8. Post-check (after execute)
    let postCheck: any = null;
    if (!dryRun) {
      const { data: postEnts } = await supabase
        .from('entitlements')
        .select('id, user_id, expires_at, meta')
        .eq('product_id', CB20_PRODUCT_ID)
        .in('user_id', businessUserIds);

      const allPostEnts = postEnts || [];
      const hasMeta = allPostEnts.filter(e => e.meta && (e.meta as any).scope_resolution_mode);
      const noMeta = allPostEnts.filter(e => !e.meta || !(e.meta as any).scope_resolution_mode);
      const standaloneWithFull = allPostEnts.filter(e => {
        const m = (e.meta || {}) as any;
        return m.historical_purchase_type === 'module_only_standalone' && m.scope_resolution_mode === 'full_tariff_scope';
      });
      const standaloneWithModule = allPostEnts.filter(e => {
        const m = (e.meta || {}) as any;
        return m.historical_purchase_type === 'module_only_standalone' && m.scope_resolution_mode === 'module_scope_only';
      });

      // Non-manual-review plans that were executed — check for expires mismatch
      const executedUserIds = new Set(plans.filter(p => 
        p.planned_action !== 'noop' && 
        p.planned_action !== 'manual_review' && 
        p.planned_action !== 'staff_skip'
      ).map(p => p.user_id));

      const expiresMismatchRemaining = allPostEnts.filter(e => {
        if (!executedUserIds.has(e.user_id)) return false; // only check executed
        const biz = userBusinessMap.get(e.user_id);
        return biz && biz.access_end_at && e.expires_at !== biz.access_end_at;
      }).length;

      postCheck = {
        business_users_total: businessUserIds.length,
        cb20_bonus_entitlements_total: allPostEnts.length,
        normalized_meta_total: hasMeta.length,
        expires_mismatch_remaining: expiresMismatchRemaining,
        manual_review_remaining: plans.filter(p => p.planned_action === 'manual_review').length,
        standalone_only_with_module_scope_only: standaloneWithModule.length,
        standalone_only_with_full_scope: standaloneWithFull.length, // MUST BE 0
        no_meta_remaining: noMeta.length,
        // Critical assertions
        assertions: {
          standalone_full_scope_is_zero: standaloneWithFull.length === 0,
          expires_mismatch_for_executed_is_zero: expiresMismatchRemaining === 0,
        },
      };
    }

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        batch_id: batchId,
        business_users_total: businessUserIds.length,
        plans: dryRun ? plans : undefined,
        matrix,
        execute_results: dryRun ? undefined : executeResults,
        post_check: postCheck,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[repair-cb20] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
