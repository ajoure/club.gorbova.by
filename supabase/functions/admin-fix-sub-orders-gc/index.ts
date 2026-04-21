 import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
 
 const corsHeaders = {
   'Access-Control-Allow-Origin': '*',
   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
 };
 
 // Generate a consistent deal_number from orderNumber for GetCourse updates
 function generateDealNumber(orderNumber: string): number {
   let hash = 0;
   for (let i = 0; i < orderNumber.length; i++) {
     const char = orderNumber.charCodeAt(i);
     hash = ((hash << 5) - hash) + char;
     hash = hash & hash;
   }
   return Math.abs(hash);
 }
 
 interface GetCourseUserData {
   email: string;
   phone?: string | null;
   firstName?: string | null;
   lastName?: string | null;
 }
 
 async function sendToGetCourse(
   userData: GetCourseUserData,
   offerId: number,
   orderNumber: string,
   amount: number,
   tariffCode: string
 ): Promise<{ success: boolean; error?: string; gcOrderId?: string; gcDealNumber?: number }> {
   const apiKey = Deno.env.get('GETCOURSE_API_KEY');
   const accountName = 'gorbova';
   
   if (!apiKey) {
     return { success: false, error: 'API key not configured' };
   }
   
   if (!offerId) {
     return { success: false, error: `No GetCourse offer ID for tariff: ${tariffCode}` };
   }
   
   try {
     const dealNumber = generateDealNumber(orderNumber);
     
     const params = {
       user: {
         email: userData.email,
         phone: userData.phone || undefined,
         first_name: userData.firstName || undefined,
         last_name: userData.lastName || undefined,
       },
       system: {
         refresh_if_exists: 1,
       },
       deal: {
         deal_number: dealNumber,
         offer_code: offerId.toString(),
         deal_cost: amount,
         deal_status: 'payed',
         deal_is_paid: 1,
         payment_type: 'CARD',
         manager_email: 'info@ajoure.by',
         deal_comment: `Оплата через сайт club.gorbova.by. Order: ${orderNumber}`,
       },
     };
     
     console.log(`[GC-FIX] Sending ${orderNumber} to GetCourse: offer=${offerId}, email=${userData.email}`);
     
     const formData = new URLSearchParams();
     formData.append('action', 'add');
     formData.append('key', apiKey);
     formData.append('params', btoa(unescape(encodeURIComponent(JSON.stringify(params)))));
     
     const response = await fetch(`https://${accountName}.getcourse.ru/pl/api/deals`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
       body: formData.toString(),
     });
     
     const responseText = await response.text();
     let data;
     try {
       data = JSON.parse(responseText);
     } catch {
       return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
     }
     
     if (data.result?.success === true) {
       console.log(`[GC-FIX] Success: ${orderNumber} -> deal_id=${data.result?.deal_id}`);
       return { success: true, gcOrderId: data.result?.deal_id?.toString(), gcDealNumber: dealNumber };
     } else {
       const errorMsg = data.result?.error_message || data.error_message || 'Unknown error';
       console.error(`[GC-FIX] Error for ${orderNumber}: ${errorMsg}`);
       return { success: false, error: errorMsg };
     }
   } catch (error: unknown) {
     const errorMsg = error instanceof Error ? error.message : String(error);
     return { success: false, error: errorMsg };
   }
 }
 
 Deno.serve(async (req) => {
   if (req.method === 'OPTIONS') {
     return new Response(null, { headers: corsHeaders });
   }
 
   try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
 
    const body = await req.json().catch(() => ({}));
    
    // Allow one-time sync with secret key in body (for manual fixes)
    const secretKeyFromBody = body.admin_key;
    const isSecretKeyAuth = secretKeyFromBody === Deno.env.get('CRON_SECRET');

    // SECURITY: Require service role, CRON_SECRET, or admin JWT. No hardcoded bypass.
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '') || '';
    const isServiceRole = token === supabaseServiceKey;

    if (isServiceRole || isSecretKeyAuth) {
      console.log('[GC-FIX] Internal/service call authorized');
    } else if (authHeader?.startsWith('Bearer ')) {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Check user_roles table for admin access
        const { data: userRole } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle();

        if (!['admin', 'superadmin'].includes(userRole?.role || '')) {
          return new Response(JSON.stringify({ error: 'Forbidden: admin required' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        console.log('[GC-FIX] Admin authorized:', user.email);
    } else {
      // No auth — reject. Removed the previous "allow for testing" bypass.
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
 
     const dryRun = body.dry_run !== false; // Default to dry run for safety
     const limit = body.limit || 50;
 
     // Find SUB- orders that are paid but not synced to GetCourse
     const { data: orders, error: ordersError } = await supabase
       .from('orders_v2')
       .select(`
         id,
         order_number,
         status,
         user_id,
         tariff_id,
         final_price,
         meta,
         tariffs!inner(id, name, code, getcourse_offer_id),
         profiles!orders_v2_user_id_fkey(id, email, full_name, phone, first_name, last_name)
       `)
       .like('order_number', 'SUB-%')
       .eq('status', 'paid')
       .or('meta->gc_sync_status.is.null,meta->>gc_sync_status.eq.')
       .limit(limit);
 
     if (ordersError) {
       console.error('[GC-FIX] Query error:', ordersError);
       return new Response(JSON.stringify({ error: ordersError.message }), {
         status: 500,
         headers: { ...corsHeaders, 'Content-Type': 'application/json' },
       });
     }
 
     console.log(`[GC-FIX] Found ${orders?.length || 0} orders to sync (dry_run=${dryRun})`);
 
     const results: Array<{ order_number: string; success: boolean; error?: string; gc_deal_id?: string }> = [];
 
     for (const order of orders || []) {
       const tariff = order.tariffs as any;
       const profile = order.profiles as any;
       const offerId = tariff?.getcourse_offer_id;
 
       if (!offerId) {
         results.push({ order_number: order.order_number, success: false, error: 'No getcourse_offer_id' });
         continue;
       }
 
       if (!profile?.email) {
         results.push({ order_number: order.order_number, success: false, error: 'No email' });
         continue;
       }
 
       if (dryRun) {
         results.push({ order_number: order.order_number, success: true, error: 'DRY_RUN' });
         continue;
       }
 
       // Parse name
       let firstName = profile.first_name;
       let lastName = profile.last_name;
       if (!firstName && profile.full_name) {
         const parts = profile.full_name.split(' ');
         firstName = parts[0];
         lastName = parts.slice(1).join(' ');
       }
 
       const gcResult = await sendToGetCourse(
         {
           email: profile.email,
           phone: profile.phone || null,
           firstName: firstName || null,
           lastName: lastName || null,
         },
         parseInt(String(offerId), 10) || 0,
         order.order_number,
         order.final_price || 0,
         tariff?.code || tariff?.name || 'subscription'
       );
 
       // Update order meta
       await supabase.from('orders_v2').update({
         meta: {
           ...(order.meta || {}),
           gc_sync_status: gcResult.success ? 'success' : 'failed',
           gc_sync_error: gcResult.error || null,
           gc_order_id: gcResult.gcOrderId || null,
           gc_deal_number: gcResult.gcDealNumber || null,
           gc_synced_at: new Date().toISOString(),
         }
       }).eq('id', order.id);
 
       // Audit log
       await supabase.from('audit_logs').insert({
         actor_type: 'system',
         actor_user_id: null,
         actor_label: 'admin-fix-sub-orders-gc',
         action: gcResult.success ? 'gc_sync_success' : 'gc_sync_failed',
         target_user_id: order.user_id,
         meta: {
           order_id: order.id,
           order_number: order.order_number,
           gc_offer_id: offerId,
           gc_order_id: gcResult.gcOrderId,
           error: gcResult.error,
         },
       });
 
       results.push({
         order_number: order.order_number,
         success: gcResult.success,
         error: gcResult.error,
         gc_deal_id: gcResult.gcOrderId,
       });
     }
 
     const summary = {
       total: results.length,
       success: results.filter(r => r.success && r.error !== 'DRY_RUN').length,
       failed: results.filter(r => !r.success).length,
       dry_run_count: results.filter(r => r.error === 'DRY_RUN').length,
       dry_run: dryRun,
     };
 
     console.log('[GC-FIX] Summary:', summary);
 
     return new Response(JSON.stringify({ summary, results }), {
       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
     });
 
   } catch (error) {
     console.error('[GC-FIX] Error:', error);
     return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
       status: 500,
       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
     });
   }
 });