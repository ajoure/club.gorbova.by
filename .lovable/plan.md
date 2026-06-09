# да, согласен, с учетом правок:

План принят.

Можно начинать Phase 1 — миграцию `normalize_order_user_id()`.

## **Обязательные уточнения перед execute**

### **1. Phase 1 можно выполнять сразу**

Phase 1 — это исправление функции-триггера.  
Она устраняет root cause, поэтому её можно выполнять первой.

После миграции обязательно дать proof:

- старый порядок lookup;
- новый порядок lookup;
- тест на `user_id=05cd3754…610b`;
- подтверждение, что теперь выбирается реальный профиль:

```text
a4b7c8c9-8210-499e-ae3f-2a5db2121577
```

а не ghost:

```text
05cd3754-d589-4d90-97d1-89ba2bee610b
```

---

### **2. Phase 2–3 только после dry-run в proof**

Перед любым UPDATE/DELETE обязательно показать в proof:

- affected rows по `orders_v2`;
- affected rows по `payments_v2`;
- affected rows по `subscriptions_v2`;
- affected rows по `entitlements`;
- affected rows по `access_grant_ledger`;
- affected rows по `telegram_access_queue`;
- affected rows по `payment_links`;
- affected rows по другим таблицам, где есть `profile_id`.

Если где-то есть неоднозначная связь — STOP и report.

---

### **3. Ghost-профили удалить можно**

Подтверждаю: ghost-профили можно удалить после repoint и FK-check:

```text
05cd3754-d589-4d90-97d1-89ba2bee610b
7a942227-e274-4e3f-8ed0-08195fc11542
```

Но только если финальная проверка показывает `0` ссылок на них во всех связанных таблицах.

Если остаются ссылки — не удалять, дать report.

---

### **4. Card data backfill — только для одного live Stripe payment**

Для P0 разрешён только точечный backfill:

```text
payments_v2.id = 2d40bc7e-e69f-4633-88d5-102561e49a54
payment_intent = pi_3TgMkD6UYJj2vm0G1ZUpRzvH
```

Массовый backfill старых Stripe-платежей не делать.

---

### **5. Deal / CRM**

Так как отдельной таблицы `deals` нет, Phase 6 исключаем из execute.

Если CRM-связь живёт через `orders_v2.pipeline_stage` / `pipeline_stages` / meta — только зафиксировать состояние в proof.  
Никаких дополнительных CRM-правок в этом P0 не делать без отдельного approve.

---

### **6. Failed bePaid payment не трогать**

Failed bePaid attempt:

```text
5b5cb22f…
```

оставить как есть.

Он должен остаться отдельной failed bePaid-строкой и не смешиваться со Stripe success.

---

## **Approve на выполнение**

Порядок:

1. Phase 1 — миграция `normalize_order_user_id()`.
2. Отчёт/proof по Phase 1.
3. Phase 2 — repoint orders/payments/related rows только по dry-run.
4. Phase 3 — delete ghost profiles только после FK-check.
5. Phase 4 — Stripe card data для будущих платежей.
6. Phase 5 — точечный card-data backfill для `2d40bc7e…`.
7. Phase 6/7 — UI verify + proof.

## **Статус после выполнения**

P0 можно закрыть только если:

- live Stripe 5 BYN привязан к реальному Сергею;
- ghost-контакты исчезли или доказательно неактивны;
- `/admin/payments` показывает Stripe 5 BYN с контактом Сергей Федорчук;
- карточка Сергея показывает этот платёж;
- payer/card data заполнены;
- receipt ведёт на `pay.stripe.com`;
- entitlement остался active;
- bePaid failed attempt остался отдельным failed bePaid;
- bePaid / Telegram / access не регрессировали;
- proof `.lovable/proofs/phase_L4_ghost_profile_fix_v1.md` закрыт.

Начинай Phase 1.

&nbsp;

План: P0 — Ghost profile / Live Stripe payment binding / Stripe card data

## Diagnose (выполнен read-only dry-run)

### Профили


| id                                     | user_id         | email                                                                   | created_at | роль                              |
| -------------------------------------- | --------------- | ----------------------------------------------------------------------- | ---------- | --------------------------------- |
| `a4b7c8c9-8210-499e-ae3f-2a5db2121577` | `05cd3754…610b` | [7500084@gmail.com](mailto:7500084@gmail.com)                           | 2025-12-25 | **реальный Сергей Федорчук**      |
| `05cd3754-d589-4d90-97d1-89ba2bee610b` | `NULL`          | [7500084+dev@gmail.com](mailto:7500084+dev@gmail.com)                   | 2026-06-06 | ghost (id == auth.user_id Сергея) |
| `7a942227-e274-4e3f-8ed0-08195fc11542` | `NULL`          | [7500084+stripe-smoke@gmail.com](mailto:7500084+stripe-smoke@gmail.com) | 2026-06-07 | ghost                             |


### Root cause

`public.normalize_order_user_id()` сначала проверяет `profiles.id = NEW.user_id`. Ghost-профиль `05cd3754…` имеет `id`, совпадающий с auth `user_id` Сергея, поэтому матч случается на ghost и `profile_id` ставится в ghost; ветка `profiles.user_id = NEW.user_id` (→ реальный `a4b7c8c9…`) выполняется только если первый lookup ничего не нашёл.

### Affected rows (на ghost `05cd3754…`)

- `orders_v2`: 8 (включая `b464dc75…` paid 5 BYN live Stripe; `0bce80eb…` failed bePaid; и старые тестовые 06–08.06)
- `payments_v2`: 7 на ghost (Stripe + failed bePaid + admin_test), включая `2d40bc7e…` (live Stripe 5 BYN, без card_brand/last4/holder)
- `7a942227…` (ghost-stripe-smoke): orders/payments не найдено в Sergey-выборке (FK-чек по нему — отдельно в Phase 0.4)
- Старые orders/payments уже на реальном `a4b7c8c9…` (до 2026-06-06) — не трогаем

### Live Stripe payment 2d40bc7e

- provider=stripe, status=succeeded, PI=`pi_3TgMkD6UYJj2vm0G1ZUpRzvH`
- order=`b464dc75…` status=paid
- `card_brand/last4/holder` = NULL (webhook их не пишет)
- failed bePaid attempt `5b5cb22f…` (payment `f51d1795…`) — отдельная строка, оставляем как есть

### CRM

Таблицы `deals` в схеме нет — Phase 6 из исходного плана исключаем (CRM-привязка живёт через pipeline_stages на orders_v2, отдельной сущности не существует).

---

## Phase 1 — Fix trigger `normalize_order_user_id()`

Миграция: переписать функцию по приоритетам.

1. Если `NEW.user_id` задан — **сначала** `SELECT id FROM profiles WHERE user_id = NEW.user_id LIMIT 1` → `NEW.profile_id := found.id; RETURN NEW`.
2. Только если не найдено — fallback `SELECT id, user_id FROM profiles WHERE id = NEW.user_id LIMIT 1`. Если найден профиль с `user_id IS NOT NULL` — нормализовать `NEW.user_id := resolved_auth_id`, `NEW.profile_id := resolved_profile_id`, пометить `_user_id_normalized=true`.
3. Если найден только ghost (без `user_id`) — оставить, пометить `_is_ghost_profile=true, _ghost_reason='profile_id_without_user_id'`.

Имя триггера/таблицы/SECURITY DEFINER/search_path не менять.

## Phase 2 — Repoint Sergey (data-only, через `supabase--insert`)

После approve Phase 1 миграции:

```sql
UPDATE orders_v2
SET profile_id = 'a4b7c8c9-8210-499e-ae3f-2a5db2121577',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('_repoint_ghost_fix_p0', now()::text)
WHERE user_id='05cd3754-d589-4d90-97d1-89ba2bee610b'
  AND profile_id='05cd3754-d589-4d90-97d1-89ba2bee610b';  -- 8 rows

UPDATE payments_v2
SET profile_id = 'a4b7c8c9-8210-499e-ae3f-2a5db2121577'
WHERE user_id='05cd3754-d589-4d90-97d1-89ba2bee610b'
  AND profile_id='05cd3754-d589-4d90-97d1-89ba2bee610b';  -- ~7 rows
```

`subscriptions_v2/entitlements/access_grant_ledger/telegram_access_queue/payment_links` — уже принадлежат Сергею по `user_id`; перед UPDATE прогоняем точечный SELECT на `profile_id IN (ghost1, ghost2)` и repoint только однозначные. Если есть строки без однозначной связи — STOP & report (не делаем guess).

## Phase 3 — Delete ghost profiles

Final FK-check по всем таблицам с `profile_id`/`user_id` на `05cd3754…` и `7a942227…`. Только при `cnt=0` всех ссылок (исключая `profiles.id` сами):

```sql
DELETE FROM profiles WHERE id IN ('05cd3754…','7a942227…');
```

Если хоть одна ссылка осталась — не удаляем, фиксируем в proof.

## Phase 4 — Stripe card data в webhook

`supabase/functions/stripe-webhook/index.ts`: в обработчиках `checkout.session.completed` и `payment_intent.succeeded` при upsert `payments_v2` дополнительно писать `card_brand`, `card_last4`, `card_holder` из expanded `latest_charge.payment_method_details.card` + `charge.billing_details.name`. Webhook signature/livemode/idempotency/receipt/grant — не трогаем.

## Phase 5 — Backfill для `2d40bc7e…`

Точечный one-off: через Stripe live secret получить `pi_3TgMkD6UYJj2vm0G1ZUpRzvH` с `expand[]=latest_charge`, затем UPDATE одной строки `payments_v2.id='2d40bc7e…'` — только `card_brand/card_last4/card_holder`. Массового исторического backfill нет (в backlog F7).

## Phase 6 — Verify UI

- `/admin/payments`: строка 5 BYN Stripe показывает Stripe-провайдер, succeeded, контакт = Сергей Федорчук, карта Visa ****/holder, receipt → pay.stripe.com.
- Карточка Сергея (`a4b7c8c9…`): на вкладке «Платежи» виден live Stripe 5 BYN.
- Ghost-контакты в списке контактов отсутствуют.
- Failed bePaid `5b5cb22f…` остаётся отдельной failed-строкой (provider=bepaid, merchant.bepaid.by).

## Phase 7 — Proof + backlog

- `.lovable/proofs/phase_L4_ghost_profile_fix_v1.md` (root cause, dry-run SQL, миграция, repoint diff, FK-check, delete result, card-fix, backfill, UI скрины, freeze-подтверждение).
- `.lovable/backlog/live_stripe_post_payment_followups.md` — обновить F2–F7 (уже частично существует).

---

## Freeze (не трогаем)

bePaid webhook/receipt, Stripe checkout/secrets/webhook signature, grant-access lifecycle, Telegram, subscriptions reconcile, refund flow, access resolver, saved cards, tariff_offers/meta, любые миграции кроме одной точечной для функции триггера.

## Expected files

- `supabase/migrations/<ts>_fix_normalize_order_user_id_lookup.sql`
- `supabase/functions/stripe-webhook/index.ts` (только Stripe card capture)
- `.lovable/proofs/phase_L4_ghost_profile_fix_v1.md`
- `.lovable/backlog/live_stripe_post_payment_followups.md`

Никаких изменений в `src/`, `_shared/create-*-checkout.ts`, `public-checkout`, bePaid/Telegram/reconcile functions.

## DoD

Все 11 пунктов из исходного брифа (trigger приоритизирует `profiles.user_id`, repoint выполнен, ghost удалены или явно объяснено почему нет, `2d40bc7e…` привязан к реальному профилю с card data, UI показывает Stripe-строку с корректным контактом/картой/receipt, failed bePaid отдельно, entitlement активен, bePaid/Telegram/access не регрессировали, proof полный).

Начинаю с Phase 1 (миграция функции). Phase 2–5 — после approve миграции, по одному.