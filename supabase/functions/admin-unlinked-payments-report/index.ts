import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * admin-unlinked-payments-report
 * 
 * Uses SQL RPC functions for efficient aggregation.
 * 
 * Modes:
 * - aggregates (default): Get summary by card via RPC admin_unlinked_cards_report
 * - details: Get individual records via RPC admin_unlinked_cards_details
 * 
 * Request body:
 * {
 *   mode: 'aggregates' | 'details',
 *   last4?: string,      // Required for details mode (exactly 4 digits)
 *   brand?: string,      // Required for details mode
 *   limit?: number,      // 1-500, default 100
 *   offset?: number      // >= 0, default 0
 * }
 */

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
    const last4 = body.last4?.toString().trim() || null;
    const brand = body.brand?.toString().trim() || null;

    // Validate and clamp pagination params
    const limit = Math.min(Math.max(parseInt(body.limit) || 100, 1), 500);
    const offset = Math.max(parseInt(body.offset) || 0, 0);

    console.log(`[admin-unlinked-payments-report] mode=${mode}, last4=${last4}, brand=${brand}, limit=${limit}, offset=${offset}`);

    // ============================================================
    // MODE: DETAILS - use RPC admin_unlinked_cards_details
    // ============================================================
    if (mode === 'details') {
      // Validation for details mode
      if (!last4 || !/^\d{4}$/.test(last4)) {
        return new Response(JSON.stringify({
          ok: false,
          error: 'last4 must be exactly 4 digits'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!brand) {
        return new Response(JSON.stringify({
          ok: false,
          error: 'brand is required'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const normalizedBrand = brand.toLowerCase().trim();

      const { data: details, error: detailsError } = await supabaseAdmin.rpc(
        'admin_unlinked_cards_details',
        {
          _last4: last4,
          _brand: normalizedBrand,
          _limit: limit,
          _offset: offset,
        }
      );

      if (detailsError) {
        console.error('RPC admin_unlinked_cards_details error:', detailsError);
        throw detailsError;
      }

      const totalCount = details?.[0]?.total_count || 0;

      return new Response(JSON.stringify({
        ok: true,
        last4,
        brand: normalizedBrand,
        details: (details || []).map((d: any) => ({
          id: d.id,
          uid: d.uid,
          amount: d.amount,
          paid_at: d.paid_at,
          status: d.status,
          source: d.source,
          customer_email: d.customer_email,
          card_holder: d.card_holder,
        })),
        total: totalCount,
        pagination: { limit, offset, has_more: (details?.length || 0) === limit }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================================
    // MODE: AGGREGATES - use RPC admin_unlinked_cards_report
    // ============================================================
    const normalizedBrandFilter = brand?.toLowerCase().trim() || null;

    const { data: cards, error: cardsError } = await supabaseAdmin.rpc(
      'admin_unlinked_cards_report',
      {
        _limit: limit,
        _offset: offset,
        _brand: normalizedBrandFilter,
        _last4: last4,
      }
    );

    if (cardsError) {
      console.error('RPC admin_unlinked_cards_report error:', cardsError);
      throw cardsError;
    }

    // Calculate totals from aggregates
    let totalUnlinkedPayments = 0;
    let totalUnlinkedQueue = 0;
    (cards || []).forEach((card: any) => {
      totalUnlinkedPayments += parseInt(card.unlinked_payments_v2_count) || 0;
      totalUnlinkedQueue += parseInt(card.unlinked_queue_count) || 0;
    });

    console.log(`[admin-unlinked-payments-report] Found ${(cards || []).length} cards with ${totalUnlinkedPayments} payments + ${totalUnlinkedQueue} queue items`);

    return new Response(JSON.stringify({
      ok: true,
      cards: (cards || []).map((card: any) => ({
        last4: card.last4,
        brand: card.brand,
        unlinked_payments_v2_count: parseInt(card.unlinked_payments_v2_count) || 0,
        unlinked_queue_count: parseInt(card.unlinked_queue_count) || 0,
        payments_amount: parseFloat(card.payments_amount) || 0,
        queue_amount: parseFloat(card.queue_amount) || 0,
        total_amount: parseFloat(card.total_amount) || 0,
        last_seen_at: card.last_seen_at,
        collision_risk: card.collision_risk,
      })),
      total_unlinked_payments: totalUnlinkedPayments,
      total_unlinked_queue: totalUnlinkedQueue,
      pagination: { limit, offset, has_more: (cards?.length || 0) === limit }
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
