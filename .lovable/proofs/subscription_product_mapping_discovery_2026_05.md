# PATCH-SUBSCRIPTION-PRODUCT-MAPPING-DISCOVERY-2026-05

**Режим:** read-only. **Дата:** 2026-05-26. **Execute:** не выполнялся.
**Подтверждение:** ни одна bePaid-подписка не отменена, ни одной SQL-мутации не выполнено, Trek 1 cleanup (eligible-25) не запускался.

---

## 0. Итог одной строкой

**Системный корень проблемы:** 25 мая 2026 был выполнен backfill-скрипт `token_direct_charge` (см. `provider_subscriptions.meta.source='token_direct_charge', meta.synthetic=true, meta.backfilled_at='2026-05-25T07:44…'`), который создал **73 синтетических** `provider_subscriptions` с `provider_subscription_id = 'internal:<subv2_id>'`. Эти записи **не имеют реальной bePaid-подписки на стороне провайдера** — это локальные «обёртки» вокруг существующих subv2 с `auto_renew=true`.

Распределение synthetic-обёрток по продукту:
- **ЗАКРОЙ ГОД / Стандартный** (one-time по SOT) — **64** → категория **E phantom_no_provider**.
- **Gorbova Club / BUSINESS** — **7**, у 5 из них тот же user имеет **живую** настоящую bePaid sub → категория **F split_brain_synth_over_real**.
- **Gorbova Club / CHAT** — 1 (F).
- **Gorbova Club / FULL** — 1 (F).

UI `ContactDetailSheet` блок «Подписки» рисует имя продукта из `subscriptions_v2 → products_v2 → name` (см. §6). Поэтому если subv2 «прикручена» к ЗАКРОЙ ГОД, а реальный поток платежей идёт на Gorbova Club CHAT/BUSINESS, пользователь в UI видит ЗАКРОЙ ГОД — **это не UI bug**, это реально такая привязка в БД.

---

## 1. Сводка по категориям (active/past_due/pending/trial bePaid)

| Категория | Count | Описание |
|---|---:|---|
| OK_real_linked | 183 | provider_sub реальный, linked к subv2 — норма |
| **E_phantom_no_provider** | **64** | synthetic internal-provider на one-time ЗАКРОЙ ГОД с auto_renew=true |
| **F_split_brain_synth_over_real** | **9** | synthetic-обёртка на Gorbova Club поверх юзера с реальной bePaid sub |
| F_real_no_sub_link | 7 | real bePaid sbs без `subscription_v2_id` |
| B_subscription_product_mismatch | 0 | не выявлено системно (см. контрольные кейсы — это E, а не B) |
| C_entitlement_product_mismatch | 0 (системно) | UI «не продлевается» по entitlement не выявлено как root cause |
| D_legacy_recurring_real | 0 | ни одна реальная bePaid sub не сидит на one-time продукте по SOT |
| A_ui_join_wrong | 0 | UI join сам по себе корректен; данные в БД действительно содержат wrong product_id |

---

## 2. Карта «UI поле → источник данных» (ContactDetailSheet)

Блок «Подписки» — `src/components/admin/ContactDetailSheet.tsx`, строки ~745, 2149-2200:

```ts
.from("provider_subscriptions")
.select("id, provider, state, provider_subscription_id, …, subscriptions_v2 ( … products_v2(name), tariffs(name) )")
```

| UI поле | Источник |
|---|---|
| Имя продукта в блоке «Подписки» | `subscriptions_v2.product_id → products_v2.name` |
| Имя тарифа | `subscriptions_v2.tariff_id → tariffs.name` |
| Next charge | `provider_subscriptions.next_charge_at` **fallback** `subscriptions_v2.next_charge_at` |
| Access end | `subscriptions_v2.access_end_at` |
| Badge «Не продлевается» (стр. 1398) | `sub.auto_renew=false` И/ИЛИ `sub.cancel_at IS NOT NULL` |
| Auto-renew переключатель | `subscriptions_v2.auto_renew` |
| `provider_subscription_id` ссылка | `provider_subscriptions.provider_subscription_id` (содержит `internal:…` для synthetic) |

**Вывод:** UI читает product/tariff из subv2, а не из orders/payments. Никакой подмены join нет. Если данные в БД говорят «sub привязана к ЗАКРОЙ ГОД» — UI честно отрисует ЗАКРОЙ ГОД, даже если последний платёж был за Gorbova Club CHAT.

---

## 3. Контрольный кейс — Ирина Гайдук (`irina.borodzko@tut.by`)

**user_id:** `9a970da3-0b7b-4d6a-bd83-a5ae71176d20`

### 3.1 provider_subscriptions

| id | provider_subscription_id | state | amount | last_charge | linked subv2 |
|---|---|---|---:|---|---|
| fa37b7aa | sbs_ce84248defb82e4b | expired | 100 | — | a5188fd1 (CHAT canceled) |
| 5500cc23 | sbs_d35abc87246ee581 | **canceled** | **55** | 2026-04-23 09:30:36 | 154af3dd (CHAT expired) |
| **a58af92c** | **internal:f539f454-…** | **active** | **55** | 2026-04-23 09:30:33 | **f539f454 (ЗАКРОЙ ГОД active auto_renew=true mit)** |

### 3.2 subscriptions_v2 (active)

| id | product | tariff | status | auto_renew | billing | access_end | order |
|---|---|---|---|---|---|---|---|
| **f539f454** | **ЗАКРОЙ ГОД** | Стандартный | active | **true** | mit | 2026-05-31 | 8de8b381 (MIG-ZG-ROW-400, 600 BYN, 2025-12) |
| a5421c66, c5c24b2f | Gorbova Club | CHAT | past_due | f | provider_managed | — | — |

### 3.3 Последние орд/payments
REBILL 55 BYN → **Gorbova Club / CHAT** (2026-04-23, 2026-03-24, 2026-02-22 …). Все `bepaid_subscription_charge` payments идут на CHAT.

### 3.4 entitlements
- `73c29914 ЗАКРОЙ ГОД` active до 2026-05-31 (по order MIG-ZG-ROW-400)
- `11c9f1b8 Gorbova Club` (CHAT) expired до 2026-03-22

### 3.5 Объяснение «55 BYN CHAT отображается как ЗАКРОЙ ГОД»

- Реальная bePaid sub Gorbova Club / CHAT (sbs_d35abc87246ee581) теперь **canceled**, её subv2 154af3dd — **expired**.
- Backfill 2026-05-25 создал synthetic `internal:f539f454` 55 BYN active, прицепил его к subv2 f539f454 — которая **исторически создана из миграции MIG-ZG-ROW-400 (ЗАКРОЙ ГОД, 600 BYN)** с `auto_renew=true, billing_type='mit'`. Это аномалия: ЗАКРОЙ ГОД по SOT one-time, but активная subv2 для него имеет recurring-флаги.
- UI читает product из subv2 → видит **ЗАКРОЙ ГОД** в блоке «Подписки» и «Доступы».
- Поток REBILL-заказов CHAT идёт **отдельно**, не привязан к f539f454; они появляются благодаря тому, что webhook bePaid (старой canceled sub) ещё генерирует rebill события до окончательной отмены провайдером.

### 3.6 Категория

- `f539f454 + a58af92c` → **E_phantom_no_provider** (synthetic `internal:…`, ЗАКРОЙ ГОД one-time, real sbs на CHAT — другая сущность).
- `a5421c66, c5c24b2f` (CHAT past_due, provider_managed, no order, no provider_link) → **E_phantom_no_provider** (фантомные pre-created без живого provider).
- Это **не B/C**. Никакой «подмены product_id» не было — было создание неправильной subv2 ЗАКРОЙ ГОД в один из старых миграций (декабрь 2025) и затем backfill 25-05-2026 наложил synthetic-обёртку.

---

## 4. Контрольный кейс — Ольга Дещеня (`strekhao@yandex.ru`)

**user_id:** `63807993-20fe-4845-a664-69d91c6eb9c2`

### 4.1 provider_subscriptions
| id | provider_subscription_id | state | amount | linked subv2 |
|---|---|---|---:|---|
| **41fb55e6** | **sbs_9f993cdd0db6f34b** | **active** | **250** | **ac44cf74 (Gorbova Club BUSINESS active auto_renew=true provider_managed)** |
| 95861f34 | sbs_4e7a03ed18fd9e41 | canceled | 250 | ac44cf74 (тот же subv2 → split-brain dual-link) |
| **8a912995** | **internal:0ce56494…** | **active** | **250** | **0ce56494 (ЗАКРОЙ ГОД active auto_renew=true mit)** |
| остальные | sbs_… | expired/redirecting | 250 | — |

### 4.2 subscriptions_v2 active
- **ac44cf74** Gorbova Club BUSINESS active auto_renew=true provider_managed, access до **2026-06-25** — **OK, реально живая**.
- **0ce56494** ЗАКРОЙ ГОД Стандартный active auto_renew=true mit, access до **2026-05-31** — **phantom**.

### 4.3 Объяснение «BUSINESS-сделки есть, доступ "не продлевается"»

UI badge «Не продлевается» в `ContactDetailSheet:1398` зажигается при `auto_renew=false ИЛИ cancel_at != NULL`. Для ac44cf74 у нас `auto_renew=true` — значит badge **не должен** висеть. Если он реально показывается на скрине Ольги, варианты:

1. **UI рисует badge для другой subv2** (например для phantom 0ce56494 ЗАКРОЙ ГОД — но там тоже `auto_renew=true`, не сходится).
2. **UI берёт next_charge_at из subv2 fallback (стр. 2162)**, а у некоторых subv2 он пустой → визуально может казаться «не продлевается», даже без badge.
3. **На скрине Ольги badge может относиться к expired-карточкам** (94de29a3 / 73aa2f30 курсы — стандарт expired, auto_renew=false → реально не продлевается, и это **корректно**).

⇒ Категория для самой BUSINESS-подписки Ольги — **OK_real_linked**. Никакой починки её bePaid не требуется. Phantom 0ce56494 ЗАКРОЙ ГОД — категория **E**.

Split-brain dual-link `ac44cf74 ← {sbs_9f993… active, sbs_4e7a… canceled}` — **F_split_brain_real_dual** (читать как «исторический canceled sbs всё ещё держит FK на тот же subv2»). Не критично пока UI выбирает по `state='active'`, но нужно зафиксировать.

---

## 5. Контрольный кейс — Елизавета Андреева (`elizaveta.andreeva.15@yandex.by`)

**user_id:** `692f22b7-e702-4e0c-953f-c932d9a7da3f`

### 5.1 provider_subscriptions
Реальные bePaid sbs **все мертвы** (expired/canceled/failed_attempt) для Gorbova Club BUSINESS:
- sbs_cf5b…, sbs_ab86…, sbs_9a41…, sbs_5614…, sbs_e600f8c4… (canceled), sbs_7703… (failed_attempt).

Единственная **active** запись — `e8593659 internal:b2c8d37a-…` 250 BYN active last_charge **2026-05-06**, прицеплена к subv2 b2c8d37a → **ЗАКРОЙ ГОД active auto_renew=true mit, access до 2026-05-31**.

### 5.2 subscriptions_v2
- **b2c8d37a** ЗАКРОЙ ГОД active auto_renew=true mit → **E_phantom_no_provider** (synthetic backfill 25-05-2026).
- **b1676866** Gorbova Club BUSINESS **canceled** auto_renew=false provider_managed, access до 2026-06-05. Реально canceled, последний оплаченный заказ REBILL 405012a3 от 2026-05-06.
- Остальные expired/superseded.

### 5.3 Классификация
- BUSINESS-доступ до 2026-06-05 — корректен (категория **OK**, status canceled local + access still valid window — это INV-22 поведение).
- ЗАКРОЙ ГОД active + auto_renew=true — **E_phantom_no_provider**.
- Реальных проблем «mapping»/«mismatch» у Елизаветы нет.
- Решение по Елизавете 2a/2b/2c/2d из предыдущего плана — **не выполнять**, её active-state создан backfill, а не реальной картой.

---

## 6. Карта будущих repair-треков (без execute)

| # | Repair-трек | Scope | Что трогает | Что НЕ трогает |
|---|---|---:|---|---|
| **R1** | **UI fix** | 0 системных кейсов | — | UI читает данные честно, починка не нужна |
| **R2** | **subscriptions_v2 relink** | 0 системных кейсов | — | — |
| **R3** | **entitlements correction** | 0 системных кейсов | — | — |
| **R4** | **Phantom cleanup (synthetic internal:…)** | **64 + ~9 = до 73** | `subscriptions_v2.auto_renew=false`, удалить `meta.recurring_snapshot/amount/currency`, `provider_subscriptions` synthetic-row пометить `meta.deprecated_synthetic=true` | access_end_at, status, orders, payments, real provider_subs |
| **R5** | **Legacy recurring real** | 0 | — | — |
| **R6** | **Manual review split-brain** | 7 (real_no_sub_link) + 9 (split_brain) | По одному разобрать | — |

**Важно:** R4 — это **переопределённая** версия Trek 1. Старая «90 строк cleanup» исходила из неверного списка. Реальный scope phantom — **synthetic provider_subscriptions backfill 2026-05-25 (73 строки)**, а не «все subv2 с auto_renew=true на one-time продукте».

---

## 7. Анти-дубли (split-brain)

- **Ольга:** ac44cf74 ← {sbs_9f993… active + sbs_4e7a… canceled} — два provider_subs на один subv2.
- **Ирина:** f539f454 ← internal:f539f454 (synthetic), плюс отдельные real sbs_d35abc/ce84248 → linked к другим subv2.
- В CSV таких полных дублей split-brain — порядка 9 (см. F_split_brain_synth_over_real).

---

## 8. Источник системной ошибки

Все 73 synthetic-провайдера имеют:
- `provider_subscriptions.meta.source = 'token_direct_charge'`
- `provider_subscriptions.meta.synthetic = true`
- `provider_subscriptions.meta.backfilled_at = '2026-05-25T07:44–07:45Z'`
- `provider_subscriptions.meta.lookup_mode = 'latest_payment_user'`
- `provider_subscriptions.meta.amount_source = 'major_to_minor'`

⇒ **suspected_repair_batch = `token_direct_charge backfill 2026-05-25`**. Нужно найти Edge Function / миграцию, которая сделала это, и убедиться, что она не повторится (отдельный backlog).

---

## 9. Контрольные кейсы — ответ DoD

1. **Ирина**: «55 BYN / CHAT отображается как ЗАКРОЙ ГОД» — потому что subv2 f539f454 действительно привязана к product=73c29914 ЗАКРОЙ ГОД и помечена active+auto_renew=true. UI честно читает product из subv2. Категория **E** + остаточный артефакт некорректной субскрипции от миграции MIG-ZG-ROW-400. REBILL CHAT — отдельный поток от canceled sbs_d35abc.
2. **Ольга**: «BUSINESS-сделки есть, доступ не продлевается» — её BUSINESS subv2 ac44cf74 **активна и продлевается** (next_charge 2026-06-25, auto_renew=true, real sbs_9f993 active). Badge «не продлевается» если виден — относится к expired-курсам (Стандарт/ПВТ) или к phantom 0ce56494. Реальная BUSINESS — категория **OK**.
3. **Елизавета**: реальные bePaid sbs мертвы (BUSINESS canceled, access до 2026-06-05 — корректно). Active-state «BUSINESS будет списываться» отсутствует. ЗАКРОЙ ГОД b2c8d37a — **E phantom** (synthetic backfill).

---

## 10. Артефакты

- Этот файл: `.lovable/proofs/subscription_product_mapping_discovery_2026_05.md`
- CSV (263 строки данных + header): `/mnt/documents/subscription_product_mapping_discovery_2026_05.csv`

## 11. Что **не** выполнялось

- Никаких `UPDATE/INSERT/DELETE`.
- bePaid API не вызывался.
- Ни одна subscription не отменена.
- Trek 1 cleanup (eligible-25) и Trek 2 (Елизавета 2a/2b/2c/2d) — **не запускались**.

## 12. Следующий шаг

Согласовать с пользователем **R4 (phantom cleanup synthetic-only, scope=73)** как отдельный execute-патч с обязательными:
- backup-table перед UPDATE,
- guard: только строки с `provider_subscriptions.meta.synthetic=true AND provider_subscription_id LIKE 'internal:%'`,
- separate guard: для F_split_brain не трогать subv2, только пометить synthetic provider_sub как deprecated,
- rollback SQL,
- audit `phantom_synthetic_cleanup_2026_05`.

R6 split-brain — отдельным патчем после R4.
