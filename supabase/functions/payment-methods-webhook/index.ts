import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Normalize card brand for consistent storage and matching
function normalizeBrand(brand: string | null | undefined): string {
  if (!brand) return '';
  const b = brand.toLowerCase().trim();
  const brandMap: Record<string, string> = {
    'visa': 'visa',
    'mastercard': 'mastercard',
    'master': 'mastercard',
    'mc': 'mastercard',
    'belkart': 'belkart',
    'belcard': 'belkart',
    'maestro': 'maestro',
    'mir': 'mir',
  };
  return brandMap[b] || b;
}

// Translate card tokenization errors to Russian
function translateTokenizationError(error: string): string {
  const errorMap: Record<string, string> = {
    'Declined': 'Карта отклонена банком',
    'declined': 'Карта отклонена банком',
    'Expired card': 'Срок действия карты истёк',
    'expired_card': 'Срок действия карты истёк',
    'Card restricted': 'На карте установлены ограничения',
    'card_restricted': 'На карте установлены ограничения',
    'Invalid card': 'Неверные данные карты',
    'invalid_card': 'Неверные данные карты',
    'Card number is invalid': 'Неверный номер карты',
    'Authentication failed': 'Ошибка подтверждения 3D Secure',
    'authentication_failed': 'Ошибка подтверждения 3D Secure',
    '3-D Secure authentication failed': 'Ошибка подтверждения 3D Secure',
    'Do not honor': 'Операция отклонена банком',
    'do_not_honor': 'Операция отклонена банком',
    'Lost card': 'Карта утеряна',
    'lost_card': 'Карта утеряна',
    'Stolen card': 'Карта украдена',
    'stolen_card': 'Карта украдена',
  };

  if (errorMap[error]) return errorMap[error];
  
  const lowerError = error.toLowerCase();
  for (const [key, value] of Object.entries(errorMap)) {
    if (lowerError.includes(key.toLowerCase())) return value;
  }
  
  return `Ошибка привязки карты: ${error}`;
}

// Send Telegram notification for card tokenization failure
async function sendTokenizationFailureNotification(
  supabase: any,
  customerEmail: string,
  errorMessage: string
): Promise<void> {
  try {
    // Find user by email
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_id, telegram_user_id, telegram_link_status, full_name')
      .ilike('email', customerEmail.toLowerCase().trim())
      .single();

    if (!profile?.telegram_user_id || profile.telegram_link_status !== 'active') {
      console.log('User not linked to Telegram, skipping notification');
      return;
    }

    const { data: linkBot } = await supabase
      .from('telegram_bots')
      .select('token')
      .eq('is_link_bot', true)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!linkBot?.token) {
      console.log('No link bot configured');
      return;
    }

    const userName = profile.full_name || 'Клиент';
    const russianError = translateTokenizationError(errorMessage);

    const message = `❌ *Не удалось привязать карту*

${userName}, к сожалению, не удалось привязать банковскую карту.

⚠️ *Причина:* ${russianError}

*Что можно сделать:*
• Проверьте правильность данных карты
• Убедитесь, что карта активна и не заблокирована
• Попробуйте привязать другую карту

🔗 [Попробовать снова](https://club.gorbova.by/settings/payment-methods)`;

    await fetch(`https://api.telegram.org/bot${linkBot.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: profile.telegram_user_id,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
    console.log('Sent tokenization failure notification via Telegram');
  } catch (error) {
    console.error('Error sending tokenization failure notification:', error);
  }
}

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
      
      // Send Telegram notification about failed tokenization
      if (customerEmail && status !== 'successful') {
        const errorMessage = transaction.message || 'Tokenization failed';
        await sendTokenizationFailureNotification(supabase, customerEmail, errorMessage);
      }
      
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
    // supports_recurring = true because we now tokenize with contract: ["recurring"]
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
        supports_recurring: true,
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

    // ========== CREATE card_profile_links for future autolink matching ==========
    try {
      const { data: profileForLink } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (profileForLink?.id && cardLast4) {
        const normalizedBrandValue = normalizeBrand(cardBrand);
        
        // Check if link already exists for this card+profile combination
        const { data: existingLink } = await supabase
          .from('card_profile_links')
          .select('id, card_brand')
          .eq('card_last4', cardLast4)
          .eq('profile_id', profileForLink.id)
          .maybeSingle();

        if (!existingLink) {
          // Insert new link
          const { error: linkError } = await supabase.from('card_profile_links').insert({
            card_last4: cardLast4,
            card_brand: normalizedBrandValue,
            card_holder: null,
            profile_id: profileForLink.id,
          });
          
          if (linkError) {
            console.error(`[payment-methods-webhook] Error creating card_profile_link:`, linkError);
          } else {
            console.log(`[payment-methods-webhook] Created card_profile_link for ${cardLast4}/${normalizedBrandValue} -> profile ${profileForLink.id}`);
          }
        } else if (existingLink.card_brand !== normalizedBrandValue) {
          // Update brand if it changed (e.g., 'master' -> 'mastercard')
          await supabase.from('card_profile_links')
            .update({ 
              card_brand: normalizedBrandValue,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingLink.id);
          console.log(`[payment-methods-webhook] Updated card_profile_link brand for ${cardLast4}: ${existingLink.card_brand} -> ${normalizedBrandValue}`);
        }
      }
    } catch (linkError) {
      // Non-blocking — log and continue (card_profile_links is optional, autolink still works with payment_methods)
      console.error('[payment-methods-webhook] card_profile_links error (non-blocking):', linkError);
    }

    console.log(`Payment method saved for user ${userId}: ${cardBrand} **** ${cardLast4} (product: ${cardProduct})`);
    
    // ========== AUTO-LINK historical payments ==========
    // Call payments-autolink-by-card to link historical unlinked payments to this profile
    let autolinkResult: any = null;
    try {
      // Get profile_id for the user
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', userId)
        .single();
      
      if (profileData?.id && cardLast4 && cardBrand) {
        console.log(`[payment-methods-webhook] Calling autolink for profile=${profileData.id}, last4=${cardLast4}, brand=${cardBrand}`);
        
        const autolinkResponse = await fetch(`${supabaseUrl}/functions/v1/payments-autolink-by-card`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            profile_id: profileData.id,
            user_id: userId,
            card_last4: cardLast4,
            card_brand: cardBrand,
            provider_token: cardToken,
            dry_run: false, // Execute for real
            limit: 200,
          }),
        });
        
        autolinkResult = await autolinkResponse.json();
        console.log(`[payment-methods-webhook] Autolink result:`, JSON.stringify(autolinkResult));
        
        // Store result in payment_methods.meta for UI to display
        if (autolinkResult?.stats) {
          const { data: newCard } = await supabase
            .from('payment_methods')
            .select('id')
            .eq('user_id', userId)
            .eq('last4', cardLast4)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          
          if (newCard?.id) {
            await supabase
              .from('payment_methods')
              .update({
                meta: {
                  tracking_id: trackingId,
                  transaction_id: transaction.uid,
                  autolink_result: {
                    updated_payments: autolinkResult.stats.updated_payments_profile || 0,
                    updated_queue: autolinkResult.stats.updated_queue_profile || 0,
                    status: autolinkResult.status,
                    stop_reason: autolinkResult.stop_reason || null,
                  },
                },
              })
              .eq('id', newCard.id);
          }
        }
      }
    } catch (autolinkError) {
      // Don't fail the main flow if autolink fails
      console.error('[payment-methods-webhook] Autolink error (non-blocking):', autolinkError);
    }
    
    return new Response(JSON.stringify({ 
      status: 'created',
      autolink: autolinkResult?.stats ? {
        updated_payments: autolinkResult.stats.updated_payments_profile || 0,
        updated_queue: autolinkResult.stats.updated_queue_profile || 0,
        status: autolinkResult.status,
      } : null,
    }), {
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
