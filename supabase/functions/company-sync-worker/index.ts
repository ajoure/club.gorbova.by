// Phase 4C — Company Sync Worker (deploy-only; not scheduled)
// -----------------------------------------------------------------------------
// Trust boundary:
//   1. verify_jwt = false at the platform level, so we enforce auth in code.
//   2. Method must be POST. OPTIONS -> 405 (no CORS, server-to-server only).
//   3. Header X-Worker-Secret MUST equal Deno.env PHASE4_WORKER_SHARED_SECRET
//      (constant-time compare). Missing / wrong -> 401. Nothing else runs.
//   4. Only after (2)+(3) the handler builds a SERVICE_ROLE Supabase client
//      and calls the two SECURITY DEFINER helpers created in Phase 4B:
//          crm_company_sync_worker_claim / crm_company_sync_worker_complete
//      and the permanent writer crm_company_backfill_billing_cld.
// The handler never writes directly to companies / map / company_contacts.
// The handler never widens grants, never disables RLS, never logs the secret
// or the service-role key. Payloads and errors are truncated in logs.
// -----------------------------------------------------------------------------
// Cron scheduling and any real invocation are DEFERRED to Phase 4D approval.
// This deploy step ONLY installs the handler.
// -----------------------------------------------------------------------------

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

const RETRYABLE_DEFAULT = true;
const NON_RETRYABLE_SQLSTATES = new Set([
  "42501", // insufficient_privilege
  "23503", // foreign_key_violation
  "22023", // invalid_parameter_value / guard violation
  "P0001", // raise_exception (map mismatch guard, unsupported reason, etc.)
]);
const SUPPORTED_REASONS = new Set(["legal_details_upsert", "manual_replay"]);

const BATCH_SIZE = 10;
const LEASE_SECONDS = 60;

function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function trunc(s: unknown, n = 300): string {
  const str = typeof s === "string" ? s : JSON.stringify(s ?? null);
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function classifyError(err: any): "retry" | "dead_letter" {
  const code = err?.code ?? err?.details?.code ?? null;
  if (code && NON_RETRYABLE_SQLSTATES.has(String(code))) return "dead_letter";
  const msg = String(err?.message ?? "");
  // Guard-raised conflicts from the map read-then-insert path.
  if (/company_id mismatch|map mismatch|unsupported reason/i.test(msg)) {
    return "dead_letter";
  }
  return RETRYABLE_DEFAULT ? "retry" : "dead_letter";
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();

  if (req.method === "OPTIONS") {
    return new Response("method not allowed", { status: 405 });
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const expected = Deno.env.get("PHASE4_WORKER_SHARED_SECRET") ?? "";
  const provided = req.headers.get("x-worker-secret") ?? "";
  if (!expected || !provided || !timingSafeEqual(expected, provided)) {
    // Do NOT reveal which side was empty; do NOT log header values.
    console.warn(JSON.stringify({
      evt: "company-sync-worker.auth_denied",
      has_expected: expected.length > 0,
      has_provided: provided.length > 0,
    }));
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(JSON.stringify({
      evt: "company-sync-worker.config_missing",
    }));
    return new Response(JSON.stringify({ error: "config_missing" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Optional body flags:
  //   { "dryRun": true }      → return without claiming or mutating the queue.
  //   { "healthcheck": true } → return crm_company_sync_health() summary only.
  let dryRun = false;
  let healthcheck = false;
  try {
    const body = await req.json().catch(() => ({}));
    dryRun = body?.dryRun === true;
    healthcheck = body?.healthcheck === true;
  } catch { /* body optional */ }

  if (healthcheck) {
    const { data, error } = await supabase.rpc("crm_company_sync_health");
    if (error) {
      console.error(JSON.stringify({
        evt: "company-sync-worker.health_error",
        err: trunc(error.message),
        code: error.code ?? null,
      }));
      return new Response(JSON.stringify({ error: "health_failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.log(JSON.stringify({
      evt: "company-sync-worker.health",
      elapsed_ms: Date.now() - startedAt,
    }));
    return new Response(JSON.stringify({ ok: true, health: data }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  if (dryRun) {
    return new Response(JSON.stringify({
      ok: true,
      dryRun: true,
      claimed: 0,
      elapsed_ms: Date.now() - startedAt,
    }), { headers: { "Content-Type": "application/json" }, status: 200 });
  }

  // 1. Claim a bounded batch.
  const { data: claimed, error: claimErr } = await supabase.rpc(
    "crm_company_sync_worker_claim",
    { _batch: BATCH_SIZE, _lease_seconds: LEASE_SECONDS },
  );
  if (claimErr) {
    console.error(JSON.stringify({
      evt: "company-sync-worker.claim_error",
      err: trunc(claimErr.message),
      code: claimErr.code ?? null,
    }));
    return new Response(JSON.stringify({ error: "claim_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const jobs: any[] = Array.isArray(claimed) ? claimed : [];
  const summary = {
    claimed: jobs.length,
    done: 0,
    skipped: 0,
    retried: 0,
    dead_lettered: 0,
    complete_errors: 0,
  };

  for (const job of jobs) {
    const jobId = job.id;
    const entityId = job.entity_id;
    const reason = job.run_reason;
    const attempts = job.attempts;
    const jobStart = Date.now();

    // 3a. Reason gate — grp_refetch and unknowns are skipped as `done`
    // (recorded as skipped:reason so operators can see them).
    if (!SUPPORTED_REASONS.has(reason)) {
      const { error: cErr } = await supabase.rpc(
        "crm_company_sync_worker_complete",
        { _id: jobId, _status: "done", _error: `skipped: unsupported reason ${reason}` },
      );
      if (cErr) summary.complete_errors++;
      else summary.skipped++;
      console.log(JSON.stringify({
        evt: "company-sync-worker.job",
        job_id: jobId,
        entity_id: entityId,
        reason,
        attempts,
        outcome: "skipped_reason",
        elapsed_ms: Date.now() - jobStart,
      }));
      continue;
    }

    // 3b. Delegate to the permanent, service-only writer.
    const { data: writerResult, error: writerErr } = await supabase.rpc(
      "crm_company_backfill_billing_cld",
      { _client_legal_details_id: entityId },
    );

    let nextStatus: "done" | "retry" | "dead_letter";
    let nextError: string | null = null;

    if (writerErr) {
      nextStatus = classifyError(writerErr);
      nextError = trunc(writerErr.message);
    } else {
      // Success contract of crm_company_backfill_billing_cld: returns a jsonb
      // object that ALWAYS includes company_id, map_id, contact_id and the
      // writer marker fields. Any structural violation (missing company_id,
      // explicit error field, or missing writer marker) is treated as a
      // non-retryable guard failure.
      const wr = (writerResult ?? {}) as Record<string, unknown>;
      const hasWriterMarker = wr.writer === "crm_company_backfill_billing_cld";
      const hasCompanyId = typeof wr.company_id === "string" && wr.company_id.length > 0;
      const hasError = typeof wr.error === "string" || wr.ok === false;
      if (!writerResult || !hasWriterMarker || !hasCompanyId || hasError) {
        nextStatus = "dead_letter";
        nextError = trunc(writerResult ?? "writer returned no payload");
      } else {
        nextStatus = "done";
      }
    }

    const { error: cErr } = await supabase.rpc(
      "crm_company_sync_worker_complete",
      { _id: jobId, _status: nextStatus, _error: nextError },
    );
    if (cErr) {
      summary.complete_errors++;
      console.error(JSON.stringify({
        evt: "company-sync-worker.complete_error",
        job_id: jobId,
        entity_id: entityId,
        intended_status: nextStatus,
        err: trunc(cErr.message),
        code: cErr.code ?? null,
      }));
      continue;
    }

    if (nextStatus === "done") summary.done++;
    else if (nextStatus === "retry") summary.retried++;
    else summary.dead_lettered++;

    console.log(JSON.stringify({
      evt: "company-sync-worker.job",
      job_id: jobId,
      entity_id: entityId,
      reason,
      attempts,
      outcome: nextStatus,
      elapsed_ms: Date.now() - jobStart,
      // Note: nextError intentionally not logged to avoid leaking payload.
      had_error: nextError !== null,
    }));
  }

  console.log(JSON.stringify({
    evt: "company-sync-worker.tick",
    ...summary,
    elapsed_ms: Date.now() - startedAt,
  }));

  return new Response(JSON.stringify({ ok: true, ...summary }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});
