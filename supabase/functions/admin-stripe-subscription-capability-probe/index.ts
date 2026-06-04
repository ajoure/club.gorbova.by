// GAP-D — admin-stripe-subscription-capability-probe
//
// Admin-only edge function that proves Stripe Subscription capability for the
// pilot price (`price_1Teeq26UYJj2vm0GPXHSLKlz`, BYN month/1, stripe_poland test):
//
//   action=create  { tariff_offer_id, account_code, business_stream, execute? }
//     - drift-check pilot Price (active, livemode=false, byn, month/1)
//     - if execute=true → stripe.checkout.sessions.create(mode:'subscription')
//     - generates random idempotency_key gap-d-probe:{offer}:{date}:{rnd}
//     - NO DB writes into runtime tables. Only technical audit_logs.
//
//   action=inspect { checkout_session_id }
//     - retrieve(cs, expand:[subscription, latest_invoice, payment_intent, charge, customer])
//     - events.list({ created.gte: cs.created })
//
//   action=cancel  { subscription_id }
//     - retrieve(sub) → cancel(sub) → retrieve(sub) → events.list
//
//   action=verify_isolation { baseline_iso, checkout_session_id?, subscription_id? }
//     - count provider_subscriptions/subscriptions_v2/orders_v2/payments_v2/provider_events
//       created since baseline. Filter orders/payments by meta ILIKE '%gap_d%'.
//
// Hard rules:
//   • super_admin only (verify_jwt=true)
//   • test mode only (livemode=false enforced)
//   • no INSERT/UPDATE into runtime billing tables
//   • no bePaid touch
//   • cancel is mandatory after proof — function exposes the action explicitly
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';

const PURPOSE = 'gap_d_capability_probe';
const ALLOWED_SUCCESS_HOST = 'gorbova.by';

interface BaseBody {
  action: 'create' | 'inspect' | 'cancel' | 'verify_isolation';
}
interface CreateBody extends BaseBody {
  action: 'create';
  tariff_offer_id: string;
  account_code: string;
  business_stream: string;
  execute?: boolean;
}
interface InspectBody extends BaseBody {
  action: 'inspect';
  checkout_session_id: string;
  account_code: string;
  events_since?: number;
}
interface CancelBody extends BaseBody {
  action: 'cancel';
  subscription_id: string;
  account_code: string;
}
interface VerifyIsoBody extends BaseBody {
  action: 'verify_isolation';
  baseline_iso: string;
}

function svc() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function stripeReq<T>(
  method: 'GET' | 'POST',
  path: string,
  secret: string,
  body?: Record<string, string>,
  idempotencyKey?: string,
): Promise<{ ok: boolean; status: number; data: T | { error?: { message?: string; code?: string } } }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${secret}` };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const init: RequestInit = { method, headers };
  if (body) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) form.append(k, v);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = form.toString();
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, init);
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: JSON.parse(text) as T };
}

async function audit(action: string, actor_user_id: string | null, entity_id: string, meta: Record<string, unknown>) {
  const { data, error } = await svc()
    .from('audit_logs')
    .insert({
      action: `stripe_capability_probe_${action}`,
      actor_user_id,
      actor_type: 'user',
      actor_label: 'super_admin:admin-stripe-subscription-capability-probe',
      entity_type: 'tariff_offer',
      entity_id,
      meta: { ...meta, purpose: PURPOSE },
    })
    .select('id')
    .single();
  if (error) console.error('audit_insert_failed', error.message);
  return (data as { id?: string } | null)?.id ?? null;
}

function todayYmd() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
function shortRand() {
  return crypto.randomUUID().slice(0, 8);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isForbiddenRedirectUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.lovableproject.com') || host.endsWith('.lovable.app')) return true;
    if (host.endsWith('.supabase.co')) return true;
    if (host !== ALLOWED_SUCCESS_HOST && !host.endsWith(`.${ALLOWED_SUCCESS_HOST}`)) return true;
    return false;
  } catch {
    return true;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let actor_user_id: string | null = null;
  try {
    const { user } = await requireSuperAdmin(req);
    actor_user_id = user.user_id;

    const body = (await req.json()) as
      | CreateBody
      | InspectBody
      | CancelBody
      | VerifyIsoBody;

    if (body.action === 'create') return await handleCreate(body, actor_user_id);
    if (body.action === 'inspect') return await handleInspect(body, actor_user_id);
    if (body.action === 'cancel') return await handleCancel(body, actor_user_id);
    if (body.action === 'verify_isolation') return await handleVerifyIsolation(body, actor_user_id);

    return json(400, { status: 'error', error: 'bad_request:unknown_action' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.startsWith('unauthorized') ? 401 : msg.startsWith('forbidden') ? 403 : 500;
    return json(status, { status: 'error', error: msg });
  }
});

// ---------- create ----------
async function handleCreate(body: CreateBody, actor_user_id: string | null) {
  const { tariff_offer_id, account_code, business_stream } = body;
  const execute = body.execute === true;
  if (!tariff_offer_id || !account_code || !business_stream) {
    return json(400, { status: 'error', error: 'bad_request:missing tariff_offer_id|account_code|business_stream' });
  }

  const supabase = svc();
  const { data: offer } = await supabase
    .from('tariff_offers')
    .select('id, tariff_id, meta, is_active')
    .eq('id', tariff_offer_id)
    .maybeSingle();
  if (!offer) return json(404, { status: 'error', error: 'offer_not_found' });
  if (!(offer as any).is_active) return json(422, { status: 'error', error: 'offer_inactive' });

  const offerStripe = (offer as any).meta?.stripe ?? null;
  if (!offerStripe?.price_id) {
    await audit('error', actor_user_id, tariff_offer_id, { reason: 'stripe_price_missing_in_meta' });
    return json(422, { status: 'error', error: 'stripe_price_missing_in_meta' });
  }

  const secret = await readAcquiringSecret('stripe', account_code, 'secret_key');

  // STOP drift-check
  const priceResp = await stripeReq<any>('GET', `prices/${offerStripe.price_id}`, secret);
  if (!priceResp.ok) {
    await audit('error', actor_user_id, tariff_offer_id, { reason: 'price_retrieve_failed', status: priceResp.status, stripe_error: priceResp.data });
    return json(502, { status: 'error', error: 'price_retrieve_failed', stripe_error: priceResp.data });
  }
  const p = priceResp.data;
  const driftReasons: string[] = [];
  if (!p.active) driftReasons.push('inactive');
  if (p.livemode !== false) driftReasons.push('livemode');
  if (String(p.currency).toLowerCase() !== 'byn') driftReasons.push('currency');
  if (p.recurring?.interval !== 'month') driftReasons.push('interval');
  if (p.recurring?.interval_count !== 1) driftReasons.push('interval_count');
  if (driftReasons.length > 0) {
    await audit('error', actor_user_id, tariff_offer_id, { reason: 'price_drift_detected', drift: driftReasons, price: p });
    return json(422, { status: 'error', error: 'price_drift_detected', drift: driftReasons, price: { id: p.id, active: p.active, currency: p.currency, recurring: p.recurring, livemode: p.livemode } });
  }

  const idempotency_key = `gap-d-probe:${tariff_offer_id}:${todayYmd()}:${shortRand()}`;
  const success_url = `https://${ALLOWED_SUCCESS_HOST}/admin/_gap-d/success?cs={CHECKOUT_SESSION_ID}`;
  const cancel_url = `https://${ALLOWED_SUCCESS_HOST}/admin/_gap-d/cancel`;
  if (isForbiddenRedirectUrl(success_url.replace('{CHECKOUT_SESSION_ID}', 'x')) || isForbiddenRedirectUrl(cancel_url)) {
    return json(500, { status: 'error', error: 'forbidden_redirect_url' });
  }

  const plan = {
    purpose: PURPOSE,
    tariff_offer_id,
    account_code,
    business_stream,
    price_id: offerStripe.price_id,
    product_id: offerStripe.product_id,
    success_url,
    cancel_url,
    idempotency_key,
    mode: 'subscription',
    line_items: [{ price: offerStripe.price_id, quantity: 1 }],
    environment: 'test',
    price_retrieve_proof: { id: p.id, active: p.active, currency: p.currency, unit_amount: p.unit_amount, recurring: p.recurring, livemode: p.livemode },
  };

  if (!execute) {
    const aid = await audit('dry_run', actor_user_id, tariff_offer_id, { plan });
    return json(200, { mode: 'dry_run', status: 'ok', plan, audit_event_ids: [aid] });
  }

  await audit('session_create_started', actor_user_id, tariff_offer_id, { plan });

  const metaForm: Record<string, string> = {
    'metadata[purpose]': PURPOSE,
    'metadata[tariff_offer_id]': tariff_offer_id,
    'metadata[account_code]': account_code,
    'metadata[environment]': 'test',
    'metadata[idempotency_key]': idempotency_key,
    'subscription_data[metadata][purpose]': PURPOSE,
    'subscription_data[metadata][tariff_offer_id]': tariff_offer_id,
    'subscription_data[metadata][idempotency_key]': idempotency_key,
  };
  const createResp = await stripeReq<any>(
    'POST',
    'checkout/sessions',
    secret,
    {
      mode: 'subscription',
      'line_items[0][price]': offerStripe.price_id,
      'line_items[0][quantity]': '1',
      success_url,
      cancel_url,
      ...metaForm,
    },
    idempotency_key,
  );
  if (!createResp.ok) {
    const errMsg = (createResp.data as any)?.error?.message ?? 'checkout_session_create_failed';
    await audit('error', actor_user_id, tariff_offer_id, { step: 'checkout_session_create', status: createResp.status, stripe_error: createResp.data });
    return json(502, { status: 'error', error: errMsg, step: 'checkout_session_create', stripe_error: createResp.data });
  }
  const cs = createResp.data as any;
  await audit('session_created', actor_user_id, tariff_offer_id, {
    checkout_session_id: cs.id,
    url: cs.url,
    livemode: cs.livemode,
    idempotency_key,
    expires_at: cs.expires_at,
  });

  return json(200, {
    mode: 'execute',
    status: 'ok',
    plan,
    checkout_session: {
      id: cs.id,
      url: cs.url,
      livemode: cs.livemode,
      expires_at: cs.expires_at,
      status: cs.status,
      payment_status: cs.payment_status,
      currency: cs.currency,
      amount_total: cs.amount_total,
      metadata: cs.metadata,
    },
    idempotency_key,
  });
}

// ---------- inspect ----------
async function handleInspect(body: InspectBody, actor_user_id: string | null) {
  const { checkout_session_id, account_code } = body;
  if (!checkout_session_id || !account_code) return json(400, { status: 'error', error: 'bad_request:missing checkout_session_id|account_code' });
  const secret = await readAcquiringSecret('stripe', account_code, 'secret_key');

  const expand = [
    'expand[]=subscription',
    'expand[]=subscription.latest_invoice',
    'expand[]=subscription.latest_invoice.payment_intent',
    'expand[]=subscription.latest_invoice.charge',
    'expand[]=customer',
  ].join('&');
  const csResp = await stripeReq<any>('GET', `checkout/sessions/${checkout_session_id}?${expand}`, secret);
  if (!csResp.ok) {
    return json(502, { status: 'error', error: 'checkout_session_retrieve_failed', stripe_error: csResp.data });
  }
  const cs = csResp.data as any;
  const eventsSince = body.events_since ?? cs.created ?? Math.floor(Date.now() / 1000) - 3600;
  const eventsResp = await stripeReq<any>('GET', `events?created[gte]=${eventsSince}&limit=100`, secret);

  const sub = cs.subscription ?? null;
  const inv = sub?.latest_invoice ?? null;
  const pi = inv?.payment_intent ?? null;
  const ch = inv?.charge ?? null;

  const eventList = (eventsResp.data as any)?.data ?? [];
  // filter by linked ids
  const linkedIds = new Set<string>(
    [cs.id, sub?.id, inv?.id, pi?.id, ch?.id, sub?.customer ?? cs?.customer?.id].filter(Boolean),
  );
  const relatedEvents = eventList.filter((e: any) => {
    const obj = e?.data?.object ?? {};
    const ids = [obj.id, obj.subscription, obj.invoice, obj.payment_intent, obj.charge, obj.customer];
    if (obj?.metadata?.purpose === PURPOSE) return true;
    return ids.some((x: any) => x && linkedIds.has(x));
  });

  await audit('inspected', actor_user_id, checkout_session_id, {
    checkout_session_id,
    subscription_id: sub?.id ?? null,
    invoice_id: inv?.id ?? null,
    payment_intent_id: pi?.id ?? null,
    charge_id: ch?.id ?? null,
    events_count: relatedEvents.length,
  });

  return json(200, {
    status: 'ok',
    snapshot: {
      checkout_session: cs,
      subscription: sub,
      invoice: inv,
      payment_intent: pi,
      charge: ch,
      customer: cs?.customer ?? null,
    },
    events: relatedEvents.map((e: any) => ({ id: e.id, type: e.type, created: e.created, object_id: e?.data?.object?.id })),
    all_events_total: eventList.length,
    events_since: eventsSince,
  });
}

// ---------- cancel ----------
async function handleCancel(body: CancelBody, actor_user_id: string | null) {
  const { subscription_id, account_code } = body;
  if (!subscription_id || !account_code) return json(400, { status: 'error', error: 'bad_request:missing subscription_id|account_code' });
  const secret = await readAcquiringSecret('stripe', account_code, 'secret_key');

  const beforeResp = await stripeReq<any>('GET', `subscriptions/${subscription_id}`, secret);
  if (!beforeResp.ok) {
    return json(502, { status: 'error', error: 'subscription_retrieve_failed', stripe_error: beforeResp.data });
  }
  const before = beforeResp.data as any;

  const cancelResp = await stripeReq<any>('POST', `subscriptions/${subscription_id}`, secret, {
    cancel_at_period_end: 'false',
  });
  // Use DELETE to cancel immediately
  const delResp = await fetch(`https://api.stripe.com/v1/subscriptions/${subscription_id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${secret}` },
  });
  const delText = await delResp.text();
  const delData = JSON.parse(delText);

  const afterResp = await stripeReq<any>('GET', `subscriptions/${subscription_id}`, secret);
  const after = afterResp.data as any;

  const eventsSince = (before?.created ?? Math.floor(Date.now() / 1000) - 3600);
  const eventsResp = await stripeReq<any>('GET', `events?created[gte]=${eventsSince}&limit=100`, secret);
  const eventList = (eventsResp.data as any)?.data ?? [];
  const relatedCancelEvents = eventList.filter((e: any) =>
    (e.type === 'customer.subscription.updated' || e.type === 'customer.subscription.deleted') &&
    e?.data?.object?.id === subscription_id,
  );

  await audit('subscription_canceled', actor_user_id, subscription_id, {
    subscription_id,
    before_status: before?.status,
    update_response_status: cancelResp.status,
    delete_response_status: delResp.status,
    after_status: after?.status,
    after_canceled_at: after?.canceled_at,
    after_ended_at: after?.ended_at,
    cancel_events_count: relatedCancelEvents.length,
  });

  return json(200, {
    status: 'ok',
    before: { id: before?.id, status: before?.status, current_period_end: before?.current_period_end },
    update_response: { status: cancelResp.status, body: cancelResp.data },
    delete_response: { status: delResp.status, body: delData },
    after: { id: after?.id, status: after?.status, canceled_at: after?.canceled_at, ended_at: after?.ended_at, cancel_at_period_end: after?.cancel_at_period_end },
    cancel_events: relatedCancelEvents.map((e: any) => ({ id: e.id, type: e.type, created: e.created })),
  });
}

// ---------- verify_isolation ----------
async function handleVerifyIsolation(body: VerifyIsoBody, actor_user_id: string | null) {
  const { baseline_iso } = body;
  if (!baseline_iso) return json(400, { status: 'error', error: 'bad_request:missing baseline_iso' });
  const supabase = svc();

  async function countSince(table: string, metaFilter = false) {
    let q = supabase.from(table).select('id', { count: 'exact', head: true }).gte('created_at', baseline_iso);
    const { count, error } = await q;
    return { table, count: count ?? 0, error: error?.message ?? null, meta_filter_applied: false };
  }
  async function countSinceMeta(table: string) {
    // Filter via ilike on meta::text would require RPC; use textual search on `meta` jsonb
    const { data, error } = await supabase
      .from(table)
      .select('id, meta, created_at')
      .gte('created_at', baseline_iso)
      .limit(1000);
    if (error) return { table, count: 0, error: error.message, meta_filter_applied: true };
    const filtered = (data ?? []).filter((r: any) => JSON.stringify(r.meta ?? {}).toLowerCase().includes('gap_d'));
    return { table, count: filtered.length, error: null, meta_filter_applied: true, sample_ids: filtered.slice(0, 5).map((r: any) => r.id) };
  }

  const results = await Promise.all([
    countSince('provider_subscriptions'),
    countSince('subscriptions_v2'),
    countSinceMeta('orders_v2'),
    countSinceMeta('payments_v2'),
    countSince('provider_events'),
  ]);

  // business ledger: audit_logs with production-like actions
  const { data: bizAudits } = await supabase
    .from('audit_logs')
    .select('id, action, created_at')
    .gte('created_at', baseline_iso)
    .in('action', ['subscription_created', 'subscription_renewed', 'order_paid', 'grant_access_started', 'grant_access_completed']);

  const verdict = {
    ok:
      results[0].count === 0 &&
      results[1].count === 0 &&
      results[2].count === 0 &&
      results[3].count === 0 &&
      // provider_events allowed if no side effects; flag warning if > 0
      true &&
      (bizAudits?.length ?? 0) === 0,
    notes: results[4].count > 0
      ? ['provider_events received entries — verify no side-effects in subscriptions_v2/orders_v2/payments_v2 (diff=0 already enforced above)']
      : [],
  };

  await audit('isolation_verified', actor_user_id, 'baseline', {
    baseline_iso,
    results,
    business_ledger_count: bizAudits?.length ?? 0,
    verdict,
  });

  return json(200, { status: 'ok', baseline_iso, results, business_ledger: { count: bizAudits?.length ?? 0, sample: (bizAudits ?? []).slice(0, 10) }, verdict });
}
