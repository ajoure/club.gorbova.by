# READ-ONLY ревизия: недостающие факты Products2 и ЦБ

Ниже — только подтверждённые данные. Никаких изменений кода, файлов проекта, БД, доступов, секретов, функций, deploy или Publish не выполнялось.

## Products2: девять целевых таблиц

Целевой набор: `integration_instances`, `integration_credentials`, `payment_settings`, `email_accounts`, `telegram_bots`, `integration_field_mappings`, `integration_sync_settings`, `acquiring_connections`, `telegram_clubs`.

### Политики: roles, qual, with_check

Все перечисленные политики — `PERMISSIVE`.

| Таблица | Политика | cmd / roles | qual | with_check |
|---|---|---|---|---|
| `acquiring_connections` | `superadmin_modify_acquiring_connections` | ALL / authenticated | `has_role_v2(auth.uid(),'super_admin')` | то же |
|  | `superadmin_select_acquiring_connections` | SELECT / authenticated | `has_role_v2(auth.uid(),'super_admin')` | — |
| `integration_credentials` | `integration_credentials_admin_select` | SELECT / authenticated | `has_role_v2(...,'admin') OR has_role_v2(...,'super_admin')` | — |
|  | `integration_credentials_admin_insert` | INSERT / authenticated | — | `admin OR super_admin` |
|  | `integration_credentials_admin_update` | UPDATE / authenticated | `admin OR super_admin` | `admin OR super_admin` |
|  | `integration_credentials_admin_delete` | DELETE / authenticated | `super_admin` | — |
| `integration_instances` | `Admins can manage integration instances` | ALL / PUBLIC | `has_permission(auth.uid(),'entitlements.manage')` | то же |
|  | `Admins can view integration instances` | SELECT / PUBLIC | `has_permission(auth.uid(),'entitlements.manage')` | — |
| `integration_field_mappings` | `Admins can manage field mappings` | ALL / PUBLIC | `has_permission(auth.uid(),'entitlements.manage')` | то же |
| `integration_sync_settings` | `Admins can manage sync settings` | ALL / PUBLIC | `has_permission(auth.uid(),'entitlements.manage')` | то же |
| `payment_settings` | `Admins can manage payment settings` | ALL / PUBLIC | `has_permission(auth.uid(),'entitlements.manage')` | то же |
| `email_accounts` | `Admins can manage email accounts` | ALL / PUBLIC | `has_permission(auth.uid(),'entitlements.manage')` | то же |
| `telegram_bots` | `Admins can manage telegram bots` | ALL / PUBLIC | `has_permission(auth.uid(),'entitlements.manage')` | то же |
|  | `RBAC v3: view telegram bots` | SELECT / authenticated | `has_admin_resource_access(...,'integrations','telegram','view') OR has_admin_section_access(...,'club-members','view')` | — |
|  | `RBAC v3: manage telegram bots` | ALL / authenticated | то же с `edit` | то же с `edit` |
| `telegram_clubs` | `Admins can manage telegram clubs` | ALL / PUBLIC | `has_permission(auth.uid(),'entitlements.manage')` | то же |
|  | `RBAC v3: view telegram clubs` | SELECT / authenticated | `integrations/telegram:view OR club-members:view` | — |
|  | `RBAC v3: manage telegram clubs` | ALL / authenticated | `integrations/telegram:edit OR club-members:edit` | то же |

### Effective grants

Live `has_table_privilege` подтвердил одинаково широкие grants на всех девяти таблицах:

- `anon`: SELECT, INSERT, UPDATE, DELETE, TRUNCATE;
- `authenticated`: SELECT, INSERT, UPDATE, DELETE, TRUNCATE;
- `service_role`: полный доступ.

Следовательно, будущая migration должна явно убрать grants у `anon`/`PUBLIC`, убрать `TRUNCATE` у `authenticated` и оставить только строго необходимое. RLS сейчас не компенсирует риск `TRUNCATE`, поскольку это table privilege вне row policies.

### Колонки, которые нельзя отдавать в raw read-model

- `integration_instances`: `config jsonb`, `config_secrets jsonb`, а также operational identity/status/timestamps.
- `integration_credentials`: `config jsonb`, `secrets jsonb`, provider/status/audit timestamps.
- `payment_settings`: `key text`, `value jsonb`, description/timestamps.
- `email_accounts`: SMTP/IMAP host, port, encryption, username, `smtp_password`, sender/default/active/fetch fields.
- `telegram_bots`: identity/status fields и `bot_token_encrypted`.
- `integration_field_mappings`: instance/entity/project/external field, type/required/key/transform rules.
- `integration_sync_settings`: instance/entity/direction/enabled/filters/conflict strategy/last sync.
- `acquiring_connections`: provider/account identity, publishable key, URLs, locale, status/test/default, capabilities/error/verification timestamps; приватные acquiring secrets находятся отдельно в Vault.
- `telegram_clubs`: operational club/bot/chat linkage and status fields; это не config-only read-model для membership/переписки.

## Views/RPC и возможные обходы

### Views

- `email_accounts_safe` — `security_invoker=true`; исключает password, возвращает `has_password`. Но ACL сейчас также широк. После restrictive base-table policy обычный staff потеряет чтение через эту view; для разрешённых рабочих экранов нужен узкий guarded RPC с фиксированным allowlist.
- `telegram_bots_safe` — `security_invoker=true`; исключает token, возвращает `has_token`. Та же зависимость от base RLS.
- `v_club_members_enriched` — `security_invoker=true`; читает `telegram_clubs` для operational membership. Его SELECT-путь необходимо сохранить по текущему `club-members:view`, не превращая membership/переписку в owner-only.
- `v_integration_credentials_public` в live schema и main migrations **отсутствует**. Если он создаётся draft PR433, до merge проверить `security_definer`, fixed columns, grants и internal `super_admin` guard; raw `config/secrets` запрещены.

### Acquiring Vault RPC

- `get_acquiring_secret(text,text,text)` — `SECURITY DEFINER`, `search_path=public,vault`; EXECUTE только `service_role`, `anon/authenticated` запрещены. Это штатный server-only getter.
- `admin_save_acquiring_secret(uuid,text,text)` — `SECURITY DEFINER`; EXECUTE у authenticated/service_role, но внутри обязательны `auth.uid()` и `has_role_v2(...,'super_admin')`; виды секретов allowlisted.
- `admin_delete_acquiring_secrets(uuid)` — тот же explicit `super_admin` guard.
- `ensure_single_default_integration()` — trigger function, execute только service_role; отдельного пользовательского пути нет.

### Дополнительные definer-пути

- `compute_club_member_final_status` читает `telegram_clubs`, имеет authenticated EXECUTE без видимого caller guard. Он относится к operational membership, но требует отдельного contract-теста: нельзя допустить возврата config/secret-полей.
- `admin_get_club_membership(s)`, `get_club_member_summary`, `get_club_members_enriched` и Telegram message RPC относятся к membership/переписке. Их текущие предметные guards надо сохранить; они не должны получать доступ к bot token/config.
- `email_accounts_safe` используется `EmailAccountService.list()`, а mutations сейчас идут напрямую в `email_accounts`; draft должен перевести только настройку на super-admin action boundary, не ломая server-side inbox/send workers.

## Уточнённый scope PR433

1. Restrictive owner policy (`has_role_v2(auth.uid(),'super_admin')`) для исходных config-таблиц: `integration_instances`, `integration_credentials`, `payment_settings`, `email_accounts`, `telegram_bots`, `integration_field_mappings`, `integration_sync_settings`, `acquiring_connections`.
2. `telegram_clubs`: сохранить текущий operational SELECT для разрешённых ролей; INSERT/UPDATE/DELETE разрешить только owner/super_admin. Membership и переписка остаются на существующих предметных RPC/guards.
3. Убрать grants `anon/PUBLIC` с девяти таблиц; у `authenticated` убрать `TRUNCATE`. Оставить только команды, реально необходимые для RLS/RPC; service-role сохранить.
4. Fixed-allowlist RPC для UI без raw `config`, `config_secrets`, `secrets`, `value`, password/token. Флаги наличия секрета допустимы.
5. Config-only edge guards сделать `super_admin`. Не менять предметные guards звонков, SMS, видео, inbox, платежных worker/webhook и operational messaging.
6. Учесть подтверждённые исключения main: `instagram-webhook-test` уже допускает admin/superadmin; `hosterby-api` использует legacy role guard; Kinescope допускает admin для работы с видео. Это не повод расширять config-only scope.
7. После merged exact SHA провести role-matrix: anon, user, staff, admin, super_admin, service-role; отдельно table CRUD/TRUNCATE, views/RPC и каждый config endpoint. STOP при любом raw secret/config поле или operational regression.

## ЦБ: точные schema/contracts

- `tariffs`: UUID id/product_id; code/name/description; `access_days int`; `is_active`, `is_public`; presentation/price fields; `visible_from/visible_to timestamptz`; JSON `features/meta/document_params`; unique `(product_id,code)` и `public_id`.
- `tariff_offers`: UUID id/tariff_id; offer type/button/amount; trial/auto-charge/installment/payment fields; `is_active/is_primary`; visibility window; JSON `meta`; один primary pay_now и один `meta.slot_role` на тариф.
- `flows`: UUID id/product_id; code/name; `start_date/end_date date`; active/default/capacity/meta; unique `(product_id,code)` уже существует.
- `access_rules`: UUID id/product_id/tariff_id; target type/ref/label; active/priority/duration; JSON conditions; unique `(product_id,tariff_id,target type,target ref)`.
- `tariff_prices`: UUID tariff/stage; price/final price/currency/discount/active; unique `(tariff_id,pricing_stage_id)`. Для пяти текущих тарифов ЦБ строк **0**.

`/cb` вызывает `public-product` по exact product ID. Сервер выбирает только tariffs с `is_active=true`, `is_public=true` и открытым `visible_from/visible_to`; offers — только active и в своём окне. Поэтому при одновременном `is_active=true` старых и новых тарифов публичная страница покажет оба поколения, если старым оставить `is_public=true` и открытое окно. Старые payment links при этом могут продолжать работать по старым IDs независимо от публичности тарифа.

## Десять клонируемых access_rules

Основные правила:

1. `ce22859f-9b08-450d-a2ca-68cd592fb6f8` — Бухгалтер, training content, target `4365e913-36f1-432e-ab16-748c3ca6826a`, partial, **24** module IDs, duration null. В новой версии исключить три согласованных модуля.
2. `d4c8ad89-04b0-4d9a-bde7-029aec33ee2d` — Главный бухгалтер, тот же target, partial, **26** module IDs, duration null.
3. `9eaa3ed9-6cbc-4386-895d-459d63ba24cd` — Бизнес-леди, тот же target, full, duration null.

Неизменяемые 30-дневные бонусы:

4. `14d57191-2b83-43c5-8901-4fa41e5a325d` — Главный бухгалтер, club, target `fa547c41-3a84-4c4f-904a-427332a0506e`.
5. `12d63704-0e60-4dfe-b522-f23196eda730` — Главный бухгалтер, section access, target `93448ee2-1f9c-423e-b5d5-56ba9d74fe41`.
6. `a91354a2-9e84-477d-ae34-f8642e7f8f44` — Главный бухгалтер, training content bonus, target `8b1fb03e-8743-4654-a07f-b6c03ca7517b`, partial, 2 modules.
7. `aee1d3d3-d68c-4c95-8327-580f1f85cbc5` — Бизнес-леди, club, target `fa547c41-3a84-4c4f-904a-427332a0506e`.
8. `40819e0c-b4be-4cb2-aa0a-0b040168c888` — Бизнес-леди, section access, target `93448ee2-1f9c-423e-b5d5-56ba9d74fe41`.
9. `5b16064a-0577-4240-ad07-f6432cb554f9` — Бизнес-леди, section access, target `d0136a5c-7b7b-4991-b1cf-1755e2c684a4`.
10. `557bc290-92f3-4c47-913f-5ed299577f17` — Бизнес-леди, training content bonus, target `8b1fb03e-8743-4654-a07f-b6c03ca7517b`, partial, 20 modules.

Expected future-only delta остаётся: `flows +1`, `tariffs +3`, `tariff_offers +12`, `access_rules +10`, `tariff_prices +0` при сохранении текущего price source через offers. Старые три payment links, старые tariffs/offers/rules/orders/access остаются неизменными и активными; чтобы не показывать старые тарифы на `/cb`, закрывается только их публичная видимость (`is_public=false` либо завершённое visibility window), не `is_active`.

Основной доступ: Главный бухгалтер — до `2027-09-10`, Бизнес-леди — до `2027-12-10`, расчёт календарными месяцами от `2026-12-10`. Все семь bonus rules остаются ровно 30 дней. Для Бухгалтера применяется отдельное согласованное правило контента без трёх исключённых модулей; срок не выводится из маркетингового текста.

STOP: ничего не исполнено.
