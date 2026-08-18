# Ревизия патча: least-privilege для ручного платежа

**VERDICT: PASS с 3 обязательными правками** (без них релиз даст ложный успех).

Ничего не изменено: код, БД, функции, данные не трогались, Publish не выполнялся.

## Факты production/schema (read-only)

- `roles`: `admin`, `super_admin`, `menedzher`, `support`, `editor`, `admin_gost`, `user` — коды `support` и `menedzher` существуют.
- `role_admin_section_access` для секции `payments`: `admin = manage`, `menedzher = view`, `support = view`. Другие роли доступа к секции не имеют.
- `admin_resource`: UNIQUE `(section_id, code)`, `route NOT NULL`, `is_active` default true, FK на `admin_section` (RESTRICT), `public_id` генерится триггером/дефолтом. Идемпотентный upsert по `(section_id, code)` возможен.
- `role_admin_resource_access`: UNIQUE `(role_id, resource_id)`, CHECK `access_level in (none,view,edit,manage)`. Upsert безопасен.
- Существующие ресурсы секции `payments`: `overview (/admin/payments)`, `auto-renewals`, `statement`, `links`, `invoices`, `bepaid-subscriptions`, `payment-issues`, `diagnostics`. Кода `manual-payment` нет — конфликта имени нет.
- `has_admin_resource_access(user, section, resource, min)` = max уровня строк `get_admin_access` с этим `section_code` **и** `resource_code`. Внутри `get_admin_access` есть явный bypass: `admin`/`super_admin` получают `manage` на все активные секции и ресурсы (`source='admin_full'`). Bypass сохраняется, отдельная выдача им не нужна.
- Наследование: ресурс без явного override наследует уровень секции. Значит без явного `edit` новый ресурс дал бы `support`/`menedzher` только `view` — патч корректен. Обратная сторона: любая роль, которой позже дадут `payments = edit/manage` section-wide, автоматически получит право на ручной платёж.
- Текущий гейт обеих функций идентичен: `has_admin_section_access(payments, manage)` — `admin-create-manual-payment/index.ts` (~строки 70-81) и `admin-retry-manual-payment-downstream/index.ts` (~строки 52-67). 403 возвращается до чтения body и до writer RPC — side effects отсутствуют, диагноз инцидента подтверждён.

## Обязательные правки к предложенному патчу

1. **Реестр меню (блокирующее).** `sync_admin_menu_registry` деактивирует (`is_active=false`) ресурсы, которых нет в payload, а payload строится из `src/lib/adminMenuRegistry.ts` (`buildSyncRegistryPayload`) и вызывается из `RoleAccessEditor`. Если ресурс создан только миграцией, первый же синк из UI ролей его выключит → `get_admin_access` перестанет его отдавать → тихий возврат 403. Ресурс `manual-payment` обязан быть добавлен в `ADMIN_SECTIONS` секции `payments` в том же PR.
2. **Route.** `/admin/payments` уже занят ресурсом `overview`. Совпадение не ломает `resolveAdminSectionForPath` (при равном score побеждает первый, т.е. `overview`), но делает `manual-payment` неразрешимым по пути и путает синк. Использовать нерезолвимый по пути маршрут, например `/admin/payments?action=manual-payment`, и не давать ему `altPrefixes`.
3. **Пункт 5 (ошибки).** `normalizeEdgeFunctionError` уже читает `error.context.body`, но у `FunctionsHttpError` `context` — это `Response`, тело доступно только через `await context.json()`. Синхронного чтения недостаточно: нужен async-разбор тела в `invokeAuthenticatedFunction` до передачи в normalize, иначе останется generic «non-2xx». Плюс словарь кодов: `forbidden`, `invalid_amount`, `invalid_currency`, `invalid_provider`, `invalid_paid_at`, `missing_idempotency_key`, `rbac_check_failed`.

## Замечания (не блокирующие)

- Гейт должен быть симметричным: обе функции переводятся на `has_admin_resource_access(payments, manual-payment, edit)`; иначе создание пройдёт, а retry downstream отдаст 403.
- UI-гейт: и кнопка (`PaymentsTabContent.tsx`, ~строка 488), и рендер `ManualPaymentDialog` (~строка 699) — оба под `canAccessResource('payments','manual-payment','edit')`, без замены на `canWrite`.
- Безопасность выдачи: право узкое — создание платежа `origin='manual_admin'` с идемпотентностью и audit-записью; повышения на удаление/возвраты/выписку не даёт. Приемлемо для `support`/`menedzher`.
- Миграция: upsert только `edit`, с `GREATEST`-семантикой (не понижать существующие `manage`), + строка в `audit_logs`. Никаких изменений writer RPC и downstream.

## Безопасный runtime-план после merge (только после EXECUTE APPROVED)

1. Sync точного merged SHA, подтвердить чистое дерево и паритет.
2. Применить ровно одну именованную миграцию (resource + 2 upsert access + audit).
3. Read-back: 1 строка `admin_resource(payments, manual-payment, is_active=true)`; 2 строки `role_admin_resource_access = edit`; `has_admin_resource_access` = true для support/menedzher и admin, false для роли без доступа.
4. Deploy ровно 2 функции: `admin-create-manual-payment`, `admin-retry-manual-payment-downstream`. Больше ничего.
5. Anon smoke: POST без JWT → 401 (реальный платёж не создаётся).
6. Authorized smoke: пользователь с ресурсным `edit`, тело с `amount = 0` → ожидается 400 `invalid_amount` (гейт пройден, запись не создаётся).
7. Row-count readback до/после: `count(*) from payments_v2 where origin='manual_admin'` и `orders_v2` — без изменений. Никаких писем, отмен и реальных платежей.
8. Frontend Publish — только после всех PASS; далее UI-проверка desktop+mobile.

## BLOCKERS

- До внесения правок 1-3 патч считать неготовым к merge.
- Точный merged SHA пока не назван — EXECUTE не начинается.
