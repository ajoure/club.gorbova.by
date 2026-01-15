import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * bepaid-fetch-transactions
 * 
 * PATCH 1: Configurable sync window with watermark
 * PATCH 3: Proper deduplication with upsert
 * 
 * Config options (in integration_instances.config):
 * - sync_window_hours: default 168 (7 days)
 * - sync_overlap_hours: default 48
 * - sync_page_size: default 100
 * - sync_max_pages: default 10
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

interface SyncConfig {
  sync_window_hours: number;
  sync_overlap_hours: number;
  sync_page_size: number;
  sync_max_pages: number;
}

const DEFAULT_CONFIG: SyncConfig = {
  sync_window_hours: 168, // 7 days
  sync_overlap_hours: 48,
  sync_page_size: 100,
  sync_max_pages: 10,
};

function parseTrackingId(trackingId?: string): ParsedTrackingId {
  if (!trackingId) {
    return { orderId: null, offerId: null, isValid: false };
  }

  const parts = trackingId.split("_");
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (parts.length === 2 && uuidRegex.test(parts[0])) {
    return {
      orderId: parts[0],
      offerId: uuidRegex.test(parts[1]) ? parts[1] : null,
      isValid: true,
    };
  }
  
  if (parts.length === 1 && uuidRegex.test(parts[0])) {
    return { orderId: parts[0], offerId: null, isValid: true };
  }
  
  return { orderId: null, offerId: null, isValid: false };
}

function normalizeTransactionStatus(status: string): string {
  switch (status?.toLowerCase()) {
    case 'successful':
    case 'success':
      return 'successful';
    case 'failed':
    case 'declined':
    case 'expired':
    case 'error':
      return 'failed';
    case 'incomplete':
    case 'processing':
    case 'pending':
      return 'pending';
    case 'refunded':
    case 'voided':
    case 'refund':
      return 'refunded';
    default:
      return 'unknown';
  }
}

function determineTransactionType(tx: BepaidTransaction): string {
  const rawPayload = tx as any;
  if (rawPayload.type === 'refund' || rawPayload.refund_reason) {
    return 'Возврат средств';
  }
  if (rawPayload.type === 'authorization') {
    return 'Авторизация';
  }
  return 'Оплата';
}

// Calculate backoff delay for retry
function calculateBackoffDelay(attempts: number): number {
  // Exponential backoff: 5min, 15min, 45min, 2h, 6h
  const delays = [5, 15, 45, 120, 360];
  const idx = Math.min(attempts, delays.length - 1);
  return delays[idx] * 60 * 1000; // Return in milliseconds
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Parse request body for override options
  const body = await req.json().catch(() => ({}));
  const forceFullSync = body.forceFullSync === true;
  const customWindowHours = body.windowHours;

  console.info("Starting bePaid transactions & subscriptions fetch...");
  console.info(`Options: forceFullSync=${forceFullSync}, customWindowHours=${customWindowHours}`);

  // Create sync log entry
  const { data: syncLog } = await supabase
    .from("bepaid_sync_logs")
    .insert({
      sync_type: "fetch_transactions",
      status: "running",
    })
    .select()
    .single();

  const syncLogId = syncLog?.id;

  try {
    // Get bePaid credentials and config
    const { data: bepaidInstance } = await supabase
      .from("integration_instances")
      .select("id, config, last_successful_sync_at")
      .eq("provider", "bepaid")
      .in("status", ["active", "connected"])
      .single();

    if (!bepaidInstance?.config) {
      console.error("No active bePaid integration found");
      await updateSyncLog(supabase, syncLogId, { status: "failed", error_message: "No bePaid integration" });
      return new Response(JSON.stringify({ error: "No bePaid integration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shopId = bepaidInstance.config.shop_id;
    const secretKey = bepaidInstance.config.secret_key || Deno.env.get("BEPAID_SECRET_KEY");

    if (!shopId || !secretKey) {
      console.error("Missing bePaid credentials");
      await updateSyncLog(supabase, syncLogId, { status: "failed", error_message: "Missing credentials" });
      return new Response(JSON.stringify({ error: "Missing credentials" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PATCH 1: Get sync config with watermark logic
    const config: SyncConfig = {
      sync_window_hours: bepaidInstance.config.sync_window_hours || DEFAULT_CONFIG.sync_window_hours,
      sync_overlap_hours: bepaidInstance.config.sync_overlap_hours || DEFAULT_CONFIG.sync_overlap_hours,
      sync_page_size: bepaidInstance.config.sync_page_size || DEFAULT_CONFIG.sync_page_size,
      sync_max_pages: bepaidInstance.config.sync_max_pages || DEFAULT_CONFIG.sync_max_pages,
    };

    // Override with custom window if provided
    if (customWindowHours) {
      config.sync_window_hours = customWindowHours;
    }

    // Calculate date range using watermark
    const now = new Date();
    let fromDate: Date;

    if (forceFullSync) {
      // Force full sync: go back sync_window_hours
      fromDate = new Date(now.getTime() - config.sync_window_hours * 60 * 60 * 1000);
    } else if (bepaidInstance.last_successful_sync_at) {
      // Use watermark with overlap
      const watermark = new Date(bepaidInstance.last_successful_sync_at);
      fromDate = new Date(watermark.getTime() - config.sync_overlap_hours * 60 * 60 * 1000);
    } else {
      // No watermark - use default window
      fromDate = new Date(now.getTime() - config.sync_window_hours * 60 * 60 * 1000);
    }

    const toDate = now;

    console.log(`Sync config: window=${config.sync_window_hours}h, overlap=${config.sync_overlap_hours}h`);
    console.log(`Date range: from=${fromDate.toISOString()} to=${toDate.toISOString()}`);
    console.log(`Shop ID: ${shopId}`);

    await updateSyncLog(supabase, syncLogId, {
      shop_id: String(shopId),
      from_date: fromDate.toISOString(),
      to_date: toDate.toISOString(),
    });

    const auth = btoa(`${shopId}:${secretKey}`);

    const results = {
      transactions_fetched: 0,
      subscriptions_fetched: 0,
      orphan_orders_created: 0,
      payments_matched: 0,
      queued_for_review: 0,
      already_exists: 0,
      upserted: 0,
      errors: 0,
      pages_fetched: 0,
      sample_uids: [] as string[],
      details: [] as any[],
    };

    // =================================================================
    // PART 1: Fetch Subscriptions
    // =================================================================
    try {
      // NOTE: bePaid does not allow Content-Type header for GET requests
      const subsResponse = await fetch(
        `https://api.bepaid.by/subscriptions?shop_id=${shopId}&per_page=${config.sync_page_size}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
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
          if (!["active", "trial", "past_due"].includes(sub.state)) continue;

          const createdAt = new Date(sub.created_at);
          if (createdAt < fromDate) continue;

          const parsed = parseTrackingId(sub.tracking_id);
          
          if (parsed.orderId) {
            const { data: existingOrder } = await supabase
              .from("orders_v2")
              .select("id, status, bepaid_subscription_id")
              .eq("id", parsed.orderId)
              .maybeSingle();

            if (existingOrder) {
              if (!existingOrder.bepaid_subscription_id) {
                await supabase
                  .from("orders_v2")
                  .update({ bepaid_subscription_id: sub.id })
                  .eq("id", existingOrder.id);
              }
              results.already_exists++;
              continue;
            }

            console.warn(`Orphan subscription found! tracking_id=${sub.tracking_id}`);

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
              
              // PATCH 3: Use upsert for queue with provider
              await supabase.from("payment_reconcile_queue").upsert({
                provider: "bepaid",
                bepaid_uid: sub.transactions?.[0]?.uid || `sub_${sub.id}`,
                tracking_id: sub.tracking_id,
                amount: sub.plan?.amount ? sub.plan.amount / 100 : null,
                currency: sub.plan?.currency || "BYN",
                customer_email: sub.customer?.email,
                raw_payload: sub,
                source: "subscription_fetch",
                status: "error",
                last_error: String(createErr),
                attempts: 1,
                last_attempt_at: new Date().toISOString(),
                next_retry_at: new Date(Date.now() + calculateBackoffDelay(1)).toISOString(),
              }, { onConflict: 'provider,bepaid_uid', ignoreDuplicates: false });
              results.queued_for_review++;
            }
          } else {
            // PATCH 3: Use upsert with provider
            await supabase.from("payment_reconcile_queue").upsert({
              provider: "bepaid",
              bepaid_uid: sub.transactions?.[0]?.uid || `sub_${sub.id}`,
              tracking_id: sub.tracking_id,
              amount: sub.plan?.amount ? sub.plan.amount / 100 : null,
              currency: sub.plan?.currency || "BYN",
              customer_email: sub.customer?.email,
              raw_payload: sub,
              source: "subscription_fetch_no_tracking",
              status: "pending",
            }, { onConflict: 'provider,bepaid_uid', ignoreDuplicates: false });
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
    // PART 2: Fetch Transactions with pagination
    // =================================================================
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages && currentPage <= config.sync_max_pages) {
      // Use gateway.bepaid.by/transactions with query params (same as subscriptions endpoint pattern)
      const params = new URLSearchParams({
        shop_id: String(shopId),
        created_at_gteq: fromDate.toISOString(),
        created_at_lteq: toDate.toISOString(),
        per_page: String(config.sync_page_size),
        page: String(currentPage),
      });

      console.log(`Fetching transactions page ${currentPage}...`);
      console.info(`Query params: ${params.toString()}`);

      // bePaid transactions endpoint - same pattern as subscriptions
      const txResponse = await fetch(
        `https://api.bepaid.by/transactions?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
          },
        }
      );

      if (!txResponse.ok) {
        const errorText = await txResponse.text();
        console.error(`Failed to fetch transactions page ${currentPage}: ${txResponse.status} ${errorText}`);
        break;
      }

      const txData = await txResponse.json();
      // Reports API returns transactions in 'transactions' array
      const transactions: BepaidTransaction[] = txData.transactions || txData.report?.transactions || [];
      
      results.pages_fetched++;
      results.transactions_fetched += transactions.length;
      
      console.info(`Page ${currentPage}: fetched ${transactions.length} transactions`);

      if (transactions.length === 0) {
        hasMorePages = false;
        break;
      }

      // Collect sample UIDs for logging
      if (results.sample_uids.length < 5) {
        results.sample_uids.push(...transactions.slice(0, 5 - results.sample_uids.length).map(t => t.uid));
      }

      // Get existing payments in batch
      const bepaidUids = transactions.map((t) => t.uid);
      const { data: existingPayments } = await supabase
        .from("payments_v2")
        .select("provider_payment_id")
        .in("provider_payment_id", bepaidUids);

      const existingUids = new Set(
        (existingPayments || []).map((p) => p.provider_payment_id)
      );

      for (const tx of transactions) {
        const parsed = parseTrackingId(tx.tracking_id);
        const normalizedStatus = normalizeTransactionStatus(tx.status);
        const transactionType = determineTransactionType(tx);

        // If already in payments_v2, skip
        if (existingUids.has(tx.uid)) {
          results.already_exists++;
          continue;
        }

        let order = null;

        // Try to find order by tracking_id
        if (parsed.orderId) {
          const { data: orderById } = await supabase
            .from("orders_v2")
            .select("*")
            .eq("id", parsed.orderId)
            .maybeSingle();

          order = orderById;
        }

        // Fallback: try by email + amount for pending orders
        if (!order && tx.customer?.email && tx.status === 'successful') {
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

        if (order && tx.status === 'successful') {
          // Process successful transaction directly
          await processTransaction(supabase, order, tx);
          results.payments_matched++;
          results.details.push({
            action: "transaction_matched",
            bepaid_uid: tx.uid,
            order_number: order.order_number,
          });
        } else {
          // PATCH 3: Always upsert to queue - handles ALL statuses
          // Check if item exists with error status for retry logic
          const { data: existingQueueItem } = await supabase
            .from("payment_reconcile_queue")
            .select("id, status, attempts")
            .eq("bepaid_uid", tx.uid)
            .maybeSingle();

          const queueStatus = tx.status === 'successful' ? "pending" : "error";
          const attempts = existingQueueItem?.attempts || 0;
          const isRetry = existingQueueItem?.status === 'error';

          await supabase.from("payment_reconcile_queue").upsert({
            provider: "bepaid",
            bepaid_uid: tx.uid,
            tracking_id: tx.tracking_id,
            amount: tx.amount / 100,
            currency: tx.currency,
            customer_email: tx.customer?.email,
            raw_payload: tx,
            source: "transaction_fetch",
            status: queueStatus,
            status_normalized: normalizedStatus,
            transaction_type: transactionType,
            paid_at: tx.paid_at || tx.created_at,
            last_error: tx.status !== 'successful' ? `Transaction status: ${tx.status}` : null,
            // Retry logic fields
            attempts: isRetry ? attempts + 1 : attempts,
            last_attempt_at: isRetry ? new Date().toISOString() : null,
            next_retry_at: queueStatus === 'error' 
              ? new Date(Date.now() + calculateBackoffDelay(attempts)).toISOString() 
              : null,
          }, { onConflict: 'provider,bepaid_uid', ignoreDuplicates: false });

          results.upserted++;
          if (!existingQueueItem) {
            results.queued_for_review++;
          }
        }
      }

      // Check if we need more pages
      if (transactions.length < config.sync_page_size) {
        hasMorePages = false;
      } else {
        currentPage++;
      }
    }

    console.info("bePaid fetch completed:", results);

    // Update watermark only on full success
    if (results.errors === 0) {
      await supabase
        .from("integration_instances")
        .update({ last_successful_sync_at: toDate.toISOString() })
        .eq("id", bepaidInstance.id);
      
      console.log(`Updated watermark to ${toDate.toISOString()}`);
    } else {
      console.warn(`Skipping watermark update due to ${results.errors} errors`);
    }

    // Update sync log
    await updateSyncLog(supabase, syncLogId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      pages_fetched: results.pages_fetched,
      transactions_fetched: results.transactions_fetched,
      subscriptions_fetched: results.subscriptions_fetched,
      already_exists: results.already_exists,
      queued: results.queued_for_review,
      processed: results.payments_matched,
      errors: results.errors,
      sample_uids: results.sample_uids,
      meta: { config, force_full_sync: forceFullSync },
    });

    // Log to audit_logs
    await supabase.from("audit_logs").insert({
      actor_user_id: null,
      actor_type: 'system',
      actor_label: 'bepaid-fetch-transactions',
      action: "bepaid_fetch_transactions_cron",
      meta: {
        shop_id: shopId,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        pages: results.pages_fetched,
        fetched: results.transactions_fetched,
        enqueued: results.queued_for_review,
        already_exists: results.already_exists,
        errors: results.errors,
        sample_uids: results.sample_uids,
      },
    });

    // Notify admins if issues found
    if (results.orphan_orders_created > 0 || results.errors > 0) {
      await notifyAdmins(supabase, results);
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("bePaid fetch error:", error);
    await updateSyncLog(supabase, syncLogId, {
      status: "failed",
      error_message: String(error),
      completed_at: new Date().toISOString(),
    });
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function updateSyncLog(supabase: any, syncLogId: string | null, updates: any) {
  if (!syncLogId) return;
  await supabase
    .from("bepaid_sync_logs")
    .update(updates)
    .eq("id", syncLogId);
}

async function createOrderFromSubscription(
  supabase: any,
  subscription: BepaidSubscription,
  orderId: string,
  offerId: string | null
): Promise<any> {
  const now = new Date();
  const amountBYN = subscription.plan?.amount ? subscription.plan.amount / 100 : 0;
  
  let userId: string | null = null;
  if (subscription.customer?.email) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("email", subscription.customer.email.toLowerCase())
      .maybeSingle();

    userId = profile?.user_id || null;
  }

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

  const yearPart = now.getFullYear().toString().slice(-2);
  const { count } = await supabase
    .from("orders_v2")
    .select("id", { count: "exact", head: true })
    .like("order_number", `ORD-${yearPart}-%`);

  const seqPart = ((count || 0) + 1).toString().padStart(5, "0");
  const orderNumber = `ORD-${yearPart}-${seqPart}`;

  const { data: order, error } = await supabase
    .from("orders_v2")
    .insert({
      id: orderId,
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

  if (userId && productId) {
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

    const { data: product } = await supabase
      .from("products_v2")
      .select("code")
      .eq("id", productId)
      .single();

    if (product?.code) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", userId)
        .single();
      const profileId = profileData?.id || null;
      
      await supabase.from("entitlements").upsert(
        {
          user_id: userId,
          profile_id: profileId,
          order_id: order.id,
          product_code: product.code,
          status: "active",
          expires_at: accessEndAt.toISOString(),
          meta: { source: "bepaid_reconstruction", order_id: order.id },
        },
        { onConflict: "user_id,product_code" }
      );
    }

    try {
      await supabase.functions.invoke("telegram-grant-access", {
        body: { userId, productId },
      });
    } catch (e) {
      console.error("Error granting Telegram access:", e);
    }

    if (subscription.credit_card?.token) {
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

      const { data: product } = await supabase
        .from("products_v2")
        .select("code")
        .eq("id", order.product_id)
        .single();

      if (product?.code) {
        const profileId = order.profile_id || null;
        await supabase.from("entitlements").upsert(
          {
            user_id: order.user_id,
            profile_id: profileId,
            order_id: order.id,
            product_code: product.code,
            status: "active",
            expires_at: accessEndAt.toISOString(),
            meta: { source: "bepaid_fetch", order_id: order.id },
          },
          { onConflict: "user_id,product_code" }
        );
      }

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
    message += `📄 Страниц: ${results.pages_fetched}\n`;
    
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
