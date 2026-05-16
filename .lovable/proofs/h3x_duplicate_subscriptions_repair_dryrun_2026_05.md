# H3.x-b — Duplicate Subscriptions Repair Dry-Run (read-only)

**Дата:** 2026-05-16
**Режим:** read-only dry-run. **Никакого execute, cancel provider, grant, telegram, DML, миграций, secrets.**
**`BEPAID_REBILL_MATERIALIZATION`:** `dry_run` (не менялся).
**`mode=on`:** не включался.

---

## 0. Терминологическое разделение

| Термин | Что это | Используется в H3.x-b-execute? |
|---|---|---|
| `grant-access-for-order` | Canonical writer для **выдачи доступа при оплате** (orders_v2 → subscriptions_v2 / entitlements / telegram-grant). Идемпотентный, не делает supersede и не отменяет provider. | **НЕТ.** |
| `H3.x-b-execute` (будущий план) | Отдельный approved **repair flow** для duplicate subscriptions: provider read-pull → optional bePaid cancel → local supersede → order linkage rebind → entitlement merge → audit `repair.h3xb.*`. | **ДА.** |

В этом dry-run и в будущем execute `grant-access-for-order` **не вызывается ни прямо, ни косвенно**.

---

## 1. Schema-проверка (фактическая)

### `orders_v2`
Доступные linkage-поля для привязки order ↔ subscription_v2:
- `subscription_v2_id` — **field_missing** (колонки нет);
- `origin_subscription_id` — **field_missing**;
- `extended_by_order_id` / `extended_by_orders` — **field_missing** на orders_v2 (механизм существует, но хранится на **`subscriptions_v2.meta.extended_by_orders` jsonb-массив**);
- `bepaid_subscription_id` — **есть** (text);
- `meta.subscription_v2_id` — структурно допустим в jsonb (по факту на текущих 3 парах **не заполнен**, см. §3);
- `meta.tracking_id` формата `subv2:<sub_id>:order:<order_id>` — присутствует на провайдер-sub'ах (фиксируется на `subscriptions_v2.meta`, не на orders_v2.meta).

**Вывод:** прямого FK orders → sub в схеме нет. Привязка восстанавливается через:
1. `subscriptions_v2.meta.initial_order_id`;
2. `subscriptions_v2.meta.extended_by_orders[]`;
3. `subscriptions_v2.meta.checkout_order_id` (для provider_managed);
4. `bepaid_subscription_id` на order ↔ `provider_subscriptions.provider_subscription_id` ↔ `subscription_v2_id`.

В planned action **rebind пишется только в эти места**, в `orders_v2` колонок для рерайта нет — операция консолидации сводится к обновлению `subscriptions_v2.meta.extended_by_orders` на canonical + audit.

### `entitlements`
- `order_id` — есть;
- `source_order_id` — **field_missing**;
- `subscription_v2_id` — **field_missing**;
- `meta.source_subscription_v2_id` — структурно допустим (по факту на 3 парах **пусто**, см. §3);
- `meta.tariff_id` — есть и заполнен.

### `provider_subscriptions`
Подтверждены: `subscription_v2_id`, `state`, `provider_subscription_id` (это и есть «external_subscription_id»), `next_charge_at`, `last_charge_at`, `meta`.

### Telegram
Существуют: `telegram_access`, `telegram_club_members`, `telegram_access_queue`, `telegram_access_grants`, `telegram_manual_access`, `telegram_access_audit`.
Поле срока: `telegram_access.active_until` — **есть**. На всех 3 пользователях `active_until = NULL` (бессрочная отметка active в чате/канале) — пересчёт срока **не требуется** и не планируется. Telegram impact = `not_applicable_no_active_until_for_users`.

### `installment_payments`
По всем 5 order_id duplicate-пар: `count = 0`.

### `access_rules`
Колонок `subscription_v2_id`, `meta`, `mode` нет. Привязка к конкретной subscription_v2 невозможна. STOP-guard «access_rules ссылается на duplicate sub» **n/a структурно**.

---

## 2. Идентификация 3 пар

Продукт: `11c9f1b8-0355-4753-bd74-40b42aa53616` (Gorbova Club; запись в `products` скрыта от read-роли RLS, имя восстановлено из `subscriptions_v2.meta.product_name`).
Тариф: `7c748940-dcad-4c7c-a92e-76a2344622d3` — **BUSINESS — Месячная подписка**, 30 дней, 250 BYN/мес.

| pair_id | Пользователь | Email | sub_A (раньше) | sub_B (позже) |
|---|---|---|---|---|
| P1 | Елена Гудвилович | alena.gudvilovich@bk.ru | `ac57a221-2ac2-4faf-8ccb-aab7f45c5f8a` (MIT, 2026-05-13 16:21) | `1a2352ab-0b12-4420-be70-af740f733fbf` (provider_managed, 2026-05-16 06:00:47) |
| P2 | Татьяна Сумаревич | tatsiana.sergeevna@gmail.com | `bc5e6759-eecf-4548-b4cc-3603efdaa1b5` (MIT, 2026-05-14 17:54) | `240f45e7-0097-4045-b32e-a17062d8e731` (provider_managed, 2026-05-16 06:00:34) |
| P3 | Юлия Рабчевская | rabchevskaya.buh@gmail.com | `4469a81d-2967-45a5-a7cc-4af9461b6e5e` (provider_managed, 2026-05-16 07:54:55) | `f7fda1d7-b5a0-4ea2-aaa0-3d61a5e7301e` (MIT, 2026-05-16 07:57:06) |

---

## 3. Snapshot

### P1 — Елена Гудвилович / Gorbova Club / BUSINESS

| field | sub_A `ac57a221…` | sub_B `1a2352ab…` |
|---|---|---|
| billing_type | mit | provider_managed |
| status / auto_renew | active / true | active / true |
| access_start_at | 2026-04-17 13:30:29Z | 2026-05-16 06:00:47Z |
| access_end_at | **2026-06-17 12:00:00Z** | 2026-06-15 20:59:59Z |
| next_charge_at | 2026-06-17 12:00:00Z | 2026-06-15 20:59:59Z |
| provider state | — (нет записи) | `active`, `sbs_6b0372d78b97a5f0`, next_charge 2026-06-15 13:00:31Z |
| meta.initial_order_id | `d8b4e214…` (rebill_materialization 2026-04-17) | — |
| meta.extended_by_orders | `[0d192cc8…]` (renewal_subscription 2026-05-16 06:00:47, paid 250) | — |
| meta.checkout_order_id | — | `0d192cc8…` (тот же order!) |
| paid orders по тарифу через эту sub | 2 (d8b4e214, 0d192cc8) | 1 (0d192cc8) — пересечение |
| entitlement | `2452715d…`, expires 2026-06-17, order_id=`0d192cc8…`, meta.tariff_id ok, meta.source_subscription_v2_id пусто | — |

**Ключевой факт P1:** order `0d192cc8…` одновременно фигурирует и как `extended_by_orders` на sub_A (MIT), и как `checkout_order_id` на sub_B (provider). Это конкретный отпечаток бага B-2 / B-1 из H4.

### P2 — Татьяна Сумаревич / Gorbova Club / BUSINESS

| field | sub_A `bc5e6759…` | sub_B `240f45e7…` |
|---|---|---|
| billing_type | mit | provider_managed |
| access_start_at | 2026-04-19 03:01:08Z | 2026-05-16 06:00:34Z |
| access_end_at | **2026-06-19 12:00:00Z** | 2026-06-15 20:59:59Z |
| provider state | — | `active`, `sbs_82e25a80f41d2ee0`, next_charge 2026-06-15 07:35:53Z |
| meta.initial_order_id | `e1b26ab9…` (rebill_materialization 2026-04-19) | — |
| meta.extended_by_orders | `[baf5801c…]` (renewal_subscription 2026-05-16 06:00:34, paid 250) | — |
| meta.checkout_order_id | — | `baf5801c…` (тот же order) |
| entitlement | `55a06e2c…`, expires 2026-06-19, order_id=`baf5801c…` | — |

Зеркальный P1 case.

### P3 — Юлия Рабчевская / Gorbova Club / BUSINESS (race из H4)

| field | sub_A `4469a81d…` | sub_B `f7fda1d7…` |
|---|---|---|
| billing_type | provider_managed | mit |
| created_at | 2026-05-16 07:54:55.115Z | 2026-05-16 07:57:06.334Z (Δ 2 мин 11 с) |
| access_start_at | 2026-05-16 07:54:55Z | 2026-05-16 07:54:55Z |
| access_end_at | 2026-06-15 20:59:59Z | **2026-06-16 12:00:00Z** |
| provider state | `active`, `sbs_2f634e38e892da31`, next_charge 2026-06-15 07:57:04Z | — |
| meta.initial_order_id | — (sub создан pre-checkout) | `d1080bf5…` (provider_managed_checkout, paid 250) |
| meta.checkout_order_id | `d1080bf5…` | — |
| meta.extended_by_orders | — | — |
| entitlement | `934499af…`, expires 2026-06-16, order_id=`d1080bf5…` | — |

**Один order_id `d1080bf5…` породил две sub за 2 минуты.** Чистый race B-1.

### Дополнительный контекст: история orders по пользователю + тарифу

См. таблицу в скрипте (§ исполнения). По всем 3 пользователям существуют ≥6 предыдущих paid orders по этому же тарифу (нормальная история подписки) + по 2–4 `pending` orders с `payment_flow IN (renewal_one_time, renewal_subscription)` — это материализованные cron'ом «ленивые» renewal-формы, которые не приведут к новой sub без оплаты (rule_engine синтетика для аналитики и/или артефакты H2 sweep'а). Их не трогаем.

### Telegram

| user | telegram_access | active_until | impact |
|---|---|---|---|
| Елена | `club_id=fa547c41…`, chat/channel=active | NULL | not_applicable |
| Татьяна | `club_id=fa547c41…`, chat/channel=active | NULL | not_applicable |
| Юлия | `club_id=fa547c41…`, chat/channel=active | NULL | not_applicable |

Telegram-блок в H3.x-b-execute по всем 3 парам **пропускается**. Никаких revoke/grant/queue-операций.

### Installments / access_rules
- installment_payments по 5 order_id duplicate-пар: **0**.
- access_rules не имеет колонки `subscription_v2_id` → референса на конкретные sub нет. STOP-guard «access_rules ссылается на duplicate» структурно n/a.

---

## 4. Diff-сводка

| pair | user | max access_end | max принадлежит | active provider у | sbs differ? | race same order? | Telegram |
|---|---|---|---|---|---|---|---|
| P1 | Елена | 2026-06-17 (sub_A MIT) | MIT (без provider) | только sub_B | n/a (один sbs) | нет | n/a |
| P2 | Татьяна | 2026-06-19 (sub_A MIT) | MIT (без provider) | только sub_B | n/a (один sbs) | нет | n/a |
| P3 | Юлия | 2026-06-16 (sub_B MIT) | MIT (без provider) | только sub_A | n/a (один sbs) | **ДА** (`d1080bf5…`) | n/a |

---

## 5. Canonical selection (priority chain с provider safety)

| pair | шаг победил | canonical | duplicate | обоснование |
|---|---|---|---|---|
| P1 | §5.1 (только sub_B имеет active provider) | `1a2352ab…` (sub_B) | `ac57a221…` (sub_A) | provider safety > access_end_at; иначе теряем live rebill `sbs_6b0372d78b97a5f0`. **Конфликт с шагом 5-спец:** max access_end_at у MIT (2026-06-17), у provider 2026-06-15. → пометить риск, см. §6/§7. |
| P2 | §5.1 | `240f45e7…` (sub_B) | `bc5e6759…` (sub_A) | то же; live sbs `sbs_82e25a80f41d2ee0`. Аналогичный риск access_end_at. |
| P3 | §5.1 (только sub_A имеет active provider) | `4469a81d…` (sub_A) | `f7fda1d7…` (sub_B) | live sbs `sbs_2f634e38e892da31`; MIT sub_B на 1 день длиннее (06-16 vs 06-15) — закрывается GREATEST. |

---

## 6. Planned action (для H3.x-b-execute, **не выполняется**)

Общий шаблон по каждой паре (детали в §7):

1. **Keep canonical**. `access_end_at_new = GREATEST(canonical.access_end_at, duplicate.access_end_at)` — никогда не уменьшать. Также `next_charge_at` пересчитать как `GREATEST(current, new access_end_at)` или оставить равным provider next_charge_at (приоритет provider).
2. **Cancel/supersede duplicate**:
   - duplicate во всех 3 парах **не имеет** `provider_subscriptions` записи (см. §3) → режим `local_only_no_provider_subscription`: никакого bePaid API вызова, только локальный `status='superseded'`, `auto_renew=false`, `meta.superseded_by = <canonical_id>`, `meta.superseded_reason='h3xb_duplicate_repair'`, audit `repair.h3xb.local_supersede`.
   - Pre-cancel provider read-pull для duplicate **не нужен** (provider у duplicate отсутствует).
   - Provider canonical **не трогается** (это активный rebill, оставляем live).
3. **Order linkage rebind** (в подтверждённые поля, см. §1):
   - merged `extended_by_orders[]` собрать как `array(distinct(canonical.extended_by_orders ∪ duplicate.extended_by_orders ∪ {duplicate.meta.initial_order_id} ∪ {canonical.meta.checkout_order_id})) \ {canonical.meta.initial_order_id}`;
   - результат записать в `canonical.meta.extended_by_orders`;
   - `canonical.meta.repair_h3xb = { absorbed_sub_id, absorbed_initial_order_id, absorbed_extended_by_orders, source: 'h3xb_execute' }`;
   - `orders_v2` строки **не редактируются** (нечего редактировать: linkage там не хранится).
4. **Entitlement merge**:
   - На пользователя по этому продукту существует **ровно 1 entitlement** (см. §3). Обновить:
     - `expires_at = GREATEST(current, access_end_at_new)`;
     - `meta.source_subscription_v2_id = canonical_id`;
     - `meta.repair_h3xb = true`;
   - `order_id` менять **не нужно** (entitlement уже указывает на актуальный последний paid order: P1/P2 — на renewal_subscription, P3 — на provider_managed_checkout; все они остаются валидными).
5. **Telegram** — пропустить (impact = not_applicable_no_active_until_for_users, см. §3).

---

## 7. STOP-guards (по каждой паре)

| guard | P1 | P2 | P3 |
|---|---|---|---|
| 1. Итоговый access_end_at < текущего MAX | **ТРИГГЕР**: MAX=2026-06-17, canonical(provider)=2026-06-15. Решается шагом 6.1 (GREATEST подтягивает до 06-17 на canonical). После GREATEST guard **снимается**. | **ТРИГГЕР→снимается** (MAX=06-19 → canonical поднимется до 06-19). | clear (GREATEST поднимает 06-15→06-16) |
| 2. Обе sub с разными active sbs | clear (только 1 active provider) | clear | clear |
| 3. Paid order, не привязанный ни к одной | clear | clear | clear |
| 4. entitlement.expires_at после merge ниже текущего | clear (GREATEST) | clear | clear |
| 5. У пользователя >1 duplicate-пары по продукту | clear | clear | clear |
| 6. installment_payments pending | clear (0) | clear (0) | clear (0) |
| 7. access_rules ссылается на duplicate sub_id | n/a (нет колонки) | n/a | n/a |
| 8. Конфликт max access_end_at у sub без provider | **ТРИГГЕР**: max у MIT (без provider), canonical у sub с provider. Решается через `access_end_at_new = GREATEST(...)` на canonical → provider-linkage сохранён, access не падает. Guard снимается. | **ТРИГГЕР→снимается** аналогично | clear |
| 9. bePaid read-pull ambiguous | n/a — duplicate provider record отсутствует, pull не требуется | n/a | n/a |

**Итог по guards:** ни одна пара не уходит в `manual_review` по структурным причинам. Все триггеры guard-1/8 разрешаются через GREATEST на canonical.

---

## 8. Контроль общего scope

Запрос: `SELECT count(*) FROM (SELECT user_id, product_id FROM subscriptions_v2 WHERE status='active' GROUP BY 1,2 HAVING count(*)>1) x;`
Результат: **`7`** (на момент 2026-05-16).

**Из них 3 указанные в плане** (`1b68252b`, `3c6d812a`, `7261e727`) описаны выше read-only.
**4 пары вне scope** — НЕ исследованы, НЕ репарированы.

→ По правилу §8 плана: **execute approve запрещён**, пока scope не пересмотрен.
→ Перед `H3.x-b-execute` требуется **обновлённый H4-style preconditions** по всему текущему набору (4 пары вне исходного scope могут быть legacy pre-H2 / уже helder в backlog, либо новые — нужно классифицировать).

---

## 9. Rollback sketch (для каждой пары)

Применимо только в момент будущего execute. Snapshot должен быть зафиксирован в backup-таблице `subscriptions_v2_repair_h3xb_backup_2026_05` + `entitlements_repair_h3xb_backup_2026_05` непосредственно перед DML.

### Общий rollback контракт

| источник изменения | как откатить |
|---|---|
| `subscriptions_v2` duplicate (status/auto_renew/meta) | UPDATE по snapshot из backup-таблицы |
| `subscriptions_v2` canonical (access_end_at, next_charge_at, meta.extended_by_orders, meta.repair_h3xb) | UPDATE по snapshot из backup |
| `entitlements` (expires_at, meta.source_subscription_v2_id, meta.repair_h3xb) | UPDATE по snapshot |
| `provider_subscriptions` | не трогаются → откат не нужен |
| `orders_v2` | не трогаются → откат не нужен |
| `telegram_*` | не трогаются → откат не нужен |
| **provider state на стороне bePaid** | в H3.x-b нет provider cancel (duplicate provider-less во всех 3 парах) → ничего не откатывать на стороне bePaid. **NB:** если в будущей итерации какая-либо пара получит provider cancel — провайдерный откат через API невозможен, требует ручной новой подписки. Это правило **сохраняется** как глобальный контракт repair flow. |

### Per-pair before snapshot

| pair | duplicate snapshot key fields | canonical snapshot key fields | entitlement snapshot |
|---|---|---|---|
| P1 | `ac57a221…`: status=active, auto_renew=true, meta.extended_by_orders=[`0d192cc8…`], meta.initial_order_id=`d8b4e214…` | `1a2352ab…`: access_end_at=2026-06-15 20:59:59Z, next_charge_at=2026-06-15 20:59:59Z, meta.extended_by_orders=∅ | `2452715d…`: expires_at=2026-06-17 12:00Z, meta.source_subscription_v2_id=∅ |
| P2 | `bc5e6759…`: status=active, auto_renew=true, meta.extended_by_orders=[`baf5801c…`], meta.initial_order_id=`e1b26ab9…` | `240f45e7…`: access_end_at=2026-06-15 20:59:59Z, next_charge_at=2026-06-15 20:59:59Z, meta.extended_by_orders=∅ | `55a06e2c…`: expires_at=2026-06-19 12:00Z, meta.source_subscription_v2_id=∅ |
| P3 | `f7fda1d7…`: status=active, auto_renew=true, meta.initial_order_id=`d1080bf5…`, meta.extended_by_orders=∅ | `4469a81d…`: access_end_at=2026-06-15 20:59:59Z, next_charge_at=2026-06-15 20:59:59Z, meta.checkout_order_id=`d1080bf5…` | `934499af…`: expires_at=2026-06-16 12:00Z, meta.source_subscription_v2_id=∅ |

---

## 10. Финальный вердикт по парам

| pair | guards clear? | rollback sketch | вердикт |
|---|---|---|---|
| P1 | ДА (после GREATEST) | ✓ | **ready_for_execute** (но gated §8) |
| P2 | ДА (после GREATEST) | ✓ | **ready_for_execute** (но gated §8) |
| P3 | ДА | ✓ | **ready_for_execute** (но gated §8) |

**Глобальный gate (§8):** execute approve **запрещён** до пересмотра scope (текущий total = 7 пар, в плане 3). Все 3 пары технически готовы, но не разрешены к execute без нового H4-style preconditions.

---

## 11. Что НЕ делалось (DoD checklist)

- production DML: **0**
- миграции: **0**
- мутирующие edge function вызовы: **0** (bepaid-cancel-subscriptions=0, grant-access-for-order=0, telegram-grant-access=0, telegram-revoke=0, bepaid-get-subscription-details=0, subscription-actions=0)
- webhook replay: **0**
- secrets изменения: **0**
- `BEPAID_REBILL_MATERIALIZATION`: остался `dry_run`
- `mode=on`: не включался
- backup-таблиц не создавалось (этап backup — часть execute, не dry-run)
- 3 duplicate-пары и 4 out-of-scope пары: snapshot read-only, без касания

---

## 12. Следующий шаг

1. **Не давать approve** на `H3.x-b-execute` в текущем scope=3.
2. Подготовить отдельный план: **H3.x-b-scope-refresh** (или объединить с обновлённым H4 preconditions): классифицировать 4 пары out-of-scope (legacy pre-H2 vs новые post-H3.x-a), решить — расширять ли execute scope или вынести часть в legacy data-repair backlog.
3. Только после этого — `H3.x-b-execute` с явным approve: атомарная транзакция, rowcount guards, backup-таблицы (по образцу `recurring_repair_2026_05_execute_A`), audit `repair.h3xb.*`. **Без** `grant-access-for-order`.
4. После наблюдения за audit (новых duplicate-пар ≥ 7 дней = 0) — повторный H4 preconditions перед `mode=on`. `mode=on` сейчас не включать.
