// ============================================================================
// canonical-document-payment-hook — Sprint 3
// ----------------------------------------------------------------------------
// Назначение: безопасный, feature-flagged hook авто-генерации акта по оплате.
// НИКОГДА не ломает payment flow. Возвращает 200 даже при ошибках.
//
// Body: { order_id: string, dry_run?: boolean }
//
// Логика:
//   1. Если documents_canonical_generation_enabled = false → no-op
//   2. Если documents_service_act_auto_generation_enabled = false → no-op
//   3. Если order не paid → skip
//   4. Найти active document_generation_rule (trigger_type='order_paid')
//   5. Проверить current template version
//   6. Idempotency через ai_generated_documents.idempotency_key
//   7. Render через _shared/document-render
//   8. Авто-рассылка ЗАПРЕЩЕНА (всегда false)
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  generateCanonicalDocument,
  isCanonicalEnabled,
  CANONICAL_FEATURE_FLAG_KEY,
} from '../_shared/document-render.ts';
import { snapshotOrderDocumentData } from '../_shared/document-data-snapshot.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const AUTO_FLAG_KEY = 'documents_service_act_auto_generation_enabled';

async function audit(supabase: any, event: string, meta: any) {
  try {
    await supabase.from('audit_logs').insert({ actor_user_id: null, actor_type: 'system', action: event, meta });
  } catch (_e) { /* never throw */ }
}

async function isAutoEnabled(supabase: any): Promise<boolean> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', AUTO_FLAG_KEY).maybeSingle();
  return data?.value === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Always 200 — never break payment caller.
  const ok = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const orderId: string | null = body.order_id || null;
    const dryRun: boolean = body.dry_run === true;
    if (!orderId) return ok({ status: 'skipped', reason: 'no_order_id' });

    // ── Sprint 10: idempotent snapshot of orders_v2.meta.document_data ──
    // Runs independently of canonical/auto-gen flags. Never throws.
    const snap = await snapshotOrderDocumentData(supabase, orderId);

    // Flag #1
    const canonicalEnabled = await isCanonicalEnabled(supabase);
    if (!canonicalEnabled) return ok({ status: 'noop', reason: `flag:${CANONICAL_FEATURE_FLAG_KEY}=false`, snapshot: snap.status });
    // Flag #2 — separate auto-gen flag
    const autoEnabled = await isAutoEnabled(supabase);
    if (!autoEnabled && !dryRun) return ok({ status: 'noop', reason: `flag:${AUTO_FLAG_KEY}=false`, snapshot: snap.status });

    // Order context
    const { data: order } = await supabase.from('orders_v2')
      .select('id, status, profile_id, user_id, product_id, tariff_id, offer_id, final_price')
      .eq('id', orderId).maybeSingle();
    if (!order) return ok({ status: 'skipped', reason: 'order_not_found' });
    if (order.status !== 'paid') return ok({ status: 'skipped', reason: `order_status_${order.status}` });

    // Rule lookup — match product, then tariff, then offer (priority asc → most specific first)
    let rule: any = null;
    {
      const { data: rules } = await supabase.from('document_generation_rules')
        .select('*')
        .eq('is_active', true)
        .eq('trigger_type', 'order_paid')
        .order('priority', { ascending: false });
      for (const r of (rules || [])) {
        const productMatch = !r.product_id || r.product_id === order.product_id;
        const tariffMatch = !r.tariff_id || r.tariff_id === order.tariff_id;
        const offerMatch = !r.offer_id || r.offer_id === order.offer_id;
        const minOk = r.min_amount == null || (order.final_price != null && order.final_price >= r.min_amount);
        const maxOk = r.max_amount == null || (order.final_price != null && order.final_price <= r.max_amount);
        if (productMatch && tariffMatch && offerMatch && minOk && maxOk) { rule = r; break; }
      }
    }
    if (!rule) {
      await audit(supabase, 'document.auto_generation_no_rule', { order_id: orderId });
      return ok({ status: 'skipped', reason: 'no_active_rule' });
    }

    // Template + current version
    const { data: tpl } = await supabase.from('document_templates')
      .select('id, current_version_id').eq('id', rule.template_id).maybeSingle();
    if (!tpl) return ok({ status: 'skipped', reason: 'template_missing' });
    if (!tpl.current_version_id) {
      await audit(supabase, 'document.auto_generation_blocked_no_version', { order_id: orderId, rule_id: rule.id });
      return ok({ status: 'skipped', reason: 'template_version_missing' });
    }

    // Idempotency precheck
    const idem = `service_act:${orderId}:${tpl.current_version_id}`;
    const { data: existing } = await supabase.from('ai_generated_documents')
      .select('id, status').eq('idempotency_key', idem).is('deleted_at', null).maybeSingle();
    if (existing && existing.status === 'success') {
      return ok({ status: 'reused', document_id: existing.id, idempotency_key: idem });
    }

    if (dryRun) {
      return ok({
        status: 'dry_run_ok',
        rule_id: rule.id,
        template_id: tpl.id,
        template_version_id: tpl.current_version_id,
        idempotency_key: idem,
      });
    }

    // Resolve profile_id for opts
    const profileId = order.profile_id || null;
    if (!profileId) {
      await audit(supabase, 'document.auto_generation_blocked_no_profile', { order_id: orderId });
      return ok({ status: 'skipped', reason: 'no_profile' });
    }

    const result = await generateCanonicalDocument(supabase, {
      template_id: tpl.id,
      template_version_id: tpl.current_version_id,
      context_type: 'order',
      context_id: orderId,
      overrides: rule.field_overrides || undefined,
    }, {
      profileId,
      userId: '00000000-0000-0000-0000-000000000000', // system marker
      enforceFeatureFlag: true,
    });

    if (!result.success) {
      const code = result.error?.startsWith('missing_required_tokens')
        ? 'document.auto_generation_blocked_missing_required'
        : 'document.auto_generation_failed';
      await audit(supabase, code, {
        order_id: orderId, rule_id: rule.id, template_id: tpl.id, template_version_id: tpl.current_version_id,
        error: result.error, missing_tokens: result.payload?.missing_tokens || [],
      });
      return ok({ status: 'failed', reason: result.error });
    }

    await audit(supabase, 'document.auto_generated', {
      order_id: orderId, rule_id: rule.id, template_id: tpl.id, template_version_id: tpl.current_version_id,
      document_id: result.document_id, reused: result.reused, idempotency_key: idem,
      auto_send_email: false, auto_send_telegram: false,
    });

    return ok({
      status: 'generated', document_id: result.document_id, reused: !!result.reused,
      idempotency_key: idem, missing_tokens: result.payload?.missing_tokens || [],
    });
  } catch (e: any) {
    // Never break payment caller
    return ok({ status: 'error', reason: e?.message || 'internal' });
  }
});
