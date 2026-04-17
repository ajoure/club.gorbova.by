# Layer A — Grep-Audit & Coverage Matrix

> Auditor: автоматический grep по `supabase/functions/` (snapshot @ 2026-04-17).
> Scope: только offer-driven первичная оплата. Helper: `_shared/crm-routing.ts`.

---

## 1. Coverage-матрица — все точки изменения `orders_v2.status` / `pipeline_stage_id`

| #   | Flow                                                         | File                                                    | Line | Status / Event                                         | Helper called                          | Action name                                  | Scope                  |
| --- | ------------------------------------------------------------ | ------------------------------------------------------- | ---- | ------------------------------------------------------ | -------------------------------------- | -------------------------------------------- | ---------------------- |
| 1   | One-time order INSERT (snapshot+pending)                     | `_shared/create-payment-checkout.ts`                    | 228  | INSERT `pending` + snapshot                            | `resolveOfferRouting` ✅                | `crm_stage_applied_pending` (не пишется здесь — pending выставляется самим INSERT, audit можно добавить отдельно) | **Layer A**            |
| 2   | Subscription init order INSERT (snapshot+pending)            | `_shared/create-payment-checkout.ts`                    | 597  | INSERT `pending` + snapshot                            | `resolveOfferRouting` ✅                | — (см. п.1)                                  | **Layer A**            |
| 3   | Admin test payment (`skipRedirect`) order INSERT             | `bepaid-create-token/index.ts`                          | 506  | INSERT `pending` + snapshot                            | `resolveOfferRouting` ✅ (добавлено)    | —                                            | **Layer A**            |
| 4   | One-time MAIN success branch                                 | `bepaid-webhook/index.ts`                               | 3851 | UPDATE `paid`                                          | `applyCrmStageOnTerminal('success')` ✅ (добавлено)  | `crm_stage_applied_success` / `_skipped_*`   | **Layer A**            |
| 5   | One-time MAIN failed/expired branch                          | `bepaid-webhook/index.ts`                               | 4646 | UPDATE `failed`                                        | `applyCrmStageOnTerminal('failed')` ✅  | `crm_stage_applied_failed` / `_skipped_*`    | **Layer A**            |
| 6   | LINK order success (subscription init paid)                  | `bepaid-webhook/index.ts`                               | 2261 | UPDATE `paid`                                          | `applyCrmStageOnTerminal('success')` ✅ (добавлено)  | `crm_stage_applied_success` / `_skipped_*`   | **Layer A**            |
| 7   | LINK order success (one-time / `/pay/:token`)                | `bepaid-webhook/index.ts`                               | 3372 | UPDATE `paid`                                          | `applyCrmStageOnTerminal('success')` ✅  | `crm_stage_applied_success` / `_skipped_*`   | **Layer A**            |
| 8   | LINK order failed/expired                                    | `bepaid-webhook/index.ts`                               | 3161 | UPDATE `failed`                                        | `applyCrmStageOnTerminal('failed')` ✅  | `crm_stage_applied_failed` / `_skipped_*`    | **Layer A**            |
| 9   | Checkout-create error rollback (one-time)                    | `_shared/create-payment-checkout.ts`                    | 331  | UPDATE `failed` (внутренний rollback при ошибке bePaid) | ❌ (не вызывается)                      | —                                            | Layer A — допустимо: UI-возврат сразу, заказ ещё не показан клиенту в Kanban; покрыто follow-up если потребуется |
| 10  | Subscription create error rollback                           | `_shared/create-payment-checkout.ts`                    | 699/713 | UPDATE `failed`                                     | ❌                                      | —                                            | Layer A — то же                       |
| 11  | Subscription RECURRING renewal `paid`                        | `bepaid-webhook/index.ts`                               | 1476 | UPDATE `paid` (renewal по старой подписке)             | ❌ (намеренно)                          | —                                            | **Out of scope (Layer B)** — recurring/rebill |
| 12  | Subscription terminal cancel/expire/fail (sub state)         | `bepaid-webhook/index.ts`                               | 1824 | subscription teardown                                  | ❌                                      | —                                            | **Out of scope** — это состояние подписки, не первичный платёж |
| 13  | Refund (`refunded`)                                          | `bepaid-webhook/index.ts`                               | 3782 | UPDATE `refunded`                                      | ❌ (намеренно)                          | —                                            | **Out of scope** — refund ≠ failed-bucket |
| 14  | `site-form-submit` пути                                      | `site-form-submit/index.ts` (вне scope)                 | —    | INSERT/UPDATE `orders_v2`                              | ❌                                      | —                                            | **Out of scope (Layer B)** |
| 15  | Импорт/реконсиляция (`bepaid-report-import`, `sync-payments-with-statement`, `admin-backfill-2026-orders`, `split-multi-module-orders`, `merge-clients`) | разные | разные | сервисные апдейты | ❌                                      | —                                            | **Out of scope** — историческая нормализация, не offer-driven first payment |

### Итог по Layer A
- ✅ Все **8 «живых» точек первичного платежа** (#1–#8) подключены к helper'у.
- ✅ pending выставляется в **3-х местах создания** (#1, #2, #3) — все идут через `resolveOfferRouting`.
- ✅ success покрыт в **3-х success-веках webhook** (#4, #6, #7).
- ✅ failed покрыт в **2-х failed-веках webhook** (#5, #8).
- 🟡 Внутренние rollback'и при ошибке создания checkout'а (#9, #10) умышленно НЕ дёргают helper: заказ ещё не показан клиенту, ошибка возвращается синхронно. Если потребуется — добавим отдельным патчем.

---

## 2. Snapshot-pending guarantee — все точки materialize Layer A

| Точка               | Файл                                          | Snapshot пишется | pending-stage пишется |
| ------------------- | --------------------------------------------- | ---------------- | --------------------- |
| One-time            | `_shared/create-payment-checkout.ts:244-246`  | ✅ при `routing.ok` | ✅ при `routing.ok`  |
| Subscription init   | `_shared/create-payment-checkout.ts:613-615`  | ✅                | ✅                    |
| Admin test payment  | `bepaid-create-token/index.ts:539-540`        | ✅ (новое)        | ✅ (новое)            |

При `routing.enabled=false` или невалидной конфигурации:
- snapshot **не пишется** (грязного «битого» snapshot в `orders_v2.meta` нет).
- `pipeline_id` / `pipeline_stage_id` остаются `NULL`.
- Заказ создаётся как раньше → побочных ошибок нет.
- Webhook позже дойдёт до helper и запишет `crm_stage_apply_skipped_invalid_config`.

---

## 3. Out-of-scope confirmation

Сознательно НЕ покрыты Layer A (зафиксировано выше в матрице):

- **Recurring / rebill** (`bepaid-webhook` ветка subscription renewal) — Layer B.
- **Refund** (`refunded`) — refund ≠ failed-bucket по бизнес-логике. Отдельная стадия не вводится.
- **Subscription teardown** (cancel/expire подписки в `subscriptions_v2`) — это состояние подписки, не первичный платёж.
- **`site-form-submit`** — Layer B.
- **Импорт/реконсиляция/merge/split** — historical batch, не offer-driven.

---

## 4. Mini-report для ручного теста (что готово прямо сейчас)

### Тестовый оффер (рекомендация)
- **Воронка:** `a0000001-0000-0000-0000-000000000015` — «Тестовый продукт для админов» (содержит open/closed_won/closed_lost).
- Любой активный оффер на тестовом продукте — например, `f356bc30-c453-4028-aa74-8b74d8032c66` (Подоходный налог с физлиц / 2 этапа, 390 BYN, `pay_now`). На нём включить `crm_routing.enabled=true` через UI (Admin → Продукты → Offer Dialog → секция «🎯 Привязка к воронке»).
- В Offer Dialog auto-defaults подставят первую `open` / `closed_won` / `closed_lost` из выбранной воронки. Сохранить.

### 4 сценария
| #   | Канал                         | Сценарий | Тестовая карта / действие                                                                      |
| --- | ----------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| 1   | Guest checkout (PaymentDialog) | success  | bePaid test-режим → `4200 0000 0000 0000` (success), любой CVV, срок в будущем                |
| 2   | Guest checkout                | failed   | `4005 5500 0000 0001` (decline) **либо** закрыть окно оплаты → ожидается `failed` через webhook expire |
| 3   | Public `/pay/:token`          | success  | Сгенерировать `payment_link`, открыть `/pay/:token`, оплатить test-картой success              |
| 4   | Public `/pay/:token`          | failed   | То же — карта decline или таймаут                                                              |

### Где взять `order_id` после каждого теста
- **Сразу после оплаты:** редирект `/purchases?order=<ID>&status=...` или `/purchases?bepaid_sub=success&order=<ID>` — `order_id` в URL.
- **Из БД:**
  ```sql
  SELECT id, status, customer_email, created_at, pipeline_stage_id
  FROM orders_v2
  WHERE customer_email = '<твой тестовый email>'
  ORDER BY created_at DESC LIMIT 5;
  ```

### Какой блок SQL запускать сразу после теста
| Кейс                            | Блок из `crm-routing.proof.sql`        |
| ------------------------------- | -------------------------------------- |
| Pending после создания          | C                                      |
| Terminal success/failed         | D + E                                  |
| Snapshot immutability           | F (по специально подготовленному order) |
| Manual override                 | G + audit-выборка `_skipped_manual_override` |
| Invalid config                  | H (тест на оффере без routing)         |

---

## 5. Итоговый статус

- ✅ код внесён;
- ✅ Layer A реализован;
- ✅ grep-audit завершён, найдены и закрыты 3 пробела (admin test payment INSERT; main one-time success; link-order subscription-init success);
- ✅ Deno-тесты helper'а: 12/12 зелёные (передеплоено `bepaid-webhook` + `bepaid-create-token`);
- ⏳ live-proof не завершён.

**Что осталось только за ручным прогоном:**
1. Включить `crm_routing.enabled=true` на тестовом оффере через UI.
2. Прогнать 4 сценария (guest success/failed + `/pay/:token` success/failed) → собрать 4 `order_id`.
3. Дополнительно — 1 сценарий manual-override + 1 сценарий immutability + 1 сценарий invalid_config.

После этого собираю live-proof в финальном отчёте по разделам:
**Coverage proof / DB proof / Audit proof / Snapshot immutability proof / Manual override proof / Out-of-scope confirmation.**
