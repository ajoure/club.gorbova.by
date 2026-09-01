/* eslint-disable @typescript-eslint/no-explicit-any -- provider payloads and generated Supabase rows are runtime-validated below */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createBepaidAuthHeader, getBepaidCredsStrict, isBepaidCredsError } from './bepaid-credentials.ts';
import { loadInstallmentRepaymentContext } from './installment-repayment-context.ts';
import { RepaymentPlanError } from './installment-repayment-plan.ts';

type PaymentLink = Record<string, any>;

function checkoutUrlFrom(link: PaymentLink): string | null {
  const repayment = link?.meta?.repayment;
  if (repayment?.checkout_state !== 'ready') return null;
  const url = String(repayment?.checkout_url || '');
  const issued = Date.parse(String(repayment?.checkout_created_at || ''));
  return /^https:\/\/checkout\.bepaid\.by\//.test(url) && Number.isFinite(issued) && Date.now() - issued < 15 * 60_000
    ? url
    : null;
}

function checkoutClaimState(link: PaymentLink): { state: string; attemptId: string | null } {
  const repayment = link?.meta?.repayment || {};
  const state = String(repayment.checkout_state || 'draft');
  const started = Date.parse(String(repayment.checkout_started_at || ''));
  if (state === 'creating' && Number.isFinite(started) && Date.now() - started < 2 * 60_000) {
    throw new RepaymentPlanError('repayment_checkout_in_progress');
  }
  if (!['draft', 'failed', 'ready', 'creating'].includes(state)) {
    throw new RepaymentPlanError('repayment_checkout_unavailable');
  }
  return { state, attemptId: repayment.checkout_attempt_id ? String(repayment.checkout_attempt_id) : null };
}

export async function createExistingInstallmentCheckout(input: {
  supabase: SupabaseClient;
  link: PaymentLink;
  origin: string;
}) {
  const { supabase, link, origin } = input;
  const repayment = (link?.meta?.repayment || {}) as Record<string, any>;
  const reusable = checkoutUrlFrom(link);
  if (reusable) return { success: true, redirect_url: reusable, reused: true };

  if (!link?.id || !link.user_id || repayment.contract_version !== 1 || repayment.preserves_purchase !== true
      || repayment.changes_access !== false || repayment.original_order_id == null
      || !['one_time', 'subscription'].includes(repayment.payment_type)) {
    throw new RepaymentPlanError('invalid_repayment_link');
  }
  const schedule = Array.isArray(repayment.schedule_minor) ? repayment.schedule_minor.map(Number) : [];
  if (!schedule.length || schedule.some(n => !Number.isSafeInteger(n) || n < 100)
      || schedule[0] !== Number(link.amount)) throw new RepaymentPlanError('invalid_repayment_schedule');
  if (repayment.payment_type === 'subscription'
      && (schedule.length < 2 || schedule.some(n => n !== schedule[0]))) {
    throw new RepaymentPlanError('autopay_requires_equal_remaining_payments');
  }

  const context = await loadInstallmentRepaymentContext(supabase, String(repayment.original_order_id));
  if (context.order.user_id !== link.user_id || context.sub.id !== repayment.subscription_v2_id
      || context.fingerprint !== repayment.fingerprint || context.balance.remainingMinor !== Number(repayment.remaining_minor)
      || schedule.reduce((sum, n) => sum + n, 0) !== context.balance.remainingMinor) {
    throw new RepaymentPlanError('repayment_quote_changed');
  }

  const attemptId = crypto.randomUUID();
  const expectedClaim = checkoutClaimState(link);
  const creatingMeta = {
    ...(link.meta || {}),
    repayment: { ...repayment, checkout_state: 'creating', checkout_attempt_id: attemptId, checkout_started_at: new Date().toISOString() },
  };
  let claimQuery = supabase.from('payment_links')
    .update({ meta: creatingMeta, updated_at: new Date().toISOString() })
    .eq('id', link.id)
    .eq('status', 'active')
    .eq('meta->repayment->>checkout_state', expectedClaim.state);
  if (expectedClaim.attemptId) {
    claimQuery = claimQuery.eq('meta->repayment->>checkout_attempt_id', expectedClaim.attemptId);
  }
  const { data: claimed, error: claimError } = await claimQuery.select('id').maybeSingle();
  if (claimError) throw new RepaymentPlanError('repayment_checkout_claim_failed');
  if (!claimed) {
    const { data: fresh } = await supabase.from('payment_links').select('meta').eq('id', link.id).maybeSingle();
    const ready = checkoutUrlFrom(fresh || {});
    if (ready) return { success: true, redirect_url: ready, reused: true };
    throw new RepaymentPlanError('repayment_checkout_in_progress');
  }

  const creds = await getBepaidCredsStrict(supabase);
  if (isBepaidCredsError(creds)) {
    await supabase.from('payment_links').update({ meta: { ...creatingMeta, repayment: { ...creatingMeta.repayment,
      checkout_state: 'failed', checkout_error: 'provider_credentials_unavailable' } } }).eq('id', link.id);
    throw new RepaymentPlanError('repayment_provider_unavailable');
  }
  const auth = createBepaidAuthHeader(creds);
  const { data: profile } = await supabase.from('profiles').select('id,email,full_name').eq('user_id', link.user_id).maybeSingle();
  if (!profile?.email) {
    await supabase.from('payment_links').update({ meta: { ...creatingMeta, repayment: { ...creatingMeta.repayment,
      checkout_state: 'failed', checkout_error: 'customer_missing' } } }).eq('id', link.id);
    throw new RepaymentPlanError('repayment_customer_missing');
  }
  const trackingId = `repayment:${link.id}:order:${context.order.id}`;
  const notificationUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/bepaid-webhook`;
  const successUrl = `${origin}/purchases?repayment=success&order=${context.order.id}`;
  const description = `Доплата по существующей рассрочке: ${(schedule[0] / 100).toFixed(2)} BYN`;
  let response: Response;
  let result: any;

  try {
    if (repayment.payment_type === 'subscription') {
      response = await fetch('https://api.bepaid.by/subscriptions', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json', RequestID: attemptId },
        body: JSON.stringify({
          notification_url: notificationUrl,
          return_url: successUrl,
          tracking_id: trackingId,
          additional_data: { repayment_link_id: link.id, original_order_id: context.order.id },
          customer: { email: profile.email, first_name: profile.full_name?.split(' ')[0] || undefined,
            last_name: profile.full_name?.split(' ').slice(1).join(' ') || undefined, ip: '127.0.0.1' },
          plan: {
            shop_id: Number(creds.shop_id), currency: 'BYN', title: 'Доплата по рассрочке', description,
            plan: { amount: schedule[0], interval: Number(repayment.interval_days), interval_unit: 'day' },
            infinite: false, billing_cycles: schedule.length, number_payment_attempts: 3,
          },
          settings: { language: 'ru' },
        }),
      });
      result = await response.json();
    } else {
      response = await fetch('https://checkout.bepaid.by/ctp/api/checkouts', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json', RequestID: attemptId },
        body: JSON.stringify({ checkout: {
          test: creds.test_mode, transaction_type: 'payment', attempts: 3,
          settings: { success_url: successUrl, decline_url: `${origin}/pay/${link.url_token}?status=decline`,
            fail_url: `${origin}/pay/${link.url_token}?status=fail`, notification_url: notificationUrl,
            language: 'ru', customer_fields: { read_only: ['email'] } },
          order: { amount: schedule[0], currency: 'BYN', description, tracking_id: trackingId,
            additional_data: { repayment_link_id: link.id, original_order_id: context.order.id } },
          customer: { email: profile.email, first_name: profile.full_name?.split(' ')[0] || undefined,
            last_name: profile.full_name?.split(' ').slice(1).join(' ') || undefined },
        } }),
      });
      result = await response.json();
    }
  } catch {
    await supabase.from('payment_links').update({ meta: { ...creatingMeta, repayment: { ...creatingMeta.repayment,
      checkout_state: 'failed', checkout_error: 'provider_transport_error' } } }).eq('id', link.id);
    throw new RepaymentPlanError('repayment_provider_transport_error');
  }

  const providerSubscriptionId = repayment.payment_type === 'subscription' ? String(result?.subscription?.id || result?.id || '') : null;
  const redirectUrl = repayment.payment_type === 'subscription'
    ? String(result?.subscription?.checkout_url || result?.subscription?.redirect_url || result?.checkout_url || result?.redirect_url || '')
    : String(result?.checkout?.redirect_url || '');
  const checkoutToken = repayment.payment_type === 'one_time' ? String(result?.checkout?.token || '') : null;
  if (!response.ok || !/^https:\/\/checkout\.bepaid\.by\//.test(redirectUrl)
      || (repayment.payment_type === 'subscription' && !providerSubscriptionId)) {
    await supabase.from('payment_links').update({ meta: { ...creatingMeta, repayment: { ...creatingMeta.repayment,
      checkout_state: 'failed', checkout_error: 'provider_rejected', provider_http_status: response.status } } }).eq('id', link.id);
    throw new RepaymentPlanError('repayment_provider_rejected');
  }

  if (providerSubscriptionId) {
    const oldProvider = context.liveProviders[0] || null;
    const providerMeta = {
      tracking_id: trackingId,
      checkout_url: redirectUrl,
      payment_method: 'internal_installment',
      installment: context.agreement,
      repayment: {
        contract_version: 1, payment_link_id: link.id, original_order_id: context.order.id,
        paid_cycles_before: context.balance.paidCount, remaining_minor_before: context.balance.remainingMinor,
        schedule_minor: schedule, changes_access: false,
        replaces_provider_subscription_id: oldProvider?.provider_subscription_id || null,
        replaces_provider_row_id: oldProvider?.id || null,
      },
    };
    const { error: providerInsertError } = await supabase.from('provider_subscriptions').insert({
      provider: 'bepaid', provider_subscription_id: providerSubscriptionId,
      subscription_v2_id: context.sub.id, order_id: context.order.id, user_id: context.order.user_id,
      profile_id: context.order.profile_id, state: 'redirecting', amount_cents: schedule[0], currency: 'BYN',
      interval_days: Number(repayment.interval_days), meta: providerMeta,
    });
    if (providerInsertError) {
      const cleanup = await fetch(`https://api.bepaid.by/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`, {
        method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ cancel_reason: 'Local repayment binding failed' }),
      }).catch(() => null);
      await supabase.from('payment_links').update({ meta: { ...creatingMeta, repayment: { ...creatingMeta.repayment,
        checkout_state: 'failed', checkout_error: 'provider_binding_failed', orphan_provider_subscription_id: providerSubscriptionId,
        provider_cleanup_http_status: cleanup?.status ?? null } } }).eq('id', link.id);
      await supabase.from('audit_logs').insert({ actor_type: 'system', actor_label: 'existing-installment-checkout',
        action: 'installment.repayment_provider_binding_failed', target_user_id: context.order.user_id,
        meta: { severity: 'CRITICAL', payment_link_id: link.id, order_id: context.order.id,
          provider_subscription_id: providerSubscriptionId, cleanup_http_status: cleanup?.status ?? null } });
      throw new RepaymentPlanError('repayment_provider_binding_failed');
    }
  }

  const readyMeta = { ...(link.meta || {}), repayment: { ...repayment, checkout_state: 'ready', checkout_attempt_id: attemptId,
    checkout_created_at: new Date().toISOString(), checkout_url: redirectUrl,
    provider_subscription_id: providerSubscriptionId, checkout_token: checkoutToken } };
  const { data: readyRow, error: readyError } = await supabase.from('payment_links').update({ meta: readyMeta }).eq('id', link.id)
    .filter('meta->repayment->>checkout_attempt_id', 'eq', attemptId).select('id').maybeSingle();
  if (readyError || !readyRow) {
    if (providerSubscriptionId) {
      await fetch(`https://api.bepaid.by/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`, {
        method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ cancel_reason: 'Repayment checkout state could not be persisted' }),
      }).catch(() => null);
      await supabase.from('provider_subscriptions').update({ state: 'canceled', next_charge_at: null })
        .eq('provider', 'bepaid').eq('provider_subscription_id', providerSubscriptionId);
    }
    await supabase.from('payment_links').update({ meta: { ...creatingMeta, repayment: { ...creatingMeta.repayment,
      checkout_state: 'failed', checkout_error: 'checkout_state_persist_failed',
      orphan_provider_subscription_id: providerSubscriptionId } } }).eq('id', link.id)
      .filter('meta->repayment->>checkout_attempt_id', 'eq', attemptId);
    throw new RepaymentPlanError('repayment_checkout_persist_failed');
  }
  await supabase.from('audit_logs').insert({ actor_type: 'system', actor_label: 'existing-installment-checkout',
    action: 'installment.repayment_checkout_created', target_user_id: context.order.user_id,
    meta: { payment_link_id: link.id, order_id: context.order.id, subscription_v2_id: context.sub.id,
      payment_type: repayment.payment_type, schedule_minor: schedule, new_orders: 0, new_subscriptions_v2: 0, changes_access: false } });
  return { success: true, redirect_url: redirectUrl, reused: false };
}
