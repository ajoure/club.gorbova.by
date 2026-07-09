/**
 * rr-test-simulate-webhook (admin-only, test mode)
 *
 * Собирает валидный (или намеренно повреждённый) payload для
 * rr-notification и вызывает эндпоинт. Секрет никогда не покидает
 * backend — подпись MD5 считается здесь, только hash уходит наружу.
 *
 * Только для external_id с префиксом rr_test_. Не трогает боевые таблицы.
 * Используется для runtime-проверок idempotency и bad-signature.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  handleCorsPreflightRequest,
  jsonResponse,
  errorResponse,
} from "../_shared/cors.ts";
import {
  createServiceClient,
  loadRRTestConfig,
} from "../_shared/rr/rr-config.ts";

async function md5Hex(input: string): Promise<string> {
  const mod = await import("npm:blueimp-md5@2.19.0");
  const md5 = (mod.default ?? mod) as (s: string) => string;
  return md5(input);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return errorResponse("unauthorized", 401);
  const jwt = authHeader.slice("Bearer ".length);
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(jwt);
  if (claimsErr || !claimsData?.claims?.sub) return errorResponse("unauthorized", 401);
  const userId = claimsData.claims.sub as string;

  const supabaseAdmin = createServiceClient();
  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "superadmin"])
    .maybeSingle();
  if (!roleRow) return errorResponse("forbidden_admin_only", 403);

  let payload: {
    external_id?: string;
    new_status?: string;
    mutate_sign?: boolean;
    event_type?: string;
  } = {};
  try { payload = await req.json(); } catch { payload = {}; }

  const externalId = String(payload.external_id ?? "").trim();
  const newStatus = String(payload.new_status ?? "").trim();
  const mutate = payload.mutate_sign === true;
  const eventType = String(payload.event_type ?? "order.updated").trim();

  if (!externalId.startsWith("rr_test_")) {
    return errorResponse("external_id_must_be_test", 400);
  }
  if (!newStatus) return errorResponse("new_status_required", 400);

  let cfg;
  try { cfg = await loadRRTestConfig(supabaseAdmin); }
  catch (e) { return errorResponse((e as Error).message, 400); }
  // cfg.mode === 'test' гарантированно.

  const salt = crypto.randomUUID().replace(/-/g, "");
  const validSign = await md5Hex(`${newStatus}_${cfg.secretKey}_${salt}`);
  const sign = mutate
    ? (validSign.slice(0, -1) + (validSign.endsWith("0") ? "1" : "0"))
    : validSign;

  const body = {
    id: externalId,
    type: eventType,
    newStatus,
    salt,
    sign,
  };

  const projectRef = (Deno.env.get("SUPABASE_URL") ?? "").match(
    /https:\/\/([^.]+)\.supabase\.co/,
  )?.[1];
  const url = projectRef
    ? `https://${projectRef}.supabase.co/functions/v1/rr-notification`
    : `${Deno.env.get("SUPABASE_URL")}/functions/v1/rr-notification`;

  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const respText = await res.text();
  let respJson: unknown;
  try { respJson = JSON.parse(respText); } catch { respJson = null; }

  return jsonResponse({
    success: true,
    external_id: externalId,
    mutate_sign: mutate,
    request: {
      new_status: newStatus,
      salt_short: salt.slice(0, 8),
      sign_short: sign.slice(0, 8),
    },
    response: {
      http_status: res.status,
      duration_ms: Date.now() - started,
      body: respJson ?? { text_short: respText.slice(0, 200) },
    },
  });
});
