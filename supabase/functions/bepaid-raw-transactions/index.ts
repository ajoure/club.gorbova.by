import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * bepaid-raw-transactions
 * 
 * Fetches RAW transaction data directly from bePaid API for display in admin UI.
 * Uses multiple endpoints to get comprehensive data:
 * 1. Subscriptions with their transactions
 * 2. Direct transaction lookups by tracking_id patterns
 */

interface BepaidSubscription {
  id: string;
  state: string;
  tracking_id?: string;
  created_at: string;
  updated_at?: string;
  plan?: {
    amount: number;
    currency: string;
    title?: string;
    interval?: string;
    interval_count?: number;
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
    holder?: string;
  };
  transactions?: Array<{
    uid: string;
    status: string;
    amount: number;
    currency?: string;
    paid_at?: string;
    created_at?: string;
    message?: string;
  }>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body = await req.json().catch(() => ({}));
    const fromDate = body.fromDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const toDate = body.toDate || new Date().toISOString().split("T")[0];
    const perPage = Math.min(body.perPage || 100, 500);

    console.info(`Fetching raw bePaid data from ${fromDate} to ${toDate}`);

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
    const secretKey = bepaidInstance.config.secret_key || Deno.env.get("BEPAID_SECRET_KEY");

    if (!shopId || !secretKey) {
      return new Response(JSON.stringify({ error: "Missing credentials" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = btoa(`${shopId}:${secretKey}`);
    const allTransactions: any[] = [];
    const allSubscriptions: any[] = [];

    // =====================================================
    // PART 1: Fetch all subscriptions with embedded transactions
    // =====================================================
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 10) { // Max 10 pages (1000 subscriptions)
      try {
        const subsUrl = `https://api.bepaid.by/subscriptions?per_page=${perPage}&page=${page}`;
        console.info(`Fetching subscriptions page ${page}: ${subsUrl}`);
        
        const subsResponse = await fetch(subsUrl, {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        });

        const responseText = await subsResponse.text();
        console.info(`Subscriptions page ${page} response status: ${subsResponse.status}`);
        
        if (!subsResponse.ok) {
          console.error(`Subscriptions API error: ${responseText}`);
          break;
        }

        const subsData = JSON.parse(responseText);
        const subscriptions: BepaidSubscription[] = subsData.subscriptions || [];
        
        console.info(`Page ${page}: fetched ${subscriptions.length} subscriptions`);

        if (subscriptions.length === 0) {
          hasMore = false;
          break;
        }

        // Filter by date and process each subscription
        for (const sub of subscriptions) {
          const subCreatedAt = new Date(sub.created_at);
          const filterFrom = new Date(fromDate);
          const filterTo = new Date(toDate + "T23:59:59Z");
          
          // Check if subscription is in date range
          if (subCreatedAt >= filterFrom && subCreatedAt <= filterTo) {
            allSubscriptions.push({
              id: sub.id,
              type: "subscription",
              state: sub.state,
              tracking_id: sub.tracking_id,
              created_at: sub.created_at,
              updated_at: sub.updated_at,
              amount: sub.plan?.amount ? sub.plan.amount / 100 : null,
              currency: sub.plan?.currency || "BYN",
              plan_title: sub.plan?.title,
              interval: sub.plan?.interval,
              interval_count: sub.plan?.interval_count,
              customer_email: sub.customer?.email,
              customer_name: [sub.customer?.first_name, sub.customer?.last_name].filter(Boolean).join(" ") || null,
              customer_phone: sub.customer?.phone,
              card_last_4: sub.credit_card?.last_4,
              card_brand: sub.credit_card?.brand,
              card_holder: sub.credit_card?.holder,
              transactions_count: sub.transactions?.length || 0,
              transactions: sub.transactions?.map(tx => ({
                uid: tx.uid,
                status: tx.status,
                amount: tx.amount / 100,
                currency: tx.currency || sub.plan?.currency || "BYN",
                paid_at: tx.paid_at,
                created_at: tx.created_at,
                message: tx.message,
              })) || [],
            });

            // Also extract individual transactions
            for (const tx of (sub.transactions || [])) {
              const txDate = new Date(tx.paid_at || tx.created_at || sub.created_at);
              if (txDate >= filterFrom && txDate <= filterTo) {
                allTransactions.push({
                  uid: tx.uid,
                  type: "transaction",
                  subscription_id: sub.id,
                  status: tx.status,
                  amount: tx.amount / 100,
                  currency: tx.currency || sub.plan?.currency || "BYN",
                  paid_at: tx.paid_at,
                  created_at: tx.created_at || sub.created_at,
                  plan_title: sub.plan?.title,
                  customer_email: sub.customer?.email,
                  customer_name: [sub.customer?.first_name, sub.customer?.last_name].filter(Boolean).join(" ") || null,
                  customer_phone: sub.customer?.phone,
                  card_last_4: sub.credit_card?.last_4,
                  card_brand: sub.credit_card?.brand,
                  card_holder: sub.credit_card?.holder,
                  tracking_id: sub.tracking_id,
                  message: tx.message,
                });
              }
            }
          }
        }

        if (subscriptions.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      } catch (fetchErr) {
        console.error(`Error fetching subscriptions page ${page}:`, fetchErr);
        break;
      }
    }

    // =====================================================
    // PART 2: Try fetching customers for additional context
    // =====================================================
    let customers: any[] = [];
    try {
      const customersResponse = await fetch(`https://api.bepaid.by/customers?per_page=100&page=1`, {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (customersResponse.ok) {
        const customersData = await customersResponse.json();
        customers = customersData.customers || [];
        console.info(`Fetched ${customers.length} customers`);
      }
    } catch (custErr) {
      console.warn("Could not fetch customers:", custErr);
    }

    // =====================================================
    // FALLBACK (SIMULATION): if bePaid API returns nothing,
    // return data already present in our system (webhooks/imports).
    // =====================================================
    if (allTransactions.length === 0 && allSubscriptions.length === 0) {
      console.warn("bePaid API returned 0 items. Falling back to system data (simulation mode).");

      const fromTs = new Date(fromDate + "T00:00:00Z").toISOString();
      const toTs = new Date(toDate + "T23:59:59Z").toISOString();

      // Queue items (webhooks/imports)
      const { data: queueRows, error: queueErr } = await supabase
        .from("payment_reconcile_queue")
        .select(
          "id, created_at, updated_at, status, tracking_id, amount, currency, customer_email, raw_payload, source, matched_profile_id, matched_order_id, bepaid_uid, last_error"
        )
        .gte("created_at", fromTs)
        .lte("created_at", toTs)
        .limit(1000);

      if (queueErr) {
        console.error("Simulation fallback: queue query error", queueErr);
      }

      for (const row of queueRows || []) {
        const payload: any = row.raw_payload || {};
        const lastTx = payload.last_transaction || payload.lastTransaction || null;

        const uid = row.bepaid_uid || lastTx?.uid || payload.uid || payload.id || row.id;
        const status = (lastTx?.status || payload.status || row.status || "pending").toString();
        const amount = row.amount ?? (payload.plan?.amount ? payload.plan.amount / 100 : null);
        const currency = row.currency || payload.plan?.currency || payload.currency || "BYN";
        const paidAt = lastTx?.created_at || lastTx?.paid_at || payload.paid_at || payload.paidAt || null;
        const createdAt = payload.created_at || row.created_at;
        
        // Extended plan_title extraction from various payload structures
        const planTitle = 
          (row as any).plan_title ||
          payload.plan?.title || 
          payload.plan?.name || 
          payload.plan?.plan?.title || 
          payload.additional_data?.description ||
          payload.additional_data?.product_name ||
          payload.description ||
          payload.product_name ||
          payload.order?.description ||
          null;

        allTransactions.push({
          uid,
          type: "transaction",
          subscription_id: payload.id || null,
          status,
          amount,
          currency,
          paid_at: paidAt,
          created_at: createdAt,
          plan_title: planTitle,
          customer_email: row.customer_email || payload.customer?.email || null,
          customer_name: payload.customer_name || null,
          customer_phone: payload.customer?.phone || null,
          card_last_4: payload.card?.last_4 || payload.credit_card?.last_4 || null,
          card_brand: payload.card?.brand || payload.credit_card?.brand || null,
          card_holder: payload.card?.holder || payload.credit_card?.holder || null,
          tracking_id: row.tracking_id || payload.tracking_id || null,
          message: lastTx?.message || row.last_error || null,
          _source: row.source || "system",
          _queue_id: row.id,
          matched_profile_id: row.matched_profile_id,
          matched_order_id: row.matched_order_id,
        });

        // Also add subscription as a separate record if it looks like one
        if (payload.id && typeof payload.id === "string" && payload.id.startsWith("sbs_")) {
          allSubscriptions.push({
            id: payload.id,
            type: "subscription",
            state: payload.state || "unknown",
            tracking_id: payload.tracking_id || row.tracking_id,
            created_at: payload.created_at || row.created_at,
            updated_at: payload.updated_at || row.updated_at,
            amount: payload.plan?.amount ? payload.plan.amount / 100 : row.amount,
            currency: payload.plan?.currency || row.currency || "BYN",
            plan_title: payload.plan?.title || payload.plan?.name || null,
            interval: payload.plan?.plan?.interval_unit || null,
            interval_count: payload.plan?.plan?.interval || null,
            customer_email: row.customer_email || null,
            customer_name: null,
            customer_phone: null,
            card_last_4: payload.card?.last_4 || null,
            card_brand: payload.card?.brand || null,
            card_holder: payload.card?.holder || null,
            transactions_count: payload.last_transaction ? 1 : 0,
            transactions: payload.last_transaction
              ? [{
                  uid: payload.last_transaction.uid,
                  status: payload.last_transaction.status,
                  amount: payload.plan?.amount ? payload.plan.amount / 100 : null,
                  currency: payload.plan?.currency || row.currency || "BYN",
                  paid_at: payload.last_transaction.created_at,
                  created_at: payload.last_transaction.created_at,
                  message: payload.last_transaction.message,
                }]
              : [],
          });
        }
      }

      // Existing processed payments with order data
      const { data: paymentRows, error: payErr } = await supabase
        .from("payments_v2")
        .select(`
          id, created_at, paid_at, amount, currency, status, provider, provider_payment_id, card_last4, card_brand, user_id, order_id, meta,
          orders_v2:order_id (
            id, product_id, tariff_id, user_id, customer_email, customer_phone,
            products_v2:product_id (name),
            tariffs:tariff_id (name)
          )
        `)
        .eq("provider", "bepaid")
        .gte("created_at", fromTs)
        .lte("created_at", toTs)
        .limit(1000);

      if (payErr) {
        console.error("Simulation fallback: payments query error", payErr);
      }

      // Get profile info for user_ids
      const userIds = [...new Set((paymentRows || []).map(p => p.user_id).filter(Boolean))];
      let profilesMap: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email, full_name, phone")
          .in("id", userIds);
        for (const pr of profiles || []) {
          profilesMap[pr.id] = pr;
        }
      }

      for (const p of paymentRows || []) {
        const order = (p as any).orders_v2;
        const profile = profilesMap[p.user_id] || {};
        const productName = order?.products_v2?.name;
        const tariffName = order?.tariffs?.name;
        
        allTransactions.push({
          uid: p.provider_payment_id || p.id,
          type: "transaction",
          status: p.status,
          amount: p.amount,
          currency: p.currency,
          paid_at: p.paid_at,
          created_at: p.created_at,
          plan_title: productName || tariffName || (p.meta as any)?.product_name || (p.meta as any)?.description || null,
          customer_email: profile?.email || order?.customer_email || (p.meta as any)?.customer_email || null,
          customer_name: profile?.full_name || (p.meta as any)?.customer_name || null,
          customer_phone: profile?.phone || order?.customer_phone || (p.meta as any)?.customer_phone || null,
          card_last_4: p.card_last4 || null,
          card_brand: p.card_brand || null,
          card_holder: (p.meta as any)?.card_holder || null,
          tracking_id: (p.meta as any)?.tracking_id || null,
          message: null,
          _source: "payments_v2",
          order_id: p.order_id,
          user_id: p.user_id,
        });
      }

      // Deduplicate by uid
      const seen = new Set<string>();
      const deduped = [] as any[];
      for (const t of allTransactions) {
        const key = String(t.uid);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(t);
      }
      allTransactions.length = 0;
      allTransactions.push(...deduped);

      console.info(`Simulation mode: returned ${allTransactions.length} transactions and ${allSubscriptions.length} subscriptions from system data.`);
    }

    // =====================================================
    // PART 3: Sort transactions by date descending
    // =====================================================
    allTransactions.sort((a, b) => {
      const dateA = new Date(a.paid_at || a.created_at);
      const dateB = new Date(b.paid_at || b.created_at);
      return dateB.getTime() - dateA.getTime();
    });

    allSubscriptions.sort((a, b) => {
      const dateA = new Date(a.created_at);
      const dateB = new Date(b.created_at);
      return dateB.getTime() - dateA.getTime();
    });

    const result = {
      success: true,
      fromDate,
      toDate,
      transactions: allTransactions,
      subscriptions: allSubscriptions,
      customers: customers.map(c => ({
        id: c.id,
        email: c.email,
        name: [c.first_name, c.last_name].filter(Boolean).join(" "),
        phone: c.phone,
        created_at: c.created_at,
      })),
    summary: {
        total_transactions: allTransactions.length,
        total_subscriptions: allSubscriptions.length,
        total_customers: customers.length,
        successful_transactions: allTransactions.filter(t => 
          t.status === "successful" || t.status === "succeeded" || t.status === "completed" || t.status === "paid"
        ).length,
        failed_transactions: allTransactions.filter(t => 
          t.status === "failed" || t.status === "error" || t.status === "declined"
        ).length,
      },
    };

    console.info("Raw fetch completed:", result.summary);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("bepaid-raw-transactions error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
