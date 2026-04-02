import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * split-multi-module-orders — PATCH G
 * 
 * Splits 7 multi-module standalone historical orders into individual child orders.
 * Each child gets product_id = module_product_id (NOT root CB20).
 * 
 * Modes: dry_run | execute_children_only | finalize_parents
 * Guards: historical_purchase_type=module_only_standalone, module_count>1, status=paid, reconcile_source=getcourse_historical
 */

const MODULE_SHORT_NAMES: Record<string, string> = {
  'abee24cd-5c8b-4111-a6cb-7dee7acf168c': 'Розничная торговля',
  '064dd768-de8b-40db-89bc-f8d4a7e442ba': 'Производство',
  '64d9f812-617c-41a8-b3dc-bb113156d6f3': 'Грузо- и пассажироперевозки',
  'f833c846-a78d-4096-9dac-b8417d588371': 'Строительство',
  'd7effaf4-9be0-4ce2-971b-e02fe2a85a9a': 'Маркетплейсы',
  '9187db54-8f57-42eb-bbcb-d7103d2459a9': 'Общепит',
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const mode: string = body.mode || "dry_run";
    const filterOrderIds: string[] | undefined = body.order_ids;

    if (!["dry_run", "execute_children_only", "finalize_parents"].includes(mode)) {
      return new Response(JSON.stringify({ error: "Invalid mode" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Find target multi-module orders
    let query = supabase
      .from("orders_v2")
      .select("id, order_number, status, reconcile_source, base_price, final_price, paid_amount, currency, deal_date, product_id, tariff_id, flow_id, offer_id, profile_id, user_id, customer_email, customer_phone, payer_type, purchase_snapshot, meta")
      .eq("status", "paid")
      .eq("reconcile_source", "getcourse_historical");

    if (filterOrderIds && filterOrderIds.length > 0) {
      query = query.in("id", filterOrderIds);
    }

    const { data: candidates, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;

    // Filter: only module_only_standalone with >1 modules
    const targets = (candidates || []).filter((o: any) => {
      const snap = o.purchase_snapshot;
      if (!snap) return false;
      if (snap.historical_purchase_type !== "module_only_standalone") return false;
      const modules = snap.module_list_mapped;
      if (!Array.isArray(modules) || modules.length <= 1) return false;
      return true;
    });

    const batchId = `SPLIT-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 17)}`;

    // 2. Build dry-run table
    const dryRunRows: any[] = [];
    for (const parent of targets) {
      const snap = parent.purchase_snapshot as any;
      const modules: string[] = snap.module_list_mapped;
      const moduleRaw: string[] = snap.module_list_raw || [];

      for (let idx = 0; idx < modules.length; idx++) {
        const moduleProductId = modules[idx];
        const moduleName = MODULE_SHORT_NAMES[moduleProductId] || moduleRaw[idx] || "Unknown";
        const childOrderNumber = `${parent.order_number}-M${idx + 1}`;

        // Check existing child by meta keys (idempotency)
        const { data: existingByMeta } = await supabase
          .from("orders_v2")
          .select("id, order_number")
          .eq("meta->>split_from_order_id", parent.id)
          .eq("meta->>split_module_product_id", moduleProductId)
          .limit(1);

        // Also check by order_number
        const { data: existingByNumber } = await supabase
          .from("orders_v2")
          .select("id")
          .eq("order_number", childOrderNumber)
          .limit(1);

        const alreadyExists = (existingByMeta && existingByMeta.length > 0) || (existingByNumber && existingByNumber.length > 0);

        dryRunRows.push({
          parent_order_id: parent.id,
          parent_order_number: parent.order_number,
          profile_email: parent.customer_email,
          deal_date: parent.deal_date,
          module_product_id: moduleProductId,
          module_name: `ЦБ 2.0: ${moduleName}`,
          proposed_child_order_number: childOrderNumber,
          existing_child_conflict: alreadyExists ? (existingByMeta?.[0]?.order_number || childOrderNumber) : null,
          will_create: !alreadyExists,
        });
      }
    }

    if (mode === "dry_run") {
      return new Response(JSON.stringify({
        mode: "dry_run",
        batch_id: batchId,
        parent_count: targets.length,
        total_children_planned: dryRunRows.length,
        children_to_create: dryRunRows.filter(r => r.will_create).length,
        children_already_exist: dryRunRows.filter(r => !r.will_create).length,
        rows: dryRunRows,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "execute_children_only") {
      const results: any[] = [];
      const toCreate = dryRunRows.filter(r => r.will_create);

      // Pre-calculate per-module prices for each parent
      const parentModuleCounts: Record<string, number> = {};
      const parentChildIndices: Record<string, number> = {};
      for (const row of toCreate) {
        parentModuleCounts[row.parent_order_id] = (parentModuleCounts[row.parent_order_id] || 0) + 1;
        parentChildIndices[row.parent_order_id] = 0;
      }

      for (const row of toCreate) {
        const parent = targets.find(t => t.id === row.parent_order_id)!;
        const snap = parent.purchase_snapshot as any;
        const parentMeta = (parent.meta || {}) as Record<string, any>;

        const moduleCount = parentModuleCounts[row.parent_order_id];
        const childIdx = parentChildIndices[row.parent_order_id]++;
        const isLastChild = childIdx === moduleCount - 1;

        // Per-module price calculation with deterministic remainder on last child
        const parentBase = parseFloat(parent.base_price) || 0;
        const parentFinal = parseFloat(parent.final_price) || 0;
        const parentPaid = parseFloat(parent.paid_amount) || 0;

        const unitBase = Math.floor((parentBase / moduleCount) * 100) / 100;
        const unitFinal = Math.floor((parentFinal / moduleCount) * 100) / 100;
        const unitPaid = Math.floor((parentPaid / moduleCount) * 100) / 100;

        // Last child gets remainder so sum = parent exactly
        const childBase = isLastChild
          ? Math.round((parentBase - unitBase * (moduleCount - 1)) * 100) / 100
          : unitBase;
        const childFinal = isLastChild
          ? Math.round((parentFinal - unitFinal * (moduleCount - 1)) * 100) / 100
          : unitFinal;
        const childPaid = isLastChild
          ? Math.round((parentPaid - unitPaid * (moduleCount - 1)) * 100) / 100
          : unitPaid;

        // Build child purchase_snapshot
        const childSnapshot = {
          ...snap,
          module_list_mapped: [row.module_product_id],
          module_list_raw: [MODULE_SHORT_NAMES[row.module_product_id] || "Unknown"],
          display_purchase_name: row.module_name,
          split_from_parent: true,
          normalized_unit_price: childFinal,
          parent_total_price: parentFinal,
          parent_module_count: moduleCount,
          ...(isLastChild ? { is_remainder_child: true } : {}),
        };

        // Build child meta
        const childMeta = {
          ...parentMeta,
          split_from_order_id: parent.id,
          split_from_order_number: parent.order_number,
          split_batch_id: batchId,
          split_module_product_id: row.module_product_id,
          source_parent_deal_date: parent.deal_date,
          split_parent_final_price: parentFinal,
          split_parent_module_count: moduleCount,
          split_price_strategy: "per_module_equal",
          ...(isLastChild ? { split_price_remainder: true } : {}),
        };

        const insertData = {
          order_number: row.proposed_child_order_number,
          product_id: row.module_product_id, // KEY: module product, NOT root CB20
          tariff_id: parent.tariff_id,
          flow_id: parent.flow_id,
          offer_id: parent.offer_id,
          profile_id: parent.profile_id,
          user_id: parent.user_id,
          customer_email: parent.customer_email,
          customer_phone: parent.customer_phone,
          payer_type: parent.payer_type,
          status: "paid",
          reconcile_source: "getcourse_historical",
          base_price: childBase,
          final_price: childFinal,
          paid_amount: childPaid,
          currency: parent.currency,
          deal_date: parent.deal_date,
          purchase_snapshot: childSnapshot,
          meta: childMeta,
        };

        const { data: inserted, error: insertErr } = await supabase
          .from("orders_v2")
          .insert(insertData)
          .select("id, order_number")
          .single();

        if (insertErr) {
          results.push({
            order_number: row.proposed_child_order_number,
            status: "error",
            error: insertErr.message,
          });
        } else {
          results.push({
            order_number: row.proposed_child_order_number,
            status: "created",
            id: inserted.id,
            module_product_id: row.module_product_id,
            module_name: row.module_name,
          });
        }
      }

      // Update parent meta with split_status and child IDs
      for (const parent of targets) {
        const childIds = results
          .filter(r => r.status === "created" && toCreate.some(tc => tc.parent_order_id === parent.id && tc.proposed_child_order_number === r.order_number))
          .map(r => r.id);
        const childNumbers = results
          .filter(r => r.status === "created" && toCreate.some(tc => tc.parent_order_id === parent.id && tc.proposed_child_order_number === r.order_number))
          .map(r => r.order_number);

        if (childIds.length > 0) {
          const parentMeta = ((parent.meta || {}) as Record<string, any>);
          await supabase
            .from("orders_v2")
            .update({
              meta: {
                ...parentMeta,
                split_status: "children_created",
                split_child_order_ids: childIds,
                split_child_order_numbers: childNumbers,
                split_batch_id: batchId,
              },
            })
            .eq("id", parent.id);
        }
      }

      return new Response(JSON.stringify({
        mode: "execute_children_only",
        batch_id: batchId,
        created: results.filter(r => r.status === "created").length,
        errors: results.filter(r => r.status === "error").length,
        skipped: dryRunRows.filter(r => !r.will_create).length,
        results,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "finalize_parents") {
      // Post-check first
      const postCheck: any[] = [];

      for (const parent of targets) {
        const snap = parent.purchase_snapshot as any;
        const expectedChildren = snap.module_list_mapped.length;

        // Count actual children
        const { data: children } = await supabase
          .from("orders_v2")
          .select("id, order_number, product_id, purchase_snapshot")
          .eq("meta->>split_from_order_id", parent.id);

        const actualChildren = children?.length || 0;
        const expectedModuleIds = new Set(snap.module_list_mapped as string[]);
        const actualModuleIds = new Set((children || []).map((c: any) => c.product_id));
        const allModulesPreserved = [...expectedModuleIds].every(id => actualModuleIds.has(id));
        const displayNamesValid = (children || []).every((c: any) => {
          const cSnap = c.purchase_snapshot as any;
          return cSnap?.display_purchase_name && cSnap.display_purchase_name.startsWith("ЦБ 2.0:");
        });

        postCheck.push({
          parent_order_number: parent.order_number,
          expected_children: expectedChildren,
          actual_children: actualChildren,
          all_module_ids_preserved: allModulesPreserved,
          child_product_ids_valid: [...actualModuleIds].every(id => expectedModuleIds.has(id)),
          display_names_valid: displayNamesValid,
          parent_finalized: false,
          safe_to_finalize: actualChildren === expectedChildren && allModulesPreserved && displayNamesValid,
        });
      }

      // Only finalize parents where all checks pass
      const finalized: string[] = [];
      const blocked: string[] = [];

      for (const check of postCheck) {
        if (!check.safe_to_finalize) {
          blocked.push(check.parent_order_number);
          continue;
        }

        const parent = targets.find(t => t.order_number === check.parent_order_number)!;
        const parentMeta = ((parent.meta || {}) as Record<string, any>);

        const { error: finalizeErr } = await supabase
          .from("orders_v2")
          .update({
            status: "canceled",
            meta: {
              ...parentMeta,
              split_status: "finalized",
              canceled_reason: "split_into_modules",
              split_batch_id: batchId,
            },
          })
          .eq("id", parent.id);

        if (!finalizeErr) {
          check.parent_finalized = true;
          finalized.push(check.parent_order_number);
        } else {
          blocked.push(check.parent_order_number);
        }
      }

      return new Response(JSON.stringify({
        mode: "finalize_parents",
        batch_id: batchId,
        post_check: postCheck,
        finalized,
        blocked,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown mode" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[split-multi-module-orders] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
