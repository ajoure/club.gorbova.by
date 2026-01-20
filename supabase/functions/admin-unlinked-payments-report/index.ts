import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * admin-unlinked-payments-report
 * 
 * Aggregates unlinked payments (profile_id IS NULL) by card_last4 + card_brand.
 * Includes collision detection and detail retrieval.
 * 
 * Modes:
 * - aggregates (default): Get summary by card
 * - details: Get individual records for a specific card
 */

interface UnlinkedCardAggregation {
  last4: string;
  brand: string;
  unlinked_payments_v2_count: number;
  unlinked_queue_count: number;
  payments_amount: number;
  queue_amount: number;
  total_amount: number;
  last_seen_at: string | null;
  collision_risk: boolean;
}

interface UnlinkedPaymentDetail {
  id: string;
  uid: string | null;
  amount: number;
  paid_at: string | null;
  status: string | null;
  source: 'payments_v2' | 'queue';
  customer_email?: string | null;
  card_holder?: string | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAnon = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    // Get current user
    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check admin role
    const { data: isAdmin } = await supabaseAdmin.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin'
    });

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Forbidden: admin role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'aggregates';
    const last4 = body.last4;
    const brand = body.brand;

    console.log(`[admin-unlinked-payments-report] mode=${mode}, last4=${last4}, brand=${brand}`);

    // ========== MODE: DETAILS ==========
    if (mode === 'details' && last4 && brand) {
      const normalizedBrand = brand.toLowerCase().trim();

      // Fetch from payments_v2
      const { data: paymentsData } = await supabaseAdmin
        .from('payments_v2')
        .select('id, provider_payment_id, amount, paid_at, status, customer_email, card_holder')
        .eq('card_last4', last4)
        .ilike('card_brand', normalizedBrand)
        .is('profile_id', null)
        .order('paid_at', { ascending: false })
        .limit(100);

      // Fetch from queue
      const { data: queueData } = await supabaseAdmin
        .from('payment_reconcile_queue')
        .select('id, bepaid_uid, amount, paid_at, status, customer_email, card_holder')
        .eq('card_last4', last4)
        .ilike('card_brand', normalizedBrand)
        .is('matched_profile_id', null)
        .order('paid_at', { ascending: false, nullsFirst: false })
        .limit(100);

      const details: UnlinkedPaymentDetail[] = [];

      paymentsData?.forEach(p => {
        details.push({
          id: p.id,
          uid: p.provider_payment_id,
          amount: Number(p.amount) || 0,
          paid_at: p.paid_at,
          status: p.status,
          source: 'payments_v2',
          customer_email: p.customer_email,
          card_holder: p.card_holder,
        });
      });

      queueData?.forEach(q => {
        details.push({
          id: q.id,
          uid: q.bepaid_uid,
          amount: Number(q.amount) || 0,
          paid_at: q.paid_at,
          status: q.status,
          source: 'queue',
          customer_email: q.customer_email,
          card_holder: q.card_holder,
        });
      });

      // Sort by date
      details.sort((a, b) => {
        const dateA = a.paid_at ? new Date(a.paid_at).getTime() : 0;
        const dateB = b.paid_at ? new Date(b.paid_at).getTime() : 0;
        return dateB - dateA;
      });

      return new Response(JSON.stringify({
        ok: true,
        last4,
        brand: normalizedBrand,
        details,
        total: details.length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========== MODE: AGGREGATES ==========
    
    // 1) Get all unlinked payments grouped by card
    const { data: paymentsAgg } = await supabaseAdmin
      .from('payments_v2')
      .select('card_last4, card_brand, amount, paid_at')
      .is('profile_id', null)
      .not('card_last4', 'is', null)
      .not('card_brand', 'is', null);

    // 2) Get all unlinked queue items grouped by card
    const { data: queueAgg } = await supabaseAdmin
      .from('payment_reconcile_queue')
      .select('card_last4, card_brand, amount, paid_at, created_at')
      .is('matched_profile_id', null)
      .not('card_last4', 'is', null)
      .not('card_brand', 'is', null);

    // 3) Get collision data - cards linked to 2+ profiles
    // From card_profile_links
    const { data: cardLinks } = await supabaseAdmin
      .from('card_profile_links')
      .select('card_last4, card_brand, profile_id');

    // From payment_methods (need to join with profiles)
    const { data: paymentMethods } = await supabaseAdmin
      .from('payment_methods')
      .select('last4, brand, user_id')
      .eq('status', 'active');

    // Get profiles for payment_methods
    const userIds = [...new Set(paymentMethods?.map(pm => pm.user_id).filter(Boolean) || [])];
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id')
      .in('user_id', userIds);

    const userToProfile = new Map<string, string>();
    profiles?.forEach(p => {
      if (p.user_id) userToProfile.set(p.user_id, p.id);
    });

    // Build collision map: key = "last4|brand" -> Set of profile_ids
    const cardProfileMap = new Map<string, Set<string>>();

    cardLinks?.forEach(link => {
      if (!link.card_last4 || !link.card_brand) return;
      const key = `${link.card_last4}|${link.card_brand.toLowerCase()}`;
      if (!cardProfileMap.has(key)) cardProfileMap.set(key, new Set());
      if (link.profile_id) cardProfileMap.get(key)!.add(link.profile_id);
    });

    paymentMethods?.forEach(pm => {
      if (!pm.last4 || !pm.brand || !pm.user_id) return;
      const profileId = userToProfile.get(pm.user_id);
      if (!profileId) return;
      const key = `${pm.last4}|${pm.brand.toLowerCase()}`;
      if (!cardProfileMap.has(key)) cardProfileMap.set(key, new Set());
      cardProfileMap.get(key)!.add(profileId);
    });

    // Check collision: cards with 2+ profiles
    const collisionCards = new Set<string>();
    cardProfileMap.forEach((profileIds, key) => {
      if (profileIds.size >= 2) {
        collisionCards.add(key);
      }
    });

    // 4) Aggregate by card
    const aggregates = new Map<string, {
      last4: string;
      brand: string;
      unlinked_payments_v2_count: number;
      unlinked_queue_count: number;
      payments_amount: number;
      queue_amount: number;
      last_seen_payments: Date | null;
      last_seen_queue: Date | null;
    }>();

    paymentsAgg?.forEach(p => {
      if (!p.card_last4 || !p.card_brand) return;
      const key = `${p.card_last4}|${p.card_brand.toLowerCase()}`;
      
      if (!aggregates.has(key)) {
        aggregates.set(key, {
          last4: p.card_last4,
          brand: p.card_brand.toLowerCase(),
          unlinked_payments_v2_count: 0,
          unlinked_queue_count: 0,
          payments_amount: 0,
          queue_amount: 0,
          last_seen_payments: null,
          last_seen_queue: null,
        });
      }
      
      const agg = aggregates.get(key)!;
      agg.unlinked_payments_v2_count++;
      agg.payments_amount += Number(p.amount) || 0;
      
      if (p.paid_at) {
        const date = new Date(p.paid_at);
        if (!agg.last_seen_payments || date > agg.last_seen_payments) {
          agg.last_seen_payments = date;
        }
      }
    });

    queueAgg?.forEach(q => {
      if (!q.card_last4 || !q.card_brand) return;
      const key = `${q.card_last4}|${q.card_brand.toLowerCase()}`;
      
      if (!aggregates.has(key)) {
        aggregates.set(key, {
          last4: q.card_last4,
          brand: q.card_brand.toLowerCase(),
          unlinked_payments_v2_count: 0,
          unlinked_queue_count: 0,
          payments_amount: 0,
          queue_amount: 0,
          last_seen_payments: null,
          last_seen_queue: null,
        });
      }
      
      const agg = aggregates.get(key)!;
      agg.unlinked_queue_count++;
      agg.queue_amount += Number(q.amount) || 0;
      
      const dateStr = q.paid_at || q.created_at;
      if (dateStr) {
        const date = new Date(dateStr);
        if (!agg.last_seen_queue || date > agg.last_seen_queue) {
          agg.last_seen_queue = date;
        }
      }
    });

    // 5) Convert to response format
    const cards: UnlinkedCardAggregation[] = [];
    let totalUnlinkedPayments = 0;
    let totalUnlinkedQueue = 0;

    aggregates.forEach((agg, key) => {
      totalUnlinkedPayments += agg.unlinked_payments_v2_count;
      totalUnlinkedQueue += agg.unlinked_queue_count;

      // Determine last seen
      let lastSeenAt: string | null = null;
      if (agg.last_seen_payments && agg.last_seen_queue) {
        lastSeenAt = (agg.last_seen_payments > agg.last_seen_queue 
          ? agg.last_seen_payments 
          : agg.last_seen_queue).toISOString();
      } else if (agg.last_seen_payments) {
        lastSeenAt = agg.last_seen_payments.toISOString();
      } else if (agg.last_seen_queue) {
        lastSeenAt = agg.last_seen_queue.toISOString();
      }

      cards.push({
        last4: agg.last4,
        brand: agg.brand,
        unlinked_payments_v2_count: agg.unlinked_payments_v2_count,
        unlinked_queue_count: agg.unlinked_queue_count,
        payments_amount: agg.payments_amount,
        queue_amount: agg.queue_amount,
        total_amount: agg.payments_amount + agg.queue_amount,
        last_seen_at: lastSeenAt,
        collision_risk: collisionCards.has(key),
      });
    });

    // Sort by total count descending
    cards.sort((a, b) => {
      const totalA = a.unlinked_payments_v2_count + a.unlinked_queue_count;
      const totalB = b.unlinked_payments_v2_count + b.unlinked_queue_count;
      return totalB - totalA;
    });

    console.log(`[admin-unlinked-payments-report] Found ${cards.length} cards with ${totalUnlinkedPayments} payments + ${totalUnlinkedQueue} queue items`);

    return new Response(JSON.stringify({
      ok: true,
      cards,
      total_unlinked_payments: totalUnlinkedPayments,
      total_unlinked_queue: totalUnlinkedQueue,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[admin-unlinked-payments-report] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(JSON.stringify({
      ok: false,
      error: message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
