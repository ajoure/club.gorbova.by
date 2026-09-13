I'll gather the facts with read-only queries.




































































Отчет о выполнении: только SELECT и чтение исходников. Записей, изменений кода, миграций, deploy и Publish нет. HEAD `363601dff31bd43a545c2c4846865572b0da3822`, очередь свободна.

## 1. Три сделки `no_product_binding`
Классификация воспроизведена точно (26 / 37 / 58 / 318 / 3).

Группа A — продукт «Ценный бухгалтер | 1 ступень 2.0 | Модуль: Посредничество» `aa11cb00-0000-4000-8000-000000000001` (активен, category=course), тариф «Стандарт» `aa11cb00-0000-4000-8000-000000000101`: 2 сделки. Одна `paid` 0.00 BYN, `meta.source=admin_grant`, оффера нет (13.05.2024). Одна `pending` 158.73 BYN, оффер есть, `reconcile_source=composable_checkout` (27.08.2026). У тарифа 3 оффера, активных `pay_now` — 1, с `crm_routing.enabled=true` — 0.

Группа B — продукт «Ценный бухгалтер | 1 ступень 2.0 | 21 поток» `2b7bf6d4-ad8d-46ad-9399-7f96c307c596` (активен), тариф «Бизнес-леди ранее учились» `dbdb839e-84a0-4c00-8b8c-e60e4c558d94`: 1 сделка `pending` 1675.00 BYN, оффер есть (27.08.2026). У тарифа 4 оффера, активных `pay_now` — 3, с включённым `crm_routing` — 0.

Mapping: оба продукта существуют только в `products_v2`; в legacy `products` записей по этим id нет. Биндингов в `crm_pipeline_product_bindings` у обоих продуктов нет. Все 17 существующих биндингов: 10 ведут в «ЦБ | 1 ступень |» `a0000001-0000-0000-0000-000000000002` (головной продукт `7101ed3c…` плюс 8 модулей: Грузоперевозки, Маркетплейсы, Общепит, ПВТ, Производство, Розница, Строительство, Учёт у ИП), остальные — Gorbova Club, Бухгалтерия как бизнес, Закрой год, Платная консультация, Подоходный налог ИП, Подоходный налог с ФЛ, Тестовый продукт, «ЦБ | 2 ступень | 3 поток» `a0000001-0000-0000-0000-000000000004`.

Однозначный маршрут по существующей конфигурации: оба продукта — часть линейки «ЦБ | 1 ступень 2.0», у всех восьми сестринских модулей и головного продукта биндинг ровно один и тот же — воронка `a0000001-0000-0000-0000-000000000002`. Иных кандидатов в конфигурации нет.

## 2. Шесть сделок CB20 «Главный бухгалтер»
Продукт «Ценный бухгалтер | 1 ступень 2.0 | 20 поток», тариф «Главный бухгалтер»: все 6 в статусе `paid`, сумма 11 700.00 BYN, нулевых сумм — 0, `partial`/`refunded`/`pending` нет. Различие офферов — только pending-стадия («Рассрочка» против «Новая»), терминальные совпадают.

## 3. Схема `crm_pipeline_stages` и стадии воронки `a0000001-…-0002`
Колонки: `id` uuid (default gen_random_uuid), `public_id` text (default `'PS-'||substr(...)`), `pipeline_id` uuid NOT NULL, `name` text NOT NULL, `color` text default `#6366f1`, `stage_type` text NOT NULL default `open`, `order_index` int NOT NULL default 0, `is_default` bool NOT NULL default false, `metadata` jsonb default `{}`, `created_at`/`updated_at`, `created_by`/`updated_by`. Колонки `is_active` нет.

Стадии воронки `a0000001-0000-0000-0000-000000000002` (все `is_default=false`, metadata пустая):
- `b0000001-0002-0000-0000-000000000001` «Новая», open, order_index 0
- `b0000001-0002-0000-0000-000000000002` «В работе», open, 1
- `d2515dfe-5a92-4e50-baa9-db97451f1d17` «Счет для ЮЛ», open, 2
- `ebe94612-8d49-4b04-ade1-99c58aa00835` «Рассрочка», open, 3
- `8c8ca380-cc65-4863-8e04-01d9dd357306` «Заявка на кредит», open, 4
- `b0000001-0002-0000-0000-000000000003` «Успешно», closed_won, 5
- `b0000001-0002-0000-0000-000000000004` «Отказ», closed_lost, 6

Существующие `is_default=true` во всём проекте — ровно три, все «Новая», order_index 0, stage_type open: воронки «Идеология» (`45387c31-15f3-4683-9234-a31cf7d370dd`), «Налоги и проверки Беларуси» (`ec5a3585-619d-4edd-9ca2-0c7cdf4dde4b`), «Основная» (`43ded272-6263-4bf4-8bb3-6641f0d0c2f8`). В `a0000001-…-0002` default отсутствует; уникального индекса «один default на воронку» в схеме нет.

## 4. Триггеры `orders_v2` при бэкфилле routing
Всего 13 активных триггеров. На изменение `pipeline_id`/`pipeline_stage_id` реагируют два:
- `trg_validate_deal_pipeline_stage` (BEFORE INSERT/UPDATE, WHEN pipeline или стадия не NULL) — только валидация принадлежности стадии воронке.
- `trg_crm_pipeline_automation_stage_entry` (AFTER INSERT OR UPDATE OF pipeline_id, pipeline_stage_id) — вставляет строки в `crm_pipeline_automation_jobs`. Внутри: выход, если выключен флаг `feature_crm_pipeline_automation_v1` (сейчас `true`), выход при `NEW.is_deleted`, выход, если обе колонки не изменились. Job создаётся только если есть правило с `pipeline_id`+`stage_id` цели и `status='active'`.

Фактический риск сейчас нулевой: таблица `crm_pipeline_automation_rules` пуста (0 строк), поэтому бэкфилл стадии не создаёт ни одной job и не порождает писем, Telegram-сообщений, задач или выдачи доступов. Доступы и деньги триггерами стадии не затрагиваются вовсе: referral-триггеры слушают только `status`, `paid_amount`, `profile_id`, `product_id`, `base_price`, `final_price`; выдача доступа выполняется отдельными функциями по оплате, не по стадии.

`is_deleted` не входит в список колонок ни одного триггера. При его изменении срабатывают только `update_orders_v2_updated_at` и `trg_validate_deal_pipeline_stage` (если стадия проставлена). Отдельного guard-триггера на `is_deleted` нет — это подтверждает прежний вывод.

## 5. Pending provider subscriptions: где хранится checkout и срок
Таблица `provider_subscriptions`: `provider`, `provider_subscription_id`, `state`, `order_id`, `meta` jsonb, `raw_data` jsonb, `card_token` и др. Состояния: bepaid — expired 258, canceled 225, active 160, failed 125, redirecting 75, pending 16, failed_attempt 3, completed 2; stripe — pending 3, canceled 1.

Для `pending`+`redirecting` (91 строка) `meta` содержит документированные поля: `checkout_url` (68), `checkout_created_at` (59), `tracking_id` (68), `order_id` (67), `snapshot_at` (74), `provider_snapshot` (47), `cancellation_capability` (47), `payment_link_id`, `installment`, `billing_cycles`. В `raw_data` — `state`, `created_at`, `checkout_url_present` (флаг, без самого URL), `subscription_id`, `active_to`, `renew_at`.

Поля явного срока действия ссылки нет ни в одной строке: `expired_at` в `meta`/`raw_data` — 0 совпадений по всей таблице. Срок вычисляется исключительно кодом от `checkout_created_at` (`_shared/create-payment-checkout.ts`: 15 мин для one_time, 24 ч для подписок; `_shared/existing-installment-checkout.ts` использует ту же пару `checkout_url` + `checkout_created_at`). Reuse-ветка на строках 784–843 прямо требует наличия валидного `checkout_url`, иначе создаётся новый заказ.

Готовый безопасный read-only помощник уже существует: edge-функция `bepaid-readonly-pull` — строгий контракт «никаких записей в `subscriptions_v2` / `provider_subscriptions` / `audit_logs` / Telegram», авторизация через `authorizePaymentsReconcile` плюс admin/superadmin, возвращает сырое состояние провайдера по `sbs_*`. Для сверки без обращения к провайдеру есть `bepaid-get-subscription-details` и `admin-auto-renewal-observability`; мутирующие восстановления изолированы в `_shared/bepaid-canonical-recovery.ts` и отдельных admin-функциях.

Секреты, подписанные и платёжные URL, токены, персональные данные и идентификаторы клиентов/заказов не выводились.
