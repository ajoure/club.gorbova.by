import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DiagnosticItem {
  order_id: string;
  order_number: string;
  created_at: string;
  profile_id: string | null;
  full_name: string | null;
  email: string | null;
  bepaid_uid: string | null;
  linked_payments_count: number;
  diagnosis: 'MISMATCH_DUPLICATE_ORDER' | 'MISSING_PAYMENT_RECORD' | 'NO_BEPAID_UID';
  diagnosis_detail: string;
  // For MISMATCH cases
  existing_payment_id?: string;
  payment_linked_to_order_id?: string;
  payment_linked_to_order_number?: string;
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

    // Check admin role
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

    console.log('[DIAGNOSTICS] Starting payment diagnostics...');

    // Step 1: Find all "paid" orders without linked payments
    const { data: orphanOrders, error: orphanError } = await supabase
      .from('orders_v2')
      .select(`
        id,
        order_number,
        created_at,
        profile_id,
        meta,
        profiles:profile_id(full_name, email)
      `)
      .eq('status', 'paid')
      .order('created_at', { ascending: false });

    if (orphanError) {
      throw new Error(`Failed to fetch orders: ${orphanError.message}`);
    }

    console.log(`[DIAGNOSTICS] Found ${orphanOrders?.length || 0} paid orders, checking for missing payments...`);

    const diagnosticItems: DiagnosticItem[] = [];
    const summary = {
      total_paid_orders: orphanOrders?.length || 0,
      orders_with_payments: 0,
      mismatch_duplicate: 0,
      missing_payment: 0,
      no_bepaid_uid: 0,
    };

    for (const order of orphanOrders || []) {
      // Check if this order has linked payments
      const { count: paymentCount } = await supabase
        .from('payments_v2')
        .select('*', { count: 'exact', head: true })
        .eq('order_id', order.id);

      if (paymentCount && paymentCount > 0) {
        summary.orders_with_payments++;
        continue; // Order has payment, skip
      }

      // Order has NO payments - diagnose why
      const bepaidUid = order.meta?.bepaid_uid || null;
      const profile = order.profiles as any;

      if (!bepaidUid) {
        // NO_BEPAID_UID - order was created but no bePaid reference
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
          diagnosis_detail: 'Заказ отмечен как "оплачен", но не содержит bepaid_uid в meta. Возможно, заказ был создан вручную или импортирован без ссылки на платёж.',
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
          diagnosis_detail: `Платёж с bepaid_uid="${bepaidUid}" существует, но привязан к другому заказу (${linkedOrderNumber}). Вероятно, был создан дубликат заказа.`,
          existing_payment_id: existingPayment.id,
          payment_linked_to_order_id: existingPayment.order_id,
          payment_linked_to_order_number: linkedOrderNumber,
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
          diagnosis_detail: `Заказ содержит bepaid_uid="${bepaidUid}", но запись платежа в payments_v2 не найдена. Вероятно, webhook не создал запись или произошла ошибка.`,
        });
      }
    }

    console.log(`[DIAGNOSTICS] Complete. Found ${diagnosticItems.length} problematic orders.`);
    console.log(`[DIAGNOSTICS] Summary: mismatch=${summary.mismatch_duplicate}, missing=${summary.missing_payment}, no_uid=${summary.no_bepaid_uid}`);

    return new Response(
      JSON.stringify({
        success: true,
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
