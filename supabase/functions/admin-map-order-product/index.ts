/**
 * Admin endpoint for manual order product mapping
 * 
 * Features:
 * - RBAC: admin only
 * - dry_run mode for preview (default: true)
 * - SYSTEM ACTOR audit logs
 * - Optional automatic grant after mapping
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Dual-client RBAC
    const authHeader = req.headers.get('Authorization');
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader || '' } },
    });
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check auth
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check admin role
    const { data: hasAdmin } = await supabase.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });
    if (!hasAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const {
      order_id,
      product_id,
      tariff_id = null,
      offer_id = null,
      grant_access = false,
      dry_run = true,  // DEFAULT: dry_run
    } = await req.json();

    if (!order_id || !product_id) {
      return new Response(JSON.stringify({ error: 'order_id and product_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load order
    const { data: order, error: orderErr } = await supabase
      .from('orders_v2')
      .select('id, status, product_id, tariff_id, offer_id, user_id, meta')
      .eq('id', order_id)
      .single();

    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate: must be needs_mapping
    if (order.status !== 'needs_mapping') {
      return new Response(JSON.stringify({ 
        error: 'Order is not in needs_mapping status',
        current_status: order.status,
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate product exists
    const { data: product } = await supabase
      .from('products_v2')
      .select('id, name')
      .eq('id', product_id)
      .single();

    if (!product) {
      return new Response(JSON.stringify({ error: 'Product not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // DRY RUN: return what would happen
    if (dry_run) {
      return new Response(JSON.stringify({
        dry_run: true,
        order_id,
        current_status: order.status,
        will_set_product: product_id,
        will_set_tariff: tariff_id,
        will_set_offer: offer_id,
        will_set_status: 'paid',
        will_grant_access: grant_access,
        product_name: product.name,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // EXECUTE: Apply mapping
    const existingMeta = (order.meta || {}) as Record<string, any>;
    
    const { error: updateErr } = await supabase
      .from('orders_v2')
      .update({
        product_id,
        tariff_id,
        offer_id,
        status: 'paid',
        meta: {
          ...existingMeta,
          mapping_applied_at: new Date().toISOString(),
          mapping_applied_by: user.id,
          previous_product_id: order.product_id,
          previous_status: order.status,
        },
      })
      .eq('id', order_id);

    if (updateErr) {
      return new Response(JSON.stringify({ error: 'Failed to update order', details: updateErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // SYSTEM ACTOR audit log
    await supabase.from('audit_logs').insert({
      action: 'order.mapping_applied',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'admin-map-order-product',
      target_user_id: order.user_id,
      meta: {
        order_id,
        product_id,
        tariff_id,
        offer_id,
        applied_by_user_id: user.id,
        grant_access_requested: grant_access,
      },
    });

    // Optional: Grant access
    let grantResult = null;
    if (grant_access) {
      const grantResponse = await fetch(`${supabaseUrl}/functions/v1/grant-access-for-order`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderId: order_id }),
      });
      grantResult = await grantResponse.json();
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: false,
      order_id,
      product_id,
      new_status: 'paid',
      grant_result: grantResult,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[admin-map-order-product] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal error', details: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
