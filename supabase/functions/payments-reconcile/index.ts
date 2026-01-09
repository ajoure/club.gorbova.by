import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    // Get bePaid credentials from integration_instances
    const { data: bepaidInstance } = await supabase
      .from("integration_instances")
      .select("config")
      .eq("provider", "bepaid")
      .in("status", ["active", "connected"])
      .single();

    if (!bepaidInstance?.config) {
      console.error("No active bePaid integration found");
      return new Response(JSON.stringify({ error: "No bePaid integration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shopId = bepaidInstance.config.shop_id;
    // Get secret from integration config (primary) or fallback to env
    const secretKey = bepaidInstance.config.secret_key || Deno.env.get("BEPAID_SECRET_KEY");

    if (!shopId || !secretKey) {
      console.error("Missing bePaid credentials - shop_id:", !!shopId, "secret_key:", !!secretKey);
      return new Response(JSON.stringify({ error: "Missing credentials" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    console.log("Using bePaid secret from:", bepaidInstance.config.secret_key ? "integration_instances" : "env");

    const results = {
      checked: 0,
      fixed: 0,
      queue_processed: 0,
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
    const { data: queueItems } = await supabase
      .from("payment_reconcile_queue")
      .select("*")
      .eq("status", "pending")
      .lte("next_retry_at", new Date().toISOString())
      .lt("attempts", 5)
      .order("created_at", { ascending: true })
      .limit(50);

    console.info(`Found ${queueItems?.length || 0} queue items to process`);

    for (const item of queueItems || []) {
      try {
        // Mark as processing
        await supabase
          .from("payment_reconcile_queue")
          .update({ status: "processing", attempts: item.attempts + 1 })
          .eq("id", item.id);

        let processed = false;

        // Try to match by tracking_id first
        if (item.tracking_id) {
          const { data: order } = await supabase
            .from("orders_v2")
            .select("*")
            .or(`id.eq.${item.tracking_id},order_number.eq.${item.tracking_id}`)
            .single();

          if (order) {
            await processQueueItem(supabase, item, order);
            processed = true;
            results.queue_processed++;
            results.details.push({
              queue_id: item.id,
              action: "queue_item_processed",
              order_number: order.order_number,
              bepaid_uid: item.bepaid_uid,
            });
          }
        }

        // Try to match by email + amount
        if (!processed && item.customer_email && item.amount) {
          const { data: order } = await supabase
            .from("orders_v2")
            .select("*")
            .eq("customer_email", item.customer_email)
            .eq("final_price", item.amount)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (order) {
            await processQueueItem(supabase, item, order);
            processed = true;
            results.queue_processed++;
            results.details.push({
              queue_id: item.id,
              action: "queue_item_processed_by_email",
              order_number: order.order_number,
              bepaid_uid: item.bepaid_uid,
            });
          }
        }

        if (!processed) {
          // Could not match - increment retry
          const nextRetry = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6 hours
          await supabase
            .from("payment_reconcile_queue")
            .update({
              status: "pending",
              next_retry_at: nextRetry.toISOString(),
              last_error: "Could not match to order",
            })
            .eq("id", item.id);
        }
      } catch (queueError) {
        console.error(`Error processing queue item ${item.id}:`, queueError);
        await supabase
          .from("payment_reconcile_queue")
          .update({
            status: "pending",
            last_error: String(queueError),
            next_retry_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
          })
          .eq("id", item.id);
        results.errors++;
      }
    }

    console.info("Payments reconciliation completed:", results);

    // Log the reconciliation run
    await supabase.from("audit_logs").insert({
      action: "payments_reconcile_cron",
      actor_user_id: "00000000-0000-0000-0000-000000000000",
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
    const auth = btoa(`${shopId}:${secretKey}`);
    const response = await fetch(
      `https://gateway.bepaid.by/transactions/${transactionUid}`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
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

async function processQueueItem(supabase: any, item: any, order: any) {
  const now = new Date();
  const payload = item.raw_payload || {};

  // Create payment record
  await supabase.from("payments_v2").insert({
    order_id: order.id,
    amount: item.amount || order.final_price,
    currency: item.currency || "BYN",
    provider: "bepaid",
    provider_payment_id: item.bepaid_uid,
    status: "succeeded",
    paid_at: payload.paid_at || now.toISOString(),
    card_brand: payload.credit_card?.brand,
    card_last4: payload.credit_card?.last_4,
    provider_response: payload,
  });

  // Fix order and create subscription
  await fixOrderAndCreateSubscription(supabase, order, {
    provider_payment_id: item.bepaid_uid,
  });

  // Mark queue item as completed
  await supabase
    .from("payment_reconcile_queue")
    .update({
      status: "completed",
      processed_at: now.toISOString(),
      processed_order_id: order.id,
    })
    .eq("id", item.id);
}

async function fixOrderAndCreateSubscription(
  supabase: any,
  order: any,
  payment: any
) {
  // Update order status to paid
  await supabase
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
    .eq("id", order.id);

  // Check if subscription already exists
  const { data: existingSub } = await supabase
    .from("subscriptions_v2")
    .select("id")
    .eq("order_id", order.id)
    .single();

  if (!existingSub && order.user_id && order.product_id) {
    // Get tariff details for access period
    let accessEndAt = new Date();
    accessEndAt.setMonth(accessEndAt.getMonth() + 1); // Default 1 month

    if (order.tariff_id) {
      const { data: tariff } = await supabase
        .from("tariffs")
        .select("access_duration_days")
        .eq("id", order.tariff_id)
        .single();

      if (tariff?.access_duration_days) {
        accessEndAt = new Date();
        accessEndAt.setDate(accessEndAt.getDate() + tariff.access_duration_days);
      }
    }

    // Create subscription
    await supabase.from("subscriptions_v2").insert({
      order_id: order.id,
      user_id: order.user_id,
      product_id: order.product_id,
      tariff_id: order.tariff_id,
      status: "active",
      access_start_at: new Date().toISOString(),
      access_end_at: accessEndAt.toISOString(),
      is_trial: false,
      meta: {
        source: "reconciliation",
        bepaid_uid: payment.provider_payment_id,
        reconciled_at: new Date().toISOString(),
      },
    });

    // Create entitlement
    const { data: product } = await supabase
      .from("products_v2")
      .select("code")
      .eq("id", order.product_id)
      .single();

    if (product?.code) {
      await supabase.from("entitlements").upsert(
        {
          user_id: order.user_id,
          product_code: product.code,
          status: "active",
          expires_at: accessEndAt.toISOString(),
          meta: { source: "reconciliation", order_id: order.id },
        },
        { onConflict: "user_id,product_code" }
      );
    }

    // Grant Telegram access
    try {
      await supabase.functions.invoke("telegram-grant-access", {
        body: { userId: order.user_id, productId: order.product_id },
      });
    } catch (e) {
      console.error("Error granting Telegram access:", e);
    }
  }

  console.info(`Fixed order ${order.order_number}`);
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
            .map((d: any) => `• ${d.order_number || d.queue_id}: ${d.action}`)
            .join("\n")
        : "");

    await supabase.functions.invoke("telegram-notify-admins", {
      body: { message, type: "reconciliation" },
    });
  } catch (e) {
    console.error("Error notifying admins:", e);
  }
}
