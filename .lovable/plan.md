# Отчет о выполнении: PLAN-ONLY ревизия PR #236 (SHA f34092c7) — PASS

## 1. Preflight
- Managed HEAD = `f34092c71c66ed30c0ca5a399bfe587f09ddc1a8` (Merge PR #236), дерево чистое (`git status` пуст).
- Diff `fee4f96b6..f34092c71` ровно 3 файла scope: `AutoRenewalsTabContent.tsx` (+5/-2), `admin-auto-renewal-observability/index.ts` (+156), `src/test/autoRenewalObservabilityDeliverySources.test.ts` (+41). Ничего вне scope.

## 2. UI: инвалидация localStorage
- `STORAGE_KEY` изменён `admin_auto_renewals_columns_v3` → `admin_auto_renewals_columns_v4`; старая персистенция у существующих админов больше не читается, применяются `DEFAULT_COLUMNS`.
- Русские заголовки присутствуют в дефолтах: «Льготный срок» (grace_remaining), «Способ оплаты» (pm), «Последняя попытка» (last_attempt).

## 3. Edge Function: canonical + legacy merge
- Canonical `notification_outbox` сохранён (channel telegram/email, message_type `subscription_charge_reminder` / `installment_charge_reminder`).
- Добавлены три legacy-источника: `telegram_logs.event_type in (7d,3d,1d)`, `email_logs.meta->>event_type in (...)`, `audit_logs` с `actor_label='subscription-renewal-reminders'` и `meta->>channel='email'`.
- Все источники ограничены окном `created_at >= now() - days` (по умолчанию 45, clamp 1..90) и построчно фильтруются по запрошенным `subscription_ids` (валидация UUID, максимум 2000; пустой список → `{logs:[],attempts:{}}`).
- В ответ уходят только `channel, subscription_id, event_type, days_before, effective_charge_at, status, reason, error_message, created_at` и агрегаты `attempts`. Ни email, ни chat_id, ни текст сообщений, ни `meta` целиком не возвращаются. В логах пишется только `error.code`.
- Замечание (не блокер): legacy-запросы читают страницы по event_type и фильтруют по ID в памяти — это оверфетч на стороне сервера, но наружу ничего лишнего не отдаётся.

## 4. Соответствие managed-схеме (read-only проверка)
- Колонки подтверждены: `telegram_logs(event_type,status,error_message,meta,created_at)`, `email_logs(status,error_message,meta,created_at)`, `audit_logs(actor_label,meta,created_at)`, `payments_v2(order_id,status,created_at,paid_at,error_message,is_deleted)`, `notification_outbox(channel,message_type,status,blocked_reason,meta,created_at,sent_at)`.
- event_type реально существуют: telegram 1183/1031/855 (7d/3d/1d), email 990/968/813, audit 690/592/520.
- За окно 45 дней `meta->>subscription_id` заполнен в 100% строк: telegram 804/804, email 757/757, audit 807/807 — merge действительно свяжется с подписками.
- Auth: Bearer обязателен, `auth.getUser()`, затем `has_role_v2` (admin/super_admin/manager/menedzher) через service-role; `config.toml` → `[functions.admin-auto-renewal-observability] verify_jwt = true` без изменений.

## 5. Предлагаемый EXECUTE-план (после одобрения)
1. Preflight: подтвердить SHA `f34092c71...` и чистое дерево; STOP при mismatch.
2. Deploy ровно одной функции `admin-auto-renewal-observability` с сохранением `verify_jwt = true`.
3. Безопасные смоуки: anonymous POST → 401; invalid JWT → 401; admin с пустым `subscription_ids` → 200 `{logs:[],attempts:{}}`; read-only вызов на минимальном наборе существующих ID (в отчёте только счётчики, без PII).
4. `vitest` на `src/test/autoRenewalObservabilityDeliverySources.test.ts`.
5. Ровно один frontend Publish при всех PASS.

Запрещено и не планируется: миграции, backfill, изменение данных/cron/секретов, реальные сообщения, платежи, списания и отмены.

**Статус: PASS. Ожидаю EXECUTE.**
