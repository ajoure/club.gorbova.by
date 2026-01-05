import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simulate payment completion for testing purposes
// Only accessible by super admins

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller is super admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is super admin
    const { data: roles } = await supabase
      .from('user_roles_v2')
      .select('roles(code)')
      .eq('user_id', user.id);

    const isSuperAdmin = roles?.some((r: any) => 
      r.roles?.code === 'super_admin' || r.roles?.code === 'superadmin'
    );

    if (!isSuperAdmin) {
      return new Response(
        JSON.stringify({ error: 'Only super admins can use this feature' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { orderId } = await req.json();
    if (!orderId) {
      return new Response(
        JSON.stringify({ error: 'orderId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Test Payment] Super admin ${user.email} simulating payment for order ${orderId}`);

    // Get the order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, products(*)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update order status to paid (note: 'orders' table uses 'completed', not enum)
    await supabase
      .from('orders')
      .update({
        status: 'completed', // Legacy 'orders' table uses 'completed'
        bepaid_uid: `TEST-${Date.now()}`,
        payment_method: 'test_payment',
        meta: {
          ...order.meta,
          test_payment: true,
          test_payment_by: user.email,
          test_payment_at: new Date().toISOString(),
        },
      })
      .eq('id', orderId);

    const product = order.products;
    const meta = order.meta as Record<string, any> || {};
    const results: Record<string, any> = {
      order_updated: true,
    };

    // Grant entitlement if product exists
    if (product && order.user_id) {
      let expiresAt = null;
      if (product.duration_days) {
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + product.duration_days);
      }

      const { error: entitlementError } = await supabase
        .from('entitlements')
        .upsert({
          user_id: order.user_id,
          product_code: product.product_type === 'subscription' ? (product.tier || 'pro') : product.id,
          status: 'active',
          expires_at: expiresAt?.toISOString() || null,
          meta: {
            order_id: orderId,
            product_name: product.name,
            test_payment: true,
          },
        }, {
          onConflict: 'user_id,product_code',
        });

      results.entitlement_created = !entitlementError;
      if (entitlementError) {
        results.entitlement_error = entitlementError.message;
      }

      // Update subscription if applicable
      if (product.product_type === 'subscription' && product.tier) {
        await supabase
          .from('subscriptions')
          .update({
            tier: product.tier,
            is_active: true,
            starts_at: new Date().toISOString(),
            expires_at: expiresAt?.toISOString() || null,
          })
          .eq('user_id', order.user_id);

        results.subscription_updated = true;
      }

      // Grant Telegram access
      const { data: mappings } = await supabase
        .from('product_club_mappings')
        .select('*, telegram_clubs(id, club_name)')
        .eq('product_id', product.id)
        .eq('is_active', true);

      if (mappings && mappings.length > 0) {
        for (const mapping of mappings) {
          const durationDays = mapping.duration_days || product.duration_days || 30;
          
          const telegramGrantResult = await supabase.functions.invoke('telegram-grant-access', {
            body: { 
              user_id: order.user_id,
              club_ids: [mapping.club_id],
              duration_days: durationDays
            },
          });
          
          if (telegramGrantResult.error) {
            console.error('Failed to grant Telegram access:', telegramGrantResult.error);
          }
        }
        results.telegram_access_granted = mappings.length;
      }

      // Send to GetCourse
      const tariffCode = meta.tariff_code as string | undefined;
      if (tariffCode && order.customer_email) {
        const GETCOURSE_OFFER_IDS: Record<string, number> = {
          'chat': 6744625,
          'full': 6744626,
          'business': 6744628,
        };
        
        const apiKey = Deno.env.get('GETCOURSE_API_KEY');
        const offerId = GETCOURSE_OFFER_IDS[tariffCode];
        
        if (apiKey && offerId) {
          const customerFirstName = meta.customer_first_name as string || '';
          const customerLastName = meta.customer_last_name as string || '';
          const params = {
            user: {
              email: order.customer_email,
              phone: meta.customer_phone || undefined,
              first_name: customerFirstName || undefined,
              last_name: customerLastName || undefined,
            },
            system: {
              refresh_if_exists: 1,
            },
            deal: {
              offer_code: offerId.toString(),
              deal_number: Date.now(),
              deal_cost: order.amount / 100,
              deal_status: 'payed',
              deal_is_paid: 1,
              payment_type: 'CARD',
              manager_email: 'info@ajoure.by',
              deal_comment: `ТЕСТ: Оплата через сайт club.gorbova.by. Order ID: ${orderId}`,
            },
          };
          
          const formData = new URLSearchParams();
          formData.append('action', 'add');
          formData.append('key', apiKey);
          formData.append('params', btoa(unescape(encodeURIComponent(JSON.stringify(params)))));
          
          try {
            const response = await fetch(`https://gorbova.getcourse.ru/pl/api/deals`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: formData.toString(),
            });
            
            const responseText = await response.text();
            console.log('GetCourse test response:', responseText);
            
            const data = JSON.parse(responseText);
            results.getcourse_sync = data.success || data.result?.success ? 'success' : 'failed';
            if (data.result?.deal_id) {
              results.getcourse_deal_id = data.result.deal_id;
            }
          } catch (gcError) {
            console.error('GetCourse error:', gcError);
            results.getcourse_sync = 'error';
          }
        } else {
          results.getcourse_sync = 'skipped (no API key or unknown tariff)';
        }
      }
    }

    // Log the test action
    await supabase
      .from('audit_logs')
      .insert({
        action: 'test_payment_complete',
        actor_user_id: user.id,
        target_user_id: order.user_id,
        meta: {
          order_id: orderId,
          results,
        },
      });

    console.log(`[Test Payment] Completed for order ${orderId}:`, results);

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Test payment error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
