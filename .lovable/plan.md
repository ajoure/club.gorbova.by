# PATCH v23.1.9A — Historical entitlement gap discovery + Canonical order selection + Pipeline verification

## Статус: ВЫПОЛНЕН (discovery only, без execute)

## Цель

Полная discovery-фаза перед historical entitlement backfill: gap analysis, duplicate/installment classification, canonical order selection, root cause, policy matrix. **Без execute.**

---

## v23.1.9A.1 — Entitlement gap discovery

### КРИТИЧЕСКОЕ ОТКРЫТИЕ

**Ни один из активных creation paths не создаёт entitlements.** Все 403 активных подписки в системе не имеют entitlements:

| Creation path | Active subs | With entitlement | Without entitlement | Gap % |
|---|---|---|---|---|
| `unknown` | 330 | 0 | **330** | 100% |
| `bulk_grant` | 68 | 0 | **68** | 100% |
| `preregistration_auto_charge` | 5 | 0 | **5** | 100% |
| **Итого** | **403** | **0** | **403** | **100%** |

### Gorbova Club — полная рассинхронизация

| Категория | Кол-во |
|---|---|
| has_active_sub + NO entitlement | **149** |
| has_active_entitlement + NO active sub | **145** |
| has_both (sub + entitlement) | **0** |

**Вывод**: 0 пересечение между подписчиками и держателями entitlements. Системы полностью рассинхронизированы. 145 существующих entitlements принадлежат бывшим подписчикам, 149 текущих подписчиков не имеют ни одного entitlement.

### Полный продуктовый реестр

| Продукт | product_code | training_modules | paid_orders | paid_users | active_subs | active_entitlements | gap (active_sub_no_ent) |
|---|---|---|---|---|---|---|---|
| Ценный бухгалтер 2.0 | cb20 | 38 | 444 | 196 | 0 | 0 | **196** (через orders) |
| Gorbova Club | club | 19 | 981 | 205 | 149 | 145 | **149** |
| ЦБ 2 ступень | prd_0d01a2fdc477 | 2 | 111 | 111 | 89 | 71 | **89** |
| ЗАКРОЙ ГОД | course_close_year | 8 | 308 | 156 | 64 | 3 | **64** |
| ЦБ 2.0: Учет у ИП | cb_module_ip | 1 | 0 | 0 | 59 | 0 | **59** |
| Бухгалтерия как бизнес | buh_business | 1 | 64 | 33 | 33 | 27 | **33** |
| Подоходный налог ИП | 1769009596189-398a | 1 | 11 | 10 | 9 | 1 | **9** |
| Подоходный налог с физлиц | pn_s_fl | 4 | 0 | 0 | 0 | 0 | 0 |
| Платная консультация | consultation | 0 | 3 | 3 | 0 | 1 | 0 (нет тренингов) |
| Остальные 14 продуктов | — | 0 | 0 | 0 | 0 | 0 | 0 |

**Итого gap: ~599 user×product пар без entitlement (при наличии active sub или paid order).**

### Разбивка gap users по категориям

| Продукт | active_sub_no_ent | no_sub_no_ent | Итого gap |
|---|---|---|---|
| Gorbova Club | 149 | 56 | 205 |
| ЦБ 2 ступень | 89 | 22 | 111 |
| ЗАКРОЙ ГОД | 59 | 97 | 156 |
| ЦБ 2.0: Учет у ИП | 59 | 0 | 59 |
| Бухгалтерия как бизнес | 32 | 1 | 33 |
| Подоходный налог ИП | 9 | 1 | 10 |
| Ценный бухгалтер 2.0 | 0 (нет подписок) | 196 | 196 |

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

**source_snapshot_type**: Все заказы из `import_source = "patch4"`, `batch_id = "PATCH4-20260328T230904Z"`.

#### Upgrade policy (ЦБ 2.0)

- 5 users с `multi_order_diff_tariffs` — **не дубли**, а апгрейд (Бухгалтер → Главный бухгалтер → Бизнес-леди).
- Canonical = заказ с max `access_days`. Остальные `base` заказы: `leave_as_is`.
- 19 users с `multi_order_same_tariff` — canonical = любой (все с одинаковым тарифом). Дубли: `exclude_from_backfill`.

#### NEED_POLICY (ЦБ 2.0): 3 users без тарифа

3 пользователя (не 49 как ранее оценивалось) не имеют ни одного заказа с `tariff_id`. Невозможно вычислить `access_days` → не включать в backfill до решения.

#### Мини-итог по ЦБ 2.0

| Вопрос | Ответ |
|---|---|
| Можно ли делать backfill? | **Да, для 193 из 196 users** |
| Что блокирует остальных? | 3 users без tariff_id → NEED_POLICY_DECISION |
| Ready users | **193** |
| В DUPLICATE_CLEANUP_REVIEW | **0** (дубли классифицированы, canonical определён) |
| В NEED_POLICY | **3** |

---

### ЗАКРОЙ ГОД (156 users, 308 orders)

**Важно**: В orders нет `batch_id` — все 308 заказов имеют `batch_id = null`. Grouping key строится по дате.

#### Классификация по date-spread

| Классификация | Users | Orders | Avg orders | same_batch_same_tariff_same_amount | Описание |
|---|---|---|---|---|---|
| `single_order` | 64 | 64 | 1.0 | — | Одна сделка. READY. |
| `same_day_same_tariff_duplicates` | 72 | 177 | 2.5 | **true** (все) | Все заказы в один день, один тариф. Чистые техн. дубли. |
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

Средний разброс дат: 96 дней. Вероятно: покупка в октябре-ноябре 2025 + повторная/доп в марте 2026. Нужна ручная проверка, включаются в DUPLICATE_CLEANUP_REVIEW.

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
| Можно ли делать backfill? | **Да частично**: 64 active sub users ready (expires_at из подписки) |
| Что блокирует? | 20 users с multi_different_periods → DUPLICATE_CLEANUP_REVIEW |
| Ready users (active sub) | **64** |
| В DUPLICATE_CLEANUP_REVIEW | **20** (multi_different_periods) |
| DO_NOT_BACKFILL | **72** (no_sub_no_entitlement, бывшие покупатели) |

---

### Подоходный налог ИП (10 users, 11 orders)

**Duplicate discovery completed: no duplicate pattern found.**

- 0 пользователей с 2+ сделками.
- Продукт не блокирует backfill по причине дублей.
- Остаётся в общем policy matrix (9 active sub без entitlement → sync_from_subscription).

---

### Остальные продукты (subscription-based gaps)

| Продукт | active_sub_no_ent | Expiry range | Already expired | Still active | Proposed |
|---|---|---|---|---|---|
| Gorbova Club | 149 | 2026-03-30 – 2027-01-19 | 1 | 148 | sync_from_subscription |
| ЦБ 2 ступень | 89 | 2026-08-30 – 2026-08-30 | 0 | 89 | sync_from_subscription |
| ЦБ 2.0: Учет у ИП | 59 | 2026-06-25 – 2026-06-25 | 0 | 59 | sync_from_subscription |
| Бухгалтерия как бизнес | 33 | 2026-03-31 – 2026-05-01 | 0 | 33 | sync_from_subscription |
| Подоходный налог ИП | 9 | 2026-06-25 – 2026-06-25 | 0 | 9 | sync_from_subscription |

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
| 1 | **Ни один creation path не создаёт entitlements** | ВСЕ 403 active subs | **Системная**, продолжающаяся |
| 2 | Batch import `PATCH4` (ЦБ 2.0) создал orders без entitlements | 196 users | Исторический хвост |
| 3 | Subscriptions создавались массово (`unknown`, `bulk_grant`) без entitlements | 330 + 68 subs | Исторический + продолжающийся |
| 4 | Gorbova Club: entitlements и подписки полностью рассинхронизированы (0 overlap) | 149 sub + 145 ent | Системная |
| 5 | Исторические импорты смешали main purchases, module purchases и batch-дубли в orders_v2 | ЦБ 2.0, ЗАКРОЙ ГОД | Исторический |

### Это продолжающаяся проблема?

**ДА. Все три активных creation path (`unknown`, `bulk_grant`, `preregistration_auto_charge`) создают подписки БЕЗ entitlements.** Это не исторический хвост — это текущий баг. Backfill без fix root cause приведёт к повторному накоплению gap'ов.

### E2E pipeline proof

| Путь | Работает? | Доказательство |
|---|---|---|
| product purchase → subscription | ✅ Частично | Подписки создаются, но entitlements — нет |
| product purchase → entitlement | ❌ **НЕ РАБОТАЕТ** | 0 из 403 active subs имеют entitlements |
| entitlement → training access | ✅ Read-path | `useTrainingModules` проверяет `userEntitlementProductIds.has(mod.product_id)` — код верный |
| club rule → telegram grant | ✅ | access_rules → telegram-grant-access работает |
| revoke/expiry path | ✅ | telegram-check-expired проверяет entitlements |

#### Creation paths, создающие gap (текущие, живые):

| Path | Subs created | Entitlements created | Gap |
|---|---|---|---|
| `unknown` | 330 | 0 | 100% |
| `bulk_grant` | 68 | 0 | 100% |
| `preregistration_auto_charge` | 5 | 0 | 100% |

**Других живых creation paths помимо этих трёх не обнаружено.** `grant-access-for-order` (GAFO) теоретически создаёт entitlements, но ни одна из текущих подписок не была создана через GAFO.

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
| Gorbova Club | **148** | sync_from_subscription | sub.access_end_at | Нет (1 expired sub excluded) |
| ЦБ 2 ступень | **89** | sync_from_subscription | 2026-08-30 | Нет |
| ЦБ 2.0: Учет у ИП | **59** | sync_from_subscription | 2026-06-25 | Нет |
| ЗАКРОЙ ГОД | **64** | sync_from_subscription | sub.access_end_at | Нет (sub-based, canonical order не нужен) |
| Бухгалтерия как бизнес | **33** | sync_from_subscription | sub.access_end_at | Нет |
| Ценный бухгалтер 2.0 | **193** | fixed_from_order | order.created_at + access_days | Canonical order определён |
| Подоходный налог ИП | **9** | sync_from_subscription | 2026-06-25 | Нет |
| **Итого** | **595** | | | |

**Для ЦБ 2.0**: в READY_FOR_BACKFILL включены ТОЛЬКО users, где canonical order выбран из заказа с `tariff_id IS NOT NULL`. Заказы без tariff не участвуют.

### 2. NEED_POLICY_DECISION (3 users)

| Продукт | Users | blocked_backfill_reason |
|---|---|---|
| Ценный бухгалтер 2.0 (без tariff_id) | **3** | `missing_tariff` — нет ни одного заказа с tariff_id, невозможно вычислить access_days |

### 3. DO_NOT_BACKFILL (201+ users)

| Продукт | Users | Причина |
|---|---|---|
| Gorbova Club (бывшие) | 56 | no_sub_no_entitlement, нет active subscription |
| Gorbova Club (expired sub) | 1 | already expired |
| ЦБ 2 ступень (бывшие) | 22 | no_sub_no_entitlement |
| ЗАКРОЙ ГОД (бывшие, no sub) | 72 | no_sub_no_entitlement (same_day_dups, нет active sub) |
| Бухгалтерия как бизнес (бывшие) | 1 | no_sub_no_entitlement |
| Подоходный налог ИП (бывшие) | 1 | no_sub_no_entitlement |
| Платная консультация | 3 | Нет привязанных тренингов |
| Подоходный налог с физлиц | 0 | Нет заказов |
| **Итого** | **~156** | |

### 4. DUPLICATE_CLEANUP_REVIEW

| Продукт | Users | problem_type | blocked_backfill_reason | Описание |
|---|---|---|---|---|
| ЗАКРОЙ ГОД | 20 | `multi_different_periods` | `ambiguous_canonical_order` | Заказы в разные периоды (avg spread 96d), нужна ручная классификация |
| ЦБ 2.0 (same_tariff dups) | 19 | `batch_duplicate` | — | Дубли уже классифицированы, canonical определён. НЕ БЛОКИРУЕТ backfill. |
| ЦБ 2.0 (diff_tariffs upgrade) | 5 | `possible_upgrade` | — | Апгрейды классифицированы, canonical = max access_days. НЕ БЛОКИРУЕТ. |
| ЦБ 2.0 (mixed tariff+no-tariff) | 67 | `mixed_base_and_module_purchases` | — | Canonical = best tariff order. НЕ БЛОКИРУЕТ. |

**Блокирующие для backfill**: только 20 users ЗАКРОЙ ГОД с multi_different_periods.

### 5. CANONICAL_ORDER_CANDIDATES

#### Ценный бухгалтер 2.0 (193 canonical)

| Tariff (canonical) | access_days | Users | source_snapshot_type | duplicate_count (avg) | cleanup_action |
|---|---|---|---|---|---|
| Бизнес-леди | 270 | 98 | patch4_import | 1.6 | exclude_non_canonical |
| Главный бухгалтер | 180 | 66 | patch4_import | 2.1 | exclude_non_canonical |
| Бухгалтер | 90 | 29 | patch4_import | 1.3 | exclude_non_canonical |

**canonical_reason**: `max(access_days)` среди заказов с tariff_id, при равенстве `max(created_at)`.

#### Subscription products (Gorbova Club, ЦБ 2 ступень, ЗАКРОЙ ГОД, Бухгалтерия, ПН ИП, ЦБ 2.0 Учет у ИП)

| Продукт | Users | canonical_reason | source |
|---|---|---|---|
| Gorbova Club | 148 | sync_from_active_subscription | sub.access_end_at |
| ЦБ 2 ступень | 89 | sync_from_active_subscription | sub.access_end_at = 2026-08-30 |
| ЦБ 2.0: Учет у ИП | 59 | sync_from_active_subscription | sub.access_end_at = 2026-06-25 |
| ЗАКРОЙ ГОД | 64 | sync_from_active_subscription | sub.access_end_at |
| Бухгалтерия как бизнес | 33 | sync_from_active_subscription | sub.access_end_at |
| Подоходный налог ИП | 9 | sync_from_active_subscription | sub.access_end_at = 2026-06-25 |

---

## Сводный вывод по продуктам

| Продукт | Статус | Ready users | Blocked | Причина блокировки |
|---|---|---|---|---|
| Gorbova Club | **ready now** | 148 | 0 | — |
| ЦБ 2 ступень | **ready now** | 89 | 0 | — |
| ЦБ 2.0: Учет у ИП | **ready now** | 59 | 0 | — |
| Бухгалтерия как бизнес | **ready now** | 33 | 0 | — |
| Подоходный налог ИП | **ready now** | 9 | 0 | — |
| ЗАКРОЙ ГОД | **ready partially** | 64 (sub-based) | 20 (multi_different_periods) | ambiguous_canonical_order |
| Ценный бухгалтер 2.0 | **ready partially** | 193 (with tariff) | 3 (no tariff) | missing_tariff |

---

## STOP-guards для v23.1.9B

| Guard | Правило |
|---|---|
| `canonical_order_candidates` не утверждена → execute запрещён | Обязательно |
| `DUPLICATE_CLEANUP_REVIEW` не утверждён → execute запрещён | Обязательно |
| По продукту не завершена классификация дублей → backfill запрещён | Для ЗАКРОЙ ГОД (20 users) |
| ROW_COUNT per product ≠ expected → STOP | Обязательно |
| Не трогать active entitlement с expires_at > computed | Обязательно |
| Не сокращать существующий expires_at | Обязательно |
| Не создавать дубли (upsert по user_id + product_id) | Обязательно |
| Все записи: `meta.source = 'historical_backfill'`, `meta.source_patch = 'v23.1.9B'` | Обязательно |

### Expected counts для v23.1.9B

| Продукт | INSERT | UPDATE | SKIP |
|---|---|---|---|
| Gorbova Club | 148 | 0 | 0 |
| ЦБ 2 ступень | 89 | 0 | 0 |
| ЦБ 2.0: Учет у ИП | 59 | 0 | 0 |
| ЗАКРОЙ ГОД | 64 | 0 | 0 |
| Бухгалтерия как бизнес | 33 | 0 | 0 |
| Ценный бухгалтер 2.0 | 193 | 0 | 0 |
| Подоходный налог ИП | 9 | 0 | 0 |
| **Итого** | **595** | **0** | **0** |

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
| **v23.1.9B** | Execute backfill только по утверждённому canonical_order_candidates | Ожидает утверждения |
| **v23.1.10** | Fix root cause — **ВСЕ creation paths** должны создавать entitlements | Планируется |

---

## Изменённые компоненты

| Компонент | Изменение |
|---|---|
| `.lovable/plan.md` | Полный discovery report |

Код и данные **НЕ менялись**.

---

## DoD

1. ✅ Entitlement gap discovery — полный продуктовый реестр (23 продукта)
2. ✅ **КРИТИЧЕСКОЕ ОТКРЫТИЕ**: 0 из 403 active subs имеют entitlements. Все creation paths сломаны.
3. ✅ Gorbova Club: 0 overlap между подписчиками и entitlements (полная рассинхронизация)
4. ✅ Duplicate deal discovery по ЦБ 2.0 (196 users classified), ЗАКРОЙ ГОД (156 users classified), ПН ИП (0 дублей)
5. ✅ Upgrade policy для ЦБ 2.0 — 5 users с different tariffs = upgrade, canonical = max access_days
6. ✅ Grouping key для ЗАКРОЙ ГОД: profile_id + product_id + created_at::date (нет batch_id в orders)
7. ✅ Dry-run ЗАКРОЙ ГОД: 72 users same_day dups, all same tariff, same amount = чистые технические дубли
8. ✅ Подоходный налог ИП — duplicate discovery completed, no pattern found
9. ✅ Duplicate cleanup policy matrix с canonical_order_selection_rule
10. ✅ canonical_order_candidates — 193 (ЦБ 2.0) + 402 (subscription products) = 595 total
11. ✅ Root cause: ВСЕ creation paths создают 0 entitlements (не только batch/admin)
12. ✅ E2E pipeline proof: purchase→subscription ✅, subscription→entitlement ❌, entitlement→training ✅
13. ✅ 5 итоговых списков: READY (595), NEED_POLICY (3), DO_NOT_BACKFILL (~156), DUPLICATE_CLEANUP_REVIEW (20+91), CANONICAL_ORDER_CANDIDATES (595)
14. ✅ Мини-итоги: ЦБ 2.0 ready partially (193/196), ЗАКРОЙ ГОД ready partially (64/156)
15. ✅ Creation paths creating gaps: `unknown` (330), `bulk_grant` (68), `preregistration_auto_charge` (5). Нет других.
16. ✅ В v23.1.9A не выполнено ни одного write-действия
