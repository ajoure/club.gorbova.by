// PATCH-1: Repair Mismatch Orders - paid orders without successful payment
// Phase 1: Mark as review, do NOT revoke access
// BUILD_ID: repair-mismatch-2026-02-02-v1

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUILD_ID = "repair-mismatch-2026-02-02-v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RepairRequest {
  dry_run?: boolean;
  limit?: number;
}

interface MismatchOrder {
  order_id: string;
  order_number: string | null;
  order_status: string;
  payment_id: string;
  payment_status: string;
  provider_payment_id: string | null;
  amount: number;
  reason: string;
}

interface RepairResult {
  build_id: string;
  dry_run: boolean;
  total_mismatch: number;
  repaired_count: number;
  skipped_count: number;
  errors: number;
  error_samples: Array<{ order_id: string; error: string }>;
  mismatch_orders: MismatchOrder[];
}

serve(async (req) => {
  console.log(`[Repair-Mismatch] START build=${BUILD_ID}`);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth check
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header", build_id: BUILD_ID }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token", build_id: BUILD_ID }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from("user_roles_v2")
      .select("role_name")
      .eq("user_id", user.id);

    const isAdmin = roleData?.some((r: any) => 
      ["admin", "superadmin", "owner"].includes(r.role_name)
    );

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Admin access required", build_id: BUILD_ID }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({})) as RepairRequest;
    const dryRun = body.dry_run !== false; // Default true
    const limit = Math.min(body.limit || 100, 500);

    console.log(`[Repair-Mismatch] dry_run=${dryRun}, limit=${limit}`);

    const result: RepairResult = {
      build_id: BUILD_ID,
      dry_run: dryRun,
      total_mismatch: 0,
      repaired_count: 0,
      skipped_count: 0,
      errors: 0,
      error_samples: [],
      mismatch_orders: [],
    };

    // PHASE 1: Find mismatch orders
    // Condition: order.status = 'paid' AND (payment.status NOT IN ('succeeded', 'successful') OR payment.provider_payment_id IS NULL)
    
    const { data: mismatchData, error: queryErr } = await supabase
      .from("orders_v2")
      .select(`
        id,
        order_number,
        status,
        meta,
        payments_v2!payments_v2_order_id_fkey (
          id,
          status,
          provider_payment_id,
          amount
        )
      `)
      .eq("status", "paid")
      .limit(limit);

    if (queryErr) {
      throw new Error(`Query failed: ${queryErr.message}`);
    }

    // Filter to actual mismatches
    const successStatuses = ["succeeded", "successful", "refunded"];
    
    for (const order of mismatchData || []) {
      const payments = order.payments_v2 as any[] || [];
      
      // Check if ANY payment is successful
      const hasSuccessfulPayment = payments.some((p: any) => 
        successStatuses.includes(p.status) && p.provider_payment_id
      );

      if (hasSuccessfulPayment) {
        continue; // This order is OK
      }

      // Find the primary/latest payment
      const primaryPayment = payments[0] as any;
      
      if (!primaryPayment) {
        // Order paid but no payment record at all
        result.mismatch_orders.push({
          order_id: order.id,
          order_number: order.order_number,
          order_status: order.status,
          payment_id: "",
          payment_status: "NO_PAYMENT",
          provider_payment_id: null,
          amount: 0,
          reason: "no_payment_record",
        });
        result.total_mismatch++;
        continue;
      }

      // Determine reason
      let reason = "payment_not_succeeded";
      if (!primaryPayment.provider_payment_id) {
        reason = "missing_provider_payment_id";
      } else if (!successStatuses.includes(primaryPayment.status)) {
        reason = `payment_status_${primaryPayment.status}`;
      }

      result.mismatch_orders.push({
        order_id: order.id,
        order_number: order.order_number,
        order_status: order.status,
        payment_id: primaryPayment.id,
        payment_status: primaryPayment.status,
        provider_payment_id: primaryPayment.provider_payment_id,
        amount: primaryPayment.amount,
        reason,
      });
      result.total_mismatch++;
    }

    console.log(`[Repair-Mismatch] Found ${result.total_mismatch} mismatch orders`);

    // PHASE 2: Apply repairs (if not dry_run)
    if (!dryRun && result.mismatch_orders.length > 0) {
      for (const mismatch of result.mismatch_orders) {
        // Skip if already has needs_review
        const { data: existingOrder } = await supabase
          .from("orders_v2")
          .select("meta")
          .eq("id", mismatch.order_id)
          .single();

        const existingMeta = (existingOrder?.meta || {}) as any;
        
        if (existingMeta.needs_review === true) {
          result.skipped_count++;
          continue;
        }

        // Update order: status -> 'pending' (or 'review' if enum supports), add needs_review flag
        const newMeta = {
          ...existingMeta,
          needs_review: true,
          review_reason: "payment_status_mismatch",
          mismatch_details: {
            payment_id: mismatch.payment_id,
            payment_status: mismatch.payment_status,
            reason: mismatch.reason,
          },
          flagged_at: new Date().toISOString(),
          flagged_by: "admin-repair-mismatch-orders",
        };

        // Try 'review' status first, fallback to 'pending'
        const { error: updateErr } = await supabase
          .from("orders_v2")
          .update({
            status: "pending", // Safe fallback - 'pending' is always valid
            meta: newMeta,
            updated_at: new Date().toISOString(),
          })
          .eq("id", mismatch.order_id);

        if (updateErr) {
          result.errors++;
          if (result.error_samples.length < 20) {
            result.error_samples.push({ order_id: mismatch.order_id, error: updateErr.message });
          }
        } else {
          result.repaired_count++;
        }
      }
    }

    // PHASE 3: Audit log
    await supabase.from("audit_logs").insert({
      action: dryRun ? "mismatch_orders.dry_run" : "mismatch_orders.repair",
      actor_type: "admin",
      actor_user_id: user.id,
      actor_label: "admin-repair-mismatch-orders",
      meta: {
        build_id: BUILD_ID,
        dry_run: dryRun,
        total_mismatch: result.total_mismatch,
        repaired_count: result.repaired_count,
        skipped_count: result.skipped_count,
        errors: result.errors,
        order_ids: result.mismatch_orders.map(m => m.order_id),
      },
    });

    console.log(`[Repair-Mismatch] END build=${BUILD_ID} total=${result.total_mismatch} repaired=${result.repaired_count}`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Repair-Mismatch] ERROR: ${message}`);
    return new Response(
      JSON.stringify({ error: message, build_id: BUILD_ID }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
