/**
 * STRICT bePaid credentials loader
 * 
 * SECURITY POLICY: 
 * - Credentials ONLY from integration_instances(provider='bepaid')
 * - NO env fallback (Deno.env.get('BEPAID_*') is PROHIBITED)
 * - Returns 500 error if not configured
 * 
 * Usage:
 *   import { getBepaidCredsStrict, BepaidCreds, BepaidCredsError } from '../_shared/bepaid-credentials.ts';
 *   
 *   const creds = await getBepaidCredsStrict(supabase);
 *   if ('error' in creds) {
 *     return new Response(JSON.stringify({ error: creds.error }), { status: 500 });
 *   }
 *   // Use creds.shop_id, creds.secret_key, creds.public_key
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface BepaidCreds {
  shop_id: string;
  secret_key: string;
  public_key: string | null;
  webhook_secret: string | null;
  test_mode: boolean;
  creds_source: 'integration_instances';
}

export interface BepaidCredsError {
  error: string;
  code: 'not_configured' | 'incomplete_config' | 'no_active_instance';
}

export type BepaidCredsResult = BepaidCreds | BepaidCredsError;

/**
 * Get bePaid credentials STRICTLY from integration_instances
 * NO FALLBACK to environment variables
 * 
 * @param supabase - Supabase client with service role
 * @returns BepaidCreds on success, BepaidCredsError on failure
 */
export async function getBepaidCredsStrict(
  supabase: SupabaseClient
): Promise<BepaidCredsResult> {
  const { data: instance, error } = await supabase
    .from('integration_instances')
    .select('config, status')
    .eq('provider', 'bepaid')
    .in('status', ['active', 'connected'])
    .maybeSingle();

  if (error) {
    console.error('[bepaid-creds] DB error fetching integration_instances:', error.message);
    return {
      error: 'Ошибка БД при загрузке конфигурации bePaid',
      code: 'not_configured',
    };
  }

  if (!instance) {
    console.error('[bepaid-creds] No active bePaid integration found in integration_instances');
    return {
      error: 'bePaid не настроен в интеграциях. Добавьте конфигурацию в Интеграции → bePaid.',
      code: 'no_active_instance',
    };
  }

  const config = instance.config as Record<string, unknown> | null;

  if (!config) {
    console.error('[bepaid-creds] bePaid instance found but config is empty');
    return {
      error: 'Конфигурация bePaid пуста. Проверьте настройки интеграции.',
      code: 'incomplete_config',
    };
  }

  const shop_id = config.shop_id as string | undefined;
  const secret_key = config.secret_key as string | undefined;

  if (!shop_id || !secret_key) {
    console.error('[bepaid-creds] Missing shop_id or secret_key in bePaid config');
    return {
      error: 'В конфигурации bePaid отсутствует shop_id или secret_key',
      code: 'incomplete_config',
    };
  }

  const public_key = (config.public_key as string) || null;
  const webhook_secret = (config.webhook_secret as string) || null;
  const test_mode = config.test_mode === true || config.test_mode === 'true';

  // PATCH-1: Don't log shop_id for privacy
  console.log('[bepaid-creds] Loaded credentials from integration_instances', {
    has_shop_id: !!shop_id,
    has_secret_key: !!secret_key,
    has_public_key: !!public_key,
    test_mode,
  });
  return {
    shop_id,
    secret_key,
    public_key,
    webhook_secret,
    test_mode,
    creds_source: 'integration_instances',
  };
}

/**
 * Create bePaid Basic Auth header
 */
export function createBepaidAuthHeader(creds: BepaidCreds): string {
  return `Basic ${btoa(`${creds.shop_id}:${creds.secret_key}`)}`;
}

/**
 * Check if result is error
 */
export function isBepaidCredsError(result: BepaidCredsResult): result is BepaidCredsError {
  return 'error' in result;
}
