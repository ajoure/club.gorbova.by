# PATCH-DATA-REPAIR-MISSING-ENT — dry-run (read-only proof)

**Snapshot:** `2026-05-18T13:00:00+00:00`
**Режим:** READ-ONLY. 0 DML. 0 вызовов `grant-access-for-order`. 0 Telegram API. 0 provider API.
**Источник входа:** `.lovable/proofs/patch_tg_revoke_2a_payment_access_revalidation_2026_05.md` + `/mnt/documents/patch_tg_revoke_2a_revalidated_candidates_2026_05.csv`
**Scope:** ровно 6 пользователей с verdict=`missing_platform_access_but_paid_order_exists` из PATCH-TG-REVOKE-2A.

## 1. Главный вывод

Все 6 пользователей имеют:
- активный paid order по продукту Gorbova Club (`11c9f1b8`);
- successful payment (`payments_v2.status='succeeded'`), `paid_amount = final_price`, `refunded_amount = 0`;
- `expected_access_until = paid_at + tariff.access_days > snapshot`;
- **NULL** active entitlement (`status='active'`, `expires_at > now()`);
- **NULL** active subscription_v2 (`status ∈ {active, trial, past_due}`, `access_end_at > now()`).

→ **planned_action = `grant_access_for_order_needed`** для всех 6.
Revoke из Telegram **запрещён** (это покрыто отдельным гардом PATCH-TG-REVOKE-2: эти 6 не попали в queue).

## 2. Уточнение к 2A

В proof 2A 6 пользователей описаны как «paid-BUSINESS». Фактический срез по тарифам:

- **BUSINESS** (`7c748940`, 250 BYN, 30d) — 5 чел.: Белозор, Юролайть, Краковская, Босак, Леоненко.
- **CHAT** (`31f75673`, 55 BYN, 30d) — 1 чел.: **Любовь Пилецкая**.

Это не меняет verdict — оба тарифа принадлежат продукту Gorbova Club (`11c9f1b8`), у обоих `access_days=30`, и club access_rule открывает доступ от любого тарифа продукта.

## 3. Row cards (6)

Полная таблица — `/mnt/documents/patch_data_repair_missing_ent_dryrun_2026_05.csv` (CSV, 1 строка на пользователя = latest valid paid order по последнему оплаченному тарифу).

### 3.1 Екатерина Белозор (контрольный кейс)
- email: `zapponka1@gmail.com`
- user_id: `dbfb061f-7205-4328-be11-7770eba53f56`
- profile_id: `da64a74e-e1a2-4d82-9f82-dd2c9cc5fc64`
- product: `11c9f1b8` Gorbova Club, tariff: `7c748940` BUSINESS, access_days=30
- order: `35160835-…-c68296f8` / `REBILL-8e378a28-b9c`, status=`paid`, payment_flow=`bepaid_subscription_charge`
- payment: `8e378a28-…` status=`succeeded`, paid_at=`2026-04-22 18:00:36+00`, amount=250.00 BYN, refund=0
- **expected_access_until = `2026-05-22 18:00:36+00`** (> snapshot `2026-05-18 13:00+00` → доступ должен быть активен)
- entitlement: ❌ нет active; subscription_v2: ❌ нет active
- **planned_action:** `grant_access_for_order_needed`
- **execute target:** `grant-access-for-order(orderId='35160835-9286-4697-bd2e-5ef7c68296f8', source='patch_data_repair_missing_ent_2026_05')`

### 3.2 Екатерина Юролайть
- email: `katia.kv@mail.ru`
- user_id: `23b80521-a8e0-415b-94cb-38ae9346d1f4`, profile_id: `2cb32b75-…-abbfe166abfa`
- tariff: BUSINESS, order: `05b84087-…-ff55b78be17` / `SUB-LINK-MO9N8JHA`, flow=`renewal_subscription`
- payment: `8aabd32a-…` succeeded, paid_at=`2026-04-22 09:54:24+00`, 250.00 BYN, refund=0
- expected_access_until = `2026-05-22 09:54:24+00`
- ent: ❌ / sub: ❌
- **planned_action:** `grant_access_for_order_needed`

### 3.3 Елена Краковская
- email: `princessa_elena1@mail.ru`
- user_id: `f278876e-…-7979859`, profile_id: `a8508c1a-…-09a318`
- tariff: BUSINESS, order: `427c8185-…-77f053cb1836` / `REBILL-f0c02db7-545`, flow=`bepaid_subscription_charge`
- payment: `f0c02db7-…` succeeded, paid_at=`2026-04-24 19:00:49+00`, 250.00 BYN, refund=0
- expected_access_until = `2026-05-24 19:00:49+00`
- ent: ❌ / sub: ❌
- **planned_action:** `grant_access_for_order_needed`

### 3.4 Любовь Пилецкая (тариф CHAT, не BUSINESS — уточнение к 2A)
- email: `luba021290@mail.ru`
- user_id: `012e765c-…-7af72`, profile_id: `fbc7d5f1-…-9259c0`
- tariff: **CHAT** (`31f75673`), order: `33ea3238-…-1ec134` / `REBILL-521c83ff-1e0`, flow=`bepaid_subscription_charge`
- payment: `521c83ff-…` succeeded, paid_at=`2026-04-24 09:30:54+00`, 55.00 BYN, refund=0
- expected_access_until = `2026-05-24 09:30:54+00`
- ent: ❌ / sub: ❌
- **planned_action:** `grant_access_for_order_needed`

### 3.5 Марина Босак
- email: `marina826@tut.by`
- user_id: `23a15a08-…-2abffe`, profile_id: `1eff01c9-…-68dea1d`
- tariff: BUSINESS, order: `156b3f87-…-0270ca` / `REBILL-746dfc86-a05`, flow=`bepaid_subscription_charge`
- payment: `746dfc86-…` succeeded, paid_at=`2026-04-28 07:15:16+00`, 250.00 BYN, refund=0
- expected_access_until = `2026-05-28 07:15:16+00`
- ent: ❌ / sub: ❌
- **planned_action:** `grant_access_for_order_needed`

### 3.6 Марта Леоненко
- email: `marta_kisel@tut.by`
- user_id: `0b7efe20-…-3f1de5`, profile_id: `4bf084ed-…-499923`
- tariff: BUSINESS, order: `816042ac-…-3662ce` / `REBILL-85794259-8e1`, flow=`bepaid_subscription_charge`
- payment: `85794259-…` succeeded, paid_at=`2026-04-27 06:45:33+00`, 250.00 BYN, refund=0
- expected_access_until = `2026-05-27 06:45:33+00`
- ent: ❌ / sub: ❌
- **planned_action:** `grant_access_for_order_needed`

## 4. Telegram membership

`telegram_club_members` для club `fa547c41` сейчас не имеет совпадений по `profile_id` указанных 6 (`tcm.profile_id` пустой для соответствующих записей или членство привязано к telegram_user_id без profile linkage). Факт присутствия в чате/канале по состоянию snapshot уже зафиксирован в PATCH-TG-REVOKE-2A (raw export). DATA repair их **не зависит** от Telegram-полей: цель — восстановить `entitlements`/`subscriptions_v2`, а Telegram-присутствие/инвайт обработает уже стандартная цепочка `grant-access-for-order → telegram-grant-access` (canonical write-path) при необходимости и в строгом соответствии с canonical paths.

## 5. Классификация (Stage 2)

| # | customer | planned_action |
|---|---|---|
| 1 | Екатерина Белозор | `grant_access_for_order_needed` |
| 2 | Екатерина Юролайть | `grant_access_for_order_needed` |
| 3 | Елена Краковская | `grant_access_for_order_needed` |
| 4 | Любовь Пилецкая | `grant_access_for_order_needed` |
| 5 | Марина Босак | `grant_access_for_order_needed` |
| 6 | Марта Леоненко | `grant_access_for_order_needed` |

- `skip_already_fixed` — 0
- `manual_review_refund_or_conflict` — 0 (все refund=0, distinct_tariffs ≤ 1 в активном окне)
- `manual_review_no_order` — 0
- `manual_review_no_user` — 0

## 6. Execute proposal (Stage 3)

Для каждой строки предлагается вызов canonical writer:

```
POST /functions/v1/grant-access-for-order
body: { orderId: <order_id>, source: 'patch_data_repair_missing_ent_2026_05' }
```

Запреты при execute:
- никаких ручных `INSERT/UPDATE` в `entitlements`, `subscriptions_v2`, `access_rules`, `telegram_*`;
- никаких прямых вызовов provider/bePaid API;
- никаких изменений secrets/mode/config;
- порядок — последовательно, по одному, с фиксацией результата (idempotency обеспечена `grant-access-for-order`, см. memory: «Grant Access Idempotency»).

Ожидаемые эффекты (по стандартам ID-First + canonical write-path):
- появится primary entitlement по `(user_id, product_id)` с `expires_at = paid_at + tariff.access_days` (≥ текущего, GREATEST-логика);
- для recurring (`payment_flow ∈ bepaid_subscription_charge|renewal_subscription`) появится/обновится `subscriptions_v2` по `tariff_offers.meta.recurring.is_recurring` (SOT);
- Telegram auto-grant DM пойдёт по canonical chain `grant-access-for-order → telegram-grant-access` (если применимо), без `telegram_access_queue.legacy_queue_skip`.

## 7. Запреты — соблюдены

- 0 INSERT/UPDATE/DELETE в любой таблице
- 0 вызовов `grant-access-for-order`
- 0 вызовов Telegram API
- 0 вызовов provider/bePaid API
- 0 изменений secrets/mode

## 8. DoD

| критерий | статус |
|---|:---:|
| Ровно 6 строк проверены | ✅ |
| Row card по каждому | ✅ |
| planned_action по каждому | ✅ |
| Белозор разобрана отдельным блоком | ✅ |
| Execute не запускался | ✅ |
| DML = 0 | ✅ |
| grant-access-for-order = 0 | ✅ |
| Telegram API = 0 | ✅ |
| CSV-артефакт сохранён | ✅ |

## 9. Следующий шаг (требует отдельного approve)

**PATCH-DATA-REPAIR-MISSING-ENT execute** — последовательно вызвать `grant-access-for-order(orderId, source='patch_data_repair_missing_ent_2026_05')` для 6 orderId из Stage 3, затем re-verify (active ent/sub по каждому, expires_at ≥ expected_access_until).

Execute НЕ запускать без отдельного approve.

## 10. Artifacts

- `.lovable/proofs/patch_data_repair_missing_ent_dryrun_2026_05.md` (этот файл)
- `/mnt/documents/patch_data_repair_missing_ent_dryrun_2026_05.csv` (6 строк, row cards в plain CSV)
