// Phase 2 runtime verification helper — super-admin only.
// Creates a Stripe refund and lets the existing `charge.refunded` webhook +
// canonical `record_refund_atomic` path do the recording (no direct DB writes here).
//
// FREEZE-safe: does not touch bePaid, payment_links, or shared checkout.

import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { getAcquiringSecret } from '../_shared/acquiring/secrets.ts';

interface Body {
  payment_intent: string;            // pi_*
  amount_minor?: number;             // optional partial refund in minor units
  account_code?: string;
  reason?: 'requested_by_customer' | 'duplicate' | 'fraudulent';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    await requireSuperAdmin(req);
    const body = (await req.json()) as Body;
    if (!body.payment_intent || !/^pi_[A-Za-z0-9]+$/.test(body.payment_intent)) {
      return errorResponse('invalid_payment_intent', 400);
    }
    const account_code = body.account_code ?? 'stripe_poland';
    const sk = getAcquiringSecret(account_code, 'STRIPE_SECRET_KEY');

    const form = new URLSearchParams();
    form.set('payment_intent', body.payment_intent);
    if (typeof body.amount_minor === 'number' && body.amount_minor > 0) {
      form.set('amount', String(Math.round(body.amount_minor)));
    }
    if (body.reason) form.set('reason', body.reason);

    const resp = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sk}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return jsonResponse({ ok: false, status: resp.status, stripe_error: data?.error ?? data });
    }
    return jsonResponse({
      ok: true,
      refund_id: data.id,
      amount_minor: data.amount,
      currency: data.currency,
      status: data.status,
      charge: data.charge,
      payment_intent: data.payment_intent,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
