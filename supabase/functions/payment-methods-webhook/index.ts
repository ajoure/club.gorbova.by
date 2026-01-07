import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    console.log('Payment methods webhook received:', JSON.stringify(body));

    // Handle tokenization webhook from bePaid
    const transaction = body.transaction;
    
    if (!transaction) {
      console.log('No transaction in webhook body');
      return new Response(JSON.stringify({ status: 'ignored' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const status = transaction.status;
    const trackingId = transaction.tracking_id;
    const cardToken = transaction.credit_card?.token;
    const cardBrand = transaction.credit_card?.brand;
    const cardLast4 = transaction.credit_card?.last_4;
    const cardExpMonth = transaction.credit_card?.exp_month;
    const cardExpYear = transaction.credit_card?.exp_year;
    const customerEmail = transaction.customer?.email;
    
    // Card type information from bePaid
    const cardProduct = transaction.credit_card?.product; // F=Physical, V=Virtual, N=Prepaid, P=Premium
    const cardCategory = transaction.credit_card?.card_category; // consumer, virtual, prepaid
    const isVirtualFlag = transaction.credit_card?.is_virtual; // boolean if Extended BIN enabled

    console.log(`Tokenization status: ${status}, email: ${customerEmail}, token: ${cardToken ? 'present' : 'missing'}`);
    console.log(`Card type info: product=${cardProduct}, category=${cardCategory}, is_virtual=${isVirtualFlag}`);

    if (status !== 'successful' || !cardToken) {
      console.log('Tokenization not successful or no token');
      return new Response(JSON.stringify({ status: 'ignored' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find user by email in profiles table
    const emailLower = customerEmail?.toLowerCase().trim();
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_id')
      .ilike('email', emailLower || '')
      .single();

    if (!profile?.user_id) {
      console.error('User not found for email:', customerEmail);
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = profile.user_id;

    // Parse tracking_id to get offer_id if present (format: orderId_offerId or just orderId)
    let offerId: string | null = null;
    if (trackingId && trackingId.includes('_')) {
      const parts = trackingId.split('_');
      if (parts.length >= 2) {
        offerId = parts[1];
      }
    }

    // Check if virtual card blocking is enabled for this offer
    let rejectVirtualCards = false;
    if (offerId) {
      const { data: offer } = await supabase
        .from('tariff_offers')
        .select('reject_virtual_cards, requires_card_tokenization')
        .eq('id', offerId)
        .single();
      
      if (offer?.reject_virtual_cards) {
        rejectVirtualCards = true;
      }
    }

    // Determine if card is virtual/prepaid
    const isVirtualCard = 
      cardProduct === 'V' || 
      cardProduct === 'N' ||
      cardCategory === 'virtual' || 
      cardCategory === 'prepaid' ||
      isVirtualFlag === true;

    console.log(`Virtual card check: rejectVirtualCards=${rejectVirtualCards}, isVirtualCard=${isVirtualCard}`);

    // Reject virtual cards if configured
    if (rejectVirtualCards && isVirtualCard) {
      console.log('Rejecting virtual card for user:', userId);
      
      // Log the rejection attempt
      await supabase.from('rejected_card_attempts').insert({
        user_id: userId,
        offer_id: offerId,
        card_brand: cardBrand,
        card_last4: cardLast4,
        card_product: cardProduct,
        card_category: cardCategory,
        reason: 'virtual_card_blocked',
        raw_data: transaction.credit_card,
      });

      // Also log to audit_logs
      await supabase.from('audit_logs').insert({
        actor_user_id: userId,
        action: 'payment_method.rejected_virtual',
        meta: { 
          brand: cardBrand, 
          last4: cardLast4, 
          product: cardProduct,
          category: cardCategory,
          offer_id: offerId,
        },
      });

      return new Response(JSON.stringify({ 
        status: 'rejected',
        reason: 'virtual_card_not_allowed',
        message: 'Виртуальные карты не принимаются для рассрочки',
      }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if this card already exists for the user
    const { data: existingCard } = await supabase
      .from('payment_methods')
      .select('id')
      .eq('user_id', userId)
      .eq('last4', cardLast4)
      .eq('exp_month', cardExpMonth)
      .eq('exp_year', cardExpYear)
      .eq('status', 'active')
      .single();

    if (existingCard) {
      console.log('Card already exists, updating token');
      await supabase
        .from('payment_methods')
        .update({
          provider_token: cardToken,
          card_product: cardProduct,
          card_category: cardCategory,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingCard.id);

      return new Response(JSON.stringify({ status: 'updated' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user has any other cards
    const { count } = await supabase
      .from('payment_methods')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'active');

    const isFirstCard = (count || 0) === 0;

    // Create new payment method
    const { error: insertError } = await supabase
      .from('payment_methods')
      .insert({
        user_id: userId,
        provider: 'bepaid',
        provider_token: cardToken,
        brand: cardBrand,
        last4: cardLast4,
        exp_month: cardExpMonth,
        exp_year: cardExpYear,
        is_default: isFirstCard,
        status: 'active',
        card_product: cardProduct,
        card_category: cardCategory,
        meta: {
          tracking_id: trackingId,
          transaction_id: transaction.uid,
        },
      });

    if (insertError) {
      console.error('Error saving payment method:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to save payment method' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log the action
    await supabase.from('audit_logs').insert({
      actor_user_id: userId,
      action: 'payment_method.added',
      meta: { 
        brand: cardBrand, 
        last4: cardLast4, 
        is_default: isFirstCard,
        card_product: cardProduct,
        card_category: cardCategory,
      },
    });

    console.log(`Payment method saved for user ${userId}: ${cardBrand} **** ${cardLast4} (product: ${cardProduct})`);
    
    return new Response(JSON.stringify({ status: 'created' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Error in payment-methods-webhook:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
