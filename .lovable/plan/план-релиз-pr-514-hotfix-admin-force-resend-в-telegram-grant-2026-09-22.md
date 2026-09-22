# План: релиз PR #514 (hotfix admin force-resend в telegram-grant-access)

PLAN-ONLY. Ниже — наблюдения (только чтение) и точный execute-план. Ничего не выполнено.

## Подтверждённая причина production-ошибки (confirmed)

- Схема `audit_logs` в production: колонки `actor_user_id`, `actor_type`, `actor_label`, `action`, `target_user_id`, `meta`, `entity_type`, `entity_id`. Колонки `actor_id` **нет**.
- Ограничение: `audit_logs_actor_type_check CHECK (actor_type IN ('user','system','service'))` — значение `'admin'` недопустимо.
- Прежний код вставлял `actor_type: 'admin'` и `actor_id: ...` → insert падал, код бросал `force_resend_audit_failed:...`, запрос завершался ошибкой **до** любой выдачи/отправки.
- Следствие в данных: `audit_logs` с `action like 'admin.telegram.force_resend%'` = **0 строк**. Коммерческих или доступных записей force-resend не создавалось.
- В логах edge-функции за последние 5 суток записей по `telegram-grant-access` нет (retention/уровень логирования), поэтому строка ошибки берётся из кода и схемы, а не из runtime-лога: статус — confirmed по схеме/ограничению, UNKNOWN по runtime-логу. PII и токены не выводились.

## Дельта PR #514 (SHA e57932b19e6a711fed84643bd80f5194eb91c9a9), 3 файла

1. `supabase/functions/telegram-grant-access/index.ts`
   - audit fix: `actor_user_id: auditActorUserId`, `actor_type: auditActorUserId ? 'user' : 'service'` (актор = аутентифицированный админ либо service-role вызов).
   - `boundedValidUntil` (= `entitlement_source.expires_at`) используется в `pending_telegram_notifications.payload.valid_until`, `telegram_access.active_until`, `telegram_manual_access.valid_until` вместо сырого `valid_until` из запроса — срок доступа нельзя продлить извне.
   - при `force_resend === true` не создаются `telegram_access_grants` (`if (!skipGrant && force_resend !== true)`) и `telegram_manual_access` (`is_manual && force_resend !== true && admin_id`).
2. `src/components/admin/ContactDetailSheet.tsx` — единственная строка: `await normalizeEdgeFunctionErrorAsync(error)` для асинхронного разбора тела `FunctionsHttpError` (иначе админ видел обобщённое сообщение вместо реальной причины).
3. `src/test/entitlementTelegramResend.contract.test.ts` — +9 строк контрактных проверок на всё перечисленное.

Новых миграций нет (последняя в репозитории — `20260919190000_cb_ai_tools_workspace_entry.sql`, уже применена). Изменений схемы, данных, продуктов, тарифов, платежей не требуется.

**Вывод:** достаточно sync exact SHA → deploy только `telegram-grant-access` → Publish фронтенда. Migration и data changes не нужны — confirmed.

## Execute-план (по отдельному разрешению)

1. Preflight: `origin/main` = HEAD = `e57932b19e6a711fed84643bd80f5194eb91c9a9`, дерево чистое. Mismatch → стоп.
2. Проверки: targeted Vitest (`entitlementTelegramResend.contract`, `telegramReplayGrant`), `tsgo --noEmit -p tsconfig.app.json`, production build. Любой FAIL → стоп.
3. Deploy ровно одной функции: `telegram-grant-access`. Больше ничего.
4. Publish фронтенда на существующий production-сайт; read-back опубликованного SHA.
5. Post-check: `audit_logs` force_resend по-прежнему 0 новых строк до реального админского действия.

## Безопасный smoke (без реального Telegram-сообщения)

- `OPTIONS` на `telegram-grant-access` → ожидается 200 с CORS-заголовками.
- `POST` без авторизации → ожидается 401; данные не меняются.
- Негативный авторизованный вызов с `force_resend: true` и намеренно несуществующим `entitlement_source_id` (равным `source_id`, один клуб, `source='admin_entitlement_source_resend'`) → ожидается **409 `ENTITLEMENT_SOURCE_NOT_ACTIVE`**. Это доказывает, что валидация проходит и аудит-insert не срабатывает; DM не отправляется, так как проверка стоит до аудита и до Telegram API.
- Позитивный контроль audit-схемы без побочных эффектов: вызов с двумя клубами → 400 `INVALID_FORCE_RESEND_REQUEST`.
- Read-back после smoke: 0 новых строк в `telegram_access_grants`, `telegram_manual_access`, `pending_telegram_notifications`, `telegram_messages`, `telegram_logs`; 0 изменений в `payments_v2`, `orders_v2`, подписках и сроках доступа.
- Проверка реального успешного force-resend (с DM) в smoke **не выполняется**; она возможна только как отдельное разрешённое восстановительное действие для конкретного клиента.

## Ограничения

- HTTP 200 сам по себе не считается успехом — обязателен read-back дельт.
- Инвайт-ссылки, токены и PII не выводятся и не попадают в скриншоты.
- Security scan продолжает показывать 13 прежних critical RLS findings вне этого scope.
