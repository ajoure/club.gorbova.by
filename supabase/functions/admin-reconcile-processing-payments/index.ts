import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUILD_ID = "reconcile-processing:2026-02-02T14:30:00Z";
const MAX_BATCH_SIZE = 50;
const DEFAULT_LIMIT = 20;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const sbUrl = Deno.env.get('SUPABASE_URL')!;
  const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(sbUrl, sbKey);

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.execute !== true;
    const limit = Math.min(body.limit || DEFAULT_LIMIT, MAX_BATCH_SIZE);
    const sinceDate = body.since_date || '2026-02-02T00:00:00Z';

    console.log(`[${BUILD_ID}] START: dry_run=${dryRun}, limit=${limit}`);

    const bepaidShopId = '33524';
    const bepaidSecretKey = Deno.env.get('BEPAID_SECRET_KEY');
    if (!bepaidSecretKey) throw new Error('BEPAID_SECRET_KEY not configured');

    const bepaidAuth = btoa(`${bepaidShopId}:${bepaidSecretKey}`);

    const { data: payments } = await supabase
      .from('payments_v2')
      .select('id, order_id, amount, currency')
      .eq('status', 'processing')
      .gte('created_at', sinceDate)
      .limit(limit);

    console.log(`[${BUILD_ID}] Found ${payments?.length || 0} processing payments`);

    const results: any[] = [];
    let succeeded = 0, failed = 0;

    for (const payment of payments || []) {
      try {
        const resp = await fetch(`https://gateway.bepaid.by/transactions?tracking_id=${payment.id}`, {
          headers: { 'Authorization': `Basic ${bepaidAuth}` },
        });
        const data = await resp.json();
        const tx = data?.transactions?.[0];

        if (!tx) {
          results.push({ id: payment.id, action: 'not_found_in_bepaid' });
          continue;
        }

        if (dryRun) {
          results.push({ id: payment.id, bepaid_status: tx.status, action: `dry_run:${tx.status}` });
          continue;
        }

        if (tx.status === 'successful') {
          await supabase.from('payments_v2').update({
            status: 'succeeded', provider_payment_id: tx.uid, provider_response: tx, paid_at: tx.created_at
          }).eq('id', payment.id);
          
          if (payment.order_id) {
            await supabase.from('orders_v2').update({ status: 'paid', paid_amount: payment.amount }).eq('id', payment.order_id);
            await supabase.functions.invoke('grant-access-for-order', { body: { orderId: payment.order_id } });
          }
          succeeded++;
          results.push({ id: payment.id, action: 'set_succeeded' });
        } else if (tx.status === 'failed' || tx.status === 'expired') {
          await supabase.from('payments_v2').update({
            status: 'failed', provider_payment_id: tx.uid, provider_response: tx, error_message: tx.message
          }).eq('id', payment.id);
          if (payment.order_id) {
            await supabase.from('orders_v2').update({ status: 'failed' }).eq('id', payment.order_id);
          }
          failed++;
          results.push({ id: payment.id, action: 'set_failed' });
        } else {
          results.push({ id: payment.id, bepaid_status: tx.status, action: 'unchanged' });
        }
      } catch (err) {
        results.push({ id: payment.id, action: 'error', error: String(err) });
      }
    }

    await supabase.from('audit_logs').insert({
      action: 'payments.reconcile_processing', actor_type: 'system', actor_label: BUILD_ID,
      meta: { dry_run: dryRun, total: results.length, succeeded, failed, duration_ms: Date.now() - startTime }
    });

    return new Response(JSON.stringify({ success: true, build_id: BUILD_ID, dry_run: dryRun, summary: { total: results.length, succeeded, failed }, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: String(error) }), { status: 500, headers: corsHeaders });
  }
});
