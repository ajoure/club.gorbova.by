import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Send order to GetCourse - same logic as direct-charge
async function sendToGetCourse(
  email: string,
  phone: string | null,
  offerId: number,
  orderNumber: string,
  amount: number,
  tariffCode: string
): Promise<{ success: boolean; error?: string; gcOrderId?: string }> {
  const apiKey = Deno.env.get('GETCOURSE_API_KEY');
  const accountName = 'gorbova';
  
  if (!apiKey) {
    console.log('GetCourse API key not configured, skipping');
    return { success: false, error: 'API key not configured' };
  }
  
  if (!offerId) {
    console.log(`No getcourse_offer_id for tariff: ${tariffCode}, skipping GetCourse sync`);
    return { success: false, error: `No GetCourse offer ID for tariff: ${tariffCode}` };
  }
  
  try {
    console.log(`Sending order to GetCourse: email=${email}, offerId=${offerId}, orderNumber=${orderNumber}`);
    
    const params = {
      user: {
        email: email,
        phone: phone || undefined,
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: {
        offer_code: offerId.toString(),
        deal_cost: amount / 100, // Convert from kopecks
        deal_status: 'payed',
        deal_is_paid: 1,
        payment_type: 'CARD',
        manager_email: 'info@ajoure.by',
        deal_comment: `Тестовая оплата через сайт club.gorbova.by. Order: ${orderNumber}`,
      },
    };
    
    console.log('GetCourse params:', JSON.stringify(params, null, 2));
    
    const formData = new URLSearchParams();
    formData.append('action', 'add');
    formData.append('key', apiKey);
    formData.append('params', btoa(unescape(encodeURIComponent(JSON.stringify(params)))));
    
    const response = await fetch(`https://${accountName}.getcourse.ru/pl/api/deals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    const responseText = await response.text();
    console.log('GetCourse response:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('Failed to parse GetCourse response:', responseText);
      return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
    }
    
    // Check result.success, not top-level success (which is just API call status)
    if (data.result?.success === true) {
      console.log('Order successfully sent to GetCourse, deal_id:', data.result?.deal_id);
      return { success: true, gcOrderId: data.result?.deal_id?.toString() };
    } else {
      const errorMsg = data.result?.error_message || data.error_message || 'Unknown error';
      console.error('GetCourse error:', errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('GetCourse API error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { orderId, email, tariffCode, offerId, amount } = await req.json();
    
    // If orderId provided, get order data from database
    if (orderId) {
      const { data: order, error } = await supabase
        .from('orders_v2')
        .select('*, tariffs(getcourse_offer_id, code, name)')
        .eq('id', orderId)
        .single();
      
      if (error || !order) {
        return new Response(
          JSON.stringify({ error: 'Order not found', details: error }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const tariff = order.tariffs as any;
      const gcResult = await sendToGetCourse(
        order.customer_email || email,
        null,
        tariff?.getcourse_offer_id || offerId,
        order.order_number,
        order.final_price,
        tariff?.code || tariffCode || 'unknown'
      );
      
      // Update order meta with sync result
      await supabase
        .from('orders_v2')
        .update({
          meta: {
            ...(order.meta as any || {}),
            gc_sync_status: gcResult.success ? 'success' : 'failed',
            gc_sync_error: gcResult.error || null,
            gc_order_id: gcResult.gcOrderId || null,
            gc_sync_at: new Date().toISOString(),
          },
        })
        .eq('id', orderId);
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          order: {
            id: order.id,
            order_number: order.order_number,
            email: order.customer_email,
            amount: order.final_price,
            tariff: tariff?.code,
            offerId: tariff?.getcourse_offer_id,
          },
          getcourse: gcResult 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Direct test with provided params
    if (!email || !offerId) {
      return new Response(
        JSON.stringify({ error: 'email and offerId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const testOrderNumber = `TEST-${Date.now().toString(36).toUpperCase()}`;
    const gcResult = await sendToGetCourse(
      email,
      null,
      offerId,
      testOrderNumber,
      amount || 100,
      tariffCode || 'test'
    );
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        testOrderNumber,
        getcourse: gcResult 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error:', errorMsg);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
