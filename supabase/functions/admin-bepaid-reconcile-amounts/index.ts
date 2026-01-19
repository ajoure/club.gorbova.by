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
  bepaid_http_status?: number;
  bepaid_endpoint?: string;
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

async function getBepaidCredentials(supabase: any): Promise<{ shopId: string; secretKey: string } | null> {
  // integration_instances first (preferred)
  const { data: instance } = await supabase
    .from('integration_instances')
    .select('config')
    .eq('provider', 'bepaid')
    .eq('status', 'active')
    .maybeSingle();

  const shopIdFromInstance = instance?.config?.shop_id;
  const secretFromInstance = instance?.config?.secret_key;

  if (shopIdFromInstance && secretFromInstance) {
    return { shopId: String(shopIdFromInstance), secretKey: String(secretFromInstance) };
  }

  // fallback: env vars
  const shopId = Deno.env.get('BEPAID_SHOP_ID');
  const secretKey = Deno.env.get('BEPAID_SECRET_KEY');
  if (shopId && secretKey) return { shopId, secretKey };

  return null;
}

async function fetchTransaction(uid: string, authString: string): Promise<{ tx: any; endpoint: string; status: number } | null> {
  const endpoints = [
    `https://api.bepaid.by/beyag/transactions/${uid}`,
    `https://api.bepaid.by/v2/transactions/${uid}`,
  ];

  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${authString}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    if (res.ok) {
      const data = await res.json();
      const tx = data?.transaction;
      if (tx) return { tx, endpoint, status: res.status };
      return null;
    }

    if (res.status === 404) continue;

    const errText = await res.text();
    throw new Error(`bePaid API error ${res.status} for ${endpoint}: ${errText}`);
  }

  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

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

    const credentials = await getBepaidCredentials(supabase);
    if (!credentials) {
      return new Response(JSON.stringify({ success: false, error: 'bePaid credentials not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const params: ReconcileParams = await req.json();
    const {
      from_date = '2026-01-01',
      to_date = '2026-12-31',
      dry_run = true,
      filter_only_amount_1 = false,
      batch_size = 200,
    } = params;

    console.log(
      `[Reconcile] Starting reconciliation: ${from_date} to ${to_date}, dry_run=${dry_run}, filter_amount_1=${filter_only_amount_1}`
    );

    let query = supabase
      .from('payments_v2')
      .select('id, provider_payment_id, order_id, amount, transaction_type, status, paid_at, meta, profile_id, user_id')
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

    const authString = btoa(`${credentials.shopId}:${credentials.secretKey}`);

    for (const payment of payments || []) {
      result.checked++;

      const uid = payment.provider_payment_id as string | null;
      if (!uid) {
        result.skipped++;
        continue;
      }

      try {
        const fetched = await fetchTransaction(uid, authString);
        if (!fetched?.tx) {
          result.skipped++;
          continue;
        }

        const tx = fetched.tx;

        // bePaid stores in cents/kopecks
        let bepaidAmount = (tx.amount ?? 0) / 100;

        // Refunds should be negative in our system
        const isRefund =
          tx.type === 'refund' ||
          (payment.transaction_type && String(payment.transaction_type).toLowerCase().includes('refund')) ||
          (payment.transaction_type && String(payment.transaction_type).toLowerCase().includes('возврат'));

        if (isRefund && bepaidAmount > 0) {
          bepaidAmount = -bepaidAmount;
        }

        const ourAmount = Number(payment.amount);
        const diff = Math.abs(ourAmount - bepaidAmount);

        if (diff > 0.01) {
          const discrepancy: Discrepancy = {
            payment_id: payment.id,
            provider_payment_id: uid,
            order_id: payment.order_id,
            our_amount: ourAmount,
            bepaid_amount: bepaidAmount,
            transaction_type: payment.transaction_type || tx.type || 'unknown',
            status: payment.status || tx.status || 'unknown',
            paid_at: payment.paid_at,
            customer_email: tx.customer?.email || null,
            bepaid_http_status: fetched.status,
            bepaid_endpoint: fetched.endpoint,
          };

          result.discrepancies.push(discrepancy);
          result.discrepancies_found++;

          if (!dry_run) {
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
                  bepaid_transaction_type: tx.type,
                },
              })
              .eq('id', payment.id);

            if (updateError) {
              throw new Error(`Failed to update payment: ${updateError.message}`);
            }

            await supabase.from('audit_logs').insert({
              actor_user_id: user.id,
              actor_type: 'admin',
              action: 'payment_amount_reconciled',
              target_user_id: payment.profile_id,
              meta: {
                payment_id: payment.id,
                provider_payment_id: uid,
                order_id: payment.order_id,
                old_amount: ourAmount,
                new_amount: bepaidAmount,
                source: 'bepaid_api_reconcile_2026',
              },
            });

            result.fixed++;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 80));
      } catch (error) {
        console.error(`[Reconcile] Error processing payment ${payment.id}:`, error);
        result.errors++;
        result.error_details.push({
          payment_id: payment.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    console.log(
      `[Reconcile] Complete: checked=${result.checked}, discrepancies=${result.discrepancies_found}, fixed=${result.fixed}, skipped=${result.skipped}, errors=${result.errors}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        dry_run,
        ...result,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[Reconcile] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
