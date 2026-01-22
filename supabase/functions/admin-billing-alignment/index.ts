import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * PATCH 13A: Admin tool to align billing dates (next_charge_at = access_end_at)
 * 
 * Problem: next_charge_at < access_end_at causes early charge attempts → false revokes
 * Solution: Align next_charge_at to access_end_at for active subscriptions
 * 
 * Modes:
 * - dry_run (default): показывает статистику + sample list
 * - execute: UPDATE next_charge_at = access_end_at (batch <= 200)
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization') ?? '';
    
    // Admin check
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: isSuperAdmin } = await userClient.rpc('is_super_admin', { _user_id: user.id });
    const { data: userRole } = await userClient.rpc('get_user_role', { _user_id: user.id });
    
    const isAdmin = !!isSuperAdmin || userRole === 'admin' || userRole === 'superadmin';
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { mode = 'dry_run', batch_size = 200 } = body;

    console.log(`[admin-billing-alignment] mode=${mode}, batch_size=${batch_size}`);

    // =================================================================
    // Find misaligned subscriptions via RPC
    // =================================================================
    interface MisalignedSubscription {
      id: string;
      user_id: string;
      profile_id: string;
      status: string;
      next_charge_at: string;
      access_end_at: string;
      days_difference: number;
      full_name: string | null;
      email: string | null;
    }

    const { data: misaligned, error: rpcError } = await supabase.rpc(
      'find_misaligned_subscriptions',
      { p_limit: Math.min(batch_size, 500) }
    );

    if (rpcError) {
      throw new Error(`RPC error: ${rpcError.message}`);
    }

    const subscriptions = (misaligned || []) as MisalignedSubscription[];
    console.log(`[admin-billing-alignment] Found ${subscriptions.length} misaligned subscriptions`);

    // =================================================================
    // DRY RUN - just return the report
    // =================================================================
    if (mode === 'dry_run') {
      // Statistics
      const totalDaysDiff = subscriptions.reduce((sum, s) => sum + (s.days_difference || 0), 0);
      const avgDaysDiff = subscriptions.length > 0 ? totalDaysDiff / subscriptions.length : 0;
      const maxDaysDiff = subscriptions.length > 0 
        ? Math.max(...subscriptions.map(s => s.days_difference || 0)) 
        : 0;

      // Log the dry run
      await supabase.from('audit_logs').insert({
        action: 'billing.alignment_dry_run',
        actor_type: 'user',
        actor_user_id: user.id,
        actor_label: 'admin-billing-alignment',
        meta: {
          found_count: subscriptions.length,
          avg_days_difference: Math.round(avgDaysDiff * 10) / 10,
          max_days_difference: maxDaysDiff,
          sample_ids: subscriptions.slice(0, 10).map(s => s.id),
        }
      });

      return new Response(JSON.stringify({
        mode: 'dry_run',
        summary: {
          total_misaligned: subscriptions.length,
          avg_days_difference: Math.round(avgDaysDiff * 10) / 10,
          max_days_difference: maxDaysDiff,
          batch_size,
        },
        subscriptions: subscriptions.slice(0, 100).map(s => ({
          id: s.id,
          full_name: s.full_name,
          email: s.email,
          status: s.status,
          next_charge_at: s.next_charge_at,
          access_end_at: s.access_end_at,
          days_difference: s.days_difference,
        })),
        execute_info: {
          will_update: Math.min(subscriptions.length, batch_size),
          remaining: Math.max(0, subscriptions.length - batch_size),
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =================================================================
    // EXECUTE - align billing dates
    // =================================================================
    if (mode === 'execute') {
      // STOP-предохранитель
      if (subscriptions.length > 500) {
        return new Response(JSON.stringify({
          error: 'Too many affected subscriptions. Process in batches.',
          affected_count: subscriptions.length,
          max_allowed: 500,
          suggestion: 'Use batch_size=200 and run multiple times',
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Execute via RPC
      const { data: alignResult, error: alignError } = await supabase.rpc(
        'align_billing_dates',
        { p_batch_size: Math.min(batch_size, 200) }
      );

      if (alignError) {
        throw new Error(`Alignment error: ${alignError.message}`);
      }

      const result = alignResult?.[0] || { updated_count: 0, sample_ids: [] };

      // Log with SYSTEM ACTOR proof
      await supabase.from('audit_logs').insert({
        action: 'billing.charge_date_aligned',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'admin-billing-alignment',
        meta: {
          initiated_by: user.id,
          batch_size,
          total_found: subscriptions.length,
          updated_count: result.updated_count,
          sample_ids: result.sample_ids,
          remaining: Math.max(0, subscriptions.length - result.updated_count),
        }
      });

      return new Response(JSON.stringify({
        mode: 'execute',
        summary: {
          total_found: subscriptions.length,
          updated: result.updated_count,
          remaining: Math.max(0, subscriptions.length - result.updated_count),
        },
        sample_ids: result.sample_ids,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid mode. Use dry_run or execute' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('admin-billing-alignment error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
