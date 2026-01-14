import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GrantAccessRequest {
  order_id: string;
  force?: boolean;
  dry_run?: boolean;
}

interface GrantAccessResponse {
  ok: boolean;
  status: 'success' | 'failed' | 'skipped';
  gc_order_id?: string;
  gc_deal_number?: number;
  error?: string;
  error_type?: 'rate_limit' | 'validation' | 'auth' | 'network' | 'no_email' | 'no_gc_offer' | 'unknown';
  skipped_reason?: string;
  dry_run?: boolean;
}

// Generate a consistent deal_number from orderNumber for GetCourse updates
function generateDealNumber(orderNumber: string): number {
  let hash = 0;
  for (let i = 0; i < orderNumber.length; i++) {
    const char = orderNumber.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// Determine error type from GetCourse error message
function getErrorType(error: string): 'rate_limit' | 'validation' | 'auth' | 'network' | 'unknown' {
  const errorLower = error.toLowerCase();
  if (errorLower.includes('лимит') || errorLower.includes('limit')) return 'rate_limit';
  if (errorLower.includes('авторизац') || errorLower.includes('auth') || errorLower.includes('401')) return 'auth';
  if (errorLower.includes('network') || errorLower.includes('fetch') || errorLower.includes('timeout')) return 'network';
  if (errorLower.includes('invalid') || errorLower.includes('required') || errorLower.includes('validation')) return 'validation';
  return 'unknown';
}

async function sendToGetCourse(
  userData: { email: string; phone?: string | null; firstName?: string | null; lastName?: string | null },
  offerId: number,
  orderNumber: string,
  amount: number,
  tariffCode: string
): Promise<{ success: boolean; error?: string; gcOrderId?: string; gcDealNumber?: number }> {
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
    console.log(`[GC-GRANT] Sending: email=${userData.email}, offerId=${offerId}, orderNumber=${orderNumber}`);
    
    const dealNumber = generateDealNumber(orderNumber);
    console.log(`[GC-GRANT] Generated deal_number=${dealNumber} from orderNumber=${orderNumber}`);
    
    const params = {
      user: {
        email: userData.email,
        phone: userData.phone || undefined,
        first_name: userData.firstName || undefined,
        last_name: userData.lastName || undefined,
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: {
        deal_number: dealNumber,
        offer_code: offerId.toString(),
        deal_cost: amount,
        deal_status: 'payed',
        deal_is_paid: 1,
        payment_type: 'CARD',
        manager_email: 'info@ajoure.by',
        deal_comment: `Оплата через сайт club.gorbova.by. Order: ${orderNumber}`,
      },
    };
    
    console.log('[GC-GRANT] Request params:', JSON.stringify(params, null, 2));
    
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
    console.log('[GC-GRANT] Response:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('[GC-GRANT] Failed to parse response:', responseText);
      return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
    }
    
    if (data.result?.success === true) {
      console.log('[GC-GRANT] Success, deal_id:', data.result?.deal_id, 'deal_number:', dealNumber);
      return { success: true, gcOrderId: data.result?.deal_id?.toString(), gcDealNumber: dealNumber };
    } else {
      const errorMsg = data.result?.error_message || data.error_message || 'Unknown error';
      console.error('[GC-GRANT] Error:', errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[GC-GRANT] API error:', errorMsg);
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

    const body: GrantAccessRequest = await req.json();
    const { order_id, force = false, dry_run = false } = body;

    if (!order_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'order_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[GC-GRANT] Processing order_id=${order_id}, force=${force}, dry_run=${dry_run}`);

    // Fetch order with all related data
    const { data: order, error: orderError } = await supabase
      .from('orders_v2')
      .select(`
        *,
        tariffs!inner(id, name, code, getcourse_offer_id),
        products_v2!inner(id, name, code)
      `)
      .eq('id', order_id)
      .maybeSingle();

    if (orderError || !order) {
      console.error('[GC-GRANT] Order not found:', orderError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Order not found', error_type: 'validation' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get offer if exists (for offer-level getcourse_offer_id)
    let offer: any = null;
    const offerId = (order.meta as any)?.offer_id;
    if (offerId) {
      const { data: offerData } = await supabase
        .from('tariff_offers')
        .select('id, getcourse_offer_id, offer_type')
        .eq('id', offerId)
        .maybeSingle();
      offer = offerData;
    }

    // Get profile for additional user data
    let profile: any = null;
    if (order.user_id) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('first_name, last_name, phone, email')
        .eq('user_id', order.user_id)
        .maybeSingle();
      profile = profileData;
    }

    // Determine getcourse_offer_id: offer-level > tariff-level
    const tariff = order.tariffs as any;
    const getcourseOfferId = offer?.getcourse_offer_id || tariff?.getcourse_offer_id;
    
    // Determine customer email: order > profile
    const customerEmail = order.customer_email || profile?.email;

    // Check eligibility
    if (!customerEmail) {
      console.log('[GC-GRANT] Skipped: no customer email');
      
      if (!dry_run) {
        await supabase.from('orders_v2').update({
          meta: {
            ...((order.meta as object) || {}),
            gc_sync_status: 'skipped',
            gc_sync_error: 'No customer email',
            gc_sync_error_type: 'no_email',
            gc_synced_at: new Date().toISOString(),
          }
        }).eq('id', order.id);

        await supabase.from('audit_logs').insert({
          actor_user_id: order.user_id || '00000000-0000-0000-0000-000000000000',
          action: 'gc_sync_skipped',
          meta: { order_id: order.id, reason: 'no_email' },
        });
      }

      const response: GrantAccessResponse = {
        ok: true,
        status: 'skipped',
        skipped_reason: 'no_email',
        error: 'No customer email',
        error_type: 'no_email',
        dry_run,
      };
      return new Response(JSON.stringify(response), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!getcourseOfferId) {
      console.log('[GC-GRANT] Skipped: no GetCourse offer configured');
      
      if (!dry_run) {
        await supabase.from('orders_v2').update({
          meta: {
            ...((order.meta as object) || {}),
            gc_sync_status: 'skipped',
            gc_sync_error: 'No GetCourse offer configured',
            gc_sync_error_type: 'no_gc_offer',
            gc_synced_at: new Date().toISOString(),
          }
        }).eq('id', order.id);

        await supabase.from('audit_logs').insert({
          actor_user_id: order.user_id || '00000000-0000-0000-0000-000000000000',
          action: 'gc_sync_skipped',
          meta: { order_id: order.id, reason: 'no_gc_offer' },
        });
      }

      const response: GrantAccessResponse = {
        ok: true,
        status: 'skipped',
        skipped_reason: 'no_gc_offer',
        error: 'No GetCourse offer configured',
        error_type: 'no_gc_offer',
        dry_run,
      };
      return new Response(JSON.stringify(response), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Idempotency check
    const currentStatus = (order.meta as any)?.gc_sync_status;
    if (!force && currentStatus === 'success') {
      console.log('[GC-GRANT] Already synced successfully, skipping (use force=true to retry)');
      
      const response: GrantAccessResponse = {
        ok: true,
        status: 'success',
        gc_order_id: (order.meta as any)?.gc_order_id,
        gc_deal_number: (order.meta as any)?.gc_deal_number,
        dry_run,
      };
      return new Response(JSON.stringify(response), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Dry run - return what would happen
    if (dry_run) {
      const response: GrantAccessResponse = {
        ok: true,
        status: 'success',
        dry_run: true,
      };
      console.log('[GC-GRANT] Dry run complete');
      return new Response(JSON.stringify(response), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Record attempt in audit
    await supabase.from('audit_logs').insert({
      actor_user_id: order.user_id || '00000000-0000-0000-0000-000000000000',
      action: 'gc_sync_attempt',
      meta: { 
        order_id: order.id, 
        order_number: order.order_number,
        gc_offer_id: getcourseOfferId,
        email: customerEmail,
      },
    });

    // Call GetCourse API
    const gcResult = await sendToGetCourse(
      {
        email: customerEmail,
        phone: profile?.phone || order.customer_phone || null,
        firstName: profile?.first_name || null,
        lastName: profile?.last_name || null,
      },
      parseInt(getcourseOfferId, 10) || 0,
      order.order_number,
      Number(order.final_price) || 0,
      tariff?.code || tariff?.name || 'unknown'
    );

    // Determine error type and next retry time
    let errorType: string | null = null;
    let nextRetryAt: string | null = null;
    const currentRetryCount = ((order.meta as any)?.gc_retry_count || 0);
    
    if (gcResult.error) {
      errorType = getErrorType(gcResult.error);
      if (errorType === 'rate_limit') {
        // Set next retry for 24 hours later
        nextRetryAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      }
    }

    // Update order meta with result
    await supabase.from('orders_v2').update({
      meta: {
        ...((order.meta as object) || {}),
        gc_sync_status: gcResult.success ? 'success' : 'failed',
        gc_sync_error: gcResult.error || null,
        gc_sync_error_type: errorType,
        gc_order_id: gcResult.gcOrderId || (order.meta as any)?.gc_order_id || null,
        gc_deal_number: gcResult.gcDealNumber || (order.meta as any)?.gc_deal_number || null,
        gc_synced_at: new Date().toISOString(),
        gc_retry_count: gcResult.success ? 0 : currentRetryCount + 1,
        gc_next_retry_at: gcResult.success ? null : nextRetryAt,
      }
    }).eq('id', order.id);

    // Audit log success/failure
    await supabase.from('audit_logs').insert({
      actor_user_id: order.user_id || '00000000-0000-0000-0000-000000000000',
      action: gcResult.success ? 'gc_sync_success' : 'gc_sync_failed',
      meta: { 
        order_id: order.id, 
        order_number: order.order_number,
        gc_offer_id: getcourseOfferId,
        gc_order_id: gcResult.gcOrderId,
        gc_deal_number: gcResult.gcDealNumber,
        error: gcResult.error,
        error_type: errorType,
      },
    });

    const response: GrantAccessResponse = {
      ok: true,
      status: gcResult.success ? 'success' : 'failed',
      gc_order_id: gcResult.gcOrderId,
      gc_deal_number: gcResult.gcDealNumber,
      error: gcResult.error,
      error_type: errorType as any,
    };

    console.log('[GC-GRANT] Complete:', response);
    return new Response(JSON.stringify(response), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('[GC-GRANT] Unexpected error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message, error_type: 'unknown' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
