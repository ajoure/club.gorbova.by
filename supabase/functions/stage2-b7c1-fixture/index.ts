// TEMPORARY: Stage 2 / B7-C1 controlled synthetic runtime fixture manager.
// Deleted after runtime verification. Auth: CRON_SECRET only.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RUNTIME_TAG = 'stage2_b7c1_synthetic_v2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const cron = req.headers.get('x-cron-secret');
  if (!cron || cron !== Deno.env.get('CRON_SECRET')) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { action, ids } = await req.json();

  if (action === 'seed') {
    // Reuse existing product/tariff (Gorbova Club).
    const productId = '11c9f1b8-0355-4753-bd74-40b42aa53616';
    const { data: tariff } = await supabase
      .from('tariffs')
      .select('id, access_days')
      .eq('product_id', productId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    // Create a synthetic auth user (service_role admin API) so grant-access has
    // a real target. Profile.user_id has FK → auth.users(id).
    const syntheticEmail = `stage2-b7c1-${Date.now()}@synthetic.local`;
    const { data: authCreated, error: authErr } = await supabase.auth.admin.createUser({
      email: syntheticEmail,
      email_confirm: true,
      user_metadata: { runtime_tag: RUNTIME_TAG, synthetic: true },
    });
    if (authErr || !authCreated?.user) return json({ step: 'auth_user', error: authErr }, 500);
    const userId = authCreated.user.id;

    // A DB trigger on auth.users may auto-create a profile row; fetch or upsert.
    let profile: { id: string; user_id: string } | null = null;
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) {
      const { data: updated } = await supabase
        .from('profiles')
        .update({
          email: syntheticEmail,
          full_name: 'Stage2 B7C1 Synthetic',
          source: 'synthetic',
          meta: { runtime_tag: RUNTIME_TAG, synthetic: true },
        })
        .eq('id', existing.id)
        .select('id, user_id')
        .single();
      profile = updated ?? existing;
    } else {
      const { data: created, error: profileErr } = await supabase
        .from('profiles')
        .insert({
          user_id: userId,
          email: syntheticEmail,
          full_name: 'Stage2 B7C1 Synthetic',
          source: 'synthetic',
          meta: { runtime_tag: RUNTIME_TAG, synthetic: true },
        })
        .select('id, user_id')
        .single();
      if (profileErr || !created) return json({ step: 'profile', error: profileErr }, 500);
      profile = created;
    }

    const orderId = crypto.randomUUID();
    const subscriptionV2Id = crypto.randomUUID();
    const providerSubscriptionId = `synth-b7c1-${Date.now()}`;
    const trackingId = `subv2:${subscriptionV2Id}:order:${orderId}`;
    const now = new Date();

    // Canonical installment block required by bepaid-webhook finite-internal guard.
    const canonicalInstallmentBlock = {
      type: 'internal',
      provider: 'bepaid',
      model: 'bepaid_finite_subscription',
      infinite: false,
      billing_cycles: 2,
      installment_count: 2,
      interval_days: 30,
      original_order_id: orderId,
      as_finite_subscription: true,
      selected_installment_months: 2,
    };

    const { error: orderErr } = await supabase.from('orders_v2').insert({
      id: orderId,
      order_number: `SYNTH-B7C1-${Date.now()}`,
      user_id: userId,
      profile_id: profile.id,
      product_id: productId,
      tariff_id: tariff?.id ?? null,
      base_price: 2650,
      final_price: 2650,
      currency: 'BYN',
      status: 'pending',
      payer_type: 'individual',
      meta: {
        runtime_tag: RUNTIME_TAG,
        synthetic: true,
        test_fixture: true,
        installment: canonicalInstallmentBlock,
        payment_method: 'internal_installment',
      },
    });
    if (orderErr) return json({ step: 'order', error: orderErr }, 500);

    const { error: subErr } = await supabase.from('subscriptions_v2').insert({
      id: subscriptionV2Id,
      user_id: userId,
      profile_id: profile.id,
      order_id: orderId,
      product_id: productId,
      tariff_id: tariff?.id ?? null,
      status: 'past_due',
      access_start_at: now.toISOString(),
      is_trial: false,
      auto_renew: false,
      billing_type: 'mit',
      meta: {
        runtime_tag: RUNTIME_TAG,
        synthetic: true,
        model: 'internal_installment',
        installment: canonicalInstallmentBlock,
        payment_method: 'internal_installment',
        installment_count: 2,
        billing_cycles: 2,
        amount_byn: 1325,
        currency: 'BYN',
        tariff_access_days: tariff?.access_days ?? 30,
      },
    });
    if (subErr) return json({ step: 'sub', error: subErr }, 500);

    const { error: psErr } = await supabase.from('provider_subscriptions').insert({
      provider: 'bepaid',
      provider_subscription_id: providerSubscriptionId,
      user_id: userId,
      profile_id: profile.id,
      subscription_v2_id: subscriptionV2Id,
      order_id: orderId,
      state: 'pending',
      amount_cents: 132500,
      currency: 'BYN',
      interval_days: 30,
      meta: {
        runtime_tag: RUNTIME_TAG,
        synthetic: true,
        tracking_id: trackingId,
        order_id: orderId,
        installment: canonicalInstallmentBlock,
        payment_method: 'internal_installment',
        installment_count: 2,
        billing_cycles: 2,
        model: 'bepaid_finite_subscription',
      },
    });
    if (psErr) return json({ step: 'provider_sub', error: psErr }, 500);


    return json({
      ok: true,
      user_id: userId,
      profile_id: profile.id,
      order_id: orderId,
      subscription_v2_id: subscriptionV2Id,
      provider_subscription_id: providerSubscriptionId,
      tracking_id: trackingId,
    });
  }

  if (action === 'cleanup') {
    const {
      user_id,
      profile_id,
      order_id,
      subscription_v2_id,
      provider_subscription_id,
    } = ids ?? {};
    const report: Record<string, unknown> = {};

    // Delete in FK-safe order.
    const del = async (table: string, filter: (q: any) => any) => {
      const { error, count } = await filter(
        supabase.from(table).delete({ count: 'exact' }),
      );
      report[table] = error ? { error: error.message } : { deleted: count };
    };

    if (order_id) {
      await del('payment_reconcile_queue', (q) => q.eq('processed_order_id', order_id));
      await del('payments_v2', (q) => q.eq('order_id', order_id));
      await del('entitlements', (q) => q.eq('source_order_id', order_id));
      await del('access_grant_ledger', (q) => q.eq('order_id', order_id));
      await del('order_notification_deliveries', (q) => q.eq('order_id', order_id));
      await del('installment_payments', (q) => q.eq('order_id', order_id));
    }
    if (profile_id) {
      await del('payment_reconcile_queue', (q) => q.eq('matched_profile_id', profile_id));
    }
    if (provider_subscription_id) {
      await del('provider_subscriptions', (q) => q.eq('provider_subscription_id', provider_subscription_id));
    }

    if (subscription_v2_id) {
      await del('subscriptions_v2', (q) => q.eq('id', subscription_v2_id));
    }
    if (order_id) {
      await del('orders_v2', (q) => q.eq('id', order_id));
    }
    if (profile_id) {
      await del('profiles', (q) => q.eq('id', profile_id));
    }
    if (user_id) {
      try {
        const { error: authDelErr } = await supabase.auth.admin.deleteUser(user_id);
        report['auth_user'] = authDelErr ? { error: authDelErr.message } : { deleted: 1 };
      } catch (e) {
        report['auth_user'] = { error: (e as Error).message };
      }
    }
    return json({ ok: true, report });
  }

  if (action === 'inspect') {
    const {
      order_id,
      subscription_v2_id,
      provider_subscription_id,
    } = ids ?? {};
    const [orders, subs, prov, pays, grants, notif] = await Promise.all([
      supabase.from('orders_v2').select('id,status,final_price,meta,updated_at').eq('id', order_id).maybeSingle(),
      supabase.from('subscriptions_v2').select('id,status,next_charge_at,auto_renew,billing_type,meta,updated_at').eq('id', subscription_v2_id).maybeSingle(),
      supabase.from('provider_subscriptions').select('provider_subscription_id,state,next_charge_at,last_charge_at,meta,updated_at').eq('provider_subscription_id', provider_subscription_id).maybeSingle(),
      supabase.from('payments_v2').select('id,amount,status,provider_payment_id,order_id,created_at,meta').eq('order_id', order_id).order('created_at'),
      supabase.from('access_grant_ledger').select('id,outcome,order_id,created_at').eq('order_id', order_id).order('created_at'),
      supabase.from('order_notification_deliveries').select('id,channel,status,order_id,created_at').eq('order_id', order_id).order('created_at'),
    ]);
    return json({
      order: orders.data,
      subscription_v2: subs.data,
      provider_subscription: prov.data,
      payments_v2: pays.data,
      access_grants: grants.data,
      notifications: notif.data,
    });
  }

  return json({ error: 'unknown_action' }, 400);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
