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
      actor_type: source === 'manual' ? 'admin' : 'system',
      actor_user_id: null,
      actor_label: source === 'manual' ? 'admin_system_docs' : 'system_docs_nightly_refresh',
      meta: { batch_id: batchKey, source },
    });

    const snapshotAt = now.toISOString();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const warnings: string[] = [];
    let updatedCount = 0;

    // Collect changes from audit_logs for last 24h
    const { data: recentAudit } = await supabase
      .from('audit_logs')
      .select('action, meta, created_at')
      .gte('created_at', since24h)
      .order('created_at', { ascending: false })
      .limit(100);

    const changesSummary = (recentAudit || [])
      .map((a: any) => `- ${a.created_at.substring(0, 16)} | ${a.action}`)
      .join('\n');

    for (const domain of SYSTEM_DOC_DOMAINS) {
      let content = '';
      try {
        content = await buildDomainSnapshot(supabase, domain.key, domain.title, snapshotAt, changesSummary, since24h);
      } catch (e) {
        console.error(`Error building snapshot for ${domain.key}:`, e);
        content = `${domain.title}\n===\n\nОшибка сборки снимка: ${e.message}\n\nTimestamp: ${snapshotAt}`;
        warnings.push(`error:${domain.key}`);
      }

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

      // STOP-guard: more than one AUTO-CURRENT
      if (existingDocs.length > 1) {
        warnings.push(`duplicate_auto:${domain.key}`);
        console.error(`STOP: ${existingDocs.length} AUTO-CURRENT records for ${domain.key} — skipping, needs repair`);
        continue;
      }

      if (existingDocs.length === 1) {
        // UPDATE existing
        await supabase
          .from('admin_docs')
          .update({
            content_text: content,
            meta,
            updated_at: snapshotAt,
          })
          .eq('id', existingDocs[0].id);
      } else {
        // INSERT new
        await supabase
          .from('admin_docs')
          .insert({
            section_key: domain.key,
            version_label: 'AUTO-CURRENT',
            status: 'active',
            content_text: content,
            meta,
          });
      }
      updatedCount++;
    }

    const completedAction = source === 'manual'
      ? 'system_docs.manual_refresh_completed'
      : 'system_docs.nightly_refresh_completed';

    await supabase.from('audit_logs').insert({
      action: completedAction,
      actor_type: source === 'manual' ? 'admin' : 'system',
      actor_user_id: null,
      actor_label: source === 'manual' ? 'admin_system_docs' : 'system_docs_nightly_refresh',
      meta: { batch_id: batchKey, updated_count: updatedCount, warnings, source },
    });

    return new Response(JSON.stringify({
      success: true,
      batchKey,
      updatedCount,
      warnings,
    }), {
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
  since24h: string
): Promise<string> {
  const header = `${title}\n===\n\nОбновлено автоматически: ${snapshotAt} (Europe/London)\n`;

  const changesBlock = changesSummary
    ? `\n===\n\nИзменения за последние 24 часа\n\n${changesSummary}\n`
    : `\n===\n\nИзменения за последние 24 часа\n\nНет изменений.\n`;

  let domainContent = '';

  switch (domainKey) {
    case 'products_sales':
      domainContent = await buildProductsSalesSnapshot(supabase);
      break;
    case 'orders_payments':
      domainContent = await buildOrdersPaymentsSnapshot(supabase);
      break;
    case 'trainings_access':
      domainContent = await buildTrainingsAccessSnapshot(supabase);
      break;
    case 'sites_pages_forms':
      domainContent = await buildSitesPagesSnapshot(supabase);
      break;
    case 'integrations':
      domainContent = await buildIntegrationsSnapshot(supabase);
      break;
    case 'open_tails':
      domainContent = await buildOpenTailsSnapshot(supabase, since24h);
      break;
    case 'platform_master':
      domainContent = await buildPlatformMasterSnapshot(supabase);
      break;
    default:
      domainContent = '\n===\n\nНет данных для этого домена.\n';
  }

  return header + changesBlock + domainContent;
}

async function buildProductsSalesSnapshot(supabase: any): Promise<string> {
  const { data: products, count: productCount } = await supabase
    .from('products_v2')
    .select('id, name, status', { count: 'exact' })
    .limit(50);

  const { count: tariffCount } = await supabase
    .from('tariffs')
    .select('id', { count: 'exact', head: true });

  const { count: rulesCount } = await supabase
    .from('access_rules')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  const productList = (products || [])
    .map((p: any) => `  - ${p.name} [${p.status}] (${p.id.substring(0, 8)})`)
    .join('\n');

  return `
===

## Источники истины (SoT)

- products_v2 — канонический реестр продуктов
- tariffs — тарифы продуктов
- tariff_offers — ценовые предложения
- access_rules — правила доступа

===

## Текущее состояние

- Продуктов: ${productCount || 0}
- Тарифов: ${tariffCount || 0}
- Активных правил доступа: ${rulesCount || 0}

Продукты:
${productList || '  (нет данных)'}
`;
}

async function buildOrdersPaymentsSnapshot(supabase: any): Promise<string> {
  const { count: orderCount } = await supabase
    .from('orders_v2')
    .select('id', { count: 'exact', head: true });

  const { count: paidCount } = await supabase
    .from('orders_v2')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'paid');

  return `
===

## Источники истины (SoT)

- orders_v2 — заказы
- payments_v2 — платежи
- bepaid_statement_rows — банковские выписки

===

## Текущее состояние

- Всего заказов: ${orderCount || 0}
- Оплаченных: ${paidCount || 0}
`;
}

async function buildTrainingsAccessSnapshot(supabase: any): Promise<string> {
  const { count: moduleCount } = await supabase
    .from('training_modules')
    .select('id', { count: 'exact', head: true });

  const { count: lessonCount } = await supabase
    .from('training_lessons')
    .select('id', { count: 'exact', head: true });

  const { count: entitlementCount } = await supabase
    .from('entitlements')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  return `
===

## Источники истины (SoT)

- training_modules — модули тренингов
- training_lessons — уроки
- entitlements — права доступа
- subscriptions_v2 — подписки
- access_rules — правила доступа

===

## Текущее состояние

- Модулей: ${moduleCount || 0}
- Уроков: ${lessonCount || 0}
- Активных entitlements: ${entitlementCount || 0}
`;
}

async function buildSitesPagesSnapshot(supabase: any): Promise<string> {
  const { count: pageCount } = await supabase
    .from('site_pages')
    .select('id', { count: 'exact', head: true });

  return `
===

## Источники истины (SoT)

- site_pages — страницы сайтов
- site_form_submissions — отправки форм

===

## Текущее состояние

- Страниц: ${pageCount || 0}
`;
}

async function buildIntegrationsSnapshot(supabase: any): Promise<string> {
  const { count: botCount } = await supabase
    .from('telegram_bots')
    .select('id', { count: 'exact', head: true });

  const { count: mappingCount } = await supabase
    .from('bepaid_product_mappings')
    .select('id', { count: 'exact', head: true });

  return `
===

## Источники истины (SoT)

- telegram_bots — Telegram боты
- bepaid_product_mappings — маппинг продуктов для платёжных систем

===

## Текущее состояние

- Telegram ботов: ${botCount || 0}
- Payment маппингов: ${mappingCount || 0}
`;
}

async function buildOpenTailsSnapshot(supabase: any, since24h: string): Promise<string> {
  // Collect recent failed/pending audit entries
  const { data: pendingAudits } = await supabase
    .from('audit_logs')
    .select('action, meta, created_at')
    .or('action.ilike.%pending%,action.ilike.%failed%,action.ilike.%deferred%')
    .order('created_at', { ascending: false })
    .limit(50);

  const pendingList = (pendingAudits || [])
    .map((a: any) => `- ${a.created_at.substring(0, 16)} | ${a.action}`)
    .join('\n');

  return `
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

async function buildPlatformMasterSnapshot(supabase: any): Promise<string> {
  const { count: userCount } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true });

  const { count: roleCount } = await supabase
    .from('user_roles')
    .select('id', { count: 'exact', head: true });

  return `
===

## Архитектура платформы — Master Document

Каноническое описание системы. Используйте как входной артефакт для новых задач.

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

- Профилей: ${userCount || 0}
- Записей user_roles: ${roleCount || 0}

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
