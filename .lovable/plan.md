# План: ревизия PR #323 (RBAC всех /admin маршрутов) — READ-ONLY

Диапазон: `fe702d9f…` → `93efc4f5…`, 31 файл (27 frontend, 3 Edge Functions, 1 миграция `20260815181904_align_all_admin_access_contract.sql`).
Сверка выполнена только чтением: diff из вложения + каталог production (pg_proc, pg_policies, admin_section/admin_resource, role_admin_*_access, ledger миграций).

## Что подтверждено фактами production

- Ledger: последняя применённая версия `20260815173241`. Версии `20260815181904` нет — коллизии и обратного порядка не будет.
- `has_permission(uuid,text)`, `has_admin_section_access(uuid,text,text)`, `get_admin_access(uuid)`, `crm_task_list(jsonb)`, `_crm_tasks_assert_staff()`, `get_club_business_stats(uuid,integer)`, три `*_club_member*` RPC и 4 referral-RPC существуют с теми же сигнатурами, что в миграции → `CREATE OR REPLACE` пройдёт без drop/recreate.
- `has_admin_resource_access(uuid,text,text,text)` в production отсутствует → создаётся впервые, конфликтов нет.
- Regexp-патч guard'а в трёх club-RPC проверен построчно: шаблон совпадает со всеми тремя развёрнутыми определениями → `RAISE club_members_rpc_guard_not_found` не сработает.
- Уникальный индекс `admin_resource_section_id_code_key (section_id, code)` существует → `ON CONFLICT` в миграции валиден.
- Секции `club-members`, `communication`, `payments`, `forms-hub`, `integrations` существуют; `club-members.route_prefix` сейчас `/admin/integrations/telegram` и меняется на `/admin/club-members` синхронно с новым роутом в `App.tsx` и реестром.
- Текущие гранты: `admin` — manage везде; `menedzher` — communication manage, club-members manage, integrations нет; `support` — communication manage, club-members none, integrations none.

## Findings

### CRITICAL
Нет.

### HIGH
1. Регрессия доступа для роли `support`. Действующие политики `RBAC v3: view/manage telegram bots|clubs|club members` гейтятся по секции `communication`. Миграция заменяет их на `integrations/telegram` (resource) ИЛИ `club-members` (section). У `support`: communication=manage, но club-members=none и integrations=none → он теряет SELECT/ALL по `telegram_bots`, `telegram_clubs`, `telegram_club_members`. Это может быть намеренным (клуб отделён от «Коммуникаций»), но должно быть подтверждено явно до EXECUTE.
2. Регрессия manage-ветки для `menedzher` на `telegram_bots`: новая политика manage требует ровно `integrations/telegram` edit, без ветки `club-members`. У `menedzher` нет грантов на `integrations` → страница участников клуба будет читать ботов, но любые записи в `telegram_bots` перестанут проходить.
3. Расхождение UI/RLS против серверного пути. `telegram-club-members` работает на service key и допускает доступ по `has_permission('telegram.clubs.*')`, который в новой версии маппится на секцию `communication`. Итог: `support` теряет доступ в UI и в RLS, но сохраняет `kick`/`mark_removed` через Edge Function. Fail-open относительно новой модели.

### MEDIUM
4. `ALTER FUNCTION public.get_club_business_stats(uuid,integer) RENAME TO get_club_business_stats_rbac_impl` — не идемпотентно. Повторный прогон миграции (реплей, повторный апплай ledger) упадёт. Обёртка сигнатурно совместима (`p_club_id uuid, p_period_days integer DEFAULT 30 → jsonb`), текущие вызовы не ломаются.
5. Расширение видимости истории: новые `entitlements_rbac_history_view` и `subscriptions_v2_rbac_history_view` открывают SELECT ролям с view по `deals`/`contacts`/`companies`. Практически это даёт `support` и `menedzher` полную историю подписок и прав доступа. Осознанное расширение, но это расширение, а не выравнивание.
6. Деактивация ресурсов `communication/email`, `communication/support`, `communication/instagram` (`is_active=false`). Существующий override `support → communication/email = manage` станет инертным; строки в `role_admin_resource_access` остаются висячими. Функционально не ломает (у роли есть section manage), но оставляет мусор в данных.

### LOW
7. `products_v2` сохраняет унаследованную политику `Products are viewable by everyone (true)` и legacy `Products editable by admins (app_role)`. Новые RBAC-политики только добавляются (permissive OR), реального ужесточения продуктового доступа миграция не даёт.
8. В `telegram-club-members` `await req.json()` перенесён до аутентификации: запрос без тела теперь даёт 500 вместо 401/403. На доставку не влияет, но шумит в логах.
9. Реестр меню: `/admin/audit` убран из `ADMIN_OPEN_PATHS` и переведён в `altPrefixes` секции `roles`. Ожидаемо, но это изменение доступа для ролей без `roles.view`.

## Вердикт

**PLAN PASS с условием**: миграция технически применима к текущему production без падений (сигнатуры, guard-regexp, ON CONFLICT, ledger — всё сверено). Но findings 1–3 меняют фактические права ролей `support` и `menedzher`. Нужен ваш явный ответ по ним; при ответе «так и задумано» EXECUTE выполняется без изменений кода, при «нет» — правки уходят в GitHub до релиза.

## EXECUTE-последовательность (после мержа и вашего approve)

1. Sync ровно merged main SHA PR #323; подтвердить чистое дерево и совпадение 31 файла.
2. Снять rollback-evidence: `pg_get_functiondef` + ACL для `has_permission`, `crm_task_list`, `_crm_tasks_assert_staff`, `get_club_business_stats`, трёх club-RPC, четырёх referral-RPC; дамп `pg_policies` по 12 затронутым таблицам.
3. Применить managed migration `20260815181904_align_all_admin_access_contract.sql` (одна, без прочих).
4. Read-back: новая строка в ledger; наличие `has_admin_resource_access`; `get_club_business_stats_rbac_impl` существует и не доступна `authenticated`; guard в трёх club-RPC содержит `has_admin_section_access(..., 'club-members', 'view')`; ACL по всем изменённым функциям = `authenticated`+`service_role`, без `anon`.
5. Probe-матрица по каталогу (без входа под чужим пользователем): для ролей `admin`, `menedzher`, `support` посчитать `has_admin_section_access` по `club-members`, `communication`, `integrations`, `deals`, `payments`, `products`, `referrals` и зафиксировать ожидаемые/фактические значения.
6. Deploy ровно трёх функций: `telegram-club-members`, `telegram-grant-access`, `telegram-revoke-access`. Runtime-smoke только анонимным POST → ожидание 401/403. Никаких kick/grant/revoke как smoke.
7. Rebuild + Publish frontend. UI read-back под фикстурным админом: `/admin/club-members`, `/admin/communication`, `/admin/payments/invoices`, `/admin/forms` — скриншоты desktop 1440 и mobile 390.
8. Финальный отчёт: SHA, версия миграции, список задеплоенных функций, PASS/FAIL по каждому read-back.

## Стоп-условия

Остановиться и доложить, если: ledger отвергает версию; `club_members_rpc_guard_not_found`; RENAME падает (значит миграция уже применялась); любая probe даёт доступ роли, которая должна быть закрыта; anon получает не-401 на трёх функциях.
