// PATCH-0: Fix UID Contract for payments_v2
// Contract: payments_v2.provider_payment_id = strictly bePaid transaction.uid for provider='bepaid'
// BUILD_ID: fix-uid-contract-2026-02-02-v1

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUILD_ID = "fix-uid-contract-2026-02-02-v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FixRequest {
  dry_run?: boolean;
  limit?: number;
  batch_size?: number;
}

interface FixResult {
  build_id: string;
  dry_run: boolean;
  total_scanned: number;
  fixed_from_provider_response: number;
  fixed_from_statement: number;
  already_correct: number;
  needs_manual_fix: number;
  errors: number;
  error_samples: Array<{ id: string; error: string }>;
  found_uid_rate: number;
  stopped_reason: string | null;
  fixed_samples: Array<{ id: string; old_uid: string | null; new_uid: string; source: string }>;
}

serve(async (req) => {
  console.log(`[UID-Contract] START build=${BUILD_ID}`);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth check
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header", build_id: BUILD_ID }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token", build_id: BUILD_ID }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from("user_roles_v2")
      .select("role_name")
      .eq("user_id", user.id);

    const isAdmin = roleData?.some((r: any) => 
      ["admin", "superadmin", "owner"].includes(r.role_name)
    );

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Admin access required", build_id: BUILD_ID }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({})) as FixRequest;
    const dryRun = body.dry_run !== false; // Default true
    const limit = Math.min(body.limit || 5000, 10000);
    const batchSize = Math.min(body.batch_size || 100, 500);

    console.log(`[UID-Contract] dry_run=${dryRun}, limit=${limit}, batch_size=${batchSize}`);

    const result: FixResult = {
      build_id: BUILD_ID,
      dry_run: dryRun,
      total_scanned: 0,
      fixed_from_provider_response: 0,
      fixed_from_statement: 0,
      already_correct: 0,
      needs_manual_fix: 0,
      errors: 0,
      error_samples: [],
      found_uid_rate: 0,
      stopped_reason: null,
      fixed_samples: [],
    };

    // PHASE 1: Get all bepaid payments
    const { data: payments, error: fetchErr } = await supabase
      .from("payments_v2")
      .select("id, provider_payment_id, provider_response, tracking_id, meta, amount, paid_at")
      .eq("provider", "bepaid")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (fetchErr) {
      throw new Error(`Failed to fetch payments: ${fetchErr.message}`);
    }

    if (!payments || payments.length === 0) {
      result.stopped_reason = "No payments found";
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PHASE 2: Build statement UID map (by tracking_id ONLY - exact match)
    const { data: statementRows } = await supabase
      .from("bepaid_statement_rows")
      .select("uid, tracking_id")
      .not("uid", "is", null)
      .not("tracking_id", "is", null);

    // Map: tracking_id -> uid (only if unique)
    const trackingToUidMap = new Map<string, string>();
    const trackingCollisions = new Set<string>();
    
    for (const row of statementRows || []) {
      const tid = row.tracking_id;
      if (!tid) continue;
      
      if (trackingToUidMap.has(tid)) {
        // Collision - mark as unusable
        trackingCollisions.add(tid);
      } else {
        trackingToUidMap.set(tid, row.uid);
      }
    }
    
    // Remove collisions from map (cannot use ambiguous tracking_id)
    for (const tid of trackingCollisions) {
      trackingToUidMap.delete(tid);
    }

    console.log(`[UID-Contract] Statement map: ${trackingToUidMap.size} unique tracking_ids, ${trackingCollisions.size} collisions`);

    // PHASE 3: Process payments
    const toUpdate: Array<{ id: string; newUid: string; oldUid: string | null; source: string; meta: any }> = [];

    for (const p of payments) {
      result.total_scanned++;

      const currentUid = p.provider_payment_id;
      const providerResponse = p.provider_response as any;
      const trackingId = p.tracking_id;
      const currentMeta = (p.meta || {}) as any;

      // Source 1: provider_response.uid (highest priority)
      const prUid = providerResponse?.uid || 
                    providerResponse?.transaction?.uid ||
                    providerResponse?.data?.uid;

      if (prUid) {
        if (currentUid === prUid) {
          result.already_correct++;
          continue;
        }
        // Fix from provider_response
        toUpdate.push({
          id: p.id,
          newUid: prUid,
          oldUid: currentUid,
          source: "provider_response",
          meta: {
            ...currentMeta,
            legacy_provider_payment_id: currentUid,
            uid_fixed_at: new Date().toISOString(),
            uid_fixed_source: "provider_response",
          },
        });
        result.fixed_from_provider_response++;
        continue;
      }

      // Source 2: bepaid_statement_rows.uid via tracking_id (exact match, unique only)
      if (trackingId && trackingToUidMap.has(trackingId)) {
        const stmtUid = trackingToUidMap.get(trackingId)!;
        if (currentUid === stmtUid) {
          result.already_correct++;
          continue;
        }
        toUpdate.push({
          id: p.id,
          newUid: stmtUid,
          oldUid: currentUid,
          source: "statement_tracking_id",
          meta: {
            ...currentMeta,
            legacy_provider_payment_id: currentUid,
            uid_fixed_at: new Date().toISOString(),
            uid_fixed_source: "statement_tracking_id",
            matched_tracking_id: trackingId,
          },
        });
        result.fixed_from_statement++;
        continue;
      }

      // No UID source found - mark for manual review
      result.needs_manual_fix++;
      
      // Only update meta if not already marked
      if (!currentMeta.needs_manual_uid_fix) {
        toUpdate.push({
          id: p.id,
          newUid: currentUid, // Keep as-is
          oldUid: currentUid,
          source: "needs_manual",
          meta: {
            ...currentMeta,
            needs_manual_uid_fix: true,
            uid_check_at: new Date().toISOString(),
          },
        });
      }
    }

    // Calculate found rate
    const totalProcessed = result.fixed_from_provider_response + result.fixed_from_statement + result.already_correct;
    result.found_uid_rate = result.total_scanned > 0 
      ? totalProcessed / result.total_scanned 
      : 0;

    // STOP guard: if found_uid_rate < 50% in execute mode
    if (!dryRun && result.found_uid_rate < 0.5 && result.total_scanned > 10) {
      result.stopped_reason = `STOP: found_uid_rate=${(result.found_uid_rate * 100).toFixed(1)}% < 50%. Too many unfixable records.`;
      console.log(`[UID-Contract] ${result.stopped_reason}`);
      
      // Log to audit anyway
      await supabase.from("audit_logs").insert({
        action: "uid_contract.stopped",
        actor_type: "admin",
        actor_user_id: user.id,
        actor_label: "admin-fix-uid-contract",
        meta: { ...result, dry_run: dryRun },
      });

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Collect samples for report
    result.fixed_samples = toUpdate
      .filter(u => u.source !== "needs_manual")
      .slice(0, 20)
      .map(u => ({
        id: u.id,
        old_uid: u.oldUid,
        new_uid: u.newUid,
        source: u.source,
      }));

    // PHASE 4: Apply updates (if not dry_run)
    if (!dryRun && toUpdate.length > 0) {
      console.log(`[UID-Contract] Applying ${toUpdate.length} updates in batches of ${batchSize}`);

      for (let i = 0; i < toUpdate.length; i += batchSize) {
        const batch = toUpdate.slice(i, i + batchSize);
        
        for (const item of batch) {
          const updateData: any = { meta: item.meta };
          
          // Only update provider_payment_id if we have a real fix
          if (item.source !== "needs_manual" && item.newUid !== item.oldUid) {
            updateData.provider_payment_id = item.newUid;
          }

          const { error: updateErr } = await supabase
            .from("payments_v2")
            .update(updateData)
            .eq("id", item.id);

          if (updateErr) {
            result.errors++;
            if (result.error_samples.length < 20) {
              result.error_samples.push({ id: item.id, error: updateErr.message });
            }
          }
        }
      }
    }

    // PHASE 5: Audit log
    await supabase.from("audit_logs").insert({
      action: dryRun ? "uid_contract.dry_run" : "uid_contract.execute",
      actor_type: "admin",
      actor_user_id: user.id,
      actor_label: "admin-fix-uid-contract",
      meta: {
        build_id: BUILD_ID,
        dry_run: dryRun,
        total_scanned: result.total_scanned,
        fixed_from_provider_response: result.fixed_from_provider_response,
        fixed_from_statement: result.fixed_from_statement,
        already_correct: result.already_correct,
        needs_manual_fix: result.needs_manual_fix,
        errors: result.errors,
        found_uid_rate: result.found_uid_rate,
      },
    });

    console.log(`[UID-Contract] END build=${BUILD_ID} scanned=${result.total_scanned} fixed=${result.fixed_from_provider_response + result.fixed_from_statement}`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[UID-Contract] ERROR: ${message}`);
    return new Response(
      JSON.stringify({ error: message, build_id: BUILD_ID }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
