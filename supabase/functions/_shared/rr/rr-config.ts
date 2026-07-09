/**
 * RR config loader — service-role only.
 *
 * Читает `integration_instances(provider='rr')` + `config_secrets`
 * через service-role клиента. Секреты никогда не логируются, не
 * возвращаются в HTTP-ответы и не попадают во frontend.
 */
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface RRResolvedConfig {
  instanceId: string;
  mode: "test" | "battle";
  baseUrl: string; // всегда https://pay.rrllc.ru/api/v2 (test-режим уточняется у РР)
  login: string;
  password: string;
  secretKey: string;
}

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Загружает test-режим конфиг для RR core-интеграции.
 * Гарантирует, что вернёт только test-креды (mode === 'test').
 */
export async function loadRRTestConfig(
  supabaseAdmin: SupabaseClient,
): Promise<RRResolvedConfig> {
  const { data, error } = await supabaseAdmin
    .from("integration_instances")
    .select("id, config, config_secrets, status")
    .eq("provider", "rr")
    .maybeSingle();

  if (error) throw new Error(`rr_config_read_failed: ${error.message}`);
  if (!data) throw new Error("rr_instance_not_configured");

  const config = (data.config ?? {}) as Record<string, unknown>;
  const secrets = (data.config_secrets ?? {}) as Record<string, unknown>;

  const mode = (config.mode as string) === "battle" ? "battle" : "test";
  if (mode !== "test") {
    throw new Error("rr_core_only_test_mode_allowed");
  }

  const login = String(config.test_login ?? "").trim();
  const password = String(secrets.test_password ?? "").trim();
  const secretKey = String(secrets.secret_key ?? "").trim();

  if (!login || !password || !secretKey) {
    throw new Error("rr_test_credentials_incomplete");
  }

  return {
    instanceId: data.id as string,
    mode: "test",
    baseUrl: "https://pay.rrllc.ru/api/v2",
    login,
    password,
    secretKey,
  };
}
