import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Payments Diagnostics v2
 * 
 * Source of truth: payments_v2
 * 
 * Diagnosis types:
 * - MISSING_PAYMENT_RECORD: Paid order with bepaid_uid but no payment record
 * - MISMATCH_DUPLICATE_ORDER: Payment exists but linked to different order
 * - ORDER_DUPLICATE: Multiple paid orders for same bepaid_uid
 * - PAYMENT_WITHOUT_ORDER: Payment record exists but no matching order
 * - REFUND_NOT_LINKED: Refund transaction without link to parent payment
 */

interface DiagnosticItem {
  id: string; // unique key for frontend
  entity_type: 'order' | 'payment' | 'queue';
  entity_id: string;
  order_id: string | null;
  order_number: string | null;
  created_at: string;
  profile_id: string | null;
  full_name: string | null;
  email: string | null;
  bepaid_uid: string | null;
  amount: number | null;
  diagnosis: 'MISMATCH_DUPLICATE_ORDER' | 'MISSING_PAYMENT_RECORD' | 'NO_BEPAID_UID' | 'ORDER_DUPLICATE' | 'PAYMENT_WITHOUT_ORDER' | 'REFUND_NOT_LINKED';
  diagnosis_detail: string;
  can_auto_fix: boolean;
  fix_action?: string;
  // Additional context
  existing_payment_id?: string;
  payment_linked_to_order_id?: string;
  payment_linked_to_order_number?: string;
  duplicate_order_ids?: string[];
  correct_order_id?: string;
  payment_order_id?: string;
  parent_uid?: string;
}

interface FixResult {
  item_id: string;
  success: boolean;
  action: string;
  details?: string;
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify admin access
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: hasRole } = await supabase.rpc('has_role', { 
      _user_id: user.id, 
      _role: 'admin' 
    });
    
    if (!hasRole) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden: admin role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'diagnose'; // 'diagnose' | 'dry-run' | 'execute'
    const itemIds = body.itemIds || [];
    const maxItems = body.maxItems || 50;
    const includeRefunds = body.includeRefunds !== false; // Default true
    const includeOrphans = body.includeOrphans !== false; // Default true

    console.log(`[DIAGNOSTICS] Mode: ${mode}, Items: ${itemIds.length}, Max: ${maxItems}`);

    if (mode === 'execute' && itemIds.length > 0) {
      return await executeFixes(supabase, user.id, itemIds, maxItems);
    }

    // Run diagnostics
    console.log('[DIAGNOSTICS] Starting payment diagnostics...');

    const diagnosticItems: DiagnosticItem[] = [];
    const summary = {
      total_paid_orders: 0,
      orders_with_payments: 0,
      mismatch_duplicate: 0,
      missing_payment: 0,
      no_bepaid_uid: 0,
      order_duplicate: 0,
      payment_without_order: 0,
      refund_not_linked: 0,
      can_auto_fix: 0,
    };

    // =========================================================
    // PART 1: Check paid orders
    // =========================================================
    const { data: paidOrders, error: ordersError } = await supabase
      .from('orders_v2')
      .select(`
        id,
        order_number,
        created_at,
        profile_id,
        meta,
        bepaid_uid,
        profiles:profile_id(full_name, email)
      `)
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (ordersError) {
      throw new Error(`Failed to fetch orders: ${ordersError.message}`);
    }

    summary.total_paid_orders = paidOrders?.length || 0;
    console.log(`[DIAGNOSTICS] Found ${summary.total_paid_orders} paid orders`);

    // Build a map of bepaid_uid -> orders for duplicate detection
    const bepaidUidToOrders = new Map<string, any[]>();
    for (const order of paidOrders || []) {
      const bepaidUid = order.meta?.bepaid_uid || order.bepaid_uid;
      if (bepaidUid) {
        if (!bepaidUidToOrders.has(bepaidUid)) {
          bepaidUidToOrders.set(bepaidUid, []);
        }
        bepaidUidToOrders.get(bepaidUid)!.push(order);
      }
    }

    // Check for ORDER_DUPLICATE
    const processedDuplicateUids = new Set<string>();

    for (const [bepaidUid, orders] of bepaidUidToOrders.entries()) {
      if (orders.length > 1 && !processedDuplicateUids.has(bepaidUid)) {
        processedDuplicateUids.add(bepaidUid);
        
        const { data: payment } = await supabase
          .from('payments_v2')
          .select('id, order_id')
          .eq('provider_payment_id', bepaidUid)
          .maybeSingle();

        const correctOrderId = payment?.order_id;
        
        for (const order of orders) {
          if (order.id !== correctOrderId) {
            summary.order_duplicate++;
            const profile = order.profiles as any;
            
            diagnosticItems.push({
              id: `order_dup_${order.id}`,
              entity_type: 'order',
              entity_id: order.id,
              order_id: order.id,
              order_number: order.order_number,
              created_at: order.created_at,
              profile_id: order.profile_id,
              full_name: profile?.full_name || null,
              email: profile?.email || null,
              bepaid_uid: bepaidUid,
              amount: null,
              diagnosis: 'ORDER_DUPLICATE',
              diagnosis_detail: `Дубликат заказа. Платёж (${bepaidUid}) привязан к заказу ${correctOrderId ? orders.find(o => o.id === correctOrderId)?.order_number : 'N/A'}`,
              can_auto_fix: true,
              fix_action: 'mark_duplicate',
              duplicate_order_ids: orders.map(o => o.id),
              correct_order_id: correctOrderId,
              payment_order_id: correctOrderId,
            });
          }
        }
      }
    }

    // Process remaining orders for other issues
    for (const order of paidOrders || []) {
      const bepaidUid = order.meta?.bepaid_uid || order.bepaid_uid;
      
      // Skip if already processed as duplicate
      if (bepaidUid && bepaidUidToOrders.get(bepaidUid)?.length! > 1) {
        continue;
      }

      const { count: paymentCount } = await supabase
        .from('payments_v2')
        .select('*', { count: 'exact', head: true })
        .eq('order_id', order.id);

      if (paymentCount && paymentCount > 0) {
        summary.orders_with_payments++;
        continue;
      }

      const profile = order.profiles as any;

      if (!bepaidUid) {
        summary.no_bepaid_uid++;
        diagnosticItems.push({
          id: `order_no_uid_${order.id}`,
          entity_type: 'order',
          entity_id: order.id,
          order_id: order.id,
          order_number: order.order_number,
          created_at: order.created_at,
          profile_id: order.profile_id,
          full_name: profile?.full_name || null,
          email: profile?.email || null,
          bepaid_uid: null,
          amount: null,
          diagnosis: 'NO_BEPAID_UID',
          diagnosis_detail: 'Заказ отмечен как "оплачен", но не содержит bepaid_uid. Требуется ручная проверка.',
          can_auto_fix: false,
        });
        continue;
      }

      // Has bepaid_uid but no payment - check if payment exists elsewhere
      const { data: existingPayment } = await supabase
        .from('payments_v2')
        .select(`
          id,
          order_id,
          orders_v2:order_id(order_number)
        `)
        .eq('provider_payment_id', bepaidUid)
        .maybeSingle();

      if (existingPayment && existingPayment.order_id !== order.id) {
        summary.mismatch_duplicate++;
        const linkedOrderNumber = (existingPayment as any).orders_v2?.order_number || 'N/A';
        
        diagnosticItems.push({
          id: `order_mismatch_${order.id}`,
          entity_type: 'order',
          entity_id: order.id,
          order_id: order.id,
          order_number: order.order_number,
          created_at: order.created_at,
          profile_id: order.profile_id,
          full_name: profile?.full_name || null,
          email: profile?.email || null,
          bepaid_uid: bepaidUid,
          amount: null,
          diagnosis: 'MISMATCH_DUPLICATE_ORDER',
          diagnosis_detail: `Платёж привязан к заказу ${linkedOrderNumber}. Рекомендуется пометить этот заказ как дубликат.`,
          can_auto_fix: true,
          fix_action: 'mark_duplicate_or_relink',
          existing_payment_id: existingPayment.id,
          payment_linked_to_order_id: existingPayment.order_id,
          payment_linked_to_order_number: linkedOrderNumber,
          payment_order_id: existingPayment.order_id,
        });
      } else if (!existingPayment) {
        summary.missing_payment++;
        diagnosticItems.push({
          id: `order_missing_${order.id}`,
          entity_type: 'order',
          entity_id: order.id,
          order_id: order.id,
          order_number: order.order_number,
          created_at: order.created_at,
          profile_id: order.profile_id,
          full_name: profile?.full_name || null,
          email: profile?.email || null,
          bepaid_uid: bepaidUid,
          amount: null,
          diagnosis: 'MISSING_PAYMENT_RECORD',
          diagnosis_detail: `Запись платежа не найдена. Рекомендуется восстановить из bePaid API.`,
          can_auto_fix: true,
          fix_action: 'fetch_and_create_payment',
        });
      }
    }

    // =========================================================
    // PART 2: Check payments without orders (if includeOrphans)
    // =========================================================
    if (includeOrphans) {
      const { data: orphanPayments } = await supabase
        .from('payments_v2')
        .select(`
          id,
          order_id,
          provider_payment_id,
          amount,
          created_at,
          profile_id,
          profiles:profile_id(full_name, email)
        `)
        .is('order_id', null)
        .eq('status', 'successful')
        .limit(500);

      for (const payment of orphanPayments || []) {
        summary.payment_without_order++;
        const profile = payment.profiles as any;
        
        diagnosticItems.push({
          id: `payment_orphan_${payment.id}`,
          entity_type: 'payment',
          entity_id: payment.id,
          order_id: null,
          order_number: null,
          created_at: payment.created_at,
          profile_id: payment.profile_id,
          full_name: profile?.full_name || null,
          email: profile?.email || null,
          bepaid_uid: payment.provider_payment_id,
          amount: payment.amount,
          diagnosis: 'PAYMENT_WITHOUT_ORDER',
          diagnosis_detail: 'Платёж существует, но не привязан к заказу. Требуется ручная привязка.',
          can_auto_fix: false,
          fix_action: 'manual_link',
        });
      }
    }

    // =========================================================
    // PART 3: Check refunds without parent link (if includeRefunds)
    // =========================================================
    if (includeRefunds) {
      // Check refunds in payments_v2 (negative amounts)
      const { data: refundPayments } = await supabase
        .from('payments_v2')
        .select(`
          id,
          order_id,
          provider_payment_id,
          amount,
          reference_payment_id,
          created_at,
          profile_id,
          meta,
          profiles:profile_id(full_name, email)
        `)
        .lt('amount', 0)
        .is('reference_payment_id', null)
        .limit(500);

      for (const refund of refundPayments || []) {
        const parentUid = (refund.meta as any)?.parent_uid;
        summary.refund_not_linked++;
        const profile = refund.profiles as any;
        
        diagnosticItems.push({
          id: `refund_unlinked_${refund.id}`,
          entity_type: 'payment',
          entity_id: refund.id,
          order_id: refund.order_id,
          order_number: null,
          created_at: refund.created_at,
          profile_id: refund.profile_id,
          full_name: profile?.full_name || null,
          email: profile?.email || null,
          bepaid_uid: refund.provider_payment_id,
          amount: refund.amount,
          diagnosis: 'REFUND_NOT_LINKED',
          diagnosis_detail: parentUid 
            ? `Возврат не привязан к исходному платежу. Parent UID: ${parentUid}` 
            : 'Возврат не привязан к исходному платежу. Parent UID не найден.',
          can_auto_fix: !!parentUid,
          fix_action: parentUid ? 'link_refund' : 'manual_link',
          parent_uid: parentUid,
        });
      }

      // Also check queue for refund transactions
      const { data: queueRefunds } = await supabase
        .from('payment_reconcile_queue')
        .select('*')
        .eq('transaction_type', 'refund')
        .eq('status', 'pending')
        .limit(500);

      for (const queueItem of queueRefunds || []) {
        diagnosticItems.push({
          id: `queue_refund_${queueItem.id}`,
          entity_type: 'queue',
          entity_id: queueItem.id,
          order_id: queueItem.matched_order_id,
          order_number: null,
          created_at: queueItem.created_at,
          profile_id: queueItem.matched_profile_id,
          full_name: queueItem.customer_name || null,
          email: queueItem.customer_email || null,
          bepaid_uid: queueItem.bepaid_uid,
          amount: queueItem.amount ? -queueItem.amount : null,
          diagnosis: 'REFUND_NOT_LINKED',
          diagnosis_detail: `Возврат в очереди ожидает обработки. Ref: ${queueItem.reference_transaction_uid || 'N/A'}`,
          can_auto_fix: !!queueItem.reference_transaction_uid,
          fix_action: 'process_queue_refund',
          parent_uid: queueItem.reference_transaction_uid,
        });
      }
    }

    summary.can_auto_fix = diagnosticItems.filter(i => i.can_auto_fix).length;

    console.log(`[DIAGNOSTICS] Complete. Found ${diagnosticItems.length} issues.`);
    console.log(`[DIAGNOSTICS] Summary:`, summary);

    // If dry-run mode, show what would be fixed
    if (mode === 'dry-run') {
      const fixableItems = diagnosticItems.filter(i => i.can_auto_fix).slice(0, maxItems);
      return new Response(
        JSON.stringify({
          success: true,
          mode: 'dry-run',
          summary,
          items: diagnosticItems,
          dry_run: {
            would_fix: fixableItems.length,
            items: fixableItems.map(i => ({
              id: i.id,
              entity_type: i.entity_type,
              diagnosis: i.diagnosis,
              fix_action: i.fix_action,
              bepaid_uid: i.bepaid_uid,
            })),
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        mode: 'diagnose',
        summary,
        items: diagnosticItems,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[DIAGNOSTICS] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function executeFixes(
  supabase: any,
  actorUserId: string,
  itemIds: string[],
  maxItems: number
): Promise<Response> {
  console.log(`[DIAGNOSTICS] Executing fixes for ${itemIds.length} items (max ${maxItems})`);
  
  const results: FixResult[] = [];
  const limitedIds = itemIds.slice(0, maxItems);

  for (const itemId of limitedIds) {
    try {
      // Parse item ID to determine type
      const [prefix, entityId] = itemId.split('_').length > 2 
        ? [itemId.substring(0, itemId.lastIndexOf('_')), itemId.substring(itemId.lastIndexOf('_') + 1)]
        : itemId.split('_');

      if (prefix.startsWith('order_dup') || prefix.startsWith('order_mismatch')) {
        // ORDER_DUPLICATE or MISMATCH_DUPLICATE_ORDER
        const { data: order } = await supabase
          .from('orders_v2')
          .select('id, order_number, meta, bepaid_uid')
          .eq('id', entityId)
          .single();

        if (!order) {
          results.push({ item_id: itemId, success: false, action: 'none', error: 'Order not found' });
          continue;
        }

        const bepaidUid = order.meta?.bepaid_uid || order.bepaid_uid;
        
        const { data: existingPayment } = await supabase
          .from('payments_v2')
          .select('id, order_id')
          .eq('provider_payment_id', bepaidUid)
          .maybeSingle();

        if (existingPayment && existingPayment.order_id !== order.id) {
          await supabase
            .from('orders_v2')
            .update({
              status: 'duplicate',
              meta: {
                ...order.meta,
                marked_duplicate_at: new Date().toISOString(),
                marked_duplicate_by: actorUserId,
                original_order_id: existingPayment.order_id,
                duplicate_reason: 'Payment linked to different order',
              },
            })
            .eq('id', order.id);

          await supabase.from('audit_logs').insert({
            actor_user_id: actorUserId,
            actor_type: 'admin',
            action: 'diagnostics_mark_duplicate',
            meta: { order_id: order.id, bepaid_uid: bepaidUid, correct_order_id: existingPayment.order_id },
          });

          results.push({
            item_id: itemId,
            success: true,
            action: 'marked_duplicate',
            details: `Order marked as duplicate. Payment belongs to ${existingPayment.order_id}`,
          });
        } else {
          results.push({ item_id: itemId, success: false, action: 'none', error: 'No action needed' });
        }

      } else if (prefix.startsWith('order_missing')) {
        // MISSING_PAYMENT_RECORD
        const { data: order } = await supabase
          .from('orders_v2')
          .select('id, order_number, meta, bepaid_uid')
          .eq('id', entityId)
          .single();

        if (!order) {
          results.push({ item_id: itemId, success: false, action: 'none', error: 'Order not found' });
          continue;
        }

        const bepaidUid = order.meta?.bepaid_uid || order.bepaid_uid;
        
        const { data: fetchResult, error: fetchError } = await supabase.functions.invoke(
          'bepaid-recover-payment',
          { body: { orderId: order.id, bepaidUid } }
        );

        if (fetchError || !fetchResult?.success) {
          results.push({
            item_id: itemId,
            success: false,
            action: 'fetch_payment',
            error: fetchError?.message || fetchResult?.error || 'Failed to recover payment',
          });
        } else {
          await supabase.from('audit_logs').insert({
            actor_user_id: actorUserId,
            actor_type: 'admin',
            action: 'diagnostics_recover_payment',
            meta: { order_id: order.id, bepaid_uid: bepaidUid },
          });

          results.push({
            item_id: itemId,
            success: true,
            action: 'payment_recovered',
            details: 'Payment record created from bePaid API',
          });
        }

      } else if (prefix.startsWith('refund_unlinked')) {
        // REFUND_NOT_LINKED
        const { data: refund } = await supabase
          .from('payments_v2')
          .select('id, meta')
          .eq('id', entityId)
          .single();

        if (!refund) {
          results.push({ item_id: itemId, success: false, action: 'none', error: 'Refund not found' });
          continue;
        }

        const parentUid = (refund.meta as any)?.parent_uid;
        if (!parentUid) {
          results.push({ item_id: itemId, success: false, action: 'none', error: 'No parent_uid found' });
          continue;
        }

        const { data: parentPayment } = await supabase
          .from('payments_v2')
          .select('id')
          .eq('provider_payment_id', parentUid)
          .maybeSingle();

        if (parentPayment) {
          await supabase
            .from('payments_v2')
            .update({ reference_payment_id: parentPayment.id })
            .eq('id', refund.id);

          results.push({
            item_id: itemId,
            success: true,
            action: 'link_refund',
            details: `Refund linked to parent payment ${parentPayment.id}`,
          });
        } else {
          results.push({
            item_id: itemId,
            success: false,
            action: 'link_refund',
            error: `Parent payment not found for UID ${parentUid}`,
          });
        }

      } else {
        results.push({ item_id: itemId, success: false, action: 'none', error: 'Unknown item type' });
      }

    } catch (err) {
      results.push({ item_id: itemId, success: false, action: 'error', error: String(err) });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log(`[DIAGNOSTICS] Execute complete: ${successCount} success, ${failCount} failed`);

  return new Response(
    JSON.stringify({
      success: true,
      mode: 'execute',
      results,
      summary: { total: results.length, success: successCount, failed: failCount },
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
