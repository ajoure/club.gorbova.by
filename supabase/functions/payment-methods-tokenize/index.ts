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
    const bepaidSecretKey = Deno.env.get('BEPAID_SECRET_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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
            test: true, // Set to false for production
            transaction_type: 'tokenization',
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
          },
        };

        console.log('Creating tokenization checkout:', JSON.stringify(checkoutData));

        const response = await fetch('https://checkout.bepaid.by/ctp/api/checkouts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + btoa(`${bepaidSecretKey}:`),
          },
          body: JSON.stringify(checkoutData),
        });

        const result = await response.json();
        console.log('bePaid tokenization response:', JSON.stringify(result));

        if (!response.ok || result.errors) {
          console.error('bePaid error:', result);
          return new Response(JSON.stringify({ error: 'Failed to create tokenization session' }), {
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