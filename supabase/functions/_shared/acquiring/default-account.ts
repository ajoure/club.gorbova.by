// MP-A2-1 — SOT-резолвер дефолтного активного Stripe-подключения.
//
// Заменяет хардкод `account_code = 'stripe_poland'` во всех Stripe edge-функциях.
//
// Контракт:
//   - При наличии override (body.account_code) — возвращает указанное подключение.
//   - Иначе — выбирает первое (provider='stripe', is_default=true, status='active').
//   - Если подключение не найдено — throw `no_active_default_stripe_account`.
//
// add-only: bePaid не затрагивается.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface ResolvedStripeAccount {
  account_code: string;
  test_mode: boolean;
  success_url: string | null;
  cancel_url: string | null;
  status: string;
  source: 'override' | 'default_flag';
  connection_id: string;
}

export async function resolveDefaultStripeAccount(
  supabase: SupabaseClient,
  override_account_code?: string | null,
): Promise<ResolvedStripeAccount> {
  const code = override_account_code?.trim();
  if (code) {
    const { data, error } = await supabase
      .from('acquiring_connections')
      .select('id, account_code, test_mode, success_url, cancel_url, status')
      .eq('provider', 'stripe')
      .eq('account_code', code)
      .maybeSingle();
    if (error) throw new Error(`stripe_account_lookup_failed:${error.message}`);
    if (!data) throw new Error(`stripe_account_not_found:${code}`);
    if (data.status !== 'active') throw new Error(`stripe_account_not_active:${code}:${data.status}`);
    return {
      account_code: data.account_code,
      test_mode: !!data.test_mode,
      success_url: data.success_url ?? null,
      cancel_url: data.cancel_url ?? null,
      status: data.status,
      source: 'override',
      connection_id: data.id,
    };
  }

  const { data, error } = await supabase
    .from('acquiring_connections')
    .select('id, account_code, test_mode, success_url, cancel_url, status')
    .eq('provider', 'stripe')
    .eq('is_default', true)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`stripe_account_default_lookup_failed:${error.message}`);
  if (!data) throw new Error('no_active_default_stripe_account');

  return {
    account_code: data.account_code,
    test_mode: !!data.test_mode,
    success_url: data.success_url ?? null,
    cancel_url: data.cancel_url ?? null,
    status: data.status,
    source: 'default_flag',
    connection_id: data.id,
  };
}
