// ManyChat: discover pages by api_key (preflight read-only).
// Принимает либо { api_key } (create flow), либо { instance_id } (edit flow).
// При instance_id читает api_key из integration_instances.config_secrets.
// Ничего не пишет в БД, не обновляет status, не логирует секреты.
//
// DEBUG-ONLY: содержит структурированное логирование envelope ManyChat
// для отладки парсера. После закрытия proof понизить до debug-level
// или удалить блок logEnvelope().
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface DiscoverRequest {
  api_key?: string;
  instance_id?: string;
}

interface ManyChatPage {
  id: string;
  name: string;
  username?: string;
  is_pro?: boolean;
  timezone?: string;
}

type IdSource =
  | "id"
  | "page_id"
  | "facebook_page_id"
  | "fb_page_id"
  | "username"
  | "synthetic_hash";

interface NormalizedPageResult {
  page: ManyChatPage;
  id_source: IdSource;
  synthetic_id: boolean;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(
  errorCode: string,
  errorMessage: string,
  status = 200,
) {
  return jsonResponse(
    { success: false, error_code: errorCode, error_message: errorMessage },
    status,
  );
}

// ---------- Debug logger (no secrets) ----------
function safeBodyPreview(text: unknown): string {
  if (typeof text !== "string") return "<non-string-body>";
  if (text.length === 0) return "<empty>";
  // обрезаем агрессивно до 300 символов
  const sliced = text.slice(0, 300);
  return sliced.length < text.length ? sliced + "...[truncated]" : sliced;
}

function describeShape(v: unknown): "object" | "array" | "missing" | "primitive" {
  if (v === undefined || v === null) return "missing";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  return "primitive";
}

function logEnvelope(params: {
  request_mode: "api_key" | "instance_id";
  http_status: number;
  text: string;
}) {
  const { request_mode, http_status, text } = params;
  let payload: unknown = undefined;
  let parse_ok = false;
  try {
    payload = JSON.parse(text);
    parse_ok = true;
  } catch {
    parse_ok = false;
  }

  const meta: Record<string, unknown> = {
    tag: "manychat_discover_envelope",
    request_mode,
    http_status,
    parse_ok,
    body_preview_truncated: safeBodyPreview(text),
  };

  if (parse_ok && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const obj = payload as Record<string, unknown>;
    meta.top_level_keys = Object.keys(obj);
    meta.status_field = obj.status ?? null;
    const data = obj.data;
    meta.has_data = data !== undefined && data !== null;
    const shape = describeShape(data);
    meta.data_shape = shape;
    if (shape === "object") {
      meta.data_keys = Object.keys(data as Record<string, unknown>);
    } else if (shape === "array") {
      const arr = data as unknown[];
      meta.data_length = arr.length;
      const first = arr[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        meta.data_first_keys = Object.keys(first as Record<string, unknown>);
      }
    }
  } else if (parse_ok && Array.isArray(payload)) {
    meta.top_level_keys = "<array>";
    meta.data_length = payload.length;
    const first = payload[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      meta.data_first_keys = Object.keys(first as Record<string, unknown>);
    }
  } else {
    meta.top_level_keys = "<primitive_or_unparsable>";
  }

  console.log(JSON.stringify(meta));
}

// ---------- Envelope normalization ----------
function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v);
    }
  }
  return "";
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Резолвит id страницы по приоритету:
 *   1) реальные id-ключи (id, page_id, facebook_page_id, fb_page_id)
 *   2) username
 *   3) synthetic: mc:<sha256_first_24>(username || name|timezone|is_pro)
 *
 * Synthetic id детерминирован между вызовами и помечен префиксом mc:
 * чтобы downstream-код мог отличать его от реального FB numeric id.
 */
async function normalizePage(raw: unknown): Promise<NormalizedPageResult | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const name = pickString(r, ["name", "page_name", "title"]);
  const username = pickString(r, ["username", "page_username"]) || undefined;
  const timezone = pickString(r, ["timezone", "time_zone"]) || undefined;
  const is_pro =
    typeof r.is_pro === "boolean"
      ? r.is_pro
      : typeof r.pro === "boolean"
        ? r.pro
        : undefined;

  // Приоритет 1: реальные id-ключи
  const realIdKeys: { key: string; source: IdSource }[] = [
    { key: "id", source: "id" },
    { key: "page_id", source: "page_id" },
    { key: "facebook_page_id", source: "facebook_page_id" },
    { key: "fb_page_id", source: "fb_page_id" },
  ];
  for (const { key, source } of realIdKeys) {
    const v = r[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      const id = String(v).trim();
      return {
        page: { id, name: name || id, username, is_pro, timezone },
        id_source: source,
        synthetic_id: false,
      };
    }
  }

  // Приоритет 2: username (стабильный человекочитаемый идентификатор)
  if (username) {
    return {
      page: { id: `mc:${username}`, name: name || username, username, is_pro, timezone },
      id_source: "username",
      synthetic_id: true,
    };
  }

  // Приоритет 3: synthetic hash. Требуется как минимум name.
  if (!name) return null;
  const proPart = typeof is_pro === "boolean" ? String(is_pro) : "";
  const inputStr = `${name}|${timezone ?? ""}|${proPart}`;
  const hash = await sha256Hex(inputStr);
  const id = `mc:${hash.slice(0, 24)}`;
  return {
    page: { id, name, username, is_pro, timezone },
    id_source: "synthetic_hash",
    synthetic_id: true,
  };
}

/**
 * Поддерживаемые формы envelope ManyChat:
 *  - { status: "success", data: { id, name, ... } }
 *  - { data: { id, name, ... } }                       (без status)
 *  - { data: [ { id, name, ... }, ... ] }              (массив страниц)
 *  - { id, name, ... }                                  (плоский объект)
 *  - [ { id, name, ... }, ... ]                         (плоский массив)
 *
 * Возвращает массив только валидных страниц (с непустым id).
 */
async function extractManyChatPages(
  payload: unknown,
): Promise<{ pages: ManyChatPage[]; sources: IdSource[]; synthetic_flags: boolean[] }> {
  const candidates: unknown[] = [];

  if (Array.isArray(payload)) {
    candidates.push(...payload);
  } else if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const data = obj.data;
    if (Array.isArray(data)) {
      candidates.push(...data);
    } else if (data && typeof data === "object") {
      candidates.push(data);
    } else {
      // плоский объект-страница на верхнем уровне
      candidates.push(obj);
    }
  }

  const pages: ManyChatPage[] = [];
  const sources: IdSource[] = [];
  const synthetic_flags: boolean[] = [];
  for (const c of candidates) {
    const res = await normalizePage(c);
    if (res) {
      pages.push(res.page);
      sources.push(res.id_source);
      synthetic_flags.push(res.synthetic_id);
    }
  }
  return { pages, sources, synthetic_flags };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth: требуем авторизованного пользователя (admin UI)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("unauthorized", "Требуется авторизация", 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error: userError } =
    await supabaseAuth.auth.getUser(token);
  if (userError || !userData?.user) {
    return errorResponse("unauthorized", "Невалидный токен", 401);
  }

  let body: DiscoverRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse("bad_request", "Невалидный JSON", 400);
  }

  let apiKey = (body.api_key || "").trim();
  let requestMode: "api_key" | "instance_id" = apiKey ? "api_key" : "instance_id";

  // Если api_key не передан — пробуем взять из instance.config_secrets
  if (!apiKey && body.instance_id) {
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: inst, error: instErr } = await supabaseAdmin
      .from("integration_instances")
      .select("provider, config_secrets")
      .eq("id", body.instance_id)
      .maybeSingle();
    if (instErr || !inst) {
      return errorResponse("not_found", "Подключение не найдено");
    }
    if (inst.provider !== "manychat") {
      return errorResponse(
        "wrong_provider",
        "Это подключение не относится к ManyChat",
      );
    }
    const secrets = (inst.config_secrets as Record<string, unknown>) || {};
    apiKey = String(secrets.api_key || "").trim();
    if (!apiKey) {
      return errorResponse(
        "missing_secret",
        "API Key не сохранён для этого подключения",
      );
    }
    requestMode = "instance_id";
  }

  if (!apiKey) {
    return errorResponse("missing_api_key", "API Key обязателен");
  }

  // Вызов ManyChat API
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const resp = await fetch("https://api.manychat.com/fb/page/getInfo", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.status === 401 || resp.status === 403) {
      return errorResponse("invalid_api_key", "Неверный API Key ManyChat");
    }

    const text = await resp.text();

    // DEBUG-ONLY: structured envelope log (no secrets)
    logEnvelope({
      request_mode: requestMode,
      http_status: resp.status,
      text,
    });

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return errorResponse(
        "non_json",
        "ManyChat вернул не-JSON ответ",
      );
    }

    // Если есть явный статус ошибки — отдаём как unexpected
    if (
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      (payload as Record<string, unknown>).status === "error"
    ) {
      const msg =
        ((payload as Record<string, unknown>).message as string | undefined) ||
        "ManyChat вернул status=error";
      return errorResponse("unexpected_response", msg);
    }

    const pages = extractManyChatPages(payload);

    if (pages.length === 0) {
      return errorResponse(
        "unexpected_response",
        "Page ID отсутствует в ответе",
      );
    }

    return jsonResponse({ success: true, pages });
  } catch (err) {
    clearTimeout(timeout);
    const e = err as Error;
    if (e.name === "AbortError") {
      return errorResponse("timeout", "ManyChat не ответил за 10 секунд");
    }
    return errorResponse("network_error", `Сетевая ошибка: ${e.message}`);
  }
});
