# PATCH v23.1.9A — Historical entitlement gap discovery + Canonical order selection + Pipeline verification

## Статус: ВЫПОЛНЕН (discovery only, без execute). Правки 1-10 применены.

## Цель

Полная discovery-фаза перед historical entitlement backfill: gap analysis, duplicate/installment classification, canonical order selection, root cause, policy matrix. **Без execute.**

---

## v23.1.9A.1 — Entitlement gap discovery

### ИСПРАВЛЕННОЕ КРИТИЧЕСКОЕ ОТКРЫТИЕ

**Creation paths системно не покрывают все случаи matching entitlements; текущий confirmed gap = 156 active subscription pairs + 193 order-based CB20 cases.**

156 из 403 активных подписок (user × product пар, matching by same `user_id + product_code`) не имеют matching active entitlement. 247 подписок уже корректно покрыты entitlements.

Gap разделён на две независимые группы:

#### Subscription-based gap (156 пар)

| Продукт | active_subs | subs С entitlement | subs БЕЗ entitlement | gap % |
|---|---|---|---|---|
| Gorbova Club | 149 | **142** | **7** | 5% |
| ЦБ 2 ступень | 89 | **63** | **26** | 29% |
| ЗАКРОЙ ГОД | 63 | **9** | **54** | 86% |
| ЦБ 2.0: Учет у ИП | 59 | **0** | **59** | 100% |
| Бухгалтерия как бизнес | 32 | **30** | **2** | 6% |
| Подоходный налог ИП | 9 | **1** | **8** | 89% |
| **Итого** | **401** | **245** | **156** | 39% |

#### Order-based gap (193 users)

| Продукт | paid_users | active_entitlements | gap |
|---|---|---|---|
| Ценный бухгалтер 2.0 | 196 | 0 | **193** (with tariff, ready) + 3 (no tariff, NEED_POLICY) |

**Итого gap: 156 (sub-based) + 193 (order-based CB20) = 349 user×product пар.**

### Gorbova Club — НЕ полная рассинхронизация

| Категория | Кол-во |
|---|---|
| has_active_sub + has matching entitlement | **142** |
| has_active_sub + NO entitlement | **7** |
| has_active_entitlement + NO active sub | **3** |

**Вывод**: 142 подписчика уже имеют active entitlement. Gap — только **7** пользователей. 3 active entitlements без active subscription **не трогаем в v23.1.9B** (обратный рассинхрон не входит в execute scope).

### Полный продуктовый реестр

| Продукт | product_code | training_modules | paid_orders | paid_users | active_subs | active_entitlements | gap |
|---|---|---|---|---|---|---|---|
| Ценный бухгалтер 2.0 | cb20 | 38 | 444 | 196 | 0 | 0 | **193** (order-based) |
| Gorbova Club | club | 19 | 981 | 205 | 149 | 145 | **7** (sub-based) |
| ЦБ 2 ступень | prd_0d01a2fdc477 | 2 | 111 | 111 | 89 | 71 | **26** (sub-based) |
| ЗАКРОЙ ГОД | course_close_year | 8 | 308 | 156 | 63 | 11 | **54** (sub-based) |
| ЦБ 2.0: Учет у ИП | cb_module_ip | 1 | 0 | 0 | 59 | 0 | **59** (sub-based) |
| Бухгалтерия как бизнес | buh_business | 1 | 64 | 33 | 32 | 30 | **2** (sub-based) |
| Подоходный налог ИП | 1769009596189-398a | 1 | 11 | 10 | 9 | 1 | **8** (sub-based) |
| Подоходный налог с физлиц | pn_s_fl | 4 | 0 | 0 | 0 | 0 | 0 |
| Платная консультация | consultation | 0 | 3 | 3 | 0 | 1 | 0 (нет тренингов) |
| Остальные 14 продуктов | — | 0 | 0 | 0 | 0 | 0 | 0 |

---

## v23.1.9A.2 — Duplicate/installment deal discovery + Canonical order selection

### Ценный бухгалтер 2.0 (196 users, 444 orders)

**Каноническая покупка** определяется только среди заказов **с tariff_id**. Заказы без tariff_id не участвуют в расчёте основного entitlement.

#### Классификация пользователей

| Классификация | Users | Orders | Описание |
|---|---|---|---|
| `single_order_with_tariff` | 102 | 102 | Одна покупка с тарифом. READY. |
| `multi_order_mixed` (tariff + no-tariff) | 67 | 246 | Есть заказы с тарифом + без тарифа. Canonical = best tariff. |
| `multi_order_same_tariff` | 19 | 70 | Несколько заказов с одним тарифом. Canonical = любой (одинаковые). |
| `multi_order_diff_tariffs` (upgrade) | 5 | 21 | Апгрейд: разные тарифы. Canonical = max access_days. |
| `multi_order_all_no_tariff` | 2 | 4 | Нет тарифа ни у одного заказа. NEED_POLICY. |
| `single_order_no_tariff` | 1 | 1 | Одна покупка без тарифа. NEED_POLICY. |
| **Итого** | **196** | **444** | |

#### Canonical order candidates (193 users с тарифом)

| Тариф (canonical) | access_days | Users | Earliest | Latest |
|---|---|---|---|---|
| Бизнес-леди | 270 | 98 | 2026-03-28 | 2026-03-28 |
| Главный бухгалтер | 180 | 66 | 2026-03-28 | 2026-03-28 |
| Бухгалтер | 90 | 29 | 2026-03-28 | 2026-03-28 |
| **Итого** | | **193** | | |

**canonical_order_selection_rule**: `max(access_days)` среди заказов с `tariff_id IS NOT NULL`, при равенстве — `max(created_at)`.

**Разделение source_snapshot_type и import_source**:

| Поле | Значение | Смысл |
|---|---|---|
| `source_snapshot_type` | `base_tariff_purchase` | Тип покупки (каноническая для основного entitlement) |
| `import_source` | `patch4_import` (batch_id = `PATCH4-20260328T230904Z`) | Откуда пришёл заказ |

`module_child_purchase` и `module_only_standalone` **не включаются** в READY_FOR_BACKFILL по ЦБ 2.0.

#### Upgrade policy (ЦБ 2.0)

- 5 users с `multi_order_diff_tariffs` — **не дубли**, а апгрейд (Бухгалтер → Главный бухгалтер → Бизнес-леди).
- Canonical = заказ с max `access_days`. Остальные `base` заказы: `leave_as_is`.
- 19 users с `multi_order_same_tariff` — canonical = любой (все с одинаковым тарифом). Дубли: `exclude_from_backfill`.

#### NEED_POLICY (ЦБ 2.0): 3 users без тарифа

3 пользователя не имеют ни одного заказа с `tariff_id`. Невозможно вычислить `access_days` → не включать в backfill до решения.

#### Мини-итог по ЦБ 2.0

| Вопрос | Ответ |
|---|---|
| Можно ли делать backfill? | **Да, для 193 из 196 users** |
| Что блокирует остальных? | 3 users без tariff_id → NEED_POLICY_DECISION |
| Ready users | **193** |
| В DUPLICATE_CLEANUP_REVIEW (блокирующие) | **0** |
| В NEED_POLICY | **3** |

---

### ЗАКРОЙ ГОД (156 users, 308 orders)

**Важно**: В orders нет `batch_id` — все 308 заказов имеют `batch_id = null`. Grouping key строится по дате.

#### Классификация по date-spread

| Классификация | Users | Orders | Avg orders | same_batch_same_tariff_same_amount | Описание |
|---|---|---|---|---|---|
| `single_order` | 64 | 64 | 1.0 | — | Одна сделка. READY. |
| `same_day_same_tariff_duplicates` | 72 | 177 | 2.5 | **true** (все) | Все заказы в один день, один тариф, одна сумма. Чистые техн. дубли. |
| `multi_different_periods` (>60d spread) | 20 | 67 | 3.4 | varies | Заказы в разные периоды. Нужен анализ. |
| **Итого** | **156** | **308** | | | |

#### Dry-run по same_day_same_tariff_duplicates (72 users)

| Показатель | Значение |
|---|---|
| Users | 72 |
| Total orders | 177 |
| Avg dups per user | 2.5 |
| Max dups per user | 3 |
| Tariff (все) | Стандартный |
| same_batch_same_tariff_same_amount | **true** (все группы) |
| С active subscription | 52 |
| С active entitlement | 0 |

**Вывод**: Все 72 группы — чистые технические дубли. Одинаковый тариф, одинаковый день, одинаковая сумма. Canonical = первый заказ по `created_at` (все равнозначны).

#### Grouping key для ЗАКРОЙ ГОД

- **Нет batch_id** → используется `profile_id + product_id + created_at::date`.
- Если `date_spread = 0` и `distinct_tariffs <= 1` → одна логическая покупка.
- Если `date_spread > 60 дней` → возможно разные периоды (2024 vs 2025).

#### 20 users с multi_different_periods

Средний разброс дат: 96 дней. Вероятно: покупка в октябре-ноябре 2025 + повторная/доп в марте 2026. Нужна ручная проверка, включаются в DUPLICATE_CLEANUP_REVIEW (блокирующие).

#### Canonical для active sub users (64 users)

| Показатель | Значение |
|---|---|
| Total users with active sub + no entitlement | 64 |
| Single order users | 1 |
| Multi-order users | 58 (нужен canonical selection) |
| Expiry range | 2026-03-31 – 2026-04-01 |

**canonical_order_selection_rule**: Для subscription products — `expires_at = subscription.access_end_at`. Canonical order не влияет на expires_at, т.к. берётся из подписки.

#### Мини-итог по ЗАКРОЙ ГОД

| Вопрос | Ответ |
|---|---|
| Можно ли делать backfill? | **Да частично**: 54 active sub users ready (expires_at из подписки) |
| Что блокирует? | 20 users с multi_different_periods → DUPLICATE_CLEANUP_REVIEW (блокирующие) |
| Ready users (active sub) | **54** |
| В DUPLICATE_CLEANUP_REVIEW (блокирующие) | **20** (multi_different_periods) |
| DO_NOT_BACKFILL | **72** (no_sub_no_entitlement, бывшие покупатели) |

---

### Подоходный налог ИП (10 users, 11 orders)

**Duplicate discovery completed: no duplicate pattern found.**

- 0 пользователей с 2+ сделками.
- Продукт не блокирует backfill по причине дублей.
- Остаётся в общем policy matrix (8 active sub без entitlement → sync_from_subscription).

---

### Остальные продукты (subscription-based gaps)

| Продукт | active_sub_no_ent | Expiry range | Already expired | Still active | Proposed |
|---|---|---|---|---|---|
| Gorbova Club | 7 | varies | 0 | 7 | sync_from_subscription |
| ЦБ 2 ступень | 26 | 2026-08-30 | 0 | 26 | sync_from_subscription |
| ЦБ 2.0: Учет у ИП | 59 | 2026-06-25 | 0 | 59 | sync_from_subscription |
| Бухгалтерия как бизнес | 2 | 2026-03-31 – 2026-05-01 | 0 | 2 | sync_from_subscription |
| Подоходный налог ИП | 8 | 2026-06-25 | 0 | 8 | sync_from_subscription |

Для subscription products дублей orders не анализируем — canonical expires_at = `subscription.access_end_at`.

---

## Duplicate cleanup policy matrix

| Продукт | Повторные допустимы? | Определение «одной покупки» | Лишний дубль | Нельзя удалять | Действие по дублям | canonical_order_selection_rule |
|---|---|---|---|---|---|---|
| ЦБ 2.0 | Да (разные тарифы = upgrade) | Заказ с max `access_days` (tariff IS NOT NULL) | Заказы с тем же тарифом + датой | Единственный заказ с тарифом, заказы без тарифа | exclude_from_backfill | max(access_days), при равенстве max(created_at) |
| ЗАКРОЙ ГОД | Да (разные периоды) | `profile_id + product_id + date`, дубли = same_day_same_tariff | Несколько paid orders в один день с одним тарифом | Первый заказ из группы | exclude_from_backfill | Для sub-products: expires_at = sub.access_end_at |
| Подоходный налог ИП | N/A (0 дублей) | Единственный order | — | — | leave_as_is | Единственный paid order |
| Gorbova Club | N/A (sub-based) | N/A | N/A | N/A | N/A | expires_at = sub.access_end_at |
| ЦБ 2 ступень | N/A (sub-based) | N/A | N/A | N/A | N/A | expires_at = sub.access_end_at |
| Бухгалтерия | N/A (sub-based) | N/A | N/A | N/A | N/A | expires_at = sub.access_end_at |

---

## v23.1.9A.3 — Root cause analysis

### Почему возникли gap'ы

| # | Причина | Масштаб | Тип |
|---|---|---|---|
| 1 | **Creation paths системно не покрывают все случаи matching entitlements** | 156 из 403 active subs без entitlement | **Системная**, продолжающаяся |
| 2 | Batch import `PATCH4` (ЦБ 2.0) создал orders без entitlements | 193 users | Исторический хвост |
| 3 | Subscriptions создавались массово (`unknown`, `bulk_grant`) без entitlements | часть из 330 + 68 subs | Исторический + продолжающийся |
| 4 | Исторические импорты смешали main purchases, module purchases и batch-дубли в orders_v2 | ЦБ 2.0, ЗАКРОЙ ГОД | Исторический |
| 5 | **product_code drift / legacy code mismatch** (ЦБ 2 ступень) | 8 entitlements по `cb_2_step` вместо `prd_0d01a2fdc477` | Исторический, legacy |

### ЦБ 2 ступень — product_code drift anomaly

| Показатель | Значение |
|---|---|
| Active subscriptions product_code | `prd_0d01a2fdc477` |
| Orphaned active entitlements product_code | `cb_2_step` |
| Кол-во orphaned entitlements | 8 |
| Matching subscription для них | 0 |

**Вывод**: legacy product_code `cb_2_step` использовался ранее для создания entitlements, но подписки идут по `prd_0d01a2fdc477`. Это отдельная проблема product_code drift, вынесена в root cause. Не блокирует backfill по текущему product_code.

### Это продолжающаяся проблема?

**ДА, частично.** Часть creation paths создаёт подписки без entitlements. 247 из 403 active subs уже имеют matching entitlements (т.е. для них путь работал), но для 156 — нет. Backfill без fix root cause может привести к повторному накоплению gap'ов.

### E2E pipeline proof

| Путь | Работает? | Доказательство |
|---|---|---|
| product purchase → subscription | ✅ Частично | Подписки создаются |
| product purchase → entitlement | ⚠️ **ЧАСТИЧНО** | 247 из 403 active subs имеют entitlements, 156 — нет |
| entitlement → training access | ✅ Read-path | `useTrainingModules` проверяет `userEntitlementProductIds.has(mod.product_id)` — код верный |
| club rule → telegram grant | ✅ | access_rules → telegram-grant-access работает |
| revoke/expiry path | ✅ | telegram-check-expired проверяет entitlements |

#### Creation paths, создающие gap (текущие, живые):

| Path | Subs created | Создаёт entitlements? |
|---|---|---|
| `unknown` | 330 | Не всегда (часть без entitlement) |
| `bulk_grant` | 68 | Не всегда |
| `preregistration_auto_charge` | 5 | Не всегда |

**Других живых creation paths помимо этих трёх не обнаружено.** `grant-access-for-order` (GAFO) теоретически создаёт entitlements, но используется не во всех flow.

### Policy matrix (с зависимостью от cleanup)

| Продукт | backfill_mode | expires_at rule | Зависит от cleanup? |
|---|---|---|---|
| Gorbova Club | sync_from_subscription | `sub.access_end_at` | Нет |
| ЦБ 2 ступень | sync_from_subscription | `sub.access_end_at` (= 2026-08-30) | Нет |
| ЦБ 2.0: Учет у ИП | sync_from_subscription | `sub.access_end_at` (= 2026-06-25) | Нет |
| Бухгалтерия как бизнес | sync_from_subscription | `sub.access_end_at` | Нет |
| Подоходный налог ИП | sync_from_subscription | `sub.access_end_at` (= 2026-06-25) | Нет |
| ЗАКРОЙ ГОД | sync_from_subscription | `sub.access_end_at` (= 2026-03-31/04-01) | **Да** (20 users multi_different_periods) |
| Ценный бухгалтер 2.0 | fixed_from_order | `order.created_at + tariff.access_days` | **Да** (canonical selection done for 193/196) |

---

## v23.1.9A.4 — 5 итоговых списков

### 1. READY_FOR_BACKFILL (user_id × product_id × canonical_order_id)

| Продукт | Users | Mode | expires_at source | Блокирующие зависимости |
|---|---|---|---|---|
| Gorbova Club | **7** | sync_from_subscription | sub.access_end_at | Нет |
| ЦБ 2 ступень | **26** | sync_from_subscription | 2026-08-30 | Нет |
| ЦБ 2.0: Учет у ИП | **59** | sync_from_subscription | 2026-06-25 | Нет |
| ЗАКРОЙ ГОД | **54** | sync_from_subscription | sub.access_end_at | Нет (sub-based, canonical order не нужен) |
| Бухгалтерия как бизнес | **2** | sync_from_subscription | sub.access_end_at | Нет |
| Ценный бухгалтер 2.0 | **193** | fixed_from_order | order.created_at + access_days | Canonical order определён |
| Подоходный налог ИП | **8** | sync_from_subscription | 2026-06-25 | Нет |
| **Итого** | **349** | | | |

**Для ЦБ 2.0**: в READY_FOR_BACKFILL включены ТОЛЬКО users, где canonical order выбран из `base_tariff_purchase` (заказ с `tariff_id IS NOT NULL`). `module_child_purchase` и `module_only_standalone` не включаются.

### 2. NEED_POLICY_DECISION (3 users)

| Продукт | Users | blocked_backfill_reason |
|---|---|---|
| Ценный бухгалтер 2.0 (без tariff_id) | **3** | `missing_tariff` — нет ни одного заказа с tariff_id, невозможно вычислить access_days |

### 3. DO_NOT_BACKFILL (~156 users)

| Продукт | Users | Причина |
|---|---|---|
| Gorbova Club (бывшие) | 56 | no_sub_no_entitlement, нет active subscription |
| ЦБ 2 ступень (бывшие) | 22 | no_sub_no_entitlement |
| ЗАКРОЙ ГОД (бывшие, no sub) | 72 | no_sub_no_entitlement (same_day_dups, нет active sub) |
| Бухгалтерия как бизнес (бывшие) | 1 | no_sub_no_entitlement |
| Подоходный налог ИП (бывшие) | 1 | no_sub_no_entitlement |
| Платная консультация | 3 | Нет привязанных тренингов |
| Подоходный налог с физлиц | 0 | Нет заказов |
| **Итого** | **~155** | |

### 4. DUPLICATE_CLEANUP_REVIEW

#### Блокирующие (мешают execute)

| Продукт | Users | problem_type | blocked_backfill_reason | Описание |
|---|---|---|---|---|
| ЗАКРОЙ ГОД | 20 | `multi_different_periods` | `ambiguous_canonical_order` | Заказы в разные периоды (avg spread 96d), нужна ручная классификация |
| ЦБ 2.0 | 3 | `missing_tariff` | `missing_tariff` | Нет ни одного заказа с tariff_id |
| **Итого блокирующих** | **23** | | | |

#### Classified duplicates (resolved, НЕ блокируют execute)

| Продукт | Users | problem_type | Статус |
|---|---|---|---|
| ЦБ 2.0 (same_tariff dups) | 19 | `batch_duplicate` | Canonical определён, НЕ блокирует |
| ЦБ 2.0 (diff_tariffs upgrade) | 5 | `possible_upgrade` | Canonical = max access_days, НЕ блокирует |
| ЦБ 2.0 (mixed tariff+no-tariff) | 67 | `mixed_base_and_module_purchases` | Canonical = best tariff order, НЕ блокирует |

### 5. CANONICAL_ORDER_CANDIDATES

#### Ценный бухгалтер 2.0 (193 canonical)

| Tariff (canonical) | access_days | Users | source_snapshot_type | import_source | duplicate_count (avg) | cleanup_action |
|---|---|---|---|---|---|---|
| Бизнес-леди | 270 | 98 | `base_tariff_purchase` | `patch4_import` | 1.6 | exclude_non_canonical |
| Главный бухгалтер | 180 | 66 | `base_tariff_purchase` | `patch4_import` | 2.1 | exclude_non_canonical |
| Бухгалтер | 90 | 29 | `base_tariff_purchase` | `patch4_import` | 1.3 | exclude_non_canonical |

**canonical_reason**: `max(access_days)` среди заказов с tariff_id, при равенстве `max(created_at)`.

#### Subscription products (Gorbova Club, ЦБ 2 ступень, ЗАКРОЙ ГОД, Бухгалтерия, ПН ИП, ЦБ 2.0 Учет у ИП)

| Продукт | Users | canonical_reason | source |
|---|---|---|---|
| Gorbova Club | 7 | sync_from_active_subscription | sub.access_end_at |
| ЦБ 2 ступень | 26 | sync_from_active_subscription | sub.access_end_at = 2026-08-30 |
| ЦБ 2.0: Учет у ИП | 59 | sync_from_active_subscription | sub.access_end_at = 2026-06-25 |
| ЗАКРОЙ ГОД | 54 | sync_from_active_subscription | sub.access_end_at |
| Бухгалтерия как бизнес | 2 | sync_from_active_subscription | sub.access_end_at |
| Подоходный налог ИП | 8 | sync_from_active_subscription | sub.access_end_at = 2026-06-25 |

---

## Дополнительные таблицы

### Table A: matching_active_subscriptions_without_matching_entitlement

Matching by: same `user_id + product_code`.

| Продукт | product_code | active_subs_without_ent |
|---|---|---|
| ЦБ 2.0: Учет у ИП | cb_module_ip | 59 |
| ЗАКРОЙ ГОД | course_close_year | 54 |
| ЦБ 2 ступень | prd_0d01a2fdc477 | 26 |
| Подоходный налог ИП | 1769009596189-398a | 8 |
| Gorbova Club | club | 7 |
| Бухгалтерия как бизнес | buh_business | 2 |
| **Итого** | | **156** |

### Table B: existing_active_entitlements_without_matching_active_subscription

| product_code | active_ents | ents_с_sub | ents_БЕЗ_sub | mismatch_type |
|---|---|---|---|---|
| club | 145 | 142 | **3** | `entitlement_without_subscription` |
| prd_0d01a2fdc477 | 63 | 63 | 0 | — |
| buh_business | 30 | 30 | 0 | — |
| course_close_year | 11 | 9 | **2** | `entitlement_without_subscription` |
| cb_2_step | 8 | 0 | **8** | `legacy_product_code_mismatch` |
| 1769009596189-398a | 1 | 1 | 0 | — |
| consultation | 1 | 0 | **1** | `manual_or_unknown_entitlement` |

Обратная рассинхронизация: **14 active entitlements** у пользователей без active subscription. Из них 8 по `cb_2_step` — legacy product_code mismatch (см. root cause #5).

**Обратный рассинхрон НЕ входит в scope v23.1.9B execute.**

### Table C: READY_FOR_BACKFILL — expected counts (предварительная оценка)

| Продукт | expected_insert_or_update_preview | expected_SKIP | Примечание |
|---|---|---|---|
| ЦБ 2.0: Учет у ИП | 59 | 0 | Предварительная оценка; финальное split INSERT/UPDATE — по результатам conflict_preview |
| ЗАКРОЙ ГОД | 54 | 0 | Предварительная оценка |
| ЦБ 2 ступень | 26 | 0 | Предварительная оценка |
| Подоходный налог ИП | 8 | 0 | Предварительная оценка |
| Gorbova Club | 7 | 0 | Предварительная оценка |
| Бухгалтерия как бизнес | 2 | 0 | Предварительная оценка |
| Ценный бухгалтер 2.0 | 193 | 0 | Предварительная оценка (order-based) |
| **Итого** | **349** | **0** | Точный split INSERT/UPDATE определяется conflict_preview |

---

## Сводный вывод по продуктам

| Продукт | Статус | Ready users | Blocked | Причина блокировки |
|---|---|---|---|---|
| Gorbova Club | **ready now** | 7 | 0 | — |
| ЦБ 2 ступень | **ready now** | 26 | 0 | — |
| ЦБ 2.0: Учет у ИП | **ready now** | 59 | 0 | — |
| Бухгалтерия как бизнес | **ready now** | 2 | 0 | — |
| Подоходный налог ИП | **ready now** | 8 | 0 | — |
| ЗАКРОЙ ГОД | **ready partially** | 54 (sub-based) | 20 (multi_different_periods) | ambiguous_canonical_order |
| Ценный бухгалтер 2.0 | **ready partially** | 193 (with tariff) | 3 (no tariff) | missing_tariff |

---

## STOP-guards для v23.1.9B

| Guard | Правило |
|---|---|
| `canonical_order_candidates` не утверждена → execute запрещён | Обязательно |
| `DUPLICATE_CLEANUP_REVIEW` (блокирующие) не утверждён → execute запрещён | Обязательно |
| По продукту не завершена классификация дублей → backfill запрещён | Для ЗАКРОЙ ГОД (20 users) |
| ROW_COUNT per product ≠ expected → STOP | Обязательно |
| Не трогать active entitlement с expires_at > computed | Обязательно |
| Не сокращать существующий expires_at | Обязательно |
| Upsert по `ON CONFLICT (user_id, product_code)` — единственный полный unique constraint | Обязательно |
| `product_id` и `order_id` заполнять обязательно при upsert | Обязательно |
| Pre-execute dry-run: проверить нет ли кейсов где `user_id + product_code` уже связан с другим `product_id` или `order_id` | Обязательно |
| `conflict_preview_on_unique_keys` должен быть утверждён до execute | Обязательно |
| Все записи: `meta.source = 'historical_backfill'`, `meta.source_patch = 'v23.1.9B'` | Обязательно |

### Upsert key — зафиксированные правила

Таблица `entitlements` имеет **3 unique constraint**:

| Constraint | Тип |
|---|---|
| `(user_id, product_code)` | **Основной**, всегда enforced |
| `(user_id, product_id) WHERE product_id IS NOT NULL` | Partial unique |
| `(order_id) WHERE order_id IS NOT NULL` | Partial unique |

**Практическое правило execute:**
- Основной `ON CONFLICT` = `(user_id, product_code)`
- `product_id` и `order_id` заполнять обязательно
- Перед execute отдельным dry-run проверить, нет ли кейсов, где один и тот же `user_id + product_code` уже связан с другим `product_id` или другим `order_id`

---

## Обязательный pre-execute deliverable: conflict_preview_on_unique_keys

Перед утверждением v23.1.9B необходимо собрать таблицу:

| user_id | product_code | existing_entitlement_id | existing_status | existing_expires_at | planned_action (insert / update / skip) |
|---|---|---|---|---|---|

Без этой таблицы v23.1.9B не запускать.

**Следующий шаг: v23.1.9A.1-final — execute preview / unique-key conflict preview, и только потом утверждать v23.1.9B.**

---

## Что НЕ выполнено в v23.1.9A

- ❌ Архивирование
- ❌ Удаление
- ❌ Merge
- ❌ Rewrite orders/subscriptions
- ❌ Entitlement backfill
- ❌ Изменение кода
- ❌ Изменение access_rules, grant-access-for-order, training read/write path

**Только**: discovery, classification, canonical selection.

---

## Последовательность патчей

| Патч | Scope | Статус |
|---|---|---|
| **v23.1.9A** | Discovery + classification + canonical selection | **ВЫПОЛНЕН** |
| **v23.1.9A.1-final** | Execute preview / unique-key conflict preview | **Следующий шаг** |
| **v23.1.9B** | Execute backfill только по утверждённому canonical_order_candidates + conflict_preview | Ожидает v23.1.9A.1-final |
| **v23.1.10** | Fix root cause — creation paths должны создавать entitlements | Планируется |

---

## Изменённые компоненты

| Компонент | Изменение |
|---|---|
| `.lovable/plan.md` | Полный discovery report + 10 правок |

Код и данные **НЕ менялись**.

---

## DoD

1. ✅ Формулировка исправлена: 156 из 403 active subs без matching entitlement (не "0 из 403")
2. ✅ Subscription-based gap (156) и order-based gap (193) разделены явно
3. ✅ Upsert key зафиксирован как `ON CONFLICT (user_id, product_code)` + обязательный pre-execute dry-run
4. ✅ `source_snapshot_type` (`base_tariff_purchase`) отделён от `import_source` (`patch4_import`)
5. ✅ DUPLICATE_CLEANUP_REVIEW разделён на блокирующие (23) и classified resolved (91)
6. ✅ ЦБ 2 ступень — product_code drift anomaly (`cb_2_step` vs `prd_0d01a2fdc477`) вынесена в root cause
7. ✅ Table B — добавлена колонка `mismatch_type`
8. ✅ Gorbova Club: gap = 7 (не 148), 3 обратных entitlement не трогаем в v23.1.9B
9. ✅ Table C — формулировка `expected_insert_or_update_preview` (предварительная оценка, не guarantee)
10. ✅ Добавлен обязательный deliverable `conflict_preview_on_unique_keys`
11. ✅ Headline исправлен: "creation paths системно не покрывают все случаи matching entitlements"
12. ✅ Следующий шаг = v23.1.9A.1-final (conflict preview), не сразу v23.1.9B execute
13. ✅ Gap counting ключ зафиксирован: matching by same `user_id + product_code`
14. ✅ Expected counts пересчитаны: 349 вместо 595
15. ✅ В v23.1.9A не выполнено ни одного write-действия
