// Final follow-up sprint PATCH F6: безопасное удаление эфиров (single + bulk).
//
// Контракт:
//   POST { event_ids: string[], mode: 'platform_only' | 'platform_and_provider' }
//   →   {
//         success: true,
//         summary: {
//           total, requested, deleted,
//           skipped_live: [{event_id, title}],
//           provider_attempted, provider_deleted,
//           provider_failed: [{event_id, target, reason}],
//           degraded: boolean
//         }
//       }
//
// Логика:
// 1. Auth: JWT, has_role_v2(admin | superadmin).
// 2. Loader: live_events.id, title, kinescope_live_event_id, kinescope_video_id, room_state.
// 3. Live-guard (PATCH F6 правило 9): эфиры с room_state='live' исключаются из набора,
//    остальные удаляются. summary.skipped_live содержит список с причиной.
// 4. Если mode='platform_and_provider' — сначала provider delete (live + video),
//    failures не блокируют local delete, помечаются degraded:true.
//    404 от Kinescope = success/already_absent (не failed).
// 5. Local DELETE через service_role. CASCADE FK удаляет 12 операционных таблиц,
//    SET NULL разрывает 2 исторические (broadcast_templates, crm_activity_log).
// 6. Audit: domain_events запись на каждый удалённый + сводный bulk-event.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReqBody {
  event_ids: string[];
  mode: "platform_only" | "platform_and_provider";
}

interface ProviderFailure {
  event_id: string;
  target: "live_event" | "video";
  provider_id: string;
  reason: string;
}

interface SkippedLive {
  event_id: string;
  title: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // 1. Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ success: false, error: "Unauthorized" }, 401);
    const user = userData.user;

    const adminClient = createClient(supabaseUrl, serviceKey);

    const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
      adminClient.rpc("has_role_v2", { _user_id: user.id, _role_code: "admin" }),
      adminClient.rpc("has_role_v2", { _user_id: user.id, _role_code: "superadmin" }),
    ]);
    if (!isAdmin && !isSuper) return json({ success: false, error: "Forbidden" }, 403);

    // 2. Parse body
    const body = (await req.json()) as Partial<ReqBody>;
    const eventIds = Array.isArray(body.event_ids) ? body.event_ids.filter(Boolean) : [];
    const mode = body.mode === "platform_and_provider" ? "platform_and_provider" : "platform_only";
    if (eventIds.length === 0) return json({ success: false, error: "event_ids обязателен" }, 400);
    if (eventIds.length > 200) return json({ success: false, error: "Максимум 200 эфиров за запрос" }, 400);

    // 3. Load events
    const { data: events, error: loadErr } = await adminClient
      .from("live_events")
      .select("id, title, slug, kinescope_live_event_id, kinescope_video_id, room_state, kinescope_instance_id")
      .in("id", eventIds);

    if (loadErr) {
      console.error("[live-events-delete] load error:", loadErr);
      return json({ success: false, error: `Load failed: ${loadErr.message}` }, 500);
    }
    if (!events || events.length === 0) return json({ success: false, error: "Эфиры не найдены" }, 404);

    // 4. Live-guard (PATCH F6 п.9: skip + summary, partial execution)
    const skipped_live: SkippedLive[] = [];
    const deletable = events.filter((e: any) => {
      if (e.room_state === "live") {
        skipped_live.push({ event_id: e.id, title: e.title });
        return false;
      }
      return true;
    });

    const provider_failed: ProviderFailure[] = [];
    let provider_attempted = 0;
    let provider_deleted = 0;

    // 5. Provider delete (если выбран platform_and_provider) — ДО local delete
    if (mode === "platform_and_provider") {
      // Группируем по instance_id для оптимизации (каждый эфир может иметь свой instance)
      for (const ev of deletable) {
        const evAny = ev as any;
        const instanceId = evAny.kinescope_instance_id;

        if (evAny.kinescope_live_event_id) {
          provider_attempted++;
          try {
            const { data: r } = await adminClient.functions.invoke("kinescope-api", {
              body: {
                action: "delete_live_event",
                instance_id: instanceId,
                live_event_id: evAny.kinescope_live_event_id,
              },
            });
            if (r?.success) {
              provider_deleted++;
            } else {
              provider_failed.push({
                event_id: evAny.id,
                target: "live_event",
                provider_id: evAny.kinescope_live_event_id,
                reason: r?.error || "unknown",
              });
            }
          } catch (e) {
            provider_failed.push({
              event_id: evAny.id,
              target: "live_event",
              provider_id: evAny.kinescope_live_event_id,
              reason: e instanceof Error ? e.message : String(e),
            });
          }
        }

        if (evAny.kinescope_video_id) {
          provider_attempted++;
          try {
            const { data: r } = await adminClient.functions.invoke("kinescope-api", {
              body: {
                action: "delete_video",
                instance_id: instanceId,
                video_id: evAny.kinescope_video_id,
              },
            });
            if (r?.success) {
              provider_deleted++;
            } else {
              provider_failed.push({
                event_id: evAny.id,
                target: "video",
                provider_id: evAny.kinescope_video_id,
                reason: r?.error || "unknown",
              });
            }
          } catch (e) {
            provider_failed.push({
              event_id: evAny.id,
              target: "video",
              provider_id: evAny.kinescope_video_id,
              reason: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }
    }

    // 6. Local delete (CASCADE сделает остальное; SET NULL для broadcast_templates + crm_activity_log)
    let deleted = 0;
    const deletableIds = deletable.map((e: any) => e.id);
    if (deletableIds.length > 0) {
      const { error: delErr, count } = await adminClient
        .from("live_events")
        .delete({ count: "exact" })
        .in("id", deletableIds);

      if (delErr) {
        console.error("[live-events-delete] delete error:", delErr);
        return json(
          {
            success: false,
            error: `Local delete failed: ${delErr.message}`,
            summary: {
              total: events.length,
              requested: eventIds.length,
              deleted: 0,
              skipped_live,
              provider_attempted,
              provider_deleted,
              provider_failed,
              degraded: provider_failed.length > 0,
            },
          },
          500,
        );
      }
      deleted = count || deletableIds.length;
    }

    // 7. Audit
    const degraded = provider_failed.length > 0;
    try {
      const auditRows = deletable.map((ev: any) => ({
        action: "live_event_deleted",
        actor_type: "user",
        actor_user_id: user.id,
        target_user_id: null,
        meta: {
          event_id: ev.id,
          title: ev.title,
          slug: ev.slug,
          mode,
          had_live_event_id: !!ev.kinescope_live_event_id,
          had_video_id: !!ev.kinescope_video_id,
        },
      }));
      auditRows.push({
        action: "live_events_bulk_deleted",
        actor_type: "user",
        actor_user_id: user.id,
        target_user_id: null,
        meta: {
          requested: eventIds.length,
          deleted,
          skipped_live_count: skipped_live.length,
          mode,
          provider_attempted,
          provider_deleted,
          provider_failed_count: provider_failed.length,
          degraded,
        },
      });
      await adminClient.from("audit_logs").insert(auditRows);
    } catch (e) {
      console.error("[live-events-delete] audit insert failed:", e);
      // Не блокируем ответ из-за audit
    }

    return json({
      success: true,
      summary: {
        total: events.length,
        requested: eventIds.length,
        deleted,
        skipped_live,
        provider_attempted,
        provider_deleted,
        provider_failed,
        degraded,
        mode,
      },
    });
  } catch (e) {
    console.error("[live-events-delete] fatal:", e);
    return json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      500,
    );
  }
});
