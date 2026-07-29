import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveAssetClassifierAccess } from "../_shared/ai-access.ts";
import {
  ASSET_CLASSIFIER_SCENARIO_CODE,
  classifyAsset,
} from "../_shared/asset-classifier/engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_QUERY_CHARS = 4_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Необходима авторизация" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      throw new Error("Supabase environment is not configured");
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Неавторизованный доступ" }, 401);

    const body = await req.json().catch(() => ({}));
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (query.length < 3) {
      return json({ error: "Опишите объект минимум тремя символами" }, 400);
    }
    if (query.length > MAX_QUERY_CHARS) {
      return json({ error: `Описание не должно превышать ${MAX_QUERY_CHARS} символов` }, 400);
    }

    const service = createClient(supabaseUrl, serviceRoleKey);
    const allowed = await resolveAssetClassifierAccess(service, user.id);
    if (!allowed) {
      return json({
        error: "Сервис «Определение шифра ОС» не входит в ваши активные продукты.",
        denial_reason: "asset_classifier_not_in_products",
      }, 403);
    }

    const startedAt = Date.now();
    const result = classifyAsset(query);
    const conversationId =
      typeof body?.conversation_id === "string" && UUID_RE.test(body.conversation_id)
        ? body.conversation_id
        : crypto.randomUUID();
    const metadata = {
      ...result.metadata,
      launcher_title_snapshot: "Определение шифра ОС",
      processing_time_ms: Date.now() - startedAt,
    };

    const { error: saveError } = await service.from("ai_chat_messages").insert([
      {
        conversation_id: conversationId,
        user_id: user.id,
        role: "user",
        content: query,
        metadata: {
          ai_mode: "prompt",
          scenario_code: ASSET_CLASSIFIER_SCENARIO_CODE,
          scenario_type: "deterministic_lookup",
        },
      },
      {
        conversation_id: conversationId,
        user_id: user.id,
        role: "assistant",
        content: result.content,
        metadata,
      },
    ]);

    if (saveError) {
      console.error("asset-classifier history save error", saveError.code);
      return json({ error: "Не удалось сохранить результат подбора" }, 500);
    }

    return json({
      content: result.content,
      conversation_id: conversationId,
      metadata,
      candidates: result.candidates.map((candidate) => ({
        code: candidate.code,
        name: candidate.name,
        normative_life_years: candidate.normativeLifeYears,
      })),
    });
  } catch (error) {
    console.error("asset-classifier error", error);
    return json({ error: "Внутренняя ошибка сервиса определения шифра ОС" }, 500);
  }
});
