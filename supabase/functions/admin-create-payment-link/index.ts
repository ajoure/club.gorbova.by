import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createPaymentCheckout } from '../_shared/create-payment-checkout.ts';
import { requirePaymentsEdit } from '../_shared/admin-section-auth.ts';
import { resolveSalesManagerForCreation, SalesManagerSelectionError } from '../_shared/sales-manager-attribution.ts';

interface CreatePaymentLinkRequest {
  user_id: string;
  product_id: string;
  tariff_id: string;
  amount: number; // in kopecks
  adjustment_amount?: number;
  adjustment_reason?: string | null;
  payment_type: 'one_time' | 'subscription';
  description?: string;
  offer_id?: string;
  replacement_of_subscription_v2_id?: string;
  // Audit / трассировка контракта (writer не использует для решений, только пробрасывает)
  requested_payment_type?: 'one_time' | 'subscription';
  resolved_mode?: 'canonical' | 'override';
  cta_source?: 'admin_manual' | 'reminder' | 'contact_card' | 'telegram_combined' | string;
  cta_contract_version?: number;
  responsible_user_id?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const access = await requirePaymentsEdit(req, supabase);
    if (!access.ok) return errorResponse(access.error, access.status);
    const user = access.actor;

    const body: CreatePaymentLinkRequest = await req.json();
    const {
      user_id, product_id, tariff_id, amount, adjustment_amount, adjustment_reason,
      payment_type, description, offer_id,
      replacement_of_subscription_v2_id,
      requested_payment_type, resolved_mode, cta_source, cta_contract_version,
      responsible_user_id: requestedResponsibleUserId,
    } = body;

    if (!user_id || !product_id || !tariff_id || !amount) {
      return errorResponse('Missing required fields: user_id, product_id, tariff_id, amount');
    }

    if (amount < 100) {
      return errorResponse('Minimum amount is 100 kopecks (1 BYN)');
    }
    const adjustmentAmount = Number(adjustment_amount ?? 0);
    const adjustmentReason = String(adjustment_reason ?? '').trim();
    if (!Number.isFinite(adjustmentAmount)) {
      return errorResponse('Invalid adjustment_amount', 400);
    }
    if (adjustmentAmount !== 0 && !adjustmentReason) {
      return errorResponse('adjustment_reason_required', 400);
    }
    if (!['one_time', 'subscription'].includes(payment_type)) {
      return errorResponse('Invalid payment_type');
    }

    const responsibleUserId = await resolveSalesManagerForCreation(
      supabase,
      user.id,
      requestedResponsibleUserId,
    );

    // Canonical origin for return URL: ВСЕГДА https://gorbova.by.
    // request origin/referer НЕ используем — админ может работать из Lovable preview.
    const origin = 'https://gorbova.by';

    // Delegate to shared helper. КОНТРАКТ: payment_type = выбор админа
    // (source of truth). Helper НЕ derive payment_type из offer.recurring.
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
      responsible_user_id: responsibleUserId,
      replacement_of_subscription_v2_id,
      meta_extra: {
        requested_payment_type: requested_payment_type || payment_type,
        resolved_mode: resolved_mode || 'canonical',
        cta_source: cta_source || 'admin_manual',
        cta_contract_version: typeof cta_contract_version === 'number' ? cta_contract_version : 1,
        adjustment_amount: adjustmentAmount,
        adjustment_reason: adjustmentAmount === 0 ? null : adjustmentReason,
      },
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
      // Proof contract — UI/audit может убедиться, что тип совпал с запросом.
      requested_payment_type: requested_payment_type || payment_type,
      resolved_mode: resolved_mode || 'canonical',
      cta_source: cta_source || 'admin_manual',
    });

  } catch (error) {
    if (error instanceof SalesManagerSelectionError) {
      return errorResponse(error.code, error.status);
    }
    console.error('[create-payment-link] Unexpected error:', error);
    return errorResponse('Internal server error', 500);
  }
});
