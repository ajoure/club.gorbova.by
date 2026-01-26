import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Admin Backfill: Create Renewal Orders for Existing Succeeded Payments
 * 
 * Finds payments that:
 * - status = 'succeeded'
 * - amount > 10 (not trial)
 * - linked to trial order (is_trial = true)
 * - have no renewal_order_id in meta
 * 
 * Creates renewal orders and relinks payments.
 */
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Auth check using user's token
    const authHeader = req.headers.get('Authorization');
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader || '' } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Admin client for data operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // RBAC check
    const { data: userRoles } = await supabase
      .from('user_roles_v2')
      .select('role_id, roles!inner(name)')
      .eq('user_id', user.id);

    const isAdmin = userRoles?.some((r: any) =>
      ['admin', 'superadmin', 'super_admin'].includes(r.roles?.name?.toLowerCase())
    );

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // Default to dry_run = true
    const batchLimit = Math.min(body.batch_limit || 50, 200);
    const specificPaymentId = body.payment_id || null;

    console.log(`Backfill renewal orders: dry_run=${dryRun}, batch_limit=${batchLimit}, payment_id=${specificPaymentId}`);

    // Find candidates: succeeded payments linked to trial orders without renewal_order_id
    let query = supabase
      .from('payments_v2')
      .select(`
        id,
        amount,
        status,
        paid_at,
        order_id,
        user_id,
        profile_id,
        provider_payment_id,
        currency,
        meta,
        orders_v2!inner(id, is_trial, product_id, tariff_id, customer_email, customer_phone)
      `)
      .eq('status', 'succeeded')
      .gt('amount', 10)
      .eq('orders_v2.is_trial', true)
      .limit(batchLimit);

    if (specificPaymentId) {
      query = query.eq('id', specificPaymentId);
    }

    const { data: candidates, error: fetchError } = await query;

    if (fetchError) {
      console.error('Failed to fetch candidates:', fetchError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: fetchError.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter out payments that already have renewal_order_id
    const toProcess = (candidates || []).filter((p: any) => {
      const meta = p.meta || {};
      return !meta.renewal_order_id;
    });

    console.log(`Found ${candidates?.length || 0} candidates, ${toProcess.length} to process`);

    if (dryRun) {
      // Log dry-run
      await supabase.from('audit_logs').insert({
        action: 'subscription.renewal_backfill_dry_run',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'admin-backfill-renewal-orders',
        meta: {
          requested_by_user_id: user.id,
          dry_run: true,
          candidates_count: candidates?.length || 0,
          to_process_count: toProcess.length,
          sample_ids: toProcess.slice(0, 10).map((p: any) => p.id),
        },
      });

      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        candidates_count: candidates?.length || 0,
        to_process: toProcess.length,
        sample: toProcess.slice(0, 10).map((p: any) => ({
          payment_id: p.id,
          amount: p.amount,
          order_id: p.order_id,
          paid_at: p.paid_at,
          user_id: p.user_id,
          bepaid_uid: p.provider_payment_id || (p.meta as any)?.bepaid_uid,
        })),
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // EXECUTE mode
    let processed = 0;
    let failed = 0;
    const errors: string[] = [];
    const createdOrders: string[] = [];

    for (const payment of toProcess) {
      try {
        const bepaidUid = payment.provider_payment_id || (payment.meta as any)?.bepaid_uid;
        const order = payment.orders_v2 as any;

        // Idempotency check: order already exists with this bepaid_uid?
        if (bepaidUid) {
          const { data: existingOrder } = await supabase
            .from('orders_v2')
            .select('id')
            .eq('user_id', payment.user_id)
            .contains('meta', { bepaid_uid: bepaidUid })
            .maybeSingle();

          if (existingOrder?.id) {
            // Already exists, just relink payment
            const existingPaymentMeta = (payment.meta || {}) as Record<string, any>;
            await supabase
              .from('payments_v2')
              .update({
                order_id: existingOrder.id,
                meta: {
                  ...existingPaymentMeta,
                  renewal_order_id: existingOrder.id,
                  original_trial_order_id: payment.order_id,
                  backfill_relinked_at: new Date().toISOString(),
                },
              })
              .eq('id', payment.id);

            processed++;
            createdOrders.push(existingOrder.id);
            continue;
          }
        }

        // Generate order number
        const { data: ordNum } = await supabase.rpc('generate_order_number');
        const orderNumber = ordNum || `REN-${Date.now().toString(36).toUpperCase()}`;

        // Get profile_id if not set
        let profileId = payment.profile_id;
        if (!profileId && payment.user_id) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('user_id', payment.user_id)
            .maybeSingle();
          profileId = profile?.id ?? null;
        }

        // Create renewal order
        const { data: newOrder, error: createErr } = await supabase
          .from('orders_v2')
          .insert({
            order_number: orderNumber,
            user_id: payment.user_id,
            profile_id: profileId,
            status: 'paid',
            currency: payment.currency || 'BYN',
            base_price: payment.amount,
            final_price: payment.amount,
            paid_amount: payment.amount,
            is_trial: false,
            product_id: order?.product_id ?? null,
            tariff_id: order?.tariff_id ?? null,
            customer_email: order?.customer_email ?? null,
            customer_phone: order?.customer_phone ?? null,
            meta: {
              source: 'subscription-renewal',
              backfill: true,
              backfill_at: new Date().toISOString(),
              payment_id: payment.id,
              bepaid_uid: bepaidUid,
              original_order_id: payment.order_id,
            },
          })
          .select('id, order_number')
          .single();

        if (createErr || !newOrder) {
          console.error(`Failed to create renewal order for payment ${payment.id}:`, createErr);
          errors.push(`payment ${payment.id}: ${createErr?.message || 'unknown error'}`);
          failed++;
          continue;
        }

        // Relink payment to new order
        const existingPaymentMeta = (payment.meta || {}) as Record<string, any>;
        const { error: linkErr } = await supabase
          .from('payments_v2')
          .update({
            order_id: newOrder.id,
            meta: {
              ...existingPaymentMeta,
              renewal_order_id: newOrder.id,
              original_trial_order_id: payment.order_id,
              backfill_relinked_at: new Date().toISOString(),
            },
          })
          .eq('id', payment.id);

        if (linkErr) {
          console.error(`Failed to relink payment ${payment.id}:`, linkErr);
          errors.push(`payment ${payment.id} link: ${linkErr.message}`);
          failed++;
          continue;
        }

        processed++;
        createdOrders.push(newOrder.id);
        console.log(`Created renewal order ${newOrder.order_number} for payment ${payment.id}`);
      } catch (err) {
        console.error(`Error processing payment ${payment.id}:`, err);
        errors.push(`payment ${payment.id}: ${(err as Error).message}`);
        failed++;
        // STOP on critical error
        if (failed >= 5) {
          console.error('Too many failures, stopping batch');
          break;
        }
      }
    }

    // Log execution result
    await supabase.from('audit_logs').insert({
      action: 'subscription.renewal_backfill_executed',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'admin-backfill-renewal-orders',
      meta: {
        requested_by_user_id: user.id,
        dry_run: false,
        candidates_count: candidates?.length || 0,
        to_process_count: toProcess.length,
        processed,
        failed,
        created_order_ids: createdOrders.slice(0, 20),
        errors: errors.slice(0, 10),
      },
    });

    return new Response(JSON.stringify({
      success: true,
      dry_run: false,
      candidates_count: candidates?.length || 0,
      to_process: toProcess.length,
      processed,
      failed,
      created_orders: createdOrders,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Backfill error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: (error as Error).message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
