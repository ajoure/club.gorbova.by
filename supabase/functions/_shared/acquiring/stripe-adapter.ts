// Phase 2 — Stripe acquiring adapter.
// Implements AcquiringAdapter via Stripe Checkout Session (mode=payment).
// Reads sk_test_* from Vault using readAcquiringSecret.

import type { AcquiringAdapter, CheckoutRequest, CheckoutResponse } from './types.ts';
import { readAcquiringSecret } from './vault.ts';
import { stripeFetch } from './stripe-client.ts';
import { buildStripeMetadata, metadataToFormPairs } from './stripe-metadata.ts';

export const stripeAdapter: AcquiringAdapter = {
  provider: 'stripe',
  async createCheckout(req: CheckoutRequest): Promise<CheckoutResponse> {
    try {
      // MP-A2-1: account_code is a hard requirement from the caller.
      // No `?? 'stripe_poland'` fallback — callers MUST resolve account via
      // resolveDefaultStripeAccount() and pass it through req.context.
      const account_code = req.context.account_code?.trim();
      if (!account_code) {
        return {
          ok: false,
          fallback: true,
          error: 'stripe_adapter_missing_account_code',
        };
      }

      // MP-A2-1: success_url / cancel_url are a hard requirement.
      // No `?? 'https://example.com/...'` fallback — callers MUST pass URLs
      // resolved from acquiring_connections or PUBLIC_APP_HOST.
      const success_url = req.return_url?.trim();
      const cancel_url = req.cancel_url?.trim();
      if (!success_url || !cancel_url) {
        return {
          ok: false,
          fallback: true,
          error: 'stripe_adapter_missing_redirect_urls',
        };
      }

      // Resolve required metadata fields from caller-provided metadata bag.
      const md = (req.metadata ?? {}) as Record<string, string | number | null | undefined>;
      const validated = buildStripeMetadata({
        order_id: req.order_id,
        product_id: String(md.product_id ?? ''),
        tariff_id: String(md.tariff_id ?? ''),
        business_stream: req.context.business_stream ?? (md.business_stream as string | undefined) ?? null,
        account_code,
        offer_id: (md.offer_id as string | undefined) ?? null,
        payment_link_id: (md.payment_link_id as string | undefined) ?? null,
        contact_id: (md.contact_id as string | undefined) ?? null,
        user_id: (md.user_id as string | undefined) ?? null,
        profile_code: req.context.profile_code ?? null,
      });

      const secret_key = await readAcquiringSecret('stripe', account_code, 'secret_key');

      const form: Array<[string, string]> = [
        ['mode', 'payment'],
        ['client_reference_id', req.order_id],
        ['success_url', success_url],
        ['cancel_url', cancel_url],
        ['line_items[0][quantity]', '1'],
        ['line_items[0][price_data][currency]', req.currency.toLowerCase()],
        ['line_items[0][price_data][unit_amount]', String(Math.round(req.amount))],
        ['line_items[0][price_data][product_data][name]', req.description ?? `Order ${req.order_id}`],
      ];
      // MP-A2-2: resolved Customer takes precedence over customer_email.
      // Stripe rejects sessions that set both `customer` and `customer_email`.
      if (req.customer_id) {
        form.push(['customer', req.customer_id]);
      } else if (req.customer_email) {
        form.push(['customer_email', req.customer_email]);
      }
      // MP-A2-2: attach PaymentMethod to Customer on success for future off-session reuse.
      if (req.save_payment_method && req.customer_id) {
        form.push(['payment_intent_data[setup_future_usage]', 'off_session']);
      }
      for (const pair of metadataToFormPairs(validated as unknown as Record<string, string>)) {
        form.push(pair);
        // also mirror to payment_intent_data so PI carries metadata
        form.push([pair[0].replace('metadata[', 'payment_intent_data[metadata]['), pair[1]]);
      }

      const res = await stripeFetch<{ id: string; url: string }>('/checkout/sessions', {
        secret_key,
        method: 'POST',
        formBody: form,
        idempotencyKey: `order:${req.order_id}`,
      });

      if (!res.ok || !res.data) {
        return {
          ok: false,
          fallback: true,
          error: res.error?.message ?? `stripe_http_${res.status}`,
        };
      }
      return {
        ok: true,
        redirect_url: res.data.url,
        session_id: res.data.id,
      };
    } catch (e) {
      return {
        ok: false,
        fallback: true,
        error: e instanceof Error ? e.message : 'stripe_unknown_error',
      };
    }
  },
};
