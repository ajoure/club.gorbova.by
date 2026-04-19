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

      default:
        errorMessage = `Неизвестный провайдер: ${provider}`;
    }

    // Update instance status in database
    const { error: updateError } = await supabaseAdmin
      .from("integration_instances")
      .update({
        status: success ? "connected" : "error",
        last_check_at: new Date().toISOString(),
        error_message: errorMessage,
      })
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
