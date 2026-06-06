// Phase 3.3 — Stripe Customer Portal Session (self-service)
//
// Жёсткие правила:
//   - Only provider='stripe'. bePaid → not_supported.
//   - Доступ — только владелец подписки (subscriptions_v2.user_id = auth.uid()
//     И profiles.id = auth.uid()).
//   - НЕ создаёт и НЕ меняет Billing Portal Configuration. Конфиг настраивается
//     отдельным admin-инструментом вне пути пользователя (см. план Phase 3.3 C).
//   - НЕ трогает доступы, entitlements, access_rules, Telegram, lifecycle,
//     bePaid, grant-access-for-order.
//   - Никаких сырых данных карты во входе/выходе (PCI guard, как в 3.2).
//   - HTTP 200 + audit при любых stop-gate (manual_review для админа), 4xx
//     только для технических ошибок (auth/validation/Stripe API).
//
// Audit actions:
//   stripe.portal.session_created
//   stripe.portal.session_blocked_<reason>
//   stripe.portal.session_failed
//
// Реальное открытие Portal'а пользователем мы НЕ можем достоверно подтвердить
// (Stripe не шлёт event "portal opened"); поэтому отдельного аудита
// `session_opened` НЕТ — фиксируется в discovery. Подтверждение через
// return-flow или последующие webhook'и payment_method/cancel update.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';
import { stripeFetch } from '../_shared/acquiring/stripe-client.ts';

interface ReqBody {
  subscription_v2_id?: string;
  return_url?: string;
}

const PCI_FORBIDDEN_KEYS = new Set([
  'card', 'number', 'card_number', 'cvc', 'cvv',
  'exp_month', 'exp_year', 'expiry', 'expiration',
  'payment_method_data', 'pan',
]);
function pciScan(value: unknown, path = ''): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = pciScan(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PCI_FORBIDDEN_KEYS.has(k.toLowerCase())) return `${path}.${k}`;
      const hit = pciScan(v, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

function uuidLike(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function svc() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function writeAudit(
  supabase: ReturnType<typeof createClient>,
  params: {
    action: string;
    actor_user_id: string | null;
    actor_label: string | null;
    subscription_v2_id: string | null;
    extra: Record<string, unknown>;
  },
): Promise<void> {
  await supabase.from('audit_logs').insert({
    action: params.action,
    actor_type: 'user',
    actor_user_id: params.actor_user_id,
    actor_label: params.actor_label,
    entity_type: 'subscriptions_v2',
    entity_id: params.subscription_v2_id,
    meta: {
      source: 'customer_portal',
      subscription_v2_id: params.subscription_v2_id,
      ...params.extra,
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  // PCI guard на сыром payload
  const pciHit = pciScan(raw);
  if (pciHit) {
    return json({ error: 'pci_violation', detail: `forbidden_card_field_in_payload:${pciHit}` }, 400);
  }

  const body = raw as ReqBody;
  if (!uuidLike(body.subscription_v2_id)) {
    return json({ error: 'invalid_subscription_v2_id' }, 400);
  }
  const subscription_v2_id = body.subscription_v2_id as string;

  // Auth: JWT обязателен
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized', detail: 'no_token' }, 401);
  const supabase = svc();
  const token = authHeader.replace('Bearer ', '');
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: 'unauthorized', detail: 'invalid_token' }, 401);
  const auth_uid = userData.user.id;
  const auth_email = userData.user.email ?? null;

  // Ownership: profiles.id = auth.uid() (исключаем устаревшие связки)
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('id, meta')
    .eq('id', auth_uid)
    .maybeSingle();
  if (profErr) return json({ error: 'db_error', detail: profErr.message }, 500);
  if (!profile) {
    await writeAudit(supabase, {
      action: 'stripe.portal.session_blocked_profile_missing',
      actor_user_id: auth_uid, actor_label: auth_email,
      subscription_v2_id, extra: {},
    });
    return json({ error: 'forbidden', detail: 'profile_missing' }, 403);
  }

  // Load subscription
  const { data: subv2, error: subErr } = await supabase
    .from('subscriptions_v2')
    .select('id, user_id, status, meta')
    .eq('id', subscription_v2_id)
    .maybeSingle();
  if (subErr) return json({ error: 'db_error', detail: subErr.message }, 500);
  if (!subv2) return json({ error: 'subscription_not_found' }, 404);

  if (subv2.user_id !== auth_uid) {
    await writeAudit(supabase, {
      action: 'stripe.portal.session_blocked_not_owner',
      actor_user_id: auth_uid, actor_label: auth_email,
      subscription_v2_id, extra: { owner_user_id: subv2.user_id },
    });
    return json({ error: 'forbidden', detail: 'not_subscription_owner' }, 403);
  }

  // provider linkage
  const { data: provRows, error: provErr } = await supabase
    .from('provider_subscriptions')
    .select('id, provider, provider_subscription_id, meta')
    .eq('subscription_v2_id', subv2.id);
  if (provErr) return json({ error: 'db_error', detail: provErr.message }, 500);
  const stripeRow = (provRows ?? []).find((r: any) => r.provider === 'stripe') as any | undefined;
  if (!stripeRow) {
    await writeAudit(supabase, {
      action: 'stripe.portal.session_blocked_provider_not_stripe',
      actor_user_id: auth_uid, actor_label: auth_email,
      subscription_v2_id, extra: { providers: (provRows ?? []).map((r: any) => r.provider) },
    });
    return json({ error: 'provider_not_stripe' }, 400);
  }
  const stripe_subscription_id = stripeRow.provider_subscription_id as string | null;
  if (!stripe_subscription_id || !stripe_subscription_id.startsWith('sub_')) {
    await writeAudit(supabase, {
      action: 'stripe.portal.session_blocked_subscription_id_missing',
      actor_user_id: auth_uid, actor_label: auth_email,
      subscription_v2_id, extra: { provider_subscription_id: stripe_subscription_id },
    });
    return json({ error: 'stripe_subscription_id_missing' }, 400);
  }

  // account_code: SOT = subv2.meta.stripe.account_code, fallback на provider_subscriptions.meta
  const subMetaStripe = ((subv2.meta as any)?.stripe ?? {}) as Record<string, unknown>;
  const psMetaStripe = ((stripeRow.meta as any)?.stripe ?? {}) as Record<string, unknown>;
  const account_code = (subMetaStripe.account_code
    ?? psMetaStripe.account_code
    ?? (stripeRow.meta as any)?.account_code
    ?? null) as string | null;
  if (!account_code) {
    await writeAudit(supabase, {
      action: 'stripe.portal.session_blocked_account_code_missing',
      actor_user_id: auth_uid, actor_label: auth_email,
      subscription_v2_id, extra: {},
    });
    return json({ error: 'account_code_missing' }, 400);
  }

  // customer_id: profiles.meta.stripe.customers[account_code].customer_id → subv2.meta.stripe.customer_id → ps.meta.stripe.customer_id
  const profStripe = ((profile.meta as any)?.stripe ?? {}) as Record<string, unknown>;
  const profCustomers = ((profStripe.customers as any) ?? {}) as Record<string, any>;
  const stripe_customer_id = (
    profCustomers[account_code]?.customer_id
    ?? subMetaStripe.customer_id
    ?? psMetaStripe.customer_id
    ?? null
  ) as string | null;
  if (!stripe_customer_id || !stripe_customer_id.startsWith('cus_')) {
    await writeAudit(supabase, {
      action: 'stripe.portal.session_blocked_customer_id_missing',
      actor_user_id: auth_uid, actor_label: auth_email,
      subscription_v2_id, extra: { account_code, stripe_subscription_id },
    });
    return json({ error: 'customer_id_missing' }, 400);
  }

  // return_url: client-supplied или строим от req origin
  const origin = req.headers.get('origin') ?? req.headers.get('referer') ?? '';
  let baseOrigin = '';
  try { baseOrigin = origin ? new URL(origin).origin : ''; } catch { baseOrigin = ''; }
  const defaultReturn = `${baseOrigin || ''}/purchases?sub=${encodeURIComponent(subscription_v2_id)}`;
  let return_url = (body.return_url && /^https?:\/\//.test(body.return_url)) ? body.return_url : defaultReturn;
  if (!return_url) return_url = 'https://gorbova.by/purchases';

  // Stripe secret
  let secret: string;
  try {
    secret = await readAcquiringSecret('stripe', account_code, 'secret_key');
  } catch (e) {
    await writeAudit(supabase, {
      action: 'stripe.portal.session_blocked_secret_unavailable',
      actor_user_id: auth_uid, actor_label: auth_email,
      subscription_v2_id, extra: { account_code, error: (e as Error).message },
    });
    return json({ error: 'manual_review', detail: 'stripe_secret_unavailable' }, 200);
  }

  // POST /v1/billing_portal/sessions
  const stripeRes = await stripeFetch<{ id: string; url: string; configuration: string | null }>(
    `/billing_portal/sessions`,
    {
      secret_key: secret,
      method: 'POST',
      formBody: [
        ['customer', stripe_customer_id],
        ['return_url', return_url],
      ],
    },
  );

  if (!stripeRes.ok) {
    await writeAudit(supabase, {
      action: 'stripe.portal.session_failed',
      actor_user_id: auth_uid, actor_label: auth_email,
      subscription_v2_id,
      extra: {
        account_code, stripe_customer_id, stripe_subscription_id,
        stripe_status: stripeRes.status, stripe_error: stripeRes.error,
      },
    });
    // configuration_invalid → manual_review для админа
    const code = stripeRes.error?.code ?? '';
    if (code.includes('configuration')) {
      return json({ error: 'portal_configuration_mismatch', detail: stripeRes.error }, 502);
    }
    return json({ error: 'stripe_api_error', status: stripeRes.status, detail: stripeRes.error }, 502);
  }

  const portal_url = stripeRes.data?.url ?? null;
  const portal_session_id = stripeRes.data?.id ?? null;
  const portal_configuration_id = stripeRes.data?.configuration ?? null;

  await writeAudit(supabase, {
    action: 'stripe.portal.session_created',
    actor_user_id: auth_uid, actor_label: auth_email,
    subscription_v2_id,
    extra: {
      account_code,
      stripe_customer_id,
      stripe_subscription_id,
      portal_session_id,
      portal_configuration_id,
      return_url,
      result: 'ok',
    },
  });

  return json({ url: portal_url });
});
