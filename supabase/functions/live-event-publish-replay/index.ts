// Edge function: live-event-publish-replay
// Phase 1 — manual publish only (no DB triggers).
// Actions:
//   - publish      : create training_lessons + lesson_blocks(video) for the recorded webinar replay,
//                    mirror live_event_access_rules into access_rules (training_content), idempotent.
//   - republish    : delete prior lesson (by metadata.replay_lesson_id), then publish again.
//   - sync_access  : recompute training_content access_rules to mirror live_event_access_rules (no lesson change).
//   - dry_run      : no writes; returns the planned lesson + access diff.
//
// Idempotency:
//   live_events.metadata fields:
//     replay_target          { menu_section_key, parent_module_id }
//     replay_lesson_id       string | null
//     replay_publish_status  'idle' | 'published' | 'error'
//     replay_publish_error   string | null
//     replay_published_at    iso string

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Action = "publish" | "republish" | "sync_access" | "dry_run";

interface ReqBody {
  live_event_id: string;
  action: Action;
}

interface AccessRuleSnapshot {
  product_id: string;
  tariff_id: string | null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s-]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

async function ensureUniqueLessonSlug(
  admin: any,
  moduleId: string,
  base: string,
): Promise<string> {
  let slug = base;
  let i = 2;
  // training_lessons.slug is globally unique in many setups; check both module-scope and global
  // Use module-scope to be safe.
  while (true) {
    const { data } = await admin
      .from("training_lessons")
      .select("id")
      .eq("module_id", moduleId)
      .eq("slug", slug)
      .limit(1);
    if (!data || data.length === 0) return slug;
    slug = `${base}-${i++}`;
    if (i > 50) return `${base}-${Date.now()}`;
  }
}

async function buildAccessSnapshot(
  admin: any,
  liveEventId: string,
): Promise<AccessRuleSnapshot[]> {
  const { data, error } = await admin
    .from("live_event_access_rules")
    .select("product_id, tariff_id")
    .eq("live_event_id", liveEventId);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    product_id: r.product_id,
    tariff_id: r.tariff_id,
  }));
}

/**
 * Group access snapshot by product_id; tariff_id=null means "all tariffs".
 * Mirrors logic in LiveEventAccessRulesEditor.
 */
function groupRulesByProduct(rows: AccessRuleSnapshot[]) {
  const map = new Map<string, { allTariffs: boolean; tariffIds: Set<string> }>();
  for (const r of rows) {
    const cur = map.get(r.product_id) || {
      allTariffs: false,
      tariffIds: new Set<string>(),
    };
    if (!r.tariff_id) cur.allTariffs = true;
    else cur.tariffIds.add(r.tariff_id);
    map.set(r.product_id, cur);
  }
  return map;
}

/**
 * Mirror live_event_access_rules into access_rules of grant_target_type='training_content'
 * scoped to the new lesson via conditions.allowed_lesson_ids.
 */
async function syncTrainingContentAccess(
  admin: any,
  lessonId: string,
  liveEventId: string,
  liveEventTitle: string,
) {
  const snap = await buildAccessSnapshot(admin, liveEventId);
  const grouped = groupRulesByProduct(snap);

  // 1) delete prior access_rules created for this lesson.
  // We tag them via conditions.replay_lesson_id and grant_target_type='training_content'.
  const { data: existing, error: exErr } = await admin
    .from("access_rules")
    .select("id, conditions")
    .eq("grant_target_type", "training_content");
  if (exErr) throw exErr;
  const stale = (existing || []).filter(
    (r: any) => r?.conditions?.replay_lesson_id === lessonId,
  );
  if (stale.length > 0) {
    await admin
      .from("access_rules")
      .delete()
      .in(
        "id",
        stale.map((r: any) => r.id),
      );
  }

  // 2) insert one access_rule per (product_id, tariff_id), all scoped to lessonId only.
  const rows: any[] = [];
  for (const [productId, info] of grouped.entries()) {
    if (info.allTariffs) {
      rows.push({
        grant_target_type: "training_content",
        target_ref: productId,
        target_label: liveEventTitle,
        product_id: productId,
        tariff_id: null,
        is_active: true,
        priority: 100,
        conditions: {
          access_mode: "partial",
          allowed_lesson_ids: [lessonId],
          allowed_module_ids: [],
          replay_lesson_id: lessonId, // marker for idempotent re-sync
          source: "live_event_replay",
          live_event_id: liveEventId,
        },
        notes: `Auto-mirrored from live_event ${liveEventId}`,
      });
    }
    for (const tariffId of info.tariffIds) {
      // skip if already covered by allTariffs
      if (info.allTariffs) continue;
      rows.push({
        grant_target_type: "training_content",
        target_ref: productId,
        target_label: liveEventTitle,
        product_id: productId,
        tariff_id: tariffId,
        is_active: true,
        priority: 100,
        conditions: {
          access_mode: "partial",
          allowed_lesson_ids: [lessonId],
          allowed_module_ids: [],
          replay_lesson_id: lessonId,
          source: "live_event_replay",
          live_event_id: liveEventId,
        },
        notes: `Auto-mirrored from live_event ${liveEventId}`,
      });
    }
  }

  if (rows.length > 0) {
    const { error } = await admin.from("access_rules").insert(rows);
    if (error) throw error;
  }

  return { mirrored_count: rows.length, snapshot: snap };
}

async function planLesson(admin: any, ev: any) {
  const meta = ev.metadata || {};
  const target = meta.replay_target || {};
  const moduleId: string | null = target.parent_module_id || null;
  const sectionKey: string | null = target.menu_section_key || null;
  const baseSlug = slugify(`replay-${ev.slug || ev.id}`);
  const title = ev.title;
  const videoId = ev.kinescope_video_id;

  return {
    module_id: moduleId,
    menu_section_key: sectionKey,
    base_slug: baseSlug,
    title,
    kinescope_video_id: videoId,
    video_url: videoId ? `https://kinescope.io/${videoId}` : null,
  };
}

async function setMeta(admin: any, eventId: string, patch: Record<string, any>) {
  const { data: cur } = await admin
    .from("live_events")
    .select("metadata")
    .eq("id", eventId)
    .single();
  const merged = { ...(cur?.metadata || {}), ...patch };
  await admin.from("live_events").update({ metadata: merged }).eq("id", eventId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth: require user JWT (manual admin call). Service role client used internally.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: authErr } = await userClient.auth.getClaims(token);
    if (authErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    // Admin role check
    const { data: roleRow } = await userClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "super_admin"])
      .limit(1);
    if (!roleRow || roleRow.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as ReqBody;
    if (!body?.live_event_id || !body?.action) {
      return new Response(
        JSON.stringify({ error: "live_event_id and action required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: ev, error: evErr } = await admin
      .from("live_events")
      .select("*")
      .eq("id", body.live_event_id)
      .single();
    if (evErr || !ev) {
      return new Response(
        JSON.stringify({ error: "live_event not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const meta = (ev.metadata as any) || {};
    const plan = await planLesson(admin, ev);

    // ─────── DRY_RUN ───────
    if (body.action === "dry_run") {
      const accessSnap = await buildAccessSnapshot(admin, body.live_event_id);
      const existingLessonId = meta.replay_lesson_id || null;

      let currentAccessForLesson: any[] = [];
      if (existingLessonId) {
        const { data } = await admin
          .from("access_rules")
          .select("id, product_id, tariff_id, conditions")
          .eq("grant_target_type", "training_content");
        currentAccessForLesson = (data || []).filter(
          (r: any) => r?.conditions?.replay_lesson_id === existingLessonId,
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          plan,
          existing_lesson_id: existingLessonId,
          publish_status: meta.replay_publish_status || "idle",
          publish_error: meta.replay_publish_error || null,
          access_snapshot_live_event: accessSnap,
          access_current_for_lesson: currentAccessForLesson.map((r: any) => ({
            product_id: r.product_id,
            tariff_id: r.tariff_id,
          })),
          checks: {
            has_kinescope_video_id: !!plan.kinescope_video_id,
            has_module_id: !!plan.module_id,
            has_section_key: !!plan.menu_section_key,
            replay_enabled: !!ev.replay_enabled,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ─────── SYNC_ACCESS ───────
    if (body.action === "sync_access") {
      const lessonId = meta.replay_lesson_id;
      if (!lessonId) {
        return new Response(
          JSON.stringify({ error: "Lesson is not published yet" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const result = await syncTrainingContentAccess(
        admin,
        lessonId,
        body.live_event_id,
        ev.title,
      );
      return new Response(
        JSON.stringify({ ok: true, action: "sync_access", ...result }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ─────── REPUBLISH ───────
    if (body.action === "republish") {
      const oldLessonId = meta.replay_lesson_id;
      if (oldLessonId) {
        // Remove access_rules referencing it
        const { data: existing } = await admin
          .from("access_rules")
          .select("id, conditions")
          .eq("grant_target_type", "training_content");
        const stale = (existing || []).filter(
          (r: any) => r?.conditions?.replay_lesson_id === oldLessonId,
        );
        if (stale.length > 0) {
          await admin
            .from("access_rules")
            .delete()
            .in(
              "id",
              stale.map((r: any) => r.id),
            );
        }
        // Delete lesson_blocks then lesson
        await admin.from("lesson_blocks").delete().eq("lesson_id", oldLessonId);
        await admin.from("training_lessons").delete().eq("id", oldLessonId);
        await setMeta(admin, body.live_event_id, {
          replay_lesson_id: null,
          replay_publish_status: "idle",
          replay_publish_error: null,
        });
      }
      // fall through to publish
    }

    // ─────── PUBLISH ───────
    if (body.action === "publish" || body.action === "republish") {
      // Validations
      if (!ev.replay_enabled) {
        return new Response(
          JSON.stringify({ error: "replay_enabled = false" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (!plan.kinescope_video_id) {
        return new Response(
          JSON.stringify({
            error: "kinescope_video_id is empty (запись ещё не появилась)",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (!plan.module_id) {
        return new Response(
          JSON.stringify({
            error:
              "Не выбран модуль для публикации записи (вкладка «Запись»)",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Idempotency: if already published, return existing
      if (meta.replay_lesson_id && body.action === "publish") {
        return new Response(
          JSON.stringify({
            ok: true,
            already_published: true,
            lesson_id: meta.replay_lesson_id,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      try {
        const slug = await ensureUniqueLessonSlug(
          admin,
          plan.module_id,
          plan.base_slug,
        );
        const { data: lesson, error: lessonErr } = await admin
          .from("training_lessons")
          .insert({
            module_id: plan.module_id,
            title: plan.title,
            slug,
            content_type: "video",
            is_active: true,
            sort_order: 0,
            published_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (lessonErr) throw lessonErr;

        // Create canonical video block (matches ContentCreationWizard pattern)
        const { error: blockErr } = await admin.from("lesson_blocks").insert({
          lesson_id: lesson.id,
          block_type: "video",
          content: {
            url: plan.video_url,
            provider: "kinescope",
          },
          sort_order: 0,
        });
        if (blockErr) throw blockErr;

        // Mirror access rules
        const accessRes = await syncTrainingContentAccess(
          admin,
          lesson.id,
          body.live_event_id,
          ev.title,
        );

        await setMeta(admin, body.live_event_id, {
          replay_lesson_id: lesson.id,
          replay_publish_status: "published",
          replay_publish_error: null,
          replay_published_at: new Date().toISOString(),
        });

        return new Response(
          JSON.stringify({
            ok: true,
            action: body.action,
            lesson_id: lesson.id,
            lesson_slug: slug,
            access_mirrored_count: accessRes.mirrored_count,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      } catch (e: any) {
        await setMeta(admin, body.live_event_id, {
          replay_publish_status: "error",
          replay_publish_error: String(e?.message || e),
        });
        throw e;
      }
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[live-event-publish-replay] error:", e);
    return new Response(
      JSON.stringify({ error: String(e?.message || e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
