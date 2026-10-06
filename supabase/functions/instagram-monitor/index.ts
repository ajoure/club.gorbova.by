import { createClient } from "npm:@supabase/supabase-js@2";
import { getCallerUserId } from "../_shared/caller-user.ts";
import { handleCorsPreflightRequest, jsonResponse } from "../_shared/cors.ts";
import {
  instagramCsvCell,
  instagramUsername,
} from "../_shared/instagram-monitor.ts";

import { apifyConnection, apifyRequest } from "../_shared/instagram-apify.ts";

import {
  allRows,
  EXPORT_ENTITIES,
  exportCsv,
  exportRows,
  pageNumber,
  searchText,
} from "./workspace.ts";

import { instagramReleaseHealth } from "./release-health.ts";

const db = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
const messages: Record<string, string> = {
  monitor_disabled: "Сначала включите интеграцию в настройках.",
  monthly_budget_exhausted: "Бесплатный лимит расходов исчерпан.",
  invalid_profile:
    "Введите имя публичного профиля Instagram или ссылку на него.",
  missing_apify_token: "Добавьте API-ключ в Интеграции → Соцсети → Apify.",
  missing_ai_key: "Gemini пока не подключён.",
  video_missing: "Видео пока не сохранено.",
  profile_disabled: "Профиль выключен.",
  reel_missing: "Ролик не найден.",
};
function checked<T extends { error: unknown; data: any }>(
  result: T,
): NonNullable<T["data"]> {
  if (result.error) throw new Error("database_failed");
  if (result.data == null) throw new Error("database_failed");
  return result.data;
}
function uuid(value: unknown): string {
  if (
    typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)
  ) throw new Error("invalid_id");
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Метод недоступен" }, 405);
  }
  try {
    const userId = await getCallerUserId(req, "instagram-monitor");
    if (!userId) {
      return jsonResponse({ ok: false, message: "Требуется вход" }, 401);
    }
    const client = db();
    if (Number(req.headers.get("content-length")) > 8192) {
      return jsonResponse(
        { ok: false, message: "Запрос слишком большой" },
        413,
      );
    }
    const raw = await req.text();
    if (raw.length > 8192) {
      return jsonResponse(
        { ok: false, message: "Запрос слишком большой" },
        413,
      );
    }
    const body = JSON.parse(raw);
    const action = body.action;
    if (action === "release_health") {
      const root = checked(
        await client.rpc("has_role_v2", {
          _user_id: userId,
          _role_code: "super_admin",
        }),
      );
      if (root !== true) {
        return jsonResponse({
          ok: false,
          message: "Нужны права суперадминистратора",
        }, 403);
      }
      const health = await instagramReleaseHealth(
        Deno.env.get("SUPABASE_URL")!,
        req.headers.get("Authorization") || "",
        {
          webhook: Deno.env.get("TELEGRAM_WEBHOOK_SECRET"),
          media: Deno.env.get("TELEGRAM_MEDIA_WORKER_TOKEN"),
        },
      );
      return jsonResponse({ ok: true, result: health });
    }
    const integrationAction = [
      "integration_status",
      "integration_save",
      "integration_check",
    ].includes(action);
    const readonly = [
      "status",
      "comments",
      "export",
      "export_page",
      "video",
      "integration_status",
    ].includes(action);
    const access = checked(
      await client.rpc(
        integrationAction
          ? "has_admin_resource_access"
          : "has_admin_section_access",
        {
          _user_id: userId,
          _section_code: integrationAction
            ? "integrations"
            : "instagram-monitor",
          ...(integrationAction ? { _resource_code: "socials" } : {}),
          _min_level: integrationAction && !readonly ? "edit" : "view",
        },
      ),
    );
    if (access !== true) {
      return jsonResponse({ ok: false, message: "Нет доступа к разделу" }, 403);
    }
    if (!readonly && !integrationAction) {
      const manage = checked(
        await client.rpc("has_admin_section_access", {
          _user_id: userId,
          _section_code: "instagram-monitor",
          _min_level: "manage",
        }),
      );
      if (manage !== true) {
        return jsonResponse(
          { ok: false, message: "Нужны права управления" },
          403,
        );
      }
    }
    let result: unknown;
    if (integrationAction) {
      if (action === "integration_save") {
        if (
          typeof body.enabled !== "boolean" || typeof body.alias !== "string" ||
          (body.api_token !== undefined && typeof body.api_token !== "string")
        ) throw new Error("invalid_setting");
        checked(
          await client.rpc("instagram_monitor_save_connection", {
            _user_id: userId,
            _enabled: body.enabled,
            _alias: body.alias,
            _token: body.api_token?.trim() || null,
          }),
        );
      }
      const connection = await apifyConnection(client);
      const { token, ...safe } = connection;
      if (action === "integration_check") {
        if (!token) throw new Error("missing_apify_token");
        let success = false;
        try {
          const account = await apifyRequest(token, "users/me");
          success = typeof account?.data?.id === "string";
        } catch { /* never echo provider response or token */ }
        checked(
          await client.from("integration_instances").update({
            status: success ? "connected" : "error",
            last_check_at: new Date().toISOString(),
            error_message: success ? null : "Проверьте ключ Apify и его права.",
          }).eq("id", connection.id).select("id"),
        );
        result = { success };
      } else result = { ...safe, key_configured: !!token };
    } else if (action === "status") {
      const reelPage = pageNumber(body.reels_page),
        runPage = pageNumber(body.runs_page);
      const reelQuery = client.from("instagram_monitor_reels").select("*", {
        count: "exact",
      });
      if (body.profile_id) reelQuery.eq("profile_id", uuid(body.profile_id));
      const query = searchText(body.search);
      if (query) reelQuery.ilike("caption", `%${query}%`);
      const [s, p, r, v, budget] = await Promise.all([
        client.from("instagram_monitor_settings").select("*").single(),
        allRows(() =>
          client.from("instagram_monitor_profiles").select("*").order("id")
        ),
        client.from("instagram_monitor_runs").select(
          "id,kind,status,created_at,cost_usd,error_code,provider_run_id,profile_id,reel_id,import_offset,reel:instagram_monitor_reels(shortcode,profile_id)",
          { count: "exact" },
        ).order("created_at", { ascending: false }).order("id").range(
          runPage * 20,
          runPage * 20 + 19,
        ),
        reelQuery.order("created_at", { ascending: false }).order("id").range(
          reelPage * 20,
          reelPage * 20 + 19,
        ),
        allRows(() =>
          client.from("instagram_monitor_runs").select(
            "id,budget_month,reserved_usd,cost_usd",
          ).or(
            `reserved_usd.gt.0,budget_month.eq.${
              new Date().toISOString().slice(0, 7)
            }-01`,
          ).order("id")
        ),
      ]);
      const settings = checked(s);
      result = {
        ...settings,
        connected: !!(await apifyConnection(client)).token,
        enabled: settings.enabled &&
          (await apifyConnection(client)).enabled === true,
        ai_connected: !!Deno.env.get("LOVABLE_API_KEY"),
        profiles: p,
        runs: checked(r),
        reels: checked(v),
        reels_total: v.count || 0,
        runs_total: r.count || 0,
        reserved_usd: budget.reduce(
          (n: number, x: any) => n + Number(x.reserved_usd),
          0,
        ),
        actual_usd: budget.reduce(
          (n: number, x: any) =>
            n +
            (x.budget_month === `${new Date().toISOString().slice(0, 7)}-01`
              ? Number(x.cost_usd || 0)
              : 0),
          0,
        ),
      };
    } else if (action === "add_profile") {
      result = checked(
        await client.from("instagram_monitor_profiles").upsert({
          username: instagramUsername(body.username),
        }, { onConflict: "username", ignoreDuplicates: true }).select(),
      );
    } else if (action === "profile_enabled") {
      if (typeof body.enabled !== "boolean") throw new Error("invalid_setting");
      result = checked(
        await client.from("instagram_monitor_profiles").update({
          enabled: body.enabled,
        }).eq("id", uuid(body.profile_id)).select("id"),
      );
    } else if (action === "settings") {
      const update: Record<string, boolean | number> = {};
      for (const key of ["auto_monitor", "include_replies"]) {
        if (key in body) {
          if (typeof body[key] !== "boolean") {
            throw new Error("invalid_setting");
          }
          update[key] = body[key];
        }
      }
      for (
        const [key, min, max] of [["reels_per_run", 1, 100], [
          "run_timeout_seconds",
          60,
          600,
        ]] as const
      ) {
        if (key in body) {
          if (
            !Number.isSafeInteger(body[key]) || body[key] < min ||
            body[key] > max
          ) throw new Error("invalid_setting");
          update[key] = body[key];
        }
      }
      if ("enabled" in body) throw new Error("invalid_setting");
      result = checked(
        await client.from("instagram_monitor_settings").update(update).eq(
          "id",
          true,
        ).select().single(),
      );
    } else if (action === "collect_all") {
      const queued = await client.rpc("instagram_monitor_queue_profiles", {
        _force: true,
      });
      if (queued.error) {
        throw new Error(
          queued.error.message.includes("monthly_budget_exhausted")
            ? "monthly_budget_exhausted"
            : "queue_failed",
        );
      }
      result = { queued: queued.data };
    } else if (action === "export_page") {
      const entity = body.entity;
      if (!EXPORT_ENTITIES.includes(entity)) throw new Error("invalid_entity");
      const cutoff = body.cutoff === undefined
        ? new Date().toISOString()
        : body.cutoff;
      if (typeof cutoff !== "string" || !Number.isFinite(Date.parse(cutoff))) {
        throw new Error("invalid_page");
      }
      const query = client.from(`instagram_monitor_${entity}`).select(
        entity === "comments"
          ? "*,reel:instagram_monitor_reels(post_url,profile:instagram_monitor_profiles(username))"
          : "*",
      ).lte("created_at", cutoff).order("id").limit(500);
      if (body.cursor) query.gt("id", uuid(body.cursor));
      if (body.reel_id && entity === "comments") {
        query.eq("reel_id", uuid(body.reel_id));
      }
      const rows: any[] = checked(await query);
      result = {
        ...exportRows(entity, rows),
        cutoff,
        next_cursor: rows.length === 500 ? rows.at(-1)!.id : null,
      };
    } else if (["collect", "collect_comments", "transcribe"].includes(action)) {
      const settings = checked(
        await client.from("instagram_monitor_settings").select("enabled")
          .single(),
      );
      const connection = await apifyConnection(client);
      if (!settings.enabled || !connection.enabled) {
        throw new Error("monitor_disabled");
      }
      const kind = action === "collect"
        ? "reels"
        : action === "collect_comments"
        ? "comments"
        : "transcribe";
      if (kind !== "transcribe" && !connection.token) {
        throw new Error("missing_apify_token");
      }
      if (kind === "transcribe" && !Deno.env.get("LOVABLE_API_KEY")) {
        throw new Error("missing_ai_key");
      }
      const queued = await client.rpc("instagram_monitor_enqueue", {
        _kind: kind,
        _profile_id: kind === "reels" ? uuid(body.profile_id) : null,
        _reel_id: kind === "reels" ? null : uuid(body.reel_id),
      });
      if (queued.error) {
        throw new Error(
          ["monitor_disabled", "profile_disabled", "reel_missing"].find((x) =>
            queued.error!.message.includes(x)
          ) || "queue_failed",
        );
      }
      result = { id: queued.data };
    } else if (action === "video") {
      const reel = checked(
        await client.from("instagram_monitor_reels").select("storage_path").eq(
          "id",
          uuid(body.reel_id),
        ).single(),
      );
      if (!reel.storage_path) throw new Error("video_missing");
      const signed = checked(
        await client.storage.from("instagram-monitor-media").createSignedUrl(
          reel.storage_path,
          300,
          body.download === true
            ? { download: `instagram-${uuid(body.reel_id)}.mp4` }
            : undefined,
        ),
      );
      result = { url: signed.signedUrl };
    } else if (action === "comments") {
      const id = uuid(body.reel_id);
      if (body.page === undefined && body.search === undefined) {
        result = await allRows(() =>
          client.from("instagram_monitor_comments").select(
            "id,text,username,posted_at,parent_comment_id,likes_count",
          ).eq("reel_id", id).order("id")
        );
      } else {
        const query = client.from("instagram_monitor_comments").select(
          "id,text,username,posted_at,parent_comment_id,likes_count",
          { count: "exact" },
        ).eq("reel_id", id).order("id");
        const search = searchText(body.search);
        if (search) query.ilike("text", `%${search}%`);
        const page = pageNumber(body.page),
          response = await query.range(page * 50, page * 50 + 49);
        result = { rows: checked(response), total: response.count || 0 };
      }
    } else if (action === "export") {
      const entity = body.reel_id ? "comments" : "reels";
      const rows = await allRows(() => {
        const query = client.from(`instagram_monitor_${entity}`).select(
          entity === "comments"
            ? "*,reel:instagram_monitor_reels(post_url,profile:instagram_monitor_profiles(username))"
            : "*",
        ).order("id");
        return body.reel_id ? query.eq("reel_id", uuid(body.reel_id)) : query;
      });
      result = { csv: exportCsv(entity, rows) };
    } else {return jsonResponse(
        { ok: false, message: "Неизвестное действие" },
        400,
      );}
    return jsonResponse({ ok: true, result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return jsonResponse({
      ok: false,
      message: messages[code] ||
        "Не удалось выполнить действие. Проверьте историю запусков.",
    });
  }
});
