# STRIPE-FINAL-CLOSURE-SPRINT-V1 — Discovery RUN 1

> Статус: READ-ONLY DISCOVERY  
> Дата: 2026-06-13  
> Агент: fresh RUN 1  

---

## WORKSTREAM A — Billing period / trial / next charge presenter

### Текущая архитектура

Канонический resolver существует и полностью реализован.

**Файлы:**

| Файл | Роль |
|------|------|
| `src/utils/resolveStripeNextChargeAt.ts` | Canonical resolver — 5-уровневый priority chain |
| `src/components/purchases/SubscriptionListItem.tsx` | Клиентский UI (кабинет покупателя) — НЕ использует resolver, читает `subscription.next_charge_at` напрямую |
| `src/components/admin/subscriptions/StripeSubscriptionActionsBlock.tsx` | Stripe-actions block в admin |
| `src/components/admin/subscriptions/EditSubscriptionDialog.tsx` | Редактирование подписки (admin) |
| `src/components/admin/subscriptions/SubscriptionActionsSheet.tsx` | Actions sheet (admin + публичный кабинет) |
| `src/components/admin/ContactDetailSheet.tsx` | Admin — единственный вызов `resolveStripeNextChargeAt` (импорт как `n`) |
| `src/pages/admin/AdminSubscriptionsV2.tsx` | Legacy redirect → `/admin/payments/auto-renewals` |

**Canonical field mapping (priority chain в resolver):**

| Приоритет | Источник | Поле | Тип |
|-----------|----------|------|-----|
| 1 | `subscriptions_v2.meta.stripe.current_period_end` | unix sec → ISO | SOT для Stripe |
| 2 | `provider_subscriptions.meta.stripe.current_period_end` | unix sec → ISO | fallback Stripe |
| 3 | `subscriptions_v2.meta.current_period_end` | flat unix sec | редкий fallback |
| 4 | `provider_subscriptions.next_charge_at` | ISO string | bePaid resolver |
| 5 | `subscriptions_v2.next_charge_at` | ISO string | local fallback |
| — | null | — | нет данных |

**Прочие поля subscriptions_v2 (использует SubscriptionListItem):**

| Поле | Использование |
|------|--------------|
| `status` | badge: active / trial / expired / superseded / canceled |
| `is_trial` | показ блока "пробный период до" |
| `access_start_at` | не рендерится в текущем SubscriptionListItem |
| `access_end_at` | "Действует до: …" |
| `trial_end_at` | "Пробный период до: …" |
| `cancel_at` | "Доступ сохранится до …" (если isCanceled) |
| `canceled_at` | проверка isCanceled |
| `next_charge_at` | "Списание: …" (только при is_trial && !isInactive) |
| `auto_renew` | badge "Автопродление откл." |
| `auto_renew_disabled_by` | admin / client label |

**Hardcoded +30 days:** НЕ НАЙДЕНО. Контракт resolver явно запрещает `access_end_at` как замену `next_charge_at`.

**Call sites `resolveStripeNextChargeAt`:**
- `src/components/admin/ContactDetailSheet.tsx` (строки: импорт как `n`, вызов `n(sub as any)`) — единственный вызов

**Нужна migration:** НЕТ  
**Нужна новая Edge Function:** НЕТ  
**Нужен redeploy:** НЕТ  
**Риски bePaid/Stripe:** SubscriptionListItem в кабинете покупателя не вызывает resolver — для Stripe-подписок `next_charge_at` может быть NULL если не синхронизирован вебхуком; resolver доступен но не подключён к этому компоненту.

**Execute scope:** подключить `resolveStripeNextChargeAt` в `SubscriptionListItem.tsx` — получать `provider_subscriptions` join и прогонять через resolver для корректного отображения `next_charge_at` у Stripe-подписок в кабинете.  
**Deferred scope:** `stripe_billing_period_mode_v2.md` — смена периодичности через Stripe Subscription Schedule API.

**Verdict: MERGE_WITH_EXISTING** (resolver готов, нужно подключить к SubscriptionListItem)

---

## WORKSTREAM B — Bulk cancel

### Текущая архитектура

**Существующие механизмы отмены подписок:**

| Edge Function | Провайдер | Тип | Файл |
|--------------|-----------|-----|------|
| `stripe-subscription-action` | Stripe | single cancel (`cancel_at_period_end` / `cancel_now`) | `supabase/functions/stripe-subscription-action/index.ts` |
| `bepaid-cancel-subscriptions` | bePaid | bulk (массив `subscription_ids`) | `supabase/functions/bepaid-cancel-subscriptions/index.ts` |
| `subscription-admin-actions` | bePaid | single + GetCourse sync | `supabase/functions/subscription-admin-actions/index.ts` |
| `cancel-trial` | bePaid | trial cancel + revoke + GetCourse | `supabase/functions/cancel-trial/index.ts` |

**Stripe cancel детали** (`stripe-subscription-action`):
- RBAC: `requireSuperAdmin` → `has_role('super_admin')` через `_shared/acquiring/auth-guard.ts`
- Действия: `cancel_at_period_end` (мягко, до конца периода) и `cancel_now` (немедленно)
- `dry_run=true` по умолчанию — без реальных изменений; `dry_run=false` требует явного указания
- Только `provider='stripe'`; bePaid → `not_supported`
- `account_code` берётся из `subv2.meta.stripe.account_code`

**bePaid bulk cancel** (`bepaid-cancel-subscriptions`):
- Принимает массив `subscription_ids` (bePaid provider IDs) или `subscription_v2_id` (один)
- Обрабатывает 404 как "уже отменена" (Hotfix-2)
- НЕ содержит RBAC guard super_admin (проверить отдельно)

**Bulk UI в /admin/subscriptions:**
- `AdminSubscriptionsV2.tsx` — только редирект на `/admin/payments/auto-renewals`
- В `src/components/admin/subscriptions/` — нет компонентов с multi-select / checkbox / bulk action
- Глобальный поиск по `bulk.*cancel`, `multi.*select`, `checkbox.*sub` в src/ дал 0 результатов
- **Bulk cancel UI НЕ СУЩЕСТВУЕТ**

**Нужна migration:** НЕТ  
**Нужна новая Edge Function:** ЧАСТИЧНО — bulk Stripe cancel (wrapper над `stripe-subscription-action` для массива) нужно создать или добавить `bulk` action в существующую функцию  
**Нужен redeploy:** `stripe-subscription-action` при добавлении bulk mode  
**Риски bePaid/Stripe:** `bepaid-cancel-subscriptions` не имеет super_admin guard — нужно проверить RBAC. Stripe bulk требует serial обхода (rate limit), нужна защита от частичного выполнения.

**Execute scope:**
1. Добавить bulk-режим в `stripe-subscription-action` (принимать массив `subscription_v2_ids`, serial execute, возвращать canceled/failed)
2. Создать multi-select UI в `AutoRenewalsTabContent` (checkbox по строкам, кнопка «Отменить выбранные»)
3. Проверить RBAC в `bepaid-cancel-subscriptions`

**Deferred scope:** unified bulk cancel UI для bePaid+Stripe в одном action (зависит от F6 unified tab).

**Verdict: READY_TO_IMPLEMENT** (Stripe single cancel реализован, bulk и UI отсутствуют)

---

## WORKSTREAM C — `_shared/subscription-conflict.ts`

### Текущая архитектура

**Файл:** `supabase/functions/_shared/subscription-conflict.ts`  
**Тест:** `supabase/functions/_shared/subscription-conflict_test.ts`

**Статус hardcode `bepaid`:**  
НЕТ хардкода. Функция `checkSubscriptionConflict` принимает параметр `providers?: readonly ConflictProvider[]`. По умолчанию `DEFAULT_PROVIDERS = ['bepaid', 'stripe']`. Оба провайдера проверяются.

**Ключевые константы:**
```typescript
export const CONFLICTING_STATUSES = ['active', 'trial']
const BLOCKING_PROVIDER_STATES = ['active']
export const TERMINAL_STATUSES = ['canceled', 'superseded', 'expired', 'expired_reentry']
export type ConflictProvider = 'bepaid' | 'stripe'
const DEFAULT_PROVIDERS: readonly ConflictProvider[] = ['bepaid', 'stripe']
```

**Callers (все через импорт `./n.ts` — minified alias):**

| Файл | Роль |
|------|------|
| `supabase/functions/_shared/create-stripe-checkout.ts` | Stripe checkout flow |
| `supabase/functions/_shared/create-payment-checkout.ts` | Generic payment checkout |
| `supabase/functions/bepaid-create-subscription-checkout/index.ts` | bePaid subscription checkout |
| `supabase/functions/stripe-create-subscription-checkout/index.ts` | Stripe subscription checkout |

**Нужна migration:** НЕТ  
**Нужна новая Edge Function:** НЕТ  
**Нужен redeploy:** НЕТ  
**Риски:** нет — функция уже корректно поддерживает оба провайдера через параметр.

**Execute scope:** нет действий.  
**Deferred scope:** нет.

**Verdict: ALREADY_IMPLEMENTED** (harccode bepaid отсутствует, оба провайдера поддержаны)

---

## WORKSTREAM D — Test fixture marker

### Текущая архитектура

**Существующие маркеры: НЕ НАЙДЕНЫ.**

Поиск по `test_payment|is_fixture|fixture|technical|admin_test|internal_test|test_mode` в `src/` и `supabase/` вернул 0 результатов в runtime-таблицах/коде.

**`src/utils/derivePaymentChannel.ts`:** файл НЕ найден (не существует).

**Бэклог:** `.lovable/backlog/stripe_test_fixture_marker_v1.md` — полностью описывает проблему и три варианта:

| Вариант | Поле | Замечание |
|---------|------|-----------|
| A | `payments_v2.meta.fixture = true` | предпочтительный, write-paths |
| B | `payments_v2.meta.test_payment = true` | для обратной совместимости |
| C | derived из `acquiring_connections.test_mode = true` | по account_code |

**Явный запрет (из бэклога):**
- Нельзя определять fixture по сумме (`amount == 2 USD`)
- Нельзя хардкодить UUID конкретных платежей
- Нельзя возвращать `TEST_PAYMENT_DOCUMENT_BLOCKED` без canonical marker

**Связанные файлы:**
- `supabase/functions/admin-payment-documents-resolve/index.ts` — Approve B, пока НЕ блокирует генерацию
- `supabase/functions/_shared/payments/documents/generation-status.ts` — classifier (Approve B)

**Нужна migration:** НЕТ (marker пишется в уже существующее поле `meta`)  
**Нужна новая Edge Function:** НЕТ (write в webhook/admin charge paths)  
**Нужен redeploy:** `stripe-webhook`, `admin-manual-charge` при добавлении write-path  
**Риски:** без canonical marker `TEST_PAYMENT_DOCUMENT_BLOCKED` недоступен; production-номер документа может быть выдан на тест-платёж.

**Execute scope:**
1. Зафиксировать Вариант A: `payments_v2.meta.fixture = true`
2. Добавить запись в `stripe-webhook` (event → payment row) и admin manual charge
3. Расширить `generation-status.ts`: при `meta.fixture = true` → `can_generate=false`, `blocked_reason=TEST_PAYMENT_DOCUMENT_BLOCKED`
4. Бэкфилл исторических fixture-row (в т.ч. `00b39954…`, 2 USD)

**Deferred scope:** тесты Vitest для новой ветки classifier.

**Verdict: READY_TO_IMPLEMENT**

---

## WORKSTREAM E — Infra cleanup

### public-webhook-deploy-probe

**Файл:** `supabase/functions/public-webhook-deploy-probe/index.ts`  
**Статус:** СУЩЕСТВУЕТ. Canary-функция без бизнес-логики, без DB, без secrets.  
**Назначение:** проверка `verify_jwt=false` после Lovable-deploy (PATCH-LOVABLE-PUBLIC-WEBHOOK-DEPLOY-V1).  
**Marker:** `"public-webhook-deploy-v1"` — смена версии только в рамках Approve C4/D (controlled redeploy test).  
**В config.toml:** нужно проверить наличие записи (в данной сессии не прочитан — добавить к execute scope).  
**Инструкция по удалению** задокументирована в самой функции: `supabase--delete_edge_functions ["public-webhook-deploy-probe"]` после закрытия PATCH.

### admin-stripe-subscription-capability-probe

**Файл:** `supabase/functions/admin-stripe-subscription-capability-probe/index.ts`  
**Статус:** СУЩЕСТВУЕТ. GAP-D probe — super_admin only, `test_mode=true` only, без INSERT в runtime-таблицы.  
**Назначение:** доказательство Stripe Subscription capability для pilot price.  
**Риски:** нет (read-only runtime, только `audit_logs`).  
**Решение:** оставить (используется для controlled capability tests) или задокументировать как operational.

### stripe-admin-sandbox-checkout

**Файл:** `supabase/functions/stripe-admin-sandbox-checkout/index.ts`  
**Статус:** СУЩЕСТВУЕТ. Admin sandbox, `test_mode=true` enforced, super_admin only.  
**Назначение:** ручная sandbox-оплата из админки для тестов.  
**Решение:** оперативный инструмент, не удалять.

### Потенциально мёртвые тест-функции

| Функция | Тип | Решение |
|---------|-----|---------|
| `test-full-trial-flow` | test harness | проверить последний invoke; кандидат на удаление |
| `test-getcourse-sync` | test harness | кандидат на удаление |
| `test-installment-flow` | test harness | кандидат на удаление |
| `test-payment-complete` | test harness | кандидат на удаление |
| `test-payment-direct` | test harness | кандидат на удаление |
| `test-quiz-progress` | test harness | кандидат на удаление |
| `test-quiz-progress-rls` | test harness | кандидат на удаление |

### Backup/snapshot таблицы

Запрос к `pg_stat_user_tables` в данной read-only сессии без DB-доступа недоступен. Для выполнения необходим Supabase Read Database permission.

**Нужна migration:** НЕТ  
**Нужна новая Edge Function:** НЕТ  
**Нужен redeploy:** НЕТ  
**Риски:** `public-webhook-deploy-probe` занимает слот функции; тест-функции занимают слоты.

**Execute scope:**
1. Удалить `public-webhook-deploy-probe` после подтверждения закрытия PATCH-LOVABLE-PUBLIC-WEBHOOK-DEPLOY-V1
2. Аудит 7 test-* функций — проверить дату последнего invoke в Supabase Dashboard, удалить неиспользуемые
3. DB-запрос backup-таблиц (требует DB доступа)

**Verdict: DEFERRED_OPERATIONAL_UAT** (для probe — READY_TO_IMPLEMENT cleanup; для тест-функций — требует операционного подтверждения неиспользования)

---

## WORKSTREAM F — Deferred UAT inventory

### Инвентарь из `.lovable/backlog/stripe_*.md` и смежных файлов

| # | Файл | Категория | Verdict |
|---|------|-----------|---------|
| F1 | `stripe_billing_period_mode_v2.md` | Read-only view recurring params + Subscription Schedule API для смены периодичности | DEFERRED_OPERATIONAL_UAT |
| F2 | `stripe_card_data_enrichment_v2.md` | Материализация card data (brand/last4/wallet) в webhook + targeted enrichment исторических Stripe-платежей | DEFERRED_OPERATIONAL_UAT |
| F3 | `stripe_card_enrichment_live_uat_v1.md` | Live UAT чеклист (Сц.1: первая live one-time, Сц.2: первая live subscription, Сц.3: duplicate guard); не требует deploy если `stripe-webhook` не изменён | DEFERRED_OPERATIONAL_UAT |
| F4 | `stripe_dunning_admin_tab.md` | Админ-вкладка «Проблема с оплатой» — фильтр `meta->stripe->>dunning_status='past_due_grace'`, бейдж, кнопки resend-notify и admin portal-session | DEFERRED_OPERATIONAL_UAT |
| F5 | `stripe_dunning_email_template.md` | Email-шаблон `stripe-payment-failed` + email-инфраструктура (pgmq, send-transactional-email, template registry) | DEFERRED_OPERATIONAL_UAT |
| F6 | `stripe_saved_pm_followup.md` | Saved payment methods: Customer Portal (Вариант A) или Embedded Payment Element (Вариант B); решение после UX-пилота. Плюс: provider-badge у сохранённой карты, bePaid token ≠ Stripe PM | DEFERRED_OPERATIONAL_UAT |
| F7 | `phase_9c_provider_choice_and_stripe_subscriptions_visibility.md` | `provider_choice_source` в UI, `payment_type_admin_override` badge, Full Stripe subscriptions visibility (варианты A/B/C), audit drill-down в drawer'ах | DEFERRED_OPERATIONAL_UAT |
| F8 | `live_stripe_post_payment_followups.md` | F7 historical card backfill; F2 webinar access rule mismatch; **F3 provider derive в SubscriptionActionsSheet** (критично — кнопка отмены пишет «только bePaid»); F4 Stripe refund из UI; F5 stale saved cards; F6 unified «Подписки» tab | MERGE_WITH_EXISTING (F3) / DEFERRED_OPERATIONAL_UAT (остальные) |

### Критический пункт из F8-F3

> **Симптом (live_stripe_post_payment_followups.md → F3):** `SubscriptionActionsSheet` читает `subscription.provider`, а в `subscriptions_v2` такой колонки нет → всегда `undefined` → отдаёт generic local cancel вместо `StripeSubscriptionActionsBlock`.  
> **Файл:** `src/components/admin/subscriptions/SubscriptionActionsSheet.tsx`  
> **Исправление:** derive provider из `meta.stripe.subscription_id` / `meta.bepaid`, прокидывать в `StripeSubscriptionActionsBlock`.  
> **Verdict: READY_TO_IMPLEMENT** (не требует deploy Edge Function, только frontend fix)

---

## Сводная таблица вердиктов

| Workstream | Описание | Verdict |
|------------|----------|---------|
| A | Billing period presenter | **MERGE_WITH_EXISTING** |
| B | Bulk cancel | **READY_TO_IMPLEMENT** |
| C | subscription-conflict.ts bepaid hardcode | **ALREADY_IMPLEMENTED** |
| D | Test fixture marker | **READY_TO_IMPLEMENT** |
| E — probe | public-webhook-deploy-probe cleanup | **READY_TO_IMPLEMENT** |
| E — test-* | 7 тест-функций | **DEFERRED_OPERATIONAL_UAT** |
| E — DB backup | Backup/snapshot таблицы | **STOP_BLOCKER** (нет DB доступа) |
| F1–F2,F4–F7 | Stripe deferred backlog | **DEFERRED_OPERATIONAL_UAT** |
| F3 (из F8) | SubscriptionActionsSheet provider derive | **READY_TO_IMPLEMENT** |
| F3-card-UAT | Live webhook card data UAT | **DEFERRED_OPERATIONAL_UAT** |

---

## STOP_BLOCKER — требует внимания

### E: backup-таблицы — нет DB доступа

Запрос к `pg_stat_user_tables WHERE table_name ~ '(_backup_|_stripe_cleanup_|_repair_backup|snapshot)'` не может быть выполнен в данной сессии. Необходимо:
- Включить «Read database» в Lovable Cloud settings
- Либо выполнить вручную в Supabase SQL Editor

```sql
SELECT table_name,
       pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS total_size,
       n_live_tup
FROM pg_stat_user_tables
WHERE table_name ~ '(_backup_|_stripe_cleanup_|_repair_backup|snapshot)'
ORDER BY pg_total_relation_size(quote_ident(table_name)) DESC;
```

---

## Приложение: Execute scope summary

### Высокий приоритет (фронтенд, без deploy)

1. **A + F8-F3**: `src/components/purchases/SubscriptionListItem.tsx` — добавить `resolveStripeNextChargeAt` через join `provider_subscriptions`; `src/components/admin/subscriptions/SubscriptionActionsSheet.tsx` — derive provider из `meta`.

### Средний приоритет (Edge Function changes + redeploy)

2. **B**: Bulk Stripe cancel — добавить `bulk` action в `stripe-subscription-action` + multi-select UI в `AutoRenewalsTabContent`
3. **D**: Test fixture marker — write-path в `stripe-webhook` + `admin-manual-charge` + `generation-status.ts` + бэкфилл

### Низкий приоритет (cleanup)

4. **E**: Удалить `public-webhook-deploy-probe`; аудит и удаление 7 test-* функций
