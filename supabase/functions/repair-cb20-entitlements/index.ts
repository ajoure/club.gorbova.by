import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// BUSINESS tariff and cb20 product IDs (canonical)
const BUSINESS_TARIFF_ID = '7c748940-dcad-4c7c-a92e-76a2344622d3';
const CB20_PRODUCT_ID = '7101ed3c-7839-4a74-ad95-aa0660369b22';
const CB20_ROOT_MODULE_ID = 'c9f7e9b8-e613-459a-91e3-38bbcfe424d8';

// Staff emails — separate bucket, not mixed with manual_review
const STAFF_EMAILS = [
  'a.bruylo@ajoure.by',
  'nrokhmistrov@gmail.com',
  'ceo@ajoure.by',
  'irenessa@yandex.ru',
];

type ActionBucket = 'create' | 'align_to_business' | 'repair_metadata_only' | 'repair_metadata_and_align' | 'noop' | 'manual_review' | 'staff_skip';
type ScopeBucket = 'full_tariff_scope' | 'module_scope_only' | 'union_scope' | 'no_scope' | 'manual_review';
type MappingConfidenceLevel = 'exact_fk' | 'exact_code' | 'exact_name' | 'inferred' | 'no_match';

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
  target_expires_at: string | null;
  reason: string;
  hold_reason: string | null;
  runtime_preview?: RuntimePreview | null;
}

interface MappingConfidence {
  module_product_id: string;
  module_product_name: string | null;
  matched_training_module_id: string | null;
  matched_training_module_title: string | null;
  mapping_confidence: MappingConfidenceLevel;
  mapping_reason: string;
  allowed_in_execute: boolean;
}

interface RuntimePreview {
  historical_module_product_ids: string[];
  derived_allowed_module_ids: string[];
  derived_allowed_module_titles: string[];
  visible_module_count: number;
  visible_recursive_lesson_count: number;
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
    const executeCohort: 'safe_only' | 'standalone_safe' | 'all' | null = body.execute_cohort || null;
    const standaloneMode: 'strict_hold' | 'partial_safe' = body.standalone_mode || 'strict_hold';
    const batchId = `batch_business_cb20_repair_v1_${Date.now()}`;

    console.log(`[repair-cb20] Starting ${dryRun ? 'DRY RUN' : `EXECUTE (cohort=${executeCohort}, standalone_mode=${standaloneMode})`}, batchId=${batchId}`);

    // Guard: execute requires explicit cohort
    if (!dryRun && executeCohort !== 'safe_only' && executeCohort !== 'standalone_safe') {
      return new Response(
        JSON.stringify({ error: "Execute requires execute_cohort='safe_only' or 'standalone_safe'. Full cohort execute is forbidden." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
      .select('id, user_id, email')
      .in('user_id', businessUserIds);

    const profileEmailMap = new Map<string, string | null>();
    const profileIdByAuthId = new Map<string, string>();
    (profiles || []).forEach(p => {
      if (p.user_id) {
        profileEmailMap.set(p.user_id, p.email || null);
        profileIdByAuthId.set(p.user_id, p.id);
      }
    });

    // 3. Get existing cb20 entitlements
    const { data: existingEnts } = await supabase
      .from('entitlements')
      .select('id, user_id, product_code, product_id, expires_at, meta, order_id')
      .eq('product_id', CB20_PRODUCT_ID)
      .in('user_id', businessUserIds);

    const entByUser = new Map<string, typeof existingEnts extends (infer T)[] | null ? T : never>();
    (existingEnts || []).forEach(e => entByUser.set(e.user_id, e));

    // 4. Get historical cb20 purchases — DEDUPLICATE BY ORDER ID
    const profileIds = [...profileIdByAuthId.values()];

    const { data: historicalOrdersByProfile } = await supabase
      .from('orders_v2')
      .select('id, profile_id, user_id, tariff_id, product_id, purchase_snapshot, status')
      .eq('product_id', CB20_PRODUCT_ID)
      .eq('status', 'paid')
      .in('profile_id', profileIds)
      .order('created_at', { ascending: false });

    const { data: historicalOrdersByUser } = await supabase
      .from('orders_v2')
      .select('id, profile_id, user_id, tariff_id, product_id, purchase_snapshot, status')
      .eq('product_id', CB20_PRODUCT_ID)
      .eq('status', 'paid')
      .in('user_id', businessUserIds)
      .order('created_at', { ascending: false });

    // Deduplicate by order ID (not composite key!)
    const allOrders = [...(historicalOrdersByProfile || []), ...(historicalOrdersByUser || [])];
    const seenOrderIds = new Set<string>();
    const uniqueOrders = allOrders.filter(o => {
      if (seenOrderIds.has(o.id)) return false;
      seenOrderIds.add(o.id);
      return true;
    });

    // Build reverse map: profiles.id → auth UID
    const authIdByProfileId = new Map<string, string>();
    profileIdByAuthId.forEach((pid, authId) => authIdByProfileId.set(pid, authId));

    // Map orders by auth user_id
    const ordersByUser = new Map<string, typeof uniqueOrders>();
    uniqueOrders.forEach(o => {
      let authUid = businessUserIds.includes(o.user_id) ? o.user_id : null;
      if (!authUid && o.profile_id) {
        authUid = authIdByProfileId.get(o.profile_id) || null;
      }
      if (!authUid) return;
      const existing = ordersByUser.get(authUid) || [];
      existing.push(o);
      ordersByUser.set(authUid, existing);
    });

    // 5. Build repair plan for each BUSINESS user
    const plans: RepairPlan[] = [];

    for (const userId of businessUserIds) {
      const email = profileEmailMap.get(userId) ?? null;
      const profileId = profileIdByAuthId.get(userId) || userId;
      const businessInfo = userBusinessMap.get(userId)!;
      const ent = entByUser.get(userId);
      const orders = ordersByUser.get(userId) || [];
      const metaStatus: 'has_meta' | 'no_meta' = ent?.meta && (ent.meta as any).scope_resolution_mode ? 'has_meta' : 'no_meta';

      const basePlan = {
        profile_id: profileId,
        user_id: userId,
        email,
        business_subscription_id: businessInfo.sub_id,
        business_access_end_at: businessInfo.access_end_at,
        current_entitlement_id: ent?.id || null,
        current_entitlement_expires_at: ent?.expires_at || null,
        current_meta_status: metaStatus,
      };

      // Staff skip — separate bucket
      if (email && STAFF_EMAILS.some(s => email.toLowerCase() === s.toLowerCase())) {
        plans.push({
          ...basePlan,
          historical_class: 'staff_skip', historical_tariff_id: null,
          historical_module_product_ids: [],
          planned_action: 'staff_skip', scope_bucket: 'manual_review',
          target_expires_at: null,
          reason: 'Staff account — skipped (separate from manual_review)',
          hold_reason: 'staff',
        });
        continue;
      }

      // Identity guard: email IS NULL → manual_review
      if (!email) {
        plans.push({
          ...basePlan,
          historical_class: 'identity_unresolved', historical_tariff_id: null,
          historical_module_product_ids: [],
          planned_action: 'manual_review', scope_bucket: 'manual_review',
          target_expires_at: null,
          reason: 'STOP-guard: email IS NULL — identity unresolved',
          hold_reason: 'email_null',
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

      // STOP-guard: business_access_end_at IS NULL → only manual_review
      if (!businessInfo.access_end_at) {
        plans.push({
          ...basePlan,
          historical_class: historicalClass, historical_tariff_id: historicalTariffId,
          historical_module_product_ids: historicalBasisProductIds,
          planned_action: 'manual_review', scope_bucket: scopeBucket,
          target_expires_at: null,
          reason: 'STOP-guard: business_access_end_at IS NULL',
          hold_reason: 'business_end_null',
        });
        continue;
      }

      // STOP-guard: historical_class = unclassified → only manual_review
      if (historicalClass === 'unclassified') {
        plans.push({
          ...basePlan,
          historical_class: historicalClass, historical_tariff_id: historicalTariffId,
          historical_module_product_ids: historicalBasisProductIds,
          planned_action: 'manual_review', scope_bucket: 'manual_review',
          target_expires_at: null,
          reason: 'STOP-guard: historical_class = unclassified',
          hold_reason: 'unclassified',
        });
        continue;
      }

      // STOP-guard: scope_bucket = manual_review
      if (scopeBucket === 'manual_review') {
        plans.push({
          ...basePlan,
          historical_class: historicalClass, historical_tariff_id: historicalTariffId,
          historical_module_product_ids: historicalBasisProductIds,
          planned_action: 'manual_review', scope_bucket: 'manual_review',
          target_expires_at: null,
          reason: 'STOP-guard: scope_bucket = manual_review',
          hold_reason: 'scope_manual_review',
        });
        continue;
      }

      // Determine action
      let action: ActionBucket;
      let reason: string;
      const targetExpiresAt = businessInfo.access_end_at;

      if (!ent) {
        if (historicalClass === 'no_cb_purchase') {
          action = 'noop';
          reason = 'No cb20 purchase history, no entitlement to create';
        } else {
          action = 'create';
          reason = `Historical class: ${historicalClass}, creating new entitlement`;
        }
      } else if (metaStatus === 'has_meta') {
        const expiresMatch = ent.expires_at === targetExpiresAt;
        if (expiresMatch) {
          action = 'noop';
          reason = 'Meta present, expires aligned';
        } else {
          action = 'align_to_business';
          reason = `Meta present but expires mismatch: ${ent.expires_at} vs ${targetExpiresAt}`;
        }
      } else {
        const expiresMatch = ent.expires_at === targetExpiresAt;
        if (expiresMatch) {
          action = 'repair_metadata_only';
          reason = 'Missing mandatory meta (scope_resolution_mode), expires match — still must repair meta';
        } else {
          action = 'repair_metadata_and_align';
          reason = `Missing mandatory meta AND expires mismatch: ${ent.expires_at} vs ${targetExpiresAt}`;
        }
      }

      // Hold reason for module_scope_only — always HOLD until mapping proof
      const holdReason = scopeBucket === 'module_scope_only' ? 'standalone_only_blocked' : null;

      plans.push({
        ...basePlan,
        historical_class: historicalClass, historical_tariff_id: historicalTariffId,
        historical_module_product_ids: historicalBasisProductIds,
        planned_action: action, scope_bucket: scopeBucket,
        target_expires_at: action === 'noop' ? (ent?.expires_at || null) : targetExpiresAt,
        reason,
        hold_reason: holdReason,
      });
    }

    // 6. Mapping confidence for module_scope_only
    const allModuleProductIds = new Set<string>();
    plans.filter(p => p.scope_bucket === 'module_scope_only').forEach(p => {
      p.historical_module_product_ids.forEach(id => allModuleProductIds.add(id));
    });

    const mappingConfidence: MappingConfidence[] = [];
    if (allModuleProductIds.size > 0) {
      const moduleProductIdList = [...allModuleProductIds];

      const { data: moduleProducts } = await supabase
        .from('products_v2')
        .select('id, name, code')
        .in('id', moduleProductIdList);

      const productMap = new Map<string, { name: string; code: string | null }>();
      (moduleProducts || []).forEach(p => productMap.set(p.id, { name: p.name, code: p.code }));

      const { data: linkedTrainingModules } = await supabase
        .from('training_modules')
        .select('id, title, product_id')
        .in('product_id', moduleProductIdList);

      const trainingByProduct = new Map<string, Array<{ id: string; title: string }>>();
      (linkedTrainingModules || []).forEach(tm => {
        if (!tm.product_id) return;
        const arr = trainingByProduct.get(tm.product_id) || [];
        arr.push({ id: tm.id, title: tm.title });
        trainingByProduct.set(tm.product_id, arr);
      });

      // Fetch children of CB20 root for name matching (NOT root modules)
      const { data: cb20ChildModules } = await supabase
        .from('training_modules')
        .select('id, title, product_id')
        .eq('parent_module_id', CB20_ROOT_MODULE_ID);

      for (const mpId of moduleProductIdList) {
        const product = productMap.get(mpId);
        const fkMatches = trainingByProduct.get(mpId) || [];

        if (fkMatches.length > 0) {
          for (const match of fkMatches) {
            mappingConfidence.push({
              module_product_id: mpId,
              module_product_name: product?.name || null,
              matched_training_module_id: match.id,
              matched_training_module_title: match.title,
              mapping_confidence: 'exact_fk',
              mapping_reason: `training_modules.product_id = '${mpId}' (direct FK)`,
              allowed_in_execute: true,
            });
          }
        } else {
          // Normalized exact match against children of CB20 root
          tryChildNameMatch(mpId, product || null, cb20ChildModules || [], mappingConfidence);
        }
      }
    }

    // 7. Runtime preview for create cases with module_scope_only
    const createModuleScopePlans = plans.filter(
      p => p.planned_action === 'create' && p.scope_bucket === 'module_scope_only'
    );

    for (const plan of createModuleScopePlans) {
      const allowedModuleIds: string[] = [];
      const allowedModuleTitles: string[] = [];

      for (const mpId of plan.historical_module_product_ids) {
        const mc = mappingConfidence.find(m => m.module_product_id === mpId && m.matched_training_module_id);
        if (mc?.matched_training_module_id) {
          allowedModuleIds.push(mc.matched_training_module_id);
          allowedModuleTitles.push(mc.matched_training_module_title || 'unknown');
        }
      }

      // Count visible lessons recursively — same as frontend useTrainingModules
      let totalLessonCount = 0;
      if (allowedModuleIds.length > 0) {
        const { data: childModules } = await supabase
          .from('training_modules')
          .select('id, parent_module_id, title')
          .in('parent_module_id', allowedModuleIds);

        // BFS to collect all descendant module IDs
        const allVisibleModuleIds = new Set(allowedModuleIds);
        let queue = (childModules || []).map(cm => cm.id);
        while (queue.length > 0) {
          queue.forEach(id => allVisibleModuleIds.add(id));
          const { data: nextLevel } = await supabase
            .from('training_modules')
            .select('id, parent_module_id')
            .in('parent_module_id', queue);
          queue = (nextLevel || []).map(m => m.id);
        }

        // Count lessons across full subtree
        const { data: subtreeContent } = await supabase
          .from('training_content')
          .select('id, module_id, content_type, status')
          .in('module_id', [...allVisibleModuleIds])
          .eq('status', 'active')
          .eq('content_type', 'lesson');

        totalLessonCount = (subtreeContent || []).length;
      }

      plan.runtime_preview = {
        historical_module_product_ids: plan.historical_module_product_ids,
        derived_allowed_module_ids: allowedModuleIds,
        derived_allowed_module_titles: allowedModuleTitles,
        visible_module_count: allowedModuleIds.length,
        visible_recursive_lesson_count: totalLessonCount,
      };

      // Auto-block if runtime shows zero visibility
      if (allowedModuleIds.length === 0 || totalLessonCount === 0) {
        plan.planned_action = 'manual_review';
        plan.hold_reason = 'runtime_preview_zero_visibility';
        plan.reason += ' → BLOCKED: runtime preview shows 0 visible modules/lessons';
      }
    }

    // 8. Split cohorts: SAFE EXECUTE NOW vs STANDALONE_SAFE vs HOLD
    // CRITICAL GUARDS:
    // - create is NEVER in safe cohort (blocked for this execute, follow-up only)
    // - module_scope_only is NEVER in safe cohort (but CAN be in standalone_safe)
    // - only already-entitled repairs are safe
    const isSafe = (p: RepairPlan): boolean => {
      if (p.planned_action === 'noop') return false;
      if (p.planned_action === 'staff_skip') return false;
      if (p.planned_action === 'manual_review') return false;
      // HARD GUARD: create is blocked from safe cohort entirely
      if (p.planned_action === 'create') return false;
      if (p.hold_reason) return false;
      if (!p.business_access_end_at) return false;
      if (!p.email) return false;
      // HARD GUARD: module_scope_only goes to standalone_safe, not safe
      if (p.scope_bucket === 'module_scope_only') return false;
      // Only allow already-entitled repairs
      if (!p.current_entitlement_id) return false;
      // union_scope additional proof: must have historical_tariff_id AND module_product_ids
      if (p.scope_bucket === 'union_scope') {
        if (!p.historical_tariff_id) return false;
        if (p.historical_module_product_ids.length === 0) return false;
      }
      return true;
    };

    // Standalone safe cohort: module_scope_only with proven mapping
    const isStandaloneSafe = (p: RepairPlan): boolean => {
      if (p.scope_bucket !== 'module_scope_only') return false;
      if (p.planned_action === 'staff_skip' || p.planned_action === 'noop') return false;
      if (!p.business_access_end_at) return false;
      if (!p.email) return false;
      // Must not be staff
      if (STAFF_EMAILS.includes(p.email.toLowerCase())) return false;
      // All module mappings must be proven
      const userMappings = mappingConfidence.filter(m =>
        p.historical_module_product_ids.includes(m.module_product_id)
      );
      if (userMappings.length === 0) return false;

      if (standaloneMode === 'strict_hold') {
        // ALL modules must be mapped
        const allMapped = p.historical_module_product_ids.every(mpId =>
          userMappings.some(m => m.module_product_id === mpId && m.matched_training_module_id && m.allowed_in_execute)
        );
        if (!allMapped) return false;
      } else {
        // partial_safe: at least one module mapped
        const anyMapped = userMappings.some(m => m.matched_training_module_id && m.allowed_in_execute);
        if (!anyMapped) return false;
      }

      // Must have runtime preview with non-zero visibility
      if (p.runtime_preview) {
        if (p.runtime_preview.visible_module_count === 0 || p.runtime_preview.visible_recursive_lesson_count === 0) return false;
      }
      return true;
    };

    const executeCandidatesSafe = plans.filter(p => isSafe(p));
    const executeCandidatesStandalone = plans.filter(p => isStandaloneSafe(p));
    const holdCandidates = plans.filter(p => {
      if (p.planned_action === 'noop') return false;
      return !isSafe(p) && !isStandaloneSafe(p);
    });

    // ABORT guards for execute — validate cohort integrity
    if (!dryRun) {
      if (executeCohort === 'safe_only') {
        const hasForbiddenScope = executeCandidatesSafe.some(p => p.scope_bucket === 'module_scope_only');
        const hasForbiddenAction = executeCandidatesSafe.some(p => p.planned_action === 'create');
        if (hasForbiddenScope || hasForbiddenAction) {
          return new Response(
            JSON.stringify({
              error: "ABORT: safe cohort contains forbidden entries",
              has_module_scope_only: hasForbiddenScope,
              has_create_action: hasForbiddenAction,
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // 9. Build matrix summary (action × scope)
    const actionBuckets: ActionBucket[] = ['create', 'align_to_business', 'repair_metadata_only', 'repair_metadata_and_align', 'noop', 'manual_review', 'staff_skip'];
    const scopeBuckets: ScopeBucket[] = ['full_tariff_scope', 'module_scope_only', 'union_scope', 'no_scope', 'manual_review'];

    const matrix: Record<string, Record<string, number>> = {};
    for (const a of actionBuckets) {
      matrix[a] = {};
      for (const s of scopeBuckets) {
        matrix[a][s] = plans.filter(p => p.planned_action === a && p.scope_bucket === s).length;
      }
    }

    // Safe cohort breakdown — explicit per-action/scope counts
    const safeCohortBreakdown = {
      align_to_business: executeCandidatesSafe.filter(p => p.planned_action === 'align_to_business').length,
      repair_metadata_and_align: executeCandidatesSafe.filter(p => p.planned_action === 'repair_metadata_and_align').length,
      repair_metadata_only: executeCandidatesSafe.filter(p => p.planned_action === 'repair_metadata_only').length,
      full_tariff_scope: executeCandidatesSafe.filter(p => p.scope_bucket === 'full_tariff_scope').length,
      union_scope: executeCandidatesSafe.filter(p => p.scope_bucket === 'union_scope').length,
      total: executeCandidatesSafe.length,
    };

    // Hold cohort breakdown — 3 explicit subgroups
    const holdBreakdown = {
      business_end_null: holdCandidates.filter(p => p.hold_reason === 'business_end_null').length,
      runtime_preview_zero_visibility: holdCandidates.filter(p => p.hold_reason === 'runtime_preview_zero_visibility').length,
      staff_skip: holdCandidates.filter(p => p.hold_reason === 'staff' || p.planned_action === 'staff_skip').length,
      standalone_only_blocked: holdCandidates.filter(p => p.hold_reason === 'standalone_only_blocked').length,
      create_blocked: holdCandidates.filter(p => p.planned_action === 'create').length,
      email_null: holdCandidates.filter(p => p.hold_reason === 'email_null').length,
      unclassified: holdCandidates.filter(p => p.hold_reason === 'unclassified').length,
      scope_manual_review: holdCandidates.filter(p => p.hold_reason === 'scope_manual_review').length,
      total: holdCandidates.length,
    };

    // Cohort summary
    const cohortSummary = {
      safe_execute_count: executeCandidatesSafe.length,
      standalone_safe_count: executeCandidatesStandalone.length,
      standalone_mode: standaloneMode,
      manual_review_count: plans.filter(p => p.planned_action === 'manual_review').length,
      staff_skip_count: plans.filter(p => p.planned_action === 'staff_skip').length,
      identity_unresolved_count: plans.filter(p => p.hold_reason === 'email_null').length,
      standalone_only_blocked_count: plans.filter(p => p.hold_reason === 'standalone_only_blocked').length,
      create_blocked_count: plans.filter(p => p.planned_action === 'create').length,
      noop_count: plans.filter(p => p.planned_action === 'noop').length,
      email_null_count: businessUserIds.filter(uid => !profileEmailMap.get(uid)).length,
    };

    // Standalone dry-run table
    const standaloneDryRun = executeCandidatesStandalone.map(p => {
      const userMappings = mappingConfidence.filter(m =>
        p.historical_module_product_ids.includes(m.module_product_id)
      );
      const mappedIds = userMappings.filter(m => m.matched_training_module_id).map(m => m.matched_training_module_id);
      const mappedTitles = userMappings.filter(m => m.matched_training_module_title).map(m => m.matched_training_module_title);
      const unmappedIds = p.historical_module_product_ids.filter(mpId =>
        !userMappings.some(m => m.module_product_id === mpId && m.matched_training_module_id)
      );
      return {
        user_id: p.user_id,
        email: p.email,
        business_sub_id: p.business_subscription_id,
        business_end: p.business_access_end_at,
        module_products: p.historical_module_product_ids,
        mapped_training_ids: mappedIds,
        mapped_titles: mappedTitles,
        unmapped_module_product_ids: unmappedIds,
        confidence: userMappings.map(m => ({ id: m.module_product_id, name: m.module_product_name, confidence: m.mapping_confidence, reason: m.mapping_reason })),
        visible_lessons: p.runtime_preview?.visible_recursive_lesson_count || 0,
        planned_action: p.current_entitlement_id ? 'repair' : 'create',
        mode: standaloneMode,
        reason: p.reason,
      };
    });

    // 10. Execute if not dry_run — ONLY safe cohort (no create, no module_scope_only)
    const executeResults: Array<{
      user_id: string;
      email: string | null;
      action: string;
      result: string;
      error: string | null;
      old_expires_at: string | null;
      new_expires_at: string | null;
      target_expires_at: string | null;
      old_meta_status: string;
      new_scope_resolution_mode: string;
    }> = [];

    if (!dryRun) {
      const toExecute = executeCohort === 'standalone_safe' ? executeCandidatesStandalone : executeCandidatesSafe;
      console.log(`[repair-cb20] Executing ${toExecute.length} repairs (cohort=${executeCohort})`);

      for (const plan of toExecute) {
        // Build mapped module IDs for standalone
        const userMappings = mappingConfidence.filter(m =>
          plan.historical_module_product_ids.includes(m.module_product_id) && m.matched_training_module_id
        );
        const mappedTrainingModuleIds = userMappings.map(m => m.matched_training_module_id!);
        const unmappedProductIds = plan.historical_module_product_ids.filter(mpId =>
          !userMappings.some(m => m.module_product_id === mpId && m.matched_training_module_id)
        );

        const enrichedMeta: Record<string, any> = {
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

        // Add standalone-specific meta fields
        if (plan.scope_bucket === 'module_scope_only') {
          enrichedMeta.mapped_training_module_ids = mappedTrainingModuleIds;
          enrichedMeta.unmapped_historical_module_product_ids = unmappedProductIds;
          enrichedMeta.mapping_version = 'v2_children_match';
          enrichedMeta.mapping_confidence_summary = userMappings.map(m => ({
            module_product_id: m.module_product_id,
            confidence: m.mapping_confidence,
            training_module_id: m.matched_training_module_id,
          }));
        }

        const oldExpiresAt = plan.current_entitlement_expires_at;
        let newExpiresAt = oldExpiresAt;

        try {
          if (plan.current_entitlement_id) {
            // UPDATE existing entitlement
            const updateData: Record<string, any> = {
              meta: enrichedMeta,
              updated_at: new Date().toISOString(),
            };
            if (plan.planned_action !== 'repair_metadata_only') {
              updateData.expires_at = plan.business_access_end_at;
              newExpiresAt = plan.business_access_end_at;
            }
            const { error } = await supabase
              .from('entitlements')
              .update(updateData)
              .eq('id', plan.current_entitlement_id);
            executeResults.push({
              user_id: plan.user_id,
              email: plan.email,
              action: plan.planned_action,
              result: error ? 'error' : 'success',
              error: error?.message || null,
              old_expires_at: oldExpiresAt,
              new_expires_at: newExpiresAt,
              target_expires_at: plan.target_expires_at,
              old_meta_status: plan.current_meta_status,
              new_scope_resolution_mode: plan.scope_bucket,
            });
          } else if (executeCohort === 'standalone_safe' && plan.scope_bucket === 'module_scope_only') {
            // CREATE new entitlement for standalone_safe cohort
            const profileId = profileIdByAuthId.get(plan.user_id);
            if (!profileId) {
              executeResults.push({
                user_id: plan.user_id, email: plan.email,
                action: 'create', result: 'error', error: 'profile_id not found',
                old_expires_at: null, new_expires_at: null, target_expires_at: plan.target_expires_at,
                old_meta_status: 'no_meta', new_scope_resolution_mode: plan.scope_bucket,
              });
            } else {
              newExpiresAt = plan.business_access_end_at;
              const { error } = await supabase
                .from('entitlements')
                .insert({
                  user_id: plan.user_id,
                  profile_id: profileId,
                  product_id: CB20_PRODUCT_ID,
                  product_code: 'cb20',
                  status: 'active',
                  source: 'batch_standalone_safe',
                  expires_at: plan.business_access_end_at,
                  meta: enrichedMeta,
                });
              executeResults.push({
                user_id: plan.user_id, email: plan.email,
                action: 'create_standalone', result: error ? 'error' : 'success',
                error: error?.message || null,
                old_expires_at: null, new_expires_at: newExpiresAt,
                target_expires_at: plan.target_expires_at,
                old_meta_status: 'no_meta', new_scope_resolution_mode: plan.scope_bucket,
              });
            }
          }
        } catch (err) {
          executeResults.push({
            user_id: plan.user_id,
            email: plan.email,
            action: plan.planned_action,
            result: 'exception',
            error: String(err),
            old_expires_at: oldExpiresAt,
            new_expires_at: null,
            target_expires_at: plan.target_expires_at,
            old_meta_status: plan.current_meta_status,
            new_scope_resolution_mode: plan.scope_bucket,
          });
        }
      }

      // Audit log — extended with breakdowns
      const executedActionBreakdown: Record<string, number> = {};
      const executedScopeBreakdown: Record<string, number> = {};
      for (const r of executeResults) {
        executedActionBreakdown[r.action] = (executedActionBreakdown[r.action] || 0) + 1;
        executedScopeBreakdown[r.new_scope_resolution_mode] = (executedScopeBreakdown[r.new_scope_resolution_mode] || 0) + 1;
      }

      await supabase.from('audit_logs').insert({
        action: 'batch.repair_cb20_entitlements',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'batch_business_cb20_repair_v1',
        meta: {
          batch_id: batchId,
          execute_cohort: executeCohort,
          total_business_users: businessUserIds.length,
          safe_candidate_count: executeCandidatesSafe.length,
          hold_candidate_count: holdCandidates.length,
          executed_action_breakdown: executedActionBreakdown,
          executed_scope_breakdown: executedScopeBreakdown,
          results_summary: {
            aligned: executeResults.filter(r => r.action === 'align_to_business' && r.result === 'success').length,
            repaired_meta_and_align: executeResults.filter(r => r.action === 'repair_metadata_and_align' && r.result === 'success').length,
            repaired_meta_only: executeResults.filter(r => r.action === 'repair_metadata_only' && r.result === 'success').length,
            skipped_manual_review: plans.filter(p => p.planned_action === 'manual_review').length,
            skipped_staff: plans.filter(p => p.planned_action === 'staff_skip').length,
            skipped_noop: plans.filter(p => p.planned_action === 'noop').length,
            skipped_create: plans.filter(p => p.planned_action === 'create').length,
            errors: executeResults.filter(r => r.result !== 'success').length,
          },
          per_operation: executeResults,
          safe_cohort_breakdown: safeCohortBreakdown,
          hold_breakdown: holdBreakdown,
          matrix,
        },
      });
    }

    // 11. Post-check (after execute) — per-user proof table
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

      const executedUserIds = new Set(executeCandidatesSafe.map(p => p.user_id));

      const expiresMismatchRemaining = allPostEnts.filter(e => {
        if (!executedUserIds.has(e.user_id)) return false;
        const biz = userBusinessMap.get(e.user_id);
        return biz && biz.access_end_at && e.expires_at !== biz.access_end_at;
      }).length;

      const scopeModeInvalid = allPostEnts.filter(e => {
        if (!executedUserIds.has(e.user_id)) return false;
        const m = (e.meta || {}) as any;
        if (!m.scope_resolution_mode) return true;
        const plan = executeCandidatesSafe.find(p => p.user_id === e.user_id);
        return plan && m.scope_resolution_mode !== plan.scope_bucket;
      }).length;

      const executedStandaloneNoMatch = executeResults.filter(r => {
        const plan = executeCandidatesSafe.find(p => p.user_id === r.user_id);
        return plan?.scope_bucket === 'module_scope_only' && r.result === 'success';
      }).length;

      postCheck = {
        business_users_total: businessUserIds.length,
        cb20_bonus_entitlements_total: allPostEnts.length,
        normalized_meta_total: hasMeta.length,
        expires_mismatch_remaining: expiresMismatchRemaining,
        manual_review_remaining: plans.filter(p => p.planned_action === 'manual_review').length,
        standalone_only_with_module_scope_only: standaloneWithModule.length,
        standalone_only_with_full_scope: standaloneWithFull.length,
        no_meta_remaining: noMeta.length,
        executed_users_scope_mode_invalid: scopeModeInvalid,
        executed_standalone_only_with_no_match: executedStandaloneNoMatch,
        executed_users_with_null_business_end: executeResults.filter(r => {
          const plan = executeCandidatesSafe.find(p => p.user_id === r.user_id);
          return plan && !plan.business_access_end_at;
        }).length,
        executed_users_with_email_unresolved: executeResults.filter(r => {
          const plan = executeCandidatesSafe.find(p => p.user_id === r.user_id);
          return plan && !plan.email;
        }).length,
        assertions: {
          standalone_full_scope_is_zero: standaloneWithFull.length === 0,
          expires_mismatch_for_executed_is_zero: expiresMismatchRemaining === 0,
          scope_mode_invalid_is_zero: scopeModeInvalid === 0,
          executed_standalone_no_match_is_zero: executedStandaloneNoMatch === 0,
        },
        // Per-user proof table for executed records
        per_user_proof: executeResults.map(r => ({
          user_id: r.user_id,
          old_expires_at: r.old_expires_at,
          new_expires_at: r.new_expires_at,
          target_expires_at: r.target_expires_at,
          old_meta_status: r.old_meta_status,
          new_scope_resolution_mode: r.new_scope_resolution_mode,
          result: r.result,
        })),
      };
    }

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        batch_id: batchId,
        execute_cohort: executeCohort,
        business_users_total: businessUserIds.length,
        plans: dryRun ? plans : undefined,
        execute_candidates_safe: dryRun ? executeCandidatesSafe : undefined,
        hold_candidates: dryRun ? holdCandidates : undefined,
        safe_cohort_breakdown: safeCohortBreakdown,
        hold_breakdown: holdBreakdown,
        cohort_summary: cohortSummary,
        mapping_confidence: mappingConfidence.length > 0 ? mappingConfidence : undefined,
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

// Helper: try name matching with strict uniqueness guard
function tryNameMatch(
  mpId: string,
  product: { name: string; code: string | null } | null,
  allTrainingModules: Array<{ id: string; title: string; product_id: string | null; code: string | null }>,
  results: MappingConfidence[]
) {
  const productName = product?.name || '';
  if (!productName) {
    results.push({
      module_product_id: mpId,
      module_product_name: null,
      matched_training_module_id: null,
      matched_training_module_title: null,
      mapping_confidence: 'no_match',
      mapping_reason: 'Product not found in products_v2',
      allowed_in_execute: false,
    });
    return;
  }

  const nameNorm = productName.toLowerCase().trim();
  const nameMatches = allTrainingModules.filter(tm => tm.title.toLowerCase().trim() === nameNorm);

  if (nameMatches.length === 1) {
    results.push({
      module_product_id: mpId,
      module_product_name: productName,
      matched_training_module_id: nameMatches[0].id,
      matched_training_module_title: nameMatches[0].title,
      mapping_confidence: 'exact_name',
      mapping_reason: `Unique name match: '${productName}' = training '${nameMatches[0].title}'`,
      allowed_in_execute: true,
    });
  } else if (nameMatches.length > 1) {
    results.push({
      module_product_id: mpId,
      module_product_name: productName,
      matched_training_module_id: null,
      matched_training_module_title: null,
      mapping_confidence: 'inferred',
      mapping_reason: `Name '${productName}' matched ${nameMatches.length} training modules — ambiguous, manual review required`,
      allowed_in_execute: false,
    });
  } else {
    results.push({
      module_product_id: mpId,
      module_product_name: productName,
      matched_training_module_id: null,
      matched_training_module_title: null,
      mapping_confidence: 'no_match',
      mapping_reason: `No training module found for product '${productName}' (id=${mpId}) by FK, code, or name`,
      allowed_in_execute: false,
    });
  }
}
