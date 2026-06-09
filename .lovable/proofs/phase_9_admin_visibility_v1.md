# Phase 9-B — Minimal Admin Visibility / Reporting — Proof v1

Дата: 2026-06-09
Scope: visibility/reporting only. Никаких миграций, новых edge functions, RPC, repair/retry/regrant/reconcile/backfill, изменений checkout/webhook/grant/Telegram.

## 0. Diagnose (read-only)

Фактическое состояние данных, на основании которого выполнены правки:

- `payment_links.meta->>'provider_choice_source'` присутствует в writer (`admin-create-public-link`: значения `'auto' | 'explicit'`), но **в БД у текущих ссылок NULL** и поле **не отдаётся** RPC `get_admin_payment_links_v1` / `usePaymentLinks`. → визуализация поля **deferred в Phase 9-C** (без расширения RPC).
- `payments_v2.meta.stripe` использует ключи `invoice_id`, `subscription_id`, `hosted_invoice_url`, `invoice_pdf` (подтверждено выборкой 10 свежих stripe-платежей). Hook делает tolerate-fallback на альтернативные имена `stripe_invoice_id` / `stripe_subscription_id`, ничего в БД не нормализует.
- `provider_events.processing_status` фактически = `{processed, failed, manual_review}`. `skipped_duplicate` не используется — в UI отображаем фактические non-success статусы из данных, без хардкода.
- Provider filter в `PaymentsFilters.tsx` (bePaid / Stripe) **уже существует** — не дублируем.

SQL-семплы (read-only):

```
payments_v2 stripe sample:
 id, currency, invoice_id, subscription_id, hosted_invoice_url, invoice_pdf
 a04e3c9c… BYN  in_1Tg9B3…  sub_1Tg9B6…  ✓  ✓
 a68d84be… BYN  in_1Tfb5P…  sub_1Tfb5S…  ✗  ✗
 …

provider_events:
 manual_review  2
 failed         2
 processed     118

payment_links recent (provider_choice_source = NULL у всех 5):
 9b225b41 bepaid fixed one_time
 1929791a stripe fixed one_time
 93dc2845 stripe fixed subscription
 …
```

## 1. Изменённые файлы

- `src/hooks/useUnifiedPayments.tsx` — добавлены поля `stripe_invoice_id`, `stripe_subscription_id`, `stripe_hosted_invoice_url`, `stripe_invoice_pdf` (read-only из `payments_v2.meta.stripe`, tolerate alt keys).
- `src/components/admin/payments/PaymentsTable.tsx` — новая колонка `provider` (badge bePaid / Stripe), колонка `receipt` переименована в «Документы»: bePaid → «Чек», Stripe one-time → существующий `receipt_url`, Stripe subscription → «Invoice» + «PDF» из `meta.stripe`. Fallback «Документ ещё не получен».
- `src/components/admin/payments/links/LinkDetailsDrawer.tsx` — provider/provider_mode badges + DetailRows: Провайдер, Режим выбора провайдера, Acquiring account, Profile code, Business stream. `provider_choice_source` honestly помечен как deferred.
- `src/components/admin/integrations/StripeEventsTab.tsx` — health summary (счётчики по фактическим статусам), фильтры `processing_status` + `account_code`, колонка `processing_error`, account_code в строке.
- `.lovable/proofs/phase_9_admin_visibility_v1.md` (этот файл).

## 2. Что НЕ тронуто (freeze)

- `supabase/functions/` — без изменений.
- `supabase/migrations/` — без миграций.
- `src/integrations/supabase/client.ts` — auto-gen, не тронут.
- `admin-create-public-link`, `bepaid-webhook`, `stripe-webhook`, `grant-access-for-order`, `telegram-*`, `subscriptions-reconcile` — не тронуты.
- Никаких retry / repair / regrant / reconcile / backfill / cleanup UI-кнопок не добавлено.
- Provider filter в `PaymentsFilters.tsx` не дублирован — уже существовал.

## 3. Gates

| Gate | Проверка | Статус |
| ---- | -------- | ------ |
| P9-1 | Provider badge в Payments | PASS (`PaymentsTable.DEFAULT_COLUMNS` содержит `provider`) |
| P9-2 | Provider filter работает | PASS (`PaymentsFilters` — bePaid/Stripe, оставлено as-is) |
| P9-3 | Stripe receipt/invoice/PDF видны | PASS (новая ячейка «Документы» в `PaymentsTable`) |
| P9-4 | bePaid receipt visibility не сломана | PASS (`ReceiptStatusBadge` сохранён для bePaid и Stripe one-time) |
| P9-5 | Payment links показывают provider/provider_mode/account/business_stream/payment_type | PASS (`LinkDetailsDrawer`) |
| P9-6 | Explicit one_time на recurring виден как admin override | PARTIAL — `provider_choice_source` deferred (см. §4); сейчас admin видит recurring offer + payment_type='one_time' через существующие поля Драйвера (тариф/тип). Полный warning-badge — в Phase 9-C после расширения RPC. |
| P9-7 | failed/manual_review/skipped видны | PASS (`StripeEventsTab` summary + фильтр + processing_error) |
| P9-8 | Stripe subscription_id виден в payment details | PARTIAL — поле есть в `UnifiedPayment` (`stripe_subscription_id`), доступно для дальнейшей детализации без нового RPC; в Phase 9-B видимость на уровне «Документы» (Invoice/PDF). |
| P9-9 | Нет repair/retry/reconcile/backfill | PASS |
| P9-10 | Freeze соблюдён | PASS (см. §2) |

## 4. Deferred → Phase 9-C / отдельный approve

1. **`provider_choice_source`** в UI — требует расширения RPC `get_admin_payment_links_v1` или добавления колонки. В Phase 9-B не делаем (запрет на миграции/новые RPC).
2. **Audit drill-down** — отдельный read-only RPC/запрос, не входит в Phase 9-B.
3. **AdminOrdersV2 details — Stripe invoice/subscription join** — требует расширения payload. В Phase 9-B видимость остаётся в Payments (через `meta.stripe`). Provider/currency в Orders уже доступны как полей `orders_v2.payment_method` (legacy) и связанных `payments_v2` — без новых join'ов.
4. **Unified subscriptions tab** — backlog/Phase 9-C.
5. **Полный admin-override warning badge на ссылке** — зависит от (1).

## 5. Контракт audit-action (повтор для ясности)

- `stripe.receipt_materialization.applied` — фактический audit-action для invoice materialization (см. proof Phase 8 §7).
- `payment_link.payment_type_promoted_recurring` — не наблюдался в `DISTINCT audit_logs.action`. На Phase 9-B UI на нём не зависит.

## 6. Verify

- Build/typecheck выполняется автоматически Lovable-харнессом.
- Превью: `/admin/payments` (вкладка «Платежи») — новая колонка «Провайдер» + ячейка «Документы»; `/admin/payments/links` — драйвер деталей с provider/mode/account_code; `/admin/integrations` Stripe events — сводка + фильтры + processing_error.

— Phase 9-B = PASS по scope; P9-6/P9-8 честно помечены как PARTIAL и вынесены в Phase 9-C.
