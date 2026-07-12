import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface HealthCheckRequest {
  provider: string;
  instance_id: string;
  config: Record<string, unknown>;
}

// Helper: fetch with timeout (10s default)
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit = {},
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth client (anon) — для валидации JWT
    const supabaseAuth = createClient(supabaseUrl, anonKey);
    // Admin client (service-role) — для RPC + DB writes (обходит RLS)
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // --- AUTH GUARD: superadmin only ---
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);

    if (userError || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: isSuperAdmin, error: roleErr } = await supabaseAdmin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "superadmin",
    });

    if (roleErr) {
      console.error("Role check error:", roleErr.message);
      return new Response(
        JSON.stringify({ success: false, error: "Role check failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (isSuperAdmin !== true) {
      return new Response(
        JSON.stringify({ success: false, error: "Superadmin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // --- END AUTH GUARD ---

    const { provider, instance_id, config } = (await req.json()) as HealthCheckRequest;

    console.log(`Health check for provider: ${provider}, instance: ${instance_id}`);

    let success = false;
    let errorMessage: string | null = null;
    let responseData: Record<string, unknown> = {};

    switch (provider) {
      case "getcourse": {
        let accountName = (config.account_name as string || "").trim();
        const secretKey = config.secret_key as string;

        if (!accountName || !secretKey) {
          errorMessage = "Отсутствуют обязательные параметры: account_name или secret_key";
          break;
        }

        // Clean account name - remove .getcourse.ru suffix if user added it
        accountName = accountName.replace(/\.getcourse\.ru$/i, "");

        try {
          // Use groups endpoint for health check - it doesn't require filters
          const apiUrl = `https://${accountName}.getcourse.ru/pl/api/account/groups`;
          console.log("GetCourse API URL:", apiUrl);
          
          let response: Response;
          try {
            response = await fetchWithTimeout(apiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: `action=getList&key=${secretKey}`,
            }, 10000);
          } catch (e: unknown) {
            const isAbort = e instanceof Error && e.name === "AbortError";
            return new Response(
              JSON.stringify({ success: false, provider: "getcourse", error: isAbort ? "TIMEOUT" : "FETCH_FAILED" }),
              { status: isAbort ? 504 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const data = await response.json();
          console.log("GetCourse response:", JSON.stringify(data));

          if (data.success === true || data.result?.success === true) {
            success = true;
            const groupsCount = data.result?.list?.length || data.result?.count || 0;
            responseData = { 
              account: accountName, 
              groups_count: groupsCount,
              api_version: "v1"
            };
          } else if (data.error_code === "invalid_key" || data.result?.error_code === "invalid_key") {
            errorMessage = "Неверный секретный ключ API GetCourse";
          } else if (data.error_code === "access_denied" || data.result?.error_code === "access_denied") {
            errorMessage = "Доступ к API запрещён. Проверьте настройки API в GetCourse.";
          } else {
            errorMessage = data.error_message || data.result?.error_message || "Неизвестная ошибка GetCourse API";
          }
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          console.error("GetCourse API error:", err);
          errorMessage = `Ошибка подключения к GetCourse: ${err}`;
        }
        break;
      }

      case "bepaid": {
        const shopId = config.shop_id as string;
        const secretKey = config.secret_key as string;

        if (!shopId || !secretKey) {
          errorMessage = "Отсутствуют обязательные параметры: shop_id или secret_key";
          break;
        }

        try {
          // Test bePaid API by checking shop info
          const authHeaderVal = btoa(`${shopId}:${secretKey}`);
          const testMode = config.test_mode ? true : false;
          const baseUrl = testMode
            ? "https://checkout.bepaid.by"
            : "https://checkout.bepaid.by";

          let response: Response;
          try {
            response = await fetchWithTimeout(`${baseUrl}/ctp/api/checkouts`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${authHeaderVal}`,
              },
              body: JSON.stringify({
                checkout: {
                  test: testMode,
                  transaction_type: "payment",
                  order: {
                    amount: 100, // 1.00 in minor units
                    currency: "BYN",
                    description: "Health check test",
                  },
                  settings: {
                    return_url: "https://example.com",
                    notification_url: "https://example.com/webhook",
                    language: "ru",
                  },
                },
              }),
            }, 10000);
          } catch (e: unknown) {
            const isAbort = e instanceof Error && e.name === "AbortError";
            return new Response(
              JSON.stringify({ success: false, provider: "bepaid", error: isAbort ? "TIMEOUT" : "FETCH_FAILED" }),
              { status: isAbort ? 504 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const data = await response.json();
          console.log("bePaid response status:", response.status);

          if (response.status === 200 || response.status === 201) {
            success = true;
            responseData = {
              shop_id: shopId,
              test_mode: testMode,
              checkout_token: data.checkout?.token ? "valid" : "created",
            };
          } else if (response.status === 401) {
            errorMessage = "Неверные учетные данные bePaid (shop_id или secret_key)";
          } else {
            errorMessage = data.message || data.errors?.[0]?.message || `HTTP ${response.status}`;
          }
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          console.error("bePaid API error:", err);
          errorMessage = `Ошибка подключения к bePaid: ${err}`;
        }
        break;
      }

      case "smtp": {
        // For SMTP, we just validate config format
        const email = config.email as string;
        const smtpHost = config.smtp_host as string;

        if (!email) {
          errorMessage = "Отсутствует email";
          break;
        }

        // Basic validation passed
        success = true;
        responseData = { email, smtp_host: smtpHost || "auto-detected" };
        break;
      }

      case "amocrm": {
        const subdomain = (config.subdomain as string || "").trim();
        const accessToken = config.long_term_token as string || config.access_token as string;

        if (!subdomain || !accessToken) {
          errorMessage = "Отсутствуют обязательные параметры: subdomain или long_term_token";
          break;
        }

        // Normalize subdomain - remove .amocrm.ru if present
        const cleanSubdomain = subdomain.replace(/\.amocrm\.(ru|com)$/i, "");

        try {
          const apiUrl = `https://${cleanSubdomain}.amocrm.ru/api/v4/account`;
          console.log("AmoCRM API URL:", apiUrl);

          let response: Response;
          try {
            response = await fetchWithTimeout(apiUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            }, 10000);
          } catch (e: unknown) {
            const isAbort = e instanceof Error && e.name === "AbortError";
            return new Response(
              JSON.stringify({ success: false, provider: "amocrm", error: isAbort ? "TIMEOUT" : "FETCH_FAILED" }),
              { status: isAbort ? 504 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          console.log("AmoCRM response status:", response.status);

          if (response.ok) {
            const data = await response.json();
            success = true;
            responseData = { 
              account_id: data.id, 
              account_name: data.name,
              subdomain: cleanSubdomain 
            };
          } else if (response.status === 401) {
            errorMessage = "Неверный токен доступа amoCRM. Проверьте долгосрочный токен.";
          } else {
            const errorText = await response.text();
            errorMessage = `Ошибка amoCRM API (${response.status}): ${errorText}`;
          }
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          console.error("AmoCRM API error:", err);
          errorMessage = `Ошибка подключения к amoCRM: ${err}`;
        }
        break;
      }

      case "kinescope": {
        const apiToken = config.api_token as string;

        if (!apiToken) {
          errorMessage = "Отсутствует API токен Kinescope";
          break;
        }

        try {
          let response: Response;
          try {
            response = await fetchWithTimeout("https://api.kinescope.io/v1/projects", {
              method: "GET",
              headers: {
                "Authorization": `Bearer ${apiToken}`,
                "Content-Type": "application/json"
              }
            }, 10000);
          } catch (e: unknown) {
            const isAbort = e instanceof Error && e.name === "AbortError";
            return new Response(
              JSON.stringify({ success: false, provider: "kinescope", error: isAbort ? "TIMEOUT" : "FETCH_FAILED" }),
              { status: isAbort ? 504 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          console.log("Kinescope response status:", response.status);

          if (response.status === 200) {
            const data = await response.json();
            const projects = data.data || [];
            success = true;
            responseData = {
              projects_count: projects.length,
              projects: projects.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))
            };
          } else if (response.status === 401) {
            errorMessage = "Неверный API токен Kinescope";
          } else if (response.status === 403) {
            errorMessage = "Доступ к API Kinescope запрещён";
          } else {
            const errData = await response.json();
            errorMessage = errData.message || `HTTP ${response.status}`;
          }
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          console.error("Kinescope API error:", err);
          errorMessage = `Ошибка подключения к Kinescope: ${err}`;
        }
        break;
      }

      case "hosterby": {
        // ВАЖНО: ключи НЕ принимаются из body — читаем из БД через hosterby-api
        if (!instance_id) {
          errorMessage = "instance_id обязателен для hosterby healthcheck";
          break;
        }

        // STOP-guard: без user JWT нет смысла вызывать hosterby-api
        if (!authHeader) {
          errorMessage = "Missing Authorization header";
          break;
        }

        // Прямой fetch к hosterby-api с оригинальным JWT пользователя (не service role)
        try {
          let hosterbyResp: Response;
          try {
            hosterbyResp = await fetchWithTimeout(
              `${supabaseUrl}/functions/v1/hosterby-api`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": authHeader,
                  "apikey": anonKey,
                },
                body: JSON.stringify({
                  action: "test_connection",
                  instance_id,
                }),
              },
              20000
            );
          } catch (e: unknown) {
            const isAbort = e instanceof Error && e.name === "AbortError";
            console.error("hosterby-api fetch error:", isAbort ? "TIMEOUT" : String(e));
            errorMessage = isAbort
              ? "Timeout при подключении к hosterby-api (20s)"
              : `Ошибка сети при вызове hosterby-api: ${String(e)}`;
            break;
          }

          // Нормализация по HTTP-статусу
          if (hosterbyResp.status === 401 || hosterbyResp.status === 403) {
            errorMessage = "Нет доступа / требуется user session (UNAUTHORIZED)";
            break;
          }

          let result: Record<string, unknown> | null = null;
          try {
            result = await hosterbyResp.json();
          } catch {
            errorMessage = `hosterby-api вернул non-JSON (HTTP ${hosterbyResp.status})`;
            break;
          }

          if (!hosterbyResp.ok) {
            // hosterby-api вернул ошибку, но с JSON-телом
            const code = (result as Record<string, unknown>)?.code ?? "";
            if (code === "KEYS_MISSING") {
              errorMessage = "API ключи hoster.by не настроены (KEYS_MISSING)";
            } else if (code === "UNAUTHORIZED") {
              errorMessage = "Ключи не подходят или нет доступа (UNAUTHORIZED)";
            } else if (code === "HOSTERBY_ROUTE_MISSING") {
              errorMessage = "hoster.by API: неверный endpoint/маршрут (HOSTERBY_ROUTE_MISSING)";
            } else if (code === "HOSTERBY_520") {
              errorMessage = "hoster.by API: HTTP 520 (HOSTERBY_520)";
            } else if (code === "TIMEOUT") {
              errorMessage = "Timeout при подключении к hoster.by API";
            } else {
              errorMessage = (result as Record<string, unknown>)?.error as string || `hosterby-api HTTP ${hosterbyResp.status}`;
            }
            break;
          }

          // Успешный ответ
          if ((result as Record<string, unknown>)?.success) {
            success = true;
            const d = (result as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
            responseData = {
              orders_count: d?.orders_count ?? d?.vms_count ?? 0,
              keys_configured: d?.keys_configured ?? false,
              cloud_access_key_last4: d?.cloud_access_key_last4 ?? null,
              auth_mode_used: d?.auth_mode_used ?? (result as Record<string, unknown>)?.auth_mode_used ?? null,
              endpoint_used: (result as Record<string, unknown>)?.endpoint_used ?? d?.endpoint_used ?? "/cloud/orders",
            };
          } else {
            const code = (result as Record<string, unknown>)?.code ?? "";
            if (code === "KEYS_MISSING") {
              errorMessage = "API ключи hoster.by не настроены (KEYS_MISSING)";
            } else {
              errorMessage = ((result as Record<string, unknown>)?.error as string) ?? "Ошибка подключения к hoster.by";
            }
          }
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          console.error("hoster.by healthcheck error:", err);
          errorMessage = `Ошибка: ${err}`;
        }
        break;
      }

      case "manychat": {
        // ManyChat healthcheck (PATCH 1.1 — A6)
        // Endpoint: GET https://api.manychat.com/fb/page/getInfo
        // api_key хранится в integration_instances.config_secrets (НЕ в config),
        // поэтому читаем его напрямую из БД через service-role (обходит RLS).
        if (!instance_id) {
          errorMessage = "instance_id обязателен для manychat healthcheck";
          break;
        }

        const { data: instanceRow, error: instanceErr } = await supabaseAdmin
          .from("integration_instances")
          .select("config, config_secrets")
          .eq("id", instance_id)
          .maybeSingle();

        if (instanceErr) {
          errorMessage = `Ошибка чтения instance: ${instanceErr.message}`;
          break;
        }
        if (!instanceRow) {
          errorMessage = "Integration instance не найден";
          break;
        }

        const secrets = (instanceRow.config_secrets as Record<string, unknown>) || {};
        const cfg = (instanceRow.config as Record<string, unknown>) || {};
        const apiKey = (secrets.api_key as string || "").trim();
        const pageId = (cfg.manychat_page_id as string || "").trim();

        if (!apiKey) {
          errorMessage = "Отсутствует api_key в config_secrets. Заполните API Key в настройках подключения.";
          break;
        }

        try {
          let response: Response;
          try {
            response = await fetchWithTimeout(
              "https://api.manychat.com/fb/page/getInfo",
              {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
              },
              10000
            );
          } catch (e: unknown) {
            const isAbort = e instanceof Error && e.name === "AbortError";
            errorMessage = isAbort
              ? "Timeout при подключении к ManyChat API (10s)"
              : `Ошибка сети при вызове ManyChat API: ${String(e)}`;
            break;
          }

          let data: Record<string, unknown> | null = null;
          try {
            data = await response.json();
          } catch {
            errorMessage = `ManyChat API вернул non-JSON (HTTP ${response.status})`;
            break;
          }

          console.log("ManyChat /fb/page/getInfo status:", response.status, "body keys:", Object.keys(data || {}));

          if (response.status === 401 || response.status === 403) {
            errorMessage = "Неверный API Key ManyChat (UNAUTHORIZED)";
            break;
          }

          // ManyChat envelope: { status: "success" | "error", data: {...}, message?: string }
          const apiStatus = (data as Record<string, unknown>)?.status;
          if (response.ok && apiStatus === "success") {
            const pageInfo = ((data as Record<string, unknown>)?.data as Record<string, unknown>) || {};
            const remotePageId = String(pageInfo.id ?? "");
            const isPro = Boolean(pageInfo.is_pro);

            // Если в config указан manychat_page_id — сверим, что аккаунт совпадает.
            if (pageId && remotePageId && pageId !== remotePageId) {
              errorMessage = `Page ID не совпадает: в настройках ${pageId}, у API ${remotePageId}`;
              break;
            }

            success = true;
            responseData = {
              page_id: remotePageId,
              page_name: pageInfo.name ?? null,
              page_username: pageInfo.username ?? null,
              is_pro: isPro,
              timezone: pageInfo.timezone ?? null,
            };
          } else {
            const apiMessage = (data as Record<string, unknown>)?.message;
            errorMessage =
              (typeof apiMessage === "string" && apiMessage) ||
              `ManyChat API error (HTTP ${response.status})`;
          }
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          console.error("ManyChat healthcheck error:", err);
          errorMessage = `Ошибка подключения к ManyChat: ${err}`;
        }
        break;
      }

      case "apix_instagram_dm": {
        // Check webhook_secret in config
        const webhookSecret = config.webhook_secret as string;
        if (!webhookSecret) {
          errorMessage = "Отсутствует webhook_secret в конфигурации";
          break;
        }

        // Check instagram_accounts record exists
        const { data: igAccount, error: igError } = await supabaseAdmin
          .from("instagram_accounts")
          .select("id, is_active")
          .eq("integration_instance_id", instance_id)
          .maybeSingle();

        if (igError) {
          errorMessage = `Ошибка проверки instagram_accounts: ${igError.message}`;
          break;
        }

        if (!igAccount) {
          errorMessage = "Запись instagram_accounts не найдена. Пересоздайте подключение.";
          break;
        }

        if (!igAccount.is_active) {
          errorMessage = "Instagram аккаунт деактивирован";
          break;
        }

        success = true;
        responseData = {
          instagram_account_id: igAccount.id,
          webhook_configured: true,
        };
        break;
      }

      case "rr": {
        // Truthful RR healthcheck (PATCH-RR-STATUS-TRUTHFUL-V1-CORRECTION).
        // Каждая подпроверка изолирована в try/catch и возвращает единый shape
        // { status, code?, message? }. Ошибка одной подпроверки не роняет весь
        // ответ. HTTP всегда 200 после прохождения auth-guard.
        const CONTRACT_VERSION = "rr-status-truthful-v1-correction";

        type SubStatus = "ok" | "not_verified" | "not_configured" | "error" | "configured" | "verified";
        interface CheckResult {
          status: SubStatus;
          code?: string;
          message?: string;
        }

        const { data: inst, error: instErr } = await supabaseAdmin
          .from("integration_instances")
          .select("config, config_secrets")
          .eq("id", instance_id)
          .single();

        if (instErr || !inst) {
          errorMessage = "Инстанс не найден";
          responseData = {
            provider: "rr",
            contract_version: CONTRACT_VERSION,
            overall: "error",
            checks: {},
          };
          break;
        }

        const cfg = (inst.config ?? {}) as Record<string, unknown>;
        const secrets = (inst.config_secrets ?? {}) as Record<string, unknown>;
        const mode: "test" | "battle" =
          ((cfg.mode as string) || "test") === "battle" ? "battle" : "test";
        const hasSecretKey =
          typeof secrets.secret_key === "string" && (secrets.secret_key as string).length > 0;
        const loginKey = mode === "battle" ? "battle_login" : "test_login";
        const passKey = mode === "battle" ? "battle_password" : "test_password";
        const hasLogin = typeof cfg[loginKey] === "string" && (cfg[loginKey] as string).length > 0;
        const hasPassword = typeof secrets[passKey] === "string" && (secrets[passKey] as string).length > 0;

        // Credentials.
        const credentialsCheck: CheckResult = hasSecretKey && hasLogin && hasPassword
          ? { status: "configured" }
          : {
              status: "not_configured",
              code: "credentials_incomplete",
              message: !hasSecretKey
                ? "secret_key не задан"
                : !hasLogin
                ? `${loginKey} не задан`
                : `${passKey} не задан`,
            };

        // Webhook endpoint — статически сконфигурирован (URL известен).
        const webhookEndpointCheck: CheckResult = { status: "configured" };

        // Backend — подтверждаем загрузку RR-модулей.
        let backendCheck: CheckResult = { status: "not_verified" };
        let rrCfgLoaded: unknown = null;
        let rrGetOrderStatusFn:
          | ((c: unknown, id: string) => Promise<{ ok: boolean; status: number; errorText?: string }>)
          | null = null;
        try {
          const { loadRRConfig } = await import("../_shared/rr/rr-config.ts");
          const { rrGetOrderStatus } = await import("../_shared/rr/rr-adapter.ts");
          rrGetOrderStatusFn = rrGetOrderStatus as typeof rrGetOrderStatusFn;
          if (credentialsCheck.status === "configured") {
            try {
              rrCfgLoaded = await loadRRConfig(supabaseAdmin);
              backendCheck = { status: "ok" };
            } catch (e) {
              backendCheck = {
                status: "error",
                code: "rr_config_load_failed",
                message: e instanceof Error ? e.message : "load_config_failed",
              };
            }
          } else {
            // Модули есть, но реквизиты не полны — backend технически ok,
            // просто без активной конфигурации.
            backendCheck = { status: "ok" };
          }
        } catch (e) {
          backendCheck = {
            status: "error",
            code: "rr_adapter_import_failed",
            message: e instanceof Error ? e.message : "adapter_import_failed",
          };
        }

        // last_operation + probe external_id — mode-specific.
        let lastOperation:
          | {
              at: string;
              order_id: string;
              external_id?: string | null;
              amount_minor?: number | null;
              currency?: string | null;
            }
          | null = null;
        let probeExternalId: string | null = null;
        let probeOrderId: string | null = null;

        try {
          if (mode === "test") {
            const { data: lastTest } = await supabaseAdmin
              .from("rr_test_ledger")
              .select("id, external_id, amount_minor, currency, updated_at")
              .not("external_id", "is", null)
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (lastTest?.external_id) {
              probeExternalId = String(lastTest.external_id);
              probeOrderId = String(lastTest.id);
              lastOperation = {
                at: String(lastTest.updated_at),
                order_id: probeOrderId,
                external_id: probeExternalId,
                amount_minor: (lastTest.amount_minor as number) ?? null,
                currency: (lastTest.currency as string) ?? null,
              };
            }
          } else {
            const { data: lastBattle } = await supabaseAdmin
              .from("payments_v2")
              .select(
                "id, order_id, amount_minor, currency, paid_at, created_at, orders_v2!inner(external_id, meta)"
              )
              .eq("provider", "rr")
              .eq("origin", "rr_installment")
              .order("created_at", { ascending: false })
              .limit(10);
            const battleRow = (lastBattle ?? []).find((r: any) => {
              const om = (r?.orders_v2?.meta ?? {}) as Record<string, any>;
              return om?.rr?.mode === "battle";
            }) as any;
            if (battleRow) {
              const extId = battleRow.orders_v2?.external_id
                ? String(battleRow.orders_v2.external_id)
                : null;
              probeExternalId = extId;
              probeOrderId = String(battleRow.order_id);
              lastOperation = {
                at: String(battleRow.paid_at ?? battleRow.created_at),
                order_id: probeOrderId,
                external_id: extId,
                amount_minor: (battleRow.amount_minor as number) ?? null,
                currency: (battleRow.currency as string) ?? null,
              };
            }
          }
        } catch (e) {
          // last_operation read не должен ронять весь healthcheck.
          console.warn("rr healthcheck: last_operation read failed:", e);
        }

        // API reachability — read-only через rrGetOrderStatus + timeout.
        let apiReachabilityCheck: CheckResult;
        if (credentialsCheck.status !== "configured") {
          apiReachabilityCheck = {
            status: "not_configured",
            code: "credentials_incomplete",
          };
        } else if (!probeExternalId) {
          apiReachabilityCheck = {
            status: "not_verified",
            code: mode === "battle" ? "no_battle_order_yet" : "no_test_order_yet",
            message:
              mode === "battle"
                ? "Боевой заказ ещё не выполнен"
                : "Нет тестового заказа для проверки",
          };
        } else if (!rrGetOrderStatusFn || !rrCfgLoaded) {
          apiReachabilityCheck = {
            status: "error",
            code: "rr_backend_unavailable",
            message: "RR backend недоступен",
          };
        } else {
          try {
            const probe = await Promise.race([
              rrGetOrderStatusFn(rrCfgLoaded, probeExternalId),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("rr_status_timeout")), 10000)
              ),
            ]);
            if (probe.ok) {
              apiReachabilityCheck = { status: "ok" };
            } else if (probe.status === 401 || probe.status === 403) {
              apiReachabilityCheck = {
                status: "error",
                code: "rr_unauthorized",
                message: `HTTP ${probe.status}`,
              };
            } else {
              apiReachabilityCheck = {
                status: "error",
                code: `rr_http_${probe.status || "unknown"}`,
                message: (probe.errorText ?? `HTTP ${probe.status}`).slice(0, 200),
              };
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            apiReachabilityCheck = {
              status: "error",
              code: msg === "rr_status_timeout" ? "rr_status_timeout" : "rr_probe_exception",
              message: msg === "rr_status_timeout"
                ? "РР не ответил за установленное время"
                : msg.slice(0, 200),
            };
          }
        }

        // Webhook runtime — mode-specific: событие с валидной подписью,
        // связанное с заказом в том же mode.
        let webhookRuntimeCheck: CheckResult = {
          status: "not_verified",
          code: "no_events_yet",
        };
          // Только реальные входящие webhook-события; иные типы
          // (create_order_succeeded, rr_promoted, fulfillment, reconciliation)
          // не подтверждают доставку webhook.
          const { data: recentEvents } = await supabaseAdmin
            .from("provider_events")
            .select("id, created_at, signature_valid, related_order_id, event_type")
            .eq("provider", "rr")
            .eq("event_type", "webhook_notification_received")
            .not("related_order_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(20);

          const events = (recentEvents ?? []) as Array<{
            id: string;
            created_at: string;
            signature_valid: boolean;
            related_order_id: string;
            event_type: string;
          }>;

          if (events.length > 0) {
            const orderIds = Array.from(new Set(events.map((e) => e.related_order_id)));
            const { data: orderRows } = await supabaseAdmin
              .from("orders_v2")
              .select("id, meta")
              .in("id", orderIds);
            const orderMode = new Map<string, string>();
            for (const o of (orderRows ?? []) as Array<{ id: string; meta: any }>) {
              const om = (o.meta ?? {}) as Record<string, any>;
              orderMode.set(String(o.id), String(om?.rr?.mode ?? ""));
            }

            const matched = events.find(
              (ev) => orderMode.get(ev.related_order_id) === mode
            );
            if (matched) {
              if (matched.signature_valid === true) {
                webhookRuntimeCheck = {
                  status: "verified",
                  message: matched.created_at,
                };
              } else {
                webhookRuntimeCheck = {
                  status: "error",
                  code: "last_signature_invalid",
                  message: "Последняя подпись webhook не прошла проверку",
                };
              }
            } else {
              webhookRuntimeCheck = {
                status: "not_verified",
                code: mode === "battle" ? "no_battle_events_yet" : "no_test_events_yet",
              };
            }
          }
        } catch (e) {
          webhookRuntimeCheck = {
            status: "error",
            code: "webhook_lookup_failed",
            message: e instanceof Error ? e.message.slice(0, 200) : "webhook_lookup_failed",
          };
        }

        // Итоговый overall.
        let overall:
          | "connected"
          | "battle_awaiting_first_order"
          | "not_configured"
          | "error";
        const anyError =
          backendCheck.status === "error" ||
          apiReachabilityCheck.status === "error" ||
          webhookRuntimeCheck.status === "error";

        if (credentialsCheck.status !== "configured") {
          overall = "not_configured";
        } else if (
          apiReachabilityCheck.status === "error" ||
          backendCheck.status === "error"
        ) {
          overall = "error";
          const src = apiReachabilityCheck.status === "error" ? apiReachabilityCheck : backendCheck;
          errorMessage = src.message ?? src.code ?? "rr_error";
        } else if (
          mode === "battle" &&
          (apiReachabilityCheck.status !== "ok" || webhookRuntimeCheck.status !== "verified")
        ) {
          overall = "battle_awaiting_first_order";
        } else if (apiReachabilityCheck.status === "ok") {
          overall = "connected";
        } else {
          // test без probe-заказа — честный промежуточный статус.
          overall = "battle_awaiting_first_order";
        }

        // success контракта healthcheck:
        //   connected / battle_awaiting_first_order → true
        //   not_configured / error                  → false
        // Семантика integration_instances.status обрабатывается отдельно ниже.
        success = overall === "connected" || overall === "battle_awaiting_first_order";

        responseData = {
          provider: "rr",
          contract_version: CONTRACT_VERSION,
          mode,
          overall,
          checks: {
            backend: backendCheck,
            credentials: credentialsCheck,
            api_reachability: {
              ...apiReachabilityCheck,
              probed_external_id: probeExternalId,
            },
            webhook_endpoint: webhookEndpointCheck,
            webhook_runtime: webhookRuntimeCheck,
          },
          last_operation: lastOperation,
          // meta для UI: сообщение первой критичной ошибки для короткого toast.
          error_message: anyError ? errorMessage : null,
        };
        break;
      }

      default:
        errorMessage = `Неизвестный провайдер: ${provider}`;
    }

    // Update instance status in database.
    // Для RR используем детальный overall из payload:
    //   - not_configured / battle_awaiting_first_order → disconnected (без error_message)
    //   - connected → connected
    //   - error → error
    const rrOverall = provider === "rr"
      ? (responseData as Record<string, unknown>).overall as string | undefined
      : undefined;

    const updatePayload: Record<string, unknown> = {
      last_check_at: new Date().toISOString(),
      error_message: errorMessage,
    };
    if (provider === "rr") {
      if (rrOverall === "connected") {
        updatePayload.status = "connected";
      } else if (rrOverall === "error") {
        updatePayload.status = "error";
      } else {
        // not_configured | battle_awaiting_first_order — честный промежуточный статус
        updatePayload.status = "disconnected";
        updatePayload.error_message = null;
      }
    } else {
      updatePayload.status = success ? "connected" : "error";
    }

    const { error: updateError } = await supabaseAdmin
      .from("integration_instances")
      .update(updatePayload)
      .eq("id", instance_id);

    if (updateError) {
      console.error("Failed to update instance:", updateError);
    }

    // Add log entry
    const { error: logError } = await supabaseAdmin.from("integration_logs").insert({
      instance_id,
      event_type: "healthcheck",
      result: success ? "success" : "error",
      error_message: errorMessage,
      payload_meta: responseData,
    });

    if (logError) {
      console.error("Failed to add log:", logError);
    }

    return new Response(
      JSON.stringify({
        success,
        error: errorMessage,
        data: responseData,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    console.error("Health check error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
