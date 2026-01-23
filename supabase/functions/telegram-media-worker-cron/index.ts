import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * telegram-media-worker-cron
 * 
 * Wrapper Edge Function for pg_cron scheduling.
 * Called every minute by pg_net to process pending media jobs.
 * 
 * Security: No JWT required. Accepts calls from pg_net (internal)
 * or with CRON_SECRET header for manual testing.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

const start = Date.now();
  
  // ===== STRICT SECURITY: Always require CRON_SECRET =====
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (!cronSecret) {
    console.error("[CRON] CRON_SECRET not configured - rejecting request");
    return new Response(JSON.stringify({ error: "cron_secret_not_configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Check x-cron-secret header OR Authorization: Bearer <secret>
  const providedSecret = 
    req.headers.get("x-cron-secret") || 
    req.headers.get("authorization")?.replace("Bearer ", "");

  if (providedSecret !== cronSecret) {
    console.error("[CRON] Unauthorized: invalid or missing secret");
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // ===== END SECURITY CHECK =====

  const workerToken = Deno.env.get("TELEGRAM_MEDIA_WORKER_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  if (!workerToken) {
    console.error("[CRON] TELEGRAM_MEDIA_WORKER_TOKEN not configured");
    return new Response(JSON.stringify({ error: "Worker token not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!supabaseUrl) {
    console.error("[CRON] SUPABASE_URL not configured");
    return new Response(JSON.stringify({ error: "SUPABASE_URL not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const workerUrl = `${supabaseUrl}/functions/v1/telegram-media-worker`;

  // Parse optional body for custom limit
  let limit = 10;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.limit && typeof body.limit === "number") {
        limit = Math.min(Math.max(body.limit, 1), 50);
      }
    }
  } catch {
    // ignore parse errors
  }

  console.log(`[CRON] Calling worker with limit=${limit}...`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000); // 55s timeout (function max is 60s)

    const res = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-token": workerToken,
      },
      body: JSON.stringify({ limit }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const json = await res.json().catch(() => ({ ok: false, error: "invalid_json" }));

    const cronMs = Date.now() - start;
    console.log(
      `[CRON] Worker response: ok=${json.ok} processed=${json.processed || 0} ` +
      `ok_count=${json.ok_count || 0} err_count=${json.error_count || 0} ms=${cronMs}`
    );

    return new Response(
      JSON.stringify({
        ...json,
        cron_ms: cronMs,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: res.status,
      }
    );
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("[CRON] Worker call failed:", errorMsg);

    return new Response(
      JSON.stringify({ 
        ok: false, 
        error: "worker_call_failed", 
        details: errorMsg.slice(0, 200),
        cron_ms: Date.now() - start,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
