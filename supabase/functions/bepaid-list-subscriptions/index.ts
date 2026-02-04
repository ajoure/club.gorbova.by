import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// PATCH-H: Centralized status normalization
function normalizeStatus(status: string | undefined): string {
  if (!status) return 'unknown';
  // cancelled → canceled
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
  // Extended from provider_subscriptions.meta
  snapshot_state?: string;
  snapshot_at?: string;
  cancellation_capability?: string;
  needs_support?: boolean;
}

interface CredentialsResult {
  shopId: string;
  secretKey: string;
  source: 'integration_instance' | 'env_vars';
  instanceStatus?: string;
}

async function getBepaidCredentials(supabase: any): Promise<CredentialsResult | null> {
  // Check both 'active' and 'connected' statuses
  const { data: instance } = await supabase
    .from('integration_instances')
    .select('config, status')
    .eq('provider', 'bepaid')
    .in('status', ['active', 'connected'])
    .maybeSingle();

  const shopIdFromInstance = instance?.config?.shop_id;
  const secretFromInstance = instance?.config?.secret_key;
  if (shopIdFromInstance && secretFromInstance) {
    console.log(`[bepaid-list-subs] Using creds from integration_instances: shop_id=${shopIdFromInstance}, status=${instance?.status}`);
    return { 
      shopId: String(shopIdFromInstance), 
      secretKey: String(secretFromInstance),
      source: 'integration_instance',
      instanceStatus: instance?.status
    };
  }

  const shopId = Deno.env.get('BEPAID_SHOP_ID');
  const secretKey = Deno.env.get('BEPAID_SECRET_KEY');
  if (shopId && secretKey) {
    console.log(`[bepaid-list-subs] Using creds from env vars: shop_id=${shopId}`);
    return { shopId, secretKey, source: 'env_vars' };
  }

  return null;
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

    const { data: hasAdminRole } = await supabase.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });

    if (!hasAdminRole) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const credentials = await getBepaidCredentials(supabase);
    if (!credentials) {
      console.error('[bepaid-list-subs] No credentials found');
      return new Response(JSON.stringify({ 
        subscriptions: [], 
        stats: { total: 0, active: 0, trial: 0, canceled: 0, orphans: 0, linked: 0 }, 
        error: 'bePaid credentials not configured',
        debug: {
          checked_statuses: ['active', 'connected'],
          integration_found: false,
          has_secret: false
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authString = btoa(`${credentials.shopId}:${credentials.secretKey}`);

    // 1) Collect subscription IDs we know about (for linking)
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

    // Also get provider_subscriptions for extended data
    const { data: providerSubs } = await supabase
      .from('provider_subscriptions')
      .select('provider_subscription_id, subscription_v2_id, user_id, meta, state')
      .eq('provider', 'bepaid');

    const providerSubsMap = new Map<string, any>();
    for (const ps of providerSubs || []) {
      providerSubsMap.set(ps.provider_subscription_id, ps);
    }

    const allSubscriptions: BepaidSubscription[] = [];
    const fetchedIds = new Set<string>();

    // 2) Try listing
    const statuses = ['active', 'trial', 'cancelled', 'past_due'];  // bePaid uses 'cancelled'
    for (const status of statuses) {
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= 10) {
        const url = `https://api.bepaid.by/subscriptions?status=${encodeURIComponent(status)}&page=${page}&per_page=50`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Basic ${authString}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          // Don't fail the whole function; just stop paging this status
          const text = await response.text();
          console.warn(`[bepaid-list-subscriptions] list ${status} page ${page} failed: ${response.status} ${text}`);
          hasMore = false;
          continue;
        }

        const data = await response.json();
        const subs = data.subscriptions || data.data || [];

        if (Array.isArray(subs) && subs.length > 0) {
          for (const sub of subs) {
            if (sub?.id && !fetchedIds.has(sub.id)) {
              fetchedIds.add(sub.id);
              allSubscriptions.push(sub);
            }
          }
          page++;
        } else {
          hasMore = false;
        }
      }
    }

    // 3) Fallback: fetch individual known IDs
    if (allSubscriptions.length === 0) {
      console.log('Listing API returned nothing, trying individual lookups...');

      for (const [bepaidId] of bepaidIdToOurSub) {
        if (fetchedIds.has(bepaidId)) continue;

        const url = `https://api.bepaid.by/subscriptions/${bepaidId}`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Basic ${authString}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          const text = await response.text();
          console.warn(`[bepaid-list-subscriptions] get ${bepaidId} failed: ${response.status} ${text}`);
          continue;
        }

        const data = await response.json();
        if (data?.subscription) {
          fetchedIds.add(bepaidId);
          allSubscriptions.push({
            id: bepaidId,
            status: data.subscription.state || data.subscription.status,
            state: data.subscription.state,
            plan: data.subscription.plan,
            created_at: data.subscription.created_at,
            next_billing_at: data.subscription.next_billing_at,
            credit_card: data.subscription.credit_card,
            customer: data.subscription.customer,
          });
        }
      }
    }

    // 4) Map profile names
    const userIds = [...new Set([...bepaidIdToOurSub.values()].map((s) => s.user_id).filter(Boolean))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name, email')
      .in('user_id', userIds);

    const userIdToProfile = new Map(profiles?.map((p) => [p.user_id, { name: p.full_name, email: p.email }]) || []);

    // 5) Build result with PATCH-H: Normalize status
    const result: SubscriptionWithLink[] = allSubscriptions.map((sub) => {
      const ourSub = sub.id ? bepaidIdToOurSub.get(String(sub.id)) : undefined;
      const profile = ourSub ? userIdToProfile.get(ourSub.user_id) : null;
      const providerSub = providerSubsMap.get(String(sub.id));

      const planAmountRaw = sub.plan?.amount ?? 0;
      const planAmount = planAmountRaw > 1000 ? planAmountRaw / 100 : planAmountRaw; // defensive

      // PATCH-H: Normalize status
      const rawStatus = sub.state || sub.status || 'unknown';
      const normalizedStatus = normalizeStatus(rawStatus);

      // Get extended data from provider_subscriptions.meta
      const providerMeta = providerSub?.meta as Record<string, any> | undefined;
      const snapshot = providerMeta?.provider_snapshot;

      return {
        id: String(sub.id),
        status: normalizedStatus,  // Normalized
        plan_title: sub.plan?.title || 'Без названия',
        plan_amount: planAmount,
        plan_currency: sub.plan?.currency || 'BYN',
        customer_email: sub.customer?.email || '',
        customer_name:
          [sub.customer?.first_name, sub.customer?.last_name].filter(Boolean).join(' ') || sub.credit_card?.holder || '',
        card_last4: sub.credit_card?.last_4 || '',
        card_brand: sub.credit_card?.brand || '',
        created_at: sub.created_at || '',
        next_billing_at: sub.next_billing_at || '',
        linked_subscription_id: ourSub?.id || null,
        linked_user_id: ourSub?.user_id || null,
        linked_profile_name: profile?.name || profile?.email || null,
        is_orphan: !ourSub,
        // Extended snapshot data
        snapshot_state: snapshot?.state ? normalizeStatus(snapshot.state) : undefined,
        snapshot_at: providerMeta?.snapshot_at,
        cancellation_capability: providerMeta?.cancellation_capability,
        needs_support: providerMeta?.needs_support,
      };
    });

    result.sort((a, b) => {
      // Use 'canceled' in sort order
      const statusOrder: Record<string, number> = { active: 0, trial: 1, past_due: 2, canceled: 3 };
      const aOrder = statusOrder[a.status] ?? 4;
      const bOrder = statusOrder[b.status] ?? 4;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.next_billing_at || '').localeCompare(b.next_billing_at || '');
    });

    console.log(`Found ${result.length} total subscriptions, ${result.filter((s) => s.is_orphan).length} orphans`);

    // PATCH-A: Use 'canceled' in stats (not 'cancelled')
    return new Response(
      JSON.stringify({
        subscriptions: result,
        stats: {
          total: result.length,
          active: result.filter((s) => s.status === 'active').length,
          trial: result.filter((s) => s.status === 'trial').length,
          canceled: result.filter((s) => s.status === 'canceled').length,  // Correct spelling
          orphans: result.filter((s) => s.is_orphan).length,
          linked: result.filter((s) => !s.is_orphan).length,
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
