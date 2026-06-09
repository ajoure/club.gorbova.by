# да, согласен, с учетом правок:

## **1. План правильный**

Phase 9-A должен быть только **Discovery only**. Никакой реализации до отдельного approve Phase 9-B.

---



## **2. Уточнить**

`git diff --name-only`

Добавь:

```md
Ожидаемый diff:

.lovable/discovery/phase_9_reporting_admin_visibility_inventory_v1.md

Опционально:

.lovable/proofs/phase_8_runtime_verify_full_v1.md

Любой diff в src/, supabase/functions/, supabase/migrations/ = STOP и объяснение.
```

---



## **3. Audit inventory — не ограничивать только**

`LIMIT N`

В разделе audit лучше указать:

```md
SELECT DISTINCT action
FROM audit_logs
WHERE action LIKE 'stripe.%'
   OR action LIKE 'payment_link.%'
   OR action LIKE 'bepaid.%'
   OR action LIKE 'payment.%'
   OR action LIKE 'subscription.%'
ORDER BY action;
```

`LIMIT N` может скрыть важные actions.

---

## **4. Provider events — добавить агрегацию по статусам**

В Discovery добавить read-only summary:

```sql
SELECT
  provider,
  account_code,
  event_type,
  processing_status,
  COUNT(*) AS cnt
FROM provider_events
GROUP BY provider, account_code, event_type, processing_status
ORDER BY cnt DESC;
```

И отдельно failed/manual_review/skipped:

```sql
SELECT
  provider,
  account_code,
  event_type,
  processing_status,
  processing_error,
  COUNT(*) AS cnt
FROM provider_events
WHERE processing_status IN ('failed', 'manual_review', 'skipped')
GROUP BY provider, account_code, event_type, processing_status, processing_error
ORDER BY cnt DESC;
```

---

## **5. Gap matrix — добавить приоритет**

В `Gap matrix` добавить колонку:

```text
priority: P0 / P1 / P2
```

Где:

- **P0** — мешает администратору понять статус оплаты/доступа/ошибки;
- **P1** — важно для удобства и контроля;
- **P2** — косметика / future improvement.

---

## **6. Phase 9-B recommendation — не смешивать Reporting и Repair**

Добавить правило:

```md
Phase 9-B — только visibility/reporting.

Не добавлять repair actions:
- retry webhook;
- regrant access;
- force reconcile;
- manual remap;
- delete/orphan cleanup;
- backfill execute.

Если discovery найдёт потребность в repair-actions, оформить их отдельным future PATCH / Phase 9-C, но не включать в Phase 9-B без approve.
```

---

## **7. Subscriptions — зафиксировать design question**

Добавить в Open questions:

```md
Нужно выбрать модель UI для подписок:

A. Оставить отдельные tabs bePaid / Stripe.
B. Сделать unified Subscriptions tab с provider filter.
C. Оставить bePaid legacy tab и добавить Stripe visibility только в Payments/Orders.

В Discovery дать рекомендацию, но не реализовывать.
```

---

## **8. Links visibility — добавить обязательные поля**

В `payment_links` inventory обязательно проверить, отображаются ли в UI:

```text
provider
provider_mode
provider_choice_source
payment_type
account_code
stripe_currency
business_stream
created_by / actor
offer_id
tariff_id
target contact / email
```

---

## **9. Receipts/Documents visibility — разделить one-time и subscription**

Добавить:

```md
В UI gaps отдельно проверить:

Stripe one-time:
- payments_v2.receipt_url;
- audit stripe.receipt_materialization.applied.

Stripe subscription:
- meta.stripe.hosted_invoice_url;
- meta.stripe.invoice_pdf;
- meta.stripe.stripe_invoice_id / invoice_id;
- meta.stripe.subscription_id.

bePaid:
- payments_v2.receipt_url;
- bePaid receipt button;
- bePaid receipt cron status, если отображается.
```

---

## **10. Итоговый ответ Lovable**

```md
План принят с правками.

Phase 9-A выполняем строго как Discovery only.

Уточнения:

1. Ожидаемый diff:
   - `.lovable/discovery/phase_9_reporting_admin_visibility_inventory_v1.md`;
   - опционально `.lovable/proofs/phase_8_runtime_verify_full_v1.md`.
   Любой diff в `src/`, `supabase/functions/`, `supabase/migrations/` = STOP.

2. Audit inventory делать без `LIMIT N`, чтобы не потерять actions.

3. По `provider_events` добавить агрегацию по `provider / account_code / event_type / processing_status`, отдельно failed/manual_review/skipped.

4. В Gap matrix добавить priority: P0 / P1 / P2.

5. Phase 9-B — только visibility/reporting. Никаких repair-actions, retry, regrant, reconcile, cleanup, backfill execute.

6. По subscriptions добавить design question:
   - unified tab;
   - отдельные bePaid/Stripe tabs;
   - либо visibility только через Payments/Orders.

7. В Links visibility обязательно проверить:
   - provider;
   - provider_mode;
   - provider_choice_source;
   - payment_type;
   - account_code;
   - stripe_currency;
   - business_stream;
   - created_by / actor;
   - offer/tariff/contact.

8. Receipts/Documents visibility разделить:
   - Stripe one-time receipt_url;
   - Stripe subscription hosted_invoice_url / invoice_pdf / invoice_id;
   - bePaid receipt_url.

После Discovery дать отчет на русском и предложить Phase 9-B implementation plan. Phase 9-B не начинать без отдельного approve.


План: Phase 9-A — Reporting / Admin Visibility (Discovery only)
```

## Контекст

Phase 8 закрыт (FULL PASS). Phase 9-B не стартует без отдельного approve. Текущая задача — только discovery-файл. Никаких UI-правок, миграций, edge functions, RPC, runtime-кода.

## Scope (строго)

Разрешено:

- read-only чтение UI-компонентов, hooks, RPC, view, edge functions через `code--view`, `rg`, `supabase--read_query`;
- создание одного нового файла: `.lovable/discovery/phase_9_reporting_admin_visibility_inventory_v1.md`;
- (опционально) минимальная актуализация уточнения в `.lovable/proofs/phase_8_runtime_verify_full_v1.md` ТОЛЬКО для фиксации, что `stripe.receipt_materialization.applied` является фактическим audit-action для invoice materialization (если на текущий момент этот пункт не отражён).

Запрещено: всё перечисленное в Phase 9 scope (lifecycle, webhooks, grant/access, Telegram, reconcile, новая архитектура, backfill execute, live Stripe, ЭСЧФ).

## Discovery-обследование (read-only)

### 1. UI-инвентаризация — где сейчас показываются сущности

Прочитать и зафиксировать текущее состояние:

- Платежи: `src/components/admin/payments/PaymentsTabContent.tsx`, `src/components/admin/payments/columns/*`, `usePaymentsServerStats`, `usePayments*`.
- Заказы: `src/pages/admin/AdminOrders*`, `src/components/admin/orders/*`.
- Подписки: `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx`, `AutoRenewalsTabContent.tsx`, Stripe subs (если есть отдельный таб).
- Payment links: `src/components/admin/payments/links/LinksTabContent.tsx`, `LinkDetailsDrawer.tsx`, `LinkStatusBadge.tsx`, `usePaymentLinks.ts`.
- Provider events: `src/components/admin/integrations/StripeEventsTab.tsx`, аналог для bePaid (если есть).
- Diagnostics: `src/components/admin/payments/DiagnosticsTabContent.tsx`, `PaymentIssuesTabContent.tsx`.
- Audit logs: где админ может увидеть `audit_logs` записи по платежам/линкам.

Для каждой точки указать: какой компонент, какие колонки, какие фильтры, какие badge.

### 2. Поля БД — что фактически есть

Через `supabase--read_query` (read-only `information_schema` + sample row):

- `payments_v2`: `provider`, `status`, `currency`, `receipt_url`, `meta.stripe.{hosted_invoice_url, invoice_pdf, invoice_id, subscription_id, receipt_url}`.
- `orders_v2`: `provider`, `meta.payment_flow`, `meta.payment_link_id`, currency.
- `payment_links`: `provider`, `provider_mode`, `provider_choice_source`, `account_code`, `profile_code`, `business_stream`, `payment_type`.
- `subscriptions_v2`: provider hint в `meta`, `provider_subscriptions` join.
- `provider_events`: `account_code`, `event_type`, `processing_status`, `signature_valid`, `processing_error`.
- `audit_logs`: action codes, относящиеся к Stripe/bePaid/payment_link (`stripe.receipt_materialization.applied`, `payment_link.payment_type_promoted_recurring`, `payment_link.payment_type_admin_override`, `stripe.invoice.paid.activated` и т.д.) — собрать актуальный список через `SELECT DISTINCT action FROM audit_logs WHERE action LIKE 'stripe.%' OR action LIKE 'payment_link.%' OR action LIKE 'bepaid.%' LIMIT N`.
- Enriched views/RPC: `payment_links_enriched_v`, `get_admin_payment_links_v1`, `admin_get_payments_stats_v1`, `stripe-list-events` — что они уже возвращают.

### 3. UI Gaps — что отсутствует

Для каждой gap зафиксировать: где должен быть, какое поле читать, почему важно:

- provider badge в таблице платежей/заказов/ссылок/подписок;
- фильтр по `provider` (bepaid / stripe) в Payments, Orders, Links;
- видимость способа создания ссылки: `provider_choice_source` (button settings / admin override / customer choice) — есть ли в `LinkDetailsDrawer`;
- видимость currency в Payments/Orders (особенно при mixed BYN/USD/EUR);
- видимость `account_code` / `profile_code` / `business_stream` для Stripe-платежей;
- наличие/отсутствие receipt link для bePaid и invoice/PDF link для Stripe (one-time vs subscription);
- webhook health: количество failed/skipped/manual_review `provider_events` за период, ссылка на конкретное событие;
- override visibility: видно ли в карточке ссылки, что админ выбрал explicit one_time на recurring offer;
- duplicate/orphan: видна ли таблица `provider_webhook_orphans` / `payment_reconcile_queue` админу;
- subscription provider visibility: bePaid vs Stripe в табах подписок (сейчас есть только `BepaidSubscriptionsTabContent`).

### 4. Рекомендация Phase 9-B (только тезисы, без реализации)

В discovery-файле:

- список конкретных UI-файлов, которые потребуют изменений в Phase 9-B;
- список добавляемых колонок/badge/фильтров (без кода);
- надо ли создавать новый read-only diagnostics-блок или дополнить существующий;
- список proof, которые понадобятся в Phase 9-B (скрин Stripe-платежа с invoice link, фильтр по provider, override-флаг в LinkDetails, webhook orphan list);
- риски и зависимости (например: разделение Stripe/bePaid subscriptions tabs vs unified tab — это design-вопрос для approve до Phase 9-B).

## Структура discovery-файла

`.lovable/discovery/phase_9_reporting_admin_visibility_inventory_v1.md`:

```text
1. Цель и scope
2. UI inventory (компонент → отображаемые поля → фильтры → gaps)
3. DB / RPC / view inventory (поле → текущее использование → доступность в UI)
4. Audit action inventory (action → семантика → используется ли в UI)
5. Gap matrix (gap → где → impact → recommended fix scope)
6. Рекомендация Phase 9-B (файлы / поля / фильтры / proof)
7. Open questions для approve перед Phase 9-B
8. DoD Phase 9-A
```

## DoD Phase 9-A

- Создан только `.lovable/discovery/phase_9_reporting_admin_visibility_inventory_v1.md`.
- (Опционально) одна правка в `.lovable/proofs/phase_8_runtime_verify_full_v1.md` с явной фиксацией `stripe.receipt_materialization.applied` как audit-action для invoice materialization.
- Никаких изменений в `src/`, `supabase/functions/`, `supabase/migrations/`.
- `git diff --name-only` показывает только discovery-файл (и опционально proof-уточнение).
- Отчёт о выполнении на русском + предложение Phase 9-B implementation plan для отдельного approve.

## Out of scope (явно)

- Никакого UI-кода, миграций, edge functions, RPC.
- Никаких изменений в checkout / webhooks / grant / Telegram / reconcile.
- Phase 9-B implementation — отдельным approve.