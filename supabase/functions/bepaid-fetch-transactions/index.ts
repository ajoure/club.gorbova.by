import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * bepaid-fetch-transactions
 * 
 * Secondary channel for payment reconciliation.
 * Fetches transactions directly from bePaid API and creates missing orders/subscriptions.
 * 
 * This provides a backup mechanism when webhooks fail due to:
 * - Invalid signature (old secret key)
 * - Network issues
 * - Direct payments via bePaid links (bypassing our order creation)
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
  };
  customer?: {
    email?: string;
    ip?: string;
  };
  additional_data?: {
    receipt?: string[];
  };
}

interface BepaidTransactionsResponse {
  transactions: BepaidTransaction[];
  page?: number;
  per_page?: number;
  total?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  console.info("Starting bePaid transactions fetch...");

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
    const secretKey = Deno.env.get("BEPAID_SECRET_KEY");

    if (!shopId || !secretKey) {
      console.error("Missing bePaid credentials");
      return new Response(JSON.stringify({ error: "Missing credentials" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch transactions from last 48 hours
    const fromDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const toDate = new Date();

    const results = {
      fetched: 0,
      new_found: 0,
      orders_created: 0,
      already_exists: 0,
      errors: 0,
      details: [] as any[],
    };

    // Fetch successful transactions from bePaid
    const auth = btoa(`${shopId}:${secretKey}`);
    const params = new URLSearchParams({
      created_at_from: fromDate.toISOString(),
      created_at_to: toDate.toISOString(),
      status: "successful",
      per_page: "100",
    });

    const response = await fetch(
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`bePaid API error: ${response.status}`, errorText);
      return new Response(
        JSON.stringify({ error: `bePaid API error: ${response.status}` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data: BepaidTransactionsResponse = await response.json();
    results.fetched = data.transactions?.length || 0;

    console.info(`Fetched ${results.fetched} transactions from bePaid`);

    // Get all existing payments by provider_payment_id for quick lookup
    const bepaidUids = (data.transactions || []).map((t) => t.uid);
    
    const { data: existingPayments } = await supabase
      .from("payments_v2")
      .select("provider_payment_id")
      .in("provider_payment_id", bepaidUids);

    const existingUids = new Set(
      (existingPayments || []).map((p) => p.provider_payment_id)
    );

    // Check reconcile queue for already queued transactions
    const { data: queuedItems } = await supabase
      .from("payment_reconcile_queue")
      .select("bepaid_uid")
      .in("bepaid_uid", bepaidUids)
      .in("status", ["pending", "processing", "completed"]);

    const queuedUids = new Set((queuedItems || []).map((q) => q.bepaid_uid));

    // Process each transaction
    for (const transaction of data.transactions || []) {
      try {
        // Skip if already exists in payments
        if (existingUids.has(transaction.uid)) {
          results.already_exists++;
          continue;
        }

        // Skip if already in queue
        if (queuedUids.has(transaction.uid)) {
          results.already_exists++;
          continue;
        }

        results.new_found++;

        // Try to find order by tracking_id if available
        let order = null;
        if (transaction.tracking_id) {
          const { data: orderByTracking } = await supabase
            .from("orders_v2")
            .select("*")
            .or(`id.eq.${transaction.tracking_id},order_number.eq.${transaction.tracking_id}`)
            .single();

          order = orderByTracking;
        }

        // If no order found by tracking_id, try to match by email + amount
        if (!order && transaction.customer?.email) {
          const amountBYN = transaction.amount / 100; // Convert from kopecks

          const { data: orderByEmail } = await supabase
            .from("orders_v2")
            .select("*")
            .eq("customer_email", transaction.customer.email)
            .eq("final_price", amountBYN)
            .eq("status", "pending")
            .gte("created_at", fromDate.toISOString())
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          order = orderByEmail;
        }

        if (order) {
          // Found matching order - complete it
          await processFoundOrder(supabase, order, transaction);
          results.orders_created++;
          results.details.push({
            bepaid_uid: transaction.uid,
            action: "order_completed",
            order_number: order.order_number,
            email: transaction.customer?.email,
          });
        } else {
          // No matching order - add to reconcile queue for manual review
          await supabase.from("payment_reconcile_queue").insert({
            bepaid_uid: transaction.uid,
            tracking_id: transaction.tracking_id,
            amount: transaction.amount / 100,
            currency: transaction.currency,
            customer_email: transaction.customer?.email,
            raw_payload: transaction,
            source: "api_fetch",
            status: "pending",
          });

          results.details.push({
            bepaid_uid: transaction.uid,
            action: "queued_for_review",
            email: transaction.customer?.email,
            amount: transaction.amount / 100,
          });
        }
      } catch (txError) {
        console.error(`Error processing transaction ${transaction.uid}:`, txError);
        results.errors++;
        results.details.push({
          bepaid_uid: transaction.uid,
          action: "error",
          error: String(txError),
        });
      }
    }

    console.info("bePaid fetch completed:", results);

    // Log the fetch run
    await supabase.from("audit_logs").insert({
      action: "bepaid_fetch_transactions_cron",
      actor_user_id: "00000000-0000-0000-0000-000000000000",
      meta: results,
    });

    // Notify admins if new transactions were found
    if (results.new_found > 0) {
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

async function processFoundOrder(
  supabase: any,
  order: any,
  transaction: BepaidTransaction
) {
  const now = new Date();
  const amountBYN = transaction.amount / 100;

  // Create payment record
  const { data: payment } = await supabase
    .from("payments_v2")
    .insert({
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
    })
    .select()
    .single();

  // Update order status
  await supabase
    .from("orders_v2")
    .update({
      status: "paid",
      paid_amount: amountBYN,
      meta: {
        ...order.meta,
        reconciled_at: now.toISOString(),
        reconciled_payment_id: transaction.uid,
        reconcile_source: "bepaid_fetch",
      },
    })
    .eq("id", order.id);

  // Create subscription if needed
  if (order.user_id && order.product_id) {
    // Check if subscription already exists
    const { data: existingSub } = await supabase
      .from("subscriptions_v2")
      .select("id")
      .eq("order_id", order.id)
      .single();

    if (!existingSub) {
      // Get tariff for access period
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
        meta: {
          source: "bepaid_fetch_reconciliation",
          bepaid_uid: transaction.uid,
          reconciled_at: now.toISOString(),
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

  console.info(`Processed transaction ${transaction.uid} for order ${order.order_number}`);
}

async function notifyAdmins(supabase: any, results: any) {
  try {
    const message =
      `🔍 bePaid API Fetch Report\n\n` +
      `Получено транзакций: ${results.fetched}\n` +
      `Новых найдено: ${results.new_found}\n` +
      `Заказов создано: ${results.orders_created}\n` +
      `Уже существует: ${results.already_exists}\n` +
      `Ошибок: ${results.errors}\n\n` +
      (results.details.length > 0
        ? results.details
            .slice(0, 10)
            .map((d: any) => `• ${d.bepaid_uid?.slice(0, 8)}...: ${d.action}`)
            .join("\n")
        : "Нет деталей");

    await supabase.functions.invoke("telegram-notify-admins", {
      body: { message, type: "bepaid_fetch" },
    });
  } catch (e) {
    console.error("Error notifying admins:", e);
  }
}
