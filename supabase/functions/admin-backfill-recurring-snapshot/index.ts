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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // RBAC check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin permission
    const { data: hasPermission } = await supabase.rpc('has_role', {
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

    // Get staff user IDs to exclude
    const { data: staffProfiles } = await supabase
      .from('profiles')
      .select('user_id, email')
      .in('email', STAFF_EMAILS.map(e => e.toLowerCase()));
    
    const staffUserIds = (staffProfiles || [])
      .filter(p => p.user_id)
      .map(p => p.user_id);

    // Find candidates: auto_renew=true, no recurring_snapshot, likely subscription
    // isLikelySubscription: tariff_id not null OR payment_method_id not null OR product_id is club
    const CLUB_PRODUCT_ID = '11c9f1b8-0355-4753-bd74-40b42aa53616';
    
    const { data: candidates, error: queryError } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, tariff_id, payment_method_id, product_id, meta')
      .eq('auto_renew', true)
      .is('meta->recurring_snapshot', null)
      .order('created_at', { ascending: true })
      .limit(max_total);

    if (queryError) {
      throw new Error(`Query error: ${queryError.message}`);
    }

    // Filter: isLikelySubscription guard + exclude staff
    const validCandidates = (candidates || []).filter(sub => {
      // Exclude staff
      if (staffUserIds.includes(sub.user_id)) {
        return false;
      }
      // isLikelySubscription guard
      const isLikelySubscription = 
        sub.tariff_id != null ||
        sub.payment_method_id != null ||
        sub.product_id === CLUB_PRODUCT_ID;
      
      return isLikelySubscription;
    });

    const totalCandidates = validCandidates.length;
    const toProcess = validCandidates.slice(0, batch_size);

    if (dry_run) {
      // DRY RUN: return stats and sample
      const sampleIds = toProcess.slice(0, 10).map(s => s.id);
      
      await supabase.from('audit_logs').insert({
        action: 'admin.backfill_recurring_snapshot',
        actor_type: 'admin',
        actor_user_id: user.id,
        actor_label: 'admin-backfill-recurring-snapshot',
        meta: {
          dry_run: true,
          total_candidates: totalCandidates,
          batch_size,
          sample_ids: sampleIds,
          staff_excluded: staffUserIds.length,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          dry_run: true,
          total_candidates: totalCandidates,
          batch_size,
          would_process: toProcess.length,
          sample_ids: sampleIds,
          staff_excluded: staffUserIds.length,
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
        const existingMeta = (sub.meta || {}) as Record<string, any>;
        
        const { error: updateError } = await supabase
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

    // Log execution result
    await supabase.from('audit_logs').insert({
      action: 'admin.backfill_recurring_snapshot',
      actor_type: 'admin',
      actor_user_id: user.id,
      actor_label: 'admin-backfill-recurring-snapshot',
      meta: {
        dry_run: false,
        total_candidates: totalCandidates,
        batch_size,
        updated: results.updated,
        failed: results.failed,
        updated_ids_sample: results.updated_ids.slice(0, 10),
        remaining: totalCandidates - toProcess.length,
        staff_excluded: staffUserIds.length,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: false,
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
