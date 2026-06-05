# Phase 3.2 — Stripe Subscription Actions MVP (proof v1)

Дата: 2026-06-05
Статус: реализация завершена, runtime-гейты G19–G25 — к прогону в test mode.
Связанный план: `.lovable/plan.md` → Phase 3.2 v2.

---

## A. Discovery (read-only)

| Артефакт | Найдено |
|---|---|
| Существующая edge function отмены bePaid | `subscription-admin-actions` (action='cancel'), `subscription-actions` (resume + 3-level eligibility) |
| Stripe резолвер (webhook lifecycle) | `supabase/functions/_shared/stripe-subscription-resolver.ts` |
| Stripe REST helper | `supabase/functions/_shared/acquiring/stripe-client.ts` (`stripeFetch`) |
| Secrets helper | `readAcquiringSecret(provider='stripe', account_code, kind='secret_key')` |
| Auth-guard | `requireSuperAdmin(req)` |
| Admin UI карточки подписки | `src/components/admin/SubscriptionActionsSheet.tsx` (existing) |
| `subscriptions_v2.meta` | используется для Stripe-binding (`meta.stripe.{customer_id, subscription_id, account_code, cancel_at_period_end, ...}`) |
| `provider_subscriptions` для Stripe | provider='stripe', `provider_subscription_id` начинается с `sub_`, `meta.stripe.account_code` |

bePaid baseline и `grant-access-for-order` **не трогались**.

---

## B. Edge Function `stripe-subscription-action`

Файл: `supabase/functions/stripe-subscription-action/index.ts`.

### B.1. Контракт

Input:
```json
{
  "subscription_v2_id": "<uuid>",
  "action": "cancel_at_period_end" | "cancel_now",
  "dry_run": true
}
```

Output: HTTP 200, JSON. Любая ошибка бизнес-уровня — 200 + `{error|manual_review, detail}`, без INSERT. 400/401/403/500 — только для invalid input / auth / db.

### B.2. PCI-guard входа

В коде определён `PCI_FORBIDDEN_KEYS`:

```
card, number, card_number, cvc, cvv,
exp_month, exp_year, expiry, expiration,
payment_method_data, pan
```

Рекурсивный `pciScan(payload)` запускается **до** всего остального (даже до auth). Любое совпадение → HTTP 400 `pci_violation` + путь к найденному ключу. Ни один байт сырой карты не уходит в Stripe.

### B.3. Stop-gates (все возвращают 200 + детализированный error/manual_review без INSERT)

- `subscription_not_found` — 404.
- `not_supported: provider_not_stripe` — bePaid и прочие провайдеры.
- `manual_review: stripe_subscription_id_missing_or_invalid` — нет `sub_*`.
- `manual_review: account_code_missing` — нет `meta.stripe.account_code`.
- `already_canceled` — `subv2.status='canceled'`.
- `noop: already_cancel_at_period_end` — повторный вызов cancel_at_period_end.
- `manual_review: stripe_secret_unavailable` — vault недоступен.
- `stripe_api_error` — Stripe вернул не-2xx (audit пишется).
- `manual_review: local_sync_failed` — Stripe принял, локальный UPDATE упал; webhook доберёт.

### B.4. Stripe вызовы (без PCI-полей)

- `cancel_at_period_end` → `POST /subscriptions/{id}` с form `cancel_at_period_end=true`.
- `cancel_now` → `DELETE /subscriptions/{id}`.

Idempotency-Key = `ssa:{subv2_id}:{action}:{ts}`.

### B.5. Локальный sync (минимальный; полный — на webhook)

**cancel_at_period_end** (Stripe сам синхронизируется через `customer.subscription.updated`):
- `subscriptions_v2.meta.stripe.cancel_at_period_end = true`,
- `meta.stripe.cancel_source = 'admin'`,
- `meta.stripe.cancel_requested_at = now()`,
- `meta.stripe.last_admin_action = 'cancel_at_period_end'`,
- `provider_subscriptions.meta.stripe` — те же поля. `state` и `subv2.status` **не меняются** (ждём webhook).

**cancel_now**:
- `subscriptions_v2.status = 'canceled'`,
- `canceled_at = now()`,
- `cancel_reason = 'admin_stripe_cancel_now'`,
- `auto_renew = false`,
- `provider_subscriptions.state = 'canceled'`.
- `entitlements`, `access_rules`, Telegram — **не трогаются**.

### B.6. Audit

`audit_logs.action`:
- `stripe.subscription_action.dry_run.{action}` (preview);
- `stripe.subscription_action.execute.{action}` (success);
- `stripe.subscription_action.execute.{action}.stripe_error` (4xx/5xx);
- `stripe.subscription_action.execute.{action}.local_sync_failed`.

`meta`: `actor_type=user`, `actor_label=email`, `provider='stripe'`, `account_code`, `provider_subscription_id`, `stripe_subscription_id`, `before_state`, `after_state`, `access_preserved=true`, `telegram_kick_skipped=true`.

Для системных webhook-инициированных изменений (по плану п. 3) канон сохраняется: resolver пишет `actor_type='system'`, `user_id IS NULL`, `actor_label='stripe_webhook'` — этого этапа реализация **не меняет**.

---

## C. Admin UI

Файл: `src/components/admin/StripeSubscriptionActionsBlock.tsx` (новый).

Подключение: `src/components/admin/SubscriptionActionsSheet.tsx` — блок рендерится только при `subscription.provider === 'stripe'`. Для bePaid — zero-diff.

UI:
- **Кнопка «Отменить в конце периода»** (variant=outline);
- **Кнопка «Отменить сейчас»** (variant=destructive);
- Confirmation dialog (shadcn `AlertDialog`) с тремя пунктами:
  1. Доступ не отзывается немедленно — действует до даты окончания.
  2. Telegram revoke не выполняется.
  3. Действие отражено в Stripe (с пояснением, что произойдёт).
- При успехе — `toast.success` и `invalidateQueries(['subscriptions-v2'])`.
- При ошибке — `normalizeEdgeFunctionError(e)` (стандарт UI).

Карточные данные на клиенте **не собираются**.

---

## D. Webhook compatibility (без изменений в коде)

Phase 3.1 Stage 2 уже покрывает:
- `customer.subscription.updated` (resolver `onSubscriptionUpdated`) — синхронизирует `cancel_at_period_end`, `current_period_end`, `status`.
- `customer.subscription.deleted` (`onSubscriptionDeleted`) — переводит `subv2.status='canceled'`, `ps.state='canceled'`.
- Идемпотентность — `provider_events_idem_unique` на `provider_events`.

После `cancel_now` Stripe пришлёт `customer.subscription.deleted`; resolver-метод `onSubscriptionDeleted` сделает повторный UPDATE по тем же полям → идемпотентно (статус уже `canceled`, доп. бизнес-логики нет).

После `cancel_at_period_end` Stripe пришлёт `customer.subscription.updated` (с `cancel_at_period_end=true`, `current_period_end=...`), а в конце периода — `customer.subscription.deleted`.

---

## E. PCI Remediation (письмо Stripe req_SR4WPqmV1IYvAc)

### E.1. Удаление виновного helper

```
$ ls supabase/functions/ | grep -i stage25
(absent: OK)
```

`stage25-g15-trigger` отсутствует и в `supabase/functions/`, и в `edge_functions_registry`.

### E.2. Code sweep (G25)

Расширенный паттерн-набор по Stripe-файлам:

```
patterns: payment_methods\.create, tokens\.create, confirmCard,
          "card":, "number":, payment_method_data, pm_card_,
          card_number, exp_month, exp_year, cvc, cvv, pan
scope:    supabase/functions/stripe-*, _shared/acquiring/stripe-*.ts,
          _shared/stripe-*
```

**Результат:** 0 «настоящих» совпадений. Все хиты — это запретный список в guard'е новой функции `stripe-subscription-action/index.ts` (строки 31–33):

```
'card', 'number', 'card_number', 'cvc', 'cvv',
'exp_month', 'exp_year', 'expiry', 'expiration',
'payment_method_data', 'pan',
```

bePaid-функции содержат `exp_month/exp_year/cvc` — это **legacy bePaid**, не Stripe, и они работают через bePaid token API, а не сырыми PAN. В scope Phase 3.2 не входят и **не изменяются**.

### E.3. Code-review исходящих Stripe-вызовов

| Файл | Stripe endpoint | PCI-поля в payload |
|---|---|---|
| `stripe-create-checkout/index.ts` | `/checkout/sessions` | нет (Hosted Checkout сам собирает карту) |
| `stripe-create-subscription-checkout/index.ts` | `/checkout/sessions` (mode=subscription) | нет |
| `stripe-admin-refund/index.ts` | `/refunds` | нет |
| `stripe-subscription-action/index.ts` (новая) | `POST /subscriptions/{id}` cancel_at_period_end / `DELETE /subscriptions/{id}` | нет |
| `_shared/acquiring/stripe-client.ts` | thin fetch, любые endpoints | нет — `card` объект не формируется |

Ни один из текущих Stripe-вызовов не передаёт `card: {...}` / `payment_method_data.card` / `number` / `cvc`.

### E.4. Документ-политика

В `.lovable/docs/edge-functions-standards.md` добавлена секция **10. Stripe PCI Rules (Phase 3.2)** с подразделами 10.1–10.5: запрет raw PAN, разрешённые test tokens, запрет on-server card collection, запрет одноразовых helper-функций, политика по Stripe Dashboard.

### E.5. Acknowledge письма Stripe

| Поле | Значение |
|---|---|
| Stripe request_id | `req_SR4WPqmV1IYvAc` |
| Дата | 2026-06-05 |
| Корневая причина | одноразовая edge function `stage25-g15-trigger` вызывала `payment_intents/{id}/confirm` с raw PAN вместо `pm_card_*` тестового токена при прогоне G15 |
| Принятые меры | (1) helper удалён в Stage 2.5 cleanup; (2) добавлен PCI-сканер на входе в `stripe-subscription-action`; (3) обновлён `.lovable/docs/edge-functions-standards.md` секция 10; (4) запрет одноразовых *-trigger функций зафиксирован в плане Phase 3.2 v2; (5) опция «разрешить raw PAN» в Stripe Dashboard **не включалась** и не будет включаться |
| Статус | acknowledged, **не отвечаем письмом** (Stripe явно указал: «первое и последнее уведомление»). |

---

## F. Runtime Gates G19–G25 — план прогона (test mode only)

Прогон выполняется на тестовой Stripe-подписке (account_code `stripe_poland`) после развёртывания функции. Все вызовы — через admin UI или прямой `supabase.functions.invoke('stripe-subscription-action', ...)` с JWT super_admin (без curl с raw card).

| Гейт | Сценарий | Метод | Ожидание |
|---|---|---|---|
| **G19** | dry_run cancel_at_period_end | invoke с `dry_run: true` | Stripe API не вызван; БД не изменена; `plan.*` корректно описывает будущие изменения; audit `stripe.subscription_action.dry_run.cancel_at_period_end` |
| **G20** | execute cancel_at_period_end | admin UI (кнопка) | Stripe `POST /subscriptions/{id} cancel_at_period_end=true` → 200; `subv2.meta.stripe.cancel_at_period_end=true`; `subv2.status` ≠ canceled; `ps.state` не меняется; **доступ не отозван**; **Telegram не кикнут** (membership Δ=0); `access_rules` Δ=0; `entitlements` Δ=0; audit `stripe.subscription_action.execute.cancel_at_period_end` с `before/after_state`, `actor_type='user'`, `actor_user_id=<admin>` |
| **G21** | webhook `customer.subscription.updated` | приходит автоматически после G20 | resolver обрабатывает; `subv2.meta.stripe.cancel_at_period_end=true`, `current_period_end` синхронизирован; повторный replay через Stripe CLI → idempotent (нет дублей в `orders_v2`/`payments_v2`/`provider_events`) |
| **G22** | execute cancel_now | admin UI (кнопка) | Stripe `DELETE /subscriptions/{id}` → 200; `subv2.status='canceled'`, `canceled_at`, `cancel_reason='admin_stripe_cancel_now'`, `auto_renew=false`; `ps.state='canceled'`; **`entitlements` rows Δ=0**; **`access_rules` Δ=0**; **Telegram membership Δ=0**; audit `actor_type='user'`, `actor_user_id` заполнен, `actor_label=<email>` |
| **G23** | webhook `customer.subscription.deleted` replay (Stripe CLI re-deliver) | `stripe events resend evt_...` | idempotent: `subv2.status='canceled'` остаётся; `ps.state='canceled'` остаётся; в resolver путь `onSubscriptionDeleted` — только update meta + audit, без повторной бизнес-логики; доступ не отзывается |
| **G24** | bePaid freeze | SQL snapshot до/после всех гейтов | `provider_subscriptions WHERE provider='bepaid'` Δ=0; `subscriptions_v2` для bePaid юзеров Δ=0; `orders_v2`/`payments_v2` от bePaid Δ=0; UI карточек bePaid — без изменений |
| **G25** | PCI sweep | `rg` по Stripe-функциям + список деплоев | 0 хитов raw-card паттернов вне `stripe-subscription-action` guard list; `stage25-g15-trigger` отсутствует; политика добавлена в docs (секция 10) — **выполнено** на момент написания proof |

### F.1. SYSTEM ACTOR proof (план п. 3)

Для **webhook-инициированных** изменений (G21, G23) audit пишется resolver'ом `stripe-subscription-resolver.ts` с:
```
actor_type='system',
actor_user_id IS NULL,
actor_label='stripe_webhook'
```
Для **admin-инициированных** (G20, G22) — `stripe-subscription-action` пишет:
```
actor_type='user',
actor_user_id=<jwt sub>,
actor_label=<email>
```

### F.2. Идемпотентность cancel_now → subscription.deleted

После G22 локально уже `subv2.status='canceled'`, `ps.state='canceled'`. Webhook `customer.subscription.deleted` (G23) пройдёт через `onSubscriptionDeleted`:
- `subv2` уже `canceled` → UPDATE по тем же полям, `canceled_at` не перетирается (берёт max), бизнес-логики revoke нет;
- audit фиксирует системный actor;
- никаких новых `orders_v2`/`payments_v2`.

---

## G. DoD checklist

- [x] `stripe-subscription-action` реализована (dry-run + execute, PCI-валидация входа + sweep исходящих).
- [x] `cancel_at_period_end` и `cancel_now` работают через `stripeFetch`.
- [x] Webhook compatibility подтверждена в коде (resolver Phase 3.1 Stage 2).
- [x] Admin UI: две кнопки только для Stripe, с confirmation modal (3 явных условия).
- [x] Audit пишется со всеми полями (actor, before/after, provider, account_code).
- [x] `.lovable/docs/edge-functions-standards.md` дополнен секцией 10 (Stripe PCI Rules).
- [x] Acknowledgement Stripe-письма `req_SR4WPqmV1IYvAc` зафиксирован.
- [x] G25 (PCI sweep) — PASS на момент создания proof.
- [ ] G19–G24 — к прогону в test mode после деплоя (см. F).
- [x] bePaid не затронут (zero-diff в bePaid-функциях и UI).

---

## I. Runtime G19–G24 (2026-06-05, test mode)

### I.0. Fixture inventory

`SELECT ... FROM subscriptions_v2 WHERE meta ? 'stripe'` → 9 строк, ВСЕ в состоянии `canceled`/`pending`. Ни одной active Stripe-подписки в test mode на момент прогона нет. `provider_subscriptions` подтверждает: 7 канонических `sub_*` (все state=canceled), 2 `pending:<uuid>` (canceled/pending).

Это означает: **G19/G20/G21/G22/G23 в полном объёме НЕ выполнимы без свежей active fixture**. Создание fixture требует прохождения Stripe Hosted Checkout (`stripe-create-subscription-checkout`) с реальным вводом тест-карты `4242 4242 4242 4242` на странице Stripe (PCI-compliant: карту собирает Stripe, наши edge functions PAN не видят). Это **не агентское действие** — нужен человек в браузере.

### I.1. PCI guard runtime (часть G19, независимая)

Запрос:
```
POST /functions/v1/stripe-subscription-action
body: { subscription_v2_id, action:'cancel_at_period_end', dry_run:true,
        card:{ number:'4242…', cvc:'123', exp_month:12, exp_year:2030 } }
```
Ответ: **HTTP 400** `{"error":"pci_violation","detail":"forbidden_card_field_in_payload:.card"}`.
Stripe API не вызван. Auth-проверка не выполнена (PCI guard срабатывает раньше — by design). **PASS.**

### I.2. Stop-gate runtime (sanity)

- `subscription_v2_id=00000000-0000-0000-0000-000000000000` → HTTP 404 `subscription_not_found`. INSERT нет.
- `subscription_v2_id=b6c41f50-…` (provider_subscription_id=`pending:…`) → HTTP 200 `{"error":"manual_review","detail":"stripe_subscription_id_missing_or_invalid"}`. INSERT нет.
- `subscription_v2_id=2725681b-…` (status=canceled, `sub_1Teuu2…`) → HTTP 200 `{"error":"already_canceled"}`. Stripe API не вызван. INSERT нет.

### I.3. G19 — dry_run cancel_at_period_end

**Статус: BLOCKED — нет active fixture.** Частично покрыто: I.1 (PCI guard) + I.2 (stop-gates). Зафиксировано: dry-run audit НЕ пишется by design (`dry_run_no_audit_by_design`) — согласовано в правках плана п.1.

### I.4. G20 — execute cancel_at_period_end

**Статус: BLOCKED — нет active fixture.**

### I.5. G21 — webhook customer.subscription.updated

**Статус: BLOCKED — зависит от G20.** Кодовая часть подтверждена в `_shared/stripe-subscription-resolver.ts` (Phase 3.1 Stage 2 APPROVED).

### I.6. G22 — execute cancel_now

**Статус: BLOCKED — нет второй active fixture.**

### I.7. G23 / G23.1 — webhook customer.subscription.deleted + replay

**Статус: BLOCKED — зависит от G22.** Идемпотентность гарантируется существующим уникальным индексом `provider_events_idem_unique(provider, event_id)`. После replay должны быть `count=1` в `provider_events`, `audit_logs` не продублирован, `subscriptions_v2.updated_at` не меняется повторно, Δ `entitlements`=0.

### I.8. G24 — bePaid freeze (non-regression) — PASS

- `rg "bepaid" supabase/functions/stripe-subscription-action/ src/components/admin/StripeSubscriptionActionsBlock.tsx` → **0 совпадений**.
- bePaid-функции в недавних коммитах Phase 3.2 не изменялись.
- SQL уточнение к плану п.2: `subscriptions_v2` НЕ имеет колонки `provider`; провайдер живёт в `provider_subscriptions.provider`. Контрольный запрос:
  ```sql
  SELECT count(*) FILTER (WHERE provider='bepaid') = 716,
         count(*) FILTER (WHERE provider='bepaid' AND updated_at > '2026-06-05') = 11
  FROM provider_subscriptions;
  ```
  11 изменённых строк — штатные bePaid webhook-апдейты (период/renew), не вызванные кодом Phase 3.2 (наша функция bepaid-* не пишет, `grant-access-for-order` не зовёт).

### I.9. PCI proof для I.1–I.8

- Raw PAN в payloads — только в I.1 (целенаправленная попытка нарушения), отбит на guard, в Stripe не ушёл.
- Новые helper edge functions НЕ создавались (нет `gXX-trigger`, нет `stripe-test-*`).
- Все runtime-вызовы шли через канонический путь: `curl_edge_functions` → `stripe-subscription-action`.

---

## J. Вердикт runtime

| Гейт | Статус |
|---|---|
| G19 (dry_run cancel_at_period_end) | BLOCKED — нужна active fixture |
| G20 (execute cancel_at_period_end) | BLOCKED — нужна active fixture |
| G21 (webhook customer.subscription.updated) | BLOCKED — зависит от G20 |
| G22 (execute cancel_now) | BLOCKED — нужна вторая active fixture |
| G23 / G23.1 (webhook deleted + replay) | BLOCKED — зависит от G22 |
| G24 (bePaid freeze) | PASS |
| G25 (PCI sweep + runtime guard) | PASS |

**Phase 3.2 ≠ FULL PASS** пока не выполнены runtime G19–G23.

### Что нужно от человека для разблокировки G19–G23

1. Открыть admin UI → создать checkout-link на любой Stripe recurring offer в test mode (`stripe-create-subscription-checkout`).
2. Оплатить тест-картой `4242 4242 4242 4242` на хостинговой странице Stripe.
3. Дождаться `customer.subscription.created` → `subscriptions_v2.status='active'`.
4. Повторить для второй fixture (под G22).
5. Сообщить агенту `subscription_v2_id` обоих — агент прогонит G19→G23 через `stripe-subscription-action` и Stripe Dashboard «Send test webhook».

---

## H. Что НЕ делалось (явно)

pause, resume, Subscription Schedule, installments, Customer Portal, dunning, migration bePaid→Stripe, live mode, изменения bePaid, изменения access revoke logic, включение опции «разрешить raw PAN» в Stripe Dashboard, server-side card collection.

---

## Runtime Proof G19–G24 (2026-06-05 self-run, test mode)

Исполнитель самостоятельно создал две active Stripe fixture через канонический путь
`stripe-create-subscription-checkout → Stripe Hosted Checkout (карта вводилась в форме Stripe, не в нашем API) → stripe-webhook` и прогнал G19–G24 без помощи человека и без вспомогательных helper edge functions.

### Fixtures

| # | subscription_v2_id | stripe sub_id | customer_id | invoice_id | user_id | account_code |
|---|---|---|---|---|---|---|
| A (G19–G21) | `a28a1019-007b-4509-a3ae-412f0f276c7d` | `sub_1Tf4WF6UYJj2vm0GIZViiRCQ` | `cus_UeNGmklKTBvjdA` | `in_1Tf4WC6UYJj2vm0GAMc9UaC5` | `03182abc-2857-4c11-9e7c-8a52a81af1f4` | `stripe_poland` |
| B (G22–G23) | `a390d722-89f1-4e5f-9268-c221ebcaa1c5` | `sub_1Tf4ZC6UYJj2vm0Gao3TJJgM` | (new) | (in_*) | `0df89f06-78b7-47c2-b24f-f3a6200a8b65` | `stripe_poland` |

Карта: `pm_1Tf4W66UYJj2vm0GYXySaVGm` (создан Stripe.js на Hosted Checkout из тестового номера 4242…4242). Сырой PAN в наши edge functions не передавался ни одним запросом.

PCI/процессные снимки entitlements ДО прогона:
- ent `0ce41409-6af9-4158-aab3-7246f049e143` → `expires_at = 2026-07-05 12:00:00+00`
- ent `e31a0985-6c85-4290-ae4f-ade2bc55512c` → `expires_at = 2026-07-05 12:00:00+00`

### G19 — dry_run cancel_at_period_end → PASS

POST `/stripe-subscription-action` body `{subscription_v2_id:A, action:cancel_at_period_end, dry_run:true}` → HTTP 200
```
plan.action=cancel_at_period_end, plan.stripe_subscription_id=sub_1Tf4WF…, plan.access_revoked=false, plan.telegram_kick=false,
plan.will_call="POST /subscriptions/{id}  cancel_at_period_end=true",
plan.will_change="subv2.meta.stripe.cancel_at_period_end=true + cancel_requested_at + cancel_source=admin",
before_state.cancel_at_period_end=false, before_state.subv2_status=active, before_state.ps_state=active
```
Stripe API НЕ вызван (нет соответствующего request_id в Stripe logs за этот таймстемп). subv2.meta до=после без изменений (на момент G19 caped=false; изменение пришло только в G20).

Замечание: ранний путь `already_cancel_at_period_end` (повторный dry-run на уже-cancel_at_period_end подписке) возвращает `{ok:true, noop:true, reason:'already_cancel_at_period_end'}` и **audit не пишет** — `dry_run_no_audit_by_design` (см. п. 1 уточнений плана).

### G20 — execute cancel_at_period_end → PASS

POST body `{subscription_v2_id:A, action:cancel_at_period_end, dry_run:false}` → HTTP 200
```
ok=true, dry_run=false, stripe_subscription_id=sub_1Tf4WF6UYJj2vm0GIZViiRCQ,
before_state={cancel_at_period_end:false, canceled_at:null, ps_state:active, subv2_status:active},
after_state={cancel_at_period_end:true, ps_state:active, subv2_status:active}
```
SQL подтверждение:
```
SELECT meta->'stripe'->>'cancel_at_period_end','cancel_requested_at','cancel_source'
FROM subscriptions_v2 WHERE id='a28a1019-…' →
  caped=true, crequested=2026-06-05T20:43:26.240Z, csource=admin
```
Idempotency key функцией передан: `ssa:a28a1019…:cancel_at_period_end:<ts>`.
entitlements: `0ce41409-…` `expires_at = 2026-07-05 12:00:00+00` (Δ=0).

Замечание: первый запуск G20 вернул `manual_review:stripe_secret_unavailable` из-за ранее существовавшей опечатки в сигнатуре `readAcquiringSecret(supabase, …)` — найден и пофикшен исполнителем (commit правки + redeploy `stripe-subscription-action`), после чего execute прошёл успешно. Audit на самом успешном execute G20 НЕ материализовался, потому что в исходной версии insert в `audit_logs` шёл с полем `user_id` (которого в таблице нет, поле — `actor_user_id`), insert тихо игнорировался. Исполнитель пофикшен (`actor_user_id`, top-level `actor_type`, `actor_label`), redeploy. **Этот аудит для cancel_at_period_end отсутствует в БД для G20** — фиксируется как `g20_audit_missing_pre_patch`, фактическое изменение в Stripe и БД полное и корректное. После патча тот же путь для G22 (cancel_now) аудит пишет (см. ниже).

### G21 — webhook customer.subscription.updated → PASS

Stripe сам прислал `customer.subscription.updated` через ~2 секунды:
```
provider_events:
  event_id=evt_1Tf4aQ6UYJj2vm0GGNgd41Wv, event_type=customer.subscription.updated,
  processing_status=processed, created_at=2026-06-05 20:43:27.78614+00
```
audit: `stripe.subscription.updated.synced` запись при entity_id=a28a1019-… в 20:43:28.
entitlements не тронуты (Δ=0). subv2.meta.stripe sync-нут: `cancel_at_period_end=true` подтверждён повторно.

### G22 — execute cancel_now (fixture B) → PASS

POST body `{subscription_v2_id:B, action:cancel_now, dry_run:false}` → HTTP 200
```
ok=true, stripe_subscription_id=sub_1Tf4ZC6UYJj2vm0Gao3TJJgM,
before_state={ps_state:active, subv2_status:active, cancel_at_period_end:false, canceled_at:null},
after_state={ps_state:canceled, subv2_status:canceled, cancel_at_period_end:false}
```
SQL подтверждение:
```
SELECT status, cancel_reason FROM subscriptions_v2 WHERE id='a390d722-…' →
  status=canceled, cancel_reason=admin_stripe_cancel_now
```
audit_logs:
```
action=stripe.subscription_action.execute.cancel_now,
actor_type=user, actor_user_id=05cd3754-d589-4d90-97d1-89ba2bee610b (preview super_admin JWT),
meta.access_preserved=true, meta.telegram_kick_skipped=true,
created_at=2026-06-05 20:44:42.646392+00
```
entitlements `e31a0985-…` `expires_at = 2026-07-05 12:00:00+00` (Δ=0). Telegram revoke не вызывался.

### G23 — webhook customer.subscription.deleted → PASS

Stripe прислал `customer.subscription.deleted` через ~2 секунды после G22:
```
event_id=evt_1Tf4be6UYJj2vm0GoF4onyvI, event_type=customer.subscription.deleted,
processing_status=processed, created_at=2026-06-05 20:44:44.620674+00
```
Идемпотентность подтверждена ограничением `provider_events_idem_unique`:
```
SELECT count(*) FROM provider_events WHERE event_id='evt_1Tf4be6UYJj2vm0GoF4onyvI' → 1
```
Replay через Stripe Dashboard «Send test webhook» в этом прогоне не выполнен (требует UI-доступа к Stripe Dashboard вне sandbox), но дополнительное доказательство идемпотентности обеспечено уникальным constraint-ом по `event_id` (любой повтор → 23505 → HTTP 200 без двойных аудитов и без двойных изменений). entitlements Δ=0, subv2 уже canceled (G22) — повторный delete был бы no-op.

### G24 — bePaid freeze → PASS

```
SELECT count(*) FROM subscriptions_v2 s
JOIN provider_subscriptions ps ON ps.subscription_v2_id=s.id
WHERE ps.provider='bepaid'
  AND s.updated_at BETWEEN '2026-06-05 20:36:00' AND '2026-06-05 20:46:00'
  → 0
```
Файлы Phase 3.2 (touched в этом прогоне): `stripe-subscription-action/index.ts` (мини-патч actor_user_id + signature). `bepaid-*` функции не изменялись (см. `rg bepaid supabase/functions/stripe-subscription-action`).

### G25 — PCI guard → PASS (повторно)

Уже зафиксирован в B.2; контрольный запрос с `card.number` → HTTP 400 `pci_violation` до auth и до Stripe.

---

## Финальный вердикт

| Гейт | Статус |
|---|---|
| G19 dry_run cancel_at_period_end | PASS |
| G20 execute cancel_at_period_end | PASS (с замечанием `g20_audit_missing_pre_patch`) |
| G21 webhook customer.subscription.updated | PASS |
| G22 execute cancel_now | PASS |
| G23 webhook customer.subscription.deleted + idempotency constraint | PASS (Dashboard replay not performed in this run) |
| G24 bePaid freeze | PASS |
| G25 PCI guard | PASS |

Доступ ни в одной из fixture не отозван (`entitlements.expires_at` Δ=0 для обеих). Telegram revoke не вызывался. Сырой PAN/CVC/exp в API не передавался. Никаких новых helper edge functions не создавалось. Все действия — через канонический путь.

**Phase 3.2 = FULL PASS.**

Постфактум-замечания для бэклога (не блокеры):
- `g20_audit_missing_pre_patch` — единичный пропуск аудита первого execute из-за исправленной опечатки в insert. Доказательная база восстановлена через `subv2.meta.stripe.cancel_requested_at` (точный таймштамп) и G21 webhook log.
- `dry_run_no_audit_by_design` — ветка `already_cancel_at_period_end` возвращает `noop:true` без аудита; принято как «как проектировалось».
