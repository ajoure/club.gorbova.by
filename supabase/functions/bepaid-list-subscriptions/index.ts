import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  // Link to our system
  linked_subscription_id: string | null;
  linked_user_id: string | null;
  linked_profile_name: string | null;
  is_orphan: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const bepaidSecretKey = Deno.env.get('BEPAID_SECRET_KEY');
    
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
      _role: 'admin' 
    });
    
    if (!hasAdminRole) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!bepaidSecretKey) {
      return new Response(JSON.stringify({ 
        error: 'BEPAID_SECRET_KEY not configured',
        subscriptions: [],
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bepaidAuth = btoa(`${bepaidSecretKey}:`);
    
    // Step 1: Collect all bePaid subscription IDs from our database
    const { data: dbSubs } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, meta, status')
      .not('meta->bepaid_subscription_id', 'is', null);
    
    // Create a map: bepaid_subscription_id -> our subscription
    const bepaidIdToOurSub = new Map<string, { id: string; user_id: string; status: string }>();
    for (const sub of dbSubs || []) {
      const bepaidId = (sub.meta as any)?.bepaid_subscription_id;
      if (bepaidId) {
        bepaidIdToOurSub.set(bepaidId, { id: sub.id, user_id: sub.user_id, status: sub.status });
      }
    }
    
    // Step 2: Fetch subscriptions from bePaid API
    const allSubscriptions: BepaidSubscription[] = [];
    const fetchedIds = new Set<string>();
    
    // Try listing endpoints with different statuses
    const statuses = ['active', 'trial', 'cancelled', 'past_due'];
    
    for (const status of statuses) {
      let page = 1;
      let hasMore = true;
      
      while (hasMore && page <= 10) { // Max 10 pages per status
        try {
          const response = await fetch(
            `https://api.bepaid.by/subscriptions?status=${status}&page=${page}&per_page=50`,
            {
              method: 'GET',
              headers: {
                'Authorization': `Basic ${bepaidAuth}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
            }
          );
          
          if (response.ok) {
            const data = await response.json();
            const subs = data.subscriptions || data.data || [];
            
            if (Array.isArray(subs) && subs.length > 0) {
              for (const sub of subs) {
                if (!fetchedIds.has(sub.id)) {
                  fetchedIds.add(sub.id);
                  allSubscriptions.push(sub);
                }
              }
              page++;
            } else {
              hasMore = false;
            }
          } else {
            hasMore = false;
          }
        } catch (e) {
          console.error(`Error fetching ${status} subscriptions page ${page}:`, e);
          hasMore = false;
        }
      }
    }
    
    // Step 3: Fallback - fetch individual subscriptions from our DB references
    if (allSubscriptions.length === 0) {
      console.log('Listing API returned nothing, trying individual lookups...');
      
      for (const [bepaidId] of bepaidIdToOurSub) {
        if (fetchedIds.has(bepaidId)) continue;
        
        try {
          const response = await fetch(
            `https://api.bepaid.by/subscriptions/${bepaidId}`,
            {
              method: 'GET',
              headers: {
                'Authorization': `Basic ${bepaidAuth}`,
                'Content-Type': 'application/json',
              },
            }
          );
          
          if (response.ok) {
            const data = await response.json();
            if (data.subscription) {
              fetchedIds.add(bepaidId);
              allSubscriptions.push({
                id: bepaidId,
                status: data.subscription.state || data.subscription.status,
                plan: data.subscription.plan,
                created_at: data.subscription.created_at,
                next_billing_at: data.subscription.next_billing_at,
                credit_card: data.subscription.credit_card,
                customer: data.subscription.customer,
              });
            }
          }
        } catch (e) {
          console.error(`Error fetching subscription ${bepaidId}:`, e);
        }
      }
    }
    
    // Step 4: Fetch profile names for linked subscriptions
    const userIds = [...new Set(
      [...bepaidIdToOurSub.values()].map(s => s.user_id).filter(Boolean)
    )];
    
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name, email')
      .in('user_id', userIds);
    
    const userIdToProfile = new Map(
      profiles?.map(p => [p.user_id, { name: p.full_name, email: p.email }]) || []
    );
    
    // Step 5: Build result with link information
    const result: SubscriptionWithLink[] = allSubscriptions.map(sub => {
      const ourSub = bepaidIdToOurSub.get(sub.id);
      const profile = ourSub ? userIdToProfile.get(ourSub.user_id) : null;
      
      return {
        id: sub.id,
        status: sub.state || sub.status || 'unknown',
        plan_title: sub.plan?.title || 'Без названия',
        plan_amount: (sub.plan?.amount || 0) / 100, // Convert from kopecks
        plan_currency: sub.plan?.currency || 'BYN',
        customer_email: sub.customer?.email || '',
        customer_name: [sub.customer?.first_name, sub.customer?.last_name].filter(Boolean).join(' ') ||
                       sub.credit_card?.holder || '',
        card_last4: sub.credit_card?.last_4 || '',
        card_brand: sub.credit_card?.brand || '',
        created_at: sub.created_at || '',
        next_billing_at: sub.next_billing_at || '',
        linked_subscription_id: ourSub?.id || null,
        linked_user_id: ourSub?.user_id || null,
        linked_profile_name: profile?.name || profile?.email || null,
        is_orphan: !ourSub,
      };
    });
    
    // Sort: active first, then by next_billing_at
    result.sort((a, b) => {
      const statusOrder: Record<string, number> = { active: 0, trial: 1, past_due: 2, cancelled: 3 };
      const aOrder = statusOrder[a.status] ?? 4;
      const bOrder = statusOrder[b.status] ?? 4;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.next_billing_at || '').localeCompare(b.next_billing_at || '');
    });
    
    console.log(`Found ${result.length} total subscriptions, ${result.filter(s => s.is_orphan).length} orphans`);
    
    return new Response(JSON.stringify({
      subscriptions: result,
      stats: {
        total: result.length,
        active: result.filter(s => s.status === 'active').length,
        trial: result.filter(s => s.status === 'trial').length,
        cancelled: result.filter(s => s.status === 'cancelled').length,
        orphans: result.filter(s => s.is_orphan).length,
        linked: result.filter(s => !s.is_orphan).length,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    console.error('Error listing subscriptions:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
