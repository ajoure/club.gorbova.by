// PATCH-RB1: Live deps adapter for runRebillFlow.
//
// Builds a RebillFlowDeps implementation backed by the real Supabase client.
// All queries are scoped/strict; helper functions encapsulate schema details so
// that the engine stays pure and offline-testable.
//
// Tables used:
//   - orders_v2           (REBILL-order lookup/insert; meta merge)
//   - payments_v2         (main-payment lookup/repoint/insert)
//   - subscriptions_v2    (SBS mismatch pre-check)
//   - audit_logs          (canonical audit trail)
//
// SBS mismatch pre-check:
//   foreign sbs = subscriptions_v2 row with same (user_id, product_id, tariff_id),
//   status='active', auto_renew=true, where meta->>bepaid_subscription_id is
//   non-null AND != incomingSbs. Returns first hit as foreignSbs/candidateSubId.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { RebillFlowDeps } from './rebill_flow.ts';

const GRANT_FN_PATH = '/functions/v1/grant-access-for-order';

export function buildRebillDepsAdapter(supabase: SupabaseClient): RebillFlowDeps {
  return {
    findRebillOrderByOrderNumber: async (orderNumber) => {
      const { data, error } = await supabase
        .from('orders_v2')
        .select('id, order_number, meta')
        .eq('order_number', orderNumber)
        .maybeSingle();
      if (error) {
        console.error('[rebill-deps] findRebillOrderByOrderNumber error:', error.message);
        return null;
      }
      if (!data) return null;
      return { id: String(data.id), order_number: String(data.order_number), meta: (data.meta || {}) as Record<string, unknown> };
    },

    findMainPaymentByUid: async (uid) => {
      // payments_v2 has no explicit transaction_type column — refunds are
      // distinguished by amount<0 or status='refunded'. The engine wants the
      // "main" (Платеж) payment, so we filter those out.
      const { data, error } = await supabase
        .from('payments_v2')
        .select('id, order_id, amount, status')
        .eq('provider', 'bepaid')
        .eq('provider_payment_id', uid)
        .order('created_at', { ascending: true });
      if (error) {
        console.error('[rebill-deps] findMainPaymentByUid error:', error.message);
        return null;
      }
      const rows = (data || []) as Array<{ id: string; order_id: string | null; amount: number | null; status: string | null }>;
      const main = rows.find(r => (r.amount ?? 0) >= 0 && String(r.status || '').toLowerCase() !== 'refunded');
      if (!main) return null;
      return {
        id: String(main.id),
        order_id: main.order_id ? String(main.order_id) : null,
        transaction_type: 'Платеж',
        amount: main.amount ?? null,
        status: main.status ?? null,
      };
    },

    sumRefundsForPaymentUid: async (uid) => {
      // Refunds in payments_v2 carry meta.parent_payment_uid = uid OR
      // negative amounts on the same provider_payment_id. We sum absolute values.
      const { data, error } = await supabase
        .from('payments_v2')
        .select('amount, status, meta')
        .or(`provider_payment_id.eq.${uid},meta->>parent_payment_uid.eq.${uid}`);
      if (error) {
        console.error('[rebill-deps] sumRefundsForPaymentUid error:', error.message);
        return 0;
      }
      let sum = 0;
      for (const r of (data || []) as Array<{ amount: number | null; status: string | null; meta: any }>) {
        const isRefundRow = (r.amount ?? 0) < 0 || String(r.status || '').toLowerCase() === 'refunded';
        if (isRefundRow) sum += Math.abs(r.amount ?? 0);
      }
      return sum;
    },

    checkSbsMismatchBeforeRebill: async ({ userId, productId, tariffId, incomingSbs }) => {
      if (!userId || !productId || !tariffId || !incomingSbs) {
        return { mismatch: false };
      }
      const { data, error } = await supabase
        .from('subscriptions_v2')
        .select('id, meta')
        .eq('user_id', userId)
        .eq('product_id', productId)
        .eq('tariff_id', tariffId)
        .eq('status', 'active')
        .eq('auto_renew', true);
      if (error) {
        console.error('[rebill-deps] checkSbsMismatchBeforeRebill error:', error.message);
        return { mismatch: false };
      }
      for (const row of (data || []) as Array<{ id: string; meta: any }>) {
        const localSbs = (row.meta || {})?.bepaid_subscription_id;
        if (localSbs && String(localSbs) !== String(incomingSbs)) {
          return {
            mismatch: true,
            foreignSbs: String(localSbs),
            candidateSubId: String(row.id),
          };
        }
      }
      return { mismatch: false };
    },

    insertRebillOrder: async (payload) => {
      const { data, error } = await supabase
        .from('orders_v2')
        .insert(payload as any)
        .select('id')
        .single();
      if (error) {
        // Surface the original error so the engine race-resolve regex matches
        // ('duplicate key' / '23505').
        throw new Error(`${error.code || ''} ${error.message}`.trim());
      }
      return { id: String((data as any).id) };
    },

    insertPaymentRow: async ({ rebill_order_id, payment_uid, payment, subscriptionId, userId, profileId }) => {
      const row = {
        order_id: rebill_order_id,
        user_id: userId,
        profile_id: profileId,
        amount: payment.amount,
        currency: payment.currency || 'BYN',
        status: 'succeeded',
        provider: 'bepaid',
        provider_payment_id: payment_uid,
        paid_at: payment.paid_at,
        is_recurring: true,
        meta: {
          bepaid_subscription_id: subscriptionId,
          source: 'rebill_flow_insert',
          materialization_run: 'bepaid_webhook_rebill_v2',
        },
      };
      const { data, error } = await supabase
        .from('payments_v2')
        .insert(row as any)
        .select('id')
        .single();
      if (error) {
        throw new Error(`payments_v2.insert: ${error.code || ''} ${error.message}`.trim());
      }
      return { payment_id: String((data as any).id) };
    },

    updatePaymentOrderId: async ({ payment_id, rebill_order_id }) => {
      // PATCH-RB1.2: verify affected_rows == 1, otherwise upstream must audit
      // payment_rebind_failed and downgrade the decision.
      const { data, error } = await supabase
        .from('payments_v2')
        .update({ order_id: rebill_order_id })
        .eq('id', payment_id)
        .select('id');
      if (error) throw new Error(`payments_v2.update: ${error.message}`);
      const affected = Array.isArray(data) ? data.length : 0;
      if (affected !== 1) {
        throw new Error(`payment_rebind_failed:affected_rows=${affected}`);
      }
    },

    invokeGrantAccess: async (rebillOrderId) => {
      const url = `${Deno.env.get('SUPABASE_URL')}${GRANT_FN_PATH}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          orderId: rebillOrderId,
          source: 'bepaid_webhook',
          context: 'rebill_materialized',
        }),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(`grant_http_${resp.status}: ${JSON.stringify(json)}`);
      }
      return json;
    },

    mergeOrderMeta: async ({ orderId, patch }) => {
      const { data: cur } = await supabase
        .from('orders_v2')
        .select('meta')
        .eq('id', orderId)
        .maybeSingle();
      const merged = { ...((cur?.meta && typeof cur.meta === 'object') ? cur.meta as Record<string, unknown> : {}), ...patch };
      const { error } = await supabase
        .from('orders_v2')
        .update({ meta: merged, updated_at: new Date().toISOString() })
        .eq('id', orderId);
      if (error) console.error('[rebill-deps] mergeOrderMeta error:', error.message);
    },

    writeAudit: async ({ action, meta }) => {
      const { error } = await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'bepaid-webhook-rebill',
        action,
        meta,
      });
      if (error) console.error('[rebill-deps] writeAudit error:', error.message);
    },
  };
}
