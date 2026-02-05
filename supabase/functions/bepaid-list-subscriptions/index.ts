import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// PATCH-I+: Hosts matrix for fallback
const BEPAID_HOSTS = ['api.bepaid.by', 'merchant.bepaid.by'];

// PATCH-I++: Paths matrix for list/details
const LIST_PATHS = [
  '/subscriptions',
  '/api/subscriptions',
  '/v2/subscriptions',
];

const DETAIL_PATHS = [
  '/subscriptions',
  '/api/subscriptions',
  '/v2/subscriptions',
];

// PATCH-H/J: Centralized status normalization
function normalizeStatus(status: string | undefined): string {
  if (!status) return 'unknown';
  if (status === 'cancelled') return 'canceled';
  return status;
}

interface BepaidSubscription {
  id: string;
  status: string;
  state?: string;
  plan?: {
    title?: string;
    amount?: number;
    currency?: string;
    interval?: string;
    trial_period?: number;
  };
  created_at?: string;
  next_billing_at?: string;
  credit_card?: {
    last_4?: string;
    brand?: string;
    holder?: string;
  };
  customer?: {
    email?: string;
    first_name?: string;
    last_name?: string;
  };
  last_transaction?: {
    uid?: string;
    status?: string;
  };
  _details_missing?: boolean;
}

interface SubscriptionWithLink {
  id: string;
  status: string;
  plan_title: string;
  plan_amount: number;
  plan_currency: string;
  customer_email: string;
  customer_name: string;
  card_last4: string;
  card_brand: string;
  created_at: string;
  next_billing_at: string;
  linked_subscription_id: string | null;
  linked_user_id: string | null;
  linked_profile_name: string | null;
  is_orphan: boolean;
  snapshot_state?: string;
  snapshot_at?: string;
  cancellation_capability?: string;
  needs_support?: boolean;
  details_missing?: boolean;
  linked_order_id?: string | null;
  linked_order_number?: string | null;
  linked_payment_id?: string | null;
  linked_provider_payment_id?: string | null;
  canceled_at?: string | null;
}

interface CredentialsResult {
  shopId: string;
  secretKey: string;
  source: 'integration_instance_only';
  instanceStatus?: string;
}

interface HostAttempt {
  host: string;
  path: string;
  status: number;
  items_count?: number;
  body_preview?: string;
}

// PATCH-I+: Credentials ONLY from integration_instances (no env fallback)
async function getBepaidCredentialsStrict(supabase: any): Promise<CredentialsResult | null> {
  const { data: instance } = await supabase
    .from('integration_instances')
    .select('config, status')
    .eq('provider', 'bepaid')
    .in('status', ['active', 'connected'])
    .maybeSingle();

  const shopIdFromInstance = instance?.config?.shop_id;
  const secretFromInstance = instance?.config?.secret_key;
  
  if (shopIdFromInstance && secretFromInstance) {
    console.log(`[bepaid-list-subs] Using creds from integration_instances only: shop_id=${shopIdFromInstance}, status=${instance?.status}`);
    return { 
      shopId: String(shopIdFromInstance), 
      secretKey: String(secretFromInstance),
      source: 'integration_instance_only',
      instanceStatus: instance?.status
    };
  }

  // PATCH-I+: NO env fallback - strict mode
  return null;
}

// PATCH-I++: Multi-host/path details fetch
async function fetchDetailsMultiPath(id: string, authString: string): Promise<{ data: BepaidSubscription | null; attempts: HostAttempt[] }> {
  const attempts: HostAttempt[] = [];
  
  for (const host of BEPAID_HOSTS) {
    for (const basePath of DETAIL_PATHS) {
      const url = `https://${host}${basePath}/${id}`;
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Basic ${authString}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        });
        
        let bodyPreview = '';
        if (!response.ok) {
          const text = await response.text();
          bodyPreview = text.slice(0, 100);
        }
        
        attempts.push({ host, path: basePath, status: response.status, body_preview: bodyPreview });
        
        if (response.ok) {
          const data = await response.json();
          const sub = data.subscription || data;
          if (sub?.id) {
            return { data: sub, attempts };
          }
        }
      } catch (e) {
        attempts.push({ host, path: basePath, status: 0, body_preview: String(e).slice(0, 100) });
      }
    }
  }
  
  return { data: null, attempts };
}

// PATCH-U3: Multi-page list fetch with pagination
async function fetchListAllPages(authString: string, maxPages: number = 6): Promise<{ items: BepaidSubscription[]; attempts: HostAttempt[] }> {
  const attempts: HostAttempt[] = [];
  const allItems: BepaidSubscription[] = [];
  const seenIds = new Set<string>();
  
  for (const host of BEPAID_HOSTS) {
    for (const basePath of LIST_PATHS) {
      let page = 1;
      let foundItems = true;
      
      while (foundItems && page <= maxPages) {
        const url = `https://${host}${basePath}?page=${page}&per_page=50`;
        
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              Authorization: `Basic ${authString}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          });
          
          attempts.push({ host, path: `${basePath}?page=${page}`, status: response.status, items_count: 0 });
          
          if (response.ok) {
            const data = await response.json();
            const subs = data.subscriptions || data.data || [];
            
            if (Array.isArray(subs) && subs.length > 0) {
              attempts[attempts.length - 1].items_count = subs.length;
              
              for (const sub of subs) {
                if (sub?.id && !seenIds.has(sub.id)) {
                  seenIds.add(sub.id);
                  allItems.push(sub);
                }
              }
              
              page++;
              // If less than 50 items, we've reached the end
              if (subs.length < 50) {
                foundItems = false;
              }
            } else {
              foundItems = false;
            }
          } else {
            foundItems = false;
          }
        } catch (e) {
          attempts.push({ host, path: `${basePath}?page=${page}`, status: 0, body_preview: String(e).slice(0, 50) });
          foundItems = false;
        }
      }
      
      // If we got items from this host/path combo, return
      if (allItems.length > 0) {
        return { items: allItems, attempts };
      }
    }
  }
  
  return { items: allItems, attempts };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check - only admins
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [{ data: hasAdmin }, { data: hasSuperAdmin }] = await Promise.all([
      supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' }),
      supabase.rpc('has_role', { _user_id: user.id, _role: 'superadmin' }),
    ]);

    const isAdmin = hasAdmin === true || hasSuperAdmin === true;
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const maxDetailsLimit = Math.min(parseInt(url.searchParams.get('limit') || '60'), 100);

    // PATCH-I+: Strict credentials from integration_instances only
    const credentials = await getBepaidCredentialsStrict(supabase);
    if (!credentials) {
      console.error('[bepaid-list-subs] No credentials found in integration_instances');
      return new Response(JSON.stringify({ 
        subscriptions: [], 
        stats: { total: 0, active: 0, trial: 0, canceled: 0, orphans: 0, linked: 0 }, 
        error: 'Учетные данные bePaid не настроены в интеграциях',
        debug: {
          creds_source: 'none',
          shop_id_present: false,
          secret_present: false,
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authString = btoa(`${credentials.shopId}:${credentials.secretKey}`);

    // PATCH-U3: DB-first - Load ALL provider_subscriptions as base layer
    const { data: providerSubs } = await supabase
      .from('provider_subscriptions')
      .select('provider_subscription_id, subscription_v2_id, user_id, profile_id, meta, state, next_charge_at, card_brand, card_last4, amount_cents, currency, interval_days, raw_data, updated_at')
      .eq('provider', 'bepaid');

    const providerSubsMap = new Map<string, any>();
    for (const ps of providerSubs || []) {
      providerSubsMap.set(ps.provider_subscription_id, ps);
    }

    // Get our DB subscriptions_v2 mappings
    const { data: dbSubs } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, meta, status')
      .not('meta->bepaid_subscription_id', 'is', null);

    const bepaidIdToOurSub = new Map<string, { id: string; user_id: string; status: string }>();
    for (const sub of dbSubs || []) {
      const bepaidId = (sub.meta as any)?.bepaid_subscription_id;
      if (bepaidId) {
        bepaidIdToOurSub.set(String(bepaidId), { id: sub.id, user_id: sub.user_id, status: sub.status });
      }
    }

    // PATCH-U4: Get linked orders via orders_v2.meta->bepaid_subscription_id
    const { data: linkedOrders } = await supabase
      .from('orders_v2')
      .select('id, order_number, meta, user_id, profile_id')
      .not('meta->bepaid_subscription_id', 'is', null);

    const bepaidIdToOrder = new Map<string, { 
      order_id: string; 
      order_number: string | null;
      user_id: string | null;
      profile_id: string | null;
    }>();
    
    for (const o of linkedOrders || []) {
      const bepaidSubId = (o.meta as any)?.bepaid_subscription_id;
      if (bepaidSubId) {
        bepaidIdToOrder.set(String(bepaidSubId), {
          order_id: o.id,
          order_number: o.order_number,
          user_id: o.user_id,
          profile_id: o.profile_id,
        });
      }
    }

    // PATCH-U4: Get payments by order_id to find linked_payment_id
    const orderIds = [...bepaidIdToOrder.values()].map(o => o.order_id).filter(Boolean);
    const { data: orderPayments } = orderIds.length > 0 ? await supabase
      .from('payments_v2')
      .select('id, order_id, provider_payment_id, status')
      .in('order_id', orderIds)
      .eq('status', 'succeeded')
      .order('created_at', { ascending: false }) : { data: [] };

    // Map order_id -> latest payment
    const orderIdToPayment = new Map<string, { payment_id: string; provider_payment_id: string | null }>();
    for (const p of orderPayments || []) {
      if (p.order_id && !orderIdToPayment.has(p.order_id)) {
        orderIdToPayment.set(p.order_id, {
          payment_id: p.id,
          provider_payment_id: p.provider_payment_id,
        });
      }
    }

    // PATCH-U4 fallback: Also check payments_v2.meta->bepaid_subscription_id
    const { data: linkedPaymentsDirect } = await supabase
      .from('payments_v2')
      .select('id, order_id, meta, profile_id, provider_payment_id, status, orders_v2(id, order_number)')
      .not('meta->bepaid_subscription_id', 'is', null);

    const bepaidIdToPaymentDirect = new Map<string, { 
      payment_id: string; 
      order_id: string | null; 
      order_number: string | null;
      profile_id: string | null;
      provider_payment_id: string | null;
    }>();
    
    for (const p of linkedPaymentsDirect || []) {
      const bepaidSubId = (p.meta as any)?.bepaid_subscription_id;
      if (bepaidSubId) {
        bepaidIdToPaymentDirect.set(String(bepaidSubId), {
          payment_id: p.id,
          order_id: p.order_id,
          order_number: (p.orders_v2 as any)?.order_number || null,
          profile_id: p.profile_id,
          provider_payment_id: p.provider_payment_id,
        });
      }
    }

    // Debug counters
    let apiListCount = 0;
    let detailsFetched = 0;
    let detailsFailed = 0;
    let dbEnriched = 0;
    const listAttempts: HostAttempt[] = [];
    const detailErrorsByStatus: Record<number, number> = {};
    const upsertedIds: string[] = [];

    // PATCH-U3: Step 1 - Fetch ALL pages from API
    const { items: apiItems, attempts: apiAttempts } = await fetchListAllPages(authString, 6);
    listAttempts.push(...apiAttempts);
    apiListCount = apiItems.length;

    // Merge API data with DB data
    const allSubscriptions: BepaidSubscription[] = [];
    const fetchedIds = new Set<string>();

    // Add API items first
    for (const sub of apiItems) {
      if (sub?.id) {
        fetchedIds.add(sub.id);
        allSubscriptions.push(sub);
      }
    }

    // PATCH-U3: Add any provider_subscriptions not in API list (DB-first)
    for (const ps of providerSubs || []) {
      const psId = ps.provider_subscription_id;
      if (!psId || fetchedIds.has(psId)) continue;
      
      // Create from DB record
      fetchedIds.add(psId);
      const rawData = ps.raw_data as any;
      const meta = ps.meta as any;
      const snapshot = meta?.provider_snapshot;
      
      allSubscriptions.push({
        id: psId,
        status: ps.state || 'unknown',
        state: ps.state,
        plan: snapshot?.plan || rawData?.plan,
        created_at: rawData?.created_at || snapshot?.created_at,
        next_billing_at: ps.next_charge_at || snapshot?.next_billing_at,
        credit_card: {
          last_4: ps.card_last4 || snapshot?.credit_card?.last_4,
          brand: ps.card_brand || snapshot?.credit_card?.brand,
          holder: snapshot?.credit_card?.holder,
        },
        customer: snapshot?.customer || rawData?.customer,
        _details_missing: !snapshot && !rawData?.plan,
      });
      dbEnriched++;
    }

    // PATCH-U3: Enrich subscriptions that are missing next_billing_at or card data
    const needsDetails = allSubscriptions.filter(sub => {
      const ps = providerSubsMap.get(sub.id);
      const hasNextBilling = sub.next_billing_at || ps?.next_charge_at;
      const hasCard = sub.credit_card?.last_4 || ps?.card_last4;
      // Only fetch details if we're missing critical fields
      return !hasNextBilling && !hasCard && sub.status !== 'canceled' && sub.status !== 'terminated';
    }).slice(0, maxDetailsLimit);

    console.log(`[bepaid-list-subs] Need to fetch details for ${needsDetails.length} subscriptions (limit=${maxDetailsLimit})`);

    for (const sub of needsDetails) {
      const { data: detailData, attempts } = await fetchDetailsMultiPath(sub.id, authString);
      
      for (const a of attempts) {
        if (a.status !== 200 && a.status !== 0) {
          detailErrorsByStatus[a.status] = (detailErrorsByStatus[a.status] || 0) + 1;
        }
      }
      
      if (detailData) {
        detailsFetched++;
        
        // Merge detail data into subscription
        const idx = allSubscriptions.findIndex(s => s.id === sub.id);
        if (idx >= 0) {
          allSubscriptions[idx] = {
            ...allSubscriptions[idx],
            ...detailData,
            status: normalizeStatus(detailData.state || detailData.status || sub.status),
          };
        }
        
        // PATCH-U3: Save to provider_subscriptions for future DB-first reads
        const ps = providerSubsMap.get(sub.id);
        const updateData: Record<string, any> = {};
        
        if (detailData.next_billing_at && !ps?.next_charge_at) {
          updateData.next_charge_at = detailData.next_billing_at;
        }
        if (detailData.credit_card?.last_4 && !ps?.card_last4) {
          updateData.card_last4 = detailData.credit_card.last_4;
        }
        if (detailData.credit_card?.brand && !ps?.card_brand) {
          updateData.card_brand = detailData.credit_card.brand;
        }
        if (detailData.plan?.amount && !ps?.amount_cents) {
          const amountCents = detailData.plan.amount > 1000 ? detailData.plan.amount : detailData.plan.amount * 100;
          updateData.amount_cents = amountCents;
        }
        if (detailData.plan?.currency && !ps?.currency) {
          updateData.currency = detailData.plan.currency;
        }
        
        // Upsert to provider_subscriptions
        if (Object.keys(updateData).length > 0) {
          // Build snapshot for meta
          const newSnapshot = {
            state: normalizeStatus(detailData.state || detailData.status),
            next_billing_at: detailData.next_billing_at,
            credit_card: detailData.credit_card,
            plan: detailData.plan,
            customer: detailData.customer,
            last_transaction: detailData.last_transaction,
          };
          
          const existingMeta = (ps?.meta as Record<string, any>) || {};
          updateData.meta = {
            ...existingMeta,
            provider_snapshot: newSnapshot,
            snapshot_at: new Date().toISOString(),
          };
          updateData.state = normalizeStatus(detailData.state || detailData.status);
          updateData.raw_data = detailData;
          updateData.updated_at = new Date().toISOString();
          
          if (ps) {
            // Update existing
            await supabase
              .from('provider_subscriptions')
              .update(updateData)
              .eq('provider', 'bepaid')
              .eq('provider_subscription_id', sub.id);
          } else {
            // Insert new
            await supabase
              .from('provider_subscriptions')
              .upsert({
                provider: 'bepaid',
                provider_subscription_id: sub.id,
                ...updateData,
              }, { onConflict: 'provider,provider_subscription_id' });
          }
          upsertedIds.push(sub.id);
        }
      } else {
        detailsFailed++;
      }
    }

    // Get profiles for linking
    const userIds = [...new Set([
      ...[...bepaidIdToOurSub.values()].map((s) => s.user_id),
      ...(providerSubs || []).map(ps => ps.user_id).filter(Boolean),
      ...[...bepaidIdToOrder.values()].map(o => o.user_id).filter(Boolean),
    ])];
    
    const { data: profiles } = userIds.length > 0 ? await supabase
      .from('profiles')
      .select('user_id, full_name, email')
      .in('user_id', userIds) : { data: [] };

    const userIdToProfile = new Map(profiles?.map((p) => [p.user_id, { name: p.full_name, email: p.email }]) || []);

    // Build result with normalized status
    const result: SubscriptionWithLink[] = allSubscriptions.map((sub) => {
      const ourSub = sub.id ? bepaidIdToOurSub.get(String(sub.id)) : undefined;
      const providerSub = providerSubsMap.get(String(sub.id));
      
      // PATCH-U4: Get linked order/payment - priority chain
      // 1. orders_v2.meta->bepaid_subscription_id
      const linkedOrder = bepaidIdToOrder.get(String(sub.id));
      // 2. payments_v2.meta->bepaid_subscription_id (fallback)
      const linkedPaymentDirect = bepaidIdToPaymentDirect.get(String(sub.id));
      
      // Get payment from order if exists
      const paymentFromOrder = linkedOrder?.order_id ? orderIdToPayment.get(linkedOrder.order_id) : undefined;
      
      const linkedUserId = ourSub?.user_id || providerSub?.user_id || linkedOrder?.user_id || linkedPaymentDirect?.profile_id || null;
      const linkedSubId = ourSub?.id || providerSub?.subscription_v2_id || null;
      
      const profile = linkedUserId ? userIdToProfile.get(linkedUserId) : null;

      // PATCH-U5: Prioritize data sources for next_billing
      const nextBillingAt = sub.next_billing_at || 
                           providerSub?.next_charge_at || 
                           (providerSub?.meta as any)?.provider_snapshot?.next_billing_at || 
                           '';

      // Card data
      const cardLast4 = sub.credit_card?.last_4 || providerSub?.card_last4 || '';
      const cardBrand = sub.credit_card?.brand || providerSub?.card_brand || '';

      const planAmountRaw = sub.plan?.amount ?? providerSub?.amount_cents ?? 0;
      const planAmount = planAmountRaw > 1000 ? planAmountRaw / 100 : planAmountRaw;

      const rawStatus = sub.state || sub.status || 'unknown';
      const normalizedStatus = normalizeStatus(rawStatus);

      const providerMeta = providerSub?.meta as Record<string, any> | undefined;
      const snapshot = providerMeta?.provider_snapshot;
      
      // PATCH-TITLE: Use display_title from meta as fallback for plan title
      const displayTitleFromMeta = providerMeta?.display_title;
      const rawDataPlanTitle = (providerSub?.raw_data as any)?.plan?.title;
      
      // Extract canceled_at from bePaid data or snapshot
      const canceledAt = (sub as any).cancelled_at || (sub as any).canceled_at || 
                         snapshot?.cancelled_at || snapshot?.canceled_at || null;

      // PATCH-U4: Build payment/order links
      const linkedOrderId = linkedOrder?.order_id || linkedPaymentDirect?.order_id || null;
      const linkedOrderNumber = linkedOrder?.order_number || linkedPaymentDirect?.order_number || null;
      const linkedPaymentId = paymentFromOrder?.payment_id || linkedPaymentDirect?.payment_id || null;
      const linkedProviderPaymentId = paymentFromOrder?.provider_payment_id || linkedPaymentDirect?.provider_payment_id || null;

      return {
        id: String(sub.id),
        status: normalizedStatus,
        plan_title: sub.plan?.title || displayTitleFromMeta || rawDataPlanTitle || 'Без названия',
        plan_amount: planAmount,
        plan_currency: sub.plan?.currency || providerSub?.currency || 'BYN',
        customer_email: sub.customer?.email || '',
        customer_name:
          [sub.customer?.first_name, sub.customer?.last_name].filter(Boolean).join(' ') || sub.credit_card?.holder || '',
        card_last4: cardLast4,
        card_brand: cardBrand,
        created_at: sub.created_at || '',
        next_billing_at: nextBillingAt,
        linked_subscription_id: linkedSubId,
        linked_user_id: linkedUserId,
        linked_profile_name: profile?.name || profile?.email || null,
        is_orphan: !linkedSubId && !linkedUserId,
        snapshot_state: snapshot?.state ? normalizeStatus(snapshot.state) : undefined,
        snapshot_at: providerMeta?.snapshot_at,
        cancellation_capability: providerMeta?.cancellation_capability,
        needs_support: providerMeta?.needs_support,
        details_missing: !!(sub as any)._details_missing && !cardLast4,
        linked_order_id: linkedOrderId,
        linked_order_number: linkedOrderNumber,
        linked_payment_id: linkedPaymentId,
        linked_provider_payment_id: linkedProviderPaymentId,
        canceled_at: canceledAt,
      };
    });

    result.sort((a, b) => {
      const statusOrder: Record<string, number> = { active: 0, trial: 1, pending: 2, past_due: 3, canceled: 4 };
      const aOrder = statusOrder[a.status] ?? 5;
      const bOrder = statusOrder[b.status] ?? 5;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.next_billing_at || '').localeCompare(b.next_billing_at || '');
    });

    console.log(`[bepaid-list-subs] Result: ${result.length} total, API=${apiListCount}, DB-enriched=${dbEnriched}, details=${detailsFetched}/${detailsFailed}, upserted=${upsertedIds.length}`);

    return new Response(
      JSON.stringify({
        subscriptions: result,
        stats: {
          total: result.length,
          active: result.filter((s) => s.status === 'active').length,
          trial: result.filter((s) => s.status === 'trial').length,
          pending: result.filter((s) => s.status === 'pending').length,
          canceled: result.filter((s) => s.status === 'canceled').length,
          orphans: result.filter((s) => s.is_orphan).length,
          linked: result.filter((s) => !s.is_orphan).length,
        },
        debug: {
          creds_source: credentials.source,
          integration_status: credentials.instanceStatus || null,
          shop_id_present: true,
          secret_present: true,
          hosts_tried: BEPAID_HOSTS,
          paths_tried: LIST_PATHS,
          api_list_count: apiListCount,
          db_records_count: providerSubs?.length || 0,
          db_enriched_count: dbEnriched,
          details_fetched_count: detailsFetched,
          details_failed_count: detailsFailed,
          detail_errors_by_status: detailErrorsByStatus,
          upserted_count: upsertedIds.length,
          list_attempts: listAttempts.slice(0, 10),
          result_count: result.length,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (e: any) {
    console.error('Error listing subscriptions:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
