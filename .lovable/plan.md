## да, согласен, с учетом правок:

План в целом принят, но перед выполнением нужно скорректировать scope и порядок.

Главная правка: **Phase 10 не должен быть PAUSED полностью**, если P0 ghost-profile sprint ещё не закрыт. Сейчас есть два разных блока:

1. **P0 Ghost profile / Live Stripe binding / card data** — критический blocker, который должен быть закрыт первым.
2. **PATCH PACK refund/cancel/cleanup/follow-up proofs** — следующий пакет после закрытия P0.

Нельзя начинать refund/cancel/cleanup, пока live Stripe payment 5 BYN окончательно не привязан к реальному профилю Сергея и не отображается корректно.

---

# **Новый порядок**

## **Step 0 — сначала закрыть P0 Ghost profile sprint**

До выполнения PATCH 1–5 нужно завершить текущий P0:

- `normalize_order_user_id()` исправлен;
- ghost-профили repointed/deleted или доказательно скрыты;
- payment `2d40bc7e…` привязан к реальному Сергею `a4b7c8c9…`;
- card data для `2d40bc7e…` заполнены;
- `/admin/payments` показывает 5 BYN Stripe строку с:
  - provider = Stripe;
  - status = succeeded;
  - contact = Сергей Федорчук;
  - card data;
  - Stripe receipt;
- карточка Сергея показывает этот платёж;
- failed bePaid `5b5cb22f…` остаётся отдельной failed bePaid-строкой.

Без этого refund/cancel/cleanup могут работать по неправильным связям.

---

# **PATCH PACK можно начинать только после P0 PASS**

После P0 PASS принимаю следующий порядок:

```text
Step 1 — DIAGNOSE + DRY-RUN по PATCH PACK
Step 2 — approve
Step 3 — execute PATCH 1 / 2 / 4
Step 4 — PATCH 3 cleanup только после отдельного approve KEEP/HIDE списка
Step 5 — PATCH 5 proof-only
Step 6 — Phase 10 final regression resume
```

---

# **Правки к PATCH 1 — Stripe refund**

План правильный, но добавить обязательные ограничения:

## **1. Не делать refund до P0 PASS**

Refund на `pi_3TgMkD6…` выполнять только после того, как payment `2d40bc7e…`:

- привязан к реальному профилю Сергея;
- виден в `/admin/payments`;
- имеет card data;
- имеет Stripe receipt;
- не связан с ghost.

## **2. Перед refund — dry-run**

Перед реальным refund показать:

```sql
SELECT
  id,
  provider,
  provider_payment_id,
  order_id,
  user_id,
  profile_id,
  amount,
  currency,
  status,
  refunded_amount,
  receipt_url,
  meta
FROM payments_v2
WHERE provider_payment_id = 'pi_3TgMkD6UYJj2vm0G1ZUpRzvH'
   OR id = '2d40bc7e-e69f-4633-88d5-102561e49a54';
```

И отдельно order/access:

```sql
SELECT id, status, user_id, profile_id, contact_id, final_price, currency, paid_at, meta
FROM orders_v2
WHERE id = (
  SELECT order_id FROM payments_v2 WHERE id='2d40bc7e-e69f-4633-88d5-102561e49a54'
);
```

## **3. Refund amount**

Для первого live refund использовать **частичный refund минимальной суммы**, если Stripe позволяет.

Если система поддерживает только full refund — STOP и report до execute.

Не делать full refund без отдельного подтверждения.

## **4. Access action**

По умолчанию для тестового refund:

```text
access_action = keep
```

Не отзывать доступ автоматически в этом PATCH, если отдельно не подтверждено.

---

# **Правки к PATCH 2 — Stripe subscription cancel**

План правильный, но:

## **1. Не отменять live production subscription без явного подтверждения**

Если `sub_1Tg9B66…` — live subscription, то перед cancel сделать dry-run:

- subscription owner;
- product/tariff;
- access_end_at;
- next billing date;
- current status;
- Stripe status.

## **2. Default action**

Для первого теста:

```text
cancel_at_period_end
```

а не `cancel_now`.

`cancel_now` — только отдельным подтверждением.

## **3. Access integrity**

После cancel_at_period_end:

- `access_end_at` не должен сокращаться;
- entitlement должен остаться active до конца оплаченного периода;
- `auto_renew=false`;
- `meta.stripe.cancel_at_period_end=true`.

---

# **Правки к PATCH 3 — cleanup**

PATCH 3 нельзя выполнять в одном execute-пакете с refund/cancel.

## **Cleanup только отдельным approve**

Сначала нужен отдельный dry-run list:

```text
KEEP / HIDE / DO NOT TOUCH
```

По каждой строке:

- table;
- id;
- provider_payment_id / subscription_id;
- user/profile;
- live/test;
- reason;
- proposed action.

## **Важно**

Не скрывать:

- live payment `pi_3TgMkD6…`;
- live subscription `sub_1Tg9B66…`;
- любые клиентские реальные записи;
- любые записи, которые участвуют в текущем proof.

Soft-hide допустим только для очевидных dev/sandbox артефактов.

---

# **Правки к PATCH 4 — card data**

Если P0 уже включает targeted card data для `2d40bc7e…`, то PATCH 4 не должен дублировать работу.

Правильный статус:

```text
PATCH 4 = only verify after P0
```

Новая edge function `stripe-card-data-fetch` сейчас не нужна, если P0 уже решает targeted fetch.

Если P0 не сможет получить card data безопасно — тогда вернуться к PATCH 4 отдельным планом.

---

# **Правки к PATCH 5 — follow-up proofs**

PATCH 5 можно делать как proof-only после P0, но не смешивать с refund/cancel.

В proof подтвердить только уже сделанное:

- redirect URLs;
- Telegram DM product/tariff;
- UI «Иностранная карта» enabled on mount.

Если discovery покажет, что что-то не сделано — не исправлять внутри PATCH 5, а вынести отдельным PATCH.

---

# **Исправленный порядок выполнения**

```text
0. Закрыть P0 Ghost profile / binding / card data = PASS.

1. PATCH PACK Diagnose + Dry-run:
   - refund path;
   - cancel path;
   - cleanup candidates;
   - card data status after P0;
   - follow-up proof status.

2. После approve:
   PATCH 1 — provider-aware refund, но refund execute только после отдельного подтверждения суммы/access_action.

3. PATCH 2 — Stripe subscription cancel UI/provider derivation.
   cancel_at_period_end только после отдельного подтверждения.

4. PATCH 5 — follow-up proofs.

5. PATCH 3 — cleanup только после отдельного approve KEEP/HIDE list.

6. Phase 10 final regression resume.
```

---

# **Что сейчас НЕ делать**

До P0 PASS не делать:

- refund;
- cancel subscription;
- cleanup/hide;
- card-data mass backfill;
- saved cards;
- webinar access;
- subscription tab rename;
- Phase 10 final PASS.

---

# **Proof structure**

После P0 закрыть:

```text
.lovable/proofs/phase_L4_ghost_profile_fix_v1.md
```

После PATCH PACK:

```text
.lovable/proofs/patch_stripe_refund_v1.md
.lovable/proofs/patch_stripe_subscription_cancel_v1.md
.lovable/proofs/patch_stripe_cleanup_live_artifacts_v1.md
.lovable/proofs/patch_stripe_card_data_v1.md
.lovable/proofs/stripe_runtime_followup_fixes_v1.md
```

Если PATCH 4 полностью закрыт в P0, в `patch_stripe_card_data_v1.md` указать:

```text
Resolved by P0 ghost profile sprint; no extra edge function created.
```

---

# **Итоговое решение**

Сейчас не начинай PATCH PACK execute.

Сначала закончи P0 ghost-profile sprint.

После P0 PASS дай один consolidated DIAGNOSE + DRY-RUN по PATCH PACK и жди approve.

&nbsp;

План: PATCH PACK перед Phase 10 (Stripe live refund / cancel / cleanup / card data / follow-up proofs)

Phase 10 Final Regression — **PAUSED**. До финального PASS закрываем 5 PATCH строго по схеме `DIAGNOSE → DRY RUN → PLAN → EXECUTE → VERIFY`. Никакого test-mode, Resend, тестовых карт. Все проверки — на реальных Stripe-объектах Сергея (`pi_3TgMkD6UYJj2vm0G1ZUpRzvH` 5 BYN, sub `sub_1Tg9B66UYJj2vm0Gx2Ghaoch`).

### Discovery итог (что уже выяснили без правок)

```text
Refund SOT path (bePaid-only, hardcoded):
  RefundDialog → subscription-admin-actions[action='refund']
  → жёстко жмёт https://gateway.bepaid.by/transactions/refunds (parent_uid)
  → отсюда "Parent transaction not found" для Stripe-платежей.

Stripe refund уже есть, но вне SOT:
  supabase/functions/stripe-admin-refund — super-admin утилита,
  принимает pi_*, идёт в Stripe Refund API, опирается на charge.refunded
  webhook + record_refund_atomic. НЕ вызывается из RefundDialog.

Cancel subscription:
  SubscriptionActionsSheet уже ветвится по subscription.provider==='stripe'
  → рендерит StripeSubscriptionActionsBlock → stripe-subscription-action
  (cancel_now / cancel_at_period_end). Базово работает.
  Проблема пользователя ("только bePaid") = либо subscription.provider не
  приходит в карточке (нет колонки в subscriptions_v2; provider живёт в
  provider_subscriptions), либо UI открывает старый bePaid-only flow.

Card data:
  stripe-webhook уже сохраняет card_brand/last4/holder в
  checkout.session.completed и payment_intent.succeeded (PATCH-LIVE-CARD).
  Для исторических Stripe-платежей карточные поля = NULL — массовый
  backfill в backlog F7, не делаем. Для pi_3TgMkD6… допустим targeted fetch.

Stripe cleanup кандидаты в БД (по факту):
  payments_v2 provider='stripe' = 20+ строк, среди них
    - pi_3TgMkD6UYJj2vm0G1ZUpRzvH (5 BYN, KEEP, live, сегодня)
    - pi_sim_* (явный симулятор, CLEAN кандидат)
    - re_3Te* refunded-rows и pi_3Te*/pi_3Tf* без user_id (sandbox)
    - prov-checkout pi_3Tg9B3.., pi_3Tg8Fx.., pi_3TfHgy.. (Сергей, dev
      checkout'ы Phase 8/9). Не клиентские — CLEAN/HIDE кандидаты.
  subscriptions_v2: 6+ Stripe-подписок Сергея с cs_test_* checkout sessions
  — все, кроме sub_1Tg9B66… (live, KEEP), — dev артефакты.
```

---

### PATCH 1 — Provider-aware refund в SOT

**Файлы:** `supabase/functions/subscription-admin-actions/index.ts`, `src/components/admin/RefundDialog.tsx`.

1. В refund-ветке определить `provider` платежа: `successfulPayment.provider` (`'stripe' | 'bepaid'`).
2. Для `stripe`:
  - вытащить `pi_*` из `provider_payment_id` (или `meta.stripe.payment_intent`), `account_code` из `meta.stripe.account_code`;
  - вызвать `https://api.stripe.com/v1/refunds` через `readAcquiringSecret('stripe', account_code, 'secret_key')` (как в `stripe-admin-refund`);
  - НЕ писать refund-row напрямую — `stripe-webhook` `charge.refunded` сам вызовет `record_refund_atomic` (memory: Refund Canonical Write-Path);
  - после успешного create — обновить access по выбранному `access_action` (revoke/reduce/keep/keep_subscription) тем же кодом, что уже есть для bePaid;
  - audit `admin.subscription.refund_stripe_*` (requested / created / failed / already_refunded).
3. Для `bepaid` — оставить текущий путь без изменений.
4. Идемпотентность: если Stripe вернул `charge already refunded` → audit + 200 без поломки.
5. RefundDialog: текст модалки и кнопка ветвятся по `paymentProvider`:
  - `stripe` → «Возврат будет проведён через Stripe.»;
  - `bepaid` → текущая bePaid-формулировка;
  - `manual/admin*` → текущий warning «ручной платёж».
6. Ошибки нормализовать через `normalizeEdgeFunctionError`; больше никакого «Parent transaction not found» для Stripe.

**Proof:** `.lovable/proofs/patch_stripe_refund_v1.md` — реальная попытка возврата 5 BYN, Stripe refund_id, audit, before/after, bePaid не сломан.

---

### PATCH 2 — Stripe subscription cancel, гарантия provider-aware UI

**Файлы:** `src/components/admin/SubscriptionActionsSheet.tsx` и хук, который грузит подписки в карточку контакта.

1. Diagnose: найти хук, отдающий объект `subscription` в Sheet (вероятно `useSubscriptionsV2` / `useContactSubscriptions`). В `subscriptions_v2` нет колонки `provider` → derivation должен идти из `provider_subscriptions.provider` или из `meta.stripe.subscription_id IS NOT NULL`.
2. В этом хуке выставлять `subscription.provider = 'stripe' | 'bepaid'` (SOT priority: `provider_subscriptions.provider` → `meta.stripe.subscription_id ? 'stripe'` → `'bepaid'`).
3. SubscriptionActionsSheet:
  - при `provider==='stripe'` показывать ТОЛЬКО `StripeSubscriptionActionsBlock` (уже реализован: `cancel_at_period_end` / `cancel_now` через `stripe-subscription-action`);
  - скрыть/задизейблить bePaid-кнопки с пояснением «только для bePaid»;
  - bePaid path не трогать.
4. По умолчанию для Stripe — `cancel_at_period_end` (доступ до конца оплаченного периода). Memory: Club Status Integrity (paid не отзывать).
5. Backend `stripe-subscription-action` уже пишет audit и обновляет `subscriptions_v2.auto_renew=false` + `meta.stripe.cancel_at_period_end` — проверить, не дублируем.

**Proof:** `.lovable/proofs/patch_stripe_subscription_cancel_v1.md` — реальная отмена sub Сергея `sub_1Tg9B66…`, before/after, Stripe response, audit, `access_end_at` не изменён.

Backlog F3 (`stripe_subscription_cancel`) после PATCH 2 закрыть.

---

### PATCH 3 — Soft-cleanup dev/live Stripe-артефактов

**Подход:** только soft-hide через `meta.cleanup`, никаких hard DELETE, никаких изменений `payments_v2`/`orders_v2` lifecycle.

1. Discovery query (полный список Stripe-records по 4 таблицам: `payments_v2`, `orders_v2`, `subscriptions_v2`, `provider_subscriptions`). Классифицировать:
  - **KEEP:** `pi_3TgMkD6…` + любые клиентские Stripe-платежи (есть `user_id` ≠ Сергей и контактный профиль реальный).
  - **HIDE candidates:** dev артефакты Сергея и анонимные sandbox-строки (`user_id IS NULL`, `pi_sim_*`, sandbox-checkout-функция).
  - **DO NOT TOUCH:** bePaid, `audit_logs`, `provider_events`, `record_refund_atomic` refund-rows.
2. Решение по модели «hide»:
  - в `payments_v2`/`orders_v2`/`subscriptions_v2` нет колонок `archived_at/is_test/hidden`;
  - выбрать: расширить admin-list фильтр в `useUnifiedPayments`/`PaymentsTable` — исключать `meta->>'cleanup_hidden' = 'true'` и `provider_payment_id LIKE 'pi_sim_%'`;
  - DRY-RUN сначала вывести список, дождаться явного approve, затем INSERT-tool обновить `meta.cleanup_hidden=true`, `meta.cleanup_reason='phase8_dev_artifact'`, `meta.cleanup_actor=<admin>`, `meta.cleanup_at=now()`.
3. Stripe Dashboard НЕ трогаем.

**Proof:** `.lovable/proofs/patch_stripe_cleanup_live_artifacts_v1.md` — dry-run list, KEEP/HIDE, SQL before/after, подтверждение `pi_3TgMkD6…` виден, bePaid не тронут.

---

### PATCH 4 — Stripe card data: проверка + targeted fetch для 5 BYN

**Файлы:** `supabase/functions/stripe-webhook/index.ts` (уже патчен), новая edge функция `stripe-card-data-fetch` (targeted, super-admin only).

1. Подтвердить, что в `stripe-webhook` есть запись `card_brand/card_last4/card_holder` в обоих хендлерах (PATCH-LIVE-CARD).
2. Создать `stripe-card-data-fetch`:
  - super-admin guard;
  - body: `{ payment_intent_id }`;
  - тянет `payment_intents/{id}?expand[]=latest_charge`;
  - обновляет ТОЛЬКО `payments_v2.card_brand/card_last4/card_holder` для одной строки;
  - audit `admin.stripe.card_data_targeted_fetch`;
  - НЕ трогает lifecycle, статусы, refund, grant.
3. Применить к `pi_3TgMkD6UYJj2vm0G1ZUpRzvH` (одна строка).
4. Массовый backfill — остаётся в backlog F7. Не делаем.
5. Следующий live-Stripe платёж уже сам подтянет card data через webhook — отдельная proof-точка.

**Proof:** `.lovable/proofs/patch_stripe_card_data_v1.md` — источник данных, обновлённая строка, UI-скрин админки после targeted fetch.

---

### PATCH 5 — Follow-up fixes proof

Только фиксация уже сделанного (без правок кода, если discovery подтвердит):

A. **Stripe redirect URLs** — проверить `supabase/functions/stripe-create-checkout` и `stripe-create-subscription-checkout`: `success_url=/purchases?payment=processing`, `cancel_url=/payment/result?status=cancelled`. bePaid redirect не тронут.

B. **Telegram DM product/tariff names** — `grant-access-for-order` → `telegram-grant-access` (memory: Canonical Telegram Grant Write-Path): DM содержит product/tariff, нет дублей, access не ломается.

C. **UI «Иностранная карта» enabled on mount** — `PaymentDialog`/`PaymentMethodSelector`: Stripe account resolved сразу при открытии, кнопка активна без race-condition; bePaid path не сломан.

**Proof:** `.lovable/proofs/stripe_runtime_followup_fixes_v1.md` — три блока A/B/C с цитатами кода и скринами.

---

### Порядок выполнения

```text
Step 1 — DIAGNOSE + DRY-RUN (один отчёт)
   • полный список Stripe records (payments_v2 + orders_v2 +
     subscriptions_v2 + provider_subscriptions);
   • точные точки правок refund/cancel;
   • KEEP / HIDE классификация;
   • STOP-риски;
   → ждать approve.

Step 2 — EXECUTE по порядку
   1. PATCH 1 — provider-aware refund
   2. PATCH 2 — Stripe cancel UI + provider derivation
   3. PATCH 4 — stripe-card-data-fetch + targeted fetch pi_3TgMkD6…
   4. PATCH 3 — soft-hide dev artefacts (после явного approve списка)
   5. PATCH 5 — follow-up proofs

Step 3 — VERIFY
   • реальный refund 5 BYN на pi_3TgMkD6…;
   • реальная cancel_at_period_end на sub_1Tg9B66…;
   • UI /admin/payments чистый, KEEP виден, bePaid не сломан;
   • все 5 proof-файлов закрыты.

Step 4 — Снять PAUSED с Phase 10.
```

### Запреты на весь pack

- никаких Stripe test-mode, test card, Dashboard Resend, фиктивных webhook events;
- никаких hard DELETE из `payments_v2`/`orders_v2`/`subscriptions_v2`/`audit_logs`/`provider_events`;
- bePaid flow и `record_refund_atomic` SOT не трогаем;
- массовый card backfill — backlog F7, не сейчас;
- никаких UPDATE без dry-run + approve;
- клиентские (не-Сергей) Stripe-записи — DO NOT TOUCH.

### DoD

1. Refund на Stripe-платёж работает из админки без `Parent transaction not found`.
2. Cancel Stripe-подписки работает из карточки контакта.
3. `/admin/payments` показывает реальный 5 BYN Stripe-платёж, dev артефакты скрыты.
4. `pi_3TgMkD6…` имеет card_brand/last4/holder; следующий live Stripe платёж получает их автоматически.
5. Follow-up proof оформлен.
6. bePaid refund/cancel/grant/Telegram не регрессированы.
7. 5 proof-файлов созданы и закрыты.
8. Phase 10 снят с PAUSED.