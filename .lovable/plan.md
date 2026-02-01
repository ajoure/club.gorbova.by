
# План v3.4.1 (FINAL) — bePaid Preflight + Cron 1-4 февраля + Anti-repeat + Anti-spam

## Жёсткие правила исполнения

1. Ничего не ломать, только по плану
2. Add-only, минимальный diff
3. Dry-run / preflight → execute
4. STOP-guards обязательны
5. No-PII в логах
6. DoD только по фактам: логи + HTTP-ответ Edge Function + SQL + UI-скрины из 7500084@gmail.com

---

## ✅ PATCH-0.1 (DONE): shop_id из БД + жёсткий STOP-guard

**Файл:** `supabase/functions/preregistration-charge-cron/index.ts`

Реализовано:
- `getBepaidShopId()` — читает из `integration_instances` → `payment_settings` → `env`
- HARD GUARD: `if (bepaidShopId !== EXPECTED_SHOP_ID)` → error
- `EXPECTED_SHOP_ID = "33524"` — правильный production shop_id

---

## ✅ PATCH-0 (DONE): bePaid Preflight (двухшаговый)

**Файл:** `supabase/functions/preregistration-charge-cron/index.ts`

Режим `?preflight=1`:
1. GET /shops/{shop_id} → проверка существования
2. POST /transactions/authorizations с тестовой картой → проверка charge capability
3. Возвращает: `{ ok, build_id, host_used, shop_id_masked, shop_id_source, shop_name, provider_check, charge_capability }`

---

## ✅ PATCH-2 (DONE): Time-guard + Deadline-guard

**Файл:** `supabase/functions/preregistration-charge-cron/index.ts`

- `isWithinExecutionWindow()` — только 09:00-09:10 и 21:00-21:10 Europe/Minsk
- `isBeforeDeadline()` — до 04.02.2026 23:59 Minsk
- При нарушении: `{ processed: 0, reason: "outside_window" | "deadline_passed" }`

---

## ✅ PATCH-4 (DONE): Anti-repeat (window_key без TZ)

**Файл:** `supabase/functions/preregistration-charge-cron/index.ts`

- `getWindowKey()` → формат `2026-02-02|09` / `2026-02-02|21`
- Хранится в `meta.billing.last_attempt_window_key`
- Если window_key совпадает → SKIP (не увеличивает attempts_count)

---

## ✅ PATCH-3 (DONE): TG уведомления с anti-spam guard

**Файл:** `supabase/functions/preregistration-charge-cron/index.ts`

- `sendNoCardNotification()` — проверяет `billing.notified.no_card_at`
- `sendPaymentFailureNotification()` — проверяет `billing.notified.failed_at`
- TG отправляется ОДИН РАЗ на статус, повтор только при смене статуса

---

## ✅ PATCH-5 (DONE): UI сегменты с правильной терминологией

**Файл:** `src/components/admin/payments/PreregistrationsTabContent.tsx`

Сегменты:
- `pending` → «Ожидают списания»
- `no_card` → «Нет карты» (желтая иконка)
- `failed` → «Ошибка списания» (красная иконка)
- `paid` → «Оплаченные» (зеленая иконка)

Убран `overdue` до 05.02 — чтобы не путать.

---

## ⏳ PATCH-1 (TODO): CRON только 1-4 февраля

Нужно создать cron jobs через SQL:

```sql
-- 09:00 Minsk = 06:00 UTC
SELECT cron.schedule(
  'prereg-charge-morning',
  '0 6 1-4 2 *',
  $$
  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/preregistration-charge-cron?execute=1',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 21:00 Minsk = 18:00 UTC
SELECT cron.schedule(
  'prereg-charge-evening',
  '0 18 1-4 2 *',
  $$
  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/preregistration-charge-cron?execute=1',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

---

## DoD — обязательные пруфы

### 1. Preflight HTTP-ответ (скрин)

Ожидание:
- `ok: true`
- `shop_id_masked: 335**`
- `provider_check: "shop+auth"`
- `charge_capability: true`

### 2. Execute вне окна (скрин)

- `processed: 0`
- `reason: "outside_window"`

### 3. SQL-пруфы

```sql
-- A) billing status distribution
SELECT
  count(*) total,
  count(*) FILTER (WHERE (meta->'billing'->>'billing_status') IS NOT NULL) status_present,
  count(*) FILTER (WHERE (meta->'billing'->>'billing_status')='no_card') no_card,
  count(*) FILTER (WHERE (meta->'billing'->>'billing_status')='failed') failed,
  count(*) FILTER (WHERE (meta->'billing'->>'billing_status')='paid') paid
FROM course_preregistrations
WHERE product_code='buh_business';

-- B) telegram_logs events
SELECT event_type, count(*)
FROM telegram_logs
WHERE event_type LIKE 'preregistration_%'
GROUP BY 1;

-- C) anti-repeat check
SELECT
  meta->'billing'->>'last_attempt_window_key' AS window_key,
  count(*)
FROM course_preregistrations
WHERE product_code='buh_business'
GROUP BY 1
ORDER BY 2 DESC;
```

### 4. UI-пруфы (из 7500084@gmail.com)

- /admin/payments/preorders
- Видны сегменты: «Ожидают списания», «Нет карты», «Ошибка списания», «Оплаченные»
- CRM-статусы отделены от billing-сегментов

---

## BUILD_ID текущий

`prereg-cron:2026-02-02T10:30:00Z`
