import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { reconcileExactQueuePayment } from "../_shared/bepaid-canonical-recovery.ts";
import { buildAdminNotifyMessage } from '../_shared/admin-notify-message.ts';
import { resolveAdminProfileName } from '../_shared/admin-profile-name.ts';
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';
import { staleProcessingCutoff } from '../_shared/bepaid-queue-policy.ts';
import { authorizePaymentsReconcile } from '../_shared/payments-reconcile-auth.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-payments-reconcile-cron-secret",
};

interface BepaidTransaction {
  transaction: {
    uid: string;
    status: string;
    amount: number;
    currency: string;
    description: string;
    tracking_id: string;
    created_at: string;
    paid_at: string;
    credit_card?: {
      last_4: string;
      brand: string;
    };
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  console.info("Starting payments reconciliation...");

  try {
    if (!await authorizePaymentsReconcile(req, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", supabase)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      console.error("Missing bePaid credentials:", credsResult.error);
      return new Response(JSON.stringify({ error: credsResult.error, code: 'BEPAID_CREDS_MISSING' }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const bepaidCreds = credsResult;
    const shopId = bepaidCreds.shop_id;
    const auth = createBepaidAuthHeader(bepaidCreds).replace('Basic ', ''); // For direct use or compatibility
    const secretKey = bepaidCreds.secret_key; // For checkBepaidTransaction function compatibility
    
    console.log("Using bePaid secret from strict integration_instances");

    const body = await req.json().catch(() => ({}));
    if (body.queueItemId) {
      const exact = await reconcileExactQueuePayment(supabase, {
        queueItemId: body.queueItemId, expectedUpdatedAt: body.expectedUpdatedAt,
        dryRun: body.dryRun === true || body.dry_run === true,
        providerAuth: createBepaidAuthHeader(bepaidCreds),
      });
      return new Response(JSON.stringify(exact), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (body.dryRun === true || body.dry_run === true) {
      return new Response(JSON.stringify({ error: "dry_run_requires_exact_queue_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results = {
      checked: 0,
      fixed: 0,
      queue_processed: 0,
      stale_recovered: 0,
      stale_terminal: 0,
      claim_conflicts: 0,
      errors: 0,
      details: [] as any[],
    };

    // =====================================================================
    // LEVEL 1: Process pending orders with local payment check
    // =====================================================================
    const { data: pendingOrders, error: ordersError } = await supabase
      .from("orders_v2")
      .select(`
        id,
        order_number,
        user_id,
        product_id,
        tariff_id,
        final_price,
        currency,
        customer_email,
        meta,
        created_at
      `)
      .eq("status", "pending")
      .gte("created_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false });

    if (ordersError) {
      console.error("Error fetching pending orders:", ordersError);
      throw ordersError;
    }

    console.info(`Found ${pendingOrders?.length || 0} pending orders to check`);

    for (const order of pendingOrders || []) {
      results.checked++;

      try {
        // Check if there's already a payment record for this order
        const { data: existingPayment } = await supabase
          .from("payments_v2")
          .select("id, status, provider_payment_id")
          .eq("order_id", order.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        // If payment exists and is succeeded but order is pending - fix it
        if (existingPayment?.status === "succeeded" && existingPayment.provider_payment_id) {
          console.info(`Order ${order.order_number} has succeeded payment but pending status - fixing...`);
          
          await fixOrderAndCreateSubscription(supabase, order, existingPayment);
          results.fixed++;
          results.details.push({
            order_number: order.order_number,
            action: "fixed_from_local_payment",
            provider_payment_id: existingPayment.provider_payment_id,
          });
          continue;
        }

        // If no payment or payment not succeeded, check with bePaid API
        if (existingPayment?.provider_payment_id) {
          const bepaidStatus = await checkBepaidTransaction(
            shopId,
            secretKey,
            existingPayment.provider_payment_id
          );

          if (bepaidStatus?.transaction?.status === "successful") {
            console.info(`Order ${order.order_number} - bePaid shows successful, fixing...`);
            
            // Update payment status
            await supabase
              .from("payments_v2")
              .update({
                status: "succeeded",
                paid_at: bepaidStatus.transaction.paid_at || new Date().toISOString(),
                error_message: null,
              })
              .eq("id", existingPayment.id);

            await fixOrderAndCreateSubscription(supabase, order, {
              ...existingPayment,
              provider_payment_id: bepaidStatus.transaction.uid,
            });
            
            results.fixed++;
            results.details.push({
              order_number: order.order_number,
              action: "fixed_from_bepaid_api",
              provider_payment_id: bepaidStatus.transaction.uid,
            });
          }
        }
      } catch (orderError) {
        console.error(`Error processing order ${order.order_number}:`, orderError);
        results.errors++;
        results.details.push({
          order_number: order.order_number,
          action: "error",
          error: String(orderError),
        });
      }
    }

    // =====================================================================
    // LEVEL 2: Check for orphan payments (succeeded payment, pending order)
    // =====================================================================
    const { data: orphanPayments } = await supabase
      .from("payments_v2")
      .select(`
        id,
        order_id,
        provider_payment_id,
        amount,
        orders_v2!inner (
          id,
          order_number,
          status,
          user_id,
          product_id,
          tariff_id,
          final_price,
          currency,
          customer_email,
          meta
        )
      `)
      .eq("status", "succeeded")
      .gte("created_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());

    for (const payment of orphanPayments || []) {
      const order = payment.orders_v2 as any;
      if (order?.status === "pending") {
        results.checked++;
        try {
          console.info(`Found orphan payment for order ${order.order_number} - fixing...`);
          await fixOrderAndCreateSubscription(supabase, order, payment);
          results.fixed++;
          results.details.push({
            order_number: order.order_number,
            action: "fixed_orphan_payment",
            provider_payment_id: payment.provider_payment_id,
          });
        } catch (err) {
          console.error(`Error fixing orphan payment:`, err);
          results.errors++;
        }
      }
    }

    // =====================================================================
    // LEVEL 3: Process payment_reconcile_queue (rejected webhooks)
    // =====================================================================
    const queueNow = new Date().toISOString();
    const processingCutoff = staleProcessingCutoff(new Date(queueNow));
    const { data: queueItems, error: queueFetchError } = await supabase
      .from("payment_reconcile_queue")
      .select("*")
      .or(`and(status.in.(pending,error),attempts.lt.5,or(next_retry_at.is.null,next_retry_at.lte.${queueNow})),and(status.eq.processing,updated_at.lt.${processingCutoff})`)
      .order("created_at", { ascending: true })
      .limit(50);

    if (queueFetchError) throw new Error(`Queue read failed: ${queueFetchError.message}`);

    console.info(`Found ${queueItems?.length || 0} queue items to process`);

    const queueDeadline = Date.now() + 60_000;
    for (const item of queueItems || []) {
      if (Date.now() >= queueDeadline) break;
      try {
        const outcome = await reconcileExactQueuePayment(supabase, {
          queueItemId: item.id, expectedUpdatedAt: item.updated_at,
          providerAuth: createBepaidAuthHeader(bepaidCreds),
        });
        results.queue_processed += outcome.results?.orders_reconciled || 0;
        results.stale_recovered += outcome.stale_recovered || 0;
        results.stale_terminal += outcome.stale_terminal || 0;
        results.claim_conflicts += outcome.claim_conflicts || 0;
      } catch {
        // The canonical worker alone owns error/lease writes. Never overwrite
        // an overlapping worker's row from this orchestrator.
        results.errors++;
      }
    }

    console.info("Payments reconciliation completed:", results);

    // Log the reconciliation run
    await supabase.from("audit_logs").insert({
      actor_user_id: null,
      actor_type: 'system',
      actor_label: 'payments-reconcile',
      action: "payments_reconcile_cron",
      meta: results,
    });

    // Send notification if any fixes were made
    if (results.fixed > 0 || results.queue_processed > 0) {
      await notifyAdmins(supabase, results);
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Reconciliation error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function checkBepaidTransaction(
  shopId: string,
  secretKey: string,
  transactionUid: string
): Promise<BepaidTransaction | null> {
  try {
    // PATCH-P0.9.1: Use createBepaidAuthHeader logic locally for now as this helper is simple
    const auth = `Basic ${btoa(`${shopId}:${secretKey}`)}`;
    const response = await fetch(
      `https://gateway.bepaid.by/transactions/${transactionUid}`,
      {
        method: "GET",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error(`bePaid API error: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("Error checking bePaid transaction:", error);
    return null;
  }
}

async function fixOrderAndCreateSubscription(
  supabase: any,
  order: any,
  payment: any
) {
  if (!order.user_id || !order.product_id) {
    throw new Error(
      `Order ${order.id} cannot be fulfilled without user_id and product_id`,
    );
  }

  // Update order status to paid and require an exact read-back before granting
  // access. A failed update must never be hidden behind a completed queue row.
  const { data: paidOrder, error: orderUpdateError } = await supabase
    .from("orders_v2")
    .update({
      status: "paid",
      paid_amount: order.final_price,
      meta: {
        ...order.meta,
        reconciled_at: new Date().toISOString(),
        reconciled_payment_id: payment.provider_payment_id,
      },
    })
    .eq("id", order.id)
    .select("id,status,user_id,product_id")
    .maybeSingle();

  if (
    orderUpdateError ||
    paidOrder?.status !== "paid" ||
    paidOrder?.user_id !== order.user_id ||
    paidOrder?.product_id !== order.product_id
  ) {
    throw new Error(
      `orders_v2 paid transition failed for order ${order.id}: ${
        orderUpdateError?.message || "paid order read-back mismatch"
      }`,
    );
  }

  // CANONICAL FULFILLMENT: delegate ALL access grants to grant-access-for-order
  // This replaces direct INSERT subscriptions_v2 + UPSERT entitlements + telegram-grant-access
  // which previously bypassed access_rules resolution and created partial access chains
  const { data: grantResult, error: grantError } = await supabase.functions.invoke('grant-access-for-order', {
    body: {
      orderId: order.id,
      grantTelegram: true,
      grantGetcourse: false,
    },
  });

  if (grantError) {
    throw new Error(
      `grant-access-for-order failed for order ${order.id}: ${grantError.message}`,
    );
  }

  if (grantResult?.success !== true) {
    throw new Error(
      `grant-access-for-order returned an unverified result for order ${order.id}: ${JSON.stringify(grantResult)}`,
    );
  }

  console.log(`[payments-reconcile] grant-access-for-order success for order ${order.id}:`, grantResult);

  // Notify admins about reconciled payment (preserved side-effect)
  try {
      const { data: product } = await supabase
        .from("products_v2")
        .select("code, name")
        .eq("id", order.product_id)
        .single();

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, first_name, last_name, email, telegram_username")
        .eq("user_id", order.user_id)
        .single();

      const { data: tariffData } = await supabase
        .from("tariffs")
        .select("name")
        .eq("id", order.tariff_id)
        .single();

      const adminMessage = buildAdminNotifyMessage({
        operation_type: 'reconciled_payment',
        client_name: resolveAdminProfileName(profile),
        email: profile?.email || order.customer_email,
        telegram_username: profile?.telegram_username,
        product_name: product?.name,
        tariff_name: tariffData?.name,
        amount: order.final_price,
        currency: order.currency || 'BYN',
        source_label: 'Платёж восстановлен',
      });

      const { data: notifyData, error: notifyError } = await supabase.functions.invoke("telegram-notify-admins", {
        body: { 
          message: adminMessage, 
          parse_mode: 'HTML',
          source: 'payments_reconcile_fix',
          order_id: order.id,
        },
      });

      if (notifyError) {
        console.error("Admin notification invoke error:", notifyError);
      } else if (notifyData?.sent === 0) {
        console.warn("Admin notification sent=0:", notifyData);
      } else {
        console.log("Reconcile fix admin notification sent:", notifyData);
      }
  } catch (adminNotifyError) {
    console.error("Admin notification error (non-critical):", adminNotifyError);
  }

  console.info(`Fixed order ${order.order_number || order.id}`);
}

async function notifyAdmins(supabase: any, results: any) {
  try {
    const message =
      `🔄 Reconciliation Report\n\n` +
      `Проверено заказов: ${results.checked}\n` +
      `Исправлено: ${results.fixed}\n` +
      `Из очереди: ${results.queue_processed}\n` +
      `Ошибок: ${results.errors}\n\n` +
      (results.details.length > 0
        ? results.details
            .slice(0, 10)
            .map((d: any) => `• ${d.order_number || d.order_id || d.queue_id}: ${d.action}`)
            .join("\n")
        : "");

    const { data: notifyData, error: notifyError } = await supabase.functions.invoke("telegram-notify-admins", {
      body: { 
        message, 
        source: 'payments_reconcile',
      },
    });
    
    if (notifyError) {
      console.error("Admin notification invoke error:", notifyError);
    } else if (notifyData?.sent === 0) {
      console.warn("Admin notification sent=0:", notifyData);
    } else {
      console.log("Reconcile admin notification sent:", notifyData);
    }
  } catch (e) {
    console.error("Error notifying admins:", e);
  }
}
