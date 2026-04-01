/**
 * system_docs_blueprint.ts — Единственный серверный SoT для архитектурного narrative.
 * 
 * Frontend НЕ импортирует этот файл. Все narrative-данные берутся только через EF-пайплайн.
 * 
 * STOP-guard narrative: генератор не имеет права писать неподтверждённые связи.
 * Если связь не доказана по FK/коду/discovery — маркировать как «не подтверждено» или «требует проверки».
 */

export interface DomainBlueprint {
  purpose: string;
  sotTables: { name: string; role: string }[];
  relatedTables: string[];
  edgeFunctions: { name: string; role: string }[];
  uiRoutes: { path: string; description: string }[];
  sharedHooks: string[];
  legacyZones: string[];
  crossDomainLinks: string[];
  knownIssues: string[];
  rules: string[];
  flows: { name: string; steps: string[] }[];
}

/** Фиксированный порядок секций в документе */
export const SECTION_ORDER = [
  '0. Назначение',
  '1. Источники истины (SoT)',
  '2. Таблицы и связи',
  '3. Ключевые потоки',
  '4. Edge Functions',
  '5. UI / маршруты',
  '6. Legacy / deprecated',
  '7. Текущее состояние',
  '8. Открытые хвосты',
] as const;

export const BLUEPRINTS: Record<string, DomainBlueprint> = {
  platform_master: {
    purpose: 'Канонический master-документ платформы. Описывает архитектуру, домены, cross-domain связи и служит входным артефактом для новых задач.',
    sotTables: [
      { name: 'admin_docs', role: 'Системная документация (единственный SoT)' },
      { name: 'profiles', role: 'Профили пользователей' },
      { name: 'user_roles', role: 'Роли (enum: admin, moderator, user, super_admin)' },
      { name: 'edge_functions_registry', role: 'Реестр Edge Functions (PK=name, enabled, category, tier, notes)' },
      { name: 'app_settings', role: 'Глобальные настройки (PK=key)' },
      { name: 'audit_logs', role: 'Журнал аудита всех операций' },
      { name: 'admin_menu_settings', role: 'Настройки меню админки' },
    ],
    relatedTables: [],
    edgeFunctions: [
      { name: 'system-docs-nightly-refresh', role: 'Nightly + manual refresh документации. Cron: каждый час, guard: 03:00 Europe/London' },
    ],
    uiRoutes: [
      { path: '/admin/docs', description: 'Hub документации — все домены, manual/auto версии' },
      { path: '/admin/roles', description: 'Управление ролями пользователей' },
      { path: '/admin/system-health', description: 'Системный мониторинг' },
    ],
    sharedHooks: ['useSystemDocs', 'useRbac'],
    legacyZones: [],
    crossDomainLinks: [
      'продукты (products_v2) → тарифы (tariffs) → предложения (tariff_offers) → заказы (orders_v2) → платежи (payments_v2) → доступы (entitlements) — подтверждено FK',
      'продукты (products_v2) → тренинги (training_lessons.product_id FK) → модули (training_modules) — подтверждено FK',
      'access_rules → products_v2 (product_id FK), tariffs (tariff_id FK) → entitlements — подтверждено FK',
      'сайты: site_domain_bindings → site_pages (site_page_id FK). Прямой FK на products_v2 отсутствует — связь продукт↔домен косвенная, через контент страницы (неполная доказательная связь)',
      'Telegram clubs → product_club_mappings → subscriptions_v2/access — требует проверки, FK не подтверждён в discovery',
      'docs subsystem: admin_docs ← system-docs-nightly-refresh EF (AUTO-CURRENT) — подтверждено',
    ],
    knownIssues: [
      'actor_user_id proof для manual refresh — pending UI proof',
      'proof seed/repair полноты snapshot — pending',
      'build-proof — pending verification',
    ],
    rules: [
      'Один SoT для blueprint — _shared/system_docs_blueprint.ts',
      'Frontend не импортирует blueprint',
      'Nightly refresh idempotent по batch_key',
    ],
    flows: [
      {
        name: 'nightly docs refresh pipeline',
        steps: [
          'cron-hourly → EF system-docs-nightly-refresh',
          'guard: только 03:00 Europe/London',
          'idempotency check по batch_key',
          'buildDomainDocument(key, auto_current) для каждого домена',
          'blueprint narrative + live DB snapshot + changes 24h + open tails',
          'upsert AUTO-CURRENT в admin_docs',
          'audit_logs: nightly_refresh_completed',
        ],
      },
    ],
  },

  products_sales: {
    purpose: 'Реестр продуктов, тарифов, ценовых предложений и правил доступа. Центральный домен коммерческой логики.',
    sotTables: [
      { name: 'products_v2', role: 'Канонический реестр продуктов (name, slug, status)' },
      { name: 'tariffs', role: 'Тарифы продуктов. FK: product_id → products_v2. Статус: is_active (не status)' },
      { name: 'tariff_offers', role: 'Ценовые предложения (кнопки оплаты). FK: tariff_id → tariffs, auto_charge_offer_id → tariff_offers' },
      { name: 'access_rules', role: 'Правила доступа. FK: product_id → products_v2, tariff_id → tariffs' },
      { name: 'product_relations', role: 'Связи между продуктами (parent/child). FK: parent_product_id, child_product_id → products_v2' },
      { name: 'bepaid_product_mappings', role: 'Маппинг на платёжные системы' },
    ],
    relatedTables: ['orders_v2', 'entitlements'],
    edgeFunctions: [
      { name: 'grant-access-for-order', role: 'Выдача доступов после оплаты заказа' },
      { name: 'public-product', role: 'Публичный рендер продукта по домену' },
    ],
    uiRoutes: [
      { path: '/admin/products-v2', description: 'Управление продуктами' },
      { path: '/admin/products-v2/docs', description: 'Документация домена products_sales' },
    ],
    sharedHooks: [],
    legacyZones: [],
    crossDomainLinks: [
      'products_v2 → tariffs (product_id FK) → tariff_offers (tariff_id FK)',
      'products_v2 → access_rules (product_id FK) → entitlements (product_id FK)',
      'products_v2 → orders_v2 (product_id FK) → payments_v2 (order_id FK)',
      'products_v2 → training_lessons (product_id FK)',
    ],
    knownIssues: [
      'duration_days=NULL в access_rules — требует ручной проверки',
      'retroactive batch для product_access — pending implementation',
      'prior_purchase behavior — требует runtime proof',
    ],
    rules: [
      'STOP-guard: products_sales manual history read-only при seed/repair',
      'Только AUTO-CURRENT разрешён для системных обновлений',
    ],
    flows: [
      {
        name: 'product purchase → order → paid → grant-access-for-order',
        steps: [
          'Клиент выбирает tariff_offer',
          'Создаётся order (orders_v2) со статусом pending',
          'Оплата через bePaid/ERIP → payment (payments_v2)',
          'Статус order → paid',
          'EF grant-access-for-order → access_grant_ledger → entitlement',
        ],
      },
      {
        name: 'product_access / prior_purchase',
        steps: [
          'Проверка: есть ли entitlement с status=active для product_id + profile_id',
          'prior_purchase: проверка orders_v2 на наличие paid order',
          'Логика определения доступа — через access_rules + entitlements',
        ],
      },
    ],
  },

  trainings_access: {
    purpose: 'Тренинги, модули, уроки, доступы и прогресс обучения.',
    sotTables: [
      { name: 'training_modules', role: 'Модули тренингов (title, is_active — не status)' },
      { name: 'training_lessons', role: 'Уроки. FK: module_id → training_modules, product_id → products_v2' },
      { name: 'entitlements', role: 'Права доступа (status: active/expired/revoked). FK: product_id → products_v2, order_id → orders_v2' },
      { name: 'subscriptions_v2', role: 'Подписки' },
      { name: 'lesson_progress', role: 'Прогресс прохождения уроков' },
      { name: 'access_rules', role: 'Правила доступа. FK: product_id → products_v2, tariff_id → tariffs' },
    ],
    relatedTables: ['products_v2', 'orders_v2'],
    edgeFunctions: [
      { name: 'telegram-check-expired', role: 'Автоматический отзыв доступа по истечению' },
    ],
    uiRoutes: [
      { path: '/admin/trainings', description: 'Управление тренингами' },
    ],
    sharedHooks: [],
    legacyZones: [],
    crossDomainLinks: [
      'training_lessons → products_v2 (product_id FK)',
      'training_lessons → training_modules (module_id FK)',
      'entitlements → products_v2 (product_id FK), orders_v2 (order_id FK)',
    ],
    knownIssues: [
      'training access runtime proof — pending',
      'lesson counts proof — pending',
      'pending live proof по renewal/access',
    ],
    rules: [],
    flows: [
      {
        name: 'trainings_access / training_content',
        steps: [
          'order paid → grant-access-for-order EF',
          'access_grant_ledger → entitlement (product_id, profile_id)',
          'entitlement status=active → доступ к training_modules/lessons',
          'lesson_progress отслеживает прохождение',
          'telegram-check-expired → auto-revoke при истечении',
        ],
      },
    ],
  },

  orders_payments: {
    purpose: 'Заказы, платежи, рассрочки, банковские выписки и сверка.',
    sotTables: [
      { name: 'orders_v2', role: 'Канонический реестр заказов. FK: product_id→products_v2, tariff_id→tariffs, offer_id→tariff_offers, profile_id→profiles. Статус canceled (одна l, не cancelled)' },
      { name: 'payments_v2', role: 'Платежи. FK: order_id → orders_v2, profile_id → profiles' },
      { name: 'payment_methods', role: 'Методы оплаты' },
      { name: 'installment_payments', role: 'Рассрочки' },
      { name: 'bepaid_statement_rows', role: 'Банковские выписки bePaid' },
      { name: 'payment_reconcile_queue', role: 'Очередь сверки платежей' },
    ],
    relatedTables: ['access_grant_ledger', 'entitlements'],
    edgeFunctions: [
      { name: 'erip-reconcile-pending', role: 'Сверка ERIP платежей' },
      { name: 'bepaid-sync', role: 'Синхронизация выписок bePaid' },
    ],
    uiRoutes: [
      { path: '/admin/orders', description: 'Управление заказами' },
    ],
    sharedHooks: [],
    legacyZones: [],
    crossDomainLinks: [
      'orders_v2 → products_v2 (product_id FK)',
      'orders_v2 → tariffs (tariff_id FK), tariff_offers (offer_id FK)',
      'payments_v2 → orders_v2 (order_id FK)',
      'orders_v2 paid → access_grant_ledger → entitlements',
    ],
    knownIssues: [
      'order_number NOT NULL — требует контроля',
      'dedup по profile_id+product_id — требует проверки',
    ],
    rules: [
      'Статус canceled пишется с одной l',
    ],
    flows: [
      {
        name: 'site form → profile resolve → draft order',
        steps: [
          'site_form_submissions → resolve-profile-id',
          'Создание или нахождение profiles',
          'Создание draft order (orders_v2, status=pending)',
        ],
      },
    ],
  },

  sites_pages_forms: {
    purpose: 'Сайты, страницы, домены и формы обратной связи.',
    sotTables: [
      { name: 'site_pages', role: 'Страницы сайтов (title, slug, status)' },
      { name: 'site_domain_bindings', role: 'Привязки доменов к страницам. FK: site_page_id → site_pages. ВНИМАНИЕ: прямого FK на products_v2 нет — связь продукт↔домен определяется через контент страницы (неполная доказательная связь)' },
      { name: 'site_form_submissions', role: 'Отправки форм (контакты, предрегистрации)' },
      { name: 'site_page_folders', role: 'Папки страниц' },
    ],
    relatedTables: ['profiles', 'orders_v2'],
    edgeFunctions: [
      { name: 'public-product', role: 'Публичный рендер страницы по домену' },
    ],
    uiRoutes: [
      { path: '/admin/sites', description: 'Управление сайтами' },
    ],
    sharedHooks: [],
    legacyZones: [],
    crossDomainLinks: [
      'site_domain_bindings → site_pages (site_page_id FK). Прямой FK на products_v2 отсутствует',
      'site_form_submissions → resolve-profile-id → profiles → draft order (косвенная связь)',
    ],
    knownIssues: [
      'site pricing proof — pending',
      'Путь продукт↔домен неполный — нет прямого FK, связь через контент страницы',
    ],
    rules: [
      'site_domain_bindings НЕ описывать как прямую привязку домена к продукту — в схеме site_page_id, а не product_id',
    ],
    flows: [
      {
        name: 'site form → CRM profile → draft order',
        steps: [
          'Посетитель заполняет форму на лендинге',
          'site_form_submissions → EF обработка',
          'resolve-profile-id → profiles',
          'Создание draft order при необходимости',
        ],
      },
    ],
  },

  integrations: {
    purpose: 'Telegram боты, bePaid интеграция, email, AI-боты.',
    sotTables: [
      { name: 'telegram_bots', role: 'Telegram боты (bot_name, status — не is_active)' },
      { name: 'bepaid_product_mappings', role: 'Маппинг продуктов для платёжных систем' },
      { name: 'integration_instances', role: 'Экземпляры интеграций (provider, status)' },
      { name: 'integration_logs', role: 'Логи интеграций' },
      { name: 'bepaid_sync_logs', role: 'Логи синхронизации bePaid' },
      { name: 'email_accounts', role: 'Почтовые аккаунты' },
    ],
    relatedTables: ['ai_bot_settings', 'ai_prompt_packages', 'broadcast_templates'],
    edgeFunctions: [
      { name: 'telegram-webhook', role: 'Обработка Telegram webhook' },
      { name: 'bepaid-sync', role: 'Синхронизация bePaid транзакций' },
    ],
    uiRoutes: [
      { path: '/admin/integrations', description: 'Управление интеграциями' },
    ],
    sharedHooks: [],
    legacyZones: [],
    crossDomainLinks: [
      'telegram_bots → ai_bot_settings (bot_id FK)',
      'bepaid_product_mappings → products_v2, tariffs, tariff_offers',
    ],
    knownIssues: [],
    rules: [
      'edge_functions_registry содержит: name (PK), enabled, category, tier, notes — выводить как реестр EF, а не как полный список всех EF платформы',
    ],
    flows: [],
  },

  open_tails: {
    purpose: 'Канонический реестр незакрытых задач, pending proof, deferred и known bugs.',
    sotTables: [
      { name: 'audit_logs', role: 'Все pending/failed/deferred записи' },
      { name: 'ban_cases', role: 'Блокировки (is_active)' },
      { name: 'duplicate_cases', role: 'Кейсы дубликатов' },
      { name: 'payment_reconcile_queue', role: 'Очередь сверки' },
    ],
    relatedTables: ['ban_identifiers', 'client_duplicates'],
    edgeFunctions: [],
    uiRoutes: [],
    sharedHooks: [],
    legacyZones: [],
    crossDomainLinks: [],
    knownIssues: [
      'actor_user_id proof для manual refresh — pending UI proof',
      'training access runtime proof — pending',
      'site pricing proof — pending',
      'duration_days=NULL в access_rules — требует ручной проверки',
      'retroactive batch для product_access — pending implementation',
      'manual review / wrongly_removed / shortened entitlements — pending',
      'pending live proof по renewal/access — pending',
      'proof, что docs generator реально даёт полный snapshot, а не scaffold — pending',
    ],
    rules: [],
    flows: [],
  },
};

/** Scaffold signature sections for placeholder detection */
export const SCAFFOLD_SIGNATURES = [
  '(Заполнить)',
  '## Цель документа\n\n(Заполнить)',
  '## Anti-duplication proof\n\n(Заполнить)',
];

/** Domains excluded from seed/repair (manual history read-only) */
export const SEED_REPAIR_EXCLUDED_DOMAINS = ['products_sales'];
