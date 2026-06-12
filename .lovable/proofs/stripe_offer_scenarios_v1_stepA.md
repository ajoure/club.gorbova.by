# Proof: PATCH-STRIPE-OFFER-SCENARIOS-V1 — Step A

**Status:** Step A = PASS  
**Date:** 2026-06-12  
**Scope:** Восстановление `orders_v2.offer_id` для одного Stripe-заказа консультации + system-audit.

---

## 1. Pre-flight (read-only, до execute)

| Проверка | Ожидание | Факт |
|---|---|---|
| `orders_v2` соответствует фильтру (id+offer_id IS NULL+status=paid+tariff+product) | 1 | **1** |
| `payment_links.offer_id WHERE id='c5f28396-…'` | `f71b5ed3-…` | **`f71b5ed3-27dd-419d-b922-ad529192b58a`** |
| `tariff_offers WHERE tariff_id='1020fce2-…' AND is_active=true` count | 1 | **1** |
| Единственный активный оффер тарифа | `f71b5ed3-…` | **`f71b5ed3-27dd-419d-b922-ad529192b58a`** |
| `tariffs.product_id WHERE id='1020fce2-…'` | `9d0d6de8-…` | **`9d0d6de8-4b0e-477f-b6c4-ab7def8268f6`** |
| `payments_v2` по заказу | `stripe/succeeded` | **`stripe/succeeded`** |
| `orders_v2.status` | `paid` | **`paid`** |

Все условия выполнены — двойной источник offer_id (payment_link + единственный активный оффер тарифа) подтверждён.

---

## 2. Execute

Атомарная операция: `WITH upd AS (UPDATE …) INSERT INTO audit_logs … FROM upd;`. INSERT в `audit_logs` строго зависит от RETURNING UPDATE — если бы UPDATE не вернул ни одной строки, audit-запись бы не появилась.

UPDATE-guards (все обязательны):
- `id = '849c68b7-7296-4660-8265-841bc57f7aa5'`
- `offer_id IS NULL`
- `status = 'paid'`
- `tariff_id = '1020fce2-d6c3-4dc0-b9e1-c2566c8ba129'`
- `product_id = '9d0d6de8-4b0e-477f-b6c4-ab7def8268f6'`
- `EXISTS payments_v2(provider='stripe', status='succeeded', order_id=o.id)`
- `EXISTS payment_links(id='c5f28396-…', offer_id='f71b5ed3-…')`
- `EXISTS tariff_offers(id='f71b5ed3-…', tariff_id='1020fce2-…', is_active=true)`

---

## 3. Post-execute proof

### 3.1 Before/After заказа

| Поле | Before | After |
|---|---|---|
| `id` | `849c68b7-7296-4660-8265-841bc57f7aa5` | `849c68b7-7296-4660-8265-841bc57f7aa5` |
| `offer_id` | **NULL** | **`f71b5ed3-27dd-419d-b922-ad529192b58a`** |
| `status` | `paid` | `paid` |
| `tariff_id` | `1020fce2-…` | `1020fce2-…` |
| `product_id` | `9d0d6de8-…` | `9d0d6de8-…` |
| `meta.offer_id_backfill_2026_06` | отсутствует | см. ниже |

`meta.offer_id_backfill_2026_06` (фактический JSON):
```json
{
  "source": "payment_links.offer_id + single_active_tariff_offer",
  "payment_link_id": "c5f28396-a7ce-4575-ba27-b2ab45eb80c9",
  "old_offer_id": null,
  "new_offer_id": "f71b5ed3-27dd-419d-b922-ad529192b58a",
  "patch": "PATCH-STRIPE-OFFER-SCENARIOS-V1.stepA",
  "backfilled_at": "2026-06-12T08:10:37.812307+00:00"
}
```

Остальные ключи `meta` (`stripe.*` с `account_code/checkout_session_id/customer_id/invoice_id/payment_intent_id/period_start/period_end/subscription_id`) и `acquiring` не затронуты — использован JSON merge (`||`), а не перезапись.

### 3.2 Идемпотентность

Повторный `UPDATE orders_v2 SET offer_id='f71b5ed3-…' WHERE id='849c68b7-…' AND offer_id IS NULL;` → **0 rows** (offer_id уже не NULL, guard сработал).

### 3.3 Orphan / regression check

`SELECT count(*) FROM orders_v2 o JOIN payments_v2 p ON p.order_id=o.id WHERE p.provider='stripe' AND p.status='succeeded' AND o.id<>'849c68b7-…' AND o.meta ? 'offer_id_backfill_2026_06';` → **0**. Никакие другие Stripe-заказы не были затронуты.

### 3.4 SYSTEM ACTOR audit row (фактическая строка)

```
id           1a3ac820-7f09-4ded-b65a-91cdbf980bda
actor_type   system
actor_user_id NULL
actor_label  Stripe offer_id backfill
action       stripe.order_offer_id.backfilled
entity_type  orders_v2
entity_id    849c68b7-7296-4660-8265-841bc57f7aa5
created_at   2026-06-12 08:10:37.812307+00
meta         {
  "order_id": "849c68b7-7296-4660-8265-841bc57f7aa5",
  "old_offer_id": null,
  "new_offer_id": "f71b5ed3-27dd-419d-b922-ad529192b58a",
  "tariff_id": "1020fce2-d6c3-4dc0-b9e1-c2566c8ba129",
  "product_id": "9d0d6de8-4b0e-477f-b6c4-ab7def8268f6",
  "payment_link_id": "c5f28396-a7ce-4575-ba27-b2ab45eb80c9",
  "resolution_source": "payment_links.offer_id + single_active_tariff_offer",
  "proof_file": ".lovable/proofs/stripe_offer_scenarios_v1_stepA.md",
  "patch": "PATCH-STRIPE-OFFER-SCENARIOS-V1.stepA"
}
```

Примечание о схеме `audit_logs`: фактические колонки — `meta` (не `metadata`), `entity_type`/`entity_id` (не `target_table`/`target_id`). INSERT адаптирован к реальной схеме, набор и значения полей соответствуют требованиям approve A.

---

## 4. Rollback (не выполнен; на случай отката)

```sql
UPDATE orders_v2
SET offer_id = NULL,
    meta = meta - 'offer_id_backfill_2026_06'
WHERE id='849c68b7-7296-4660-8265-841bc57f7aa5'
  AND offer_id='f71b5ed3-27dd-419d-b922-ad529192b58a';
-- + DELETE FROM audit_logs WHERE id='1a3ac820-7f09-4ded-b65a-91cdbf980bda';
```

---

## 5. Verdict

- `orders_v2.offer_id` восстановлен однозначно по двойному источнику.
- Затронута ровно 1 строка, повторный запуск = 0 rows.
- Реальная SYSTEM ACTOR audit-запись создана со всеми 9 ключами `meta`.
- Никакие сторонние Stripe/bePaid заказы не изменены.
- `meta.acquiring`, `meta.stripe.*` и прочие поля заказа сохранены (JSON merge).
- Код, edge functions, шаблоны документов и canonical writer не менялись.

**PATCH-STRIPE-OFFER-SCENARIOS-V1 / Step A = PASS.**

⚠️ Это **не** закрывает e2e-генерацию счёта-акта по Stripe-заказу. Кнопка «Сформировать документ» в `/purchases` остаётся неактивной, потому что у целевого оффера `f71b5ed3-…` `meta.document_scenarios` и `meta.document_defaults` всё ещё пусты → `isOfferDocumentEnabled` отдаёт `enabled=false, reason='disabled'`. Это закрывается дочерним патчем **PATCH-STRIPE-CONSULTATION-DOCUMENT-SCENARIOS-V1** (Step B), который оформляется отдельным планом и approve.

---

## 6. Follow-ups

- **PATCH-STRIPE-CONSULTATION-DOCUMENT-SCENARIOS-V1** — создание сценариев документа по консультационному продукту `9d0d6de8-…` с нуля (5 активных Stripe-офферов одинаково «пустые», bePaid-аналога нет). Discovery: executor USD/Stripe Poland, `document_templates` для акта/счёта-акта в USD, нумерация, file_name_template, матрица 5 офферов (один общий сценарий vs пять разных).
- **Runtime deployment gate** — отдельный план: точечный redeploy edge functions, импортирующих `_shared/document-resolver-v2/payment-channel.ts`, `_shared/document-render.ts`, `_shared/document-data-snapshot.ts` (изменены в `PATCH-STRIPE-DOCUMENT-ACT-CHECK-V1`). До redeploy production runtime может продолжать считать `stripe ≠ card`.
- **Решение по тестовости заказа `849c68b7-…` (2 USD recurring)** — зафиксирован Вариант B (технический тест). Step C не использует этот заказ для production-документа; альтернативы — preview/dry-run, реальный Stripe-заказ или staging — выбираются на approve C.
