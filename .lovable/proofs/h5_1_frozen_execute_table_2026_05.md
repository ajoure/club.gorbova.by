# H5.1 — Stage 0 + Stage 0.5 (Frozen Execute Table) — STOP

**Snapshot:** 2026-05-16 (Минск 2026-05-17), read-only.

**Решение:** **STOP, без DML.** Frozen execute table в финальном виде **не заморожена** — обнаружены два блокера, требующие явного решения пользователя перед approve.

---

## 1. Stage 0.A — Schema-check

Все колонки, которые мы пишем/читаем, существуют:

| Таблица | Колонка | Тип | OK |
|---|---|---|---|
| orders_v2 | provider | text | ✓ |
| orders_v2 | provider_payment_id | text | ✓ |
| orders_v2 | bepaid_subscription_id | text | ✓ |
| orders_v2 | pipeline_id | uuid | ✓ |
| orders_v2 | pipeline_stage_id | uuid | ✓ |
| orders_v2 | offer_id | uuid | ✓ |
| orders_v2 | order_number | text | ✓ |
| orders_v2 | deal_date | timestamptz | ✓ |
| orders_v2 | paid_amount | numeric | ✓ |
| orders_v2 | final_price | numeric | ✓ |
| orders_v2 | currency | text | ✓ |
| orders_v2 | product_id | uuid | ✓ |
| orders_v2 | tariff_id | uuid | ✓ |
| orders_v2 | user_id | uuid | ✓ |
| orders_v2 | profile_id | uuid | ✓ |
| orders_v2 | status | enum | ✓ |
| orders_v2 | meta | jsonb | ✓ |
| payments_v2 | id, order_id, user_id, profile_id, paid_at, provider_payment_id, amount, refunded_amount, transaction_type, meta, updated_at | соответствуют | ✓ |

**Важное уточнение к плану v2:** `payments_v2.bepaid_subscription_id` **как отдельной колонки НЕТ**. SBS resolution ступень #1 (`payment.bepaid_subscription_id`) физически невозможна. Резолвер должен начинаться сразу с `payment.meta->>'bepaid_subscription_id'` (или вложенных путей в `meta.provider_response.transaction.subscription_id`).

**Unique-индекс подтверждён:** `idx_orders_v2_provider_payment_unique` UNIQUE `(provider, provider_payment_id) WHERE provider IS NOT NULL AND provider_payment_id IS NOT NULL` — повторная вставка REBILL по тому же pid не пройдёт.

**Уникальность order_number:** `orders_v2_order_number_key` UNIQUE `(order_number)` — повторный `REBILL-<suffix>` тоже не пройдёт.

**Statuses:** `status` — enum (`USER-DEFINED`). Допустимое значение `'paid'` подтверждено наличием 201 REBILL-row с `status='paid'`.

Verdict: schema-check **PASS**.

---

## 2. Stage 0.B — REBILL number format verify

**Найдено расхождение с планом v2.**

Plan v2 фиксировал: `REBILL-<first12(provider_payment_id)>`.

Runtime canonical materialization (последние 8 REBILL-orders, ORDER BY created_at DESC) использует **`REBILL-<first12(payments_v2.id)>`**:

| order_number | provider_payment_id | repointed payment_id | first12(payment_id) | matches suffix? |
|---|---|---|---|---|
| REBILL-7a64cd04-3d0 | e2eedd12-f1dc-4af4-… | 7a64cd04-3d08-… | `7a64cd04-3d0` | **✓** |
| REBILL-420bec3d-21e | 6e7903fa-5aed-4a33-… | 420bec3d-21e8-… | `420bec3d-21e` | **✓** |
| REBILL-5ad48899-0c5 | a50130bd-ed0f-42d9-… | 5ad48899-0c5c-… | `5ad48899-0c5` | **✓** |
| REBILL-38d3cad0-08d | cb1d9143-79e4-4729-… | 38d3cad0-08dc-… | `38d3cad0-08d` | **✓** |
| REBILL-58d1d641-322 | 1077476c-2a8a-44a0-… | 58d1d641-3220-… | `58d1d641-322` | **✓** |
| REBILL-bba9f065-a0b | c79fa51b-a4a7-4b4b-… | bba9f065-a0b… | `bba9f065-a0b` | **✓** |

Все 5 пар совпадают по `first12(payments_v2.id)` и ни одна — по `first12(provider_payment_id)`.

**Контракт H5.1 должен использовать тот же формат, что и runtime** (см. Core: «Canonical Access Paths / Single Sources of Truth» — H5.1 не должен вводить второй формат).

**Корректировка плана v2 (требует apporve):**

- `expected_rebill_order_number = 'REBILL-' || substr(payment.id::text, 1, 12)` (НЕ provider_payment_id).
- Идемпотентность по REBILL → проверять и по `order_number = 'REBILL-' || substr(payment.id::text,1,12)`, и по unique `(provider='bepaid', provider_payment_id)`.

Verdict: **format в плане v2 НЕВЕРЕН**. До approve правки H5.1 не может быть заморожен.

---

## 3. Stage 0.C — Mode check

`BEPAID_REBILL_MATERIALIZATION` ранее подтверждён `on` в H4.1 proof (2026-05-16T21:03:50Z). Значение secret не читается из БД (по policy). Перед DML повторный re-read обязателен (`secrets--fetch_secrets`).

Verdict: PASS на текущий момент.

---

## 4. Stage 0.D — Baseline stable checksums

**Полные baselines (read-only snapshot, global):**

| Метрика | Значение |
|---|---|
| `orders_v2` REBILL count | 201 |
| `orders_v2` REBILL ids md5 | `940629164c0278af3a06d134c1398544` |
| `subscriptions_v2` rows | 1160 |
| `subscriptions_v2` Σ epoch(access_end_at) | 1 943 704 845 320 |
| `subscriptions_v2` null access_end_at | 61 |
| `entitlements` rows | 930 |
| `entitlements` Σ epoch(expires_at) | 1 652 712 683 792 |
| `entitlements` null expires_at | 2 |

**Дисклеймер.** H5 dry-run snapshot значения (`subs 456 / Σ 787 775 646 072 / null 11` и `ent 405 / Σ 721 480 200 523 / null 0`) явно scoped по 62 пользователям H5 candidate-set. Их корректная переcheckpoint возможна **только после** заморозки candidate-set H5.1 (см. блокер ниже).

---

## 5. Stage 0.5 — Frozen Execute Table — **НЕ ЗАМОРОЖЕНА**

### 5.A Reproducibility-блокер

H5 dry-run proof фиксирует summary (72 candidate payments, 03:2 / 04:2 / 05:68, 62 users, 71 parents, Σ 16 410.00 BYN) **без точного SQL** и **без сохранённого id-листа** в machine-readable виде.

Я воспроизвёл фильтр по нескольким разумным комбинациям критериев на той же базе:

| Метод (snapshot at Stage 0) | Кандидатов | Совпадает с H5 (72)? |
|---|---|---|
| `rn>1` over (user, product, tariff), bepaid 2026, parent !REBILL-, !source∈{repair,materialization} | 650 | нет |
| `rn>1` per parent_order OR (rn=1 AND pay_month≠deal_month) | 178 | нет |
| Same + recurring tariff filter (`tariff_offers.meta.recurring.is_recurring=true`) | 171 | нет |
| `pay_month ≠ deal_month` (без rn) | 151 | нет |
| Распределение по месяцам ни одного метода (`2026-05` дают 76 / 76 / 76; H5 фиксирует 68) | — | — |

**Разница 76 vs 68 в мае** означает, что либо:
1. между H5 dry-run и текущим snapshot **поступили новые recurring payments** (вероятно, mode=on уже срабатывал — но тогда они были бы в REBILL-orders, что мы исключаем фильтром);
2. H5 использовал доп. фильтр, не зафиксированный в proof (например, exclude по `payment.meta.source`, специфический whitelist продуктов, или per-tariff cohort).

В отсутствие сохранённого id-листа H5 dry-run **я не могу гарантированно построить frozen execute table = ровно те 72 payment-id**, что фигурировали в H5.

### 5.B Что готов сделать после approve

Один из вариантов (требует явного решения):

**A. Re-derive — широкий cohort, transparent guards.** Применить детерминистический фильтр (например, «pay_month ≠ deal_month по Europe/Minsk, parent !REBILL-, !rebill-source, no refund trace, no duplicate REBILL»), получить N candidates (порядка 151–178), пропустить через все guard'ы Stage 1 → green/manual_review/skipped, заморозить как H5.1 cohort. **H5 «72» становится подмножеством этого батча.**

**B. Замораживание = ровно 72 из H5.** Требует, чтобы кто-то предоставил оригинальный SQL H5 dry-run или сохранённый id-лист. Без них реплицировать precisely невозможно.

**C. Сузить через `payments_v2.meta.source='subscription_rebill'`** (если bepaid-webhook пишет такой маркер для автосписаний). Это самый ID-First способ. Проверим до approve, если выберете A или C.

### 5.C Что НЕ сделано в этом шаге (по дизайну STOP)

- frozen execute table CSV — не создан (преждевременно, пока не закрыта 5.A);
- per-candidate guard pass — не запускался;
- rollback SQL — не генерировался (требует id-листа);
- scoped stable checksums по N users — не считались.

---

## 6. Блокеры, требующие явного решения

1. **REBILL number format в плане v2 неверен.** Подтвердите смену на `REBILL-<first12(payments_v2.id::text)>` — иначе H5.1 нарушит canonical runtime format и сломает идемпотентность с будущими автосписаниями.
2. **Reproducibility H5 cohort.** Выберите путь A / B / C из §5.B. Без этого frozen table нельзя приводить.
3. **SBS resolver ступень #1 убрать.** В плане v2 «`payment.bepaid_subscription_id`» — такой колонки нет. Резолвер: `payment.meta->>'bepaid_subscription_id'` → вложенные пути в `payment.meta.provider_response` → `parent.bepaid_subscription_id` с доказательством совпадения → иначе `manual_review:sbs_unresolved`.

---

## 7. Что выполнено в этом шаге (Stage 0 read-only)

- schema-check — PASS (с поправкой про `payments_v2.bepaid_subscription_id`).
- REBILL format verify — расхождение зафиксировано (см. §2).
- Mode = on — на момент H4.1 подтверждено; перед DML повторный re-read обязателен.
- Global baseline checksums — зафиксированы (§4).
- 0 DML, 0 migrations, 0 edge-function вызовов, 0 changes secrets, 0 persistent objects.

---

## 8. Ожидание

Жду ответа по трём блокерам §6. После решения — повторный заход в Stage 0.5 с правильным форматом, согласованной выборкой и scoped baselines, выдача `.lovable/proofs/h5_1_frozen_execute_table_2026_05.csv` + summary, генерация rollback SQL preview. **Approve на DML — отдельным сообщением после заморозки.**
