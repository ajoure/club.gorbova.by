# PATCH PACK — Stage 1: DIAGNOSE + DRY-RUN (consolidated)

Status: **AWAITING APPROVE** перед EXECUTE.
Дата: 2026-06-09. Phase 10 = PAUSED. Никаких изменений в коде/БД ещё не сделано.

---

## 0. P0 Ghost profile sprint — статус

| Check | Value | Verdict |
|---|---|---|
| `payments_v2.id=2d40bc7e…` provider/pi | `stripe` / `pi_3TgMkD6UYJj2vm0G1ZUpRzvH` | OK |
| `payments_v2.user_id` | `05cd3754…` (Sergey auth.user) | **OK** |
| `orders_v2.b464dc75…profile_id` | `a4b7c8c9-8210-499e-ae3f-2a5db2121577` (Сергей Федорчук) | **OK** |
| `profiles` ghosts `05cd3754…` / `7a942227…` | 0 rows | **DELETED** |
| `payments_v2.card_brand/last4/holder` для `2d40bc7e…` | NULL | **MISSING** |

**Вывод по P0:** binding и ghost-cleanup закрыты. Card data для уже произошедшего платежа НЕ заполнены — для этого нужен PATCH 4 (targeted Stripe API fetch). Resend в Stripe Dashboard не требуем, как просили.

→ **P0 PASS = частично.** Закрытие card data делегируется PATCH 4 (один payment_intent, без массового backfill). Это совместимо с пересмотренным планом: «если P0 не сможет получить card data безопасно — вернуться к PATCH 4 отдельным планом» — это и есть тот случай.

---

## 1. Discovery — Stripe payments (23 строки)

| Class | Кол-во | Действие |
|---|---|---|
| KEEP_LIVE_5BYN | 1 | `pi_3TgMkD6…` — показывать, на нём идут все верификации PATCH 1/4 |
| KEEP_CLIENT (требует review) | 3 | реальные/потенциально клиентские pi_3Tfb5Q / pi_3Tf4ZA / pi_3Tf4WD |
| HIDE_SERGEY_DEV | 8 | dev checkouts Сергея, Phase 8/9 (100 BYN / 100 EUR / 5 USD / 10000 BYN) |
| HIDE_SIM | 2 | `pi_sim_*` — синтетика |
| HIDE_SANDBOX_NO_USER | 9 | `user_id IS NULL`, ранние Phase 6/7 sandbox |

**KEEP_CLIENT review (требует approve по каждой строке):**

| id | pi | profile | сумма |
|---|---|---|---|
| `a68d84be…` | `pi_3Tfb5Q…` | `qa.user@gorbova.test` | 100 BYN |
| `d1859f0b…` | `pi_3Tf4ZA…` | `piletski.a@yandex.by` (нет имени в профиле) | 100 BYN |
| `ec39fc8c…` | `pi_3Tf4WD…` | Юлия Титовец `julyatitov@gmail.com` | 100 BYN |

Рекомендация: `qa.user@gorbova.test` → HIDE_QA. По piletski/Юлия — оставить KEEP_CLIENT, не трогать в cleanup.

**STOP-RISK по Stripe payments:** ВСЕ pi_3T… в БД, включая «KEEP_LIVE 5 BYN», созданы через checkout_session `cs_test_*` (см. таблицу subscriptions ниже — sub_1Tg9B66 имеет `cs_test_…` session). Это значит фактически весь Stripe pipeline пока работал в **test-mode** Stripe-аккаунта `stripe_poland`. PATCH 1 (refund) и PATCH 2 (cancel) вызовут реальные Stripe API с тем же ключом — в test-mode это безопасно, но это нужно проговорить: «реальных денег здесь нет». Если для бизнеса требовался именно live-mode — это отдельный блокер до PATCH 1.

---

## 2. Discovery — Stripe subscriptions (16 строк)

| Class | Кол-во | Комментарий |
|---|---|---|
| KEEP_LIVE | 1 | `sub_1Tg9B66UYJj2vm0Gx2Ghaoch` (Сергей, active, session `cs_test_*`) |
| HIDE_TEST_SESSION | 12 | dev sub с `cs_test_*` checkout |
| REVIEW | 3 | canceled-без-session — Сергей, безопасно hide |

Все 16 — `stripe_poland`, price `price_1Teeq26UYJj2vm0GPXHSLKlz`.

---

## 3. Refund flow — где ломается

**SOT путь** (от UI до bePaid API, hardcoded):

```
RefundDialog.tsx (l.85)
  └─ supabase.functions.invoke('subscription-admin-actions', { action:'refund' })
        └─ supabase/functions/subscription-admin-actions/index.ts (l.283+)
              └─ POST https://gateway.bepaid.by/transactions/refunds
                    { parent_uid: successfulPayment.provider_payment_id }
```

Для Stripe-платежа `provider_payment_id='pi_…'` уходит в bePaid → bePaid отвечает «Parent transaction not found». UI показывает текст `Возврат будет проведён через платёжную систему bePaid` (RefundDialog l.152), потому что условие в l.140 ветвится только `paymentProvider !== 'bepaid'` без отдельной ветки `stripe`.

**Точка правки PATCH 1:**

- `subscription-admin-actions/index.ts` — разнести по `successfulPayment.provider`:
  - `bepaid` → текущий код без изменений;
  - `stripe` → новый блок: `readAcquiringSecret('stripe', account_code, 'secret_key')` → `POST https://api.stripe.com/v1/refunds` (формат как в `stripe-admin-refund/index.ts`) → НЕ писать refund-row здесь, его запишет `stripe-webhook` `charge.refunded` через `record_refund_atomic` (memory: Refund Canonical Write-Path); → access_action отрабатывается тем же общим кодом.
- `RefundDialog.tsx` (l.140-155) — добавить ветку для `stripe` с текстом «Возврат будет проведён через Stripe.»; bePaid и manual ветки — без изменений.

**Существующая утилита:** `supabase/functions/stripe-admin-refund/index.ts` уже умеет Stripe Refund API + idempotency + super-admin guard. Не вызывается из RefundDialog. Можно либо подмонтировать её как helper, либо инлайнить тот же код в `subscription-admin-actions`.

---

## 4. Cancel subscription — где ломается

**Реальная точка UI** (не `SubscriptionActionsSheet.tsx` — он нигде не импортирован):

```
src/components/admin/ContactDetailSheet.tsx
  l.740 useQuery 'contact-provider-subscriptions'
        SELECT * FROM provider_subscriptions (provider in ('bepaid','stripe'))
  l.767 cancelProviderSubAdminMutation
        → supabase.functions.invoke('bepaid-cancel-subscriptions', …)  // ← hardcoded bePaid
  l.2278-2308 кнопка «Отменить»
        if (isBepaid) → активная кнопка, mutation
        else         → disabled + tooltip «Отмена доступна только для bePaid»
```

То есть для Stripe-подписки UI просто дизейблит кнопку. Backend `stripe-subscription-action` (cancel_now / cancel_at_period_end) **уже существует и готов** — но из UI не вызывается. `StripeSubscriptionActionsBlock` тоже существует, но рендерится только из mertvой `SubscriptionActionsSheet`.

**Точка правки PATCH 2 (минимальный scope):**

- `ContactDetailSheet.tsx` ~l.2278: вместо `isBepaid ? <btn> : <tooltip-disabled>` — ветка по `sub.provider`:
  - `bepaid` → текущая `cancelProviderSubAdminMutation`;
  - `stripe` → новый mutation → `supabase.functions.invoke('stripe-subscription-action', { subscription_v2_id: sub.subscriptions_v2.id, action: 'cancel_at_period_end', dry_run:false })` (тот же endpoint, что использует `StripeSubscriptionActionsBlock`); подтверждение через AlertDialog (как сделано в Block);
  - default → tooltip «Отмена недоступна для этого провайдера».
- Backend `stripe-subscription-action` уже пишет audit + обновляет `subscriptions_v2.auto_renew=false`, `meta.stripe.cancel_at_period_end=true`, доступ до конца периода не сокращает (memory: Club Status Integrity).

Тестовая sub — `sub_1Tg9B66UYJj2vm0Gx2Ghaoch`, действие = **`cancel_at_period_end`** (НЕ `cancel_now`).

---

## 5. Card data — что есть и что нужно

- `supabase/functions/stripe-webhook/index.ts` уже пишет `card_brand/card_last4/card_holder` в `checkout.session.completed` и `payment_intent.succeeded` (PATCH-LIVE-CARD, 2026-06-09). Для будущих платежей карточные поля будут заполняться автоматически.
- Для исторических 23 строк — пусто. Backlog F7 запрещает массовый backfill.
- Для одного `pi_3TgMkD6…` нужен targeted fetch (PATCH 4).

**Точка правки PATCH 4 (минимум):**

- Новая edge `stripe-card-data-fetch`:
  - super-admin guard (`requireSuperAdmin`);
  - body `{ payment_intent_id }`;
  - GET `https://api.stripe.com/v1/payment_intents/{id}?expand[]=latest_charge`;
  - UPDATE `payments_v2 SET card_brand, card_last4, card_holder WHERE provider_payment_id=$1` (одна строка, ничего больше);
  - audit `admin.stripe.card_data_targeted_fetch`.
- Применить к `pi_3TgMkD6UYJj2vm0G1ZUpRzvH` (отдельный invoke после approve).

---

## 6. Cleanup — KEEP/HIDE list (не выполнять без отдельного approve!)

**Модель hide:** soft через `payments_v2.meta`/`subscriptions_v2.meta`:

```
meta = jsonb_set(coalesce(meta,'{}'), '{cleanup_hidden}', 'true')
       || jsonb_build_object('cleanup_reason','phase8_dev_artifact',
                             'cleanup_actor','<admin uid>',
                             'cleanup_at', now()::text)
```

UI-фильтр (отдельный коммит): в `useUnifiedPayments` и `useContactProviderSubscriptions` исключать `meta->>'cleanup_hidden' = 'true'` И `provider_payment_id LIKE 'pi_sim_%'`.

**KEEP (НЕ трогать):**

```
payments_v2:
  2d40bc7e…  pi_3TgMkD6…    5 BYN  Сергей           ← KEEP_LIVE_5BYN
  d1859f0b…  pi_3Tf4ZA…   100 BYN  piletski.a       ← KEEP_CLIENT
  ec39fc8c…  pi_3Tf4WD…   100 BYN  Юлия Титовец     ← KEEP_CLIENT

subscriptions_v2:
  23b53a8d…  sub_1Tg9B66…  active  Сергей           ← KEEP_LIVE
```

**HIDE candidates (ждут approve):**

```
payments_v2 (19 строк):
  - 8 × dev Сергея (HIDE_SERGEY_DEV) — pi_3Tg9B3, pi_3Tg8Fx, pi_3Tfo8A, pi_3TfHgy, pi_3Tewf7, pi_3TeJWM, pi_3TeEq1 (10000 BYN, важно — review!)
  - 2 × pi_sim_*
  - 9 × sandbox без user_id (pi_3TeK* и re_3TeK*)
  - 1 × QA pi_3Tfb5Q (qa.user@gorbova.test) ← подтвердить

subscriptions_v2 (15 строк):
  - 12 × cs_test_* (HIDE_TEST_SESSION) — Сергей и QA users
  - 3 × canceled без session (REVIEW → safe HIDE)
```

**DO NOT TOUCH:**
- bePaid payments / subscriptions (вообще не в этом отчёте);
- `audit_logs`, `provider_events`, `access_grant_ledger`;
- любые `payments_v2` `provider='stripe'` с `KEEP_*` классом;
- refund-rows, записанные через `record_refund_atomic` (но в нашем списке refund-rows `re_3TeK*` идут вместе с pi_3TeK* sandbox-партиями без user_id — это синтетика Phase 6/7, hide вместе).

---

## 7. Follow-up fixes — статус для PATCH 5 (proof-only)

- **A. Stripe redirect URLs** — нужно прочитать `stripe-create-checkout/index.ts` и `stripe-create-subscription-checkout/index.ts`, зацитировать `success_url`/`cancel_url`. Проверка — read-only.
- **B. Telegram DM product/tariff names** — проверить `grant-access-for-order → telegram-grant-access` (memory: Canonical Telegram Grant Write-Path). Read-only + лог.
- **C. UI «Иностранная карта» enabled on mount** — `PaymentDialog`/`PaymentMethodSelector`. Read-only + UI-скрин.

Если discovery покажет несоответствие — выносим отдельным PATCH, не правим внутри 5.

---

## 8. Запреты на весь pack (повтор)

- Никаких Stripe test-card flows, Dashboard Resend, фиктивных webhook events.
- Никаких hard DELETE из `payments_v2`/`orders_v2`/`subscriptions_v2`/`audit_logs`/`provider_events`.
- bePaid flow и `record_refund_atomic` SOT не трогаем.
- Массовый card backfill — backlog F7, не сейчас.
- Никаких UPDATE без отдельного approve KEEP/HIDE списка.
- Клиентские (не-Сергей, не-QA) Stripe-записи — DO NOT TOUCH.

---

## 9. Что прошу подтвердить перед EXECUTE

1. **STOP-RISK test-mode Stripe:** окей ли, что текущая live-проверка PATCH 1/2 пройдёт по test-mode Stripe-секрету (`stripe_poland`), потому что и `pi_3TgMkD6…`, и `sub_1Tg9B66…` созданы через `cs_test_*` checkout. Реальных денег не вернётся / не спишется.
2. **PATCH 1 refund:** action = **`partial refund 1 BYN`** (минимальная сумма, не full), `access_action='keep'`, на `pi_3TgMkD6…`.
3. **PATCH 2 cancel:** action = **`cancel_at_period_end`** (НЕ `cancel_now`), на `sub_1Tg9B66…`.
4. **PATCH 4 card fetch:** разрешить создание `stripe-card-data-fetch` и одиночный invoke на `pi_3TgMkD6…`.
5. **PATCH 3 cleanup:** утвердить hide-список из §6. Сергеевский `pi_3TeEq1` 10000 BYN явно подтвердить отдельно — выглядит как крупный dev-checkout, но сумма большая.
6. **PATCH 5:** proof-only без правок кода.
7. **Порядок EXECUTE:** 1 → 2 → 4 → 5 → 3.

После approve по этим 7 пунктам — переходим к EXECUTE.
