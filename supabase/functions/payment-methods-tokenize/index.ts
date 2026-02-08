import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from "../_shared/bepaid-credentials.ts";

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

    // PATCH-D: Get bePaid credentials STRICTLY from integration_instances (NO env fallback)
    const credsResult = await getBepaidCredsStrict(supabase);
    
    if (isBepaidCredsError(credsResult)) {
      console.error('[tokenize] bePaid credentials error:', credsResult.error);
      return new Response(JSON.stringify({ error: credsResult.error }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const bepaidCreds = credsResult;
    console.log('[tokenize] Using bePaid credentials from:', bepaidCreds.creds_source);

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
        // PATCH-A: Use STRICT credentials from integration_instances only
        // Currency from payment_settings (non-sensitive)
        const { data: settings } = await supabase
          .from('payment_settings')
          .select('key, value')
          .in('key', ['bepaid_currency']);

        const settingsMap: Record<string, string> = settings?.reduce(
          (acc: Record<string, string>, s: { key: string; value: string }) => ({
            ...acc,
            [s.key]: s.value,
          }),
          {}
        ) || {};

        const currency = settingsMap['bepaid_currency'] || 'BYN';

        // PATCH-A CRITICAL: Tokenization amount FIXED at 0 (or 100 = 1 BYN if 0 not allowed)
        // User CANNOT modify amount - readonly mode enforced
        const tokenizationAmount = 0; // 0 BYN for pure tokenization

        // Create bePaid tokenization checkout
        const returnUrl = `${req.headers.get('origin') || 'https://gorbova.club'}/settings/payment-methods?tokenize=success`;
        const cancelUrl = `${req.headers.get('origin') || 'https://gorbova.club'}/settings/payment-methods?tokenize=cancel`;

        // Get user profile for customer info
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, first_name, last_name, phone')
          .eq('user_id', user.id)
          .single();

        // PATCH-A: Tokenization checkout payload
        // - ONLY card payment methods allowed (ERIP/банки исключены)
        // - amount = 0 (read-only, пользователь не может изменить)
        // - readonly: true для суммы
        const checkoutData = {
          checkout: {
            test: bepaidCreds.test_mode,
            transaction_type: 'tokenization',
            // PATCH-A: Restrict to card-only methods (NO ERIP)
            payment_method: {
              types: ['credit_card'],
              // Explicitly exclude ERIP and bank transfers
              excluded_types: ['erip', 'belarusbank', 'mtbank', 'bank_transfer'],
            },
            order: {
              amount: tokenizationAmount,
              currency,
              description: 'Привязка карты для автоплатежей. Сумма списания — проверка карты.',
              // PATCH-A: read-only amount (user cannot edit)
              readonly: true,
            },
            settings: {
              return_url: returnUrl,
              cancel_url: cancelUrl,
              notification_url: `${supabaseUrl}/functions/v1/payment-methods-webhook`,
              language: 'ru',
              // PATCH-A: Additional settings to prevent amount modification
              button_text: 'Привязать карту',
              button_next_text: 'Далее',
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

        console.log('[tokenize] Creating tokenization checkout (card-only, amount=0, readonly):', JSON.stringify(checkoutData));

        // PATCH-D: Use strict credentials helper
        const bepaidAuth = createBepaidAuthHeader(bepaidCreds);
        
        const response = await fetch('https://checkout.bepaid.by/ctp/api/checkouts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': bepaidAuth,
          },
          body: JSON.stringify(checkoutData),
        });

        const result = await response.json();
        console.log('[tokenize] bePaid response:', JSON.stringify(result));

        if (!response.ok || result.errors || result.response?.status === 'error') {
          console.error('[tokenize] bePaid error:', result);
          return new Response(JSON.stringify({ 
            error: 'Failed to create tokenization session',
            details: result.response?.message || result.errors || 'Unknown error'
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Audit log for tokenization session creation
        await supabase.from('audit_logs').insert({
          actor_type: 'user',
          actor_user_id: user.id,
          action: 'payment_method.tokenization_checkout_created',
          meta: {
            checkout_token: result.checkout?.token,
            amount: tokenizationAmount,
            currency,
            payment_methods_allowed: ['credit_card'],
            payment_methods_excluded: ['erip', 'belarusbank', 'mtbank', 'bank_transfer'],
            creds_source: bepaidCreds.creds_source,
          },
        });

        return new Response(JSON.stringify({ 
          redirect_url: result.checkout?.redirect_url,
          token: result.checkout?.token,
          creds_source: bepaidCreds.creds_source, // PATCH-D: expose for verification
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