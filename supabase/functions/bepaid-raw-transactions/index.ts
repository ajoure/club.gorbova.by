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
        const subsUrl = `https://api.bepaid.by/subscriptions?shop_id=${shopId}&per_page=${perPage}&page=${page}`;
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
      const customersResponse = await fetch(`https://api.bepaid.by/customers?shop_id=${shopId}&per_page=100`, {
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
        successful_transactions: allTransactions.filter(t => t.status === "successful").length,
        failed_transactions: allTransactions.filter(t => t.status === "failed").length,
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
