// Stage 2.5 G15 runtime helper — ONE-OFF test trigger.
// Creates a real Stripe Subscription via API with a failing PaymentMethod
// (test card 4000 0000 0000 0341) to produce a REAL `invoice.payment_failed`
// event from Stripe (not synthetic webhook injection).
//
// SCOPE:
//  - Reuses existing customer cus_* if provided, else creates new with email
//  - Creates PaymentMethod from raw test card (test mode only)
//  - Attaches PM to customer, sets as default
//  - Pre-creates subscriptions_v2 + provider_subscriptions(pending) mirror
//  - Creates Subscription with default_incomplete + payment_behavior
//  - Confirms latest_invoice.payment_intent → Stripe charges → fails →
//    Stripe emits invoice.payment_failed + payment_intent.payment_failed
//
// Cleanup: caller must cancel the resulting subscription manually.
// Requires super-admin JWT.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';

interface ReqBody {
  user_id: string;
  product_id: string;
  tariff_id: string;
  tariff_offer_id: string;
  price_id: string;        // Stripe price_id (must match offer)
  account_code: string;
  customer_email: string;
  pm_token?: string;       // default pm_card_chargeDeclined
}

function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), {
    status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function stripe(secret: string, path: string, body?: Record<string, string>, method = 'POST') {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
  if (body) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) form.append(k, v);
    init.body = form.toString();
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, init);
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    await requireSuperAdmin(req);
    const body = (await req.json()) as ReqBody;
    const pm_token = body.pm_token ?? 'pm_card_chargeDeclined';

    const secret = await readAcquiringSecret('stripe', body.account_code, 'secret_key');

    // 1. Create customer
    const cust = await stripe(secret, 'customers', {
      email: body.customer_email,
      'metadata[user_id]': body.user_id,
      'metadata[stage]': 'stage25_g15_runtime',
    });
    if (!cust.ok) return json(500, { step: 'customer', error: cust.data });
    const customer_id = cust.data.id;

    // 2. Use predefined test PM token (raw card data is blocked by Stripe).
    //    pm_card_visa attaches OK; we'll pay invoice with pm_card_chargeDeclined directly.
    const attach_pm = 'pm_card_visa';
    const fail_pm = pm_token;

    // 3. Attach successful PM to customer (required to create subscription)
    const att = await stripe(secret, `payment_methods/${attach_pm}/attach`, {
      customer: customer_id,
    });
    if (!att.ok) return json(500, { step: 'pm_attach', error: att.data });
    const pm_id = attach_pm;

    // 4. Pre-create subscriptions_v2 + provider_subscriptions
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: subv2Row, error: subv2Err } = await admin
      .from('subscriptions_v2')
      .insert({
        user_id: body.user_id,
        product_id: body.product_id,
        tariff_id: body.tariff_id,
        status: 'pending',
        billing_type: 'provider_managed',
        meta: {
          stage: 'stage25_g15_runtime',
          stripe: {
            account_code: body.account_code,
            customer_id,
            price_id: body.price_id,
            tariff_offer_id: body.tariff_offer_id,
          },
        },
      })
      .select('id')
      .single();
    if (subv2Err) return json(500, { step: 'subv2_insert', error: subv2Err.message });
    const subv2_id = subv2Row.id as string;

    const { data: psRow, error: psErr } = await admin
      .from('provider_subscriptions')
      .insert({
        provider: 'stripe',
        provider_subscription_id: `pending:${subv2_id}`,
        user_id: body.user_id,
        subscription_v2_id: subv2_id,
        state: 'pending',
        meta: {
          stage: 'stage25_g15_runtime',
          stripe: { account_code: body.account_code, customer_id, price_id: body.price_id },
        },
      })
      .select('id')
      .single();
    if (psErr) return json(500, { step: 'ps_insert', error: psErr.message });

    // 5. Create Subscription with default_incomplete → Stripe finalizes invoice
    //    + creates PaymentIntent. Then we confirm PI → fails → invoice.payment_failed.
    const subResp = await stripe(secret, 'subscriptions', {
      customer: customer_id,
      'items[0][price]': body.price_id,
      default_payment_method: pm_id,
      payment_behavior: 'default_incomplete',
      'payment_settings[save_default_payment_method]': 'on_subscription',
      'expand[0]': 'latest_invoice.confirmation_secret',
      'expand[1]': 'latest_invoice',
      'metadata[subscription_v2_id]': subv2_id,
      'metadata[tracking_id]': `stripe_sub:pending:order:${subv2_id}`,
      'metadata[account_code]': body.account_code,
      'metadata[user_id]': body.user_id,
      'metadata[product_id]': body.product_id,
      'metadata[tariff_id]': body.tariff_id,
      'metadata[offer_id]': body.tariff_offer_id,
      'metadata[stage]': 'stage25_g15_runtime',
    });
    if (!subResp.ok) return json(500, { step: 'sub_create', error: subResp.data });
    const sub_id = subResp.data.id;
    const invoice = subResp.data.latest_invoice;
    const invoice_id = invoice?.id;

    // 6. Pay the invoice → triggers PaymentIntent confirm with the failing PM →
    //    Stripe emits invoice.payment_failed + payment_intent.payment_failed.
    const payResp = await stripe(secret, `invoices/${invoice_id}/pay`, {
      payment_method: fail_pm,
    });
    // Expected: 402 Payment Required (card_declined). Stripe still emits the events.

    return json(200, {
      ok: true,
      subscription_v2_id: subv2_id,
      provider_subscription_row_id: psRow.id,
      stripe: {
        customer_id,
        payment_method_id: pm_id,
        subscription_id: sub_id,
        invoice_id,
        pay_attempt: { ok: payResp.ok, status: payResp.status, error_code: payResp.data?.error?.code, decline_code: payResp.data?.error?.decline_code },
      },
      note: 'Stripe should now emit invoice.payment_failed + payment_intent.payment_failed within seconds.',
    });
  } catch (e) {
    return json(500, { error: String(e?.message ?? e), stack: String(e?.stack ?? '') });
  }
});
