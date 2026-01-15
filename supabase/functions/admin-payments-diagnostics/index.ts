import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * PATCH 4: Payments Diagnostics with dry-run/execute
 * 
 * Source of truth: payments_v2
 * 
 * Diagnosis types:
 * - MISSING_PAYMENT_RECORD: Paid order with bepaid_uid but no payment record
 * - MISMATCH_DUPLICATE_ORDER: Payment exists but linked to different order
 * - ORDER_DUPLICATE: Multiple paid orders for same bepaid_uid
 */

interface DiagnosticItem {
  order_id: string;
  order_number: string;
  created_at: string;
  profile_id: string | null;
  full_name: string | null;
  email: string | null;
  bepaid_uid: string | null;
  linked_payments_count: number;
  diagnosis: 'MISMATCH_DUPLICATE_ORDER' | 'MISSING_PAYMENT_RECORD' | 'NO_BEPAID_UID' | 'ORDER_DUPLICATE';
  diagnosis_detail: string;
  // For fixes
  can_auto_fix: boolean;
  fix_action?: string;
  // For MISMATCH cases
  existing_payment_id?: string;
  payment_linked_to_order_id?: string;
  payment_linked_to_order_number?: string;
  // For ORDER_DUPLICATE
  duplicate_order_ids?: string[];
  correct_order_id?: string;
  // Payment info from payments_v2
  payment_order_id?: string;
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
    const itemIds = body.itemIds || []; // specific items to fix
    const maxItems = body.maxItems || 50; // limit for batch operations

    console.log(`[DIAGNOSTICS] Mode: ${mode}, Items: ${itemIds.length}, Max: ${maxItems}`);

    if (mode === 'execute' && itemIds.length > 0) {
      // Execute fixes for specific items
      return await executeFixe(supabase, user.id, itemIds, maxItems);
    }

    // Run diagnostics
    console.log('[DIAGNOSTICS] Starting payment diagnostics...');

    // Step 1: Find all "paid" orders
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

    console.log(`[DIAGNOSTICS] Found ${paidOrders?.length || 0} paid orders`);

    const diagnosticItems: DiagnosticItem[] = [];
    const summary = {
      total_paid_orders: paidOrders?.length || 0,
      orders_with_payments: 0,
      mismatch_duplicate: 0,
      missing_payment: 0,
      no_bepaid_uid: 0,
      order_duplicate: 0,
      can_auto_fix: 0,
    };

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

    // Check for ORDER_DUPLICATE first
    const processedDuplicateUids = new Set<string>();

    for (const [bepaidUid, orders] of bepaidUidToOrders.entries()) {
      if (orders.length > 1 && !processedDuplicateUids.has(bepaidUid)) {
        processedDuplicateUids.add(bepaidUid);
        
        // Find which order the payment is actually linked to (source of truth)
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
              order_id: order.id,
              order_number: order.order_number,
              created_at: order.created_at,
              profile_id: order.profile_id,
              full_name: profile?.full_name || null,
              email: profile?.email || null,
              bepaid_uid: bepaidUid,
              linked_payments_count: 0,
              diagnosis: 'ORDER_DUPLICATE',
              diagnosis_detail: `Дубликат заказа. Платёж (${bepaidUid}) привязан к заказу ${correctOrderId ? orders.find(o => o.id === correctOrderId)?.order_number : 'N/A'}. Этот заказ следует пометить как дубликат.`,
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

    // Process remaining orders
    for (const order of paidOrders || []) {
      const bepaidUid = order.meta?.bepaid_uid || order.bepaid_uid;
      
      // Skip if already processed as duplicate
      if (bepaidUid && bepaidUidToOrders.get(bepaidUid)?.length! > 1) {
        continue;
      }

      // Check if this order has linked payments
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
          order_id: order.id,
          order_number: order.order_number,
          created_at: order.created_at,
          profile_id: order.profile_id,
          full_name: profile?.full_name || null,
          email: profile?.email || null,
          bepaid_uid: null,
          linked_payments_count: 0,
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
        // MISMATCH - payment exists but linked to different order
        // Source of truth is payments_v2, so we should relink this order
        summary.mismatch_duplicate++;
        const linkedOrderNumber = (existingPayment as any).orders_v2?.order_number || 'N/A';
        
        diagnosticItems.push({
          order_id: order.id,
          order_number: order.order_number,
          created_at: order.created_at,
          profile_id: order.profile_id,
          full_name: profile?.full_name || null,
          email: profile?.email || null,
          bepaid_uid: bepaidUid,
          linked_payments_count: 0,
          diagnosis: 'MISMATCH_DUPLICATE_ORDER',
          diagnosis_detail: `Платёж привязан к заказу ${linkedOrderNumber}. Источник истины — payments_v2. Рекомендуется: пометить этот заказ как дубликат или перепривязать платёж.`,
          can_auto_fix: true,
          fix_action: 'mark_duplicate_or_relink',
          existing_payment_id: existingPayment.id,
          payment_linked_to_order_id: existingPayment.order_id,
          payment_linked_to_order_number: linkedOrderNumber,
          payment_order_id: existingPayment.order_id,
        });
      } else if (!existingPayment) {
        // MISSING - bepaid_uid exists but no payment record anywhere
        summary.missing_payment++;
        diagnosticItems.push({
          order_id: order.id,
          order_number: order.order_number,
          created_at: order.created_at,
          profile_id: order.profile_id,
          full_name: profile?.full_name || null,
          email: profile?.email || null,
          bepaid_uid: bepaidUid,
          linked_payments_count: 0,
          diagnosis: 'MISSING_PAYMENT_RECORD',
          diagnosis_detail: `Запись платежа не найдена. Рекомендуется: fetch по bepaid_uid из bePaid API и создать запись.`,
          can_auto_fix: true,
          fix_action: 'fetch_and_create_payment',
        });
      }
    }

    summary.can_auto_fix = diagnosticItems.filter(i => i.can_auto_fix).length;

    console.log(`[DIAGNOSTICS] Complete. Found ${diagnosticItems.length} problematic orders.`);
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
              order_id: i.order_id,
              order_number: i.order_number,
              diagnosis: i.diagnosis,
              fix_action: i.fix_action,
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

async function executeFixe(
  supabase: any,
  actorUserId: string,
  itemIds: string[],
  maxItems: number
): Promise<Response> {
  console.log(`[DIAGNOSTICS] Executing fixes for ${itemIds.length} items (max ${maxItems})`);
  
  const results: FixResult[] = [];
  const limitedIds = itemIds.slice(0, maxItems);

  for (const orderId of limitedIds) {
    try {
      // Get order details
      const { data: order } = await supabase
        .from('orders_v2')
        .select('id, order_number, meta, bepaid_uid, status')
        .eq('id', orderId)
        .single();

      if (!order) {
        results.push({
          item_id: orderId,
          success: false,
          action: 'none',
          error: 'Order not found',
        });
        continue;
      }

      const bepaidUid = order.meta?.bepaid_uid || order.bepaid_uid;

      // Check if payment exists for this bepaid_uid
      const { data: existingPayment } = await supabase
        .from('payments_v2')
        .select('id, order_id')
        .eq('provider_payment_id', bepaidUid)
        .maybeSingle();

      if (existingPayment && existingPayment.order_id !== order.id) {
        // MISMATCH or ORDER_DUPLICATE case - mark this order as duplicate
        await supabase
          .from('orders_v2')
          .update({
            status: 'duplicate',
            meta: {
              ...order.meta,
              marked_duplicate_at: new Date().toISOString(),
              marked_duplicate_by: actorUserId,
              original_order_id: existingPayment.order_id,
              duplicate_reason: 'Payment linked to different order (payments_v2 is source of truth)',
            },
          })
          .eq('id', order.id);

        // Log audit
        await supabase.from('audit_logs').insert({
          actor_user_id: actorUserId,
          actor_type: 'admin',
          action: 'diagnostics_mark_duplicate',
          target_user_id: null,
          meta: {
            order_id: order.id,
            order_number: order.order_number,
            bepaid_uid: bepaidUid,
            correct_order_id: existingPayment.order_id,
          },
        });

        results.push({
          item_id: orderId,
          success: true,
          action: 'marked_duplicate',
          details: `Order marked as duplicate. Payment belongs to order ${existingPayment.order_id}`,
        });

      } else if (!existingPayment && bepaidUid) {
        // MISSING_PAYMENT_RECORD - try to fetch from bePaid and create
        const { data: fetchResult, error: fetchError } = await supabase.functions.invoke(
          'bepaid-recover-payment',
          { body: { orderId: order.id, bepaidUid } }
        );

        if (fetchError || !fetchResult?.success) {
          results.push({
            item_id: orderId,
            success: false,
            action: 'fetch_payment',
            error: fetchError?.message || fetchResult?.error || 'Failed to recover payment',
          });
        } else {
          // Log audit
          await supabase.from('audit_logs').insert({
            actor_user_id: actorUserId,
            actor_type: 'admin',
            action: 'diagnostics_recover_payment',
            target_user_id: null,
            meta: {
              order_id: order.id,
              order_number: order.order_number,
              bepaid_uid: bepaidUid,
              payment_created: true,
            },
          });

          results.push({
            item_id: orderId,
            success: true,
            action: 'payment_recovered',
            details: 'Payment record created from bePaid API',
          });
        }
      } else {
        results.push({
          item_id: orderId,
          success: false,
          action: 'none',
          error: 'No action needed or cannot auto-fix',
        });
      }

    } catch (err) {
      results.push({
        item_id: orderId,
        success: false,
        action: 'error',
        error: String(err),
      });
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
      summary: {
        total: results.length,
        success: successCount,
        failed: failCount,
      },
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
