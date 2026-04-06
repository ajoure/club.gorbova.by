import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * repair-cb20-entitlements — MECHANICAL EXECUTOR
 * 
 * This function has NO business logic. It does NOT classify, decide, or interpret.
 * It only:
 * 1. Reads ALL active entitlements for a given product_id
 * 2. For each, checks if there's a valid access_rule chain proving the access
 * 3. If no rule proof → adds to disable list
 * 4. Executes disable/reprovision based on the list
 * 
 * UNIVERSAL: Works for ANY product_id, not just cb20.
 * All decisions come from access_rules table. Zero hardcoded product logic.
 */

interface RepairEntry {
  entitlement_id: string;
  user_id: string;
  product_id: string;
  product_code: string;
  current_expires_at: string | null;
  email: string | null;
  access_rule_id: string | null;
  rule_source_product_id: string | null;
  rule_source_tariff_id: string | null;
  supporting_subscription_id: string | null;
  is_rule_proven: boolean;
  verdict: string;
  planned_action: string;
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
    const productId = body.product_id;
    const dryRun = body.dry_run !== false; // default = dry_run
    const batchId = `repair-entitlements-${Date.now()}`;

    if (!productId) {
      return jsonRes({ error: "product_id is required" }, 400);
    }

    console.log(`[repair-entitlements] Starting ${dryRun ? 'DRY RUN' : 'EXECUTE'} for product_id=${productId}, batchId=${batchId}`);

    // 1. Get ALL active entitlements for this product
    const { data: activeEnts, error: entErr } = await supabase
      .from('entitlements')
      .select('id, user_id, product_id, product_code, status, expires_at, order_id, meta')
      .eq('product_id', productId)
      .eq('status', 'active');

    if (entErr) throw entErr;
    console.log(`[repair-entitlements] Found ${activeEnts?.length || 0} active entitlements`);

    // 2. Get ALL active access_rules that could grant this product (as target)
    // These are product_access rules where target includes our product_id
    const { data: grantingRules, error: ruleErr } = await supabase
      .from('access_rules')
      .select('id, product_id, tariff_id, grant_target_type, target_ref, conditions, is_active')
      .eq('grant_target_type', 'product_access')
      .eq('is_active', true);

    if (ruleErr) throw ruleErr;

    // Filter rules that target our product_id
    const applicableRules = (grantingRules || []).filter((rule: any) => {
      // Check target_ref
      if (rule.target_ref === productId) return true;
      // Check conditions.target_product_ids array
      const cond = rule.conditions || {};
      if (Array.isArray(cond.target_product_ids) && cond.target_product_ids.includes(productId)) return true;
      return false;
    });

    console.log(`[repair-entitlements] Found ${applicableRules.length} applicable access_rules targeting product_id=${productId}`);

    // 3. Also check if any direct purchase rules exist (product_access or entitlement_mode)
    const { data: product } = await supabase
      .from('products_v2')
      .select('id, code, entitlement_mode')
      .eq('id', productId)
      .maybeSingle();

    // 4. Get user profiles for email
    const userIds = [...new Set((activeEnts || []).map((e: any) => e.user_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, email')
      .in('user_id', userIds);

    const emailMap = new Map<string, string>();
    (profiles || []).forEach((p: any) => { if (p.user_id && p.email) emailMap.set(p.user_id, p.email); });

    // 5. For each entitlement, check if it has a valid rule chain
    const repairList: RepairEntry[] = [];
    let validCount = 0;
    let invalidCount = 0;

    for (const ent of (activeEnts || [])) {
      const meta = (ent.meta || {}) as Record<string, any>;
      const sourceRuleId = meta.source_rule_id || null;
      
      let isRuleProven = false;
      let matchedRuleId: string | null = null;
      let ruleSrcProductId: string | null = null;
      let ruleSrcTariffId: string | null = null;
      let supportingSubId: string | null = null;

      // Check 1: Does meta contain a source_rule_id that matches an active rule?
      if (sourceRuleId) {
        const matchedRule = applicableRules.find((r: any) => r.id === sourceRuleId);
        if (matchedRule) {
          // Verify the source subscription is still active
          const { data: activeSub } = await supabase
            .from('subscriptions_v2')
            .select('id, tariff_id, status, access_end_at')
            .eq('user_id', ent.user_id)
            .eq('product_id', matchedRule.product_id)
            .in('status', ['active', 'past_due'])
            .limit(1)
            .maybeSingle();

          if (activeSub) {
            isRuleProven = true;
            matchedRuleId = matchedRule.id;
            ruleSrcProductId = matchedRule.product_id;
            ruleSrcTariffId = matchedRule.tariff_id || activeSub.tariff_id;
            supportingSubId = activeSub.id;
          }
        }
      }

      // Check 2: If no meta proof, check if ANY applicable rule + active subscription exists
      if (!isRuleProven) {
        for (const rule of applicableRules) {
          const { data: activeSub } = await supabase
            .from('subscriptions_v2')
            .select('id, tariff_id, status')
            .eq('user_id', ent.user_id)
            .eq('product_id', rule.product_id)
            .in('status', ['active', 'past_due'])
            .limit(1)
            .maybeSingle();

          if (activeSub) {
            // Check tariff match if rule requires specific tariff
            if (rule.tariff_id && activeSub.tariff_id !== rule.tariff_id) continue;

            // Check prior_purchase condition if required
            const cond = rule.conditions || {};
            if (cond.condition_type === 'prior_purchase') {
              const { data: priorOrder } = await supabase
                .from('orders_v2')
                .select('id')
                .eq('user_id', ent.user_id)
                .eq('product_id', productId)
                .eq('status', 'paid')
                .limit(1)
                .maybeSingle();

              if (!priorOrder) continue;
            }

            isRuleProven = true;
            matchedRuleId = rule.id;
            ruleSrcProductId = rule.product_id;
            ruleSrcTariffId = rule.tariff_id || activeSub.tariff_id;
            supportingSubId = activeSub.id;
            break;
          }
        }
      }

      const verdict = isRuleProven ? 'valid_rule_based_active' : 'invalid_no_rule_found';
      const plannedAction = isRuleProven ? 'keep' : 'disable';

      if (isRuleProven) {
        validCount++;
      } else {
        invalidCount++;
      }

      repairList.push({
        entitlement_id: ent.id,
        user_id: ent.user_id,
        product_id: ent.product_id,
        product_code: ent.product_code || product?.code || '',
        current_expires_at: ent.expires_at,
        email: emailMap.get(ent.user_id) || null,
        access_rule_id: matchedRuleId,
        rule_source_product_id: ruleSrcProductId,
        rule_source_tariff_id: ruleSrcTariffId,
        supporting_subscription_id: supportingSubId,
        is_rule_proven: isRuleProven,
        verdict,
        planned_action: plannedAction,
      });
    }

    console.log(`[repair-entitlements] Results: ${validCount} valid, ${invalidCount} invalid`);

    // 6. Execute disables if not dry_run
    let disabledCount = 0;
    let reprovisionedCount = 0;

    if (!dryRun) {
      const toDisable = repairList.filter(r => r.planned_action === 'disable');
      
      for (const entry of toDisable) {
        const { error } = await supabase
          .from('entitlements')
          .update({
            status: 'expired',
            meta: {
              ...((await supabase.from('entitlements').select('meta').eq('id', entry.entitlement_id).maybeSingle()).data?.meta || {}),
              disabled_by: 'repair-entitlements',
              disabled_at: new Date().toISOString(),
              disabled_reason: 'no_active_access_rule',
              batch_id: batchId,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', entry.entitlement_id);

        if (!error) {
          disabledCount++;
          // Audit log
          await supabase.from('audit_logs').insert({
            action: 'entitlement.repair_disabled',
            actor_type: 'system',
            meta: {
              entitlement_id: entry.entitlement_id,
              user_id: entry.user_id,
              product_id: entry.product_id,
              reason: 'no_active_access_rule',
              batch_id: batchId,
            },
          });
        } else {
          console.error(`[repair-entitlements] Failed to disable ${entry.entitlement_id}:`, error);
        }
      }

      // Reprovision: for valid entries missing source_rule_id in meta, write it
      const toReprovision = repairList.filter(r => r.planned_action === 'keep' && r.access_rule_id);
      for (const entry of toReprovision) {
        const { data: currentEnt } = await supabase.from('entitlements').select('meta').eq('id', entry.entitlement_id).maybeSingle();
        const currentMeta = (currentEnt?.meta || {}) as Record<string, any>;
        if (currentMeta.source_rule_id === entry.access_rule_id) continue; // already correct

        const { error } = await supabase
          .from('entitlements')
          .update({
            meta: {
              ...currentMeta,
              source_rule_id: entry.access_rule_id,
              rule_source_product_id: entry.rule_source_product_id,
              rule_source_tariff_id: entry.rule_source_tariff_id,
              reprovisioned_by: 'repair-entitlements',
              reprovisioned_at: new Date().toISOString(),
              batch_id: batchId,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', entry.entitlement_id);

        if (!error) {
          reprovisionedCount++;
        } else {
          console.error(`[repair-entitlements] Failed to reprovision ${entry.entitlement_id}:`, error);
        }
      }

      console.log(`[repair-entitlements] Disabled ${disabledCount}, reprovisioned ${reprovisionedCount} entitlements`);
    }

    return jsonRes({
      batch_id: batchId,
      dry_run: dryRun,
      product_id: productId,
      product_code: product?.code || null,
      total_active: activeEnts?.length || 0,
      applicable_rules: applicableRules.length,
      valid_count: validCount,
      invalid_count: invalidCount,
      disabled_count: disabledCount,
      reprovisioned_count: reprovisionedCount,
      repair_list: repairList,
    });
  } catch (err) {
    console.error("[repair-entitlements] Error:", err);
    return jsonRes({ error: String(err) }, 500);
  }
});

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
