# Phase 9-A — Reporting / Admin Visibility Inventory (Discovery only)

Status: DISCOVERY ONLY. Никаких изменений в `src/`, `supabase/functions/`, `supabase/migrations/`.

Expected diff:
- `.lovable/discovery/phase_9_reporting_admin_visibility_inventory_v1.md` (этот файл)
- опционально `.lovable/proofs/phase_8_runtime_verify_full_v1.md` (фиксация `stripe.receipt_materialization.applied`)

Любой diff в `src/`, `supabase/functions/`, `supabase/migrations/` = STOP.

---

## 1. Цель и scope

Сделать видимыми в админке: provider платежа (bePaid/Stripe), способ создания ссылки (button / admin override / customer choice), валюту, Stripe account, наличие receipt/invoice/PDF, наличие subscription, ошибки webhook/materialization, дубли/orphans.

In scope (Phase 9-B, после approve): минимальные UI-правки в существующих admin-вьюхах; provider/status badges; фильтры; ссылки на receipt/invoice; read-only diagnostics над уже существующими таблицами.

Out of scope (категорически): любые изменения checkout lifecycle, bePaid/Stripe webhook логики, grant/access, Telegram, subscriptions-reconcile, новая платёжная архитектура, backfill execute, live Stripe, ЭСЧФ/налоговые документы. Никаких repair-actions (retry webhook, regrant, force reconcile, manual remap, delete/orphan cleanup, backfill execute) — если найдём потребность, оформляется отдельным Phase 9-C.

---

## 2. UI inventory

### 2.1 Payments — `/admin/payments`
- `src/components/admin/payments/PaymentsTabContent.tsx` + `PaymentsTable.tsx` + `PaymentsFilters.tsx`.
- Колонки таблицы: amount + currency (`{amount} {currency}`), provider_response (через `ReceiptStatusBadge`/`NotificationStatusIndicators`), `receipt_url` (кнопка чека), `provider_uid`.
- Фильтры (`PaymentsFilters.tsx`): `filters.provider` Select (значения `all` + конкретные provider) — фильтр уже есть.
- Gaps: НЕТ явного badge `bePaid / Stripe` в строке (provider скрыт в provider_response); НЕТ Stripe-специфичной кнопки `Invoice/PDF`; НЕТ колонки `account_code` / `business_stream`; currency показана, но без визуального акцента на mixed BYN/USD/EUR.

### 2.2 Payment Links — `/admin/payments/links`
- `src/components/admin/payments/links/LinksTabContent.tsx` + `LinkStatusBadge.tsx` + `LinkDetailsDrawer.tsx` + `EditPaymentLinkDialog.tsx`.
- Хук `usePaymentLinks.ts` поверх RPC `get_admin_payment_links_v1` уже возвращает: `provider`, `provider_mode`, `account_code`, `profile_code`, `business_stream`, `payment_type`.
- Фильтр provider уже есть: `providerFilter` (`all | bepaid | stripe`).
- `LinkDetailsDrawer.tsx` показывает: amount/currency, paid orders join. НЕ показывает: `provider`, `provider_mode`, `account_code`, `business_stream`, `provider_choice_source` (в RPC поля нет вообще — нужно проверить enriched view), `payment_type` явно, `created_by/actor`.
- Gaps: provider badge в строке таблицы есть/нет (надо подтвердить визуально в Phase 9-B); в drawer отсутствуют все Stripe-meta поля; нет визуализации explicit one_time override на recurring offer (audit `payment_link.payment_type_admin_override` существует — см. §4, но в UI не выведен).

### 2.3 Orders — `src/pages/admin/AdminOrders*`, `src/components/admin/orders/*`
- Таблица заказов — нужно подтвердить наличие колонки provider/currency в Phase 9-B (быстрый аудит при реализации).
- Gaps (предварительно): provider badge, фильтр по provider, связь с Stripe invoice id.

### 2.4 Subscriptions
- `BepaidSubscriptionsTabContent.tsx` — отдельный таб только для bePaid.
- `AutoRenewalsTabContent.tsx` — auto-renewal cohort (SOT по `tariff_offers.meta.recurring.is_recurring`).
- Stripe-подписок отдельного таба НЕТ.
- Gaps: Stripe subscriptions невидимы как отдельная сущность в Subscriptions-табах; provider badge отсутствует; `hosted_invoice_url`/`invoice_pdf`/`stripe_subscription_id` нигде не отображаются.

### 2.5 Provider events
- `src/components/admin/integrations/StripeEventsTab.tsx` — есть таблица Stripe events (`provider_events` через edge `stripe-list-events`).
- bePaid-аналога такой таблицы нет (есть `BepaidSyncLogs`, но это другая сущность).
- Gaps: нет агрегации failed/skipped/manual_review; нет links на конкретный order/payment; нет фильтра по `account_code`.

### 2.6 Diagnostics / Payment Issues
- `DiagnosticsTabContent.tsx`, `PaymentIssuesTabContent.tsx`, `PaymentIssuesProofModal.tsx`.
- Не покрывает: provider_events failed/manual_review summary; webhook orphans.

### 2.7 Audit logs visibility
- Прямого UI-просмотра `audit_logs` админу нет (исторически).
- Gaps: для recurring/override решений (`payment_link.payment_type_admin_override`, `stripe.receipt_materialization.applied` и пр.) нет точки входа из карточки ссылки/платежа.

---

## 3. DB / RPC / View inventory

### 3.1 `payments_v2`
Имеющиеся колонки (по `information_schema`): `provider`, `provider_payment_id`, `currency`, `receipt_url`, `profile_id`. Stripe-специфика — в `meta.stripe`: `hosted_invoice_url`, `invoice_pdf`, `invoice_id`, `subscription_id`, `receipt_url` (зеркало).

UI использует: `currency`, `receipt_url`, `provider_response`, `provider_uid` (без явного `provider`-badge).

### 3.2 `orders_v2`
Имеет: `provider`, `currency`, `profile_id`. UI почти не показывает provider в таблице.

### 3.3 `payment_links`
Имеет: `provider`, `provider_mode`, `account_code`, `profile_code`, `business_stream`, `currency`. RPC `get_admin_payment_links_v1` уже отдаёт первые 5 (см. `usePaymentLinks.ts`).
`provider_choice_source` — поля по `information_schema` нет; источником служит `payment_links.meta` (используется в edge `admin-create-public-link` для audit). В Phase 9-B надо подтвердить, в каком JSON-path хранится `provider_choice_source` и `payment_type_source`, и пробросить через RPC/enriched view, не меняя writer.

### 3.4 `subscriptions_v2`
Имеет: `provider`, `currency`, `profile_id`. Связь со Stripe — через `provider_subscriptions` и `meta`.

### 3.5 `provider_events`
Имеет: `provider`, `account_code`, `event_type`, `processing_status`, `signature_valid`, `processing_error`, `related_order_id`, `related_payment_id`. Используется `StripeEventsTab`.

### 3.6 Views / RPC
- `payment_links_enriched_v` (security_invoker=on) — SOT для journal ссылок.
- `get_admin_payment_links_v1` — основной reader.
- `admin_get_payments_stats_v1` — server-side агрегаты по платежам (есть параметр `p_provider`, фиксирован на `bepaid` в `usePaymentsServerStats.ts` → провайдер-агрегация по Stripe в stats отсутствует).
- `stripe-list-events` — read events.

---

## 4. Audit action inventory (выборка через `audit_logs`)

Получено через:
```sql
SELECT DISTINCT action FROM audit_logs
WHERE action LIKE 'stripe.%' OR action LIKE 'payment_link.%'
   OR action LIKE 'bepaid.%' OR action LIKE 'payment.%'
   OR action LIKE 'subscription.%'
ORDER BY action;
```

Ключевые (по Phase 9 цели):
- `stripe.receipt_materialization.applied` — **фактический audit-action для materialization invoice fields (hosted_invoice_url / invoice_pdf / stripe_invoice_id / invoice_id)**. Используется и для one-time receipt_url, и для subscription invoice. Отдельного `stripe.invoice_document_materialized` НЕТ — `applied` это и есть SOT-action.
- `stripe.receipt_materialization.skipped_existing_receipt_url` — idempotency-skip.
- `stripe.invoice.paid.activated` / `stripe.invoice.paid.rebound_pre_created_sub` / `stripe.invoice.paid.unknown_sub` / `stripe.invoice.paid.no_subscription` / `stripe.invoice.paid.order_insert_failed` — invoice lifecycle.
- `stripe.invoice.payment_failed.grace` — dunning grace.
- `stripe.checkout.session.expired`, `stripe.subscription_checkout.pre_create`, `…pre_create_rollback`.
- `stripe.subscription.created.bound | already_bound`, `…updated.synced`, `…deleted.canceled`, `stripe.subscription_action.execute.cancel_now`.
- `stripe.portal.*` (session_created/failed/blocked, cancel_at_period_end_*).
- `payment_link.created`, `…materialized`, `…bridge_created`, `…installment_landing_created`, `…remap_payment_order`, `…unmatched`, `…conflict_provider_payment_id`, `…failed_recorded`, `…payment_type_admin_override`. (Action `payment_link.payment_type_promoted_recurring` упоминается в memory; в выборке `DISTINCT` его нет на момент discovery — значит recurring-promotion в проде ещё не срабатывал либо записан другим именем; подтвердить в Phase 9-B перед визуализацией.)
- `bepaid.webhook.*`, `bepaid.subscription.*`, `bepaid.rebill.*`, `bepaid.sync.*`, `bepaid.erip.*` — полный bePaid lifecycle.

UI-видимость этих actions сейчас: НЕТ (audit_logs не выведен в admin UI напрямую).

---

## 5. Provider events — агрегация (на момент discovery)

`SELECT provider, account_code, event_type, processing_status, COUNT(*) …`:
- Все провайдер-события сейчас от `stripe / stripe_poland`. bePaid события идут отдельным трактом через `bepaid_sync_logs`, не через `provider_events`.
- Доминируют: `checkout.session.completed` processed (26), `checkout.session.expired` processed (26), `payment_intent.succeeded` processed (25), `customer.subscription.created` (12), `charge.refunded` (8), `customer.subscription.updated` (7), `invoice.paid` processed (7).

Failed / manual_review / skipped:
- `invoice.paid` × 2 manual_review (`manual_review:unknown`).
- `checkout.session.completed` × 1 failed (Edge non-2xx).
- `invoice.paid` × 1 failed (`orders_v2 insert failed: null value in column "base_price"` — известный data-integrity edge-case).

Gaps: эти 4 записи нигде не подсвечены в admin UI; нужен read-only summary-tile + drill-down в `StripeEventsTab` (уже есть).

---

## 6. Gap matrix

| # | Gap | Где | Источник данных | Impact | Priority |
|---|---|---|---|---|---|
| 1 | Нет provider badge (bePaid/Stripe) в строке Payments | `PaymentsTable.tsx` | `payments_v2.provider` | Админ не видит провайдер без открытия | P0 |
| 2 | Нет provider badge в строке Payment Links | `LinksTabContent.tsx` (проверить) | `payment_links.provider` | Не видно сразу bePaid/Stripe ссылка | P0 |
| 3 | Нет Stripe invoice/PDF ссылок в карточке платежа | `PaymentsTable.tsx` row drawer | `payments_v2.meta.stripe.{hosted_invoice_url,invoice_pdf,invoice_id}` | Невозможно открыть инвойс из админки | P0 |
| 4 | Нет visibility `provider_choice_source` (button/admin override/customer choice) | `LinkDetailsDrawer.tsx` | `payment_links.meta` (подтвердить путь) | Не виден способ создания ссылки | P0 |
| 5 | Нет visibility explicit `one_time` override на recurring offer | `LinkDetailsDrawer.tsx` | audit `payment_link.payment_type_admin_override` + `payment_links.meta` | Невозможно объяснить расхождение recurring offer ↔ one_time link | P0 |
| 6 | Нет провайдер-stats для Stripe в `admin_get_payments_stats_v1` использовании | `usePaymentsServerStats.ts` (hardcoded `provider='bepaid'`) | RPC поддерживает param | Stripe-выручка не агрегируется на dashboard | P1 |
| 7 | Нет webhook health summary (failed/manual_review/skipped count) | `DiagnosticsTabContent.tsx` или `StripeEventsTab.tsx` | `provider_events` group-by | Скрытые ошибки invoice/checkout | P0 |
| 8 | Нет видимости `account_code` / `business_stream` для Stripe платежей | `PaymentsTable.tsx`, `LinkDetailsDrawer.tsx` | колонки уже есть | Multi-account ambiguity | P1 |
| 9 | Currency mixed (BYN/USD/EUR) без визуального акцента | Payments, Orders, Links | `currency` поля | Риск визуальной путаницы | P2 |
| 10 | Subscriptions: Stripe подписок нет в админ-UI | `BepaidSubscriptionsTabContent.tsx` единственный | `subscriptions_v2` + `provider_subscriptions` | Stripe subs invisible | P0 (design-question §7) |
| 11 | Orders таблица: нет provider badge / фильтра | `AdminOrders*` | `orders_v2.provider` | Невозможно фильтровать по каналу | P1 |
| 12 | Webhook orphans / `provider_webhook_orphans` / `payment_reconcile_queue` не выведены админу | Diagnostics | таблицы существуют | Скрытые potential leaks | P1 |
| 13 | Audit drill-down из карточки платежа/ссылки отсутствует | Drawers | `audit_logs` | Сложно понять историю решения | P2 |

---

## 7. Open questions для approve перед Phase 9-B

1. **Subscriptions UI model.** Выбрать одну из:
   - A. Отдельные tabs bePaid / Stripe (минимум миграции UI).
   - B. Unified Subscriptions tab с `provider` filter (требует обобщения hook).
   - C. Оставить только bePaid legacy tab, Stripe visibility — через Payments/Orders (минимум работы, но Stripe-subs остаются slightly second-class).
   - **Discovery-рекомендация:** B (unified + filter), но это меняет существующий UI больше, чем A; нужен approve.

2. **`provider_choice_source` storage path.** Подтвердить, в каком JSON-path внутри `payment_links.meta` хранится поле (используется в edge `admin-create-public-link`), и нужно ли расширять `get_admin_payment_links_v1` для пробрасывания. Discovery не правит RPC; решение в Phase 9-B.

3. **`payment_link.payment_type_promoted_recurring` audit action.** На момент discovery `DISTINCT` его не показал. До визуализации в Phase 9-B нужно подтвердить точное имя action в коде writer'а.

4. **Stripe stats.** Разделять `admin_get_payments_stats_v1` вызов на два (bepaid + stripe) или добавить unified mode? Без изменения RPC — clientside aggregation.

5. **Audit drill-down.** Создавать ли отдельный read-only AuditEventsList component для drawers, или оставить P2 на Phase 9-C.

---

## 8. Рекомендация Phase 9-B (только тезисы)

Файлы, которые предположительно потребуют add-only правок:
- `src/components/admin/payments/PaymentsTable.tsx` — добавить provider badge column, Stripe invoice/PDF link в row drawer.
- `src/components/admin/payments/PaymentsFilters.tsx` — уже есть provider filter; убедиться, что значения `bepaid`/`stripe` сходятся со схемой.
- `src/components/admin/payments/links/LinksTabContent.tsx` — provider badge в строке таблицы (если ещё не выведен).
- `src/components/admin/payments/links/LinkDetailsDrawer.tsx` — добавить `provider`, `provider_mode`, `account_code`, `business_stream`, `payment_type`, `provider_choice_source`, override-флаг.
- `src/components/admin/payments/DiagnosticsTabContent.tsx` — read-only summary-tile по `provider_events` failed/manual_review/skipped.
- `src/components/admin/integrations/StripeEventsTab.tsx` — добавить фильтр `processing_status`, фильтр `account_code`.
- (опционально, по решению §7.1) — новый `SubscriptionsTabContent.tsx` unified или отдельный Stripe tab.

Поля, которые надо добавить в UI без миграций:
- provider, provider_mode, account_code, business_stream (для links).
- meta.stripe.hosted_invoice_url, invoice_pdf, invoice_id, subscription_id (для payments row).
- meta.stripe.receipt_url (для one-time Stripe).
- bePaid receipt_url (уже есть).

Фильтры:
- Payments: provider (есть), account_code (новое).
- Links: provider (есть), account_code (новое), payment_type (есть/проверить).
- Orders: provider (новое).
- Stripe events: processing_status (новое), account_code (новое).

Receipts / Documents visibility — разделить:
- Stripe one-time: `payments_v2.receipt_url`, audit `stripe.receipt_materialization.applied` (single SOT-action).
- Stripe subscription: `meta.stripe.hosted_invoice_url`, `meta.stripe.invoice_pdf`, `meta.stripe.invoice_id`, `meta.stripe.subscription_id`.
- bePaid: `payments_v2.receipt_url`, существующий receipt button.

Proof, которые понадобятся в Phase 9-B:
- скрин Payment-row с provider badge и Stripe invoice link;
- скрин LinksTab с фильтром по Stripe + override-флаг в drawer;
- скрин Diagnostics с webhook health summary;
- скрин StripeEvents с фильтрами;
- запрос проверки, что никакие функции/таблицы/cron не модифицированы.

Repair-actions запрещены (см. scope §1).

---

## 9. DoD Phase 9-A

- Создан только `.lovable/discovery/phase_9_reporting_admin_visibility_inventory_v1.md` (этот файл).
- Опционально — одна правка в `.lovable/proofs/phase_8_runtime_verify_full_v1.md` с фиксацией `stripe.receipt_materialization.applied` как фактического audit-action для invoice materialization.
- `git diff --name-only` показывает только эти файлы.
- Никаких изменений в `src/`, `supabase/functions/`, `supabase/migrations/`.
- Phase 9-B implementation plan — отдельным approve.
