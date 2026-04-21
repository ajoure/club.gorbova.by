// Sprint 2 PATCH 2.2: lifecycle handler для room state.
// Endpoint: POST /functions/v1/live-event-lifecycle
// Body: { event_id: uuid, action: 'open_room' | 'start_live' | 'complete_webinar' }
//
// Контракт:
// - Роли: admin / superadmin / employee (проверка через has_role_v2).
// - Идемпотентность: повторный вызов в целевом/последующем состоянии → 200 { skipped: true }.
// - Guard: недопустимый переход → 409.
// - Provider-call (Kinescope) только для event_type='live_stream' с валидным kinescope_live_event_id.
// - Стратегия degraded-mode: если provider-call упал, room_state ВСЁ РАВНО переключается,
//   но в audit_logs пишется отдельный reason 'provider_call_failed'.
//   Это explicit degraded mode — фиксируется, не молчит.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RoomState = "closed" | "opened" | "live" | "completed";
type Action = "open_room" | "start_live" | "complete_webinar";

const TRANSITION: Record<Action, { from: RoomState; to: RoomState }> = {
  open_room: { from: "closed", to: "opened" },
  start_live: { from: "opened", to: "live" },
  complete_webinar: { from: "live", to: "completed" },
};

const ALLOWED_ROLES = ["super_admin", "admin", "employee"];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // 1. Auth
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) return jsonResponse({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const actor = userData.user;

  // 2. Parse body
  let body: { event_id?: string; action?: Action };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const { event_id, action } = body;
  if (!event_id || !action || !TRANSITION[action]) {
    return jsonResponse({ error: "invalid_input", details: "event_id + action(open_room|start_live|complete_webinar) required" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // 3. Role check
  let allowed = false;
  for (const role of ALLOWED_ROLES) {
    const { data: hasRole } = await admin.rpc("has_role_v2", {
      _user_id: actor.id,
      _role_code: role,
    });
    if (hasRole) {
      allowed = true;
      break;
    }
  }
  if (!allowed) {
    return jsonResponse({ error: "forbidden", details: "requires admin/superadmin/employee" }, 403);
  }

  // 4. Load current event
  const { data: ev, error: evErr } = await admin
    .from("live_events")
    .select("id, room_state, event_type, kinescope_live_event_id, platform_status, status, replay_enabled, slug, title")
    .eq("id", event_id)
    .maybeSingle();
  if (evErr || !ev) {
    return jsonResponse({ error: "event_not_found", details: evErr?.message }, 404);
  }
  const currentState = (ev.room_state ?? "closed") as RoomState;
  const { from: expectedFrom, to: targetState } = TRANSITION[action];

  // 5. Idempotency: already at target or beyond → skip
  const stateOrder: RoomState[] = ["closed", "opened", "live", "completed"];
  const currentIdx = stateOrder.indexOf(currentState);
  const targetIdx = stateOrder.indexOf(targetState);
  if (currentIdx >= targetIdx) {
    return jsonResponse({
      ok: true,
      skipped: true,
      reason: "already_at_or_beyond_target",
      room_state: currentState,
      event_id,
    });
  }

  // 6. Guard: only allow exact-from transitions
  if (currentState !== expectedFrom) {
    return jsonResponse({
      error: "invalid_transition",
      from: currentState,
      to: targetState,
      expected_from: expectedFrom,
    }, 409);
  }

  // 7. Provider-call (Kinescope) — only for live_stream with valid kinescope_live_event_id
  let providerResult: { attempted: boolean; ok: boolean; reason?: string; error?: string } = {
    attempted: false,
    ok: true,
  };
  if (
    ev.event_type === "live_stream" &&
    ev.kinescope_live_event_id &&
    (action === "start_live" || action === "complete_webinar")
  ) {
    providerResult.attempted = true;
    try {
      const providerAction = action === "start_live" ? "enable_live_event" : "complete_live_event";
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/kinescope-api`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: providerAction,
          live_event_id: ev.kinescope_live_event_id,
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        providerResult = {
          attempted: true,
          ok: false,
          reason: "provider_call_failed",
          error: `${resp.status} ${txt.slice(0, 300)}`,
        };
      }
    } catch (e) {
      providerResult = {
        attempted: true,
        ok: false,
        reason: "provider_call_failed",
        error: (e as Error).message,
      };
    }
  } else if (ev.event_type === "live_stream" && !ev.kinescope_live_event_id) {
    providerResult = {
      attempted: false,
      ok: true,
      reason: "no_kinescope_id_skipped",
    };
  }

  // 8. Apply room_state transition + timestamps + sync status/platform_status.
  // PATCH 1 (Sprint 4): status и platform_status — два legacy поля, оставшиеся в UI/queries.
  // Чтобы избежать desync (room_state=completed, но status=live), обновляем их согласованно.
  const updatePayload: Record<string, unknown> = { room_state: targetState };
  if (action === "open_room") {
    updatePayload.room_opened_at = new Date().toISOString();
    // Поднимаем 'draft' → 'scheduled' (если ещё не выше). Никогда не понижаем с live/ended/replay_available.
    if (ev.status === "draft") {
      updatePayload.status = "scheduled";
    }
    if (ev.platform_status === "draft") {
      updatePayload.platform_status = "scheduled";
    }
  }
  if (action === "start_live") {
    updatePayload.live_started_at = new Date().toISOString();
    updatePayload.status = "live";
    updatePayload.platform_status = "live";
  }
  if (action === "complete_webinar") {
    const terminalStatus = ev.replay_enabled ? "replay_available" : "ended";
    updatePayload.webinar_completed_at = new Date().toISOString();
    updatePayload.status = terminalStatus;
    updatePayload.platform_status = terminalStatus;
  }

  const { data: updated, error: updErr } = await admin
    .from("live_events")
    .update(updatePayload)
    .eq("id", event_id)
    .select("id, room_state, room_opened_at, live_started_at, webinar_completed_at, status, platform_status")
    .single();
  if (updErr) {
    return jsonResponse({
      error: "update_failed",
      details: updErr.message,
      provider: providerResult,
    }, 500);
  }

  // 9. Audit
  await admin.from("audit_logs").insert({
    action: `live_event.lifecycle.${action}`,
    actor_user_id: actor.id,
    actor_type: "user",
    target_user_id: null,
    meta: {
      event_id,
      event_slug: ev.slug,
      event_title: ev.title,
      from_state: currentState,
      to_state: targetState,
      provider: providerResult,
    },
  });

  return jsonResponse({
    ok: true,
    skipped: false,
    room_state: targetState,
    previous_state: currentState,
    event_id,
    provider: providerResult,
    event: updated,
  });
});
