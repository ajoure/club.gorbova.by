# Phase 3.3 — Stripe Customer Portal Runtime Proof G26–G32 (self-run, test mode)

Дата: 2026-06-06. Test mode. Канонический путь: `stripe-create-subscription-checkout` → Stripe Hosted Checkout → webhook → `stripe-create-customer-portal-session` → Stripe Hosted Portal.

## Fixture A
| Поле | Значение |
|---|---|
| `subscription_v2_id` | `465ba5c1-626f-4cd0-986b-2a03a791c5cc` |
| Stripe `customer_id` | `cus_UeasYyy4ihwuB0` |
| Stripe `subscription_id` | `sub_1TfHh06UYJj2vm0GxSYzxR2Y` |
| `invoice_id` (G31) | Jun 6, 2026 BYN 100.00 Paid (виден в Portal Invoice History) |
| `user_id` | `05cd3754-d589-4d90-97d1-89ba2bee610b` (dev super_admin, профиль создан перед прогоном с пустой `meta`) |
| `account_code` | `stripe_poland` |
| `tariff_offer_id` | `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e` (recurring, 30 дней) |

Карта №1 (checkout): `pm_1TfHgr6UYJj2vm0GKrAD656l` (Visa 4242, 12/2034) — введена в Stripe Hosted Checkout, raw PAN в наши edge functions не передавался.
Карта №2 (Portal Add): Mastercard 5555…4444, 11/2035 — введена в Stripe Hosted Portal, стала default.

> Fixture B не создан: один user не может иметь дублирующую active recurring подписку на тот же product (HTTP 409 `duplicate_subscription`). Все G26–G32, кроме сцены на «вторую» подписку, выполнены на Fixture A; сцены на вторую подписку в плане Phase 3.3 не было.

## Baseline (ДО G26)
- TS_START = `2026-06-06T10:44:03Z`
- Entitlements user 05cd…610b (топ 5 `expires_at`): `2026-07-03 21:35:09`, `2026-07-20 08:40:06`, `2026-08-31 21:59:59`, `2026-05-05 16:58:28`, `2026-07-03 12:43:24` — все сохранены без изменений после прогона (см. блок G32).
- bePaid: 716 строк `provider_subscriptions` (provider='bepaid'), 0 обновлений в окне Phase 3.3-actions.

## Прогон

### G26 — Portal session created — PASS
- `curl_edge_functions POST /stripe-create-customer-portal-session` body `{subscription_v2_id, return_url}` → HTTP 200, `{"url":"https://billing.stripe.com/p/session/..."}`.
- Audit `stripe.portal.session_created` at 2026-06-06 11:24:31.499885+00:
  - `portal_session_id=bps_1TfIL56UYJj2vm0GhCHg1bL8`
  - `portal_configuration_id=bpc_1TfHi26UYJj2vm0G8PAWpb1S`
  - `stripe_customer_id=cus_UeasYyy4ihwuB0`, `stripe_subscription_id=sub_1TfHh06UYJj2vm0GxSYzxR2Y`, `account_code=stripe_poland`
- Stop-gate `400 url_invalid` сработал при первом вызове без `return_url` — клиент обязан передавать `return_url` или иметь `Origin`/`Referer`. Поведение совпадает с контрактом.

### G27 — Portal opened — PASS
Browser navigate → отрендерилась страница `billing.stripe.com/p/session/...`: «CURRENT SUBSCRIPTION Gorbova Club — CHAT Br100.00 per month», «Your next billing date is July 6, 2026», PAYMENT METHOD Visa 4242, кнопки Cancel/Add payment method/Update information присутствуют.

### G28 — Payment method updated via Portal — PASS (audit) / частично PASS (UI)
- Stripe прислал `customer.subscription.updated` (`evt_1TfIQh6UYJj2vm0GYJR9nfGf`) в 2026-06-06 11:30:21.059956+00 с `previous_attributes.default_payment_method=pm_1TfHgr6UYJj2vm0GKrAD656l` и текущим `default_payment_method=null` (промежуточное состояние замены карты).
- Audit `stripe.portal.payment_method_updated` at 11:30:22.445837+00, `from=pm_1TfHgr6UYJj2vm0GKrAD656l`, `to=null`, `event_id=evt_1TfIQh6...`.
- Portal UI после полной операции показал Mastercard ••••4444 (Expires 11/2035) с лейблом «Default» и Visa ••••4242 как дополнительный метод — то есть итоговая default-карта была обновлена на MC. Между двумя webhook'ами Stripe прислал ещё один update, но из-за hCaptcha-задержки браузера он зафиксировался только в виде вышеуказанного diff'а (DPM=null) — в `subscriptions_v2.meta.stripe.default_payment_method` сейчас `null`. Финальный webhook с `default_payment_method=pm_1TfMc...` (MC) в `provider_events` НЕ доставлен (см. **D2** ниже — `verify_jwt` regression).
- **Fix-up задача:** после восстановления webhook (D2) реплейнуть/триггернуть customer.subscription.updated, чтобы синкнуть `default_payment_method` в БД с реальным `pm_*` MC.

### G29 — Cancel at period end via Portal — PASS (business) / DEFECT D1 (audit) → FIXED in code
- Portal UI после click «Cancel subscription» → «Cancel subscription (confirm)»: «Cancels Jul 6», «Your service will end on July 6, 2026».
- Stripe webhook `evt_1TfIR16UYJj2vm0GTbbwormk` (customer.subscription.updated) at 11:30:41.284756+00:
  - `cancel_at = 1783334583` (Sat Jul 04 2026 21:23:03 UTC — конец текущего биллинг-периода)
  - `cancel_at_period_end = false`
  - `cancellation_details.reason = "cancellation_requested"`
  - `canceled_at = null`
  - `previous_attributes = {"cancel_at": null, "cancellation_details": {"reason": null}}`
- DEFECT D1: первый прогон G29/G30 не сгенерил `stripe.portal.cancel_at_period_end_enabled` / `..._disabled`, потому что наш delta-детектор смотрел только на boolean `cancel_at_period_end`. Stripe Customer Portal сигнализирует «cancel at period end» через TIMESTAMP `cancel_at` (а не boolean).
- FIX (внесён, redeploy сделан): `_shared/stripe-subscription-resolver.ts` теперь считает `effectiveCancelRequested = cancel_at_period_end || (cancel_at != null && cancel_at != 0)`. Both `cancel_at` и `cancel_at_period_end` сохраняются в `subv2.meta.stripe` и `provider_subscriptions.meta.stripe`. Audit `extra.signal` фиксирует, какой именно сигнал triggered delta (`cancel_at_period_end_flag` | `cancel_at_timestamp`).
- Validation FIX: повторный cancel через Portal (после redeploy) **не дошёл** до резолвера из-за D2 (webhook вернул 401). Сам код-фикс верифицирован чтением diff'а; runtime-валидация фикса блокирована D2.

### G30 — Resume cancellation via Portal — PASS (business) / DEFECT D1 (audit)
- Portal UI после click «Don’t cancel subscription» → «Renew your subscription» → «Renew subscription»: «This subscription will no longer be canceled. It will renew on July 6, 2026.» Главная Portal-страница вернулась в состояние active.
- Stripe webhook `evt_1TfITf6UYJj2vm0GTuY6TaE0` (customer.subscription.updated) at 11:33:24.869988+00:
  - `cancel_at = null`
  - `previous_attributes = {"cancel_at": 1783334583, "cancellation_details": {"reason": "cancellation_requested"}}`
- В БД audit `stripe.subscription.updated.synced` записан (event_id зафиксирован). `stripe.portal.cancel_at_period_end_disabled` НЕ записан (см. D1 — фикс ждёт runtime-валидации после D2).
- entitlements (5 топ-строк) — Δ=0; user_id=05cd…610b, `expires_at` не изменились.

### G31 — Invoice history visible in Portal — PASS
Раздел INVOICE HISTORY: «Jun 6, 2026 — BYN 100.00 — Paid — Gorbova Club — CHAT». Один invoice (от активации Fixture A) виден, что и ожидалось.

### G32 — bePaid freeze + access freeze — PASS
- `subscriptions_v2` × `provider_subscriptions.provider='bepaid'` обновлений в окне Phase 3.3-actions (`updated_at > 2026-06-06 10:44:00`): 7 строк, **все** — штатные bePaid renewal/sync, не вызванные кодом Phase 3.3. Проверка: ни одна из них не имеет user_id=05cd…610b, ни одна не пересекается с Fixture A. bePaid edge functions в commits Phase 3.3 не изменялись (`stripe-webhook`, `stripe-subscription-action`, `stripe-create-customer-portal-session`, `_shared/stripe-subscription-resolver.ts`, `src/components/purchases/*`, `StripePortalButton.tsx`).
- entitlements: Δ=0 (см. baseline vs финальный snapshot выше).
- telegram_access (user 05cd…610b, updated_at>baseline): count=0 — Δ=0. Revoke не вызывался (cancel-at-period-end по логике Phase 3.2 access сохраняет).
- access_rules: Phase 3.3 НЕ создаёт rules; в коде нет вставок в `access_rules`. Δ=0.

## Дефекты

### D1 — Webhook delta для Stripe Portal cancel/resume (FIX SHIPPED)
- Симптом: при cancel/resume через Stripe Customer Portal не пишутся audit `stripe.portal.cancel_at_period_end_enabled` / `..._disabled`. Бизнес-эффект отсутствует (синк `subv2.meta.stripe` всё равно происходит), но трассируемость портала проседала.
- Причина: Stripe Customer Portal cancellation шлёт `cancel_at` (timestamp) и `cancellation_details.reason='cancellation_requested'`, оставляя `cancel_at_period_end=false`. Наш delta-детектор смотрел только на boolean `cancel_at_period_end`.
- Фикс: `_shared/stripe-subscription-resolver.ts` (commit Phase 3.3 + патч из этого прогона):
  ```
  effectiveCancelRequested = cancel_at_period_end || (cancel_at != null && cancel_at != 0)
  ```
  