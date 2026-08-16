# Повторная ревизия PR #323 — READ-ONLY

HEAD `b707aa918f68abe7f1ed21d4c274ee9fa0d026e1`, база `fe702d9f…`. Проверены только findings 1–3 и три дополнительных пункта. Никаких изменений не выполнялось.

## Вердикт: PLAN PASS

Новых HIGH/CRITICAL нет. Прежние HIGH 1–3 закрыты.

## Доказательства

**1. `telegram.clubs.*` → секция `club-members` (было: наследование `communication`).**
- Миграция: `IF _permission_code LIKE 'telegram.clubs.%' THEN v_section := 'club-members';` — ветка стоит до общего CASE, т.е. `communication` больше не участвует.
- Фронтенд `rbacPermissionFallback.ts`: `telegram.clubs.view|edit|manage → { section: "club-members", min: view|edit|manage }`.
- Тест-контракт: `permissionGrantedByAdminSections("telegram.clubs.manage", {communication: manage})` = `false`.
- Каталог production: у `support` секция `club-members = none`, а в `role_permissions` есть только `telegram.manage` — строк `telegram.clubs.*` нет ни у одной роли. Скрытого club-доступа у `support` не остаётся ни через section-fallback, ни через legacy-грант.

**2. `menedzher` (club-members=manage) и `telegram_bots`.**
- Новые политики `RBAC v3: view/manage telegram bots` теперь содержат обе ветки: `has_admin_resource_access(...,'integrations','telegram','view'|'edit') OR has_admin_section_access(...,'club-members','view'|'edit')`. В прошлой ревизии manage-ветка для ботов была только по `integrations`.
- Каталог: `menedzher` = `club-members: manage` → проходит и SELECT, и ALL без грантов на `integrations`. Те же две ветки продублированы для `telegram_clubs` и `telegram_club_members`.

**3. Edge Function `telegram-club-members`.**
- Уровень выводится из действия (`kick|kick_present|mark_removed` → manage, `preview|get_audit` → view, иначе edit), затем проверяются `has_permission('telegram.clubs.<level>')` и `has_admin_section_access(_section_code:'club-members', _min_level:<level>)`. Обе проверки после правки миграции резолвятся в `club-members` — fail-open через `communication` устранён.
- `telegram-grant-access` (club-members edit) и `telegram-revoke-access` (club-members manage) добавляют ветку как дополнение к `entitlements.manage`, поведение прежних админов не меняется.

**Доп. 1 — retry-safe rename.** `ALTER FUNCTION ... RENAME` обёрнут в `DO`-блок с `to_regprocedure('public.get_club_business_stats_rbac_impl(uuid,integer)') IS NULL`, плюс `RAISE 'get_club_business_stats_missing'` при отсутствии обеих сигнатур. MEDIUM-4 из прошлой ревизии закрыт: повторный прогон миграции безопасен.

**Доп. 2 — wrapper.** `CREATE OR REPLACE FUNCTION public.get_club_business_stats(p_club_id uuid, p_period_days integer DEFAULT 30) RETURNS jsonb` — сигнатура совпадает с развёрнутой в production (`p_club_id uuid, p_period_days integer`), поэтому существующие вызовы не ломаются; `_rbac_impl` доступна только `service_role`, обёртка — `authenticated`+`service_role`.

**Доп. 3 — порядок auth/`req.json()`.** Проверка `if (!isServiceInvocation && !authHeader) return 401` вынесена выше `const body = await req.json()`. Анонимный POST без тела теперь детерминированно возвращает 401, а не 500. Контрактный тест сравнивает индексы обеих строк в исходнике функции.

## Остаточные замечания (не блокируют)

- MEDIUM: `entitlements_rbac_history_view` и `subscriptions_v2_rbac_history_view` расширяют SELECT на роли с view по `deals`/`contacts`/`companies` (практически — `support`, `menedzher`).
- MEDIUM: деактивация ресурсов `communication/email|support|instagram` оставляет висячие строки в `role_admin_resource_access` (у `support` override на `communication/email`).
- LOW: у `products_v2` сохраняются унаследованные политики `viewable by everyone (true)` и `editable by admins (app_role)` — миграция только добавляет RBAC-политики.
- Каталог подтверждает применимость: версии `20260815181904` в ledger нет (последняя — `20260815173241`); regexp-guard совпадает со всеми тремя развёрнутыми club-RPC; уникальный ключ `admin_resource(section_id, code)` существует.

## EXECUTE-последовательность (только после мержа и вашего approve)

1. Sync ровно merged main SHA PR #323, подтвердить чистое дерево.
2. Rollback-evidence: `pg_get_functiondef` + ACL по изменяемым функциям, дамп `pg_policies` по затронутым таблицам.
3. Применить одну managed migration `20260815181904_align_all_admin_access_contract.sql`.
4. Read-back: строка в ledger; `has_admin_resource_access` существует; `get_club_business_stats_rbac_impl` не доступна `authenticated`; guard club-RPC содержит `club-members`; ACL без `anon`.
5. Probe-матрица по каталогу для `admin`, `menedzher`, `support` (club-members, communication, integrations, deals, payments, products, referrals).
6. Deploy ровно трёх функций: `telegram-club-members`, `telegram-grant-access`, `telegram-revoke-access`; smoke — анонимный POST без тела → ожидание 401.
7. Rebuild + Publish; UI read-back `/admin/club-members`, `/admin/communication`, `/admin/payments/invoices`, `/admin/forms` — скриншоты 1440 и 390.
8. Отчёт: SHA, версия миграции, список функций, PASS/FAIL по каждому read-back.
