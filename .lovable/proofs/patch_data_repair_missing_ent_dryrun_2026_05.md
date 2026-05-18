# PATCH-DATA-REPAIR-MISSING-ENT — dry-run v2 (read-only proof, с защитными правками)

**Snapshot:** `2026-05-18T13:00:00+00:00`
**Режим:** READ-ONLY. 0 DML. 0 вызовов `grant-access-for-order`. 0 Telegram API. 0 provider API.
**Источник входа:** `.lovable/proofs/patch_tg_revoke_2a_payment_access_revalidation_2026_05.md` + `/mnt/documents/patch_tg_revoke_2a_revalidated_candidates_2026_05.csv`
**Scope:** 6 пользователей с verdict=`missing_platform_access_but_paid_order_exists`.

## 0. Что изменилось в v2

Добавлены 3 защитные правки:

1. **H5 REBILL guard:** перед `planned_action=grant_access_for_order_needed` проверяется, что source order **НЕ** имеет `meta.source='rebill_materialization'` (а также любого `h5_historical_repair`) и `meta.do_not_grant_access IS NOT true`. См. memory `h5_refresh_v2_historical_rebill_deal_linkage_discovery_2026_05`: материализованные REBILL-сделки помечены `do_not_grant_access=true` намеренно — они представляют исторические факты платежей, но не должны управлять выдачей доступа.
2. **Telegram untouched:** в этом патче Telegram-стек (queue, telegram-grant-access, members, channels) **не трогается** ни на read, ни на write. Re-verify Telegram membership — отдельный шаг после execute repair.
3. **Expected result контракт:** для каждого execute proposal явно зафиксирован expected post-state.

## 1. Главный вывод v2

После применения H5-guard состав 6 строк перераспределяется:

| планируемое действие | строк |
|---|---:|
| `grant_access_for_order_needed` | **1** |
| `manual_review_do_not_grant_access` (H5 REBILL) | **5** |

→ В этом патче execute может коснуться **только 1 пользователя** (Екатерина Юролайть, source order = `SUB-LINK-MO9N8JHA`, flow=`renewal_subscription`, `meta.source=NULL`, `meta.do_not_grant_access=NULL`).

Остальные 5 пользователей (Белозор, Краковская, Пилецкая, Босак, Леоненко) уходят в **manual_review_do_not_grant_access** — их платежи реальны (succeeded REBILL в апреле), но эти заказы материализованы как «do_not_grant_access=true» и canonical writer на них вызывать нельзя. Их parent SUB-LINK orders — paid в феврале 2026, окно 30d → к snapshot 18.05 уже expired, поэтому вызов writer на parent даст stale-окно. Эти 5 кейсов требуют отдельного решения (см. §7).

## 2. H5-guard — фактическая проверка (live read)

```sql
SELECT id, order_number, meta->>'source' src, meta->>'do_not_grant_access' dnga,
       meta->>'payment_flow' flow
FROM orders_v2 WHERE id IN (<6 candidate orders>);
```

Результат:

| order_number | flow | meta.source | do_not_grant_access | guard |
|---|---|---|:---:|:---:|
| `REBILL-8e378a28-b9c` (Белозор) | `bepaid_subscription_charge` | `rebill_materialization` | **true** | ❌ blocked |
| `SUB-LINK-MO9N8JHA` (Юролайть) | `renewal_subscription` | NULL | NULL | ✅ pass |
| `REBILL-f0c02db7-545` (Краковская) | `bepaid_subscription_charge` | `rebill_materialization` | **true** | ❌ blocked |
| `REBILL-521c83ff-1e0` (Пилецкая) | `bepaid_subscription_charge` | `rebill_materialization` | **true** | ❌ blocked |
| `REBILL-746dfc86-a05` (Босак) | `bepaid_subscription_charge` | `rebill_materialization` | **true** | ❌ blocked |
| `REBILL-85794259-8e1` (Леоненко) | `bepaid_subscription_charge` | `rebill_materialization` | **true** | ❌ blocked |

Без H5-guard (v1) ошибочно были бы вызваны 6 writer-calls; с guard остаётся 1.

## 3. Уточнение по тарифам

- BUSINESS (`7c748940`, 250 BYN, 30d) — 5: Белозор, Юролайть, Краковская, Босак, Леоненко.
- CHAT (`31f75673`, 55 BYN, 30d) — 1: **Любовь Пилецкая**.

Оба тарифа — продукт Gorbova Club (`11c9f1b8`), `access_days=30`.

## 4. Row cards (6)

CSV: `/mnt/documents/patch_data_repair_missing_ent_dryrun_2026_05.csv`.

### 4.1 Екатерина Белозор (контрольный кейс) — **manual_review_do_not_grant_access**
- user_id: `dbfb061f-7205-4328-be11-7770eba53f56`, profile_id: `da64a74e-…fc64`
- candidate order: `35160835-…` / `REBILL-8e378a28-b9c`, `meta.source=rebill_materialization`, `do_not_grant_access=true`
- payment: `8e378a28-…` succeeded, paid_at=`2026-04-22 18:00:36+00`, 250.00 BYN, refund=0
- parent order: `5bdbe7d5-…` / `SUB-LINK-MLWM81AM` (paid `2026-02-21`, окно истекло ≈ `2026-03-23`)
- ent: ❌ active нет; sub_v2: ❌ active нет
- **planned_action:** `manual_review_do_not_grant_access`
- writer **не вызывать**

### 4.2 Екатерина Юролайть — **grant_access_for_order_needed** ✅
- user_id: `23b80521-…`, profile_id: `2cb32b75-…`
- order: `05b84087-…` / `SUB-LINK-MO9N8JHA`, `meta.source=NULL`, `do_not_grant_access=NULL`, flow=`renewal_subscription`
- payment: `8aabd32a-…` succeeded, paid_at=`2026-04-22 09:54:24+00`, 250.00 BYN, refund=0
- expected_access_until = `2026-05-22 09:54:24+00` (> snapshot)
- ent: ❌ / sub_v2: ❌
- **planned_action:** `grant_access_for_order_needed`
- **execute target:** `grant-access-for-order(orderId='05b84087-7c57-479a-939d-7ff55b78be17', source='patch_data_repair_missing_ent_2026_05')`

### 4.3 Елена Краковская — **manual_review_do_not_grant_access**
- order `427c8185-…` / `REBILL-f0c02db7-545`, dnga=true. Parent: `SUB-LINK-MLZJ3Z9R` paid `2026-02-23` (expired).

### 4.4 Любовь Пилецкая (CHAT) — **manual_review_do_not_grant_access**
- order `33ea3238-…` / `REBILL-521c83ff-1e0`, dnga=true. Parent: `SUB-LINK-MLYYNY4C` paid `2026-02-23` (expired).

### 4.5 Марина Босак — **manual_review_do_not_grant_access**
- order `156b3f87-…` / `REBILL-746dfc86-a05`, dnga=true. Parent: `SUB-LINK-MM4JM0BI` paid `2026-02-27` (expired).

### 4.6 Марта Леоненко — **manual_review_do_not_grant_access**
- order `816042ac-…` / `REBILL-85794259-8e1`, dnga=true. Parent: `SUB-LINK-MM337Y6S` paid `2026-02-26` (expired).

## 5. Telegram — НЕ трогаем

Гард 2: PATCH-DATA-REPAIR-MISSING-ENT **не читает и не пишет** в `telegram_access_queue`, `telegram_club_members`, `telegram_messages`. Цель — только восстановление `entitlements` / `subscriptions_v2`. Telegram membership подтянется отдельной canonical chain (`grant-access-for-order → telegram-grant-access`) при необходимости — это уже стандартное поведение writer и проверять отдельно re-verify-шагом ПОСЛЕ восстановления platform access.

## 6. Execute proposal (Stage 3) — только 1 строка

```
POST /functions/v1/grant-access-for-order
body: { orderId: '05b84087-7c57-479a-939d-7ff55b78be17',
        source: 'patch_data_repair_missing_ent_2026_05' }
```

### Expected post-state (контракт verify)

После успешного execute по этому 1 orderId должно выполняться **всё**:

1. `entitlements` строка с `user_id='23b80521-a8e0-415b-94cb-38ae9346d1f4'`, `product_id='11c9f1b8-0355-4753-bd74-40b42aa53616'`, `status='active'`.
2. `entitlements.expires_at` ≥ `expected_access_until = 2026-05-22 09:54:24+00` (и ≥ существующего по GREATEST).
3. `entitlements.meta->>'tariff_id' = '7c748940-dcad-4c7c-a92e-76a2344622d3'` (BUSINESS).
4. Если recurring offer SOT (`tariff_offers.meta.recurring.is_recurring=true`) — синхронизирована `subscriptions_v2` с `access_end_at = expected_access_until` или больше.
5. В `audit_logs` появилась запись с `source='patch_data_repair_missing_ent_2026_05'` и order_id=`05b84087-…`.

Если хотя бы один пункт не выполнен → execute считать failed, откат не требуется (writer idempotent), но фиксировать failure-card и эскалировать.

### Запреты при execute

- 0 ручных INSERT/UPDATE в `entitlements`, `subscriptions_v2`, `access_rules`, `telegram_*`;
- 0 прямых вызовов provider/bePaid;
- 0 изменений secrets/mode/config;
- Telegram очередь/membership **не модифицировать** в рамках этого патча.

## 7. Manual review (5 кейсов H5 REBILL) — отдельный backlog

Эти 5 пользователей реально оплатили в апреле (REBILL succeeded), но canonical writer вызывать на REBILL-материализациях запрещено. Parent SUB-LINK orders уже expired. Требуется **отдельный план** (вне PATCH-DATA-REPAIR-MISSING-ENT):

- проверить `subscriptions_v2` по `(user_id, product_id)` на признаки расхождения с bePaid (см. `inv22-desync-resolution`);
- проверить `provider_subscriptions` state;
- решение либо через `bepaid-sync-subscription` (если provider жив и `active_to` валиден), либо через targeted repair-grant с явным `expires_at` и `meta.tariff_id` от REBILL-payment.

Не делается в этом dry-run.

## 8. Запреты — соблюдены

- 0 INSERT/UPDATE/DELETE
- 0 вызовов `grant-access-for-order`
- 0 вызовов Telegram API / queue read
- 0 вызовов provider/bePaid API
- 0 изменений secrets/mode

## 9. DoD v2

| критерий | статус |
|---|:---:|
| Ровно 6 строк проверены | ✅ |
| H5 REBILL guard применён live | ✅ |
| Telegram-стек не тронут | ✅ |
| Expected post-state контракт зафиксирован | ✅ |
| Row card по каждому из 6 | ✅ |
| planned_action по каждому | ✅ |
| Белозор разобрана отдельным блоком | ✅ |
| Execute не запускался | ✅ |
| DML = 0 | ✅ |
| grant-access-for-order = 0 | ✅ |
| CSV-артефакт сохранён | ✅ |

## 10. Следующий шаг (требует отдельного approve)

**PATCH-DATA-REPAIR-MISSING-ENT execute (scope: 1 строка)** — вызвать `grant-access-for-order(orderId='05b84087-7c57-479a-939d-7ff55b78be17', source='patch_data_repair_missing_ent_2026_05')`, затем verify по 5 пунктам §6.

5 H5 REBILL кейсов — отдельный план/патч (см. §7), вне этой задачи.

## 11. Artifacts

- `.lovable/proofs/patch_data_repair_missing_ent_dryrun_2026_05.md` (этот файл, v2)
- `/mnt/documents/patch_data_repair_missing_ent_dryrun_2026_05.csv` (6 строк)
