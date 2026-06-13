// PATCH-STRIPE-TELEGRAM-ADMIN-NOTIFY-PARITY-V1
// Single shared helper to notify admins via Telegram about Stripe payment events.
// Reuses `_shared/admin-notify-message.ts` (same SOT as bePaid) and
// `telegram-notify-admins` edge function (single Telegram write-path).
//
// Idempotency strategy (no new tables required):
//   - Stripe-event-level dedup is already enforced by stripe-webhook via
//     `provider_events.idempotency_key = stripe:{account}:{event_id}` UNIQUE.
//     A repeated delivery of the same Stripe event NEVER reaches dispatch().
//   - Business-fact dedup across DIFFERENT Stripe event types for the same
//     payment / refund is the caller's responsibility:
//       • one-time payment: caller invokes this helper ONLY when a new row
//         was just inserted into payments_v2 (i.e. `existing` was null).
//       • subscription invoice: caller invokes ONLY when resolver did not
//         return `invoice_paid_duplicate`.
//       • refund: caller invokes ONLY on `charge.refunded` branch after
//         successful `record_refund_atomic_multi` RPC (RPC is idempotent by
//         refund_uid, so this gives one notification per refund_id).
//
// Payload safety: only the fields used by `buildAdminNotifyMessage` reach
// Telegram (client name, masked email, telegram username, product, tariff,
// amount/currency, next_charge_at, source label). NO PAN, NO Stripe customer
// object, NO raw webhook payload.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  buildAdminNotifyMessage,
  type OperationType,
} from './admin-notify-message.ts';

export type StripeAdminNotifyOp =
  | 'payment_succeeded'
  | 'subscription_renewal'
  | 'refund_succeeded';

export interface StripeAdminNotifyInput {
  op: StripeAdminNotifyOp;
  order_id: string;
  payment_id?: string | null;
  /** Stripe object identifier used for log breadcrumbs only (pi_*, re_*, in_*). */
  provider_object_id?: string | null;
  /** Already-major-units amount (e.g. 7.00). */
  amount?: number | string | null;
  currency?: string | null;
  /** ISO timestamp of next scheduled charge — only for renewals. */
  next_charge_at?: string | null;
}

const OP_TO_TEMPLATE: Record<StripeAdminNotifyOp, { type: OperationType; sourceLabel: string }> = {
  payment_succeeded: { type: 'payment', sourceLabel: 'Stripe (оплата)' },
  subscription_renewal: { type: 'subscription_renewal', sourceLabel: 'Stripe (подписка)' },
  refund_succeeded: { type: 'payment', sourceLabel: 'Stripe (возврат)' },
};

/**
 * Resolve order → user/profile → product/tariff with one round trip each.
 * All fetches are best-effort: missing data degrades the message, never throws.
 */
async function resolveContext(
  supabase: SupabaseClient,
  order_id: string,
): Promise<{
  client_name: string | null;
  email: string | null;
  telegram_username: string | null;
  product_name: string | null;
  tariff_name: string | null;
}> {
  const { data: order } = await supabase
    .from('orders_v2')
    .select('user_id, profile_id, product_id, tariff_id, customer_email')
    .eq('id', order_id)
    .maybeSingle();

  if (!order) {
    return {
      client_name: null,
      email: null,
      telegram_username: null,
      product_name: null,
      tariff_name: null,
    };
  }

  const [profileRes, productRes, tariffRes] = await Promise.all([
    order.user_id
      ? supabase
          .from('profiles')
          .select('full_name, email, telegram_username')
          .eq('user_id', order.user_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    order.product_id
      ? supabase.from('products').select('name').eq('id', order.product_id).maybeSingle()
      : Promise.resolve({ data: null }),
    order.tariff_id
      ? supabase.from('tariffs').select('name').eq('id', order.tariff_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const profile = (profileRes as { data: { full_name?: string | null; email?: string | null; telegram_username?: string | null } | null }).data;
  const product = (productRes as { data: { name?: string | null } | null }).data;
  const tariff = (tariffRes as { data: { name?: string | null } | null }).data;

  return {
    client_name: profile?.full_name ?? null,
    email: profile?.email ?? order.customer_email ?? null,
    telegram_username: profile?.telegram_username ?? null,
    product_name: product?.name ?? null,
    tariff_name: tariff?.name ?? null,
  };
}

/**
 * Fire-and-forget admin notification. Wrapped in EdgeRuntime.waitUntil when
 * available so the Stripe webhook handler returns 200 immediately while the
 * Telegram call completes in background. Any error is logged and swallowed —
 * Telegram failures NEVER affect the Stripe webhook lifecycle.
 */
export function notifyAdminPaymentEvent(
  supabase: SupabaseClient,
  input: StripeAdminNotifyInput,
): void {
  const work = (async () => {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!supabaseUrl || !serviceKey) {
        console.warn('[stripe-admin-notify] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — skip');
        return;
      }

      const ctx = await resolveContext(supabase, input.order_id);
      const tpl = OP_TO_TEMPLATE[input.op];

      const message = buildAdminNotifyMessage({
        operation_type: tpl.type,
        client_name: ctx.client_name,
        email: ctx.email,
        telegram_username: ctx.telegram_username,
        product_name: ctx.product_name,
        tariff_name: ctx.tariff_name,
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        next_charge_at: input.op === 'subscription_renewal' ? input.next_charge_at ?? null : null,
        source_label: input.op === 'refund_succeeded'
          ? `${tpl.sourceLabel} • возврат`
          : tpl.sourceLabel,
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/telegram-notify-admins`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            message,
            parse_mode: 'HTML',
            source: `stripe_webhook:${input.op}`,
            order_id: input.order_id,
            payment_id: input.payment_id ?? input.provider_object_id ?? undefined,
          }),
          signal: controller.signal,
        });
        if (!resp.ok) {
          console.warn(
            `[stripe-admin-notify] telegram-notify-admins HTTP ${resp.status} (op=${input.op}, order=${input.order_id})`,
          );
        } else {
          console.log(
            `[stripe-admin-notify] notified op=${input.op} order=${input.order_id} obj=${input.provider_object_id ?? '-'}`,
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      console.warn('[stripe-admin-notify] failed (non-fatal):', err instanceof Error ? err.message : String(err));
    }
  })();

  // Prefer EdgeRuntime.waitUntil so background work survives response.
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er?.waitUntil) {
    try {
      er.waitUntil(work);
      return;
    } catch { /* fallthrough */ }
  }
  // Fallback: detach explicitly so the event loop knows it's intentional.
  work.catch(() => { /* already logged */ });
}
