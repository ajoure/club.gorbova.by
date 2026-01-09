import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateTokenRequest {
  productId: string;
  customerEmail: string;
  customerPhone?: string;
  customerFirstName?: string;
  customerLastName?: string;
  existingUserId?: string | null;
  description?: string;
  tariffCode?: string; // For tariff identification: 'chat', 'full', 'business'
  skipRedirect?: boolean; // For admin test payments - just create order, don't create bePaid subscription
  isTrial?: boolean; // Trial payment flag
  trialDays?: number; // Trial duration in days
  offerId?: string; // Offer ID for virtual card blocking check
}

interface ProductInfo {
  id: string;
  name: string;
  price: number;
  currency: string;
  isV2: boolean;
}

function generatePassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get bePaid credentials from integration_instances (primary) or fallback to env
    const { data: bepaidInstance } = await supabase
      .from('integration_instances')
      .select('config')
      .eq('provider', 'bepaid')
      .in('status', ['active', 'connected'])
      .maybeSingle();

    const bepaidSecretKey = bepaidInstance?.config?.secret_key || Deno.env.get('BEPAID_SECRET_KEY');
    const bepaidShopId = bepaidInstance?.config?.shop_id || null;
    const bepaidSuccessUrl = bepaidInstance?.config?.success_url || null;
    const bepaidFailUrl = bepaidInstance?.config?.fail_url || null;
    
    if (!bepaidSecretKey) {
      console.error('bePaid secret key not configured in integration or env');
      return new Response(
        JSON.stringify({ success: false, error: 'Платёжная система не настроена' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('Using bePaid credentials from:', bepaidInstance ? 'integration_instances' : 'env');

    // Get user from auth header (if logged in)
    const authHeader = req.headers.get('Authorization');
    let authUserId: string | null = null;
    
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      authUserId = user?.id || null;
    }

    const { 
      productId, 
      customerEmail, 
      customerPhone,
      customerFirstName,
      customerLastName,
      existingUserId,
      description,
      tariffCode,
      skipRedirect,
      isTrial,
      trialDays,
      offerId,
    }: CreateTokenRequest = await req.json();

    if (!productId || !customerEmail) {
      return new Response(
        JSON.stringify({ success: false, error: 'Product ID and email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const emailLower = customerEmail.toLowerCase().trim();

    // Try to get product from products_v2 first (new system), then fallback to products (legacy)
    let productInfo: ProductInfo | null = null;
    
    // Try products_v2 first
    const { data: productV2 } = await supabase
      .from('products_v2')
      .select('id, name, currency')
      .eq('id', productId)
      .eq('is_active', true)
      .maybeSingle();
    
    if (productV2) {
      console.log('Found product in products_v2:', productV2.name);
      
      // For v2 products, get price from tariff_offers
      let priceFromOffer = 0;
      
      // PRIORITY 1: If offerId is provided, use that specific offer
      if (offerId) {
        const { data: specificOffer } = await supabase
          .from('tariff_offers')
          .select('amount, trial_days, auto_charge_amount, requires_card_tokenization, offer_type')
          .eq('id', offerId)
          .eq('is_active', true)
          .maybeSingle();
        
        if (specificOffer) {
          priceFromOffer = specificOffer.amount;
          console.log('Using specific offer by offerId:', offerId, 'price:', priceFromOffer);
        } else {
          console.warn('Offer not found or inactive:', offerId);
        }
      }
      
      // PRIORITY 2: Fallback to tariffCode-based lookup
      if (priceFromOffer === 0 && tariffCode) {
        // Get tariff by code
        const { data: tariff } = await supabase
          .from('tariffs')
          .select('id, original_price')
          .eq('code', tariffCode)
          .eq('product_id', productId)
          .maybeSingle();
        
        if (tariff) {
          if (isTrial) {
            // Get trial offer
            const { data: trialOffer } = await supabase
              .from('tariff_offers')
              .select('amount, trial_days, auto_charge_amount, requires_card_tokenization')
              .eq('tariff_id', tariff.id)
              .eq('offer_type', 'trial')
              .eq('is_active', true)
              .maybeSingle();
            
            if (trialOffer) {
              priceFromOffer = trialOffer.amount;
              console.log('Using trial offer price:', priceFromOffer);
            } else {
              console.warn('No active trial offer found for tariff:', tariffCode);
            }
          } else {
            // Get primary pay_now offer
            const { data: payOffer } = await supabase
              .from('tariff_offers')
              .select('amount')
              .eq('tariff_id', tariff.id)
              .eq('offer_type', 'pay_now')
              .eq('is_active', true)
              .eq('is_primary', true)
              .maybeSingle();
            
            if (payOffer) {
              priceFromOffer = payOffer.amount;
              console.log('Using primary pay offer price:', priceFromOffer);
            } else {
              // Fallback to first active pay offer
              const { data: firstPayOffer } = await supabase
                .from('tariff_offers')
                .select('amount')
                .eq('tariff_id', tariff.id)
                .eq('offer_type', 'pay_now')
                .eq('is_active', true)
                .order('sort_order', { ascending: true })
                .limit(1)
                .maybeSingle();
              
              if (firstPayOffer) {
                priceFromOffer = firstPayOffer.amount;
                console.log('Using first pay offer price:', priceFromOffer);
              } else {
                priceFromOffer = tariff.original_price || 0;
                console.log('Using tariff original_price:', priceFromOffer);
              }
            }
          }
        }
      }
      
      productInfo = {
        id: productV2.id,
        name: productV2.name,
        price: priceFromOffer,
        currency: productV2.currency,
        isV2: true,
      };
    } else {
      // Fallback to legacy products table
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .eq('is_active', true)
        .maybeSingle();
      
      if (product) {
        console.log('Found product in legacy products table:', product.name);
        productInfo = {
          id: product.id,
          name: product.name,
          price: product.price_byn,
          currency: product.currency,
          isV2: false,
        };
      }
    }
    
    if (!productInfo) {
      console.error('Product not found in either products_v2 or products table:', productId);
      return new Response(
        JSON.stringify({ success: false, error: 'Product not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine user ID for the order
    let userId = authUserId || existingUserId || null;
    let newUserCreated = false;
    let newUserPassword: string | null = null;

    // If no user ID, check if user exists by email or create new one
    if (!userId) {
      // Check if profile exists with this email
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('email', emailLower)
        .maybeSingle();

      if (existingProfile) {
        userId = existingProfile.user_id;
        console.log('Found existing user by email:', userId);

        // Update profile with additional info if provided
        if (customerPhone || customerFirstName) {
          const fullName = customerFirstName && customerLastName 
            ? `${customerFirstName} ${customerLastName}`.trim()
            : null;
          
          await supabase
            .from('profiles')
            .update({
              ...(customerPhone && { phone: customerPhone }),
              ...(fullName && { full_name: fullName }),
            })
            .eq('user_id', userId);
        }
      } else {
        // Create new user
        console.log('Creating new user for email:', emailLower);
        newUserPassword = generatePassword();
        
        const fullName = customerFirstName && customerLastName 
          ? `${customerFirstName} ${customerLastName}`.trim()
          : customerFirstName || 'Пользователь';

        const { data: newUser, error: createUserError } = await supabase.auth.admin.createUser({
          email: emailLower,
          password: newUserPassword,
          email_confirm: true, // Auto-confirm email
          user_metadata: {
            full_name: fullName,
            phone: customerPhone,
          },
        });

        if (createUserError) {
          console.error('Error creating user:', createUserError);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to create user account' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        userId = newUser.user.id;
        newUserCreated = true;
        console.log('Created new user:', userId);
      }
    }

    // Get payment settings - use integration_instances values if available, fallback to payment_settings
    const { data: settings } = await supabase
      .from('payment_settings')
      .select('key, value');

    const settingsMap: Record<string, string> = settings?.reduce((acc: Record<string, string>, s: { key: string; value: string }) => ({ ...acc, [s.key]: s.value }), {}) || {};
    // Priority: integration_instances > payment_settings > default
    const shopId = bepaidShopId || settingsMap['bepaid_shop_id'] || '33524';
    // Always redirect to /purchases after payment so user sees their order in "Мои покупки"
    const successUrl = bepaidSuccessUrl || settingsMap['bepaid_success_url'] || '/purchases?payment=processing';
    const failUrl = bepaidFailUrl || settingsMap['bepaid_fail_url'] || '/purchases?payment=failed';
    
    // Get origin from request for URLs
    const origin = req.headers.get('origin') || 'https://lovable.app';

    // Payment amount
    let paymentAmount = productInfo.price;
    let trialConfig: { trial_days: number; auto_charge_amount: number } | null = null;
    
    // For trial payments, get trial configuration
    if (isTrial && tariffCode && productInfo.isV2) {
      const { data: tariff } = await supabase
        .from('tariffs')
        .select('id, original_price')
        .eq('code', tariffCode)
        .eq('product_id', productId)
        .maybeSingle();
      
      if (tariff) {
        const { data: trialOffer } = await supabase
          .from('tariff_offers')
          .select('amount, trial_days, auto_charge_amount, auto_charge_after_trial')
          .eq('tariff_id', tariff.id)
          .eq('offer_type', 'trial')
          .eq('is_active', true)
          .maybeSingle();
        
        if (trialOffer) {
          paymentAmount = trialOffer.amount;
          
          // Get auto-charge amount from primary pay offer if not set
          let autoChargeAmount = trialOffer.auto_charge_amount;
          if (!autoChargeAmount) {
            const { data: primaryPayOffer } = await supabase
              .from('tariff_offers')
              .select('amount')
              .eq('tariff_id', tariff.id)
              .eq('offer_type', 'pay_now')
              .eq('is_active', true)
              .eq('is_primary', true)
              .maybeSingle();
            
            autoChargeAmount = primaryPayOffer?.amount || tariff.original_price || 0;
          }
          
          trialConfig = {
            trial_days: trialOffer.trial_days || trialDays || 5,
            auto_charge_amount: autoChargeAmount,
          };
          console.log('Trial payment configured:', { paymentAmount, trialConfig });
        }
      }
    }
    
    // For legacy products with trial
    if (isTrial && !productInfo.isV2 && tariffCode) {
      const { data: tariff } = await supabase
        .from('tariffs')
        .select('id, original_price')
        .eq('code', tariffCode)
        .maybeSingle();
      
      if (tariff) {
        const { data: trialOffer } = await supabase
          .from('tariff_offers')
          .select('amount, trial_days, auto_charge_amount')
          .eq('tariff_id', tariff.id)
          .eq('offer_type', 'trial')
          .eq('is_active', true)
          .maybeSingle();
        
        if (trialOffer) {
          paymentAmount = trialOffer.amount;
          trialConfig = {
            trial_days: trialOffer.trial_days || trialDays || 5,
            auto_charge_amount: trialOffer.auto_charge_amount || tariff.original_price || productInfo.price,
          };
          console.log('Legacy trial payment configured:', trialConfig);
        }
      }
    }

    console.log('Final payment amount:', paymentAmount, 'BYN');

    // Create order in database (using legacy orders table for compatibility)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        product_id: productInfo.isV2 ? null : productId, // Only set for legacy products
        amount: paymentAmount,
        currency: productInfo.currency,
        status: 'pending',
        customer_email: emailLower,
        customer_ip: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown',
        meta: { 
          product_name: productInfo.name,
          product_v2_id: productInfo.isV2 ? productId : null,
          description,
          customer_first_name: customerFirstName,
          customer_last_name: customerLastName,
          customer_phone: customerPhone,
          new_user_created: newUserCreated,
          new_user_password: newUserCreated ? newUserPassword : null,
          tariff_code: tariffCode || null,
          is_trial: isTrial || false,
          trial_days: trialConfig?.trial_days || null,
          auto_charge_amount: trialConfig?.auto_charge_amount || null,
        }
      })
      .select()
      .single();

    if (orderError) {
      console.error('Failed to create order:', orderError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to create order' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Created order:', order.id, 'for user:', userId, 'amount:', paymentAmount);

    // For admin test payments, skip bePaid integration.
    // IMPORTANT: create an orders_v2 record as well so admin UI (contacts/deals) can see it.
    if (skipRedirect) {
      console.log('Skip redirect requested, returning order without bePaid integration');

      let returnedOrderId = order.id;
      let v2Created = false;

      if (productInfo.isV2) {
        try {
          // Resolve tariff_id if possible
          let tariffId: string | null = null;
          if (tariffCode) {
            const { data: tariffRow } = await supabase
              .from('tariffs')
              .select('id')
              .eq('product_id', productId)
              .eq('code', tariffCode)
              .maybeSingle();
            tariffId = tariffRow?.id ?? null;
          }

          const orderNumber = `ORD-TEST-${Date.now().toString(36).toUpperCase()}`;
          const { data: orderV2, error: orderV2Error } = await supabase
            .from('orders_v2')
            .insert({
              order_number: orderNumber,
              user_id: userId,
              product_id: productId,
              tariff_id: tariffId,
              base_price: paymentAmount,
              final_price: paymentAmount,
              currency: productInfo.currency,
              is_trial: isTrial || false,
              trial_end_at: (isTrial && trialConfig?.trial_days)
                ? new Date(Date.now() + trialConfig.trial_days * 24 * 60 * 60 * 1000).toISOString()
                : null,
              status: 'pending',
              customer_email: emailLower,
              meta: {
                source: 'admin_test',
                legacy_order_id: order.id,
                tariff_code: tariffCode || null,
                offer_id: offerId || null,
                test_payment: true,
              },
            })
            .select('id')
            .single();

          if (orderV2Error) {
            console.error('Failed to create orders_v2 for test payment:', orderV2Error);
          } else if (orderV2?.id) {
            returnedOrderId = orderV2.id;
            v2Created = true;
          }
        } catch (e) {
          console.error('Failed to create orders_v2 for test payment:', e);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          orderId: returnedOrderId,
          legacyOrderId: order.id,
          skipped: true,
          isV2: v2Created,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get client IP address for bePaid
    const customerIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
                    || req.headers.get('cf-connecting-ip') 
                    || req.headers.get('x-real-ip')
                    || '127.0.0.1';

    // Build subscription plan based on trial or regular payment
    const planConfig = isTrial && trialConfig ? {
      title: `${productInfo.name} (Trial)`,
      currency: productInfo.currency,
      shop_id: Number(shopId),
      plan: {
        amount: Math.round(trialConfig.auto_charge_amount * 100), // Convert to cents
        interval: 30,
        interval_unit: 'day',
      },
      trial: {
        amount: Math.round(paymentAmount * 100), // Convert to cents
        interval: trialConfig.trial_days,
        interval_unit: 'day',
      },
    } : {
      title: productInfo.name,
      currency: productInfo.currency,
      shop_id: Number(shopId),
      plan: {
        amount: Math.round(paymentAmount * 100), // Convert to cents
        interval: 30,
        interval_unit: 'day',
      },
    };

    const buildReturnUrl = (basePath: string, paymentParam: string) => {
      const url = new URL(basePath.startsWith('http') ? basePath : `${origin}${basePath}`);
      url.searchParams.set('payment', paymentParam);
      url.searchParams.set('order', order.id);
      return url.toString();
    };

    // For subscriptions requiring recurring payments, only allow card payments
    // ERIP, Apple Pay, Google Pay do not support server-initiated recurring charges
    // Build tracking_id with offerId for virtual card blocking check
    const trackingId = offerId ? `${order.id}_${offerId}` : order.id;

    const subscriptionPayload = {
      customer: {
        email: emailLower,
        first_name: customerFirstName || undefined,
        last_name: customerLastName || undefined,
        phone: customerPhone || undefined,
        ip: customerIp,
      },
      plan: planConfig,
      tracking_id: trackingId,
      // Always return to a "processing" state; UI will show success ONLY after confirmed provider status.
      return_url: buildReturnUrl(successUrl, 'processing'),
      notification_url: `${supabaseUrl}/functions/v1/bepaid-webhook`,
      settings: {
        language: 'ru',
        // Restrict payment methods to cards only for recurring subscriptions
        // This excludes ERIP, Apple Pay, Google Pay, Samsung Pay which don't support
        // server-initiated recurring charges with saved tokens
        payment_method: {
          types: ['credit_card'],
        },
      },
      additional_data: {
        order_id: order.id,
        product_id: productId,
        tariff_code: tariffCode || null,
        offer_id: offerId || null,
        description: description || null,
        is_trial: isTrial || false,
        // Keep failUrl for audit/debug (bePaid subscriptions API has single return_url).
        fail_return_url: buildReturnUrl(failUrl, 'failed'),
      },
    };

    console.log('Sending subscription to bePaid:', JSON.stringify(subscriptionPayload, null, 2));

    const bepaidAuth = btoa(`${shopId}:${bepaidSecretKey}`);
    const bepaidResponse = await fetch('https://api.bepaid.by/subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${bepaidAuth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-API-Version': '2',
      },
      body: JSON.stringify(subscriptionPayload),
    });

    const bepaidData = await bepaidResponse.json();
    console.log('bePaid subscription response:', JSON.stringify(bepaidData, null, 2));

    const subscriptionId = bepaidData?.id as string | undefined;
    const subscriptionToken = bepaidData?.token as string | undefined;
    const redirectUrl = bepaidData?.redirect_url as string | undefined;

    if (!bepaidResponse.ok || !subscriptionId || !redirectUrl) {
      const errMsg = bepaidData?.message || bepaidData?.error || 'Payment service error';
      console.error('bePaid subscription API error:', errMsg, bepaidData);

      await supabase
        .from('orders')
        .update({ status: 'failed', error_message: errMsg })
        .eq('id', order.id);

      return new Response(
        JSON.stringify({ success: false, error: errMsg }),
        { status: bepaidResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Persist subscription identifiers on our order
    await supabase
      .from('orders')
      .update({
        bepaid_token: subscriptionToken || null,
        status: 'processing',
        meta: {
          ...(order.meta as Record<string, any> || {}),
          bepaid_subscription_id: subscriptionId,
          bepaid_subscription_state: bepaidData?.state || null,
          bepaid_subscription_plan: bepaidData?.plan || null,
        },
      })
      .eq('id', order.id);

    return new Response(
      JSON.stringify({
        success: true,
        token: subscriptionToken,
        redirectUrl,
        orderId: order.id,
        subscriptionId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error creating payment token:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
