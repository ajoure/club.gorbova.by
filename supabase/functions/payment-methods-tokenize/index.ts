import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get bePaid credentials from integration_instances (primary) or fallback to env
    const { data: bepaidInstance } = await supabase
      .from('integration_instances')
      .select('config')
      .eq('provider', 'bepaid')
      .in('status', ['active', 'connected'])
      .maybeSingle();

    const bepaidSecretKey = bepaidInstance?.config?.secret_key || Deno.env.get('BEPAID_SECRET_KEY');
    const bepaidShopIdFromInstance = bepaidInstance?.config?.shop_id || null;
    
    if (!bepaidSecretKey) {
      console.error('bePaid secret key not configured');
      return new Response(JSON.stringify({ error: 'Платёжная система не настроена' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log('Using bePaid credentials from:', bepaidInstance?.config?.secret_key ? 'integration_instances' : 'env');

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action } = await req.json();
    console.log(`Payment methods action: ${action} for user ${user.id}`);

    switch (action) {
      case 'create-session': {
        // Get additional settings from payment_settings
        const { data: settings } = await supabase
          .from('payment_settings')
          .select('key, value')
          .in('key', [
            'bepaid_shop_id',
            'bepaid_test_mode',
            'bepaid_currency',
            'bepaid_tokenization_amount',
          ]);

        const settingsMap: Record<string, string> = settings?.reduce(
          (acc: Record<string, string>, s: { key: string; value: string }) => ({
            ...acc,
            [s.key]: s.value,
          }),
          {}
        ) || {};

        // Priority: integration_instances > payment_settings > default
        const shopId = bepaidShopIdFromInstance || settingsMap['bepaid_shop_id'] || '33524';
        const testMode = settingsMap['bepaid_test_mode'] === 'true';
        const currency = settingsMap['bepaid_currency'] || 'BYN';

        // Amount is in minimal currency units (e.g. 100 = 1.00 BYN). For tokenization this can be 0.
        const tokenizationAmountRaw = settingsMap['bepaid_tokenization_amount'] ?? '0';
        const tokenizationAmount = Number.parseInt(tokenizationAmountRaw, 10);
        const tokenizationAmountSafe = Number.isFinite(tokenizationAmount) && tokenizationAmount >= 0 ? tokenizationAmount : 0;

        // Create bePaid tokenization checkout
        const returnUrl = `${req.headers.get('origin') || 'https://gorbova.club'}/settings/payment-methods?tokenize=success`;
        const cancelUrl = `${req.headers.get('origin') || 'https://gorbova.club'}/settings/payment-methods?tokenize=cancel`;

        // Get user profile for customer info
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, first_name, last_name, phone')
          .eq('user_id', user.id)
          .single();

        const checkoutData = {
          checkout: {
            test: testMode,
            transaction_type: 'tokenization',
            order: {
              amount: tokenizationAmountSafe,
              currency,
              description: 'Card tokenization for recurring payments',
            },
            settings: {
              return_url: returnUrl,
              cancel_url: cancelUrl,
              notification_url: `${supabaseUrl}/functions/v1/payment-methods-webhook`,
              language: 'ru',
            },
            customer: {
              email: user.email,
              first_name: profile?.first_name || '',
              last_name: profile?.last_name || '',
              phone: profile?.phone || '',
            },
            // Enable recurring payments - card will be stored for merchant-initiated charges
            additional_data: {
              contract: ['recurring'],
            },
          },
        };

        console.log('Creating tokenization checkout:', JSON.stringify(checkoutData));

        // bePaid auth: shop_id:secret_key
        const bepaidAuth = btoa(`${shopId}:${bepaidSecretKey}`);
        
        const response = await fetch('https://checkout.bepaid.by/ctp/api/checkouts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${bepaidAuth}`,
          },
          body: JSON.stringify(checkoutData),
        });

        const result = await response.json();
        console.log('bePaid tokenization response:', JSON.stringify(result));

        if (!response.ok || result.errors || result.response?.status === 'error') {
          console.error('bePaid error:', result);
          return new Response(JSON.stringify({ 
            error: 'Failed to create tokenization session',
            details: result.response?.message || result.errors || 'Unknown error'
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ 
          redirect_url: result.checkout?.redirect_url,
          token: result.checkout?.token,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error: unknown) {
    console.error('Error in payment-methods-tokenize:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});