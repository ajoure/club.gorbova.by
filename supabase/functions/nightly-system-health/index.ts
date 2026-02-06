import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * PATCH 4: Nightly System Health - Core monitoring function
 * 
 * Features:
 * - Validates x-cron-secret header
 * - Guard: runs only at 03:00 Europe/London
 * - Creates run record in system_health_runs
 * - Invokes nightly-payments-invariants
 * - Sends Telegram alert to owner on FAIL
 * - Writes audit_logs with SYSTEM ACTOR
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// PATCH-1: Словарь инвариантов на русском для понятных уведомлений
// PATCH-5: Добавлены urlTemplate для ссылок в уведомлениях
const INVARIANT_TRANSLATIONS: Record<string, {
  title: string;
  explain: string;
  action: string;
  urlPath?: string;
}> = {
  'INV-1': {
    title: 'Дубликаты платежей',
    explain: 'Найдены платежи с одинаковым ID от провайдера',
    action: 'Удалить дубликаты в админке платежей',
    urlPath: '/admin/payments?duplicate=true',
  },
  'INV-2A': {
    title: 'Платежи без заказов',
    explain: 'Деньги пришли, но заказ не создан (потеря учёта)',
    action: 'Создать заказы или переклассифицировать как тестовые',
    urlPath: '/admin/payments?filter=orphan',
  },
  'INV-2B': {
    title: 'Технические сироты',
    explain: 'Слишком много технических платежей без привязки',
    action: 'Проверить порог и классификацию',
  },
  'INV-3': {
    title: 'Несовпадение сумм',
    explain: 'Сумма платежа отличается от суммы заказа',
    action: 'Проверить скидки или исправить данные',
    urlPath: '/admin/payments',
  },
  'INV-4': {
    title: 'Триал-блокировки (24ч)',
    explain: 'Статистика триал-блокировок и защиты сумм',
    action: 'Информационно',
  },
  'INV-5': {
    title: 'Несколько цен на тарифе',
    explain: 'Тариф имеет несколько активных цен',
    action: 'Деактивировать лишние цены',
    urlPath: '/admin/products-v2',
  },
  'INV-6': {
    title: 'Расчёты списаний (7д)',
    explain: 'Статистика расчётов списаний за неделю',
    action: 'Информационно',
  },
  'INV-7': {
    title: 'Рассинхрон с bePaid',
    explain: 'Сумма в нашей базе не совпадает с данными bePaid',
    action: 'Запустить синхронизацию с выпиской',
    urlPath: '/admin/payments?tab=statement',
  },
  'INV-8': {
    title: 'Нет классификации',
    explain: 'Платежи без категории (непонятно что это)',
    action: 'Запустить автоклассификацию',
    urlPath: '/admin/payments?filter=unclassified',
  },
  'INV-9': {
    title: 'Верификации с заказами',
    explain: 'Проверки карт ошибочно создали заказы',
    action: 'Удалить лишние заказы',
  },
  'INV-10': {
    title: 'Просроченные доступы',
    explain: 'Активные доступы с истёкшим сроком',
    action: 'Запустить очистку доступов',
    urlPath: '/admin/entitlements',
  },
  'INV-11': {
    title: 'Просроченные подписки',
    explain: 'Активные подписки с истёкшим сроком',
    action: 'Запустить очистку подписок',
    urlPath: '/admin/subscriptions-v2',
  },
  'INV-12': {
    title: 'Ошибочные ревоки TG',
    explain: 'Пользователи с доступом исключены из групп',
    action: 'Восстановить членство в Telegram',
    urlPath: '/admin/telegram-diagnostics',
  },
  'INV-13': {
    title: 'Триалы без доступа',
    explain: 'Оплаченный триал не дал доступ клиенту',
    action: 'Проверить создание подписок',
    urlPath: '/admin/deals?filter=trial',
  },
  'INV-14': {
    title: 'Двойные подписки',
    explain: 'Один пользователь имеет несколько активных подписок',
    action: 'Объединить или деактивировать лишние',
  },
  'INV-15': {
    title: 'Платежи без профиля',
    explain: 'Успешный платёж не привязан к профилю клиента',
    action: 'Найти и привязать профиль',
  },
};

// PATCH-6: Форматирование примеров для Telegram
function formatSampleForTelegram(check: HealthCheckResult, translation: typeof INVARIANT_TRANSLATIONS[string]): string {
  if (!check.samples || check.samples.length === 0) return '';
  
  const lines: string[] = [];
  const samples = check.samples.slice(0, 3);
  
  for (const sample of samples) {
    // Format based on check type
    if (sample.payment_id || sample.id) {
      const id = sample.payment_id || sample.id;
      const shortId = String(id).slice(0, 8);
      
      if (sample.payment_amount !== undefined && sample.order_final_price !== undefined) {
        // INV-3: Amount mismatch
        lines.push(`• Платёж ${shortId}: ${sample.payment_amount} BYN → Заказ: ${sample.order_final_price} BYN`);
      } else if (sample.amount !== undefined) {
        // General payment sample
        const date = sample.paid_at ? new Date(sample.paid_at).toLocaleDateString('ru-RU') : '';
        lines.push(`• ${shortId}: ${sample.amount} BYN ${date ? `(${date})` : ''}`);
      } else {
        lines.push(`• ID: ${shortId}`);
      }
    } else if (sample.order_number) {
      lines.push(`• Заказ ${sample.order_number}`);
    } else if (sample.user_id) {
      const shortUserId = String(sample.user_id).slice(0, 8);
      lines.push(`• Пользователь: ${shortUserId}...`);
    } else if (sample.tariff_id) {
      lines.push(`• Тариф: ${String(sample.tariff_id).slice(0, 8)}...`);
    } else {
      // Fallback: show first non-null field
      const firstField = Object.entries(sample).find(([_, v]) => v != null);
      if (firstField) {
        lines.push(`• ${firstField[0]}: ${String(firstField[1]).slice(0, 20)}`);
      }
    }
  }
  
  if (check.samples.length > 3) {
    lines.push(`... и ещё ${check.samples.length - 3}`);
  }
  
  return lines.length > 0 ? `\n   📋 Примеры:\n   ${lines.join('\n   ')}` : '';
}

interface HealthCheckResult {
  name: string;
  passed: boolean;
  count: number;
  samples: any[];
  description: string;
}

interface NightlyReport {
  success: boolean;
  run_at: string;
  duration_ms: number;
  invariants: HealthCheckResult[];
  summary: {
    total_checks: number;
    passed: number;
    failed: number;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Verify cron secret for scheduled runs
    const cronSecret = req.headers.get('x-cron-secret');
    const expectedSecret = Deno.env.get('CRON_SECRET');
    
    // Also allow authenticated admin calls
    const authHeader = req.headers.get('authorization');
    const isScheduledRun = cronSecret === expectedSecret;
    const isAuthenticatedCall = !!authHeader;
    
    if (!isScheduledRun && !isAuthenticatedCall) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await req.json().catch(() => ({}));
    const source = body.source || 'manual';
    const targetTz = body.target_tz || 'Europe/London';
    const targetHour = body.target_hour ?? 3;
    const notifyOwner = body.notify_owner !== false;

    // DST-resistant: Check if current hour in target timezone matches target
    const nowInTargetTz = new Date().toLocaleString('en-US', { 
      timeZone: targetTz, 
      hour: 'numeric', 
      hour12: false 
    });
    const currentHour = parseInt(nowInTargetTz, 10);
    
    // Allow manual runs OR scheduled runs at target hour
    if (source === 'cron-hourly' && currentHour !== targetHour) {
      console.log(`[NIGHTLY] Skipped: current hour ${currentHour} != target ${targetHour} in ${targetTz}`);
      return new Response(JSON.stringify({ 
        skipped: true, 
        reason: `not_target_hour (current: ${currentHour}, target: ${targetHour}, tz: ${targetTz})` 
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[NIGHTLY] Starting system health check (source: ${source}, tz: ${targetTz}, hour: ${currentHour})`);

    // Create run record
    const { data: run, error: runError } = await supabase
      .from('system_health_runs')
      .insert({
        run_type: source === 'cron-hourly' ? 'nightly' : source,
        status: 'running',
        meta: {
          source,
          target_tz: targetTz,
          target_hour: targetHour,
          actual_hour: currentHour,
        }
      })
      .select('id')
      .single();

    if (runError) {
      console.error('[NIGHTLY] Failed to create run record:', runError);
      throw runError;
    }

    const runId = run.id;
    console.log(`[NIGHTLY] Created run ${runId}`);

    // Execute all invariants from nightly-payments-invariants
    const invariantsResponse = await supabase.functions.invoke('nightly-payments-invariants', {
      body: { run_id: runId },
    });

    const invariantsResult: NightlyReport = invariantsResponse.data || {
      success: false,
      run_at: new Date().toISOString(),
      duration_ms: 0,
      invariants: [],
      summary: { total_checks: 0, passed: 0, failed: 0 }
    };

    const failedChecks = invariantsResult.invariants?.filter((i) => !i.passed) || [];

    // Save checks to system_health_checks
    for (const inv of invariantsResult.invariants || []) {
      const checkKey = inv.name.split(':')[0].trim();
      const category = inv.name.toLowerCase().includes('payment') ? 'payments' : 
                       inv.name.toLowerCase().includes('telegram') ? 'telegram' : 
                       inv.name.toLowerCase().includes('access') ? 'access' :
                       inv.name.toLowerCase().includes('entitlement') ? 'access' :
                       inv.name.toLowerCase().includes('subscription') ? 'access' : 'system';

      await supabase.from('system_health_checks').insert({
        run_id: runId,
        check_key: checkKey,
        check_name: inv.name,
        category,
        status: inv.passed ? 'passed' : 'failed',
        details: { description: inv.description },
        sample_rows: inv.samples,
        count: inv.count,
        duration_ms: null,
      });
    }

    // Finalize run
    const finalStatus = failedChecks.length > 0 ? 'failed' : 'completed';
    await supabase
      .from('system_health_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: finalStatus,
        summary: invariantsResult.summary,
      })
      .eq('id', runId);

    // PATCH-2: Send Telegram alert to super_admin owner ALWAYS (PASS/FAIL)
    // CRITICAL: This must run regardless of success/failure status
    if (notifyOwner) {
      // Find super_admin owner by email
      const ownerEmail = '7500084@gmail.com';
      console.log(`[NIGHTLY] Preparing notification for owner ${ownerEmail}, failedChecks=${failedChecks.length}`);
      
      const { data: ownerProfile } = await supabase
        .from('profiles')
        .select('telegram_user_id, full_name')
        .eq('email', ownerEmail)
        .maybeSingle();
      
      // PATCH-A: Get bot token from env first, fallback to DB only if not set
      // TODO: Remove DB fallback after full migration to env secrets
      let botToken = Deno.env.get('PRIMARY_TELEGRAM_BOT_TOKEN');
      
      if (!botToken) {
        // Fallback: Get from telegram_bots table (legacy, to be removed)
        const { data: primaryBot } = await supabase
          .from('telegram_bots')
          .select('bot_token_encrypted')
          .eq('is_primary', true)
          .eq('status', 'active')
          .maybeSingle();
        botToken = primaryBot?.bot_token_encrypted || null;
        if (botToken) {
          console.warn('[NIGHTLY] Using bot token from DB (legacy). Migrate to PRIMARY_TELEGRAM_BOT_TOKEN env secret.');
        }
      }
      
      if (ownerProfile?.telegram_user_id && botToken) {
        // PATCH-3: Build Russian-language message
        const nowStr = new Date().toLocaleString('ru-RU', { 
          timeZone: 'Europe/Minsk',
          day: '2-digit',
          month: '2-digit', 
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        
        const isSuccess = failedChecks.length === 0;
        const total = invariantsResult.summary?.total_checks || 0;
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        
        let alertText = '';
        
        if (isSuccess) {
          alertText = `✅ НОЧНАЯ ПРОВЕРКА: Все ${total} тестов пройдены\n\n`;
          alertText += `Система работает штатно.\n`;
          alertText += `Следующая проверка: завтра в 06:00\n\n`;
        } else {
          alertText = `🚨 НОЧНАЯ ПРОВЕРКА: ${failedChecks.length} из ${total} с ошибками\n\n`;
          alertText += `━━━━━━━━━━━━━━━━━━━━━━\n`;
          
          for (const check of failedChecks.slice(0, 5)) {
            const code = check.name.split(':')[0].trim();
            const translation = INVARIANT_TRANSLATIONS[code];
            
            if (translation) {
              alertText += `❌ ${translation.title} (${code})\n`;
              alertText += `   Найдено: ${check.count}\n`;
              alertText += `   Проблема: ${translation.explain}\n`;
              
              // PATCH-6: Добавляем примеры
              const samplesText = formatSampleForTelegram(check, translation);
              if (samplesText) {
                alertText += samplesText + '\n';
              }
              
              alertText += `   🔧 ${translation.action}\n`;
              
              // PATCH-6: Добавляем ссылку если есть
              if (translation.urlPath) {
                alertText += `   → ${translation.urlPath}\n`;
              }
              
              alertText += '\n';
            } else {
              // Fallback for unknown invariants
              alertText += `❌ ${check.name}\n`;
              alertText += `   Найдено: ${check.count}\n\n`;
            }
          }
          
          if (failedChecks.length > 5) {
            alertText += `... и ещё ${failedChecks.length - 5}\n\n`;
          }
          
          alertText += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        }
        
        alertText += `⏱ ${nowStr} Минск\n`;
        alertText += `📊 Время: ${durationSec} сек\n`;
        alertText += `🔗 Подробности: /admin/system-health`;

        try {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: ownerProfile.telegram_user_id,
              text: alertText,
              // NO parse_mode = plain text (more reliable)
            }),
          });
          console.log(`[NIGHTLY] Sent ${isSuccess ? 'SUCCESS' : 'FAIL'} alert to owner ${ownerProfile.full_name} (TG: ${ownerProfile.telegram_user_id})`);
        } catch (tgError) {
          console.error('[NIGHTLY] Failed to send Telegram alert:', tgError);
        }
      } else {
        console.warn('[NIGHTLY] Owner not found or no Telegram linked:', { 
          ownerEmail, 
          hasTelegram: !!ownerProfile?.telegram_user_id,
          hasToken: !!botToken,
          tokenSource: Deno.env.get('PRIMARY_TELEGRAM_BOT_TOKEN') ? 'env' : 'db_fallback'
        });
      }
    }

    // PATCH 12: Audit log with SYSTEM ACTOR (MANDATORY)
    // PATCH-7: Token source tracking for security debt monitoring
    const tokenFromEnv = !!Deno.env.get('PRIMARY_TELEGRAM_BOT_TOKEN');
    
    await supabase.from('audit_logs').insert({
      action: 'nightly.system_health_run',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'nightly-system-health',
      meta: {
        run_id: runId,
        duration_ms: Date.now() - startTime,
        total_checks: invariantsResult.summary?.total_checks,
        passed: invariantsResult.summary?.passed,
        failed: invariantsResult.summary?.failed,
        source,
        target_tz: targetTz,
        target_hour: targetHour,
        notify_sent: failedChecks.length > 0 && notifyOwner,
        owner_email: '7500084@gmail.com',
        // PATCH-7: Security debt tracking
        token_source: tokenFromEnv ? 'env_secret' : 'db_fallback_DEPRECATED',
        security_debt: !tokenFromEnv,
      },
    });

    console.log(`[NIGHTLY] Completed in ${Date.now() - startTime}ms. Status: ${finalStatus}. Passed: ${invariantsResult.summary?.passed}/${invariantsResult.summary?.total_checks}`);

    return new Response(JSON.stringify({
      success: failedChecks.length === 0,
      run_id: runId,
      status: finalStatus,
      ...invariantsResult.summary,
      duration_ms: Date.now() - startTime,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[NIGHTLY] Error:', error);

    // Log error to audit
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'nightly-system-health',
        action: 'nightly.system_health_error',
        meta: {
          error: String(error),
          duration_ms: Date.now() - startTime,
        },
      });
    } catch (auditError) {
      console.error('[NIGHTLY] Failed to log error:', auditError);
    }

    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
