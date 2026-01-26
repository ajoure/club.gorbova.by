import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BackfillRequest {
  dry_run?: boolean;
  limit?: number;
}

interface BackfillResult {
  success: boolean;
  dry_run: boolean;
  // Flat fields for UI compatibility
  total_candidates: number;
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  needs_mapping: number;
  sample_ids: string[];
  created_orders: string[];
  errors: string[];
  // Original nested structure (kept for backward compatibility)
  stats: {
    scanned: number;
    created: number;
    needs_mapping: number;
    skipped: number;
    errors: number;
  };
  samples: Array<{
    payment_id: string;
    profile_id: string | null;
    amount: number;
    order_id: string | null;
    result: 'created' | 'needs_mapping' | 'skipped' | 'error';
    error?: string;
  }>;
  warnings: string[];
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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check - require super_admin
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

    // Check superadmin permission (enum value is 'superadmin' not 'super_admin')
    const { data: isSuperAdmin } = await supabase.rpc('has_role', { 
      _user_id: user.id, 
      _role: 'superadmin' 
    });

    if (!isSuperAdmin) {
      // Diagnostic payload: helps detect “silent impersonation” / wrong session in the browser.
      // Safe enough for this admin-only tool; still does NOT reveal any secrets.
      return new Response(JSON.stringify({
        error: 'Super admin permission required',
        debug: {
          authenticated_user_id: user.id,
          authenticated_email: user.email,
          role_checked: 'superadmin',
        },
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: BackfillRequest = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default true
    const limit = Math.min(Math.max(body.limit || 20, 1), 100);

    // Accumulators for flat response fields
    const createdOrderIds: string[] = [];
    const errorMessages: string[] = [];

    const result: BackfillResult = {
      success: true,
      dry_run: dryRun,
      // Flat fields (will be populated at the end)
      total_candidates: 0,
      processed: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      needs_mapping: 0,
      sample_ids: [],
      created_orders: [],
      errors: [],
      // Nested stats (backward compatibility)
      stats: {
        scanned: 0,
        created: 0,
        needs_mapping: 0,
        skipped: 0,
        errors: 0,
      },
      samples: [],
      warnings: [],
      duration_ms: 0,
    };

    // Find orphan payments 2026+ that need orders
    const { data: orphanPayments, error: fetchError } = await supabase
      .from('payments_v2')
      .select('id, profile_id, amount, currency, paid_at, provider_payment_id, meta')
      .gte('paid_at', '2026-01-01T00:00:00Z')
      .eq('status', 'succeeded')
      .gt('amount', 0)
      .not('profile_id', 'is', null)
      .not('provider_payment_id', 'is', null)
      .is('order_id', null)
      .order('paid_at', { ascending: true })
      .limit(limit);

    if (fetchError) {
      throw new Error(`Failed to fetch orphan payments: ${fetchError.message}`);
    }

    result.stats.scanned = orphanPayments?.length || 0;

    if (!orphanPayments || orphanPayments.length === 0) {
      result.duration_ms = Date.now() - startTime;
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Process each orphan payment
    for (const payment of orphanPayments) {
      const sampleEntry = {
        payment_id: payment.id,
        profile_id: payment.profile_id,
        amount: payment.amount,
        order_id: null as string | null,
        result: 'created' as 'created' | 'needs_mapping' | 'skipped' | 'error',
        error: undefined as string | undefined,
      };

      try {
        // Get user_id from profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('id', payment.profile_id)
          .maybeSingle();

        if (!profile?.user_id) {
          sampleEntry.result = 'skipped';
          sampleEntry.error = 'No user_id for profile';
          result.stats.skipped++;
          if (result.samples.length < 10) result.samples.push(sampleEntry);
          continue;
        }

        // Try to find product/tariff from subscription or recent orders
        let productId: string | null = null;
        let tariffId: string | null = null;

        // Try 1: Active subscription for this user
        const { data: activeSub } = await supabase
          .from('subscriptions_v2')
          .select('product_id, tariff_id')
          .eq('user_id', profile.user_id)
          .in('status', ['active', 'trial', 'grace'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (activeSub) {
          productId = activeSub.product_id;
          tariffId = activeSub.tariff_id;
        }

        // Try 2: Last paid order for this user
        if (!productId) {
          const { data: lastOrder } = await supabase
            .from('orders_v2')
            .select('product_id, tariff_id')
            .eq('user_id', profile.user_id)
            .eq('status', 'paid')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lastOrder) {
            productId = lastOrder.product_id;
            tariffId = lastOrder.tariff_id;
          }
        }

        const needsMapping = !productId;

        if (dryRun) {
          sampleEntry.result = needsMapping ? 'needs_mapping' : 'created';
          if (needsMapping) result.stats.needs_mapping++;
          else result.stats.created++;
          if (result.samples.length < 10) result.samples.push(sampleEntry);
          continue;
        }

        // Generate order number
        const { data: ordNum } = await supabase.rpc('generate_order_number');
        const orderNumber = ordNum || `BF26-${Date.now().toString(36).toUpperCase()}`;

        // Create order
        const { data: newOrder, error: insertError } = await supabase
          .from('orders_v2')
          .insert({
            order_number: orderNumber,
            user_id: profile.user_id,
            profile_id: payment.profile_id,
            status: 'paid',
            currency: payment.currency || 'BYN',
            base_price: payment.amount,
            final_price: payment.amount,
            paid_amount: payment.amount,
            is_trial: false,
            product_id: productId,
            tariff_id: tariffId,
            meta: {
              source: 'admin-backfill-2026-orders',
              backfill_payment_id: payment.id,
              backfill_at: new Date().toISOString(),
              bepaid_uid: payment.provider_payment_id,
              needs_mapping: needsMapping,
            },
          })
          .select('id, order_number')
          .single();

        if (insertError) {
          sampleEntry.result = 'error';
          sampleEntry.error = insertError.message;
          result.stats.errors++;
          if (result.samples.length < 10) result.samples.push(sampleEntry);
          continue;
        }

        // Link payment to order
        await supabase
          .from('payments_v2')
          .update({ order_id: newOrder.id })
          .eq('id', payment.id);

        sampleEntry.order_id = newOrder.id;
        sampleEntry.result = needsMapping ? 'needs_mapping' : 'created';
        createdOrderIds.push(newOrder.id);
        
        if (needsMapping) result.stats.needs_mapping++;
        else result.stats.created++;
        
        if (result.samples.length < 10) result.samples.push(sampleEntry);

      } catch (err: any) {
        sampleEntry.result = 'error';
        sampleEntry.error = err.message;
        result.stats.errors++;
        if (errorMessages.length < 50) {
          errorMessages.push(`Payment ${payment.id}: ${err.message}`);
        }
        if (result.samples.length < 10) result.samples.push(sampleEntry);
      }
    }

    // Populate flat fields from stats and samples
    result.total_candidates = result.stats.scanned;
    result.processed = result.stats.scanned;
    result.created = result.stats.created;
    result.skipped = result.stats.skipped;
    result.failed = result.stats.errors;
    result.needs_mapping = result.stats.needs_mapping;
    result.sample_ids = result.samples.slice(0, 10).map(s => s.payment_id);
    result.created_orders = createdOrderIds.slice(0, 50);
    result.errors = errorMessages;

    // Write audit log with enhanced meta
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'admin-backfill-2026-orders',
      action: dryRun ? 'subscription.renewal_backfill_2026_dry_run' : 'subscription.renewal_backfill_2026',
      meta: {
        requested_by_user_id: user.id,
        requested_by_email: user.email,
        dry_run: dryRun,
        limit,
        stats: result.stats,
        total_candidates: result.stats.scanned,
        created_count: result.stats.created,
        needs_mapping_count: result.stats.needs_mapping,
        skipped_count: result.stats.skipped,
        error_count: result.stats.errors,
        sample_payment_ids: result.samples.slice(0, 5).map(s => s.payment_id),
        created_order_ids: createdOrderIds.slice(0, 10),
      },
    });

    result.duration_ms = Date.now() - startTime;

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Backfill 2026 error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      duration_ms: Date.now() - startTime,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
