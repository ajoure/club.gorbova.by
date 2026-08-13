// payment-receipt-resolve — свежий чек по клику (Stripe hosted receipt expires ~30 дней).
//
// Hard contract:
//   - verify_jwt = true; вход { payment_id }
//   - Доступ: VIEW-роли (super_admin|admin|accountant) ИЛИ владелец заказа
//   - Stripe: exact retrieve charges/{ch_…} (или payment_intents → latest_charge).
//     НИКАКОГО list/search. Account+mode-aware через общую фабрику.
//   - При любой ошибке провайдера возвращается receipt=null + machine-code.
//     Сохранённый (протухший) Stripe URL НИКОГДА не возвращается.
//   - bePaid: отдаём сохранённый receipt_url как есть (local_bepaid).
//   - Ноль записей в payments_v2 / orders_v2 / subscriptions_v2 / entitlements.

import { corsHeaders } from '../_shared/cors.ts';
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  createStripeClientForPayment,
  makeStripeRetrieveOverHttp,
  type ConnectionLookup,
  type ReadSecret,
  type StripeClientResolution,
} from '../_shared/payments/documents/stripe-client-factory.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';

const VIEW_ROLES = ['super_admin', 'admin', 'accountant'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReceiptSource = 'provider_fresh' | 'local_bepaid';

export interface ReceiptResponse {
  payment_id: string;
  provider: string;
  receipt: { url: string; source: ReceiptSource } | null;
  error_code?: string;
}

export interface ReceiptDeps {
  supabase: SupabaseClient;
  /** Возвращает клиента Stripe для (account_code, mode). Вызывается только для stripe. */
  buildStripeClient: (args: {
    accountCode: string | null;
    livemode: boolean | null;
    testMode: boolean | null;
  }) => Promise<StripeClientResolution>;
  /** test_mode активного подключения для account_code (fallback, когда livemode пуст). */
  connectionTestMode: (accountCode: string) => Promise<boolean | null>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extractStripeMeta(meta: Record<string, unknown>) {
  const s = (meta as { stripe?: Record<string, unknown> }).stripe ?? {};
  const sm = s as {
    charge_id?: string;
    payment_intent_id?: string;
    account_code?: string;
    livemode?: boolean;
    test_mode?: boolean;
  };
  return {
    chargeId: typeof sm.charge_id === 'string' ? sm.charge_id : null,
    paymentIntentId: typeof sm.payment_intent_id === 'string' ? sm.payment_intent_id : null,
    accountCode: (typeof sm.account_code === 'string' && sm.account_code.trim())
      ? sm.account_code.trim()
      : ((meta as { account_code?: string }).account_code ?? null),
    livemode: typeof sm.livemode === 'boolean' ? sm.livemode : null,
    testMode: typeof sm.test_mode === 'boolean' ? sm.test_mode : null,
  };
}

/** Ядро: чистая функция поверх deps (тестируемая). */
export async function resolveFreshReceipt(
  paymentId: string,
  deps: ReceiptDeps,
): Promise<{ status: number; body: ReceiptResponse | { error: string } }> {
  if (!UUID_RE.test(paymentId)) return { status: 400, body: { error: 'INVALID_REQUEST' } };

  const { data: payment, error } = await deps.supabase
    .from('payments_v2')
    .select('id, provider, order_id, amount, meta, receipt_url')
    .eq('id', paymentId)
    .maybeSingle();
  if (error) return { status: 500, body: { error: 'INTERNAL_ERROR' } };
  if (!payment) return { status: 404, body: { error: 'PAYMENT_NOT_FOUND' } };

  const provider = String(payment.provider ?? 'bepaid');
  let meta = (payment.meta ?? {}) as Record<string, unknown>;
  const amount = payment.amount != null ? Number(payment.amount) : null;
  const isRefund = (amount ?? 0) < 0 || !!(meta as { is_refund?: boolean }).is_refund;

  // Refund → чек берём у родительского платежа (canonical link only).
  if (isRefund) {
    const parentId = (meta as { parent_payment_id?: string }).parent_payment_id ?? null;
    if (parentId && UUID_RE.test(parentId)) {
      const { data: parent } = await deps.supabase
        .from('payments_v2')
        .select('meta, receipt_url')
        .eq('id', parentId)
        .maybeSingle();
      if (parent) {
        meta = (parent.meta ?? {}) as Record<string, unknown>;
        (payment as { receipt_url?: string | null }).receipt_url =
          (parent as { receipt_url?: string | null }).receipt_url ?? null;
      }
    }
  }

  if (provider !== 'stripe') {
    const local = (payment as { receipt_url?: string | null }).receipt_url ?? null;
    return {
      status: 200,
      body: {
        payment_id: paymentId,
        provider,
        receipt: local ? { url: local, source: 'local_bepaid' } : null,
        ...(local ? {} : { error_code: 'RECEIPT_NOT_AVAILABLE' }),
      },
    };
  }

  const sm = extractStripeMeta(meta);
  if (!sm.accountCode) {
    return {
      status: 200,
      body: { payment_id: paymentId, provider, receipt: null, error_code: 'STRIPE_ACCOUNT_NOT_RESOLVED' },
    };
  }

  // Mode: livemode из meta; при отсутствии — детерминированный fallback на
  // test_mode активного подключения этого account_code (без live↔test перебора).
  let testMode = sm.testMode;
  if (sm.livemode === null && testMode === null) {
    testMode = await deps.connectionTestMode(sm.accountCode);
    if (testMode === null) {
      return {
        status: 200,
        body: { payment_id: paymentId, provider, receipt: null, error_code: 'STRIPE_MODE_NOT_RESOLVED' },
      };
    }
  }

  const resolution = await deps.buildStripeClient({
    accountCode: sm.accountCode,
    livemode: sm.livemode,
    testMode,
  });
  if (!resolution.ok) {
    return {
      status: 200,
      body: { payment_id: paymentId, provider, receipt: null, error_code: resolution.code },
    };
  }

  let chargeId = sm.chargeId;
  if (!chargeId && sm.paymentIntentId) {
    const pi = await resolution.client.retrieve('payment_intents', sm.paymentIntentId);
    if (!pi.ok || !pi.data) {
      return {
        status: 200,
        body: {
          payment_id: paymentId,
          provider,
          receipt: null,
          error_code: pi.error?.code ?? 'STRIPE_HTTP_ERROR',
        },
      };
    }
    const latest = (pi.data as { latest_charge?: unknown }).latest_charge;
    chargeId = typeof latest === 'string' ? latest : null;
  }

  if (!chargeId) {
    return {
      status: 200,
      body: { payment_id: paymentId, provider, receipt: null, error_code: 'PROVIDER_DOCUMENT_ID_NOT_RESOLVED' },
    };
  }

  const charge = await resolution.client.retrieve('charges', chargeId);
  if (!charge.ok || !charge.data) {
    return {
      status: 200,
      body: {
        payment_id: paymentId,
        provider,
        receipt: null,
        error_code: charge.error?.code ?? 'STRIPE_HTTP_ERROR',
      },
    };
  }
  const url = (charge.data as { receipt_url?: unknown }).receipt_url;
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    return {
      status: 200,
      body: { payment_id: paymentId, provider, receipt: null, error_code: 'RECEIPT_NOT_AVAILABLE' },
    };
  }

  return {
    status: 200,
    body: { payment_id: paymentId, provider, receipt: { url, source: 'provider_fresh' } },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'INVALID_REQUEST' }, 400);

  let body: { payment_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'INVALID_REQUEST' }, 400); }
  const paymentId = body.payment_id;
  if (!paymentId || typeof paymentId !== 'string' || !UUID_RE.test(paymentId)) {
    return json({ error: 'INVALID_REQUEST' }, 400);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'UNAUTHORIZED' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: uErr } = await supabase.auth.getUser(token);
  if (uErr || !user) return json({ error: 'UNAUTHORIZED' }, 401);

  // ── Авторизация: роль ИЛИ владелец заказа ────────────────────────────────
  const roleChecks = await Promise.all(
    VIEW_ROLES.map((r) => supabase.rpc('has_role_v2', { _user_id: user.id, _role_code: r })),
  );
  let allowed = roleChecks.some((r) => !!r.data);

  const { data: paymentRow } = await supabase
    .from('payments_v2')
    .select('id, order_id, meta')
    .eq('id', paymentId)
    .maybeSingle();
  if (!paymentRow) return json({ error: 'PAYMENT_NOT_FOUND' }, 404);

  if (!allowed) {
    let orderId = (paymentRow as { order_id?: string | null }).order_id ?? null;
    if (!orderId) {
      const parentId = ((paymentRow.meta ?? {}) as { parent_payment_id?: string }).parent_payment_id ?? null;
      if (parentId && UUID_RE.test(parentId)) {
        const { data: parent } = await supabase
          .from('payments_v2').select('order_id').eq('id', parentId).maybeSingle();
        orderId = (parent?.order_id as string | null) ?? null;
      }
    }
    if (orderId) {
      const { data: order } = await supabase
        .from('orders_v2').select('user_id').eq('id', orderId).maybeSingle();
      allowed = !!order && (order as { user_id?: string | null }).user_id === user.id;
    }
  }
  if (!allowed) return json({ error: 'FORBIDDEN' }, 403);

  const lookupConnection: ConnectionLookup = {
    async list(account_code: string) {
      const { data, error } = await supabase
        .from('acquiring_connections')
        .select('id, provider, account_code, test_mode, status')
        .eq('provider', 'stripe')
        .eq('account_code', account_code)
        .eq('status', 'active');
      if (error || !Array.isArray(data)) return [];
      return data.map((r) => ({
        id: String((r as { id: string }).id),
        provider: 'stripe' as const,
        account_code: String((r as { account_code: string }).account_code),
        test_mode: !!(r as { test_mode: boolean }).test_mode,
        status: String((r as { status: string }).status),
      }));
    },
  };
  const readSecret: ReadSecret = (provider, account_code, kind) =>
    readAcquiringSecret(provider, account_code, kind);

  try {
    const r = await resolveFreshReceipt(paymentId, {
      supabase,
      buildStripeClient: (args) =>
        createStripeClientForPayment(args, {
          lookupConnection,
          readSecret,
          makeRetrieve: (secret) => makeStripeRetrieveOverHttp(secret),
        }),
      connectionTestMode: async (accountCode) => {
        const rows = await lookupConnection.list(accountCode);
        if (rows.length !== 1) return null;
        return rows[0].test_mode;
      },
    });
    return json(r.body, r.status);
  } catch {
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
