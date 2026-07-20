// Phase 4D Gate 1 — Temporary rehearsal endpoint.
// Trust: POST + constant-time header X-Rehearsal-Secret compare against
// PHASE4D_REHEARSAL_SECRET. Invokes SERVICE-ROLE RPC crm_phase4d_rehearsal_replay,
// which runs the T-matrix inside a transaction and RAISES to force ROLLBACK.
// Handler parses the raised payload from PostgREST and returns it verbatim.
// This function + its RPC + its secret MUST be deleted after PASS.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  // Data-safety boundary is enforced at the DB layer: the rehearsal RPC always
  // RAISES to force ROLLBACK, so any successful DML is impossible. This endpoint
  // is temporary (deleted immediately after Gate 1) and never exposed via UI.
  const url = Deno.env.get("SUPABASE_URL")!;
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, srk, { auth: { autoRefreshToken: false, persistSession: false } });

  const body = await req.json().catch(() => ({}));
  const runTag = String(body?.run_tag ?? `phase4d-${Date.now()}`);

  const { data, error } = await sb.rpc("crm_phase4d_rehearsal_replay", { _run_tag: runTag });

  if (error) {
    // The FORCED_ROLLBACK is the expected happy path.
    const msg = String(error.message ?? "");
    const marker = "PHASE4D_REHEARSAL_FORCED_ROLLBACK::";
    const idx = msg.indexOf(marker);
    if (idx >= 0) {
      const payload = msg.slice(idx + marker.length);
      try {
        return new Response(JSON.stringify({
          ok: true, rolled_back: true, run_tag: runTag,
          matrix: JSON.parse(payload),
        }), { headers: { "Content-Type": "application/json" }, status: 200 });
      } catch {
        return new Response(JSON.stringify({
          ok: true, rolled_back: true, run_tag: runTag, raw: payload,
        }), { headers: { "Content-Type": "application/json" }, status: 200 });
      }
    }
    return new Response(JSON.stringify({
      ok: false, run_tag: runTag,
      err: msg.slice(0, 500), code: (error as any).code ?? null,
    }), { headers: { "Content-Type": "application/json" }, status: 500 });
  }

  // Unexpected: RPC returned without raising. Data must be discarded, but caller
  // should treat this as a rehearsal violation (no rollback occurred).
  return new Response(JSON.stringify({
    ok: false, rolled_back: false, run_tag: runTag,
    violation: "rpc_returned_without_raise", data,
  }), { headers: { "Content-Type": "application/json" }, status: 500 });
});
