import { createClient } from "npm:@supabase/supabase-js@2";
import { getCallerUserId } from "../_shared/caller-user.ts";
import { handleCorsPreflightRequest, jsonResponse } from "../_shared/cors.ts";
import {
  instagramCsvCell,
  instagramUsername,
} from "../_shared/instagram-monitor.ts";

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
  missing_apify_token:
    "Добавьте APIFY_API_TOKEN в защищённые настройки Lovable.",
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
    const view = checked(
      await client.rpc("has_admin_section_access", {
        _user_id: userId,
        _section_code: "instagram-monitor",
        _min_level: "view",
      }),
    );
    if (view !== true) {
      return jsonResponse({ ok: false, message: "Нет доступа к разделу" }, 403);
    }
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
    const readonly = ["status", "comments", "export", "video"].includes(action);
    if (!readonly) {
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
    if (action === "status") {
      const [s, p, r, v, b] = await Promise.all([
        client.from("instagram_monitor_settings").select("*").single(),
        client.from("instagram_monitor_profiles").select("*").order(
          "created_at",
        ).limit(100),
        client.from("instagram_monitor_runs").select(
          "id,kind,status,created_at,cost_usd,error_code,provider_run_id",
        ).order("created_at", { ascending: false }).limit(50),
        client.from("instagram_monitor_reels").select("*").order("created_at", {
          ascending: false,
        }).limit(200),
        client.from("instagram_monitor_runs").select(
          "budget_month,reserved_usd,cost_usd",
        ).or(
          `reserved_usd.gt.0,budget_month.eq.${
            new Date().toISOString().slice(0, 7)
          }-01`,
        ),
      ]);
      const budget = checked(b);
      const settings = checked(s);
      result = {
        ...settings,
        connected: !!Deno.env.get("APIFY_API_TOKEN"),
        ai_connected: !!Deno.env.get("LOVABLE_API_KEY"),
        profiles: checked(p),
        runs: checked(r),
        reels: checked(v),
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
      const update: Record<string, boolean> = {};
      for (const key of ["enabled", "auto_monitor"]) {
        if (key in body) {
          if (typeof body[key] !== "boolean") {
            throw new Error("invalid_setting");
          }
          update[key] = body[key];
        }
      }
      if (update.enabled && !Deno.env.get("APIFY_API_TOKEN")) {
        throw new Error("missing_apify_token");
      }
      result = checked(
        await client.from("instagram_monitor_settings").update(update).eq(
          "id",
          true,
        ).select().single(),
      );
    } else if (["collect", "collect_comments", "transcribe"].includes(action)) {
      const settings = checked(
        await client.from("instagram_monitor_settings").select("enabled")
          .single(),
      );
      if (!settings.enabled) throw new Error("monitor_disabled");
      const kind = action === "collect"
        ? "reels"
        : action === "collect_comments"
        ? "comments"
        : "transcribe";
      if (kind !== "transcribe" && !Deno.env.get("APIFY_API_TOKEN")) {
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
    } else if (action === "comments" || action === "export") {
      if (body.reel_id) {
        const id = uuid(body.reel_id);
        const comments = checked(
          await client.from("instagram_monitor_comments").select(
            "id,text,username,posted_at",
          ).eq("reel_id", id).order("posted_at", { ascending: false }).limit(
            1000,
          ),
        );
        if (action === "comments") result = comments;
        else {
          const reel = checked(
            await client.from("instagram_monitor_reels").select(
              "post_url,comments_coverage,comments_count",
            ).eq("id", id).single(),
          );
          const rows = [
            [
              "Ролик",
              "Автор",
              "Комментарий",
              "Дата",
              "Покрытие",
              "Счётчик Instagram",
            ],
            ...comments.map((
              x: any,
            ) => [
              reel.post_url,
              x.username,
              x.text,
              x.posted_at,
              "Частичная выборка (до 15 на бесплатном тарифе)",
              reel.comments_count,
            ]),
          ];
          result = {
            csv: rows.map((row) => row.map(instagramCsvCell).join(";")).join(
              "\r\n",
            ),
          };
        }
      } else if (action === "export") {
        const reels = checked(
          await client.from("instagram_monitor_reels").select(
            "post_url,caption,published_at,transcript,summary,collected_comments_count,comments_count",
          ).order("created_at", { ascending: false }).limit(1000),
        );
        result = {
          csv: [
            [
              "Ролик",
              "Описание",
              "Дата",
              "Дословная расшифровка",
              "AI сводка",
              "Собрано комментариев",
              "Счётчик Instagram",
            ],
            ...reels.map((
              x: any,
            ) => [
              x.post_url,
              x.caption,
              x.published_at,
              x.transcript,
              x.summary,
              x.collected_comments_count,
              x.comments_count,
            ]),
          ].map((row) => row.map(instagramCsvCell).join(";")).join("\r\n"),
        };
      } else throw new Error("invalid_id");
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
