import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * system-docs-nightly-refresh
 * 
 * Обновляет AUTO-CURRENT документы для всех доменов.
 * Источники: audit_logs, domain_events, канонические таблицы.
 * Guard: source=cron-hourly → только 03:00 Europe/London.
 * Idempotency: batch_key = system_docs_refresh_YYYY_MM_DD_europe_london.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_DOC_DOMAINS = [
  { key: "platform_master", title: "Архитектура платформы" },
  { key: "products_sales", title: "Продукты и тарифы" },
  { key: "sites_pages_forms", title: "Сайты и формы" },
  { key: "trainings_access", title: "Тренинги и доступы" },
  { key: "orders_payments", title: "Сделки и платежи" },
  { key: "integrations", title: "Интеграции" },
  { key: "open_tails", title: "Открытые хвосты" },
];

const MAX_DOC_SIZE = 100 * 1024; // 100KB

/** Safe count helper — returns 0 on error instead of crashing */
async function safeCount(supabase: any, table: string, filter?: { col: string; val: any }): Promise<number> {
  try {
    let q = supabase.from(table).select('id', { count: 'exact', head: true });
    if (filter) q = q.eq(filter.col, filter.val);
    const { count, error } = await q;
    if (error) { console.warn(`safeCount(${table}): ${error.message}`); return 0; }
    return count || 0;
  } catch (e) {
    console.warn(`safeCount(${table}) exception: ${e.message}`);
    return 0;
  }
}

/** Safe select helper */
async function safeSelect(supabase: any, table: string, columns: string, opts?: { filter?: { col: string; val: any }; limit?: number; order?: { col: string; asc: boolean } }): Promise<any[]> {
  try {
    let q = supabase.from(table).select(columns);
    if (opts?.filter) q = q.eq(opts.filter.col, opts.filter.val);
    if (opts?.order) q = q.order(opts.order.col, { ascending: opts.order.asc });
    if (opts?.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) { console.warn(`safeSelect(${table}): ${error.message}`); return []; }
    return data || [];
  } catch (e) {
    console.warn(`safeSelect(${table}) exception: ${e.message}`);
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const body = await req.json().catch(() => ({}));
    const source = body.source || 'cron-hourly';
    const now = new Date();

    // Extract user from JWT for manual refresh
    let callerUserId: string | null = null;
    if (source === 'manual') {
      const authHeader = req.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user: callerUser } } = await userClient.auth.getUser();
        if (callerUser?.id) {
          callerUserId = callerUser.id;
        }
      }
    }

    const isManual = source === 'manual';
    const actorType = isManual ? 'user' : 'system';
    const actorUserId = isManual ? callerUserId : null;
    const actorLabel = isManual ? 'admin_system_docs' : 'system_docs_nightly_refresh';

    // Guard: if cron-hourly, only run at 03:00 Europe/London
    if (source === 'cron-hourly') {
      const londonHour = parseInt(
        now.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/London' })
      );
      if (londonHour !== 3) {
        return new Response(JSON.stringify({ skipped: true, reason: `hour=${londonHour}` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Batch key for idempotency
    const londonDate = now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const batchKey = `system_docs_refresh_${londonDate.replace(/-/g, '_')}_europe_london`;

    // Check idempotency (skip for manual)
    if (source === 'cron-hourly') {
      const { data: existing } = await supabase
        .from('audit_logs')
        .select('id')
        .eq('action', 'system_docs.nightly_refresh_completed')
        .contains('meta', { batch_id: batchKey })
        .limit(1);
      if (existing && existing.length > 0) {
        return new Response(JSON.stringify({ skipped: true, reason: 'already_completed', batchKey }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const auditAction = source === 'manual'
      ? 'system_docs.manual_refresh_started'
      : 'system_docs.nightly_refresh_started';

    await supabase.from('audit_logs').insert({
      action: auditAction,
      actor_type: actorType,
      actor_user_id: actorUserId,
      actor_label: actorLabel,
      meta: { batch_id: batchKey, source },
    });

    const snapshotAt = now.toISOString();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const warnings: string[] = [];
    let updatedCount = 0;

    // Collect changes from audit_logs for last 24h
    const recentAudit = await safeSelect(supabase, 'audit_logs', 'action, meta, created_at', {
      limit: 100,
      order: { col: 'created_at', asc: false },
    });
    // Filter client-side for gte since24h
    const filteredAudit = recentAudit.filter((a: any) => a.created_at >= since24h);

    const changesSummary = filteredAudit
      .map((a: any) => `- ${a.created_at.substring(0, 16)} | ${a.action}`)
      .join('\n');

    for (const domain of SYSTEM_DOC_DOMAINS) {
      let content = '';
      const domainWarnings: string[] = [];
      try {
        content = await buildDomainSnapshot(supabase, domain.key, domain.title, snapshotAt, changesSummary, since24h, domainWarnings);
      } catch (e) {
        console.error(`Error building snapshot for ${domain.key}:`, e);
        content = `${domain.title}\n===\n\n⚠️ Ошибка сборки снимка: ${e.message}\n\nTimestamp: ${snapshotAt}`;
        domainWarnings.push(`error:${domain.key}:${e.message}`);
      }
      if (domainWarnings.length > 0) warnings.push(...domainWarnings);

      // Truncation guard
      let truncated = false;
      let fullSize = content.length;
      if (content.length > MAX_DOC_SIZE) {
        content = content.substring(0, MAX_DOC_SIZE) + '\n\n... truncated, full version exceeds 100KB';
        truncated = true;
        warnings.push(`truncated:${domain.key}`);
      }

      const meta = {
        title: domain.title,
        domain_key: domain.key,
        source: source === 'manual' ? 'manual_refresh' : 'nightly_discovery_snapshot',
        snapshot_at: snapshotAt,
        snapshot_tz: 'Europe/London',
        batch_id: batchKey,
        managed_by: 'system',
        tags: ['auto', source === 'manual' ? 'manual' : 'nightly', 'snapshot'],
        ...(truncated ? { truncated: true, full_size_bytes: fullSize } : {}),
      };

      // Check for existing AUTO-CURRENT
      const { data: existing } = await supabase
        .from('admin_docs')
        .select('id')
        .eq('section_key', domain.key)
        .eq('version_label', 'AUTO-CURRENT')
        .limit(2);

      const existingDocs = existing || [];

      if (existingDocs.length > 1) {
        warnings.push(`duplicate_auto:${domain.key}`);
        console.error(`STOP: ${existingDocs.length} AUTO-CURRENT records for ${domain.key}`);
        continue;
      }

      if (existingDocs.length === 1) {
        await supabase
          .from('admin_docs')
          .update({ content_text: content, meta, updated_at: snapshotAt })
          .eq('id', existingDocs[0].id);
      } else {
        await supabase
          .from('admin_docs')
          .insert({ section_key: domain.key, version_label: 'AUTO-CURRENT', status: 'active', content_text: content, meta });
      }
      updatedCount++;
    }

    const completedAction = source === 'manual'
      ? 'system_docs.manual_refresh_completed'
      : 'system_docs.nightly_refresh_completed';

    await supabase.from('audit_logs').insert({
      action: completedAction,
      actor_type: actorType,
      actor_user_id: actorUserId,
      actor_label: actorLabel,
      meta: { batch_id: batchKey, updated_count: updatedCount, warnings, source },
    });

    return new Response(JSON.stringify({ success: true, batchKey, updatedCount, warnings }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Nightly refresh error:', error);
    try {
      await supabase.from('audit_logs').insert({
        action: 'system_docs.nightly_refresh_failed',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'system_docs_nightly_refresh',
        meta: { error: error.message },
      });
    } catch (_) {}
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function buildDomainSnapshot(
  supabase: any,
  domainKey: string,
  title: string,
  snapshotAt: string,
  changesSummary: string,
  since24h: string,
  warnings: string[]
): Promise<string> {
  const header = `${title}\n===\n\nОбновлено автоматически: ${snapshotAt} (Europe/London)\n`;

  const changesBlock = changesSummary
    ? `\n===\n\nИзменения за последние 24 часа\n\n${changesSummary}\n`
    : `\n===\n\nИзменения за последние 24 часа\n\nНет изменений.\n`;

  let domainContent = '';

  switch (domainKey) {
    case 'platform_master':
      domainContent = await buildPlatformMasterSnapshot(supabase, warnings);
      break;
    case 'products_sales':
      domainContent = await buildProductsSalesSnapshot(supabase, warnings);
      break;
    case 'orders_payments':
      domainContent = await buildOrdersPaymentsSnapshot(supabase, warnings);
      break;
    case 'trainings_access':
      domainContent = await buildTrainingsAccessSnapshot(supabase, warnings);
      break;
    case 'sites_pages_forms':
      domainContent = await buildSitesPagesSnapshot(supabase, warnings);
      break;
    case 'integrations':
      domainContent = await buildIntegrationsSnapshot(supabase, warnings);
      break;
    case 'open_tails':
      domainContent = await buildOpenTailsSnapshot(supabase, since24h, warnings);
      break;
    default:
      domainContent = '\n===\n\nНет данных для этого домена.\n';
  }

  return header + changesBlock + domainContent;
}

// ─── PLATFORM MASTER ───────────────────────────────────────────────

async function buildPlatformMasterSnapshot(supabase: any, warnings: string[]): Promise<string> {
  const userCount = await safeCount(supabase, 'profiles');
  const roleCount = await safeCount(supabase, 'user_roles');
  const efCount = await safeCount(supabase, 'edge_functions_registry');
  const auditCount = await safeCount(supabase, 'audit_logs');
  const appSettingsCount = await safeCount(supabase, 'app_settings');
  const adminMenuCount = await safeCount(supabase, 'admin_menu_settings');

  // Edge functions registry list
  const efList = await safeSelect(supabase, 'edge_functions_registry', 'function_name, description, is_active', { limit: 50, order: { col: 'function_name', asc: true } });
  const efBlock = efList.length > 0
    ? efList.map((ef: any) => `  - ${ef.function_name} [${ef.is_active ? 'active' : 'inactive'}] — ${ef.description || '(без описания)'}`).join('\n')
    : '  (нет записей в реестре)';

  return `
===

## Архитектура платформы — Master Document

Каноническое описание системы. Используйте как входной артефакт для новых задач.

===

## Источники истины (SoT)

- admin_docs — системная документация (единственный SoT)
- profiles — профили пользователей
- user_roles — роли (enum: admin, moderator, user, super_admin)
- edge_functions_registry — реестр Edge Functions
- app_settings — глобальные настройки приложения
- audit_logs — журнал аудита всех операций

===

## Как устроена документация

- Хранилище: admin_docs (единственный SoT)
- Ручные версии: POINT A/B/C — управляются через UI (active/draft/archived)
- AUTO-CURRENT: системная версия, обновляется nightly/manual refresh, meta.managed_by='system'
- Главный входной артефакт: platform_master AUTO-CURRENT
- Nightly refresh: 03:00 Europe/London, EF system-docs-nightly-refresh, idempotent
- Как использовать: /admin/docs → Архитектура платформы → Автообновление → Копировать

===

## Текущее состояние платформы

- Профилей: ${userCount}
- Записей user_roles: ${roleCount}
- Edge Functions в реестре: ${efCount}
- Записей audit_logs: ${auditCount}
- App Settings: ${appSettingsCount}
- Admin Menu Settings: ${adminMenuCount}

===

## Реестр Edge Functions

${efBlock}

===

## Доменные документы

- products_sales — Продукты и тарифы
- sites_pages_forms — Сайты и формы
- trainings_access — Тренинги и доступы
- orders_payments — Сделки и платежи
- integrations — Интеграции
- open_tails — Открытые хвосты

===

## Cron Runbook

Регистрация:
  SELECT cron.schedule('system-docs-nightly-refresh', '0 * * * *', ...);

Проверка:
  SELECT * FROM cron.job WHERE jobname = 'system-docs-nightly-refresh';

Переустановка:
  SELECT cron.unschedule('system-docs-nightly-refresh');
  -- затем повторный schedule

Отключение:
  SELECT cron.unschedule('system-docs-nightly-refresh');
`;
}

// ─── PRODUCTS & SALES ──────────────────────────────────────────────

async function buildProductsSalesSnapshot(supabase: any, warnings: string[]): Promise<string> {
  const products = await safeSelect(supabase, 'products_v2', 'id, name, status', { limit: 50 });
  const productCount = products.length;
  const tariffCount = await safeCount(supabase, 'tariffs');
  const offerCount = await safeCount(supabase, 'tariff_offers');
  const rulesCount = await safeCount(supabase, 'access_rules', { col: 'is_active', val: true });
  const relationsCount = await safeCount(supabase, 'product_relations');
  const mappingCount = await safeCount(supabase, 'bepaid_product_mappings');

  const productList = products
    .map((p: any) => `  - ${p.name} [${p.status}] (${p.id.substring(0, 8)})`)
    .join('\n');

  // Tariffs per product
  const tariffs = await safeSelect(supabase, 'tariffs', 'id, name, product_id, status', { limit: 100 });
  const tariffsByProduct: Record<string, any[]> = {};
  for (const t of tariffs) {
    const pid = t.product_id?.substring(0, 8) || 'no-product';
    if (!tariffsByProduct[pid]) tariffsByProduct[pid] = [];
    tariffsByProduct[pid].push(t);
  }
  const tariffBlock = Object.entries(tariffsByProduct)
    .map(([pid, ts]) => `  Продукт ${pid}:\n` + ts.map((t: any) => `    - ${t.name} [${t.status}]`).join('\n'))
    .join('\n');

  return `
===

## Источники истины (SoT)

- products_v2 — канонический реестр продуктов
- tariffs — тарифы продуктов
- tariff_offers — ценовые предложения (${offerCount})
- access_rules — правила доступа
- product_relations — связи между продуктами (${relationsCount})
- bepaid_product_mappings — маппинг на платёжные системы (${mappingCount})

===

## Текущее состояние

- Продуктов: ${productCount}
- Тарифов: ${tariffCount}
- Ценовых предложений (offers): ${offerCount}
- Активных правил доступа: ${rulesCount}
- Связей между продуктами: ${relationsCount}
- Маппингов на платёжные системы: ${mappingCount}

===

## Продукты

${productList || '  (нет данных)'}

===

## Тарифы по продуктам

${tariffBlock || '  (нет данных)'}
`;
}

// ─── ORDERS & PAYMENTS ─────────────────────────────────────────────

async function buildOrdersPaymentsSnapshot(supabase: any, warnings: string[]): Promise<string> {
  const orderCount = await safeCount(supabase, 'orders_v2');
  const paidCount = await safeCount(supabase, 'orders_v2', { col: 'status', val: 'paid' });
  const pendingCount = await safeCount(supabase, 'orders_v2', { col: 'status', val: 'pending' });
  const cancelledCount = await safeCount(supabase, 'orders_v2', { col: 'status', val: 'cancelled' });
  const paymentMethodsCount = await safeCount(supabase, 'payment_methods');
  const installmentCount = await safeCount(supabase, 'installment_payments');
  const bepaidRowsCount = await safeCount(supabase, 'bepaid_statement_rows');
  const reconcileQueueCount = await safeCount(supabase, 'payment_reconcile_queue');

  return `
===

## Источники истины (SoT)

- orders_v2 — заказы (канонический реестр)
- payments_v2 — платежи
- payment_methods — методы оплаты
- installment_payments — рассрочки
- bepaid_statement_rows — банковские выписки
- payment_reconcile_queue — очередь сверки платежей

===

## Текущее состояние

- Всего заказов: ${orderCount}
- Оплаченных: ${paidCount}
- Ожидающих: ${pendingCount}
- Отменённых: ${cancelledCount}
- Методов оплаты: ${paymentMethodsCount}
- Рассрочек: ${installmentCount}
- Строк банковских выписок: ${bepaidRowsCount}
- В очереди сверки: ${reconcileQueueCount}

===

## Контуры

- Основной поток: orders_v2 → payments_v2 → access_grant_ledger
- ERIP сверка: erip-reconcile-pending EF, payment_reconcile_queue
- bePaid выписки: bepaid_statement_rows, bepaid_sync_logs
- Рассрочки: installment_payments (связь с orders_v2)
`;
}

// ─── TRAININGS & ACCESS ────────────────────────────────────────────

async function buildTrainingsAccessSnapshot(supabase: any, warnings: string[]): Promise<string> {
  const moduleCount = await safeCount(supabase, 'training_modules');
  const lessonCount = await safeCount(supabase, 'training_lessons');
  const entitlementCount = await safeCount(supabase, 'entitlements', { col: 'status', val: 'active' });
  const subCount = await safeCount(supabase, 'subscriptions_v2');
  const lessonProgressCount = await safeCount(supabase, 'lesson_progress');
  const accessRulesCount = await safeCount(supabase, 'access_rules', { col: 'is_active', val: true });

  // Module list
  const modules = await safeSelect(supabase, 'training_modules', 'id, title, status', { limit: 30, order: { col: 'title', asc: true } });
  const moduleList = modules
    .map((m: any) => `  - ${m.title} [${m.status || 'n/a'}]`)
    .join('\n');

  return `
===

## Источники истины (SoT)

- training_modules — модули тренингов
- training_lessons — уроки
- entitlements — права доступа (status: active/expired/revoked)
- subscriptions_v2 — подписки
- lesson_progress — прогресс уроков
- access_rules — правила доступа

===

## Текущее состояние

- Модулей: ${moduleCount}
- Уроков: ${lessonCount}
- Активных entitlements: ${entitlementCount}
- Подписок: ${subCount}
- Записей lesson_progress: ${lessonProgressCount}
- Активных access_rules: ${accessRulesCount}

===

## Модули

${moduleList || '  (нет данных)'}

===

## Контуры

- Основной поток: order → access_grant_ledger → entitlement → training_module access
- Подписки: subscriptions_v2, автопродление через EF
- Прогресс: lesson_progress (связь с training_lessons)
- Отзыв доступа: telegram-check-expired EF, auto-revoke
`;
}

// ─── SITES & PAGES ─────────────────────────────────────────────────

async function buildSitesPagesSnapshot(supabase: any, warnings: string[]): Promise<string> {
  const pageCount = await safeCount(supabase, 'site_pages');
  const formSubmCount = await safeCount(supabase, 'site_form_submissions');
  const domainBindingsCount = await safeCount(supabase, 'site_domain_bindings');
  const pageFoldersCount = await safeCount(supabase, 'site_page_folders');

  // Pages with domains
  const pages = await safeSelect(supabase, 'site_pages', 'id, title, slug, status', { limit: 30, order: { col: 'title', asc: true } });
  const pageList = pages
    .map((p: any) => `  - ${p.title || '(без названия)'} [${p.status || 'n/a'}] /${p.slug || ''}`)
    .join('\n');

  // Domain bindings
  const bindings = await safeSelect(supabase, 'site_domain_bindings', 'id, domain, product_id, is_active', { limit: 20 });
  const bindingList = bindings
    .map((b: any) => `  - ${b.domain} [${b.is_active ? 'active' : 'inactive'}]`)
    .join('\n');

  return `
===

## Источники истины (SoT)

- site_pages — страницы сайтов
- site_form_submissions — отправки форм
- site_domain_bindings — привязки доменов к продуктам
- site_page_folders — папки страниц

===

## Текущее состояние

- Страниц: ${pageCount}
- Отправок форм: ${formSubmCount}
- Привязок доменов: ${domainBindingsCount}
- Папок: ${pageFoldersCount}

===

## Страницы

${pageList || '  (нет данных)'}

===

## Привязки доменов

${bindingList || '  (нет данных)'}

===

## Контуры

- Лендинги продуктов: site_pages → site_domain_bindings → products_v2
- Формы: site_form_submissions (контакты, предрегистрации)
- Публикация: public-product EF (рендер по домену)
`;
}

// ─── INTEGRATIONS ──────────────────────────────────────────────────

async function buildIntegrationsSnapshot(supabase: any, warnings: string[]): Promise<string> {
  const botCount = await safeCount(supabase, 'telegram_bots');
  const mappingCount = await safeCount(supabase, 'bepaid_product_mappings');
  const instanceCount = await safeCount(supabase, 'integration_instances');
  const logCount = await safeCount(supabase, 'integration_logs');
  const syncLogCount = await safeCount(supabase, 'bepaid_sync_logs');
  const emailAccountCount = await safeCount(supabase, 'email_accounts');

  // Telegram bots
  const bots = await safeSelect(supabase, 'telegram_bots', 'id, bot_name, is_active', { limit: 10 });
  const botList = bots
    .map((b: any) => `  - ${b.bot_name || '(без имени)'} [${b.is_active ? 'active' : 'inactive'}]`)
    .join('\n');

  // Integration instances
  const instances = await safeSelect(supabase, 'integration_instances', 'id, provider, status', { limit: 20 });
  const instanceList = instances
    .map((i: any) => `  - ${i.provider} [${i.status}]`)
    .join('\n');

  return `
===

## Источники истины (SoT)

- telegram_bots — Telegram боты
- bepaid_product_mappings — маппинг продуктов для платёжных систем
- integration_instances — экземпляры интеграций
- integration_logs — логи интеграций
- bepaid_sync_logs — логи синхронизации bePaid
- email_accounts — почтовые аккаунты

===

## Текущее состояние

- Telegram ботов: ${botCount}
- Payment маппингов: ${mappingCount}
- Экземпляров интеграций: ${instanceCount}
- Записей integration_logs: ${logCount}
- Записей bepaid_sync_logs: ${syncLogCount}
- Email аккаунтов: ${emailAccountCount}

===

## Telegram боты

${botList || '  (нет данных)'}

===

## Экземпляры интеграций

${instanceList || '  (нет данных)'}

===

## Контуры

- Telegram: telegram_bots → ai_bot_settings, telegram-webhook EF
- bePaid: bepaid_product_mappings, bepaid_sync_logs, bepaid_statement_rows
- Email: email_accounts, broadcast_templates
- AI: ai_bot_settings, ai_prompt_packages, ai_user_prompts
`;
}

// ─── OPEN TAILS ────────────────────────────────────────────────────

async function buildOpenTailsSnapshot(supabase: any, since24h: string, warnings: string[]): Promise<string> {
  const banCasesCount = await safeCount(supabase, 'ban_cases', { col: 'is_active', val: true });
  const duplicateCasesCount = await safeCount(supabase, 'duplicate_cases');
  const reconcileQueueCount = await safeCount(supabase, 'payment_reconcile_queue');

  // Recent failed/pending audit entries
  const pendingAudits = await safeSelect(supabase, 'audit_logs', 'action, meta, created_at', {
    limit: 50,
    order: { col: 'created_at', asc: false },
  });
  // Filter for relevant actions
  const filtered = pendingAudits.filter((a: any) =>
    a.action?.includes('pending') || a.action?.includes('failed') || a.action?.includes('deferred')
  );
  const pendingList = filtered
    .map((a: any) => `- ${a.created_at.substring(0, 16)} | ${a.action}`)
    .join('\n');

  return `
===

## Источники истины (SoT)

- audit_logs — все pending/failed/deferred записи
- ban_cases — блокировки
- ban_identifiers — идентификаторы блокировок
- duplicate_cases — кейсы дубликатов
- client_duplicates — связи дубликатов с профилями
- payment_reconcile_queue — очередь сверки

===

## Текущее состояние

- Активных блокировок (ban_cases): ${banCasesCount}
- Кейсов дубликатов: ${duplicateCasesCount}
- В очереди сверки платежей: ${reconcileQueueCount}

===

## Открытые хвосты и нерешённые задачи

### Pending / Failed / Deferred записи из audit_logs

${pendingList || '(нет записей)'}

===

## Известные незакрытые задачи

- duration_days=NULL в access_rules — требует ручной проверки
- Ретроактивный batch по product_access — pending implementation
- pending-live-proof для training access/runtime
- proof по site pricing block
- manual review / shortened / wrongly_removed entitlements
`;
}
