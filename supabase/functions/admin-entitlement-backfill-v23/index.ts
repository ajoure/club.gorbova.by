import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PATCH_VERSION = 'v23.1.9B';
const BATCH_ID = `BACKFILL-ENT-${PATCH_VERSION}-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}Z`;

// Expected counts from v23.1.9A.1-final discovery
const EXPECTED = {
  insert: 269,
  update: 4,
  skip_missing_user_id: 69,
  skip_legacy_code_mismatch: 8,
  skip_missing_tariff: 3,
  grand_total: 353,
};

// Legacy product_code mismatch: users who have active entitlement by cb_2_step
// but subscription by prd_0d01a2fdc477. Do NOT create second entitlement.
const LEGACY_MISMATCH_PRODUCT_CODE = 'cb_2_step';
const LEGACY_MISMATCH_CANONICAL_CODE = 'prd_0d01a2fdc477';

interface BackfillResult {
  ok: boolean;
  dry_run: boolean;
  patch_version: string;
  batch_id: string;
  summary: {
    insert: number;
    update: number;
    skip_missing_user_id: number;
    skip_legacy_code_mismatch: number;
    skip_missing_tariff: number;
    grand_total: number;
    errors: number;
  };
  expected_match: boolean;
  by_product: Record<string, { insert: number; update: number; skip: number; errors: number }>;
  errors: string[];
  candidates?: any[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run !== false; // default true
    const force_mismatch = body.force_mismatch === true; // skip expected count validation

    console.log(`[${PATCH_VERSION}] Starting entitlement backfill. dry_run=${dry_run}, batch_id=${BATCH_ID}`);

    const result: BackfillResult = {
      ok: true,
      dry_run,
      patch_version: PATCH_VERSION,
      batch_id: BATCH_ID,
      summary: { insert: 0, update: 0, skip_missing_user_id: 0, skip_legacy_code_mismatch: 0, skip_missing_tariff: 0, grand_total: 0, errors: 0 },
      expected_match: false,
      by_product: {},
      errors: [],
    };

    // ============================================================
    // STEP 1: Collect SUB-BASED candidates
    // Active subscriptions without matching entitlement
    // ============================================================
    console.log(`[${PATCH_VERSION}] Step 1: Collecting sub-based candidates...`);

    const { data: subCandidates, error: subErr } = await supabase.rpc('admin_entitlement_backfill_sub_candidates');

    if (subErr) {
      // Fallback: do it with raw queries
      console.log(`[${PATCH_VERSION}] RPC not found, using inline query for sub candidates`);
    }

    // Query: active subscriptions without matching active entitlement
    const { data: activeSubs, error: activeSubs_err } = await supabase
      .from('subscriptions_v2')
      .select(`
        id,
        user_id,
        profile_id,
        product_id,
        tariff_id,
        status,
        access_end_at,
        products_v2!inner ( id, code )
      `)
      .eq('status', 'active')
      .not('user_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500);

    if (activeSubs_err) throw new Error(`Failed to fetch active subs: ${activeSubs_err.message}`);

    console.log(`[${PATCH_VERSION}] Fetched ${activeSubs?.length || 0} active subscriptions`);

    // Get ALL active entitlements for comparison
    const { data: activeEnts, error: entsErr } = await supabase
      .from('entitlements')
      .select('id, user_id, product_code, product_id, status, expires_at, order_id')
      .in('status', ['active', 'grace_period'])
      .limit(2000);

    if (entsErr) throw new Error(`Failed to fetch entitlements: ${entsErr.message}`);

    console.log(`[${PATCH_VERSION}] Fetched ${activeEnts?.length || 0} active entitlements`);

    // Build entitlement lookup: user_id + product_code → entitlement
    const entLookup = new Map<string, any>();
    for (const ent of activeEnts || []) {
      const key = `${ent.user_id}::${ent.product_code}`;
      entLookup.set(key, ent);
    }

    // Also build lookup for legacy mismatch detection: user_id with cb_2_step entitlement
    const legacyMismatchUsers = new Set<string>();
    for (const ent of activeEnts || []) {
      if (ent.product_code === LEGACY_MISMATCH_PRODUCT_CODE && (ent.status === 'active' || ent.status === 'grace_period')) {
        legacyMismatchUsers.add(ent.user_id);
      }
    }

    console.log(`[${PATCH_VERSION}] Legacy mismatch users (cb_2_step): ${legacyMismatchUsers.size}`);

    // Also get ALL entitlements (including expired) for UPDATE detection
    const { data: allEntsForUpdate, error: allEntsErr } = await supabase
      .from('entitlements')
      .select('id, user_id, product_code, product_id, status, expires_at, order_id')
      .limit(5000);

    if (allEntsErr) throw new Error(`Failed to fetch all entitlements: ${allEntsErr.message}`);

    // Build expired entitlement lookup for UPDATE candidates
    const expiredEntLookup = new Map<string, any>();
    for (const ent of allEntsForUpdate || []) {
      if (ent.status === 'expired' || ent.status === 'revoked') {
        const key = `${ent.user_id}::${ent.product_code}`;
        // Keep the most recent expired one
        const existing = expiredEntLookup.get(key);
        if (!existing || (ent.expires_at && (!existing.expires_at || ent.expires_at > existing.expires_at))) {
          expiredEntLookup.set(key, ent);
        }
      }
    }

    // ============================================================
    // STEP 2: Build candidate list from subscriptions
    // ============================================================
    type Candidate = {
      user_id: string;
      profile_id: string | null;
      product_id: string;
      product_code: string;
      expires_at: string | null;
      order_id: string | null;
      resolved_execute_decision: string;
      existing_entitlement_id: string | null;
      existing_entitlement_product_code: string | null;
      source: string;
      skip_reason?: string;
    };

    const candidates: Candidate[] = [];
    const processedSubKeys = new Set<string>();

    for (const sub of activeSubs || []) {
      const product = sub.products_v2 as any;
      if (!product?.code) continue;

      const productCode = product.code;
      const userId = sub.user_id;
      const dedupeKey = `${userId}::${productCode}`;

      // Dedupe: one candidate per user+product
      if (processedSubKeys.has(dedupeKey)) continue;
      processedSubKeys.add(dedupeKey);

      // Check if active entitlement already exists
      if (entLookup.has(dedupeKey)) continue; // Already has active entitlement, not a gap

      // Check legacy mismatch for prd_0d01a2fdc477
      if (productCode === LEGACY_MISMATCH_CANONICAL_CODE && legacyMismatchUsers.has(userId)) {
        candidates.push({
          user_id: userId,
          profile_id: sub.profile_id,
          product_id: sub.product_id,
          product_code: productCode,
          expires_at: sub.access_end_at,
          order_id: null,
          resolved_execute_decision: 'skip_legacy_code_mismatch',
          existing_entitlement_id: null,
          existing_entitlement_product_code: LEGACY_MISMATCH_PRODUCT_CODE,
          source: 'sync_from_subscription',
          skip_reason: `User has active entitlement by legacy code ${LEGACY_MISMATCH_PRODUCT_CODE}`,
        });
        continue;
      }

      // Check if there's an expired entitlement → UPDATE
      const expiredEnt = expiredEntLookup.get(dedupeKey);
      if (expiredEnt) {
        candidates.push({
          user_id: userId,
          profile_id: sub.profile_id,
          product_id: sub.product_id,
          product_code: productCode,
          expires_at: sub.access_end_at,
          order_id: expiredEnt.order_id,
          resolved_execute_decision: 'update',
          existing_entitlement_id: expiredEnt.id,
          existing_entitlement_product_code: expiredEnt.product_code,
          source: 'sync_from_subscription',
        });
        continue;
      }

      // Otherwise → INSERT
      candidates.push({
        user_id: userId,
        profile_id: sub.profile_id,
        product_id: sub.product_id,
        product_code: productCode,
        expires_at: sub.access_end_at,
        order_id: null,
        resolved_execute_decision: 'insert',
        existing_entitlement_id: null,
        existing_entitlement_product_code: null,
        source: 'sync_from_subscription',
      });
    }

    console.log(`[${PATCH_VERSION}] Sub-based candidates: ${candidates.length}`);

    // ============================================================
    // STEP 3: Collect ORDER-BASED CB20 candidates
    // ============================================================
    console.log(`[${PATCH_VERSION}] Step 3: Collecting CB20 order-based candidates...`);

    // Get cb20 product
    const { data: cb20Product } = await supabase
      .from('products_v2')
      .select('id, code')
      .eq('code', 'cb20')
      .single();

    if (!cb20Product) {
      console.log(`[${PATCH_VERSION}] cb20 product not found, skipping order-based`);
    } else {
      // Get all paid orders for cb20 with tariff
      const { data: cb20Orders, error: cb20Err } = await supabase
        .from('orders_v2')
        .select(`
          id,
          profile_id,
          product_id,
          tariff_id,
          user_id,
          created_at,
          tariffs!inner ( id, access_days )
        `)
        .eq('product_id', cb20Product.id)
        .eq('status', 'paid')
        .not('tariff_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1000);

      if (cb20Err) throw new Error(`Failed to fetch CB20 orders: ${cb20Err.message}`);

      console.log(`[${PATCH_VERSION}] Fetched ${cb20Orders?.length || 0} CB20 paid orders with tariff`);

      // Also get orders without tariff for skip_missing_tariff
      const { data: cb20NoTariffOrders } = await supabase
        .from('orders_v2')
        .select('id, profile_id, product_id, user_id')
        .eq('product_id', cb20Product.id)
        .eq('status', 'paid')
        .is('tariff_id', null)
        .limit(500);

      // Group by profile_id, pick canonical (max access_days, then max created_at)
      const cb20ByProfile = new Map<string, any[]>();
      for (const order of cb20Orders || []) {
        const key = order.profile_id;
        if (!cb20ByProfile.has(key)) cb20ByProfile.set(key, []);
        cb20ByProfile.get(key)!.push(order);
      }

      // Find profiles that ONLY have no-tariff orders (NEED_POLICY)
      const profilesWithTariff = new Set(cb20ByProfile.keys());
      const noTariffOnlyProfiles = new Set<string>();
      for (const order of cb20NoTariffOrders || []) {
        if (!profilesWithTariff.has(order.profile_id)) {
          noTariffOnlyProfiles.add(order.profile_id);
        }
      }

      // Get profiles to check user_id
      const allCb20ProfileIds = [...cb20ByProfile.keys(), ...noTariffOnlyProfiles];
      const { data: cb20Profiles } = await supabase
        .from('profiles')
        .select('id, user_id')
        .in('id', allCb20ProfileIds);

      const profileUserMap = new Map<string, string | null>();
      for (const p of cb20Profiles || []) {
        profileUserMap.set(p.id, p.user_id);
      }

      // Process no-tariff-only profiles → skip_missing_tariff
      for (const profileId of noTariffOnlyProfiles) {
        const userId = profileUserMap.get(profileId);
        candidates.push({
          user_id: userId || profileId,
          profile_id: profileId,
          product_id: cb20Product.id,
          product_code: 'cb20',
          expires_at: null,
          order_id: null,
          resolved_execute_decision: 'skip_missing_tariff',
          existing_entitlement_id: null,
          existing_entitlement_product_code: null,
          source: 'fixed_from_order',
          skip_reason: 'No orders with tariff_id, cannot compute access_days',
        });
      }

      // Process profiles with tariff orders
      for (const [profileId, orders] of cb20ByProfile) {
        const userId = profileUserMap.get(profileId);

        // Check user_id
        if (!userId) {
          // Pick canonical for deferred_recovery_key
          const sorted = orders.sort((a: any, b: any) => {
            const aDays = (a.tariffs as any)?.access_days || 0;
            const bDays = (b.tariffs as any)?.access_days || 0;
            if (bDays !== aDays) return bDays - aDays;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          });
          const canonical = sorted[0];

          candidates.push({
            user_id: profileId, // placeholder
            profile_id: profileId,
            product_id: cb20Product.id,
            product_code: 'cb20',
            expires_at: null,
            order_id: canonical.id,
            resolved_execute_decision: 'skip_missing_user_id',
            existing_entitlement_id: null,
            existing_entitlement_product_code: null,
            source: 'fixed_from_order',
            skip_reason: 'Profile has no user_id, entitlements.user_id is required',
          });
          continue;
        }

        // Check if already has entitlement
        const entKey = `${userId}::cb20`;
        if (entLookup.has(entKey)) continue;

        // Pick canonical order: max access_days, then max created_at
        const sorted = orders.sort((a: any, b: any) => {
          const aDays = (a.tariffs as any)?.access_days || 0;
          const bDays = (b.tariffs as any)?.access_days || 0;
          if (bDays !== aDays) return bDays - aDays;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        const canonical = sorted[0];
        const accessDays = (canonical.tariffs as any)?.access_days || 0;
        const expiresAt = new Date(new Date(canonical.created_at).getTime() + accessDays * 24 * 60 * 60 * 1000).toISOString();

        candidates.push({
          user_id: userId,
          profile_id: profileId,
          product_id: cb20Product.id,
          product_code: 'cb20',
          expires_at: expiresAt,
          order_id: canonical.id,
          resolved_execute_decision: 'insert',
          existing_entitlement_id: null,
          existing_entitlement_product_code: null,
          source: 'fixed_from_order',
        });
      }
    }

    console.log(`[${PATCH_VERSION}] Total candidates: ${candidates.length}`);

    // ============================================================
    // STEP 4: Build summary and verify 5-way split
    // ============================================================
    const summary = { insert: 0, update: 0, skip_missing_user_id: 0, skip_legacy_code_mismatch: 0, skip_missing_tariff: 0, grand_total: candidates.length, errors: 0 };
    const byProduct: Record<string, { insert: number; update: number; skip: number; errors: number }> = {};

    for (const c of candidates) {
      const pc = c.product_code;
      if (!byProduct[pc]) byProduct[pc] = { insert: 0, update: 0, skip: 0, errors: 0 };

      switch (c.resolved_execute_decision) {
        case 'insert': summary.insert++; byProduct[pc].insert++; break;
        case 'update': summary.update++; byProduct[pc].update++; break;
        case 'skip_missing_user_id': summary.skip_missing_user_id++; byProduct[pc].skip++; break;
        case 'skip_legacy_code_mismatch': summary.skip_legacy_code_mismatch++; byProduct[pc].skip++; break;
        case 'skip_missing_tariff': summary.skip_missing_tariff++; byProduct[pc].skip++; break;
      }
    }

    result.summary = summary;
    result.by_product = byProduct;

    // Verify 5-way split matches expected
    const matchesExpected =
      summary.insert === EXPECTED.insert &&
      summary.update === EXPECTED.update &&
      summary.skip_missing_user_id === EXPECTED.skip_missing_user_id &&
      summary.skip_legacy_code_mismatch === EXPECTED.skip_legacy_code_mismatch &&
      summary.skip_missing_tariff === EXPECTED.skip_missing_tariff;

    result.expected_match = matchesExpected;

    console.log(`[${PATCH_VERSION}] 5-way split: insert=${summary.insert} update=${summary.update} skip_uid=${summary.skip_missing_user_id} skip_legacy=${summary.skip_legacy_code_mismatch} skip_tariff=${summary.skip_missing_tariff} total=${summary.grand_total}`);
    console.log(`[${PATCH_VERSION}] Expected match: ${matchesExpected}`);

    if (!matchesExpected && !force_mismatch) {
      result.ok = false;
      result.errors.push(
        `5-way split mismatch! Got: insert=${summary.insert} update=${summary.update} skip_uid=${summary.skip_missing_user_id} skip_legacy=${summary.skip_legacy_code_mismatch} skip_tariff=${summary.skip_missing_tariff}. ` +
        `Expected: insert=${EXPECTED.insert} update=${EXPECTED.update} skip_uid=${EXPECTED.skip_missing_user_id} skip_legacy=${EXPECTED.skip_legacy_code_mismatch} skip_tariff=${EXPECTED.skip_missing_tariff}. ` +
        `Use force_mismatch=true to override.`
      );

      // In dry_run, still return candidates for inspection
      if (dry_run) {
        result.candidates = candidates;
      }

      return new Response(JSON.stringify(result), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // STEP 5: DRY RUN — return candidates without executing
    // ============================================================
    if (dry_run) {
      result.candidates = candidates.map(c => ({
        ...c,
        deferred_recovery_key: c.resolved_execute_decision === 'skip_missing_user_id'
          ? `${c.profile_id}::${c.product_id}::${c.order_id}`
          : null,
      }));

      console.log(`[${PATCH_VERSION}] Dry run complete. ${candidates.length} candidates.`);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // STEP 6: EXECUTE — only insert/update decisions
    // ============================================================
    console.log(`[${PATCH_VERSION}] EXECUTING ${summary.insert} inserts + ${summary.update} updates...`);

    let executedInserts = 0;
    let executedUpdates = 0;
    const executeErrors: string[] = [];

    for (const c of candidates) {
      if (c.resolved_execute_decision !== 'insert' && c.resolved_execute_decision !== 'update') {
        continue;
      }

      const meta = {
        source: 'historical_backfill',
        source_patch: PATCH_VERSION,
        batch_id: BATCH_ID,
        backfill_source: c.source,
        backfill_decision: c.resolved_execute_decision,
        backfill_timestamp: new Date().toISOString(),
      };

      try {
        if (c.resolved_execute_decision === 'insert') {
          const { error: insertErr } = await supabase
            .from('entitlements')
            .upsert({
              user_id: c.user_id,
              product_code: c.product_code,
              product_id: c.product_id,
              profile_id: c.profile_id,
              order_id: c.order_id,
              status: 'active',
              expires_at: c.expires_at,
              meta,
            }, {
              onConflict: 'user_id,product_code',
              ignoreDuplicates: false,
            });

          if (insertErr) {
            console.error(`[${PATCH_VERSION}] INSERT error for ${c.user_id}/${c.product_code}: ${insertErr.message}`);
            executeErrors.push(`INSERT ${c.user_id}/${c.product_code}: ${insertErr.message}`);
            summary.errors++;
            byProduct[c.product_code].errors++;
          } else {
            executedInserts++;
          }
        } else if (c.resolved_execute_decision === 'update' && c.existing_entitlement_id) {
          const { error: updateErr } = await supabase
            .from('entitlements')
            .update({
              status: 'active',
              expires_at: c.expires_at,
              product_id: c.product_id,
              meta,
              updated_at: new Date().toISOString(),
            })
            .eq('id', c.existing_entitlement_id);

          if (updateErr) {
            console.error(`[${PATCH_VERSION}] UPDATE error for ${c.user_id}/${c.product_code}: ${updateErr.message}`);
            executeErrors.push(`UPDATE ${c.user_id}/${c.product_code}: ${updateErr.message}`);
            summary.errors++;
            byProduct[c.product_code].errors++;
          } else {
            executedUpdates++;
          }
        }
      } catch (err: any) {
        console.error(`[${PATCH_VERSION}] Unexpected error for ${c.user_id}/${c.product_code}:`, err);
        executeErrors.push(`${c.resolved_execute_decision.toUpperCase()} ${c.user_id}/${c.product_code}: ${err.message}`);
        summary.errors++;
        byProduct[c.product_code].errors++;
      }
    }

    result.errors = executeErrors;

    // ============================================================
    // STEP 7: Write audit log
    // ============================================================
    try {
      await supabase.from('audit_logs').insert({
        action: 'entitlement_backfill',
        actor_type: 'system',
        actor_label: PATCH_VERSION,
        meta: {
          batch_id: BATCH_ID,
          dry_run: false,
          summary: {
            planned_insert: summary.insert,
            planned_update: summary.update,
            executed_insert: executedInserts,
            executed_update: executedUpdates,
            errors: summary.errors,
            skip_missing_user_id: summary.skip_missing_user_id,
            skip_legacy_code_mismatch: summary.skip_legacy_code_mismatch,
            skip_missing_tariff: summary.skip_missing_tariff,
          },
        },
      });
    } catch (auditErr: any) {
      console.error(`[${PATCH_VERSION}] Audit log error:`, auditErr);
    }

    console.log(`[${PATCH_VERSION}] EXECUTE COMPLETE: ${executedInserts} inserts, ${executedUpdates} updates, ${summary.errors} errors`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error(`[${PATCH_VERSION}] Fatal error:`, error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message, patch_version: PATCH_VERSION }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
