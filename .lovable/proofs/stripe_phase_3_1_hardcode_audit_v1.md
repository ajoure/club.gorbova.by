# Stripe Phase 3.1 — A2: Hardcode-аудит Phase 2 Stripe-кода

Дата: 2026-06-03. Режим: read-only аудит. **Никакие правки в этом этапе не выполняются** — фиксируется только список и классификация. Исправления — отдельным mini-plan по правке #1 утверждённого Plan v3.

Скоуп: `supabase/functions/stripe-*/`, `supabase/functions/_shared/acquiring/*`, фронтенд Phase 2 (только импорт-флоу Stripe).

Категории:
- **MUST-FIX-PHASE-3.1** — должно быть исправлено в Phase 3.1 до закрытия (через отдельный mini-plan).
- **BACKLOG-PRE-LIVE** — допустимо в test-mode, должно быть закрыто до live-режима.
- **OK** — фактическое поведение корректно, фиксируется как принятый контракт.

---

## H1. Хардкод default `account_code = 'stripe_poland'`
**Файлы / строки:**
- `supabase/functions/stripe-create-checkout/index.ts:41` — `const account_code = body.account_code ?? 'stripe_poland';`
- `supabase/functions/_shared/acquiring/stripe-adapter.ts:14` — `const account_code = req.context.account_code ?? 'stripe_poland';`

**Поведение:** при отсутствии `account_code` в payload подставляется `'stripe_poland'`. Это означает: если завтра появится второй Stripe-аккаунт без явного `is_default=true` для него, новые заказы без явного `account_code` всё равно пойдут в Польшу.

**Категория:** **MUST-FIX-PHASE-3.1**. Заменить fallback на: `acquiring_connections WHERE provider='stripe' AND is_default=true AND status='active'`. Если ни одного default нет → `errorResponse('no_default_stripe_account')`.

---

## H2. Дефолт `business_stream = 'default'` в Stripe metadata
**Файл / строка:** `supabase/functions/_shared/acquiring/stripe-metadata.ts:49`
```ts
business_stream: input.business_stream ?? 'default',
```

**Поведение:** если резолвер `business_stream` вернул `null` (см. `business-stream-resolver.ts`), Stripe metadata фиксирует литерал `'default'` вместо явного отсутствия. Это маскирует gap-данные.

**Категория:** **MUST-FIX-PHASE-3.1**. Варианты:
- (a) `throw new Error('stripe_metadata_missing:business_stream')` и принудительно требовать заполнения у offer/product.
- (b) Оставить `'default'`, но писать audit `stripe.metadata.business_stream_defaulted` с `order_id` для последующего backfill.

Решение — в mini-plan.

---

## H3. Отсутствие Stripe `Customer` + `setup_future_usage` в `stripe-adapter.ts`
**Файл / строки:** `supabase/functions/_shared/acquiring/stripe-adapter.ts:33-48` — Checkout Session создаётся **без** `customer` и **без** `payment_intent_data[setup_future_usage]`.

**Поведение:** карта в Stripe **не привязывается к Customer**, повторная оплата той же картой одним пользователем потребует повторного ввода. Это **блокер для пунктов C6.8–C6.10** (reuse карты).

**Категория:** **MUST-FIX-PHASE-3.1** (gap пилота). Mini-plan по правке #3:
1. Резолвить/создавать Stripe `Customer` per-account через новый helper `_shared/acquiring/stripe-customer-resolver.ts`.
2. Передавать `customer=<id>` в Checkout Session.
3. Передавать `payment_intent_data[setup_future_usage]=off_session` (или Setup Intent отдельным шагом — решается в mini-plan).
4. Сохранять `customer_id` в `profiles.meta.stripe.customers[account_code]` (add-only JSON merge, миграции не требуется).

Если в текущей конфигурации Stripe Checkout не позволяет сохранять карту в выбранной модели — это фиксируется в proof как gap и закрывается отдельно.

---

## H4. Прямой `fetch('https://api.stripe.com/...')` вне `stripe-client.ts`
**Файл / строки:** `supabase/functions/stripe-webhook/index.ts:209-211` — `fetch('https://api.stripe.com/v1/charges/{id}?expand[]=refunds', { headers: { Authorization: 'Bearer ${sk}' } })`.

**Поведение:** обход общего клиента. `Stripe-Version` header не задан, нет единой обработки ошибок. Секрет резолвится через `readAcquiringSecret(...)` — это OK, но bypass клиента создаёт неконсистентность.

**Категория:** **BACKLOG-PRE-LIVE**. В Phase 3.1 не блокирующее: refund-фоллбэк работает. Mini-plan на замену через `stripeFetch` — отдельным патчем до live.

---

## H5. `acquiring_connections.publishable_key` хранится в БД в открытом виде
**Файл / строка:** `acquiring_connections.publishable_key text` (SOT, см. A1).

**Поведение:** Publishable key Stripe — публичный по определению (frontend), хранение в БД корректно. Audit не требует исправления.

**Категория:** **OK**.

---

## H6. Резолв `customer_id` пользователя
**Текущее состояние:** не реализовано (см. H3). В `profiles.meta` нет ключа `stripe.customers`. Email-based лукап Customer в Stripe также не делается.

**Категория:** **MUST-FIX-PHASE-3.1** (часть mini-plan H3).

---

## H7. Subscription / Schedule webhook events
**Файл:** `supabase/functions/stripe-webhook/index.ts` — `dispatch()` обрабатывает только `checkout.session.{completed,expired}`, `payment_intent.{succeeded,payment_failed}`, `charge.refunded`/`refund.*`, `charge.dispute.created`. События `customer.subscription.*` и `invoice.*` **не обрабатываются**.

**Категория:** **OK для Phase 2 / целевая работа для Phase 3.1 этапа E**. Не блокирующий gap пилота C (one-time only).

---

## H8. `Stripe-Version` зафиксирован в одном месте
**Файл / строка:** `_shared/acquiring/stripe-client.ts:21` — `'Stripe-Version': '2024-06-20'`.

**Поведение:** единая фиксация версии API — корректно. Замечание: bypass в H4 эту версию не использует.

**Категория:** **OK** (исправление зависит от H4).

---

## H9. `provider_events.account_code` записывается из верифицированного webhook
**Файл / строки:** `stripe-webhook/index.ts:325-364` — итерация по всем `acquiring_connections WHERE provider='stripe'`, попытка верификации каждым webhook secret. Победивший `account_code` пишется в `provider_events.account_code`. Cross-check с `metadata.account_code` (если есть) → расхождение → `processing_status='manual_review'`.

**Категория:** **OK**. Это эталонная реализация multi-account webhook routing. Дополнительно: при unknown secret (никто не верифицировал) — возвращаем 400, не пишем `provider_webhook_orphans`. По правке #9 рассматривать запись в `provider_webhook_orphans` нужно только если discovery подтвердит, что это полезно для diagnostics — иначе оставляем 400.

**Sub-gap (BACKLOG-PRE-LIVE):** при отсутствии match можно дополнительно писать `audit_logs` с `action='stripe.webhook.signature_unverified'` для алертинга. Отдельный mini-plan.

---

## H10. `setup_future_usage` НЕ передаётся даже для метки «карта может быть сохранена»
Дубликат H3 — фиксируется как объединённая задача.

---

## H11. Hardcode `https://example.com/success`/`cancel`
**Файл / строки:** `_shared/acquiring/stripe-adapter.ts:36-37` — fallback `success_url`/`cancel_url` на `https://example.com/...`.

**Поведение:** если в `acquiring_connections.success_url`/`cancel_url` пусто, Stripe Checkout уйдёт на `example.com`. В пилоте C6.1 это даст плохой UX.

**Категория:** **MUST-FIX-PHASE-3.1**. В mini-plan: вместо `example.com` — либо заставить заполнить URL в connection, либо использовать project canonical URL (`https://consultation.gorbova.by/payment/success`).

---

## H12. `stripe-admin-sandbox-checkout` (339 строк)
Не читался полностью в этом аудите — это admin-only sandbox helper. По правке #2 (A2 только discovery) **детальный аудит этого файла переносится в mini-plan H1+H2+H3+H11**: при правке default account_code и customer-flow нужно одновременно пройти этот helper.

**Категория:** **MUST-FIX-PHASE-3.1** (в составе общего mini-plan).

---

## Сводная таблица

| Код | Категория              | Краткое описание                                           | Mini-plan |
|-----|------------------------|------------------------------------------------------------|-----------|
| H1  | MUST-FIX-PHASE-3.1     | Хардкод `'stripe_poland'` как default account_code         | MP-A2-1   |
| H2  | MUST-FIX-PHASE-3.1     | `business_stream = 'default'` маскирует gap                | MP-A2-1   |
| H3  | MUST-FIX-PHASE-3.1     | Нет Customer + setup_future_usage → нет reuse карты        | MP-A2-2 (пилот C) |
| H4  | BACKLOG-PRE-LIVE       | Прямой fetch к Stripe API вне `stripe-client.ts`           | MP-pre-live-1 |
| H5  | OK                     | publishable_key в БД — публичный                           | —         |
| H6  | MUST-FIX-PHASE-3.1     | Нет хранения customer_id per-account в profiles            | MP-A2-2   |
| H7  | OK (Phase 2) / Phase 3.1 E | Нет обработки subscription/invoice событий            | Этап E    |
| H8  | OK                     | `Stripe-Version` зафиксирован                              | —         |
| H9  | OK + sub-gap           | Multi-account webhook routing работает корректно           | MP-pre-live-2 |
| H10 | дубликат H3            | —                                                          | MP-A2-2   |
| H11 | MUST-FIX-PHASE-3.1     | Fallback URLs на `example.com`                             | MP-A2-1   |
| H12 | MUST-FIX-PHASE-3.1     | `stripe-admin-sandbox-checkout` — повторить правки         | MP-A2-1   |

## Дальнейший шаг
Согласно правке #1 утверждённого Plan v3:
> A2 формирует список hardcode-мест и классификацию. Исправления выполняются только после отдельного mini-plan/dry-run, если изменение может затронуть runtime.

Следующий шаг — **mini-plan MP-A2-1** (H1+H2+H11+H12: default account_code, business_stream gap, success URL, sandbox-checkout) и **mini-plan MP-A2-2** (H3+H6: Customer resolver + setup_future_usage + customer_id storage). Mini-plans готовятся отдельно и не запускаются в этом этапе.
