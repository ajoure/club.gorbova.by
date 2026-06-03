// Phase 2.1 — stripe-ensure-webhook
// super_admin only. Programmatically registers a Stripe webhook endpoint for
// the given account_code if none matches our canonical URL, and saves the
// returned signing secret (`whsec_*`) to vault. Idempotent.

import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';
import { stripeFetch } from '../_shared/acquiring/stripe-client.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ENABLED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
];

interface WebhookEndpoint {
  id: string;
  url: string;
  status: string;
  enabled_events: string[];
  secret?: string;
  livemode: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    await requireSuperAdmin(req);
    const { account_code, force_recreate } = (await req.json().catch(() => ({}))) as {
      account_code?: string;
      force_recreate?: boolean;
    };
    const code = account_code ?? 'stripe_poland';

    const targetUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/stripe-webhook`;
    const sk = await readAcquiringSecret('stripe', code, 'secret_key');

    // Resolve connection_id for vault RPC
    const svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: conn, error: connErr } = await svc
      .from('acquiring_connections')
      .select('id')
      .eq('provider', 'stripe')
      .eq('account_code', code)
      .maybeSingle();
    if (connErr || !conn) return jsonResponse({ ok: false, step: 'resolve_connection', error: connErr?.message ?? 'not_found' });
    const connection_id = conn.id as string;

    // 1) List existing endpoints
    const list = await stripeFetch<{ data: WebhookEndpoint[] }>(
      '/webhook_endpoints?limit=100',
      { secret_key: sk, method: 'GET' },
    );
    if (!list.ok) return jsonResponse({ ok: false, step: 'list', error: list.error });

    let existing = list.data?.data?.find((e) => e.url === targetUrl) ?? null;

    // Optional force recreate (needed when we need to capture a fresh secret)
    if (existing && force_recreate) {
      const del = await stripeFetch(`/webhook_endpoints/${encodeURIComponent(existing.id)}`, {
        secret_key: sk,
        method: 'DELETE',
      });
      if (!del.ok) return jsonResponse({ ok: false, step: 'delete', error: del.error });
      existing = null;
    }

    let created = false;
    let updated = false;

    // 2) If exists but missing events → update; if missing → create
    if (!existing) {
      const body: Array<[string, string]> = [
        ['url', targetUrl],
        ['description', 'Lovable Cloud — stripe-webhook (auto-registered)'],
      ];
      for (const ev of ENABLED_EVENTS) body.push(['enabled_events[]', ev]);
      const created_res = await stripeFetch<WebhookEndpoint>('/webhook_endpoints', {
        secret_key: sk,
        method: 'POST',
        formBody: body,
      });
      if (!created_res.ok) return jsonResponse({ ok: false, step: 'create', error: created_res.error });
      endpoint = created_res.data;
      created = true;
    } else {
      const missing = ENABLED_EVENTS.filter((e) => !existing.enabled_events.includes(e));
      if (missing.length > 0) {
        const body: Array<[string, string]> = [];
        for (const ev of ENABLED_EVENTS) body.push(['enabled_events[]', ev]);
        const upd = await stripeFetch<WebhookEndpoint>(
          `/webhook_endpoints/${encodeURIComponent(existing.id)}`,
          { secret_key: sk, method: 'POST', formBody: body },
        );
        if (!upd.ok) return jsonResponse({ ok: false, step: 'update', error: upd.error });
        endpoint = upd.data;
        updated = true;
      }
    }

    // 3) If we just created, Stripe returns `secret`. Save to vault.
    let secret_saved = false;
    if (created && endpoint?.secret) {
      const svc = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const { error: rpcErr } = await svc.rpc('admin_save_acquiring_secret', {
        p_provider: 'stripe',
        p_account_code: code,
        p_kind: 'webhook_signing_secret',
        p_value: endpoint.secret,
      });
      if (rpcErr) return jsonResponse({ ok: false, step: 'vault_save', error: rpcErr.message });
      secret_saved = true;
    }

    return jsonResponse({
      ok: true,
      account_code: code,
      endpoint_id: endpoint?.id,
      url: endpoint?.url,
      status: endpoint?.status,
      livemode: endpoint?.livemode,
      enabled_events: endpoint?.enabled_events,
      created,
      updated,
      secret_saved,
      secret_required_action: created
        ? null
        : 'If signing has been failing, rotate the existing endpoint secret in Stripe Dashboard and resave via UI.',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
