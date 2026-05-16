# PATCH E — Dry-run (read-only) по 9 кандидатам Group A

Дата: 2026-05-16 (Минск).
Скоуп: 9 order_id из `.lovable/proofs/payment_to_access_chain_revision_2026_05.md` → Group A.
Режим: **read-only**. Никаких вызовов `grant-access-for-order`, DML и записей в audit не выполнялось. Этап Execute требует отдельного approve.

## 0. Что собрано

Для каждого order:
- `orders_v2` (статус, user_id, product_id, tariff_id, source, paid_at);
- `products_v2` (name, telegram_club_id);
- `tariffs` (name, access_days);
- `payments_v2` (succeeded sum, refunded_amount);
- `entitlements` по (user_id, product_id);
- `subscriptions_v2` по (user_id, product_id);
- `audit_logs` по `meta->>'order_id'` для `action LIKE 'grant%'`.

## 1. Refund / cancel guard

| order_id | order.status | payments.status | paid_sum | refunded_sum | refund_guard |
|---|---|---|---|---|---|
| 2da906f1 | paid | succeeded | 0.00 (GIFT) | 0.00 | OK |
| d0a995aa | paid | succeeded | 4500.00 | 0.00 | OK |
| 6914c44e | paid | succeeded | 0.00 (GIFT) | 0.00 | OK |
| df4f2c36 | paid | succeeded | 0.00 (GIFT) | 0.00 | OK |
| 3a748fd9 | paid | succeeded | 0.00 (GIFT) | 0.00 | OK |
| d3c5070c | paid | succeeded | 0.00 (GIFT) | 0.00 | OK |
| b170b768 | paid | succeeded | 100.00 | 0.00 | OK |
| 85a99b74 | paid | succeeded | 250.00 | 0.00 | OK |
| bddd5a41 | paid | succeeded | 100.00 | 0.00 | OK |

Полных возвратов нет ни по одному кандидату. Все 9 проходят guard `status='paid' AND paid > refunded`.

## 2. Pre-flight таблица (текущее состояние)

| order_id | order_number | source | product_name | tariff | access_days | user_id | paid_at |
|---|---|---|---|---|---|---|---|
| 2da906f1 | GIFT-26-MOCVYPNO | admin_grant | Ценный бухгалтер 1ст 2.0 / Модуль: Предзапись | Стандартный | 30 | 84b60f85 | 2026-04-24 |
| d0a995aa | PAY-26-MNRI13HN | admin_from_payment | Платная консультация | Помощь при проверке | 30 | bafb9965 | 2026-04-09 |
| 6914c44e | GIFT-26-MNM0A0PG | admin_grant | Тестовый продукт для админов | Стандарт | 30 | 05cd3754 | 2026-04-05 |
| df4f2c36 | GIFT-26-MNM09LJN | admin_grant | Тестовый продукт для админов | Стандарт | 30 | ccce6483 | 2026-04-05 |
| 3a748fd9 | GIFT-26-MNM099PF | admin_grant | Тестовый продукт для админов | Стандарт | 30 | ccce6483 | 2026-04-05 |
| d3c5070c | GIFT-26-MNM08XKV | admin_grant | Тестовый продукт для админов | Стандарт | 30 | f1a79dd0 | 2026-04-05 |
| b170b768 | PAY-26-MN1G0JZJ | admin_from_payment | Gorbova Club | CHAT | 30 | fdd18a12 | 2026-03-21 |
| 85a99b74 | PAY-26-MM4P1ZYR | admin_from_payment | Gorbova Club | BUSINESS | 30 | 7261e727 | 2026-02-27 |
| bddd5a41 | PAY-26-MN1G057Z | admin_from_payment | Gorbova Club | CHAT | 30 | fdd18a12 | 2026-02-19 |

Telegram-club продукты: Gorbova Club (3 кандидата). У остальных `telegram_club_id IS NULL` — Telegram action = `none`.

## 3. Текущие entitlement / subscription по (user_id, product_id)

| order_id | ent (id / expires_at / order_id / status) | active sub same tariff (id / window / status / order_id) |
|---|---|---|
| 2da906f1 | none | none |
| d0a995aa | none | none |
| 6914c44e | 78418379 / 2026-05-05 / NULL / expired | 64c68953 / 2026-04-05 → 2026-05-05 / expired / **order=6914c44e** |
| df4f2c36 | 295544d7 / 2026-05-05 / NULL / expired | 1703a459 / 2026-04-05 → 2026-05-05 / expired / **order=df4f2c36** |
| 3a748fd9 | 295544d7 / 2026-05-05 / NULL / expired (тот же user, тот же ent через df4f2c36) | 1703a459 / 2026-04-05 → 2026-05-05 / expired / **order=df4f2c36** (НЕ 3a748fd9) |
| d3c5070c | 326ef903 / 2026-05-05 / NULL / expired | 52af34ae / 2026-04-05 → 2026-05-05 / expired / **order=d3c5070c** |
| b170b768 | f76fe447 / 2026-04-20 / NULL / expired | 65de8778 / 2026-03-21 → 2026-04-20 / expired / **order=b170b768** |
| 85a99b74 | 934499af / 2026-05-09 / **order=85a99b74** / expired | 7c2ee454 / 2026-02-27 → 2026-05-09 / expired / **order=85a99b74**; есть past_due BUSINESS subs (2b797ce2, a9ce878b) с auto_renew=true |
| bddd5a41 | f76fe447 / 2026-04-20 / NULL / expired (через b170b768) | 65de8778 / 2026-03-21 → 2026-04-20 / expired / **order=b170b768** (НЕ bddd5a41); более ранняя a824ef27 expired |

## 4. Audit `grant-access-for-order*` по order_id

Найдено всего 2 записи (обе по 85a99b74):

```text
2026-04-07 12:24:40  grant-access-for-order.skip_already_fulfilled  order=85a99b74
2026-04-07 12:24:48  grant-access-for-order.skip_already_fulfilled  order=85a99b74
```

По остальным 8 — canonical writer на этих order_id **никогда не вызывался**. Текущие entitlement/subscription были созданы либо через ручной/legacy путь (потому-то `entitlements.order_id IS NULL` у 7 из 9 — характерная подпись pre-PATCH-A flow), либо canonical writer был вызван, но audit-запись писалась не с `meta.order_id`. На 85a99b74 — единственный заведомо canonical путь, и он уже фиксирует `skip_already_fulfilled`.

## 5. КРИТИЧЕСКИЙ КОНТЕКСТ — окно доступа уже истекло

Сегодня **2026-05-16**. `tariff.access_days = 30` у всех 9. Окно `paid_at + 30d`:

| order_id | paid_at | paid_at + 30d | сегодня внутри окна? |
|---|---|---|---|
| 2da906f1 | 2026-04-24 | 2026-05-24 | **ДА** (осталось ~8 дней) |
| d0a995aa | 2026-04-09 | 2026-05-09 | НЕТ (expired 7d назад) |
| 6914c44e | 2026-04-05 | 2026-05-05 | НЕТ (11d назад) |
| df4f2c36 | 2026-04-05 | 2026-05-05 | НЕТ |
| 3a748fd9 | 2026-04-05 | 2026-05-05 | НЕТ |
| d3c5070c | 2026-04-05 | 2026-05-05 | НЕТ |
| b170b768 | 2026-03-21 | 2026-04-20 | НЕТ (26d назад) |
| 85a99b74 | 2026-02-27 | 2026-03-29 | НЕТ (фактически 85a99b74 уже растянут до 2026-05-09 предыдущей логикой — тоже expired) |
| bddd5a41 | 2026-02-19 | 2026-03-21 | НЕТ |

`grant-access-for-order` считает `access_start_at = order.paid_at_or_created_at` и `access_end_at = access_start_at + access_days`. **Для 8 из 9 кандидатов re-grant создаст уже-истёкшее окно** — пользователь практической пользы не получит. Только `2da906f1` (Maya, 2026-04-24) даст реальное живое окно.

Это меняет картину Group A: фактически большинство «отсутствующих доступов» — это **истёкшие** доступы, выданные в обход canonical writer (entitlement.order_id=NULL), а не «не выданные вовсе». Сама истёкшесть — нормальный TTL, не баг.

## 6. Классификация planned_action

| order_id | planned_action | expected access_end_at (lower bound) | telegram_action | notes |
|---|---|---|---|---|
| 2da906f1 | create_primary_entitlement_and_subscription | 2026-04-24 + 30d = **2026-05-24** | none (no club) | Единственный случай с реальным эффектом — создаст активную подписку и canonical ent.order_id |
| d0a995aa | create_primary_entitlement_and_subscription | 2026-05-09 (expired) | none | Канонизирует ent, но окно уже истекло |
| 6914c44e | skip_already_fulfilled (или re-link ent.order_id) | sub.access_end_at unchanged 2026-05-05 | none | Sub есть с этим order_id, ent.order_id=NULL — writer может только пере-присвоить; не предсказываем |
| df4f2c36 | skip_already_fulfilled | 2026-05-05 (expired) | none | Sub.order_id matches |
| 3a748fd9 | **manual_review — duplicate gift** | n/a | none | Тот же user/product/tariff, что у df4f2c36; sub принадлежит df4f2c36. Riск: writer создаст вторую sub того же тарифа от 2026-04-05 (extend по tariff_id применится к expired sub → новая sub) → дубль подарка |
| d3c5070c | skip_already_fulfilled | 2026-05-05 (expired) | none | Sub.order_id matches |
| b170b768 | skip_already_fulfilled | 2026-04-20 (expired) | grant CHAT (writer) | Sub.order_id matches; Telegram canonical уже должен был отработать в момент создания — проверить в Execute |
| 85a99b74 | skip_already_fulfilled (подтверждено audit'ом) | 2026-05-09 (expired) | grant BUSINESS (writer) | Прямой audit `skip_already_fulfilled` уже есть. Re-grant ничего не изменит. У user есть 2 past_due BUSINESS subs с auto_renew=true — это отдельный INV-22 кейс, **вне scope PATCH E** |
| bddd5a41 | **manual_review — duplicate CHAT покупка** | n/a | grant CHAT? | Sub принадлежит b170b768 (другой order того же user/product/tariff). Writer по extend-tariff-match найдёт ту expired sub и попытается продлить от paid_at=2026-02-19 → окно 2026-02-19→2026-03-21, всё равно expired. Но риск двойной подписки CHAT для одного user остаётся → manual review |

Сводка:
- `create_primary_entitlement_and_subscription`: **2** (2da906f1, d0a995aa)
- `skip_already_fulfilled` (ожидаемый no-op): **5** (6914c44e, df4f2c36, d3c5070c, b170b768, 85a99b74)
- `manual_review`: **2** (3a748fd9, bddd5a41)
- `stop_*`: **0** (все user_id/product_id/tariff_id заполнены, refund_guard OK)

## 7. GIFT-flags (детали по подаркам)

| order_id | получатель user_id | выдал (order.meta) | продукт | реализован ранее? | риск двойного gift |
|---|---|---|---|---|---|
| 2da906f1 | 84b60f85 | admin_grant (см. orders.meta) | Ценный бухгалтер / Модуль Предзапись | НЕТ — ни ent, ни sub | низкий (создаём первый раз) |
| 6914c44e | 05cd3754 | admin_grant | Тестовый продукт | ДА — sub.order_id=6914c44e | низкий (skip) |
| df4f2c36 | ccce6483 | admin_grant | Тестовый продукт | ДА — sub.order_id=df4f2c36 | низкий (skip) |
| 3a748fd9 | ccce6483 | admin_grant | Тестовый продукт | ДА — через df4f2c36 на того же user (дубль) | **высокий — два GIFT-order одному user/product/tariff подряд (16:57:57 и 16:58:13)** |
| d3c5070c | f1a79dd0 | admin_grant | Тестовый продукт | ДА — sub.order_id=d3c5070c | низкий (skip) |

## 8. Что НЕ делалось

- `grant-access-for-order` не вызывался.
- `entitlements`, `subscriptions_v2`, `telegram_access_queue`, `telegram_*` не модифицировались.
- `audit_logs` не пополнялся.
- `BEPAID_REBILL_MATERIALIZATION` не трогался.
- Schema/RLS не менялись.

## 9. STOP-guards (между Dry-run и Execute)

Жёстких STOP по плану §4 — нет. Но выявлены **soft-blockers**, которые требуют решения до approve Execute:

- **SB-1 (duplicate GIFT, 3a748fd9):** writer создаст вторую подписку на тот же `ccce6483`/тариф `Стандарт`. Если намерение было «один подарок» — вынести в `manual_review` (cancel дубль-order или skip).
- **SB-2 (duplicate CHAT, bddd5a41):** writer может создать вторую CHAT-подписку у `fdd18a12`. Аналогично — `manual_review`.
- **SB-3 (expired-window, 7 кандидатов):** Execute не вернёт пользователям активного доступа. Если цель PATCH E — «canonical-канонизировать историю» (привести ent.order_id к order_id) — это легитимно. Если цель — «вернуть людям пропавший доступ» — большинство кейсов уже истекли естественно, а не «потерялись». Нужно явное подтверждение цели.
- **SB-4 (85a99b74 INV-22):** у user `7261e727` две `past_due` BUSINESS-subs с `auto_renew=true` (2b797ce2 от 2026-05-02 и a9ce878b от 2026-05-06). Это паттерн зомби-подписки (mem://commercial-logic/subscriptions/inv22-desync-resolution), **вне scope PATCH E** — отдельный план INV-22.

## 10. Go/No-go рекомендация

**No-go для слепого batch-execute по всем 9.**

Предложение разделить scope на approve по подгруппам:

- **GO-batch A (1 order):** `2da906f1` — единственный с реальным эффектом, без дублей. Безопасный execute.
- **GO-batch B (5 orders, idempotent no-op):** `6914c44e`, `df4f2c36`, `d3c5070c`, `b170b768`, `85a99b74` — ожидаем `skip_already_fulfilled`. Может пере-присвоить `entitlements.order_id` (канонизация). Безопасно, но эффект только в audit-канонизации.
- **MANUAL_REVIEW (2 orders):** `3a748fd9`, `bddd5a41` — дубли. Решение: cancel дубль-order или skip. Не запускать через writer.
- **OUT-OF-SCOPE (1 order по факту попадает в Б):** `85a99b74` отдельно подсветить — есть activные past_due subs, требующие INV-22-плана.
- **NEW-CANDIDATE для отдельного scope:** `d0a995aa` — ent/sub нет, но окно истекло. Решение: создать canonical (canonization для архива) или skip как «истёк без выдачи». Требует продуктового решения.

## 11. DoD Dry-run

- [x] Proof-файл создан.
- [x] Все 9 order проверены: status, refund, ent/sub, audit.
- [x] `planned_action` / soft-blockers заполнены.
- [x] DML = 0.
- [x] `grant-access-for-order` не вызывался.
- [x] Execute не запускался.

## 12. Решение, ожидается от owner

Жду явный approve по схеме:
1. **Approve GO-batch A** (1 order 2da906f1) → запускаю Execute Stage 2 только по нему.
2. **Approve / reject GO-batch B** (5 orders, no-op canonization).
3. **Approve manual_review handling** для 3a748fd9 + bddd5a41 (вне writer).
4. **Approve / reject canonization** d0a995aa (expired без выдачи).

Без approve по каждому пункту Execute не запускается.
