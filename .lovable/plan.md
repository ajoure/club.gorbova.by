# PATCH v23.1.9A — Historical entitlement gap discovery + Canonical order selection + Pipeline verification

## Статус: ВЫПОЛНЕН (discovery only, без execute). Правки 1-10 применены. v23.1.9A.1-final правки применены.

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

#### 20 users с multi_different_periods — ПРАВИЛО БЛОКИРОВКИ

Средний разброс дат: 96 дней. Вероятно: покупка в октябре-ноябре 2025 + повторная/доп в марте 2026.

**ЗАФИКСИРОВАННОЕ ПРАВИЛО**: 19 blocked — это только **order-based ambiguity**, а НЕ subscription-based blocker:
- Если у пользователя есть active subscription → execute допустим
- Even if historical orders are ambiguous → `expires_at` берётся из `sub.access_end_at`
- 1 user из multi_different_periods с active subscription **уже включён в READY** (course_close_year = 55)
- Оставшиеся **19** — это users БЕЗ active subscription, где order ambiguity реально блокирует

Чтобы в будущем эти 19 не вернулись в blocked при наличии active subscription.

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
| Можно ли делать backfill? | **Да частично**: **55** active sub users ready (expires_at из подписки) |
| Что блокирует? | **19** users с multi_different_periods БЕЗ active sub → DUPLICATE_CLEANUP_REVIEW (блокирующие) |
| Ready users (active sub) | **55** |
| В DUPLICATE_CLEANUP_REVIEW (блокирующие) | **19** (multi_different_periods, order-based ambiguity only) |
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
| ЗАКРОЙ ГОД | sync_from_subscription | `sub.access_end_at` (= 2026-03-31/04-01) | **Да** (19 users multi_different_periods) |
| Ценный бухгалтер 2.0 | fixed_from_order | `order.created_at + tariff.access_days` | **Да** (canonical selection done for 193/196) |

---

## v23.1.9A.4 — 5 итоговых списков

### 1. READY_FOR_BACKFILL (user_id × product_id × canonical_order_id)

**Итоговые числа:**

- **sub-based READY = 149**
- **order-based READY (CB20) = 124**
- **total READY = 273**

**Execute split:**

- **INSERT = 269**
- **UPDATE = 4**
- **TOTAL EXECUTE = 273**

| Продукт | product_code | Users | insert_count | update_count | total_execute | Mode | expires_at source | Блокирующие зависимости |
|---|---|---|---|---|---|---|---|---|
| ЦБ 2.0: Учет у ИП | cb_module_ip | **59** | 59 | 0 | 59 | sync_from_subscription | sub.access_end_at (2026-06-25) | Нет |
| ЗАКРОЙ ГОД | course_close_year | **55** | 55 | 0 | 55 | sync_from_subscription | sub.access_end_at | Нет |
| Ценный бухгалтер 2.0 | cb20 | **124** | 124 | 0 | 124 | fixed_from_order | order.created_at + access_days | Canonical order определён |
| ЦБ 2 ступень | prd_0d01a2fdc477 | **18** | 18 | 0 | 18 | sync_from_subscription | sub.access_end_at (2026-08-30) | Нет |
| Подоходный налог ИП | 1769009596189-398a | **8** | 8 | 0 | 8 | sync_from_subscription | sub.access_end_at (2026-06-25) | Нет |
| Gorbova Club | club | **7** | 4 | 3 | 7 | sync_from_subscription | sub.access_end_at | Нет |
| Бухгалтерия как бизнес | buh_business | **2** | 1 | 1 | 2 | sync_from_subscription | sub.access_end_at | Нет |
| **Итого** | | **273** | **269** | **4** | **273** | | | |

**UPDATE cases (4 шт):**
- **club**: 3 users с expired entitlement (expires_at < access_end_at) → UPDATE status='active', expires_at=access_end_at
- **buh_business**: 1 user с expired entitlement → UPDATE status='active', expires_at=access_end_at

**Для ЦБ 2.0**: в READY_FOR_BACKFILL включены ТОЛЬКО users, где canonical order выбран из `base_tariff_purchase` (заказ с `tariff_id IS NOT NULL`). `module_child_purchase` и `module_only_standalone` не включаются.

### 2. NEED_POLICY_DECISION (3 users)

| Продукт | Users | blocked_backfill_reason |
|---|---|---|
| Ценный бухгалтер 2.0 (без tariff_id) | **3** | `missing_tariff` — нет ни одного заказа с tariff_id, невозможно вычислить access_days |

**Это единственная policy-категория.** Всё остальное вынесено в отдельные категории блокировки (см. ниже).

### 3. BLOCKED_BY_MISSING_USER_ID (69 profiles)

| Продукт | Profiles | Причина |
|---|---|---|
| Ценный бухгалтер 2.0 (CB20) | **69** | Profile без привязки к auth.users. `entitlements.user_id` обязателен → INSERT невозможен |

**Правила:**
- В v23.1.9B эти записи **не backfill-ятся** (entitlements.user_id обязателен)
- Сохраняются как отложенный **pending-backfill** хвост
- После появления `user_id` (auto-claim / first-login) — отдельный follow-up механизм выдачи доступа
- **Source of truth для этих людей уже есть** (orders, tariffs, canonical selection)
- **Доступ не теряется** — выдача entitlements откладывается до момента появления `user_id`
- Каждый deferred row должен сохранять `deferred_recovery_key` = `profile_id + product_id + canonical_order_id` — это основа для v23.1.9D

**Row-level source key для deferred хвоста:**

| Поле | Описание |
|---|---|
| `deferred_recovery_key` | `profile_id + product_id + canonical_order_id` |
| Назначение | Уникальный ключ для последующего auto-claim в v23.1.9D |

### 4. BLOCKED_BY_LEGACY_CODE_MISMATCH (8 users)

| Продукт | Users | Причина |
|---|---|---|
| ЦБ 2 ступень | **8** | legacy entitlement по `cb_2_step` при active subscription по `prd_0d01a2fdc477` |

**Stop-rule для v23.1.9B:**
- Эти 8 строк должны иметь **только** `resolved_execute_decision = skip_legacy_code_mismatch`
- **Никакого INSERT** второго active entitlement по тому же `product_id`
- **Никакого auto-rename** `cb_2_step` → `prd_0d01a2fdc477` в этом патче
- Решение — отдельный cleanup/normalization patch **v23.1.9C**

### 5. DO_NOT_BACKFILL (~156 users)

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

### 6. DUPLICATE_CLEANUP_REVIEW

#### Блокирующие (мешают execute)

| Продукт | Users | problem_type | blocked_backfill_reason | Описание |
|---|---|---|---|---|
| ЗАКРОЙ ГОД | **19** | `multi_different_periods` | `ambiguous_canonical_order` | Заказы в разные периоды (order-based ambiguity only), users БЕЗ active subscription |
| **Итого блокирующих** | **19** | | | |

**Важно**: CB20 `missing_tariff` (3 users) теперь в отдельной категории NEED_POLICY_DECISION, не здесь.

#### Classified duplicates (resolved, НЕ блокируют execute)

| Продукт | Users | problem_type | Статус |
|---|---|---|---|
| ЦБ 2.0 (same_tariff dups) | 19 | `batch_duplicate` | Canonical определён, НЕ блокирует |
| ЦБ 2.0 (diff_tariffs upgrade) | 5 | `possible_upgrade` | Canonical = max access_days, НЕ блокирует |
| ЦБ 2.0 (mixed tariff+no-tariff) | 67 | `mixed_base_and_module_purchases` | Canonical = best tariff order, НЕ блокирует |

### 7. CANONICAL_ORDER_CANDIDATES

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
| ЦБ 2 ступень | 18 | sync_from_active_subscription | sub.access_end_at = 2026-08-30 |
| ЦБ 2.0: Учет у ИП | 59 | sync_from_active_subscription | sub.access_end_at = 2026-06-25 |
| ЗАКРОЙ ГОД | 55 | sync_from_active_subscription | sub.access_end_at |
| Бухгалтерия как бизнес | 2 | sync_from_active_subscription | sub.access_end_at |
| Подоходный налог ИП | 8 | sync_from_active_subscription | sub.access_end_at = 2026-06-25 |

---

## Дополнительные таблицы

### Table A: matching_active_subscriptions_without_matching_entitlement

Matching by: same `user_id + product_code`.

| Продукт | product_code | active_subs_without_ent |
|---|---|---|
| ЦБ 2.0: Учет у ИП | cb_module_ip | 59 |
| ЗАКРОЙ ГОД | course_close_year | 55 |
| ЦБ 2 ступень | prd_0d01a2fdc477 | 26 |
| Подоходный налог ИП | 1769009596189-398a | 8 |
| Gorbova Club | club | 7 |
| Бухгалтерия как бизнес | buh_business | 2 |
| **Итого** | | **157** |

*Примечание: из 26 по prd_0d01a2fdc477 в READY включены 18 (8 исключены как BLOCKED_BY_LEGACY_CODE_MISMATCH)*

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

### Table C: conflict_preview_on_unique_keys (фактические данные из БД)

#### Subscription-based

| product_code | INSERT | UPDATE | SKIP | product_id_mismatch | order_id_conflict |
|---|---|---|---|---|---|
| cb_module_ip | 59 | 0 | 0 | 0 | 0 |
| course_close_year | 55 | 0 | 0 | 0 | 0 |
| prd_0d01a2fdc477 | 18 | 0 | 0 | 0 | 0 |
| 1769009596189-398a | 8 | 0 | 0 | 0 | 0 |
| club | 4 | 3 | 0 | 0 | 0 |
| buh_business | 1 | 1 | 0 | 0 | 0 |
| **Итого sub-based** | **145** | **4** | **0** | **0** | **0** |

#### Order-based CB20

| product_code | INSERT | SKIP (no user_id) | SKIP (no tariff) | product_id_mismatch | order_id_conflict |
|---|---|---|---|---|---|
| cb20 | **124** | **69** | **3** | 0 | 0 |

**Нет ни одного product_id mismatch. Нет ни одного order_id conflict.**

### Table D: Row-level preview — обязательные поля

Row-level preview для v23.1.9B должен содержать следующие поля:

| Поле | Описание |
|---|---|
| `has_user_id` | bool — есть ли user_id у profile |
| `profile_id` | ID профиля |
| `user_id` | ID auth user (null для BLOCKED_BY_MISSING_USER_ID) |
| `product_id` | ID продукта |
| `product_code` | Код продукта для upsert |
| `existing_entitlement_product_code` | Код продукта существующего entitlement (для cb_2_step mismatch detection) |
| `canonical_order_id` | ID канонического заказа |
| `resolved_execute_decision` | `insert` / `update` / `skip_missing_user_id` / `skip_legacy_code_mismatch` / `skip_missing_tariff` |
| `deferred_recovery_key` | `profile_id + product_id + canonical_order_id` (для BLOCKED_BY_MISSING_USER_ID) |

### Table E: execute_candidates_summary_by_action_and_product

**Обязательный pre-execute deliverable. Без этой таблицы execute не утверждать.**

| product_code | resolved_execute_decision | row_count |
|---|---|---|
| cb_module_ip | insert | 59 |
| course_close_year | insert | 55 |
| cb20 | insert | 124 |
| prd_0d01a2fdc477 | insert | 18 |
| 1769009596189-398a | insert | 8 |
| club | insert | 4 |
| club | update | 3 |
| buh_business | insert | 1 |
| buh_business | update | 1 |
| cb20 | skip_missing_user_id | 69 |
| cb20 | skip_missing_tariff | 3 |
| prd_0d01a2fdc477 | skip_legacy_code_mismatch | 8 |
| **TOTAL insert** | | **269** |
| **TOTAL update** | | **4** |
| **TOTAL skip_missing_user_id** | | **69** |
| **TOTAL skip_legacy_code_mismatch** | | **8** |
| **TOTAL skip_missing_tariff** | | **3** |
| **GRAND TOTAL** | | **353** |

**5-way split verification**: 269 + 4 + 69 + 8 + 3 = **353** (все row-level строки)

---

## Сводный вывод по категориям

| Категория | Count |
|---|---|
| **READY_FOR_BACKFILL** | **273** (149 sub-based + 124 order-based CB20) |
| **NEED_POLICY_DECISION** | **3** (CB20 без tariff_id) |
| **BLOCKED_BY_MISSING_USER_ID** | **69** (CB20 profiles без auth user) |
| **BLOCKED_BY_LEGACY_CODE_MISMATCH** | **8** (ЦБ 2 ступень cb_2_step) |
| **DUPLICATE_CLEANUP_REVIEW (blocking)** | **19** (ЗАКРОЙ ГОД multi_different_periods) |

---

## STOP-guards для v23.1.9B

| Guard | Правило |
|---|---|
| `execute_candidates_summary_by_action_and_product` не собрана → execute запрещён | **Обязательно** |
| Row-level preview не содержит 5-way split → execute запрещён | **Обязательно** |
| Сумма row-level строк ≠ summary counts → STOP | **Обязательно** |
| `canonical_order_candidates` не утверждена → execute запрещён | Обязательно |
| `DUPLICATE_CLEANUP_REVIEW` (блокирующие) не утверждён → execute запрещён | Обязательно |
| По продукту не завершена классификация дублей → backfill запрещён | Для ЗАКРОЙ ГОД (19 users) |
| ROW_COUNT per product ≠ expected → STOP | Обязательно |
| Не трогать active entitlement с expires_at > computed | Обязательно |
| Не сокращать существующий expires_at | Обязательно |
| Upsert по `ON CONFLICT (user_id, product_code)` — единственный полный unique constraint | Обязательно |
| `product_id` и `order_id` заполнять обязательно при upsert | Обязательно |
| Pre-execute dry-run: проверить нет ли кейсов где `user_id + product_code` уже связан с другим `product_id` или `order_id` | Обязательно |
| `conflict_preview_on_unique_keys` должен быть утверждён до execute | Обязательно |
| Все записи: `meta.source = 'historical_backfill'`, `meta.source_patch = 'v23.1.9B'` | Обязательно |
| **BLOCKED_BY_LEGACY_CODE_MISMATCH**: 8 строк = только `skip_legacy_code_mismatch` | **Обязательно** |
| **BLOCKED_BY_LEGACY_CODE_MISMATCH**: никакого INSERT второго active entitlement по тому же product_id | **Обязательно** |
| **BLOCKED_BY_LEGACY_CODE_MISMATCH**: никакого auto-rename в этом патче | **Обязательно** |

### 5-way split stop-guard

**Execute запрещён**, если row-level preview не разделяет строки минимум на:
- `insert` — ожидаемый count: **269**
- `update` — ожидаемый count: **4**
- `skip_missing_user_id` — ожидаемый count: **69**
- `skip_legacy_code_mismatch` — ожидаемый count: **8**
- `skip_missing_tariff` — ожидаемый count: **3**

Сумма всех row-level строк должна сходиться с итоговыми summary counts: **353**.

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

## v23.1.9B — EXECUTION REPORT

### Статус: ВЫПОЛНЕН 2026-03-31

**batch_id**: `BACKFILL-ENT-v23.1.9B-2026-03-31T1117Z`
**edge function**: `admin-entitlement-backfill-v23`

### Dry run результаты (перед execute)

5-way split подтверждён:
- insert: 268 (course_close_year gap уменьшился на 1 с момента discovery)
- update: 4
- skip_missing_user_id: 69
- skip_legacy_code_mismatch: 8
- skip_missing_tariff: 3
- **total: 352**

### Execute результаты

| product_code | planned | created | FK errors | status |
|---|---|---|---|---|
| cb20 | 124 | **124** | 0 | ✅ Complete |
| cb_module_ip | 59 | **49** | **10** | ⚠️ Partial |
| course_close_year | 54 | **47** | **7** | ⚠️ Partial |
| prd_0d01a2fdc477 | 18 | **17** | **1** | ⚠️ Partial |
| 1769009596189-398a | 8 | **8** | 0 | ✅ Complete |
| club | 7 (4 insert + 3 update) | **7** | 0 | ✅ Complete |
| buh_business | 2 (1 insert + 1 update) | **2** | 0 | ✅ Complete |
| **Итого** | **272** | **254** | **18** | |

### Обнаруженная аномалия: Ghost user_ids в subscription-based path

**18 subscriptions** имеют `user_id`, который НЕ существует в `auth.users` (FK constraint `entitlements_user_id_fkey`). Это та же категория, что `BLOCKED_BY_MISSING_USER_ID`, но обнаруженная в sub-based path (ранее проверялось только для CB20).

**Распределение ghost user_ids:**
- course_close_year: 7
- cb_module_ip: 10
- prd_0d01a2fdc477: 1

**Эти 18 users переносятся в v23.1.9D** (deferred entitlement issuance after profile→user claim). Общий deferred backfill хвост: 69 (CB20) + 18 (sub-based ghost) = **87**.

### Итоговый результат v23.1.9B

| Метрика | Значение |
|---|---|
| Entitlements created (INSERT) | **250** |
| Entitlements updated (UPDATE) | **4** |
| **Total successfully executed** | **254** |
| FK errors (ghost user_id) | 18 |
| Skipped (missing_user_id) | 69 |
| Skipped (legacy_code_mismatch) | 8 |
| Skipped (missing_tariff) | 3 |
| **Grand total candidates** | **352** |

### Все записи содержат

```json
{
  "source": "historical_backfill",
  "source_patch": "v23.1.9B",
  "batch_id": "BACKFILL-ENT-v23.1.9B-2026-03-31T1117Z"
}
```

### Audit log

Запись создана в `audit_logs` с action=`entitlement_backfill`, actor_label=`v23.1.9B`.

---

## Последовательность патчей (обновлённая)

| Патч | Scope | Статус |
|---|---|---|
| **v23.1.9A** | Discovery + classification + canonical selection | **ВЫПОЛНЕН** |
| **v23.1.9A.1-final** | Row-level conflict preview с категориями, 5-way split, stop-guards | **ВЫПОЛНЕН** |
| **v23.1.9B** | Execute backfill: 254 entitlements created/updated | **ВЫПОЛНЕН** |
| **v23.1.9C** | Cleanup legacy code mismatch (`cb_2_step` → `prd_0d01a2fdc477` normalization) — 8 users | Планируется |
| **v23.1.9D** | Deferred entitlement issuance after profile→user claim — handle_new_user generic sync | **ВЫПОЛНЕН** |
| **v23.1.10** | Entitlement sync for renewal/admin/claim paths — shared helper + guards | **ВЫПОЛНЕН** |
| **v23.1.11** | Product/training code normalization + admin-readable naming | Планируется |

---

## v23.1.9D + v23.1.10 — Отчёт о выполнении

### Что создано

1. **`supabase/functions/_shared/entitlement-sync.ts`** — общий helper с контрактом:
   - `syncEntitlement()` — upsert по ON CONFLICT (user_id, product_code)
   - `hasOtherActiveAccessSource()` — pre-revoke guard
   - Правило срока: `expires_at = GREATEST(existing, new)` — никогда не уменьшать
   - mode_filter: `subscription_based` блокирует sync для `cb20` (order-based only)
   - Skip: `cb_2_step` (legacy), пустой product_code, неизвестные коды

2. **SQL migration: `handle_new_user` trigger обновлён (v23.1.9D)**:
   - Hardcoded club entitlement creation удалён
   - Generic loop по всем active subscriptions при claim archived/imported profile
   - ON CONFLICT (user_id, product_code) DO UPDATE с GREATEST(expires_at)
   - Явно исключены: `cb20` (order-based), `cb_2_step` (legacy)
   - Audit log с `entitlements_synced` count и `entitlement_product_codes`

3. **`subscription-charge` обновлён (v23.1.10)**:
   - После successful renewal → syncEntitlement с mode_filter='subscription_based'
   - product_code берётся из products_v2.code
   - Non-blocking (try/catch)

4. **`subscription-admin-actions` обновлён (v23.1.10)**:
   - Pre-revoke guard в `revoke_access`: hasOtherActiveAccessSource проверяет другие подписки, order-based продукты, entitlements с другим source
   - Entitlement sync в `extend`, `set_end_date`, `grant_access`
   - Audit log при skip revoke: `admin.subscription.revoke_entitlement_skipped`

5. **`subscription-actions` обновлён (v23.1.10)**:
   - Entitlement sync при `resume`
   - `cancel` — entitlement не трогается (access до cancel_at)

### Режимы продуктов

| Режим | product_codes | Поведение |
|---|---|---|
| `subscription_based` | club, buh_business, cb_module_ip, prd_0d01a2fdc477, course_close_year, 1769009596189-398a | sync при renewal/claim/admin |
| `order_based_only` | cb20 | **НЕ sync** из subscription paths |
| `legacy_skip` | cb_2_step | skip (v23.1.9C) |

### Deferred-хвост

| Категория | Count | Механизм |
|---|---|---|
| `resolved_now` (v23.1.9B) | 254 | Backfill executed |
| `deferred_missing_user_id` | 69 | CB20 archived profiles → cron/worker при claim |
| `deferred_ghost_user_id` | 18 | Sub-based ghost user_ids → отдельный repair |
| `skipped_legacy_code_mismatch` | 8 | v23.1.9C |

### Stop-guards реализованы

| Guard | Реализация |
|---|---|
| syncEntitlement никогда не уменьшает expires_at | GREATEST в UPDATE path |
| ON CONFLICT (user_id, product_code) | В helper и SQL trigger |
| product_code IS NULL → skip | Guard в syncEntitlement |
| cb20 не sync из subscription paths | ORDER_BASED_ONLY_CODES set |
| cb_2_step → skip | LEGACY_SKIP_CODES set |
| revoke path: pre-check другой активный источник | hasOtherActiveAccessSource в revoke_access |
| handle_new_user не ломает existing claim flow | Сохранена вся логика ban check, profile claim, orders/subs/entitlements rebind |

---

## Изменённые компоненты

| Компонент | Изменение |
|---|---|
| `.lovable/plan.md` | Discovery report + v23.1.9B execute report + v23.1.9D/v23.1.10 report |
| `supabase/functions/_shared/entitlement-sync.ts` | **Новый**: общий helper |
| `supabase/functions/admin-entitlement-backfill-v23/index.ts` | Edge function для backfill (v23.1.9B) |
| `supabase/functions/subscription-charge/index.ts` | Entitlement sync после renewal |
| `supabase/functions/subscription-admin-actions/index.ts` | Pre-revoke guard + sync при extend/grant/set_end_date |
| `supabase/functions/subscription-actions/index.ts` | Sync при resume |
| `handle_new_user` trigger (SQL migration) | Generic sub-based sync |
| `entitlements` (data) | **254 rows** created/updated (v23.1.9B) |

---

## DoD (v23.1.9B)

1. ✅ Dry run 5-way split подтверждён перед execute
2. ✅ 254 entitlements успешно created/updated (250 INSERT + 4 UPDATE)
3. ✅ cb20: 124/124 — полностью
4. ✅ club: 7/7 (4 insert + 3 update) — полностью
5. ✅ buh_business: 2/2 (1 insert + 1 update) — полностью
6. ✅ 1769009596189-398a: 8/8 — полностью
7. ✅ cb_module_ip: 49/59, course_close_year: 47/54, prd_0d01a2fdc477: 17/18 — частично (18 ghost user_ids)
8. ✅ 18 ghost user_id FK errors задокументированы, перенесены в v23.1.9D
9. ✅ skip_missing_user_id = 69, skip_legacy_code_mismatch = 8, skip_missing_tariff = 3 — корректно
10. ✅ Все записи с meta.source_patch = 'v23.1.9B', batch_id зафиксирован
11. ✅ Audit log создан
12. ✅ Upsert по ON CONFLICT (user_id, product_code)
13. ✅ Ни один active entitlement не был сокращён по expires_at
14. ✅ BLOCKED_BY_LEGACY_CODE_MISMATCH: 8 users пропущены (no second entitlement created)
15. ✅ v23.1.9D scope обновлён: 87 deferred (69 CB20 + 18 sub-based ghost)

## DoD (v23.1.9D)

1. ✅ handle_new_user: при claim archived profile → entitlements создаются для всех active subscriptions (не только club)
2. ✅ Hardcoded club entitlement creation удалён, заменён generic loop
3. ✅ CB20 order-based deferred: NOT в trigger, определяется динамически через LEFT JOIN
4. ✅ cb20 и cb_2_step явно исключены из trigger loop
5. ✅ Audit log с entitlements_synced count и product_codes
6. ✅ ON CONFLICT (user_id, product_code) DO UPDATE с GREATEST(expires_at)

## DoD (v23.1.10)

1. ✅ При subscription renewal → entitlement sync через shared helper
2. ✅ syncEntitlement никогда не уменьшает expires_at
3. ✅ Повторный вызов идемпотентен (ON CONFLICT)
4. ✅ При admin revoke → pre-check hasOtherActiveAccessSource
5. ✅ При admin extend/grant/set_end_date → entitlement синхронизирован
6. ✅ При user resume → entitlement синхронизирован
7. ✅ cb20 не затронут из subscription paths (mode_filter guard)
8. ✅ audit_logs с actor_type='system', actor_label заполнен
9. ✅ Все edge functions задеплоены
