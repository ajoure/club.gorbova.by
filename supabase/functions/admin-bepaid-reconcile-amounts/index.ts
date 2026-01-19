import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReconcileParams {
  from_date?: string; // YYYY-MM-DD
  to_date?: string;
  dry_run?: boolean;
  filter_only_amount_1?: boolean;
  batch_size?: number;
}

interface Discrepancy {
  payment_id: string;
  provider_payment_id: string | null;
  order_id: string | null;
  our_amount: number;
  bepaid_amount: number;
  transaction_type: string;
  status: string;
  paid_at: string;
  customer_email: string | null;
}

interface ReconcileResult {
  checked: number;
  discrepancies_found: number;
  fixed: number;
  skipped: number;
  errors: number;
  discrepancies: Discrepancy[];
  error_details: Array<{ payment_id: string; error: string }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const bepaidSecretKey = Deno.env.get('BEPAID_SECRET_KEY');

    if (!bepaidSecretKey) {
      throw new Error('BEPAID_SECRET_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check
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
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check admin role
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

    const params: ReconcileParams = await req.json();
    const {
      from_date = '2026-01-01',
      to_date = '2026-12-31',
      dry_run = true,
      filter_only_amount_1 = false,
      batch_size = 100,
    } = params;

    console.log(`[Reconcile] Starting reconciliation: ${from_date} to ${to_date}, dry_run=${dry_run}, filter_amount_1=${filter_only_amount_1}`);

    // Build query for payments
    let query = supabase
      .from('payments_v2')
      .select('id, provider_payment_id, order_id, amount, transaction_type, status, paid_at, customer_email, meta, profile_id')
      .eq('provider', 'bepaid')
      .gte('paid_at', `${from_date}T00:00:00Z`)
      .lte('paid_at', `${to_date}T23:59:59Z`)
      .not('provider_payment_id', 'is', null)
      .order('paid_at', { ascending: false })
      .limit(batch_size);

    if (filter_only_amount_1) {
      query = query.eq('amount', 1);
    }

    const { data: payments, error: paymentsError } = await query;

    if (paymentsError) {
      throw new Error(`Failed to fetch payments: ${paymentsError.message}`);
    }

    console.log(`[Reconcile] Found ${payments?.length || 0} payments to check`);

    const result: ReconcileResult = {
      checked: 0,
      discrepancies_found: 0,
      fixed: 0,
      skipped: 0,
      errors: 0,
      discrepancies: [],
      error_details: [],
    };

    const bepaidAuth = btoa(`:${bepaidSecretKey}`);

    for (const payment of payments || []) {
      result.checked++;

      if (!payment.provider_payment_id) {
        result.skipped++;
        continue;
      }

      try {
        // Fetch transaction from bePaid API
        const bepaidResponse = await fetch(
          `https://api.bepaid.by/v2/transactions/${payment.provider_payment_id}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Basic ${bepaidAuth}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!bepaidResponse.ok) {
          if (bepaidResponse.status === 404) {
            result.skipped++;
            continue;
          }
          const errorText = await bepaidResponse.text();
          throw new Error(`bePaid API error ${bepaidResponse.status}: ${errorText}`);
        }

        const bepaidData = await bepaidResponse.json();
        const tx = bepaidData.transaction;

        if (!tx) {
          result.skipped++;
          continue;
        }

        // Calculate correct amount (bePaid stores in kopecks)
        let bepaidAmount = tx.amount / 100;
        
        // For refunds, amount should be negative
        const isRefund = tx.type === 'refund' || 
                         payment.transaction_type?.toLowerCase().includes('refund') ||
                         payment.transaction_type?.toLowerCase().includes('возврат');
        
        if (isRefund && bepaidAmount > 0) {
          bepaidAmount = -bepaidAmount;
        }

        // Compare amounts (with tolerance for floating point)
        const ourAmount = payment.amount;
        const diff = Math.abs(ourAmount - bepaidAmount);

        if (diff > 0.01) {
          const discrepancy: Discrepancy = {
            payment_id: payment.id,
            provider_payment_id: payment.provider_payment_id,
            order_id: payment.order_id,
            our_amount: ourAmount,
            bepaid_amount: bepaidAmount,
            transaction_type: payment.transaction_type || tx.type || 'unknown',
            status: payment.status || tx.status || 'unknown',
            paid_at: payment.paid_at,
            customer_email: payment.customer_email,
          };

          result.discrepancies.push(discrepancy);
          result.discrepancies_found++;

          // Fix if not dry run
          if (!dry_run) {
            // Update payment amount
            const { error: updateError } = await supabase
              .from('payments_v2')
              .update({
                amount: bepaidAmount,
                meta: {
                  ...(payment.meta || {}),
                  original_amount: ourAmount,
                  amount_corrected_at: new Date().toISOString(),
                  amount_corrected_source: 'bepaid_api_reconcile_2026',
                  bepaid_raw_amount: tx.amount,
                },
              })
              .eq('id', payment.id);

            if (updateError) {
              throw new Error(`Failed to update payment: ${updateError.message}`);
            }

            // Update order if exists and is simple case (single payment)
            if (payment.order_id) {
              const { data: orderPayments } = await supabase
                .from('payments_v2')
                .select('id, amount, status')
                .eq('order_id', payment.order_id)
                .eq('status', 'successful');

              // Only update if single successful payment
              if (orderPayments && orderPayments.length === 1) {
                const { error: orderError } = await supabase
                  .from('orders_v2')
                  .update({
                    base_price: Math.abs(bepaidAmount),
                    final_price: Math.abs(bepaidAmount),
                    paid_amount: Math.abs(bepaidAmount),
                    meta: supabase.rpc('jsonb_set', {
                      target: 'meta',
                      path: '{amount_corrected_at}',
                      new_value: `"${new Date().toISOString()}"`,
                    }),
                  })
                  .eq('id', payment.order_id);

                if (orderError) {
                  console.warn(`Failed to update order ${payment.order_id}: ${orderError.message}`);
                }
              }
            }

            // Audit log
            await supabase.from('audit_logs').insert({
              actor_user_id: user.id,
              actor_type: 'admin',
              action: 'payment_amount_reconciled',
              target_user_id: payment.profile_id,
              meta: {
                payment_id: payment.id,
                provider_payment_id: payment.provider_payment_id,
                order_id: payment.order_id,
                old_amount: ourAmount,
                new_amount: bepaidAmount,
                source: 'bepaid_api_reconcile_2026',
              },
            });

            result.fixed++;
          }
        }

        // Rate limiting - be nice to bePaid API
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`[Reconcile] Error processing payment ${payment.id}:`, error);
        result.errors++;
        result.error_details.push({
          payment_id: payment.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    console.log(`[Reconcile] Complete: checked=${result.checked}, discrepancies=${result.discrepancies_found}, fixed=${result.fixed}`);

    return new Response(JSON.stringify({
      success: true,
      dry_run,
      ...result,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Reconcile] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
