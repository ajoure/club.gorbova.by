import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * bepaid-fetch-transactions
 * 
 * Multi-level payment reconciliation:
 * 1. Fetch transactions from bePaid API
 * 2. Fetch subscriptions from bePaid API (catches direct subscription payments)
 * 3. Parse tracking_id to extract order_id and offer_id
 * 4. Create missing orders for orphan subscriptions
 */

interface BepaidTransaction {
  uid: string;
  status: string;
  amount: number;
  currency: string;
  description?: string;
  tracking_id?: string;
  created_at: string;
  paid_at?: string;
  credit_card?: {
    last_4: string;
    brand: string;
    exp_month?: number;
    exp_year?: number;
    token?: string;
  };
  customer?: {
    email?: string;
    ip?: string;
  };
}

interface BepaidSubscription {
  id: string;
  state: string;
  tracking_id?: string;
  created_at: string;
  plan?: {
    amount: number;
    currency: string;
    title?: string;
  };
  customer?: {
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
  };
  credit_card?: {
    last_4: string;
    brand: string;
    exp_month?: number;
    exp_year?: number;
    token?: string;
  };
  transactions?: Array<{
    uid: string;
    status: string;
    amount: number;
    paid_at?: string;
  }>;
}

interface ParsedTrackingId {
  orderId: string | null;
  offerId: string | null;
  isValid: boolean;
}

function parseTrackingId(trackingId?: string): ParsedTrackingId {
  if (!trackingId) {
    return { orderId: null, offerId: null, isValid: false };
  }

  // Format: {order_id}_{offer_id} where both are UUIDs
  const parts = trackingId.split("_");
  
  // UUID regex
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (parts.length === 2 && uuidRegex.test(parts[0])) {
    return {
      orderId: parts[0],
      offerId: uuidRegex.test(parts[1]) ? parts[1] : null,
      isValid: true,
    };
  }
  
  // Single UUID (old format - just order_id)
  if (parts.length === 1 && uuidRegex.test(parts[0])) {
    return { orderId: parts[0], offerId: null, isValid: true };
  }
  
  return { orderId: null, offerId: null, isValid: false };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  console.info("Starting bePaid transactions & subscriptions fetch...");

  try {
    // Get bePaid credentials
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
    
    console.log("Using bePaid credentials from:", bepaidInstance.config.secret_key ? "integration_instances" : "env");

    const auth = btoa(`${shopId}:${secretKey}`);
    const fromDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const toDate = new Date();

    const results = {
      transactions_fetched: 0,
      subscriptions_fetched: 0,
      orphan_orders_created: 0,
      payments_matched: 0,
      queued_for_review: 0,
      already_exists: 0,
      errors: 0,
      details: [] as any[],
    };

    // =================================================================
    // PART 1: Fetch Subscriptions (catches direct subscription payments)
    // =================================================================
    try {
      const subsResponse = await fetch(
        `https://api.bepaid.by/subscriptions?shop_id=${shopId}&per_page=100`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );

      if (subsResponse.ok) {
        const subsData = await subsResponse.json();
        const subscriptions: BepaidSubscription[] = subsData.subscriptions || [];
        results.subscriptions_fetched = subscriptions.length;
        console.info(`Fetched ${subscriptions.length} subscriptions from bePaid`);

        for (const sub of subscriptions) {
          // Only process active/trial subscriptions from recent period
          if (!["active", "trial", "past_due"].includes(sub.state)) continue;

          const createdAt = new Date(sub.created_at);
          if (createdAt < fromDate) continue;

          const parsed = parseTrackingId(sub.tracking_id);
          
          // Check if order exists
          if (parsed.orderId) {
            const { data: existingOrder } = await supabase
              .from("orders_v2")
              .select("id, status, bepaid_subscription_id")
              .eq("id", parsed.orderId)
              .maybeSingle();

            if (existingOrder) {
              // Order exists - update bepaid_subscription_id if missing
              if (!existingOrder.bepaid_subscription_id) {
                await supabase
                  .from("orders_v2")
                  .update({ bepaid_subscription_id: sub.id })
                  .eq("id", existingOrder.id);
              }
              results.already_exists++;
              continue;
            }

            // ORDER NOT FOUND - this is the Людмила case!
            // Create missing order from subscription data
            console.warn(`Orphan subscription found! tracking_id=${sub.tracking_id}, subscription_id=${sub.id}`);

            try {
              const createdOrder = await createOrderFromSubscription(
                supabase,
                sub,
                parsed.orderId,
                parsed.offerId
              );

              if (createdOrder) {
                results.orphan_orders_created++;
                results.details.push({
                  action: "orphan_order_created",
                  subscription_id: sub.id,
                  order_id: createdOrder.id,
                  order_number: createdOrder.order_number,
                  email: sub.customer?.email,
                  amount: sub.plan?.amount ? sub.plan.amount / 100 : null,
                });

                // Notify admins immediately
                await supabase.functions.invoke("telegram-notify-admins", {
                  body: {
                    message: `🔧 Создан пропущенный заказ!\n\n` +
                      `Подписка bePaid: ${sub.id}\n` +
                      `Email: ${sub.customer?.email || 'N/A'}\n` +
                      `Сумма: ${sub.plan?.amount ? sub.plan.amount / 100 : 'N/A'} ${sub.plan?.currency || 'BYN'}\n` +
                      `Заказ: ${createdOrder.order_number}`,
                    type: "orphan_order_created",
                  },
                });
              }
            } catch (createErr) {
              console.error(`Error creating order from subscription ${sub.id}:`, createErr);
              results.errors++;
              
              // Queue for manual review
              await supabase.from("payment_reconcile_queue").insert({
                bepaid_uid: sub.transactions?.[0]?.uid || null,
                tracking_id: sub.tracking_id,
                amount: sub.plan?.amount ? sub.plan.amount / 100 : null,
                currency: sub.plan?.currency || "BYN",
                customer_email: sub.customer?.email,
                raw_payload: sub,
                source: "subscription_fetch",
                status: "pending",
                last_error: String(createErr),
              });
              results.queued_for_review++;
            }
          } else {
            // No valid tracking_id - queue for review
            await supabase.from("payment_reconcile_queue").insert({
              bepaid_uid: sub.transactions?.[0]?.uid || null,
              tracking_id: sub.tracking_id,
              amount: sub.plan?.amount ? sub.plan.amount / 100 : null,
              currency: sub.plan?.currency || "BYN",
              customer_email: sub.customer?.email,
              raw_payload: sub,
              source: "subscription_fetch_no_tracking",
              status: "pending",
            });
            results.queued_for_review++;
          }
        }
      } else {
        console.error("Failed to fetch subscriptions:", await subsResponse.text());
      }
    } catch (subsErr) {
      console.error("Error fetching subscriptions:", subsErr);
    }

    // =================================================================
    // PART 2: Fetch Transactions (for direct payments not via subscriptions)
    // =================================================================
    const params = new URLSearchParams({
      created_at_from: fromDate.toISOString(),
      created_at_to: toDate.toISOString(),
      status: "successful",
      per_page: "100",
    });

    const txResponse = await fetch(
      `https://gateway.bepaid.by/transactions?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    if (txResponse.ok) {
      const txData = await txResponse.json();
      const transactions: BepaidTransaction[] = txData.transactions || [];
      results.transactions_fetched = transactions.length;
      console.info(`Fetched ${transactions.length} transactions from bePaid`);

      // Get existing payments
      const bepaidUids = transactions.map((t) => t.uid);
      const { data: existingPayments } = await supabase
        .from("payments_v2")
        .select("provider_payment_id")
        .in("provider_payment_id", bepaidUids);

      const existingUids = new Set(
        (existingPayments || []).map((p) => p.provider_payment_id)
      );

      // Get queued items
      const { data: queuedItems } = await supabase
        .from("payment_reconcile_queue")
        .select("bepaid_uid")
        .in("bepaid_uid", bepaidUids)
        .in("status", ["pending", "processing", "completed"]);

      const queuedUids = new Set((queuedItems || []).map((q) => q.bepaid_uid));

      for (const tx of transactions) {
        if (existingUids.has(tx.uid) || queuedUids.has(tx.uid)) {
          results.already_exists++;
          continue;
        }

        const parsed = parseTrackingId(tx.tracking_id);
        let order = null;

        // Try to find order by parsed order_id
        if (parsed.orderId) {
          const { data: orderById } = await supabase
            .from("orders_v2")
            .select("*")
            .eq("id", parsed.orderId)
            .maybeSingle();

          order = orderById;
        }

        // Fallback: try by email + amount
        if (!order && tx.customer?.email) {
          const amountBYN = tx.amount / 100;
          const { data: orderByEmail } = await supabase
            .from("orders_v2")
            .select("*")
            .eq("customer_email", tx.customer.email)
            .eq("final_price", amountBYN)
            .eq("status", "pending")
            .gte("created_at", fromDate.toISOString())
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          order = orderByEmail;
        }

        if (order) {
          await processTransaction(supabase, order, tx);
          results.payments_matched++;
          results.details.push({
            action: "transaction_matched",
            bepaid_uid: tx.uid,
            order_number: order.order_number,
          });
        } else {
          // Queue for review
          await supabase.from("payment_reconcile_queue").insert({
            bepaid_uid: tx.uid,
            tracking_id: tx.tracking_id,
            amount: tx.amount / 100,
            currency: tx.currency,
            customer_email: tx.customer?.email,
            raw_payload: tx,
            source: "transaction_fetch",
            status: "pending",
          });
          results.queued_for_review++;
        }
      }
    }

    console.info("bePaid fetch completed:", results);

    // Log the fetch run
    await supabase.from("audit_logs").insert({
      action: "bepaid_fetch_transactions_cron",
      actor_user_id: "00000000-0000-0000-0000-000000000000",
      meta: results,
    });

    // Notify admins if issues found
    if (results.orphan_orders_created > 0 || results.queued_for_review > 0) {
      await notifyAdmins(supabase, results);
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("bePaid fetch error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function createOrderFromSubscription(
  supabase: any,
  subscription: BepaidSubscription,
  orderId: string,
  offerId: string | null
): Promise<any> {
  const now = new Date();
  const amountBYN = subscription.plan?.amount ? subscription.plan.amount / 100 : 0;
  
  // Try to find user by email
  let userId: string | null = null;
  if (subscription.customer?.email) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("email", subscription.customer.email.toLowerCase())
      .maybeSingle();

    userId = profile?.user_id || null;
  }

  // Get offer details if offerId provided
  let productId: string | null = null;
  let tariffId: string | null = null;
  let flowId: string | null = null;

  if (offerId) {
    const { data: offer } = await supabase
      .from("tariff_offers")
      .select(`
        id,
        tariff_id,
        tariffs!inner (
          id,
          product_id,
          products_v2!inner (
            id
          )
        )
      `)
      .eq("id", offerId)
      .maybeSingle();

    if (offer) {
      tariffId = offer.tariff_id;
      productId = offer.tariffs?.product_id;
    }
  }

  // Generate order number
  const yearPart = now.getFullYear().toString().slice(-2);
  const { count } = await supabase
    .from("orders_v2")
    .select("id", { count: "exact", head: true })
    .like("order_number", `ORD-${yearPart}-%`);

  const seqPart = ((count || 0) + 1).toString().padStart(5, "0");
  const orderNumber = `ORD-${yearPart}-${seqPart}`;

  // Create order
  const { data: order, error } = await supabase
    .from("orders_v2")
    .insert({
      id: orderId, // Use the UUID from tracking_id
      order_number: orderNumber,
      user_id: userId,
      product_id: productId,
      tariff_id: tariffId,
      flow_id: flowId,
      base_price: amountBYN,
      final_price: amountBYN,
      currency: subscription.plan?.currency || "BYN",
      status: "paid",
      customer_email: subscription.customer?.email?.toLowerCase(),
      customer_phone: subscription.customer?.phone,
      bepaid_subscription_id: subscription.id,
      reconcile_source: "subscription_fetch",
      paid_amount: amountBYN,
      meta: {
        reconstructed_from_bepaid: true,
        bepaid_subscription_id: subscription.id,
        original_tracking_id: subscription.tracking_id,
        reconstructed_at: now.toISOString(),
        customer_first_name: subscription.customer?.first_name,
        customer_last_name: subscription.customer?.last_name,
      },
    })
    .select()
    .single();

  if (error) throw error;

  // Create payment record from first transaction
  const firstTx = subscription.transactions?.find(t => t.status === "successful");
  if (firstTx) {
    await supabase.from("payments_v2").insert({
      order_id: order.id,
      amount: amountBYN,
      currency: subscription.plan?.currency || "BYN",
      provider: "bepaid",
      provider_payment_id: firstTx.uid,
      status: "succeeded",
      paid_at: firstTx.paid_at || now.toISOString(),
      card_brand: subscription.credit_card?.brand,
      card_last4: subscription.credit_card?.last_4,
      provider_response: subscription,
    });
  }

  // Create subscription if user and product known
  if (userId && productId) {
    // Get access duration
    let accessEndAt = new Date();
    accessEndAt.setMonth(accessEndAt.getMonth() + 1);

    if (tariffId) {
      const { data: tariff } = await supabase
        .from("tariffs")
        .select("access_duration_days")
        .eq("id", tariffId)
        .single();

      if (tariff?.access_duration_days) {
        accessEndAt = new Date();
        accessEndAt.setDate(accessEndAt.getDate() + tariff.access_duration_days);
      }
    }

    await supabase.from("subscriptions_v2").insert({
      order_id: order.id,
      user_id: userId,
      product_id: productId,
      tariff_id: tariffId,
      status: "active",
      access_start_at: now.toISOString(),
      access_end_at: accessEndAt.toISOString(),
      is_trial: false,
      meta: {
        source: "bepaid_subscription_reconstruction",
        bepaid_subscription_id: subscription.id,
        reconstructed_at: now.toISOString(),
      },
    });

    // Create entitlement
    const { data: product } = await supabase
      .from("products_v2")
      .select("code")
      .eq("id", productId)
      .single();

    if (product?.code) {
      await supabase.from("entitlements").upsert(
        {
          user_id: userId,
          product_code: product.code,
          status: "active",
          expires_at: accessEndAt.toISOString(),
          meta: { source: "bepaid_reconstruction", order_id: order.id },
        },
        { onConflict: "user_id,product_code" }
      );
    }

    // Grant Telegram access
    try {
      await supabase.functions.invoke("telegram-grant-access", {
        body: { userId, productId },
      });
    } catch (e) {
      console.error("Error granting Telegram access:", e);
    }

    // Save card token if available
    if (subscription.credit_card?.token) {
      // Check if token already exists
      const { data: existingMethod } = await supabase
        .from("payment_methods")
        .select("id")
        .eq("user_id", userId)
        .eq("provider_token", subscription.credit_card.token)
        .maybeSingle();

      if (!existingMethod) {
        await supabase.from("payment_methods").insert({
          user_id: userId,
          provider: "bepaid",
          provider_token: subscription.credit_card.token,
          brand: subscription.credit_card.brand,
          last4: subscription.credit_card.last_4,
          exp_month: subscription.credit_card.exp_month,
          exp_year: subscription.credit_card.exp_year,
          status: "active",
          is_default: true,
        });
      }
    }
  }

  return order;
}

async function processTransaction(
  supabase: any,
  order: any,
  transaction: BepaidTransaction
) {
  const now = new Date();
  const amountBYN = transaction.amount / 100;

  // Create payment record
  await supabase.from("payments_v2").insert({
    order_id: order.id,
    amount: amountBYN,
    currency: transaction.currency,
    provider: "bepaid",
    provider_payment_id: transaction.uid,
    status: "succeeded",
    paid_at: transaction.paid_at || now.toISOString(),
    card_brand: transaction.credit_card?.brand,
    card_last4: transaction.credit_card?.last_4,
    provider_response: transaction,
  });

  // Update order
  await supabase
    .from("orders_v2")
    .update({
      status: "paid",
      paid_amount: amountBYN,
      reconcile_source: "transaction_fetch",
      meta: {
        ...order.meta,
        reconciled_at: now.toISOString(),
        reconciled_payment_id: transaction.uid,
      },
    })
    .eq("id", order.id);

  // Create subscription if needed
  if (order.user_id && order.product_id) {
    const { data: existingSub } = await supabase
      .from("subscriptions_v2")
      .select("id")
      .eq("order_id", order.id)
      .maybeSingle();

    if (!existingSub) {
      let accessEndAt = new Date();
      accessEndAt.setMonth(accessEndAt.getMonth() + 1);

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

      await supabase.from("subscriptions_v2").insert({
        order_id: order.id,
        user_id: order.user_id,
        product_id: order.product_id,
        tariff_id: order.tariff_id,
        status: "active",
        access_start_at: now.toISOString(),
        access_end_at: accessEndAt.toISOString(),
        is_trial: false,
        meta: { source: "bepaid_fetch", bepaid_uid: transaction.uid },
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
            meta: { source: "bepaid_fetch", order_id: order.id },
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
  }
}

async function notifyAdmins(supabase: any, results: any) {
  try {
    let message = `🔍 bePaid Reconciliation Report\n\n`;
    message += `📊 Транзакций: ${results.transactions_fetched}\n`;
    message += `📊 Подписок: ${results.subscriptions_fetched}\n`;
    
    if (results.orphan_orders_created > 0) {
      message += `\n⚠️ Создано пропущенных заказов: ${results.orphan_orders_created}\n`;
    }
    
    message += `✅ Платежей сопоставлено: ${results.payments_matched}\n`;
    message += `📋 В очередь на проверку: ${results.queued_for_review}\n`;
    message += `⏭️ Уже существует: ${results.already_exists}\n`;
    message += `❌ Ошибок: ${results.errors}`;

    if (results.details.length > 0) {
      message += `\n\nДетали:\n`;
      message += results.details
        .slice(0, 5)
        .map((d: any) => `• ${d.action}: ${d.order_number || d.bepaid_uid?.slice(0, 8) || 'N/A'}`)
        .join("\n");
    }

    await supabase.functions.invoke("telegram-notify-admins", {
      body: { message, type: "bepaid_reconciliation" },
    });
  } catch (e) {
    console.error("Error notifying admins:", e);
  }
}
