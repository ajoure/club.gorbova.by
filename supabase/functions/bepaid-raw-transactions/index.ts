import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * bepaid-raw-transactions
 * 
 * Fetches ALL transaction data from bePaid API using Paginated Reports API.
 * Features:
 * - Uses POST /reports/paginated with X-Api-Version: 3
 * - Transliteration for cardholder name matching
 * - Card-to-profile linking
 * - Proper bePaid timestamps (not import time)
 */

interface BepaidTransaction {
  uid: string;
  status: string;
  amount: number;
  currency: string;
  description?: string;
  tracking_id?: string;
  message?: string;
  paid_at?: string;
  created_at?: string;
  receipt_url?: string;
  language?: string;
  test?: boolean;
  billing_address?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    country?: string;
    city?: string;
    address?: string;
    zip?: string;
  };
  customer?: {
    email?: string;
    ip?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
  };
  credit_card?: {
    last_4?: string;
    brand?: string;
    holder?: string;
    first_1?: string;
    exp_month?: number;
    exp_year?: number;
    token?: string;
  };
  additional_data?: {
    contract?: string[];
    receipt?: string[];
    bank_code?: string;
    rrn?: string;
    ref_id?: string;
    message?: string;
    auth_code?: string;
  };
}

// Transliteration map: Latin to Cyrillic
const TRANSLIT_MAP: Record<string, string> = {
  // Two-letter combinations first (order matters)
  'sh': 'ш', 'ch': 'ч', 'zh': 'ж', 'ts': 'ц', 'ya': 'я', 
  'yu': 'ю', 'yo': 'ё', 'iu': 'ю', 'ia': 'я', 'yi': 'ый',
  'kh': 'х', 'th': 'т', 'ks': 'кс', 'dz': 'дз',
  // Single letters
  'a': 'а', 'b': 'б', 'c': 'ц', 'd': 'д', 'e': 'е', 'f': 'ф',
  'g': 'г', 'h': 'х', 'i': 'и', 'j': 'й', 'k': 'к', 'l': 'л',
  'm': 'м', 'n': 'н', 'o': 'о', 'p': 'п', 'q': 'к', 'r': 'р',
  's': 'с', 't': 'т', 'u': 'у', 'v': 'в', 'w': 'в', 'x': 'кс',
  'y': 'ы', 'z': 'з',
};

function translitToRussian(latin: string): string {
  if (!latin) return "";
  let result = latin.toLowerCase();
  
  // First handle two-letter combinations
  const twoLetterCombos = Object.entries(TRANSLIT_MAP).filter(([k]) => k.length > 1);
  for (const [lat, cyr] of twoLetterCombos) {
    result = result.replace(new RegExp(lat, 'gi'), cyr);
  }
  
  // Then single letters
  const singleLetters = Object.entries(TRANSLIT_MAP).filter(([k]) => k.length === 1);
  for (const [lat, cyr] of singleLetters) {
    result = result.replace(new RegExp(lat, 'gi'), cyr);
  }
  
  return result;
}

// Product/tariff mapping from description patterns
const PRODUCT_TARIFF_MAPPINGS: Record<string, { productCode?: string; tariffCode?: string; productName: string; tariffName?: string }> = {
  "Клуб: триал итоги": { productCode: "club", productName: "Gorbova Club", tariffName: "CHAT (триал)" },
  "Клуб: business": { productCode: "club", productName: "Gorbova Club", tariffName: "BUSINESS" },
  "Клуб: premium": { productCode: "club", productName: "Gorbova Club", tariffName: "PREMIUM" },
  "Клуб: lite": { productCode: "club", productName: "Gorbova Club", tariffName: "LITE" },
  "Клуб: chat": { productCode: "club", productName: "Gorbova Club", tariffName: "CHAT" },
  "Gorbova Club": { productCode: "club", productName: "Gorbova Club" },
  "Клуб": { productCode: "club", productName: "Gorbova Club" },
};

function parseProductFromDescription(description: string): { productName?: string; tariffName?: string } {
  if (!description) return {};
  
  // Look for pattern like "(Клуб: business)"
  const match = description.match(/\(([^)]+)\)/);
  if (match) {
    const hint = match[1].trim();
    const mapping = PRODUCT_TARIFF_MAPPINGS[hint];
    if (mapping) {
      return { productName: mapping.productName, tariffName: mapping.tariffName };
    }
    for (const [key, value] of Object.entries(PRODUCT_TARIFF_MAPPINGS)) {
      if (hint.toLowerCase().includes(key.toLowerCase())) {
        return { productName: value.productName, tariffName: value.tariffName };
      }
    }
  }
  
  for (const [key, value] of Object.entries(PRODUCT_TARIFF_MAPPINGS)) {
    if (description.toLowerCase().includes(key.toLowerCase())) {
      return { productName: value.productName, tariffName: value.tariffName };
    }
  }
  
  return {};
}

function normalizePhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 9) {
    if (digits.startsWith("375")) return "+" + digits;
    if (digits.startsWith("7") && digits.length === 11) return "+" + digits;
    if (digits.length === 9) return "+375" + digits;
  }
  return phone;
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
    const fromDate = body.fromDate || "2026-01-01";
    const toDate = body.toDate || new Date().toISOString().split("T")[0];
    const perPage = Math.min(body.perPage || 100, 1000);

    console.info(`Fetching bePaid transactions from ${fromDate} to ${toDate}`);

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
    // PART 1: Fetch transactions via Paginated Reports API
    // =====================================================
    try {
      const reportUrl = "https://api.bepaid.by/reports/paginated";
      console.info(`Fetching transactions via Paginated Reports API: POST ${reportUrl}`);
      
      const reportResponse = await fetch(reportUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-Api-Version": "3",
        },
        body: JSON.stringify({
          report_params: {
            date_type: "created_at",
            from: `${fromDate} 00:00:00`,
            to: `${toDate} 23:59:59`,
            status: "all",
            time_zone: "UTC"
          }
        })
      });

      console.info(`Paginated Reports API response status: ${reportResponse.status}`);
      
      if (reportResponse.ok) {
        const reportData = await reportResponse.json();
        const transactions: BepaidTransaction[] = reportData.transactions || reportData.data || [];
        console.info(`Paginated Reports: fetched ${transactions.length} transactions`);

        for (const tx of transactions) {
          const { productName, tariffName } = parseProductFromDescription(tx.description || "");
          
          allTransactions.push({
            uid: tx.uid,
            type: "transaction",
            status: tx.status,
            amount: (tx.amount || 0) / 100,
            currency: tx.currency,
            description: tx.description,
            paid_at: tx.paid_at,
            created_at: tx.created_at,
            _bepaid_time: tx.paid_at || tx.created_at, // Original bePaid time
            receipt_url: tx.receipt_url,
            tracking_id: tx.tracking_id,
            message: tx.message || tx.additional_data?.message,
            ip_address: tx.customer?.ip,
            customer_email: tx.customer?.email || tx.billing_address?.email,
            customer_name: [tx.customer?.first_name || tx.billing_address?.first_name, tx.customer?.last_name || tx.billing_address?.last_name].filter(Boolean).join(" ") || null,
            customer_phone: tx.customer?.phone || tx.billing_address?.phone,
            card_last_4: tx.credit_card?.last_4,
            card_brand: tx.credit_card?.brand,
            card_holder: tx.credit_card?.holder,
            bank_code: tx.additional_data?.bank_code,
            rrn: tx.additional_data?.rrn,
            auth_code: tx.additional_data?.auth_code,
            product_name: productName,
            tariff_name: tariffName,
            plan_title: productName ? (tariffName ? `${productName}: ${tariffName}` : productName) : tx.description,
            _source: "bepaid_api",
          });
        }
      } else {
        const errorText = await reportResponse.text();
        console.warn(`Paginated Reports API failed: ${reportResponse.status} - ${errorText}`);
      }
      
      console.info(`Total transactions fetched from Paginated API: ${allTransactions.length}`);
    } catch (txErr) {
      console.error("Error fetching transactions from bePaid:", txErr);
    }

    // =====================================================
    // PART 2: Fetch subscriptions
    // =====================================================
    try {
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= 10) {
        const subsUrl = `https://api.bepaid.by/subscriptions?per_page=${perPage}&page=${page}`;
        console.info(`Fetching subscriptions page ${page}: ${subsUrl}`);
        
        const subsResponse = await fetch(subsUrl, {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
          },
        });

        if (!subsResponse.ok) {
          console.warn(`Subscriptions failed: ${subsResponse.status}`);
          break;
        }

        const subsData = await subsResponse.json();
        const subscriptions = subsData.subscriptions || [];
        
        console.info(`Page ${page}: fetched ${subscriptions.length} subscriptions`);

        if (subscriptions.length === 0) {
          hasMore = false;
          break;
        }

        const filterFrom = new Date(fromDate);
        const filterTo = new Date(toDate + "T23:59:59Z");

        for (const sub of subscriptions) {
          const subCreatedAt = new Date(sub.created_at);
          
          if (subCreatedAt >= filterFrom && subCreatedAt <= filterTo) {
            const { productName, tariffName } = parseProductFromDescription(sub.plan?.title || "");
            
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
              transactions: sub.transactions || [],
              product_name: productName,
              tariff_name: tariffName,
            });
            
            // Extract transactions from subscription and add to allTransactions
            if (sub.transactions && Array.isArray(sub.transactions)) {
              for (const tx of sub.transactions) {
                const txCreatedAt = new Date(tx.created_at || tx.paid_at);
                if (txCreatedAt >= filterFrom && txCreatedAt <= filterTo) {
                  // Check if already exists
                  if (allTransactions.some(t => t.uid === tx.uid)) continue;
                  
                  const { productName: txProductName, tariffName: txTariffName } = parseProductFromDescription(
                    tx.description || sub.plan?.title || ""
                  );
                  
                  allTransactions.push({
                    uid: tx.uid,
                    type: "subscription_payment",
                    subscription_id: sub.id,
                    status: tx.status,
                    amount: (tx.amount || 0) / 100,
                    currency: tx.currency || sub.plan?.currency || "BYN",
                    description: tx.description || sub.plan?.title,
                    paid_at: tx.paid_at,
                    created_at: tx.created_at,
                    _bepaid_time: tx.paid_at || tx.created_at,
                    receipt_url: tx.receipt_url,
                    tracking_id: tx.tracking_id || sub.tracking_id,
                    message: tx.message || tx.additional_data?.message,
                    ip_address: tx.customer?.ip || sub.customer?.ip,
                    customer_email: tx.customer?.email || sub.customer?.email,
                    customer_name: [tx.customer?.first_name || sub.customer?.first_name, tx.customer?.last_name || sub.customer?.last_name].filter(Boolean).join(" ") || null,
                    customer_phone: tx.customer?.phone || sub.customer?.phone,
                    card_last_4: tx.credit_card?.last_4 || sub.credit_card?.last_4,
                    card_brand: tx.credit_card?.brand || sub.credit_card?.brand,
                    card_holder: tx.credit_card?.holder || sub.credit_card?.holder,
                    bank_code: tx.additional_data?.bank_code,
                    rrn: tx.additional_data?.rrn,
                    auth_code: tx.additional_data?.auth_code,
                    product_name: txProductName || productName,
                    tariff_name: txTariffName || tariffName,
                    plan_title: sub.plan?.title,
                    _source: "bepaid_subscription",
                  });
                }
              }
            }
          }
        }

        if (subscriptions.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      }
    } catch (subErr) {
      console.warn("Error fetching subscriptions:", subErr);
    }

    // =====================================================
    // FALLBACK: Load from local database if API returns nothing
    // =====================================================
    if (allTransactions.length === 0) {
      console.warn("bePaid API returned 0 transactions. Loading from local database.");

      const fromTs = new Date(fromDate + "T00:00:00Z").toISOString();
      const toTs = new Date(toDate + "T23:59:59Z").toISOString();

      // Load from payment_reconcile_queue
      const { data: queueRows } = await supabase
        .from("payment_reconcile_queue")
        .select("*")
        .gte("created_at", fromTs)
        .lte("created_at", toTs)
        .order("created_at", { ascending: false })
        .limit(1000);

      for (const row of queueRows || []) {
        const payload: any = row.raw_payload || {};
        const lastTx = payload.last_transaction || payload.lastTransaction || null;
        
        const uid = row.bepaid_uid || lastTx?.uid || payload.uid || payload.id || row.id;
        const description = (row as any).description || payload.description || payload.additional_data?.description || payload.order?.description || "";
        const { productName, tariffName } = parseProductFromDescription(description);

        // Use original bePaid time from raw_payload, NOT database created_at
        const bepaidTime = lastTx?.paid_at || lastTx?.created_at || payload.paid_at || payload.created_at;

        allTransactions.push({
          uid,
          type: "transaction",
          status: lastTx?.status || payload.status || row.status || "pending",
          amount: row.amount ?? (payload.plan?.amount ? payload.plan.amount / 100 : null),
          currency: row.currency || payload.plan?.currency || payload.currency || "BYN",
          description: description,
          paid_at: bepaidTime,
          created_at: bepaidTime || row.created_at,
          _bepaid_time: bepaidTime, // Original bePaid time
          _db_created_at: row.created_at, // When added to our DB
          receipt_url: (row as any).receipt_url || payload.receipt_url,
          tracking_id: row.tracking_id || payload.tracking_id,
          message: lastTx?.message || row.last_error,
          ip_address: (row as any).ip_address || payload.customer?.ip,
          customer_email: row.customer_email || payload.customer?.email,
          customer_name: payload.customer?.first_name ? `${payload.customer.first_name} ${payload.customer.last_name || ""}`.trim() : 
            (payload.credit_card?.holder || lastTx?.credit_card?.holder),
          customer_phone: payload.customer?.phone,
          card_last_4: (row as any).card_last4 || payload.credit_card?.last_4 || payload.card?.last_4 || lastTx?.credit_card?.last_4,
          card_brand: payload.credit_card?.brand || payload.card?.brand || lastTx?.credit_card?.brand,
          card_holder: (row as any).card_holder || payload.credit_card?.holder || payload.card?.holder || lastTx?.credit_card?.holder,
          bank_code: (row as any).bank_code || payload.additional_data?.bank_code,
          rrn: (row as any).rrn || payload.additional_data?.rrn,
          auth_code: (row as any).auth_code || payload.additional_data?.auth_code,
          product_name: (row as any).product_name || productName,
          tariff_name: (row as any).tariff_name || tariffName,
          plan_title: (row as any).plan_title || payload.plan?.title || (productName ? `${productName}${tariffName ? ": " + tariffName : ""}` : description),
          _source: row.source || "queue",
          _queue_id: row.id,
          matched_profile_id: row.matched_profile_id,
          matched_product_id: (row as any).matched_product_id,
          matched_tariff_id: (row as any).matched_tariff_id,
        });
      }

      // Load from payments_v2 
      const { data: paymentRows } = await supabase
        .from("payments_v2")
        .select(`
          *,
          orders_v2:order_id (
            id, product_id, tariff_id, user_id, customer_email, customer_phone,
            products_v2:product_id (name),
            tariffs:tariff_id (name)
          )
        `)
        .eq("provider", "bepaid")
        .gte("created_at", fromTs)
        .lte("created_at", toTs)
        .order("created_at", { ascending: false })
        .limit(500);

      const userIds = [...new Set((paymentRows || []).map(p => p.user_id).filter(Boolean))];
      let profilesMap: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, user_id, full_name, email, phone")
          .in("user_id", userIds);
        for (const p of profiles || []) {
          if (p.user_id) profilesMap[p.user_id] = p;
        }
      }

      for (const pay of paymentRows || []) {
        const order: any = pay.orders_v2;
        const profile = profilesMap[pay.user_id || ""];
        const meta: any = pay.meta || {};

        // Skip if already in allTransactions
        if (allTransactions.some(t => t.uid === pay.external_id)) continue;

        const { productName, tariffName } = parseProductFromDescription(meta.description || "");

        allTransactions.push({
          uid: pay.external_id || pay.id,
          type: "transaction",
          status: pay.status,
          amount: pay.amount,
          currency: pay.currency || "BYN",
          description: meta.description || "",
          paid_at: meta.paid_at || pay.created_at,
          created_at: pay.created_at,
          _bepaid_time: meta.paid_at || pay.created_at,
          receipt_url: meta.receipt_url,
          tracking_id: pay.tracking_id,
          message: pay.error_message || meta.message,
          ip_address: meta.ip_address,
          customer_email: order?.customer_email || profile?.email,
          customer_name: profile?.full_name || meta.card?.holder,
          customer_phone: order?.customer_phone || profile?.phone,
          card_last_4: meta.card_last4 || meta.card?.last_4,
          card_brand: meta.card?.brand,
          card_holder: meta.card?.holder,
          product_name: order?.products_v2?.name || productName,
          tariff_name: order?.tariffs?.name || tariffName,
          plan_title: order?.products_v2?.name,
          _source: "payments_v2",
          matched_profile_id: profile?.id,
          matched_order_id: order?.id,
          matched_product_id: order?.product_id,
          matched_tariff_id: order?.tariff_id,
        });
      }

      console.info(`Local fallback: returned ${allTransactions.length} transactions.`);
    }

    // =====================================================
    // PART 3: Match contacts by email/phone/transliteration/card
    // =====================================================
    const emails = [...new Set(allTransactions.map(t => t.customer_email).filter(Boolean))];
    const phones = [...new Set(allTransactions.map(t => normalizePhone(t.customer_phone)).filter(Boolean))];
    const cardHolders = [...new Set(allTransactions.map(t => t.card_holder).filter(Boolean))];
    const cardLast4s = [...new Set(allTransactions.map(t => t.card_last_4).filter(Boolean))];

    let profilesByEmail: Record<string, any> = {};
    let profilesByPhone: Record<string, any> = {};
    let profilesByNameTranslit: Record<string, any> = {};
    let profilesByCard: Record<string, any> = {};

    // Match by email
    if (emails.length > 0) {
      const { data: profilesE } = await supabase
        .from("profiles")
        .select("id, email, full_name, phone")
        .in("email", emails);
      for (const p of profilesE || []) {
        if (p.email) profilesByEmail[p.email.toLowerCase()] = p;
      }
    }

    // Match by phone
    if (phones.length > 0) {
      const { data: profilesP } = await supabase
        .from("profiles")
        .select("id, email, full_name, phone")
        .in("phone", phones);
      for (const p of profilesP || []) {
        if (p.phone) profilesByPhone[p.phone] = p;
      }
    }

    // Match by card links
    if (cardLast4s.length > 0) {
      const { data: cardLinks } = await supabase
        .from("card_profile_links")
        .select("card_last4, card_holder, profile_id, profiles:profile_id(id, full_name, email)")
        .in("card_last4", cardLast4s);
      for (const link of cardLinks || []) {
        const key = `${link.card_last4}|${(link.card_holder || "").toLowerCase()}`;
        profilesByCard[key] = link.profiles;
      }
    }

    // Build transliterated name index for fuzzy matching
    if (cardHolders.length > 0) {
      // Transliterate all card holders and search by similar Russian names
      const translitNames: string[] = [];
      for (const holder of cardHolders) {
        const translitName = translitToRussian(holder);
        if (translitName && translitName !== holder.toLowerCase()) {
          translitNames.push(translitName);
        }
      }
      
      if (translitNames.length > 0) {
        // Search profiles by transliterated names
        const { data: profilesT } = await supabase
          .from("profiles")
          .select("id, email, full_name, phone");
          
        for (const p of profilesT || []) {
          if (p.full_name) {
            const nameLower = p.full_name.toLowerCase();
            profilesByNameTranslit[nameLower] = p;
          }
        }
      }
    }

    let matchedCount = 0;
    for (const tx of allTransactions) {
      if (tx.matched_profile_id) {
        matchedCount++;
        continue;
      }

      // 1. Match by email first
      const emailKey = tx.customer_email?.toLowerCase();
      if (emailKey && profilesByEmail[emailKey]) {
        tx.matched_profile_id = profilesByEmail[emailKey].id;
        tx.matched_profile_name = profilesByEmail[emailKey].full_name;
        tx.matched_by = "email";
        matchedCount++;
        continue;
      }

      // 2. Match by phone
      const phoneKey = normalizePhone(tx.customer_phone);
      if (phoneKey && profilesByPhone[phoneKey]) {
        tx.matched_profile_id = profilesByPhone[phoneKey].id;
        tx.matched_profile_name = profilesByPhone[phoneKey].full_name;
        tx.matched_by = "phone";
        matchedCount++;
        continue;
      }

      // 3. Match by card (previously linked)
      if (tx.card_last_4 && tx.card_holder) {
        const cardKey = `${tx.card_last_4}|${tx.card_holder.toLowerCase()}`;
        if (profilesByCard[cardKey]) {
          tx.matched_profile_id = profilesByCard[cardKey].id;
          tx.matched_profile_name = profilesByCard[cardKey].full_name;
          tx.matched_by = "card";
          matchedCount++;
          continue;
        }
      }

      // 4. Match by transliterated cardholder name
      if (tx.card_holder) {
        const translitName = translitToRussian(tx.card_holder);
        tx._translit_name = translitName; // Store for UI display
        
        // Try exact match on transliterated name
        if (profilesByNameTranslit[translitName]) {
          tx.matched_profile_id = profilesByNameTranslit[translitName].id;
          tx.matched_profile_name = profilesByNameTranslit[translitName].full_name;
          tx.matched_by = "transliteration";
          matchedCount++;
          continue;
        }
        
        // Try fuzzy match: split into parts and find
        const translitParts = translitName.split(" ").filter(p => p.length > 2);
        for (const [name, profile] of Object.entries(profilesByNameTranslit)) {
          const nameParts = name.split(" ");
          const matchingParts = translitParts.filter(tp => 
            nameParts.some(np => np.includes(tp) || tp.includes(np))
          );
          if (matchingParts.length >= Math.min(2, translitParts.length)) {
            tx.matched_profile_id = (profile as any).id;
            tx.matched_profile_name = (profile as any).full_name;
            tx.matched_by = "transliteration_fuzzy";
            matchedCount++;
            break;
          }
        }
      }
    }

    // Sort by original bePaid date descending
    allTransactions.sort((a, b) => {
      const dateA = new Date(a._bepaid_time || a.paid_at || a.created_at || 0);
      const dateB = new Date(b._bepaid_time || b.paid_at || b.created_at || 0);
      return dateB.getTime() - dateA.getTime();
    });

    const successfulTx = allTransactions.filter(t => 
      ["successful", "succeeded", "completed", "paid"].includes(t.status?.toLowerCase())
    ).length;

    const failedTx = allTransactions.filter(t => 
      ["failed", "error", "declined"].includes(t.status?.toLowerCase())
    ).length;

    console.info(`Returning ${allTransactions.length} transactions, ${matchedCount} matched contacts`);

    return new Response(JSON.stringify({
      success: true,
      transactions: allTransactions,
      subscriptions: allSubscriptions,
      summary: {
        total_transactions: allTransactions.length,
        total_subscriptions: allSubscriptions.length,
        successful_transactions: successfulTx,
        failed_transactions: failedTx,
        matched_contacts: matchedCount,
        unmatched_contacts: allTransactions.length - matchedCount,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Error in bepaid-raw-transactions:", errMsg);
    return new Response(JSON.stringify({ 
      success: false, 
      error: errMsg,
      transactions: [],
      subscriptions: [],
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
