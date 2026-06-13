// PATCH-STRIPE-TELEGRAM-ADMIN-NOTIFY-PARITY-V2
// Single shared helper to notify admins via Telegram about Stripe payment events.
// Reuses `_shared/admin-notify-message.ts` (same SOT as bePaid) and
// `telegram-notify-admins` edge function (single Telegram write-path).
//
// === Dedup invariants (read before changing caller code) ===
//
// 1) Stripe-event-level dedup.
//    Enforced upstream by `provider_events.idempotency_key = stripe:{account}:{event_id}` UNIQUE.
//    A repeated delivery of the SAME Stripe event never reaches dispatch().
//
// 2) Cross-event business dedup for single-charge payments.
//    `payments_v2` has UNIQUE `(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL`
//    (indexes: uq_payments_v2_provider_payment / idx_payments_v2_provider_unique).
//    The caller MUST use atomic insert-winner (INSERT → catch 23505) and invoke this
//    helper ONLY when its own INSERT actually created the row (inserted=true).
//    Race between `checkout.session.completed` and `payment_intent.succeeded` carrying
//    the SAME `pi_*` is resolved at the database constraint; only one branch notifies.
//
// 3) Subscription invoice dedup.
//    Stripe billing_reason decision table (canon for stripe-webhook):
//      subscription_create  → NO notify (first charge already notified via PI/checkout)
//      subscription_cycle   → recurring notify (op='subscription_renewal')
//      subscription_update  → NO notify
//      manual               → NO notify (no proven business rule yet)
//      <null>/<unknown>     → NO notify + safe log
//    See resolveInvoiceNotifyDecision().
//
// 4) Refund dedup.
//    `record_refund_atomic_multi` returns { idempotent: boolean } per refund_uid.
//    Caller MUST iterate every refund in `charge.refunds.data`, call the RPC for
//    each `re_*`, and notify ONLY when the RPC returned `idempotent: false`.
//    `refund.created` / `refund.updated` MUST NOT notify (canonical event is
//    `charge.refunded`; these auxiliary events are still routed through the RPC
//    for ledger idempotency but are not a notify trigger).
//
// === Payload safety ===
// Only fields used by buildAdminNotifyMessage reach Telegram: client_name, masked
// email, telegram_username, product_name, tariff_name, amount, currency,
// next_charge_at, source_label. NO PAN, NO cvc/exp, NO Stripe customer object,
// NO payment_method, NO billing_details, NO client_secret, NO receipt_url,
// NO raw webhook payload, NO Authorization headers.

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

// ---------------------------------------------------------------------------
// Pure decision helpers (testable without Deno.serve or live HTTP).
// ---------------------------------------------------------------------------

export type InvoiceNotifyDecision =
  | { notify: false; reason: 'subscription_create' | 'subscription_update' | 'manual' | 'unknown' | 'duplicate_event' | 'manual_review' | 'missing_payment_id' }
  | { notify: true; reason: 'subscription_cycle' };

export interface InvoiceNotifyContext {
  billing_reason: string | null | undefined;
  manual_review?: boolean | null;
  payment_id?: string | null;
  resolver_note?: string | null;
}

/**
 * Decide whether `invoice.paid` should trigger an admin recurring notification.
 * Pure function — no I/O. Returns explicit reason for proof/audit logs.
 */
export function resolveInvoiceNotifyDecision(ctx: InvoiceNotifyContext): InvoiceNotifyDecision {
  if (ctx.manual_review) return { notify: false, reason: 'manual_review' };
  if (!ctx.payment_id) return { notify: false, reason: 'missing_payment_id' };
  if (ctx.resolver_note === 'invoice_paid_duplicate') return { notify: false, reason: 'duplicate_event' };
  const br = (ctx.billing_reason ?? '').toLowerCase();
  switch (br) {
    case 'subscription_cycle': return { notify: true, reason: 'subscription_cycle' };
    case 'subscription_create': return { notify: false, reason: 'subscription_create' };
    case 'subscription_update': return { notify: false, reason: 'subscription_update' };
    case 'manual': return { notify: false, reason: 'manual' };
    default: return { notify: false, reason: 'unknown' };
  }
}

export interface RefundRecord {
  id: string;
  amount: number;
  currency: string;
  reason?: string | null;
  created?: number | null;
}

/**
 * Stable ordering for refund processing: ascending by `created` (oldest first),
 * tie-break by id. Returns deduplicated list (by id).
 */
export function orderedRefundCandidates(refunds: ReadonlyArray<RefundRecord>): RefundRecord[] {
  const seen = new Set<string>();
  const out: RefundRecord[] = [];
  for (const r of refunds) {
    if (!r?.id || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  out.sort((a, b) => {
    const ca = typeof a.created === 'number' ? a.created : 0;
    const cb = typeof b.created === 'number' ? b.created : 0;
    if (ca !== cb) return ca - cb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

const OP_TO_TEMPLATE: Record<StripeAdminNotifyOp, { type: OperationType; sourceLabel: string }> = {
  payment_succeeded: { type: 'payment', sourceLabel: 'Stripe (оплата)' },
  subscription_renewal: { type: 'subscription_renewal', sourceLabel: 'Stripe (подписка)' },
  refund_succeeded: { type: 'payment', sourceLabel: 'Stripe (возврат)' },
};

// Internal forbidden-key allowlist used by payload safety self-check.
const FORBIDDEN_NOTIFY_KEYS = [
  'card', 'card_number', 'pan', 'cvc', 'cvv', 'exp_month', 'exp_year',
  'customer', 'payment_method', 'billing_details', 'client_secret',
  'receipt_url', 'raw_event', 'webhook_payload', 'authorization', 'secret',
];

/** Returns the list of forbidden keys present anywhere in `obj` (recursive). */
export function scanForbiddenKeys(obj: unknown, forbidden: readonly string[] = FORBIDDEN_NOTIFY_KEYS): string[] {
  const hits: string[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (forbidden.includes(k.toLowerCase())) hits.push(k);
      walk(val);
    }
  };
  walk(obj);
  return hits;
}

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
    return { client_name: null, email: null, telegram_username: null, product_name: null, tariff_name: null };
  }

  const [profileRes, productRes, tariffRes] = await Promise.all([
    order.user_id
      ? supabase.from('profiles').select('full_name, email, telegram_username').eq('user_id', order.user_id).maybeSingle()
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
        source_label: input.op === 'refund_succeeded' ? `${tpl.sourceLabel} • возврат` : tpl.sourceLabel,
      });

      const body = {
        message,
        parse_mode: 'HTML' as const,
        source: `stripe_webhook:${input.op}`,
        order_id: input.order_id,
        payment_id: input.payment_id ?? input.provider_object_id ?? undefined,
      };

      // Payload safety self-check (best-effort, never throws).
      try {
        const hits = scanForbiddenKeys(body);
        if (hits.length) {
          console.warn(`[stripe-admin-notify] forbidden keys detected: ${hits.join(',')} — aborting`);
          return;
        }
      } catch { /* ignore self-check failures */ }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/telegram-notify-admins`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!resp.ok) {
          console.warn(`[stripe-admin-notify] telegram-notify-admins HTTP ${resp.status} (op=${input.op}, order=${input.order_id})`);
        } else {
          console.log(`[stripe-admin-notify] notified op=${input.op} order=${input.order_id} obj=${input.provider_object_id ?? '-'}`);
        }
        // Consume body to avoid resource leak.
        try { await resp.text(); } catch { /* ignore */ }
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      console.warn('[stripe-admin-notify] failed (non-fatal):', err instanceof Error ? err.message : String(err));
    }
  })();

  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er?.waitUntil) {
    try { er.waitUntil(work); return; } catch { /* fallthrough */ }
  }
  work.catch(() => { /* already logged */ });
}
