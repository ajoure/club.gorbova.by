// ManyChat: discover pages by api_key (preflight read-only).
// Принимает либо { api_key } (create flow), либо { instance_id } (edit flow).
// При instance_id читает api_key из integration_instances.config_secrets.
// Ничего не пишет в БД, не обновляет status, не логирует секреты.
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
  const { data: claimsData, error: claimsError } =
    await supabaseAuth.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return errorResponse("unauthorized", "Невалидный токен", 401);
  }

  let body: DiscoverRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse("bad_request", "Невалидный JSON", 400);
  }

  let apiKey = (body.api_key || "").trim();

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
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return errorResponse(
        "non_json",
        "ManyChat вернул не-JSON ответ",
      );
    }

    const env = payload as { status?: string; data?: Record<string, unknown> };
    if (env.status !== "success" || !env.data) {
      return errorResponse(
        "unexpected_response",
        "Неожиданный ответ ManyChat API",
      );
    }

    const d = env.data;
    const page: ManyChatPage = {
      id: String(d.id ?? ""),
      name: String(d.name ?? ""),
      username: d.username ? String(d.username) : undefined,
      is_pro: typeof d.is_pro === "boolean" ? d.is_pro : undefined,
      timezone: d.timezone ? String(d.timezone) : undefined,
    };

    if (!page.id) {
      return errorResponse(
        "unexpected_response",
        "Page ID отсутствует в ответе",
      );
    }

    return jsonResponse({ success: true, pages: [page] });
  } catch (err) {
    clearTimeout(timeout);
    const e = err as Error;
    if (e.name === "AbortError") {
      return errorResponse("timeout", "ManyChat не ответил за 10 секунд");
    }
    return errorResponse("network_error", `Сетевая ошибка: ${e.message}`);
  }
});
