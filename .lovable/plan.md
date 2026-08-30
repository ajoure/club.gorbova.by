# План: Products 2 / атрибуция менеджера продаж — ревизия SHA d3c5718

Режим ревизии: READ-ONLY. Ничего не менялось: код, БД, функции и Publish не трогались.

## 1. Состояние SHA и production

- В рабочем дереве есть точный merge-коммит `d3c57183532e53ce71202c25fab48d48f641cf05` (PR #393 «Продукты 2: платежи и аналитика по менеджерам»).
- Поверх него платформа автоматически создала WIP-коммит `65ba6f78e`, который удалил 131 строку из `src/integrations/supabase/types.ts` — ровно типы `payment_sales_attribution`, `set_deal_responsible_v1`, `set_deals_responsible_bulk_v1`, `sales_manager_report_v1`, `admin_create_deal_v2`. Других отличий от merge SHA нет. Это не ручная правка, а регенерация типов под фактическую схему production.
- Production-схема подтверждает: ни одна из трёх миграций не применена (таблицы атрибуции нет, 0 из 4 новых функций, нет `payment_links.responsible_user_id`, 0 из 5 новых permissions, в журнале миграций нет версий 20260830083925 / 20260830085855 / 20260830113500).
- Edge Functions из scope изменены в коммите `7d6767682` (входит в merge) и в production ещё в старой версии — deploy обязателен.
- Вывод: и схема, и функции — pending. Публикация фронтенда без миграций даст неработающие вкладки (отчёт и фильтры по менеджеру).

## 2. Порядок миграций и найденные риски

Порядок строгий: 083925 → 085855 → 113500.

- **083925 (данные и безопасность).** Создаёт `payment_sales_attribution` (RLS on, `REVOKE ALL`, только `SELECT` для authenticated, партиальный unique «одна активная версия на платёж»), триггер наследования на `payments_v2`, guard-триггер на `orders_v2.responsible_user_id`, RPC `set_deal_responsible_v1`. Зависимости в production есть: `has_permission`, `has_role_v2`, роли `admin/super_admin/menedzher`, колонки `payments_v2.reference_payment_id/import_ref/origin/is_deleted`.
- **Критично (порядок):** `set_deal_responsible_v1` пишет в `audit_logs` `actor_type='service'`, а действующий CHECK в production допускает только `user`/`system`. Расширение констрейнта делает только миграция 085855. Значит между 083925 и 085855 любой вызов RPC из service_role упадёт. Обе миграции применять в одной сессии подряд, до deploy функций.
- **085855 (создание и UI).** Расширяет CHECK `audit_logs`, добавляет `payment_links.responsible_user_id` + индекс, guard-триггер на `payment_links`, `admin_create_deal_v2` (обёртка над существующим `admin_create_deal`), `set_deals_responsible_bulk_v1` (лимит 500), `CREATE OR REPLACE VIEW payment_links_enriched_v`. Проверено: новые колонки (`responsible_user_id`, `responsible_name`, `responsible_email`) добавляются в конец существующего списка из 36 колонок — `CREATE OR REPLACE VIEW` пройдёт.
- **Риск поведения (не блокирующий):** guard на `orders_v2` запрещает любому клиенту с ролью `authenticated` менять `responsible_user_id` напрямую — только через RPC. Любой существующий фронтовый или RPC-путь, обновляющий это поле напрямую, начнёт возвращать `use_set_deal_responsible_v1`. В smoke-проверке это нужно подтвердить как ожидаемый fail-closed, а не как регресс.
- **113500 (аналитика).** `sales_manager_report_v1`, SECURITY DEFINER, `search_path=''`, доступ только authenticated с `sales_reports.view_all` / `view_own`, валюты не суммируются, возвраты идут за текущей атрибуцией, рассрочка разделена на received/expected.
- Исторический backfill в миграциях отсутствует — это подтверждают и контрактные тесты.

## 3. Точный scope deploy Edge Functions

Деплоить ровно пять функций (все ссылаются на общий `_shared/sales-manager-attribution.ts`, он попадает в сборку каждой):

1. `admin-create-payment-link`
2. `admin-create-public-link`
3. `admin-invoice-checkout-issue`
4. `public-checkout`
5. `public-rr-installment-initiate`

Deploy — только ПОСЛЕ трёх миграций: функции обращаются к `payment_links.responsible_user_id` и `set_deal_responsible_v1`.

## 4. Безопасные read-back и fail-closed проверки

Без создания реальных платежей, ссылок, сообщений, пользователей и контактов.

Каталожные проверки (SQL, read-only):
- таблица атрибуции существует, RLS включён, партиальный unique-индекс на месте;
- у `anon` нет SELECT, у `authenticated` нет INSERT/UPDATE/DELETE на таблице атрибуции;
- 5 permissions созданы; `admin/super_admin` имеют все, `menedzher` — только `deals.assign_self` и `sales_reports.view_own`;
- `set_deal_responsible_v1`, `set_deals_responsible_bulk_v1`, `admin_create_deal_v2`, `sales_manager_report_v1` — SECURITY DEFINER, `search_path=''`, EXECUTE у authenticated, нет у anon;
- `payment_links_enriched_v` отдаёт `responsible_name`;
- готовые контрактные наборы: `supabase/tests/sales_manager_attribution_v1.sql`, `sales_manager_creation_ui_v1.sql`, `sales_manager_payments_analytics_v1.sql` + vitest-контракты в `src/test/salesManager*.contract.test.ts`.

Fail-closed пробы функций: только `OPTIONS` (ожидание 200) и запрос без JWT / с повреждённым JWT (ожидание 401), без тела, создающего сущности.

Инвариантность данных (до/после): счётчики `orders_v2`, `payments_v2`, `payment_links`, `audit_logs`, а также `payment_sales_attribution` — новых строк от самих миграций быть не должно (0 строк сразу после применения).

## 5. Предусловия Publish и URL проверки

Publish фронтенда только когда: три миграции применены, пять функций задеплоены, read-back PASS, typecheck/build/vitest PASS, дерево без незапланированных изменений (WIP по `types.ts` — ожидаемая синхронизация с фактической схемой, после миграций типы должны вернуться сами).

Проверять на production: `https://gorbova.by/admin/payments` — вкладка отчёта по менеджерам видна только при `sales_reports.view_*`, фильтры «Менеджер продажи» / «Без менеджера» и колонки «Источник назначения», «Дата назначения», «Кем назначен» отображаются; desktop и mobile 390x844. Без вывода PII, JWT и платёжных URL.

## 6. Read-only dry-run исторического backfill (не выполнять)

Цель — оценить объём, не меняя строк. Факты из production сейчас: 4815 активных сделок, у всех `responsible_user_id IS NULL`; 6440 активных платежей; 4 строки-возврата.

Порядок dry-run запросов (только SELECT):
1. Однозначно определить учётную запись Ольги Мацкевич: сейчас по `profiles.full_name ILIKE '%Мацкевич%'` совпадений несколько — нужно свести к одному сотруднику c `has_role_v2(..., 'employee')`, иначе STOP.
2. Определить кандидатов backfill (её сделки/платежи по согласованному критерию источника) и посчитать: число сделок, число платежей, число возвратов, распределение по валютам и месяцам.
3. Явно исключить целевую сделку: единственный платёж 1 675 BYN с датой оплаты 2026-08-29 в базе есть (1 строка) — соответствующая ей сделка исключается по точному id, а запросы дополнительно проверяют, что этот id отсутствует в выборке кандидатов (`assert 0 rows`).
4. Показать предполагаемый эффект: для каждой сделки-кандидата — сколько строк атрибуции было бы создано, сколько текущих версий закрыто, без единого `UPDATE`/`INSERT`.
5. Результат — таблица «сделок к изменению / платежей к версионированию / исключено», после чего backfill выполняется отдельной явно одобренной задачей через `set_deal_responsible_v1` с `p_source='backfill'`, батчами и read-back.

Backfill в этом плане не выполняется и ни одна строка не изменяется.

## Гейты STOP

STOP, если: SHA в дереве отличается от `d3c5718…` (кроме ожидаемого WIP по `types.ts`); миграция падает или порядок нарушен; guard на `orders_v2` ломает существующий production-путь записи; учётная запись Ольги Мацкевич не сводится к одной; появляется новая критическая находка по доступам или деньгам.
