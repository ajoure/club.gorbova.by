import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HOSTERBY_API_BASE = "https://serviceapi.hoster.by";

// ============================================================
// Типы
// ============================================================
type HosterCode =
  | "OK"
  | "UNAUTHORIZED"
  | "HOSTERBY_ROUTE_MISSING"
  | "HOSTERBY_520"
  | "TIMEOUT"
  | "EDGE_CRASH"
  | "KEYS_MISSING"
  | "NETWORK_ERROR";

interface HosterResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
  code?: HosterCode;
  auth_mode_used?: string;
}

interface HosterTokenResult {
  ok: boolean;
  accessToken?: string;
  userId?: number;
  dateExpires?: number;
  error?: string;
  code?: HosterCode;
}

// ============================================================
// SSRF Guard
// ============================================================
function isSsrfSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    const h = parsed.hostname.toLowerCase();
    if (h === "localhost" || h === "::1") return false;
    if (/^127\./.test(h)) return false;
    if (/^10\./.test(h)) return false;
    if (/^192\.168\./.test(h)) return false;
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return false;
    if (/^169\.254\./.test(h)) return false;
    if (/^100\.64\./.test(h)) return false;
    if (h === "metadata.google.internal") return false;
    return true;
  } catch {
    return false;
  }
}

function isDomainAllowed(url: string, allowlist: string[]): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return allowlist.some(
      (d) => hostname === d.toLowerCase() || hostname.endsWith("." + d.toLowerCase())
    );
  } catch {
    return false;
  }
}

// ============================================================
// normalizeHosterBody — распознаёт hoster.by-level коды в теле ответа
// ============================================================
function normalizeHosterBody(data: unknown): { code: HosterCode; ok: boolean } | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const httpCode = d.httpCode;
  const statusCode = d.statusCode;

  // httpCode=200 + statusCode=ok → OK
  if (httpCode === 200 && statusCode === "ok") return { code: "OK", ok: true };

  // httpCode=520 → hoster.by уровень (не edge-runtime)
  if (httpCode === 520) {
    const errMsg = (d.messageList as Record<string, unknown>)?.error as Record<string, string> | undefined;
    const unknownErr = errMsg?.unknown_error ?? "";
    if (unknownErr.includes("Matched route") || unknownErr.includes("handler")) {
      return { code: "HOSTERBY_ROUTE_MISSING", ok: false };
    }
    return { code: "HOSTERBY_520", ok: false };
  }

  // httpCode=401/403 → UNAUTHORIZED
  if (httpCode === 401 || httpCode === 403) return { code: "UNAUTHORIZED", ok: false };

  return null;
}

// ============================================================
// Шаг 1: Получить JWT access token через /service/account/create/token
// Headers: Access-Key + Secret-Key
// ============================================================
async function getAccessToken(
  accessKey: string,
  secretKey: string,
  timeoutMs = 15000
): Promise<HosterTokenResult> {
  const url = `${HOSTERBY_API_BASE}/service/account/create/token`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log(`[hosterby-api] Step1: POST /service/account/create/token (key_last4=${accessKey.slice(-4)})`);
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Access-Key": accessKey,
        "Secret-Key": secretKey,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    const text = await resp.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("[hosterby-api] Step1: невалидный JSON:", text.slice(0, 200));
      return { ok: false, error: "Невалидный JSON от /service/account/create/token", code: "HOSTERBY_520" };
    }

    const httpCode = (data as Record<string, unknown>)?.httpCode;
    const statusCode = (data as Record<string, unknown>)?.statusCode;

    console.log(`[hosterby-api] Step1: http=${resp.status} httpCode=${httpCode} statusCode=${statusCode}`);

    if (resp.status === 401 || httpCode === 401) {
      return { ok: false, error: "Неверные ключи (Access-Key или Secret-Key)", code: "UNAUTHORIZED" };
    }

    if (resp.status === 403 || httpCode === 403) {
      return { ok: false, error: "Доступ запрещён (403)", code: "UNAUTHORIZED" };
    }

    if (httpCode === 520) {
      const errMsg = (data?.messageList as Record<string, unknown>)?.error as Record<string, string> | undefined;
      const unknownErr = errMsg?.unknown_error ?? "";
      if (unknownErr.includes("Matched route") || unknownErr.includes("handler")) {
        return { ok: false, error: "Маршрут /service/account/create/token не найден", code: "HOSTERBY_ROUTE_MISSING" };
      }
      return { ok: false, error: `hoster.by 520: ${unknownErr}`, code: "HOSTERBY_520" };
    }

    // Успех: httpCode=200 + statusCode=ok
    if ((httpCode === 200 || resp.status === 200) && statusCode === "ok") {
      const payload = (data as Record<string, unknown>)?.payload as Record<string, unknown> | undefined;
      const accessToken = payload?.accessToken as string | undefined;
      if (!accessToken) {
        console.error("[hosterby-api] Step1: accessToken отсутствует в payload:", JSON.stringify(payload));
        return { ok: false, error: "accessToken отсутствует в ответе", code: "HOSTERBY_520" };
      }
      console.log(`[hosterby-api] Step1: OK, userId=${payload?.userId}, expires=${payload?.dateExpires}`);
      return {
        ok: true,
        accessToken,
        userId: payload?.userId as number | undefined,
        dateExpires: payload?.dateExpires as number | undefined,
      };
    }

    // Также попробуем без httpCode — некоторые API возвращают только payload
    if (resp.status === 200) {
      const payload = (data as Record<string, unknown>)?.payload as Record<string, unknown> | undefined;
      const accessToken = payload?.accessToken as string | undefined;
      if (accessToken) {
        console.log(`[hosterby-api] Step1: OK (без httpCode), userId=${payload?.userId}`);
        return {
          ok: true,
          accessToken,
          userId: payload?.userId as number | undefined,
          dateExpires: payload?.dateExpires as number | undefined,
        };
      }
    }

    return {
      ok: false,
      error: `Неожиданный ответ: httpCode=${httpCode}, status=${resp.status}`,
      code: "NETWORK_ERROR",
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "Timeout при получении access token", code: "TIMEOUT" };
    }
    return { ok: false, error: String(e), code: "NETWORK_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Низкоуровневый fetch-хелпер
// ============================================================
async function attemptHosterRequest(
  method: string,
  path: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const url = `${HOSTERBY_API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method,
      headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body || undefined,
      signal: controller.signal,
    });
    const text = await resp.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* keep as text */ }
    return { ok: resp.ok, status: resp.status, data };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, status: 0, data: null, error: "TIMEOUT" };
    }
    return { ok: false, status: 0, data: null, error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Шаг 2: Выполнить запрос к hoster.by API с Access-Token header
// ============================================================
async function hosterRequest(
  method: string,
  path: string,
  body: string,
  accessToken: string,
  timeoutMs = 15000
): Promise<HosterResult> {
  console.log(`[hosterby-api] Step2: ${method} ${path}`);

  const result = await attemptHosterRequest(method, path, body, {
    "Access-Token": accessToken,
  }, timeoutMs);

  if (result.error === "TIMEOUT") {
    return { ok: false, status: 0, data: null, error: "TIMEOUT", code: "TIMEOUT", auth_mode_used: "two-step" };
  }

  console.log(`[hosterby-api] Step2: ${method} ${path} → http=${result.status}`);

  const bodyNorm = normalizeHosterBody(result.data);
  if (bodyNorm?.ok) return { ...result, ok: true, code: "OK", auth_mode_used: "two-step" };
  if (bodyNorm && !bodyNorm.ok) return { ...result, ok: false, code: bodyNorm.code, auth_mode_used: "two-step" };

  if (result.status === 401 || result.status === 403) {
    return { ...result, ok: false, code: "UNAUTHORIZED", auth_mode_used: "two-step" };
  }

  if (result.ok) return { ...result, code: "OK", auth_mode_used: "two-step" };

  return {
    ok: false,
    status: result.status,
    data: result.data,
    error: result.error || `HTTP ${result.status}`,
    code: "NETWORK_ERROR",
    auth_mode_used: "two-step",
  };
}

// ============================================================
// Audit log helper (SYSTEM ACTOR / ADMIN ACTOR)
// ============================================================
async function writeAuditLog(
  supabaseAdmin: ReturnType<typeof createClient>,
  action: string,
  meta: Record<string, unknown>,
  actorUserId: string | null
): Promise<void> {
  await supabaseAdmin.from("audit_logs").insert({
    actor_user_id: actorUserId,
    actor_type: actorUserId ? "admin" : "system",
    actor_label: "hosterby-api",
    action,
    meta,
  });
}

// ============================================================
// fetch with timeout helper for egress checks
// ============================================================
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Main handler
// ============================================================
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const jsonResp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAuth = createClient(supabaseUrl, anonKey);
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // --- AUTH GUARD: superadmin only ---
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResp({ success: false, error: "Unauthorized" }, 401);
    }

    const token = authHeader.slice(7).trim();
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData?.user?.id) {
      return jsonResp({ success: false, error: "Invalid token" }, 401);
    }

    const userId = userData.user.id;

    const { data: isSuperAdmin, error: roleErr } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "superadmin",
    });

    if (roleErr) {
      return jsonResp({ success: false, error: "Role check failed" }, 500);
    }
    if (isSuperAdmin !== true) {
      return jsonResp({ success: false, error: "Superadmin access required" }, 403);
    }
    // --- END AUTH GUARD ---

    const body = await req.json();
    const { action, instance_id, dry_run = false, payload = {} } = body as {
      action: string;
      instance_id?: string;
      dry_run?: boolean;
      payload?: Record<string, unknown>;
    };

    console.log(`[hosterby-api] action=${action} instance_id=${instance_id} dry_run=${dry_run}`);

    // ---- Resolve hosterby instance ----
    let hosterInstance: Record<string, unknown> | null = null;

    if (action !== "save_hoster_keys" || instance_id) {
      const query = instance_id
        ? supabaseAdmin.from("integration_instances").select("id, config, status").eq("id", instance_id).single()
        : supabaseAdmin.from("integration_instances").select("id, config, status").eq("provider", "hosterby").eq("category", "other").maybeSingle();

      const { data: inst } = await query;
      hosterInstance = inst as Record<string, unknown> | null;
    }

    const instanceConfig = (hosterInstance?.config as Record<string, unknown>) ?? {};
    const accessKey = instanceConfig.cloud_access_key as string | undefined;
    const secretKey = instanceConfig.cloud_secret_key as string | undefined;

    // ================================================================
    switch (action) {

      // ---- test_connection -------------------------------------------
      case "test_connection": {
        if (!accessKey || !secretKey) {
          return jsonResp({ success: false, error: "API ключи не настроены", code: "KEYS_MISSING" });
        }

        // Шаг 1: получить JWT
        const tokenResult = await getAccessToken(accessKey, secretKey);
        if (!tokenResult.ok || !tokenResult.accessToken) {
          return jsonResp({
            success: false,
            code: tokenResult.code ?? "NETWORK_ERROR",
            error: tokenResult.error ?? "Ошибка получения токена",
          endpoint_used: "/service/account/create/token",
            auth_mode_used: "two-step",
            access_key_last4: accessKey.slice(-4),
          });
        }

        // Шаг 2: GET /cloud/orders с JWT
        const result = await hosterRequest("GET", "/cloud/orders", "", tokenResult.accessToken);

        if (result.code === "TIMEOUT") {
          return jsonResp({
            success: false,
            error: "Timeout при подключении к hoster.by",
            code: "TIMEOUT",
            endpoint_used: "/cloud/orders",
            auth_mode_used: "two-step",
          });
        }

        if (!result.ok) {
          const code = result.code ?? "NETWORK_ERROR";
          let userError = `hoster.by API вернул HTTP ${result.status}`;
          if (code === "UNAUTHORIZED") userError = "Ключи не подходят или нет доступа (UNAUTHORIZED)";
          else if (code === "HOSTERBY_ROUTE_MISSING") userError = "Неверный endpoint/маршрут hoster.by API";
          else if (code === "HOSTERBY_520") userError = "Ошибка hoster.by API (520)";
          return jsonResp({
            success: false,
            error: userError,
            code,
            endpoint_used: "/cloud/orders",
            auth_mode_used: "two-step",
            access_key_last4: accessKey.slice(-4),
          });
        }

        // Парсим реальный ответ /cloud/orders
        const d = result.data as Record<string, unknown> | null;
        const orders = (d?.payload as Record<string, unknown>)?.orders;
        const ordersCount = Array.isArray(orders) ? orders.length : 0;

        const metadata = {
          orders_count: ordersCount,
          keys_configured: true,
          cloud_access_key_last4: accessKey.slice(-4),
          endpoint_used: "/cloud/orders",
          auth_mode_used: "two-step",
        };

        // Update instance metadata (без ключей)
        if (hosterInstance?.id) {
          await supabaseAdmin.from("integration_instances").update({
            status: "connected",
            last_check_at: new Date().toISOString(),
            error_message: null,
            config: {
              ...instanceConfig,
              orders_count: ordersCount,
              auth_mode_used: "two-step",
              last_check_meta: metadata,
            },
          }).eq("id", hosterInstance.id as string);
        }

        return jsonResp({
          success: true,
          data: metadata,
          code: "OK",
          endpoint_used: "/cloud/orders",
          auth_mode_used: "two-step",
          orders_count: ordersCount,
          access_key_last4: accessKey.slice(-4),
        });
      }

      // ---- list_vms -------------------------------------------------
      case "list_vms": {
        if (!accessKey || !secretKey) {
          return jsonResp({ success: false, error: "API ключи не настроены", code: "KEYS_MISSING" });
        }

        // Шаг 1: JWT
        const tokenResult = await getAccessToken(accessKey, secretKey);
        if (!tokenResult.ok || !tokenResult.accessToken) {
          return jsonResp({
            success: false,
            code: tokenResult.code ?? "NETWORK_ERROR",
            error: tokenResult.error ?? "Ошибка получения токена",
            auth_mode_used: "two-step",
          });
        }

        const cloudId = payload.cloud_id as string | undefined;
        let orderId = cloudId;
        let ordersCount = 0;

        // Если cloud_id не передан — получаем список облаков и берём первый orderId
        if (!orderId) {
          const ordersResult = await hosterRequest("GET", "/cloud/orders", "", tokenResult.accessToken);
          if (!ordersResult.ok) {
            const code = ordersResult.code ?? "NETWORK_ERROR";
            return jsonResp({ success: false, error: `Ошибка получения списка облаков: ${code}`, code, auth_mode_used: "two-step" });
          }
          const ordersData = ordersResult.data as Record<string, unknown> | null;
          const ordersList = (ordersData?.payload as Record<string, unknown>)?.orders;
          const orders = Array.isArray(ordersList) ? ordersList : [];
          ordersCount = orders.length;
          if (!orders.length) {
            return jsonResp({ success: true, vms: [], orders_count: 0, cloud_id_used: null, auth_mode_used: "two-step" });
          }
          orderId = String((orders[0] as Record<string, unknown>).id);
        }

        const vmsResult = await hosterRequest("GET", `/cloud/orders/${orderId}/vm`, "", tokenResult.accessToken);
        if (!vmsResult.ok) {
          const code = vmsResult.code ?? "NETWORK_ERROR";
          return jsonResp({ success: false, error: `Ошибка получения VM: ${code}`, code, auth_mode_used: "two-step" });
        }

        const vmsData = vmsResult.data as Record<string, unknown> | null;

        // P1: safe debug logging (only when debug=true or dry_run=true)
        const debugMode = payload.debug === true || payload.dry_run === true;
        if (debugMode) {
          const topKeys = vmsData ? Object.keys(vmsData) : [];
          const payloadObj = (vmsData?.payload as Record<string, unknown>) ?? {};
          const payloadKeys = Object.keys(payloadObj);
          console.log(`[hosterby-api] DEBUG list_vms: topKeys=${JSON.stringify(topKeys)} payloadKeys=${JSON.stringify(payloadKeys)}`);
          // Log first 2 items of any found array (truncated, no secrets)
          for (const k of payloadKeys) {
            const val = payloadObj[k];
            if (Array.isArray(val) && val.length > 0) {
              const sample = val.slice(0, 2).map((item: unknown) => {
                const s = JSON.stringify(item);
                return s.length > 500 ? s.slice(0, 500) + "…" : s;
              });
              console.log(`[hosterby-api] DEBUG list_vms: payload.${k} (len=${val.length}) sample=${JSON.stringify(sample)}`);
            }
          }
        }

        // P2: универсальный парсинг массива VM
        const payloadData = (vmsData?.payload as Record<string, unknown>) ?? vmsData ?? {};
        let vmCandidate = payloadData.vms ?? payloadData.vm ?? payloadData.servers ?? payloadData.items ?? payloadData.virtualMachines ?? payloadData.data;
        if (!Array.isArray(vmCandidate)) {
          vmCandidate = (payloadData.result as Record<string, unknown>)?.vms ?? (payloadData.response as Record<string, unknown>)?.vms;
        }
        const vms = Array.isArray(vmCandidate) ? vmCandidate : [];

        // P3: универсальный маппинг полей VM
        // deno-lint-ignore no-explicit-any
        const extractOs = (raw: any): string | undefined => {
          if (raw == null) return undefined;
          if (typeof raw === 'string') return raw;
          if (typeof raw === 'object' && raw.name) return String(raw.name);
          return String(raw);
        };
        const safevms = vms.map((v: Record<string, unknown>) => ({
          id: v.id ?? v.vm_id ?? v.vmId ?? v.server_id,
          name: v.name ?? v.hostname ?? v.label ?? v.title,
          status: v.status ?? v.state,
          public_ip: v.public_ip ?? v.publicIp ?? v.ip ?? v.ipv4 ?? v.main_ip,
          cpu: v.cpu ?? v.vcpu ?? v.cores,
          ram: v.ram ?? v.memory ?? v.mem,
          os: extractOs(v.os) ?? extractOs(v.image) ?? extractOs(v.template) ?? extractOs(v.distribution),
        }));

        return jsonResp({ success: true, vms: safevms, orders_count: ordersCount, cloud_id_used: orderId, auth_mode_used: "two-step", endpoint_used: `/cloud/orders/${orderId}/vm` });
      }

      // ---- save_hoster_keys -----------------------------------------
      case "save_hoster_keys": {
        const newAccessKey = payload.cloud_access_key as string | undefined;
        const newSecretKey = payload.cloud_secret_key as string | undefined;
        const newDnsAccessKey = payload.dns_access_key as string | undefined;
        const newDnsSecretKey = payload.dns_secret_key as string | undefined;
        const alias = (payload.alias as string | undefined) || "hoster.by";
        const skipValidation = payload.skip_validation === true;
        const errorMessage = payload.error_message as string | undefined;

        if (!newAccessKey || !newSecretKey) {
          return jsonResp({ success: false, error: "cloud_access_key и cloud_secret_key обязательны", code: "KEYS_MISSING" });
        }

        if (newAccessKey.length < 8 || newSecretKey.length < 8) {
          return jsonResp({ success: false, error: "Ключи слишком короткие (мин. 8 символов)" });
        }

        let ordersCount = 0;

        if (!skipValidation) {
          // Шаг 1: получить JWT для новых ключей
          const tokenResult = await getAccessToken(newAccessKey, newSecretKey);
          if (!tokenResult.ok || !tokenResult.accessToken) {
            const code = tokenResult.code ?? "NETWORK_ERROR";
            let errMsg = `Ключи не прошли проверку (${code})`;
            if (code === "UNAUTHORIZED") errMsg = "Ключи не подходят или нет доступа";
            else if (code === "HOSTERBY_ROUTE_MISSING") errMsg = "Неверный маршрут hoster.by API (token/create)";
            else if (code === "HOSTERBY_520") errMsg = "Ошибка hoster.by API (520) при получении токена";
            else if (code === "TIMEOUT") errMsg = "Timeout при получении токена";
            return jsonResp({
              success: false,
              error: errMsg,
              code,
              endpoint_used: "/service/account/create/token",
              auth_mode_used: "two-step",
            });
          }

          // Шаг 2: проверить /cloud/orders с JWT
          const testResult = await hosterRequest("GET", "/cloud/orders", "", tokenResult.accessToken);

          if (!testResult.ok) {
            const code = testResult.code ?? "NETWORK_ERROR";
            let errMsg = `Ключи не прошли проверку (${code})`;
            if (code === "UNAUTHORIZED") errMsg = "Ключи не подходят или нет доступа";
            else if (code === "HOSTERBY_ROUTE_MISSING") errMsg = "Неверный маршрут hoster.by API";
            else if (code === "HOSTERBY_520") errMsg = "Ошибка hoster.by API (520)";
            else if (code === "TIMEOUT") errMsg = "Timeout при проверке ключей";
            return jsonResp({
              success: false,
              error: errMsg,
              code,
              endpoint_used: "/cloud/orders",
              auth_mode_used: "two-step",
            });
          }

          // Парсим orders_count
          const testData = testResult.data as Record<string, unknown> | null;
          const testOrders = (testData?.payload as Record<string, unknown>)?.orders;
          ordersCount = Array.isArray(testOrders) ? testOrders.length : 0;
        }

        if (dry_run) {
          return jsonResp({
            success: true,
            dry_run: true,
            dry_run_result: skipValidation ? "keys_saved_without_validation" : "keys_valid",
            orders_count: ordersCount,
            cloud_access_key_last4: newAccessKey.slice(-4),
            cloud_secret_key_last4: newSecretKey.slice(-4),
            endpoint_used: skipValidation ? "none" : "/cloud/orders",
            auth_mode_used: skipValidation ? "skip" : "two-step",
            code: "OK",
          });
        }

        const saveStatus = skipValidation ? "error" : "connected";
        const saveErrorMessage = skipValidation ? (errorMessage || "Ключи сохранены без проверки") : null;

        // Execute: save to DB (JWT не сохраняем — он краткоживущий)
        const configToSave: Record<string, unknown> = {
          cloud_access_key: newAccessKey,
          cloud_secret_key: newSecretKey,
          cloud_access_key_last4: newAccessKey.slice(-4),
          cloud_secret_key_last4: newSecretKey.slice(-4),
          keys_configured: true,
          orders_count: ordersCount,
          auth_mode_used: skipValidation ? "skip" : "two-step",
        };
        if (newDnsAccessKey) {
          configToSave.dns_access_key = newDnsAccessKey;
          configToSave.dns_access_key_last4 = newDnsAccessKey.slice(-4);
        }
        if (newDnsSecretKey) {
          configToSave.dns_secret_key = newDnsSecretKey;
          configToSave.dns_secret_key_last4 = newDnsSecretKey.slice(-4);
        }

        // Merge с egress config если есть
        if (instanceConfig.egress_base_url) {
          configToSave.egress_base_url = instanceConfig.egress_base_url;
          configToSave.egress_token = instanceConfig.egress_token;
          configToSave.egress_token_last4 = instanceConfig.egress_token_last4;
          configToSave.egress_allowlist = instanceConfig.egress_allowlist;
          configToSave.egress_enabled = instanceConfig.egress_enabled;
        }

        let savedInstanceId: string;
        if (hosterInstance?.id) {
          await supabaseAdmin.from("integration_instances").update({
            config: configToSave,
            status: saveStatus,
            last_check_at: new Date().toISOString(),
            error_message: saveErrorMessage,
            alias,
          }).eq("id", hosterInstance.id as string);
          savedInstanceId = hosterInstance.id as string;
        } else {
          const { data: created, error: createErr } = await supabaseAdmin
            .from("integration_instances")
            .insert({
              category: "other",
              provider: "hosterby",
              alias,
              is_default: true,
              status: saveStatus,
              last_check_at: new Date().toISOString(),
              config: configToSave,
              error_message: saveErrorMessage,
            })
            .select("id")
            .single();
          if (createErr || !created) {
            return jsonResp({ success: false, error: "Ошибка сохранения: " + (createErr?.message ?? "unknown") });
          }
          savedInstanceId = created.id;
        }

        // SYSTEM ACTOR Proof: actor_type='system', actor_user_id=NULL
        await writeAuditLog(supabaseAdmin, "hosterby.save_keys", {
          instance_id: savedInstanceId,
          cloud_access_key_last4: newAccessKey.slice(-4),
          orders_count: ordersCount,
          dns_configured: !!(newDnsAccessKey && newDnsSecretKey),
          auth_mode_used: skipValidation ? "skip" : "two-step",
          endpoint_used: skipValidation ? "none" : "/cloud/orders",
          skip_validation: skipValidation,
        }, null);

        return jsonResp({
          success: true,
          code: "OK",
          instance_id: savedInstanceId,
          orders_count: ordersCount,
          cloud_access_key_last4: newAccessKey.slice(-4),
          cloud_secret_key_last4: newSecretKey.slice(-4),
          auth_mode_used: skipValidation ? "skip" : "two-step",
          endpoint_used: skipValidation ? "none" : "/cloud/orders",
          skip_validation: skipValidation,
        });
      }

      // ---- by_egress_check_health -----------------------------------
      case "by_egress_check_health": {
        const baseUrl = (payload.base_url as string | undefined) || (instanceConfig.egress_base_url as string | undefined);
        if (!baseUrl) {
          return jsonResp({ success: false, error: "BY_EGRESS_BASE_URL не задан" });
        }

        if (!isSsrfSafe(baseUrl)) {
          return jsonResp({ success: false, error: "SSRF_BLOCKED: URL указывает на внутренний адрес" });
        }

        try {
          const resp = await fetchWithTimeout(`${baseUrl}/health`, {}, 10000);
          return jsonResp({
            success: resp.ok,
            http_status: resp.status,
            message: resp.ok ? "Fetch-service доступен" : `HTTP ${resp.status}`,
          });
        } catch (e) {
          return jsonResp({
            success: false,
            error: e instanceof Error && e.name === "AbortError" ? "TIMEOUT" : String(e),
          });
        }
      }

      // ---- by_egress_test_url --------------------------------------
      case "by_egress_test_url": {
        const baseUrl = (payload.base_url as string | undefined) || (instanceConfig.egress_base_url as string | undefined);
        const egressToken = (payload.token as string | undefined) || (instanceConfig.egress_token as string | undefined);
        const targetUrl = payload.target_url as string | undefined;
        const rawAllowlist = (payload.allowlist as string | undefined) || (instanceConfig.egress_allowlist as string | undefined) || "";
        const allowlist = rawAllowlist.split(",").map((d: string) => d.trim()).filter(Boolean);

        if (!baseUrl || !targetUrl) {
          return jsonResp({ success: false, error: "Обязательные поля: base_url, target_url" });
        }
        if (!egressToken) {
          return jsonResp({ success: false, code: "TOKEN_MISSING", error: "BY_EGRESS_TOKEN не задан. Введите токен или сохраните конфигурацию egress." });
        }

        if (!isSsrfSafe(baseUrl)) {
          return jsonResp({ success: false, error: "SSRF_BLOCKED: egress base_url внутренний" });
        }

        if (allowlist.length > 0 && !isDomainAllowed(targetUrl, allowlist)) {
          return jsonResp({
            success: false,
            error: `Домен не в allowlist. Allowlist: ${allowlist.join(", ")}`,
            code: "NOT_IN_ALLOWLIST",
          });
        }

        try {
          const resp = await fetchWithTimeout(`${baseUrl}/fetch`, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${egressToken}`,
              "X-Target-URL": targetUrl,
            },
          }, 15000);

          return jsonResp({
            success: resp.ok || resp.status === 301 || resp.status === 302,
            http_status: resp.status,
            content_length: resp.headers.get("content-length") || "unknown",
            target_domain: new URL(targetUrl).hostname,
          });
        } catch (e) {
          return jsonResp({
            success: false,
            error: e instanceof Error && e.name === "AbortError" ? "TIMEOUT" : String(e),
          });
        }
      }

      // ---- by_egress_save_config -----------------------------------
      case "by_egress_save_config": {
        const egressBaseUrl = payload.egress_base_url as string | undefined;
        const egressTokenNew = payload.egress_token as string | undefined;
        const egressToken = egressTokenNew || (instanceConfig.egress_token as string | undefined);
        const egressTokenLast4 =
          egressTokenNew
            ? egressTokenNew.slice(-4)
            : (instanceConfig.egress_token_last4 as string | undefined)
              ?? (instanceConfig.egress_token ? String(instanceConfig.egress_token).slice(-4) : "????");
        const egressAllowlist = payload.egress_allowlist as string | undefined;
        const egressEnabled = payload.egress_enabled !== false;

        if (!egressBaseUrl) {
          return jsonResp({ success: false, error: "egress_base_url обязателен" });
        }
        if (!egressToken) {
          return jsonResp({ success: false, code: "TOKEN_MISSING", error: "BY_EGRESS_TOKEN не задан. Введите токен в форме." });
        }

        if (!isSsrfSafe(egressBaseUrl)) {
          return jsonResp({ success: false, error: "SSRF_BLOCKED: egress_base_url внутренний" });
        }

        if (dry_run) {
          return jsonResp({
            success: true,
            dry_run: true,
            dry_run_result: {
              egress_base_url: egressBaseUrl,
              egress_token_last4: egressTokenLast4,
              egress_allowlist: egressAllowlist,
              egress_enabled: egressEnabled,
            },
          });
        }

        if (!hosterInstance?.id) {
          return jsonResp({ success: false, error: "Сначала сохраните API ключи hoster.by" });
        }

        const updatedConfig = {
          ...instanceConfig,
          egress_base_url: egressBaseUrl,
          egress_token: egressToken,
          egress_token_last4: egressTokenLast4,
          egress_allowlist: egressAllowlist || "nbrb.by,nalog.gov.by,ssf.gov.by,kgk.gov.by,gtk.gov.by,minfin.gov.by,economy.gov.by,pravo.by",
          egress_enabled: egressEnabled,
        };

        await supabaseAdmin.from("integration_instances").update({
          config: updatedConfig,
        }).eq("id", hosterInstance.id as string);

        await writeAuditLog(supabaseAdmin, "hosterby.by_egress_config_saved", {
          instance_id: hosterInstance.id,
          egress_base_url: egressBaseUrl,
          egress_token_last4: egressTokenLast4,
          egress_enabled: egressEnabled,
          token_changed: !!egressTokenNew,
        }, null); // SYSTEM ACTOR

        return jsonResp({ success: true, egress_token_last4: egressTokenLast4, egress_enabled: egressEnabled });
      }

      // ---- by_egress_toggle ----------------------------------------
      case "by_egress_toggle": {
        const enabled = payload.enabled as boolean;
        if (typeof enabled !== "boolean") {
          return jsonResp({ success: false, error: "enabled должен быть boolean" });
        }
        if (!hosterInstance?.id) {
          return jsonResp({ success: false, error: "hoster.by instance не найден" });
        }

        await supabaseAdmin.from("integration_instances").update({
          config: { ...instanceConfig, egress_enabled: enabled },
        }).eq("id", hosterInstance.id as string);

        await writeAuditLog(supabaseAdmin, "hosterby.by_egress_enabled_toggled", {
          instance_id: hosterInstance.id,
          egress_enabled: enabled,
        }, userId);

        return jsonResp({ success: true, egress_enabled: enabled });
      }

      // ---- cloud_order_detail ----------------------------------------
      case "cloud_order_detail": {
        if (!accessKey || !secretKey) {
          return jsonResp({ success: false, error: "Cloud API ключи не настроены", code: "KEYS_MISSING" });
        }
        const tokenRes = await getAccessToken(accessKey, secretKey);
        if (!tokenRes.ok || !tokenRes.accessToken) {
          return jsonResp({ success: false, error: tokenRes.error, code: tokenRes.code });
        }
        const orderId = payload.order_id as string;
        if (!orderId) return jsonResp({ success: false, error: "order_id обязателен" });
        const res = await hosterRequest("GET", `/cloud/orders/${orderId}/`, "", tokenRes.accessToken);
        if (!res.ok) return jsonResp({ success: false, error: `Ошибка: ${res.code}`, code: res.code });
        return jsonResp({ success: true, data: (res.data as Record<string, unknown>)?.payload ?? res.data });
      }

      // ---- cloud_balance ---------------------------------------------
      case "cloud_balance": {
        if (!accessKey || !secretKey) {
          return jsonResp({ success: false, error: "Cloud API ключи не настроены", code: "KEYS_MISSING" });
        }
        const tokenRes = await getAccessToken(accessKey, secretKey);
        if (!tokenRes.ok || !tokenRes.accessToken) {
          return jsonResp({ success: false, error: tokenRes.error, code: tokenRes.code });
        }
        const orderId = payload.order_id as string | undefined;
        const path = orderId ? `/cloud/orders/${orderId}/balance` : `/cloud/orders/balance`;
        const res = await hosterRequest("GET", path, "", tokenRes.accessToken);
        if (!res.ok) return jsonResp({ success: false, error: `Ошибка: ${res.code}`, code: res.code });
        return jsonResp({ success: true, data: (res.data as Record<string, unknown>)?.payload ?? res.data });
      }

      // ---- vm_detail -------------------------------------------------
      case "vm_detail": {
        if (!accessKey || !secretKey) {
          return jsonResp({ success: false, error: "Cloud API ключи не настроены", code: "KEYS_MISSING" });
        }
        const tokenRes = await getAccessToken(accessKey, secretKey);
        if (!tokenRes.ok || !tokenRes.accessToken) {
          return jsonResp({ success: false, error: tokenRes.error, code: tokenRes.code });
        }
        const orderId = payload.order_id as string;
        const vmId = payload.vm_id as string;
        if (!orderId || !vmId) return jsonResp({ success: false, error: "order_id и vm_id обязательны" });
        // P4: попробовать основной путь, если не OK — с trailing slash
        let endpointUsed = `/cloud/orders/${orderId}/vm/${vmId}`;
        let res = await hosterRequest("GET", endpointUsed, "", tokenRes.accessToken);
        if (!res.ok) {
          const altPath = `/cloud/orders/${orderId}/vm/${vmId}/`;
          const altRes = await hosterRequest("GET", altPath, "", tokenRes.accessToken);
          if (altRes.ok) {
            res = altRes;
            endpointUsed = altPath;
          }
        }
        if (!res.ok) return jsonResp({ success: false, error: `Ошибка: ${res.code}`, code: res.code, endpoint_used: endpointUsed });
        return jsonResp({ success: true, data: (res.data as Record<string, unknown>)?.payload ?? res.data, endpoint_used: endpointUsed });
      }

      // ---- vm_start / vm_stop / vm_reboot / vm_reset / vm_shutdown ---
      case "vm_start":
      case "vm_stop":
      case "vm_reboot":
      case "vm_reset":
      case "vm_shutdown": {
        if (!accessKey || !secretKey) {
          return jsonResp({ success: false, error: "Cloud API ключи не настроены", code: "KEYS_MISSING" });
        }
        const tokenRes = await getAccessToken(accessKey, secretKey);
        if (!tokenRes.ok || !tokenRes.accessToken) {
          return jsonResp({ success: false, error: tokenRes.error, code: tokenRes.code });
        }
        const orderId = payload.order_id as string;
        const vmId = payload.vm_id as string;
        if (!orderId || !vmId) return jsonResp({ success: false, error: "order_id и vm_id обязательны" });

        const vmAction = action.replace("vm_", ""); // start|stop|reboot|reset|shutdown
        const res = await hosterRequest("PATCH", `/cloud/orders/${orderId}/vm/${vmId}/${vmAction}`, "", tokenRes.accessToken);

        await writeAuditLog(supabaseAdmin, `hosterby.${action}`, {
          instance_id: hosterInstance?.id,
          order_id: orderId,
          vm_id: vmId,
          result_ok: res.ok,
          result_code: res.code,
        }, userId);

        if (!res.ok) return jsonResp({ success: false, error: `Ошибка: ${res.code}`, code: res.code });
        return jsonResp({ success: true, data: (res.data as Record<string, unknown>)?.payload ?? res.data });
      }

      // ---- list_dns_orders -------------------------------------------
      case "list_dns_orders": {
        const dnsAK = (instanceConfig.dns_access_key as string) || accessKey;
        const dnsSK = (instanceConfig.dns_secret_key as string) || secretKey;
        if (!dnsAK || !dnsSK) {
          return jsonResp({ success: false, error: "DNS API ключи не настроены", code: "KEYS_MISSING" });
        }
        const tokenRes = await getAccessToken(dnsAK, dnsSK);
        if (!tokenRes.ok || !tokenRes.accessToken) {
          return jsonResp({ success: false, error: tokenRes.error, code: tokenRes.code });
        }
        const res = await hosterRequest("GET", "/dns/orders", "", tokenRes.accessToken);
        if (!res.ok) return jsonResp({ success: false, error: `Ошибка: ${res.code}`, code: res.code });
        return jsonResp({ success: true, data: (res.data as Record<string, unknown>)?.payload ?? res.data });
      }

      // ---- dns_order_detail ------------------------------------------
      case "dns_order_detail": {
        const dnsAK = (instanceConfig.dns_access_key as string) || accessKey;
        const dnsSK = (instanceConfig.dns_secret_key as string) || secretKey;
        if (!dnsAK || !dnsSK) {
          return jsonResp({ success: false, error: "DNS API ключи не настроены", code: "KEYS_MISSING" });
        }
        const tokenRes = await getAccessToken(dnsAK, dnsSK);
        if (!tokenRes.ok || !tokenRes.accessToken) {
          return jsonResp({ success: false, error: tokenRes.error, code: tokenRes.code });
        }
        const orderId = payload.order_id as string;
        if (!orderId) return jsonResp({ success: false, error: "order_id обязателен" });
        const res = await hosterRequest("GET", `/dns/orders/${orderId}/`, "", tokenRes.accessToken);
        if (!res.ok) return jsonResp({ success: false, error: `Ошибка: ${res.code}`, code: res.code });
        return jsonResp({ success: true, data: (res.data as Record<string, unknown>)?.payload ?? res.data });
      }

      // ---- list_dns_records ------------------------------------------
      case "list_dns_records": {
        const dnsAK = (instanceConfig.dns_access_key as string) || accessKey;
        const dnsSK = (instanceConfig.dns_secret_key as string) || secretKey;
        if (!dnsAK || !dnsSK) {
          return jsonResp({ success: false, error: "DNS API ключи не настроены", code: "KEYS_MISSING" });
        }
        const tokenRes = await getAccessToken(dnsAK, dnsSK);
        if (!tokenRes.ok || !tokenRes.accessToken) {
          return jsonResp({ success: false, error: tokenRes.error, code: tokenRes.code });
        }
        const orderId = payload.order_id as string;
        if (!orderId) return jsonResp({ success: false, error: "order_id обязателен" });
        const res = await hosterRequest("GET", `/dns/orders/${orderId}/records`, "", tokenRes.accessToken);
        if (!res.ok) return jsonResp({ success: false, error: `Ошибка: ${res.code}`, code: res.code });
        return jsonResp({ success: true, data: (res.data as Record<string, unknown>)?.payload ?? res.data });
      }

      // ---- add_dns_a_record ------------------------------------------
      case "add_dns_a_record": {
        const dnsAK = (instanceConfig.dns_access_key as string) || accessKey;
        const dnsSK = (instanceConfig.dns_secret_key as string) || secretKey;
        if (!dnsAK || !dnsSK) {
          return jsonResp({ success: false, error: "DNS API ключи не настроены", code: "KEYS_MISSING" });
        }
        const tokenRes = await getAccessToken(dnsAK, dnsSK);
        if (!tokenRes.ok || !tokenRes.accessToken) {
          return jsonResp({ success: false, error: tokenRes.error, code: tokenRes.code });
        }
        const orderId = payload.order_id as string;
        const name = payload.name as string;
        const content = payload.content as string;
        const ttl = (payload.ttl as number) || 3600;
        const disabled = (payload.disabled as boolean) || false;
        if (!orderId || !name || !content) {
          return jsonResp({ success: false, error: "order_id, name и content (IP) обязательны" });
        }
        // Validate IP format
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipRegex.test(content)) {
          return jsonResp({ success: false, error: "content должен быть валидным IPv4 адресом" });
        }

        // hoster.by DNS API: POST /dns/orders/{id}/records/a with { name, ttl, records: [{ content, disabled }] }
        const fqdn = name.endsWith(".") ? name : `${name}.`;
        const recordBody = JSON.stringify({
          name: fqdn,
          ttl,
          records: [{ content, disabled }],
        });
        const res = await hosterRequest("POST", `/dns/orders/${orderId}/records/a`, recordBody, tokenRes.accessToken);

        await writeAuditLog(supabaseAdmin, "hosterby.add_dns_a_record", {
          instance_id: hosterInstance?.id,
          order_id: orderId,
          name,
          content,
          ttl,
          result_ok: res.ok,
          result_code: res.code,
        }, userId);

        if (!res.ok) return jsonResp({ success: false, error: `Ошибка: ${res.code}`, code: res.code });
        return jsonResp({ success: true, data: (res.data as Record<string, unknown>)?.payload ?? res.data });
      }

      // ================================================================
      // Gotenberg DOCX→PDF actions (C5-J)
      // ================================================================
      case "gotenberg_get_status": {
        const { maskGotenbergConfig } = await import("../_shared/gotenberg.ts");
        return jsonResp({ success: true, status: maskGotenbergConfig(instanceConfig) });
      }

      case "gotenberg_save_config": {
        const url = (payload.gotenberg_url as string | undefined)?.trim();
        const basicUser = (payload.gotenberg_basic_user as string | undefined)?.trim();
        const basicPassNew = payload.gotenberg_basic_pass as string | undefined;
        const enabled = payload.gotenberg_enabled !== false;
        if (!url) return jsonResp({ success: false, error: "gotenberg_url обязателен" });
        try {
          const u = new URL(url);
          if (u.protocol !== "https:" && u.protocol !== "http:") {
            return jsonResp({ success: false, error: "URL должен быть http(s)" });
          }
        } catch {
          return jsonResp({ success: false, error: "Некорректный URL" });
        }
        if (!isSsrfSafe(url)) {
          return jsonResp({ success: false, error: "SSRF_BLOCKED: URL внутренний" });
        }
        const basicPass = basicPassNew && basicPassNew.length > 0
          ? basicPassNew
          : (instanceConfig.gotenberg_basic_pass as string | undefined);

        const newConfig: Record<string, unknown> = {
          ...instanceConfig,
          gotenberg_url: url,
          gotenberg_enabled: enabled,
        };
        if (basicUser !== undefined) newConfig.gotenberg_basic_user = basicUser || undefined;
        if (basicPass !== undefined) newConfig.gotenberg_basic_pass = basicPass;

        if (hosterInstance?.id) {
          await supabaseAdmin.from("integration_instances").update({ config: newConfig }).eq("id", hosterInstance.id);
        } else {
          await supabaseAdmin.from("integration_instances").insert({
            provider: "hosterby", category: "other", status: "configured", config: newConfig,
          });
        }
        await writeAuditLog(supabaseAdmin, "hosterby.gotenberg_config_saved", {
          gotenberg_url: url, enabled, basic_auth_set: Boolean(basicUser && basicPass),
        }, userId);
        return jsonResp({ success: true });
      }

      case "gotenberg_check_health": {
        const { loadGotenbergConfig, gotenbergHealthCheck } = await import("../_shared/gotenberg.ts");
        try {
          const cfg = await loadGotenbergConfig(supabaseAdmin);
          const result = await gotenbergHealthCheck(cfg);
          if (hosterInstance?.id) {
            await supabaseAdmin.from("integration_instances").update({
              config: { ...instanceConfig, gotenberg_last_health_check: { ...result, at: new Date().toISOString() } },
            }).eq("id", hosterInstance.id);
          }
          return jsonResp({ success: result.ok, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return jsonResp({ success: false, error: msg });
        }
      }

      case "gotenberg_test_convert": {
        const { loadGotenbergConfig, convertDocxToPdf, buildTestDocx, GotenbergError } = await import("../_shared/gotenberg.ts");
        const t0 = performance.now();
        try {
          const cfg = await loadGotenbergConfig(supabaseAdmin);
          if (!cfg.enabled) {
            return jsonResp({ success: false, code: "GOTENBERG_DISABLED", error: "Gotenberg отключён в конфигурации" });
          }
          const docx = await buildTestDocx();
          const pdf = await convertDocxToPdf(cfg, docx, "test.docx");
          const latency = Math.round(performance.now() - t0);
          const result = {
            ok: true, latency_ms: latency,
            docx_size: docx.length, pdf_size: pdf.length,
            content_type: "application/pdf",
            at: new Date().toISOString(),
          };
          if (hosterInstance?.id) {
            await supabaseAdmin.from("integration_instances").update({
              config: { ...instanceConfig, gotenberg_last_test_convert: result },
            }).eq("id", hosterInstance.id);
          }
          await writeAuditLog(supabaseAdmin, "hosterby.gotenberg_test_convert_ok", result, userId);
          return jsonResp({ success: true, ...result });
        } catch (e) {
          const latency = Math.round(performance.now() - t0);
          const code = e instanceof GotenbergError ? e.code : "GOTENBERG_UNREACHABLE";
          const msg = e instanceof Error ? e.message : String(e);
          const result = { ok: false, latency_ms: latency, code, error: msg, at: new Date().toISOString() };
          if (hosterInstance?.id) {
            await supabaseAdmin.from("integration_instances").update({
              config: { ...instanceConfig, gotenberg_last_test_convert: result },
            }).eq("id", hosterInstance.id);
          }
          await writeAuditLog(supabaseAdmin, "hosterby.gotenberg_test_convert_failed", result, userId);
          return jsonResp({ success: false, ...result });
        }
      }

      default:
        return jsonResp({ success: false, error: `Неизвестное действие: ${action}` }, 400);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[hosterby-api] Unhandled error:", msg);
    return jsonResp({ success: false, error: "Внутренняя ошибка сервера" }, 500);
  }
});
