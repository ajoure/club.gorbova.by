import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface HealthCheckRequest {
  provider: string;
  instance_id: string;
  config: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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
          
          const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `action=getList&key=${secretKey}`,
          });

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
          const authHeader = btoa(`${shopId}:${secretKey}`);
          const testMode = config.test_mode ? true : false;
          const baseUrl = testMode
            ? "https://checkout.bepaid.by"
            : "https://checkout.bepaid.by";

          // Try to get shop info via a minimal checkout token request
          const response = await fetch(`${baseUrl}/ctp/api/checkouts`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Basic ${authHeader}`,
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
          });

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

          const response = await fetch(apiUrl, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          });

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

      default:
        errorMessage = `Неизвестный провайдер: ${provider}`;
    }

    // Update instance status in database
    const { error: updateError } = await supabase
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
    const { error: logError } = await supabase.from("integration_logs").insert({
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
