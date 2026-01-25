import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_RECURRING_SNAPSHOT = {
  is_recurring: true,
  timezone: 'Europe/Minsk',
  billing_period_mode: 'month',
  grace_hours: 72,
  charge_attempts_per_day: 2,
  charge_times_local: ['09:00', '21:00'],
  pre_due_reminders_days: [7, 3, 1],
  notify_before_each_charge: true,
  notify_grace_events: true,
};

// PATCH: Staff emails - NEVER modify subscriptions for these users
const STAFF_EMAILS = [
  'a.bruylo@ajoure.by',
  'nrokhmistrov@gmail.com',
  'ceo@ajoure.by',
  'irenessa@yandex.ru',
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // RBAC check - use anon key client with user's auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PATCH: Dual-client RBAC
    // supabaseUser - for auth validation and role checks (uses anon key + bearer)
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    
    // supabaseAdmin - for data operations (service role)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin permission via user client
    const { data: hasPermission } = await supabaseUser.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });

    if (!hasPermission) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { 
      dry_run = true, 
      batch_size = 50, 
      max_total = 500 
    } = await req.json();

    const now = new Date();

    // Get staff user IDs to exclude (via admin client)
    const { data: staffProfiles } = await supabaseAdmin
      .from('profiles')
      .select('user_id, email')
      .in('email', STAFF_EMAILS.map(e => e.toLowerCase()));
    
    const staffUserIds = (staffProfiles || [])
      .filter(p => p.user_id)
      .map(p => p.user_id);

    // PATCH: Removed unstable JSON filter `.is('meta->recurring_snapshot', null)`
    // Select broader set and filter in JS for reliability
    const CLUB_PRODUCT_ID = '11c9f1b8-0355-4753-bd74-40b42aa53616';
    
    const { data: allCandidates, error: queryError } = await supabaseAdmin
      .from('subscriptions_v2')
      .select('id, user_id, tariff_id, payment_method_id, product_id, meta')
      .eq('auto_renew', true)
      .order('created_at', { ascending: true })
      .limit(max_total * 2);  // Extra buffer for JS filtering

    if (queryError) {
      throw new Error(`Query error: ${queryError.message}`);
    }

    // PATCH: Track how many rows were fetched before JS filtering
    const fetchedCount = (allCandidates || []).length;

    // PATCH: Filter in JS - more reliable than JSON path filters
    // 1) Missing recurring_snapshot
    // 2) isLikelySubscription guard
    // 3) Exclude staff
    const validCandidates = (allCandidates || []).filter(sub => {
      // Check if snapshot already exists
      const hasSnapshot = (sub.meta as Record<string, unknown>)?.recurring_snapshot != null;
      if (hasSnapshot) return false;  // Already has snapshot, skip
      
      // Exclude staff
      if (staffUserIds.includes(sub.user_id)) return false;
      
      // isLikelySubscription guard
      const isLikelySubscription = 
        sub.tariff_id != null ||
        sub.payment_method_id != null ||
        sub.product_id === CLUB_PRODUCT_ID;
      
      return isLikelySubscription;
    });

    const totalCandidates = validCandidates.length;
    const toProcess = validCandidates.slice(0, batch_size);

    // PATCH: Track if anomaly was logged
    const anomalyLogged = totalCandidates > max_total;

    // PATCH: Anomaly detection - log if candidates exceed max_total
    if (anomalyLogged) {
      await supabaseAdmin.from('audit_logs').insert({
        action: 'admin.backfill_recurring_snapshot_anomaly',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'admin-backfill-recurring-snapshot',
        meta: {
          reason: 'candidates_exceeded_max_total',
          fetched_count: fetchedCount,
          total_candidates: totalCandidates,
          max_total,
          batch_size,
          requested_by_user_id: user.id,
        },
      });
    }

    if (dry_run) {
      // DRY RUN: return stats and sample
      const sampleIds = toProcess.slice(0, 10).map(s => s.id);
      
      // PATCH: SYSTEM ACTOR Proof - actor_type='system', actor_user_id=null
      await supabaseAdmin.from('audit_logs').insert({
        action: 'admin.backfill_recurring_snapshot',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'admin-backfill-recurring-snapshot',
        meta: {
          dry_run: true,
          fetched_count: fetchedCount,
          total_candidates: totalCandidates,
          batch_size,
          sample_ids: sampleIds,
          staff_excluded: staffUserIds.length,
          requested_by_user_id: user.id,
          remaining: totalCandidates - toProcess.length,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          dry_run: true,
          fetched_count: fetchedCount,
          total_candidates: totalCandidates,
          batch_size,
          would_process: toProcess.length,
          sample_ids: sampleIds,
          staff_excluded: staffUserIds.length,
          anomaly_logged: anomalyLogged,
          remaining: totalCandidates - toProcess.length,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // EXECUTE: update batch
    const results = {
      updated: 0,
      failed: 0,
      updated_ids: [] as string[],
      errors: [] as string[],
    };

    for (const sub of toProcess) {
      try {
        const existingMeta = (sub.meta || {}) as Record<string, unknown>;
        
        const { error: updateError } = await supabaseAdmin
          .from('subscriptions_v2')
          .update({
            meta: {
              ...existingMeta,
              recurring_snapshot: DEFAULT_RECURRING_SNAPSHOT,
              _snapshot_backfilled_at: now.toISOString(),
              _snapshot_backfilled_by: 'admin-backfill-recurring-snapshot',
            },
            updated_at: now.toISOString(),
          })
          .eq('id', sub.id);

        if (updateError) {
          results.failed++;
          results.errors.push(`${sub.id}: ${updateError.message}`);
        } else {
          results.updated++;
          results.updated_ids.push(sub.id);
        }
      } catch (err) {
        results.failed++;
        results.errors.push(`${sub.id}: ${String(err)}`);
      }
    }

    // PATCH: SYSTEM ACTOR Proof - actor_type='system', actor_user_id=null
    await supabaseAdmin.from('audit_logs').insert({
      action: 'admin.backfill_recurring_snapshot',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'admin-backfill-recurring-snapshot',
      meta: {
        dry_run: false,
        fetched_count: fetchedCount,
        total_candidates: totalCandidates,
        batch_size,
        updated: results.updated,
        failed: results.failed,
        updated_ids_sample: results.updated_ids.slice(0, 10),
        remaining: totalCandidates - toProcess.length,
        staff_excluded: staffUserIds.length,
        requested_by_user_id: user.id,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: false,
        fetched_count: fetchedCount,
        total_candidates: totalCandidates,
        ...results,
        remaining: totalCandidates - toProcess.length,
        staff_excluded: staffUserIds.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Backfill error:", error);
    return new Response(
      JSON.stringify({ error: "Internal error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
