import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    console.log(`Tokenization status: ${status}, email: ${customerEmail}, token: ${cardToken ? 'present' : 'missing'}`);

    if (status !== 'successful' || !cardToken) {
      console.log('Tokenization not successful or no token');
      return new Response(JSON.stringify({ status: 'ignored' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find user by email in profiles table (more reliable than listUsers which paginates)
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
        is_default: isFirstCard, // First card is default
        status: 'active',
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
      meta: { brand: cardBrand, last4: cardLast4, is_default: isFirstCard },
    });

    console.log(`Payment method saved for user ${userId}: ${cardBrand} **** ${cardLast4}`);
    
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