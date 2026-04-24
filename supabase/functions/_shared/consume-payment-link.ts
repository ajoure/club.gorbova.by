/**
 * Shared helper: idempotently consume a payment_link slot upon a CONFIRMED paid order.
 *
 * Canonical sequence (do not reorder):
 *   1) read order → require meta.payment_link_id
 *   2) require meta.payment_link_counted !== true (idempotency)
 *   3) conditional UPDATE: current_uses + 1 WHERE current_uses < COALESCE(max_uses, 2147483647)
 *   4) on success → set order.meta.payment_link_counted = true
 *   5) audit `public_checkout.link_consumed`
 *
 * If the conditional UPDATE matched 0 rows (limit reached) → audit
 * `public_checkout.link_consume_skipped_limit_reached` and DO NOT mark the order.
 *
 * Counter MUST only be called for terminal SUCCESS branches (paid).
 * NEVER call from failed / canceled / refunded branches.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

export async function consumePaymentLinkForOrder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orderId: string,
  callerLabel = 'bepaid-webhook',
): Promise<{ status: 'consumed' | 'already_counted' | 'no_payment_link' | 'limit_reached' | 'error'; payment_link_id?: string; error?: string }> {
  try {
    const { data: order, error: orderErr } = await supabase
      .from('orders_v2')
      .select('id, meta')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) {
      console.error(`[consume-payment-link] (${callerLabel}) order not found:`, orderId, orderErr);
      return { status: 'error', error: 'order_not_found' };
    }

    const meta = (order.meta && typeof order.meta === 'object' ? order.meta : {}) as Record<string, any>;
    const paymentLinkId = meta.payment_link_id as string | undefined;

    if (!paymentLinkId) {
      return { status: 'no_payment_link' };
    }

    if (meta.payment_link_counted === true) {
      return { status: 'already_counted', payment_link_id: paymentLinkId };
    }

    // Read current_uses + max_uses for the conditional update guard
    const { data: link, error: linkErr } = await supabase
      .from('payment_links')
      .select('id, current_uses, max_uses')
      .eq('id', paymentLinkId)
      .maybeSingle();

    if (linkErr || !link) {
      console.error(`[consume-payment-link] (${callerLabel}) link not found:`, paymentLinkId, linkErr);
      return { status: 'error', error: 'link_not_found', payment_link_id: paymentLinkId };
    }

    // Conditional increment — only if not at limit
    const currentUses = (link.current_uses as number | null) ?? 0;
    const maxUses = link.max_uses as number | null;
    const newCount = currentUses + 1;
    const atLimit = maxUses != null && currentUses >= maxUses;

    if (atLimit) {
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_label: callerLabel,
        action: 'public_checkout.link_consume_skipped_limit_reached',
        created_at: new Date().toISOString(),
        meta: {
          order_id: orderId,
          payment_link_id: paymentLinkId,
          current_uses: link.current_uses,
          max_uses: link.max_uses,
        },
      });
      return { status: 'limit_reached', payment_link_id: paymentLinkId };
    }

    // Atomic-ish update with WHERE guard (current_uses unchanged + still under limit)
    const { data: updated, error: updErr } = await supabase
      .from('payment_links')
      .update({ current_uses: newCount, updated_at: new Date().toISOString() })
      .eq('id', paymentLinkId)
      .eq('current_uses', currentUses) // optimistic concurrency guard
      .select('id, current_uses')
      .maybeSingle();

    if (updErr || !updated) {
      console.error(`[consume-payment-link] (${callerLabel}) update failed (race or limit):`, paymentLinkId, updErr);
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_label: callerLabel,
        action: 'public_checkout.link_consume_skipped_limit_reached',
        created_at: new Date().toISOString(),
        meta: {
          order_id: orderId,
          payment_link_id: paymentLinkId,
          reason: updErr ? 'update_error' : 'race_condition_or_limit',
          error: updErr?.message ?? null,
        },
      });
      return { status: 'limit_reached', payment_link_id: paymentLinkId };
    }

    // Mark order as counted (idempotency seal)
    await supabase
      .from('orders_v2')
      .update({ meta: { ...meta, payment_link_counted: true, payment_link_counted_at: new Date().toISOString() } })
      .eq('id', orderId);

    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_label: callerLabel,
      action: 'public_checkout.link_consumed',
      created_at: new Date().toISOString(),
      meta: {
        order_id: orderId,
        payment_link_id: paymentLinkId,
        new_current_uses: updated.current_uses,
        max_uses: link.max_uses,
      },
    });

    return { status: 'consumed', payment_link_id: paymentLinkId };
  } catch (e) {
    console.error(`[consume-payment-link] (${callerLabel}) unexpected error:`, e);
    return { status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}
