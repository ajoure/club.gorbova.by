import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createPaymentCheckout } from '../_shared/create-payment-checkout.ts';

interface CreatePaymentLinkRequest {
  user_id: string;
  product_id: string;
  tariff_id: string;
  amount: number; // in kopecks
  payment_type: 'one_time' | 'subscription';
  description?: string;
  offer_id?: string;
  replacement_of_subscription_v2_id?: string;
  // Audit / трассировка контракта (writer не использует для решений, только пробрасывает)
  requested_payment_type?: 'one_time' | 'subscription';
  resolved_mode?: 'canonical' | 'override';
  cta_source?: 'admin_manual' | 'reminder' | 'contact_card' | 'telegram_combined' | string;
  cta_contract_version?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check - must be admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('Not authorized', 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return errorResponse('Invalid token', 401);
    }

    // Check admin permission
    const { data: hasPermission } = await supabase.rpc('has_permission', {
      _user_id: user.id,
      _permission_code: 'entitlements.manage',
    });

    if (!hasPermission) {
      return errorResponse('Access denied', 403);
    }

    const body: CreatePaymentLinkRequest = await req.json();
    const { user_id, product_id, tariff_id, amount, payment_type, description, offer_id, replacement_of_subscription_v2_id } = body;

    if (!user_id || !product_id || !tariff_id || !amount) {
      return errorResponse('Missing required fields: user_id, product_id, tariff_id, amount');
    }

    if (amount < 100) {
      return errorResponse('Minimum amount is 100 kopecks (1 BYN)');
    }

    // Determine origin for return URL
    const reqOrigin = req.headers.get('origin');
    const reqReferer = req.headers.get('referer');
    const origin = reqOrigin || (reqReferer ? new URL(reqReferer).origin : null) || 'https://club.gorbova.by';

    // Delegate to shared helper (same logic as before, just extracted)
    const result = await createPaymentCheckout({
      supabase,
      user_id,
      product_id,
      tariff_id,
      amount,
      payment_type,
      description,
      offer_id,
      origin,
      actor_user_id: user.id,
      actor_type: 'admin',
      replacement_of_subscription_v2_id,
    });

    if (!result.success) {
      // PATCH E: pass conflict data if present
      const conflict = 'conflict' in result ? (result as any).conflict : undefined;
      return jsonResponse({
        success: false,
        error: result.error,
        ...(conflict ? { conflict } : {}),
      }, 200); // 200 so UI can read structured response
    }

    return jsonResponse({
      success: true,
      redirect_url: result.redirect_url,
      order_id: result.order_id,
      order_number: result.order_number,
      payment_type: result.payment_type,
    });

  } catch (error) {
    console.error('[create-payment-link] Unexpected error:', error);
    return errorResponse('Internal server error', 500);
  }
});
