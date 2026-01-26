import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PurgeRequest {
  dry_run?: boolean;
  provider_payment_ids?: string[];
  import_batch_id?: string;
  purge_tracking_as_uid?: boolean; // Find payments where provider_payment_id = meta.tracking_id
  limit?: number;
}

interface PurgeResult {
  success: boolean;
  dry_run: boolean;
  stats: {
    found: number;
    purged: number;
    unlinked_orders: number;
    errors: number;
  };
  affected_payments: Array<{
    id: string;
    provider_payment_id: string | null;
    amount: number;
    paid_at: string | null;
    order_id: string | null;
    action: 'would_purge' | 'purged' | 'error';
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

    // Check super_admin permission
    const { data: isSuperAdmin } = await supabase.rpc('has_role', { 
      _user_id: user.id, 
      _role: 'super_admin' 
    });

    if (!isSuperAdmin) {
      return new Response(JSON.stringify({ error: 'Super admin permission required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: PurgeRequest = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default true
    const limit = Math.min(Math.max(body.limit || 50, 1), 500);

    const result: PurgeResult = {
      success: true,
      dry_run: dryRun,
      stats: {
        found: 0,
        purged: 0,
        unlinked_orders: 0,
        errors: 0,
      },
      affected_payments: [],
      warnings: [],
      duration_ms: 0,
    };

    // Build query based on input
    let query = supabase
      .from('payments_v2')
      .select('id, provider_payment_id, amount, paid_at, order_id, meta, status')
      .limit(limit);

    if (body.provider_payment_ids && body.provider_payment_ids.length > 0) {
      query = query.in('provider_payment_id', body.provider_payment_ids);
    } else if (body.import_batch_id) {
      query = query.contains('meta', { import_batch_id: body.import_batch_id });
    } else if (body.purge_tracking_as_uid) {
      // Find payments where provider_payment_id matches tracking_id in meta
      // This requires fetching and filtering in JS since Postgres can't easily compare these
      query = query.not('meta->tracking_id', 'is', null);
    } else {
      return new Response(JSON.stringify({ 
        error: 'Must specify provider_payment_ids, import_batch_id, or purge_tracking_as_uid' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: payments, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch payments: ${fetchError.message}`);
    }

    // Filter for tracking_as_uid case
    let targetPayments = payments || [];
    if (body.purge_tracking_as_uid) {
      targetPayments = targetPayments.filter(p => {
        const meta = p.meta as Record<string, unknown> | null;
        const trackingId = meta?.tracking_id as string | undefined;
        return trackingId && p.provider_payment_id === trackingId;
      });
    }

    result.stats.found = targetPayments.length;

    if (targetPayments.length === 0) {
      result.duration_ms = Date.now() - startTime;
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Process each payment
    for (const payment of targetPayments) {
      const paymentInfo = {
        id: payment.id,
        provider_payment_id: payment.provider_payment_id,
        amount: payment.amount,
        paid_at: payment.paid_at,
        order_id: payment.order_id,
        action: dryRun ? 'would_purge' : 'purged',
      } as PurgeResult['affected_payments'][0];

      if (dryRun) {
        result.affected_payments.push(paymentInfo);
        result.stats.purged++;
        continue;
      }

      try {
        // Step 1: Unlink from order if linked
        if (payment.order_id) {
          // Just unlink the payment, don't touch the order
          result.stats.unlinked_orders++;
        }

        // Step 2: Delete the payment
        const { error: deleteError } = await supabase
          .from('payments_v2')
          .delete()
          .eq('id', payment.id);

        if (deleteError) {
          paymentInfo.action = 'error';
          paymentInfo.error = deleteError.message;
          result.stats.errors++;
        } else {
          paymentInfo.action = 'purged';
          result.stats.purged++;
        }

        result.affected_payments.push(paymentInfo);
      } catch (err: any) {
        paymentInfo.action = 'error';
        paymentInfo.error = err.message;
        result.stats.errors++;
        result.affected_payments.push(paymentInfo);
      }
    }

    // Write audit log
    if (!dryRun && result.stats.purged > 0) {
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'admin-purge-payments-by-uid',
        action: 'payment.purge_executed',
        meta: {
          requested_by: user.id,
          stats: result.stats,
          sample_ids: result.affected_payments.slice(0, 5).map(p => p.id),
          input: {
            provider_payment_ids: body.provider_payment_ids?.slice(0, 5),
            import_batch_id: body.import_batch_id,
            purge_tracking_as_uid: body.purge_tracking_as_uid,
          },
        },
      });
    } else if (dryRun) {
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'admin-purge-payments-by-uid',
        action: 'payment.purge_dry_run',
        meta: {
          requested_by: user.id,
          found: result.stats.found,
          would_purge: result.stats.purged,
          sample_ids: result.affected_payments.slice(0, 5).map(p => p.id),
        },
      });
    }

    result.duration_ms = Date.now() - startTime;

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Purge error:', error);
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
