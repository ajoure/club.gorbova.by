// edge function: admin-repair-missing-payments

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// --------------- helpers ---------------

/** Extract UID from order meta with priority chain */
function extractUidFromMeta(meta: any): { uid: string; source: string } | null {
  if (!meta) return null;
  for (const key of ["transaction_uid", "bepaid_payment_uid", "provider_payment_id"]) {
    const val = meta[key];
    if (typeof val === "string" && val.length > 5) return { uid: val, source: `meta.${key}` };
  }
  return null;
}

/**
 * Extract UID from order — first from meta, then fallback to column orders_v2.provider_payment_id.
 * Column fallback restricted to provider='bepaid' (PATCH-INV20-REBILL-SUPERSEDED-2026-05).
 */
function extractOrderUid(order: any): { uid: string; source: string } | null {
  const fromMeta = extractUidFromMeta(order?.meta);
  if (fromMeta) return fromMeta;
  const col = order?.provider_payment_id;
  if (typeof col === "string" && col.length > 5 && order?.provider === "bepaid") {
    return { uid: col, source: "column.provider_payment_id" };
  }
  return null;
}

/** Chunk array into batches */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth
    const authHeaderVal = req.headers.get("Authorization");
    if (!authHeaderVal?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeaderVal } },
    });
    const { data: userRes, error: authError } = await supabaseAuth.auth.getUser();
    const user = userRes?.user;
    if (authError || !user) return json({ error: "Invalid token" }, 401);

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: isAdmin } = await supabase.rpc("has_role_v2", { _user_id: user.id, _role_code: "admin" });
    const { data: isSuperAdmin } = await supabase.rpc("has_role_v2", { _user_id: user.id, _role_code: "super_admin" });
    if (!isAdmin && !isSuperAdmin) return json({ error: "Admin access required" }, 403);

    // Params
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    const sinceDays = Math.min(Number(body.since_days) || 90, 365);
    const limit = Math.min(Number(body.limit) || 200, 500);
    const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

    // ========== Step 1: Find paid orders without payments_v2 ==========
    const { data: missingOrders, error: moErr } = await supabase
      .from("orders_v2")
      .select("id, order_number, user_id, profile_id, final_price, status, meta, created_at, product_id, currency, provider, provider_payment_id")
      .eq("status", "paid")
      .gte("created_at", sinceDate)
      .not("user_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (moErr) return json({ error: moErr.message }, 500);

    // Filter to only those truly without payments
    const orderIds = (missingOrders || []).map((o: any) => o.id);
    if (orderIds.length === 0) {
      return json({ ok: true, dry_run: dryRun, total_missing: 0, repaired: 0, superseded: 0, no_real_payment: 0, orphaned: 0, suppressed: 0, errors: [], duration_ms: Date.now() - startTime });
    }

    // Batch check existing payments
    let allExistingOrderIds = new Set<string>();
    for (const batch of chunk(orderIds, 100)) {
      const { data: ep } = await supabase.from("payments_v2").select("order_id").in("order_id", batch);
      for (const p of ep || []) allExistingOrderIds.add(p.order_id);
    }

    const ordersToRepair = (missingOrders || []).filter((o: any) => !allExistingOrderIds.has(o.id));

    if (ordersToRepair.length === 0) {
      return json({ ok: true, dry_run: dryRun, total_missing: 0, repaired: 0, superseded: 0, no_real_payment: 0, orphaned: 0, suppressed: 0, errors: [], duration_ms: Date.now() - startTime });
    }

    const totalMissing = ordersToRepair.length;

    // ========== Step 2: BATCH fetch webhook_events by tracking_id ==========
    // Build all candidate tracking_ids
    const repairOrderIds = ordersToRepair.map((o: any) => o.id);
    const candidateTrackingIds: string[] = [];
    for (const id of repairOrderIds) {
      candidateTrackingIds.push(`link:order:${id}`, `subv2:${id}`, id);
    }

    // Batch fetch webhook_events (max 100 per .in())
    const uidByOrderId = new Map<string, { uid: string; created_at: string; source: string }>();

    for (const batch of chunk(candidateTrackingIds, 100)) {
      const { data: weRows } = await supabase
        .from("webhook_events")
        .select("tracking_id, transaction_uid, created_at")
        .in("tracking_id", batch)
        .not("transaction_uid", "is", null);

      for (const we of weRows || []) {
        if (!we.transaction_uid || !we.tracking_id) continue;
        // Extract order_id from tracking_id
        let orderId: string | null = null;
        if (we.tracking_id.startsWith("link:order:")) orderId = we.tracking_id.replace("link:order:", "");
        else if (we.tracking_id.startsWith("subv2:")) orderId = we.tracking_id.replace("subv2:", "").split(":")[0];
        else if (repairOrderIds.includes(we.tracking_id)) orderId = we.tracking_id;

        if (orderId && !uidByOrderId.has(orderId)) {
          uidByOrderId.set(orderId, { uid: we.transaction_uid, created_at: we.created_at, source: "webhook_events.tracking_id" });
        }
      }
    }

    // ========== Step 2b: BATCH fetch audit_logs for remaining orders ==========
    const remainingIds = repairOrderIds.filter((id: string) => !uidByOrderId.has(id));

    if (remainingIds.length > 0) {
      // Batch audit_logs search: action LIKE 'bepaid.webhook%'
      const { data: auditRows } = await supabase
        .from("audit_logs")
        .select("meta")
        .like("action", "bepaid.webhook%")
        .gte("created_at", sinceDate)
        .limit(500);

      const remainingSet = new Set(remainingIds);
      for (const ar of auditRows || []) {
        const meta = ar.meta as any;
        if (!meta?.order_id || !remainingSet.has(meta.order_id)) continue;
        // Extract UID with priority chain
        const uid = meta.tx_uid || meta.transaction_uid || meta.bepaid_uid || meta.bepaid_payment_uid;
        if (uid && !uidByOrderId.has(meta.order_id)) {
          uidByOrderId.set(meta.order_id, { uid, created_at: meta.paid_at || sinceDate, source: "audit_logs.meta" });
        }
      }
    }

    // ========== Step 2c: Extract UID from order meta or column (column fallback restricted to bepaid) ==========
    // Note: collision check is deferred to Step 5 to ensure superseded classification has priority
    // over "normal repair" when a payment with the same UID already exists on a different order.
    for (const order of ordersToRepair) {
      if (uidByOrderId.has(order.id)) continue;
      const uid = extractOrderUid(order);
      if (uid) {
        uidByOrderId.set(order.id, { uid: uid.uid, created_at: order.created_at, source: uid.source });
      }
    }

    // ========== Step 3: Strategy 3 — Reconciled duplicates ==========
    // For orders still without UID: check if they were reconciled (meta.reconciled_by exists)
    // and a matching payment exists for same user/amount/time on a DIFFERENT order
    const reconciledOrders = ordersToRepair.filter((o: any) => {
      if (uidByOrderId.has(o.id)) return false;
      const m = o.meta as any;
      return m?.reconciled_by || m?.reconciled_from_payment_id;
    });

    const supersededDetails: any[] = [];

    if (reconciledOrders.length > 0) {
      // First try: if meta has a direct payment reference
      for (const order of reconciledOrders) {
        const m = order.meta as any;
        // Priority: reconciled_from_payment_id > bepaid_payment_uid > amount match
        const directPaymentId = m?.reconciled_from_payment_id;
        if (directPaymentId) {
          const { data: directP } = await supabase
            .from("payments_v2")
            .select("id, order_id, amount, provider_payment_id")
            .eq("id", directPaymentId)
            .limit(1);
          if (directP && directP.length > 0 && directP[0].order_id !== order.id) {
            supersededDetails.push({
              order_id: order.id,
              order_number: order.order_number,
              superseded_by_order: directP[0].order_id,
              reason: "reconciled_direct_payment_ref",
            });
            uidByOrderId.set(order.id, { uid: "__superseded__", created_at: order.created_at, source: "reconciled" });
            continue;
          }
        }

        // Try meta UID to find payment on another order
        const metaUid = extractUidFromMeta(m);
        if (metaUid) {
          const { data: uidP } = await supabase
            .from("payments_v2")
            .select("id, order_id")
            .eq("provider_payment_id", metaUid.uid)
            .limit(1);
          if (uidP && uidP.length > 0 && uidP[0].order_id !== order.id) {
            supersededDetails.push({
              order_id: order.id,
              order_number: order.order_number,
              superseded_by_order: uidP[0].order_id,
              reason: "reconciled_uid_collision",
            });
            uidByOrderId.set(order.id, { uid: "__superseded__", created_at: order.created_at, source: "reconciled" });
            continue;
          }
        }
      }

      // Fallback: amount+time matching for reconciled orders still unresolved
      const stillUnresolved = reconciledOrders.filter((o: any) => !uidByOrderId.has(o.id));
      if (stillUnresolved.length > 0) {
        const userIds = [...new Set(stillUnresolved.map((o: any) => o.user_id))];
        for (const userBatch of chunk(userIds, 20)) {
          const { data: userPayments } = await supabase
            .from("payments_v2")
            .select("id, order_id, user_id, amount, paid_at, status")
            .in("user_id", userBatch)
            .eq("status", "succeeded")
            .gte("paid_at", sinceDate);

          if (!userPayments) continue;

          for (const order of stillUnresolved) {
            if (uidByOrderId.has(order.id)) continue;
            if (!userBatch.includes(order.user_id)) continue;

            const orderDate = new Date(order.created_at).getTime();
            const match = userPayments.find((p: any) => {
              if (p.user_id !== order.user_id) return false;
              if (p.order_id === order.id) return false;
              if (Math.abs(Number(p.amount) - Number(order.final_price)) > 0.02) return false;
              const paidDate = new Date(p.paid_at).getTime();
              if (Math.abs(paidDate - orderDate) > 7 * 24 * 60 * 60 * 1000) return false;
              return true;
            });

            if (match) {
              // Verify the other order is also paid and same user
              const { data: otherOrder } = await supabase
                .from("orders_v2")
                .select("id, user_id, status, final_price")
                .eq("id", match.order_id)
                .limit(1);

              if (otherOrder && otherOrder.length > 0 &&
                  otherOrder[0].user_id === order.user_id &&
                  otherOrder[0].status === "paid" &&
                  Math.abs(Number(otherOrder[0].final_price) - Number(order.final_price)) < 0.02) {
                supersededDetails.push({
                  order_id: order.id,
                  order_number: order.order_number,
                  superseded_by_order: match.order_id,
                  reason: "reconciled_amount_time_match",
                });
                uidByOrderId.set(order.id, { uid: "__superseded__", created_at: order.created_at, source: "reconciled" });
              }
            }
          }
        }
      }
    }

    // ========== Step 4: Strategy 4 — Backfill artifacts ==========
    const noRealPaymentDetails: any[] = [];
    const backfillOrders = ordersToRepair.filter((o: any) => {
      if (uidByOrderId.has(o.id)) return false;
      const m = o.meta as any;
      return m?.source === "subscription-renewal" && (m?.backfill === true || m?.backfill === "true");
    });

    if (backfillOrders.length > 0) {
      const userIds = [...new Set(backfillOrders.map((o: any) => o.user_id))];
      for (const userBatch of chunk(userIds, 20)) {
        const { data: userPayments } = await supabase
          .from("payments_v2")
          .select("id, user_id, amount, product_id, paid_at")
          .in("user_id", userBatch)
          .eq("status", "succeeded")
          .gte("paid_at", sinceDate);

        for (const order of backfillOrders) {
          if (uidByOrderId.has(order.id)) continue;
          if (!userBatch.includes(order.user_id)) continue;

          const orderDate = new Date(order.created_at).getTime();
          const hasMatchingPayment = (userPayments || []).some((p: any) => {
            if (p.user_id !== order.user_id) return false;
            if (Math.abs(Number(p.amount) - Number(order.final_price)) > 0.02) return false;
            const paidDate = new Date(p.paid_at).getTime();
            if (Math.abs(paidDate - orderDate) > 7 * 24 * 60 * 60 * 1000) return false;
            // Match product_id if both are set
            if (order.product_id && p.product_id && order.product_id !== p.product_id) return false;
            return true;
          });

          if (!hasMatchingPayment) {
            noRealPaymentDetails.push({
              order_id: order.id,
              order_number: order.order_number,
              reason: "backfill_no_matching_payment",
            });
            uidByOrderId.set(order.id, { uid: "__no_real_payment__", created_at: order.created_at, source: "backfill" });
          }
        }
      }
    }

    // ========== Step 5: Strategy 5 — UID collision (meta UID points to another order's payment) ==========
    const collisionOrders = ordersToRepair.filter((o: any) => {
      if (uidByOrderId.has(o.id)) return false;
      return extractUidFromMeta(o.meta as any) !== null;
    });

    for (const order of collisionOrders) {
      const metaUid = extractUidFromMeta(order.meta as any)!;
      const { data: existP } = await supabase
        .from("payments_v2")
        .select("id, order_id")
        .eq("provider_payment_id", metaUid.uid)
        .limit(1);

      if (existP && existP.length > 0 && existP[0].order_id !== order.id) {
        supersededDetails.push({
          order_id: order.id,
          order_number: order.order_number,
          superseded_by_order: existP[0].order_id,
          reason: `uid_collision_via_${metaUid.source}`,
        });
        uidByOrderId.set(order.id, { uid: "__superseded__", created_at: order.created_at, source: "collision" });
      }
    }

    // ========== Step 6: Execute repairs ==========
    let repaired = 0;
    let superseded = 0;
    let noRealPayment = 0;
    let orphaned = 0;
    const errors: string[] = [];
    const repairedDetails: any[] = [];
    const orphanedDetails: any[] = [];

    for (const order of ordersToRepair) {
      const uidInfo = uidByOrderId.get(order.id);

      // --- Superseded ---
      if (uidInfo?.uid === "__superseded__") {
        superseded++;
        if (!dryRun) {
          const detail = supersededDetails.find((s: any) => s.order_id === order.id);
          await supabase
            .from("orders_v2")
            .update({
              meta: {
                ...(order.meta as any || {}),
                superseded_by_repair: true,
                superseded_by_order: detail?.superseded_by_order || null,
                superseded_reason: detail?.reason || "unknown",
                superseded_at: new Date().toISOString(),
                superseded_by_admin: user.id,
              },
            })
            .eq("id", order.id);
        }
        continue;
      }

      // --- No real payment (backfill artifact) ---
      if (uidInfo?.uid === "__no_real_payment__") {
        noRealPayment++;
        if (!dryRun) {
          await supabase
            .from("orders_v2")
            .update({
              meta: {
                ...(order.meta as any || {}),
                no_real_payment: true,
                no_real_payment_reason: "backfill_artifact",
                marked_at: new Date().toISOString(),
                marked_by_admin: user.id,
              },
            })
            .eq("id", order.id);
        }
        continue;
      }

      // --- No UID found at all → orphan ---
      if (!uidInfo) {
        orphaned++;
        orphanedDetails.push({ order_number: order.order_number, order_id: order.id });
        if (!dryRun) {
          try {
            await supabase.from("provider_webhook_orphans").upsert({
              provider: "bepaid",
              provider_payment_id: `repair:${order.id}`,
              reason: "missing_transaction_uid_repair",
              raw_data: {
                order_id: order.id,
                order_number: order.order_number,
                amount: order.final_price,
                repair_attempted_at: new Date().toISOString(),
              },
              processed: false,
            }, { onConflict: "provider,provider_payment_id", ignoreDuplicates: true });
          } catch (_) {}
        }
        continue;
      }

      // --- Normal repair: create payment ---
      const orderNum = order.order_number || "";
      const isRecurring = orderNum.startsWith("SUB-LINK-") || orderNum.startsWith("REN-");
      const sbsId = (order.meta as any)?.bepaid_subscription_id || null;

      repairedDetails.push({
        order_number: order.order_number,
        order_id: order.id,
        transaction_uid: uidInfo.uid,
        uid_source: uidInfo.source,
      });

      if (dryRun) {
        repaired++;
        continue;
      }

      const { error: insertErr } = await supabase
        .from("payments_v2")
        .insert({
          order_id: order.id,
          user_id: order.user_id,
          profile_id: order.profile_id || null,
          product_id: order.product_id || null,
          amount: order.final_price,
          currency: order.currency || "BYN",
          status: "succeeded",
          provider: "bepaid",
          provider_payment_id: uidInfo.uid,
          is_recurring: isRecurring,
          paid_at: uidInfo.created_at,
          meta: {
            source: "repair_missing_payment",
            repaired_at: new Date().toISOString(),
            tracking_id: `link:order:${order.id}`,
            bepaid_subscription_id: sbsId,
            repaired_by: user.id,
            repair_uid_source: uidInfo.source,
          },
        });

      if (insertErr) {
        if (insertErr.code === "23505") {
          console.log(`[repair] Payment already exists for order ${order.order_number} (uid=${uidInfo.uid})`);
          repaired++;
        } else {
          errors.push(`Insert failed for ${order.order_number}: ${insertErr.message}`);
        }
      } else {
        repaired++;
      }
    }

    // Audit log
    const auditAction = dryRun ? "admin.repair_missing_payment_dry_run" : "admin.repair_missing_payment";
    try {
      await supabase.from("audit_logs").insert({
        actor_type: dryRun ? "system" : "admin",
        actor_user_id: dryRun ? null : user.id,
        action: auditAction,
        meta: {
          total_missing: totalMissing,
          repaired,
          superseded,
          no_real_payment: noRealPayment,
          orphaned,
          errors_count: errors.length,
          since_days: sinceDays,
          limit,
          initiated_by: user.id,
        },
      });
    } catch (_) {}

    return json({
      ok: errors.length === 0,
      dry_run: dryRun,
      total_missing: totalMissing,
      repaired,
      superseded,
      no_real_payment: noRealPayment,
      orphaned,
      suppressed: superseded + noRealPayment,
      errors: errors.slice(0, 20),
      repaired_details: repairedDetails.slice(0, 20),
      superseded_details: supersededDetails.slice(0, 20),
      no_real_payment_details: noRealPaymentDetails.slice(0, 20),
      orphaned_details: orphanedDetails.slice(0, 20),
      duration_ms: Date.now() - startTime,
    });
  } catch (e: any) {
    console.error("[admin-repair-missing-payments] Fatal error:", e);
    return json({ error: e?.message || "Unknown error", duration_ms: Date.now() - startTime }, 500);
  }
});
