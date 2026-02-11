import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// PATCH-0.1: Build ID for tracking
const BUILD_ID = "prereg-cron-v0.1.0";

// PATCH-0.1: Expected shop_id (hardcoded guard)
const EXPECTED_SHOP_ID = "33524";

// PATCH-2: Execution window (09:00-09:10 and 21:00-21:10 Minsk time)
function isWithinExecutionWindow(now: Date): { allowed: boolean; hour: number; minute: number } {
  // Convert to Minsk time (UTC+3)
  const minskOffset = 3 * 60; // minutes
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const minskMinutes = utcMinutes + minskOffset;
  const minskHour = Math.floor(minskMinutes / 60) % 24;
  const minskMinute = minskMinutes % 60;

  const allowed =
    (minskHour === 9 && minskMinute >= 0 && minskMinute < 10) ||
    (minskHour === 21 && minskMinute >= 0 && minskMinute < 10);

  return { allowed, hour: minskHour, minute: minskMinute };
}

// PATCH-2: Deadline check (Feb 2, 2026 23:59 Minsk)
function isBeforeDeadline(now: Date): boolean {
  const deadline = new Date("2026-02-02T23:59:59+03:00");
  return now < deadline;
}

// PATCH-4: Window key for idempotency (YYYY-MM-DD|HH format)
function getWindowKey(now: Date): string {
  const minskOffset = 3 * 60;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const minskMinutes = utcMinutes + minskOffset;
  const minskHour = Math.floor(minskMinutes / 60) % 24;

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(minskHour).padStart(2, "0");

  return `${year}-${month}-${day}|${hour}`;
}

// PATCH-0.1: Preflight check - verify credentials work before processing charges
async function runPreflight(supabase: any, auth: string, shopIdSource: string): Promise<{
  ok: boolean;
  provider_status?: number;
  provider_error?: string;
  db_check?: boolean;
}> {
  const host = "gateway.bepaid.by";
  // We don't have shopId here easily without decoding auth, but preflight is just checking auth
  // So we skip shopIdMasked logging or pass it if needed. For now simple log.
  console.log(`[${BUILD_ID}] Preflight: verifying credentials (source: ${shopIdSource})`);

  // 1. Test bePaid credentials with a minimal API call
  try {
    const testResponse = await fetch(`https://${host}/transactions`, {
      method: "GET",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!testResponse.ok) {
      const errorText = await testResponse.text();
      console.error(`[${BUILD_ID}] Preflight failed: bePaid returned ${testResponse.status}`);
      
      await supabase.from("audit_logs").insert({
        actor_type: "system",
        actor_label: "prereg-cron",
        action: "prereg_cron_preflight_failed",
        meta: {
          build_id: BUILD_ID,
          shop_id_masked: '***',
          shop_id_source: shopIdSource,
          provider_status: testResponse.status,
          provider_error: errorText.substring(0, 200),
        },
      });

      return {
        ok: false,
        provider_status: testResponse.status,
        provider_error: errorText.substring(0, 200),
      };
    }

    console.log(`[${BUILD_ID}] Preflight: bePaid credentials OK`);
  } catch (e: any) {
    console.error(`[${BUILD_ID}] Preflight failed: network error`, e.message);
    
    await supabase.from("audit_logs").insert({
      actor_type: "system",
      actor_label: "prereg-cron",
      action: "prereg_cron_preflight_failed",
      meta: {
        build_id: BUILD_ID,
        shop_id_masked: '***',
        shop_id_source: shopIdSource,
        network_error: e.message,
      },
    });

    return {
      ok: false,
      provider_error: e.message,
    };
  }

  // 2. Test DB connectivity
  try {
    const { error: dbError } = await supabase
      .from("course_preregistrations")
      .select("id")
      .limit(1);

    if (dbError) {
      console.error(`[${BUILD_ID}] Preflight failed: DB error`, dbError.message);
      return {
        ok: false,
        db_check: false,
        provider_error: dbError.message,
      };
    }

    console.log(`[${BUILD_ID}] Preflight: DB connectivity OK`);
  } catch (e: any) {
    console.error(`[${BUILD_ID}] Preflight failed: DB exception`, e.message);
    return {
      ok: false,
      db_check: false,
      provider_error: e.message,
    };
  }

  return { ok: true, db_check: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const now = new Date();
  
  // PATCH-2: Execution window check (09:00-09:10 or 21:00-21:10 Minsk)
  const windowCheck = isWithinExecutionWindow(now);
  const windowKey = getWindowKey(now); // "2026-02-02|09"
  
  // Log every invocation
  console.log(`[${BUILD_ID}] CRON INVOKED at ${now.toISOString()} (Minsk hour: ${windowCheck.hour}:${windowCheck.minute}). Window check: ${windowCheck.allowed}`);

  // Force-run override (for manual testing)
  const url = new URL(req.url);
  const forceRun = url.searchParams.get("force") === "true";
  
  if (!windowCheck.allowed && !forceRun) {
    console.log(`[${BUILD_ID}] Outside execution window. Exiting.`);
    return new Response(JSON.stringify({ status: "skipped", reason: "outside_window", window: windowCheck }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      console.error(`[${BUILD_ID}] Missing credentials:`, credsResult.error);
      return new Response(JSON.stringify({ error: credsResult.error, code: 'BEPAID_CREDS_MISSING' }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const bepaidCreds = credsResult;
    const shopId = bepaidCreds.shop_id;
    const bepaidAuth = createBepaidAuthHeader(bepaidCreds);
    const shopIdSource = bepaidCreds.creds_source;
    
    // PATCH-0.1: Hard guard - shop_id must match expected
    if (shopId !== EXPECTED_SHOP_ID) {
      console.error(`[${BUILD_ID}] SHOP_ID MISMATCH! Expected ${EXPECTED_SHOP_ID}, got ${shopId}`);
      return new Response(JSON.stringify({ error: "Configuration mismatch (shop_id)" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PATCH-0: Run preflight check
    const preflight = await runPreflight(supabase, bepaidAuth, shopIdSource);
    if (!preflight.ok) {
      console.error(`[${BUILD_ID}] Preflight failed: ${preflight.provider_error}`);
      
      // Log failure
      await supabase.from("audit_logs").insert({
        actor_type: "system",
        actor_label: "prereg-cron",
        action: "prereg_cron_preflight_failed",
        meta: { preflight, window: windowKey }
      });
      
      return new Response(JSON.stringify({ error: "Payment provider preflight failed", details: preflight }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PATCH-2: Deadline check
    if (!isBeforeDeadline(now) && !forceRun) {
      console.error(`[${BUILD_ID}] DEADLINE PASSED. Charges disabled.`);
      return new Response(JSON.stringify({ status: "stopped", reason: "deadline_passed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PATCH-4: Idempotency check using windowKey
    // Check if we already ran successfully in this window
    const { data: existingLogs } = await supabase
      .from("audit_logs")
      .select("id")
      .eq("action", "prereg_cron_completed")
      .eq("meta->>window_key", windowKey)
      .limit(1);
      
    if (existingLogs && existingLogs.length > 0 && !forceRun) {
      console.log(`[${BUILD_ID}] Already ran in window ${windowKey}. Skipping.`);
      return new Response(JSON.stringify({ status: "skipped", reason: "already_ran_in_window", window: windowKey }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch pending charges
    const { data: charges, error: chargesError } = await supabase
      .from("course_preregistrations")
      .select("*")
      .eq("status", "pending_charge")
      .not("meta->payment_token", "is", null)
      .limit(50);

    if (chargesError) {
      throw chargesError;
    }

    console.log(`[${BUILD_ID}] Found ${charges?.length || 0} pending charges`);

    const results = {
      window: windowKey,
      total: charges?.length || 0,
      success: 0,
      failed: 0,
      details: [] as any[],
    };

    for (const charge of charges || []) {
      const chargeMeta = charge.meta || {};
      const token = chargeMeta.payment_token;
      
      if (!token) {
        console.warn(`[${BUILD_ID}] Charge ${charge.id} has no token, skipping`);
        continue;
      }

      // Log attempt
      await supabase.from("audit_logs").insert({
        actor_type: "system",
        actor_label: "prereg-cron",
        action: "bepaid.request.attempt",
        meta: {
          fn: "preregistration-charge-cron",
          endpoint: "/transactions/payments",
          shop_id_last4: shopId.slice(-4),
          test_mode: bepaidCreds.test_mode,
          provider: "bepaid",
          charge_id: charge.id
        }
      });

      const chargeAmount = chargeMeta.amount ? Math.round(Number(chargeMeta.amount) * 100) : 3000;
      
      const chargePayload = {
        request: {
          amount: chargeAmount,
          currency: "BYN",
          description: `Оплата предзаписи: ${charge.email}`,
          email: charge.email,
          ip: "127.0.0.1",
          order_id: `prereg-${charge.id}`,
          tracking_id: `prereg:${charge.id}`,
          credit_card: {
            token: token,
          },
          test: bepaidCreds.test_mode
        },
      };

      try {
        const response = await fetch("https://gateway.bepaid.by/transactions/payments", {
          method: "POST",
          headers: {
            Authorization: bepaidAuth,
            "Content-Type": "application/json",
            "X-API-Version": "2",
          },
          body: JSON.stringify(chargePayload),
        });

        const result = await response.json();
        const transaction = result.transaction;

        if (transaction && transaction.status === "successful") {
          // Update charge status
          await supabase
            .from("course_preregistrations")
            .update({
              status: "paid",
              meta: {
                ...chargeMeta,
                payment_uid: transaction.uid,
                payment_status: transaction.status,
                charged_at: new Date().toISOString(),
              },
            })
            .eq("id", charge.id);

          results.success++;
          results.details.push({
            charge_id: charge.id,
            status: "success",
            transaction_uid: transaction.uid,
          });

          console.log(`[${BUILD_ID}] Charge ${charge.id} successful: ${transaction.uid}`);
        } else {
          // Charge failed
          const errorMessage = transaction?.message || "Unknown error";
          
          await supabase
            .from("course_preregistrations")
            .update({
              status: "charge_failed",
              meta: {
                ...chargeMeta,
                payment_error: errorMessage,
                payment_status: transaction?.status,
                failed_at: new Date().toISOString(),
              },
            })
            .eq("id", charge.id);

          results.failed++;
          results.details.push({
            charge_id: charge.id,
            status: "failed",
            error: errorMessage,
          });

          console.error(`[${BUILD_ID}] Charge ${charge.id} failed: ${errorMessage}`);
        }
      } catch (e: any) {
        console.error(`[${BUILD_ID}] Charge ${charge.id} exception:`, e.message);
        
        await supabase
          .from("course_preregistrations")
          .update({
            status: "charge_failed",
            meta: {
              ...chargeMeta,
              payment_error: e.message,
              failed_at: new Date().toISOString(),
            },
          })
          .eq("id", charge.id);

        results.failed++;
        results.details.push({
          charge_id: charge.id,
          status: "error",
          error: e.message,
        });
      }
    }

    // Log completion
    await supabase.from("audit_logs").insert({
      actor_type: "system",
      actor_label: "prereg-cron",
      action: "prereg_cron_completed",
      meta: {
        build_id: BUILD_ID,
        window_key: windowKey,
        results,
      },
    });

    console.log(`[${BUILD_ID}] Completed: ${results.success} success, ${results.failed} failed`);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error(`[${BUILD_ID}] Fatal error:`, e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
