import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  subscription_ids: string[];
  dry_run: boolean;
  reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // RBAC check - STRICTLY require subscriptions.edit permission
    const { data: hasPermission } = await supabase.rpc('has_permission', { 
      _user_id: user.id, 
      _permission: 'subscriptions.edit' 
    });
    
    // Strict check: permission MUST be exactly true
    if (hasPermission !== true) {
      // Fallback: check for super_admin role
      const { data: isSuperAdmin } = await supabase.rpc('has_role', { 
        _user_id: user.id, 
        _role: 'super_admin' 
      });
      
      if (isSuperAdmin !== true) {
        return new Response(JSON.stringify({ 
          error: 'Forbidden: subscriptions.edit permission required' 
        }), { 
          status: 403, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }
    }

    const { subscription_ids, dry_run, reason }: RequestBody = await req.json();

    // Validation
    if (!subscription_ids || !Array.isArray(subscription_ids) || subscription_ids.length === 0) {
      return new Response(JSON.stringify({ error: 'subscription_ids array is required' }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Limit check (max 200)
    if (subscription_ids.length > 200) {
      return new Response(JSON.stringify({ 
        error: 'Limit exceeded: max 200 subscriptions per batch operation' 
      }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Fetch subscriptions with contact info for preview
    const { data: subscriptions, error: fetchError } = await supabase
      .from('subscriptions_v2')
      .select(`
        id, 
        user_id, 
        profile_id,
        status, 
        auto_renew,
        tariff_id,
        tariffs (
          name,
          products_v2 (name)
        )
      `)
      .in('id', subscription_ids)
      .eq('auto_renew', true);

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      throw new Error(`Failed to fetch subscriptions: ${fetchError.message}`);
    }

    // Get profile info separately
    const profileIds = [...new Set((subscriptions || []).map(s => s.profile_id).filter(Boolean))];
    let profilesMap = new Map();
    
    if (profileIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', profileIds);
      
      profilesMap = new Map((profiles || []).map(p => [p.id, p]));
    }

    const preview = (subscriptions || []).map(s => {
      const tariff = s.tariffs as unknown as { name?: string; products_v2?: { name?: string } };
      const product = tariff?.products_v2;
      const profile = profilesMap.get(s.profile_id) as { full_name?: string; email?: string } | undefined;
      
      return {
        id: s.id,
        contact: profile?.full_name || profile?.email || 'Unknown',
        email: profile?.email || null,
        product: product?.name || tariff?.name || 'Unknown',
        status: s.status,
        profile_id: s.profile_id,
      };
    });

    // Dry run: return preview only
    if (dry_run) {
      return new Response(JSON.stringify({ 
        dry_run: true,
        count: preview.length,
        subscriptions: preview.slice(0, 10), // First 10 for preview
        remaining: Math.max(0, preview.length - 10),
      }), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Execute: disable auto_renew
    const now = new Date().toISOString();
    const idsToUpdate = (subscriptions || []).map(s => s.id);
    
    if (idsToUpdate.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        count: 0,
        message: 'No subscriptions found with auto_renew enabled'
      }), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Simple update without jsonb merge (safer)
    const { error: updateError } = await supabase
      .from('subscriptions_v2')
      .update({ auto_renew: false })
      .in('id', idsToUpdate);
        
    if (updateError) {
      console.error('Update error:', updateError);
      throw new Error(`Failed to update subscriptions: ${updateError.message}`);
    }

    // Audit log
    const { error: auditError } = await supabase.from('audit_logs').insert({
      action: 'subscription.batch_disable_auto_renew',
      actor_type: 'admin',
      actor_user_id: user.id,
      meta: {
        subscription_ids: idsToUpdate,
        count: idsToUpdate.length,
        reason: reason || 'admin_batch_action',
        affected_profiles: preview.map(p => ({
          profile_id: p.profile_id,
          contact: p.contact,
          product: p.product,
        })),
      },
    });

    if (auditError) {
      console.error('Audit log error:', auditError);
      // Don't fail the request if audit logging fails
    }

    // Log event for each affected contact (for Communications tab visibility)
    for (const sub of subscriptions || []) {
      if (sub.profile_id) {
        try {
          await supabase.from('telegram_logs').insert({
            action: 'ADMIN_DISABLED_AUTO_RENEW',
            event_type: 'admin_disabled_auto_renew',
            user_id: sub.user_id,
            status: 'success',
            message_text: null,
            meta: {
              subscription_id: sub.id,
              profile_id: sub.profile_id,
              disabled_by: user.id,
              reason: reason || 'admin_batch_action',
              source: 'admin-batch-disable-auto-renew',
            },
          });
        } catch (logErr) {
          console.error('Event log error:', logErr);
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      count: idsToUpdate.length,
      message: `Автопродление отключено для ${idsToUpdate.length} подписок`,
      subscription_ids: idsToUpdate,
    }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (error: unknown) {
    console.error('Error in admin-batch-disable-auto-renew:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
