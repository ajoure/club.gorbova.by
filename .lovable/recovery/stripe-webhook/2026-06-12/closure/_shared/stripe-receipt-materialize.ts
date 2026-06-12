// =============================================================================
// Phase 8-B/C — Stripe receipt/invoice link materialization helper.
// =============================================================================
// Reuses existing payments_v2 fields. NEVER creates new tables / storage copies.
//
// Contract:
//   - NEVER throws. All failures only logged to audit_logs as
//     'stripe.receipt_materialization.failed'. Webhook lifecycle (grant/access/
//     order/subscription/payment) is NOT affected by materialization errors.
//   - Lineage: caller MUST resolve payment_id ONLY through provider_payment_id /
//     invoice_id / charge.payment_intent / order_id from event metadata.
//     Search by email/amount/currency/created_at is FORBIDDEN.
//   - receipt_url: COALESCE-only. If existing receipt_url present and different
//     from new value → audit 'stripe.receipt_materialization.skipped_existing_receipt_url',
//     keep old value.
//   - meta.stripe: merge-only (preserve all existing keys).
//   - Actor: system / actor_user_id=NULL / actor_label='stripe-webhook'.
//
// See .lovable/proofs/phase_8_receipts_documents_v1.md.

type SB = { from: (t: string) => any };

export async function materializeStripeDocumentLinks(
  supabase: SB,
  payment_id: string | null | undefined,
  links: {
    receipt_url?: string | null;
    hosted_invoice_url?: string | null;
    invoice_pdf?: string | null;
  },
  ctx: { event_id: string; event_type: string; account_code: string; source: string },
): Promise<void> {
  const auditBase = {
    actor_type: 'system' as const,
    actor_user_id: null as null,
    actor_label: 'stripe-webhook' as const,
  };
  try {
    const hasAny =
      !!(links.receipt_url && String(links.receipt_url).trim()) ||
      !!(links.hosted_invoice_url && String(links.hosted_invoice_url).trim()) ||
      !!(links.invoice_pdf && String(links.invoice_pdf).trim());
    if (!payment_id) {
      await supabase.from('audit_logs').insert({
        action: 'stripe.receipt_materialization.skipped_payment_not_found',
        entity_type: 'payments_v2',
        entity_id: null,
        ...auditBase,
        meta: { ...ctx, has_links: hasAny },
      });
      return;
    }
    if (!hasAny) {
      await supabase.from('audit_logs').insert({
        action: 'stripe.receipt_materialization.skipped_no_document_url',
        entity_type: 'payments_v2',
        entity_id: payment_id,
        ...auditBase,
        meta: ctx,
      });
      return;
    }
    const { data: cur } = await supabase
      .from('payments_v2')
      .select('id, receipt_url, meta')
      .eq('id', payment_id)
      .maybeSingle();
    if (!cur) {
      await supabase.from('audit_logs').insert({
        action: 'stripe.receipt_materialization.skipped_payment_not_found',
        entity_type: 'payments_v2',
        entity_id: payment_id,
        ...auditBase,
        meta: ctx,
      });
      return;
    }
    const curMeta = (cur.meta && typeof cur.meta === 'object') ? cur.meta as Record<string, unknown> : {};
    const curStripe = (curMeta.stripe && typeof curMeta.stripe === 'object')
      ? curMeta.stripe as Record<string, unknown>
      : {};
    const nextStripe: Record<string, unknown> = { ...curStripe };
    const updates: string[] = [];

    if (links.hosted_invoice_url && String(links.hosted_invoice_url).trim()) {
      const v = String(links.hosted_invoice_url).trim();
      if (curStripe.hosted_invoice_url !== v) {
        nextStripe.hosted_invoice_url = v;
        updates.push('meta.stripe.hosted_invoice_url');
      }
    }
    if (links.invoice_pdf && String(links.invoice_pdf).trim()) {
      const v = String(links.invoice_pdf).trim();
      if (curStripe.invoice_pdf !== v) {
        nextStripe.invoice_pdf = v;
        updates.push('meta.stripe.invoice_pdf');
      }
    }

    const patch: Record<string, unknown> = {};
    const newReceipt = links.receipt_url ? String(links.receipt_url).trim() : '';
    const curReceipt = cur.receipt_url ? String(cur.receipt_url).trim() : '';
    if (newReceipt) {
      if (!curReceipt) {
        patch.receipt_url = newReceipt;
        updates.push('receipt_url');
      } else if (curReceipt !== newReceipt) {
        await supabase.from('audit_logs').insert({
          action: 'stripe.receipt_materialization.skipped_existing_receipt_url',
          entity_type: 'payments_v2',
          entity_id: payment_id,
          ...auditBase,
          meta: { ...ctx, existing_receipt_url: curReceipt, new_receipt_url: newReceipt },
        });
      }
    }

    if (updates.length === 0) return; // idempotent no-op

    patch.meta = { ...curMeta, stripe: nextStripe };
    const { error: updErr } = await supabase
      .from('payments_v2')
      .update(patch)
      .eq('id', payment_id);
    if (updErr) {
      await supabase.from('audit_logs').insert({
        action: 'stripe.receipt_materialization.failed',
        entity_type: 'payments_v2',
        entity_id: payment_id,
        ...auditBase,
        meta: { ...ctx, error: updErr.message, updates },
      });
      return;
    }
    await supabase.from('audit_logs').insert({
      action: 'stripe.receipt_materialization.applied',
      entity_type: 'payments_v2',
      entity_id: payment_id,
      ...auditBase,
      meta: { ...ctx, updates },
    });
  } catch (e) {
    try {
      await supabase.from('audit_logs').insert({
        action: 'stripe.receipt_materialization.failed',
        entity_type: 'payments_v2',
        entity_id: payment_id ?? null,
        ...auditBase,
        meta: { ...ctx, error: e instanceof Error ? e.message : String(e) },
      });
    } catch { /* swallow */ }
  }
}
