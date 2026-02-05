import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FixRequest {
  dry_run?: boolean;
  limit?: number;
  fix_orphans?: boolean;
  fix_mismatches?: boolean;
}

interface FixResult {
  success: boolean;
  dry_run: boolean;
  stats: {
    orphans_found: number;
    orphans_fixed: number;
    orphans_needs_mapping: number;
    mismatches_found: number;
    mismatches_fixed: number;
    mismatches_needs_mapping: number;
    errors: number;
  };
  orphan_samples: any[];
  mismatch_samples: any[];
  duration_ms: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify caller is admin
    const authHeader = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: corsHeaders 
      });
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: `Bearer ${authHeader}` } }
    });

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: corsHeaders 
      });
    }

    // Check admin role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: hasAdminRole } = await supabase.rpc('has_role', { 
      _user_id: user.id, 
      _role: 'super_admin' 
    });

    if (!hasAdminRole) {
      const { data: hasRegularAdmin } = await supabase.rpc('has_role', { 
        _user_id: user.id, 
        _role: 'admin' 
      });
      
      if (!hasRegularAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), { 
          status: 403, 
          headers: corsHeaders 
        });
      }
    }

    const body: FixRequest = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default true
    const limit = Math.min(Math.max(body.limit || 50, 1), 200);
    const fixOrphans = body.fix_orphans !== false;
    const fixMismatches = body.fix_mismatches !== false;

    const result: FixResult = {
      success: true,
      dry_run: dryRun,
      stats: {
        orphans_found: 0,
        orphans_fixed: 0,
        orphans_needs_mapping: 0,
        mismatches_found: 0,
        mismatches_fixed: 0,
        mismatches_needs_mapping: 0,
        errors: 0,
      },
      orphan_samples: [],
      mismatch_samples: [],
      duration_ms: 0,
    };

    // Fix orphan payments 2026+
    if (fixOrphans) {
      const { data: orphans } = await supabase
        .from('payments_v2')
        .select(`
          id,
          provider_payment_id,
          amount,
          currency,
          paid_at,
          profile_id,
          meta,
          profiles!inner (
            id,
            user_id,
            email
          )
        `)
        .gte('paid_at', '2026-01-01')
        .eq('status', 'succeeded')
        .gt('amount', 0)
        .not('profile_id', 'is', null)
        .is('order_id', null)
        .limit(limit);

      result.stats.orphans_found = orphans?.length || 0;

      for (const payment of (orphans || [])) {
        const profile = (payment as any).profiles;
        const userId = profile?.user_id;
        
        // Try to find product/tariff from subscription or last order
        let productId: string | null = null;
        let tariffId: string | null = null;
        let offerId: string | null = null;

        // Check if there's a subscription for this user
        if (userId) {
          const { data: sub } = await supabase
            .from('subscriptions_v2')
            .select('product_id, tariff_id, meta')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (sub) {
            productId = sub.product_id;
            tariffId = sub.tariff_id;
            offerId = (sub.meta as any)?.offer_id || null;
          }
        }

        // Fallback: check last paid order for this profile
        if (!productId) {
          const { data: lastOrder } = await supabase
            .from('orders_v2')
            .select('product_id, tariff_id, offer_id')
            .eq('profile_id', payment.profile_id)
            .eq('status', 'paid')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lastOrder) {
            productId = lastOrder.product_id;
            tariffId = lastOrder.tariff_id;
            offerId = lastOrder.offer_id;
          }
        }

        const sample: any = {
          payment_id: payment.id,
          provider_payment_id: payment.provider_payment_id,
          amount: payment.amount,
          profile_email: profile?.email,
          found_product_id: productId,
          found_tariff_id: tariffId,
          action: 'none',
        };

        if (!productId || !tariffId) {
          // Can't determine product - mark as needs_mapping
          sample.action = 'needs_mapping';
          result.stats.orphans_needs_mapping++;

          if (!dryRun) {
            await supabase
              .from('payments_v2')
              .update({
                meta: {
                  ...(payment.meta as object || {}),
                  requires_manual_mapping: true,
                  mapping_attempted_at: new Date().toISOString(),
                },
              })
              .eq('id', payment.id);
          }
        } else {
          // Create renewal order
          sample.action = 'create_order';

          if (!dryRun) {
            // Generate order number
            const now = new Date();
            const yearPart = now.getFullYear().toString().slice(-2);
            const { count } = await supabase
              .from('orders_v2')
              .select('id', { count: 'exact', head: true })
              .like('order_number', `ORD-${yearPart}-%`);

            const seqPart = ((count || 0) + 1).toString().padStart(5, '0');
            const orderNumber = `ORD-${yearPart}-${seqPart}`;

            const { data: newOrder, error: orderErr } = await supabase
              .from('orders_v2')
              .insert({
                order_number: orderNumber,
                user_id: userId,
                profile_id: payment.profile_id,
                product_id: productId,
                tariff_id: tariffId,
                offer_id: offerId,
                base_price: payment.amount,
                final_price: payment.amount,
                paid_amount: payment.amount,
                currency: payment.currency || 'BYN',
                status: 'paid',
                is_trial: false,
                customer_email: profile?.email,
                reconcile_source: 'fix_integrity_tool',
                meta: {
                  created_by_integrity_fix: true,
                  original_payment_id: payment.id,
                  fixed_at: now.toISOString(),
                },
              })
              .select()
              .single();

            if (orderErr) {
              sample.action = 'error';
              sample.error = orderErr.message;
              result.stats.errors++;
            } else {
              // Link payment to order
              await supabase
                .from('payments_v2')
                .update({
                  order_id: newOrder.id,
                  meta: {
                    ...(payment.meta as object || {}),
                    ensured_order_id: newOrder.id,
                    ensure_reason: 'orphan_fix_integrity',
                  },
                })
                .eq('id', payment.id);

              sample.created_order_id = newOrder.id;
              sample.created_order_number = newOrder.order_number;
              result.stats.orphans_fixed++;
            }
          } else {
            result.stats.orphans_fixed++;
          }
        }

        if (result.orphan_samples.length < 10) {
          result.orphan_samples.push(sample);
        }
      }
    }

    // Fix amount mismatches
    if (fixMismatches) {
      const { data: mismatches } = await supabase
        .from('payments_v2')
        .select(`
          id,
          provider_payment_id,
          amount,
          order_id,
          orders_v2!inner (
            id,
            order_number,
            final_price,
            paid_amount,
            status,
            is_trial
          )
        `)
        .eq('status', 'succeeded')
        .gt('amount', 0)
        .eq('orders_v2.status', 'paid')
        .limit(limit * 2);

      const actualMismatches = (mismatches || []).filter((p: any) => {
        const orderPrice = p.orders_v2?.final_price;
        return orderPrice !== null && orderPrice !== undefined && Number(orderPrice) !== Number(p.amount);
      }).slice(0, limit);

      result.stats.mismatches_found = actualMismatches.length;

      for (const payment of actualMismatches) {
        const order = (payment as any).orders_v2;
        
        const sample: any = {
          payment_id: payment.id,
          payment_amount: payment.amount,
          order_id: order?.id,
          order_number: order?.order_number,
          order_final_price: order?.final_price,
          order_is_trial: order?.is_trial,
          action: 'none',
        };

        // If order is trial and payment is non-trial amount, this is the Platonova case
        // The order should be updated to reflect the actual payment
        if (order?.is_trial && Number(payment.amount) > 5) {
          sample.action = 'update_order_price';

          if (!dryRun) {
            await supabase
              .from('orders_v2')
              .update({
                final_price: payment.amount,
                paid_amount: payment.amount,
                is_trial: false,
                meta: {
                  ...(order.meta || {}),
                  price_corrected_by_integrity_fix: true,
                  original_final_price: order.final_price,
                  corrected_at: new Date().toISOString(),
                },
              })
              .eq('id', order.id);

            result.stats.mismatches_fixed++;
          } else {
            result.stats.mismatches_fixed++;
          }
        } else {
          // Complex case - needs manual review
          sample.action = 'needs_mapping';
          result.stats.mismatches_needs_mapping++;
        }

        if (result.mismatch_samples.length < 10) {
          result.mismatch_samples.push(sample);
        }
      }
    }

    result.duration_ms = Date.now() - startTime;

    // Audit log
    await supabase.from('audit_logs').insert({
      actor_type: 'user',
      actor_user_id: user.id,
      actor_label: user.email || 'admin-fix-payments-integrity',
      action: dryRun ? 'payments.integrity_fix_dry_run' : 'payments.integrity_fix_executed',
      meta: {
        ...result.stats,
        dry_run: dryRun,
        limit,
        fix_orphans: fixOrphans,
        fix_mismatches: fixMismatches,
        duration_ms: result.duration_ms,
      },
    });

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[FIX-INTEGRITY] Error:', error);

    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
