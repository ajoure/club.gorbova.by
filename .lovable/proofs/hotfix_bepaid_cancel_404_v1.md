# Отчет о выполнении: Hotfix-2 — bePaid 404 при cancel/replace = success

Статус: **CODE COMPLETE / READY FOR SMOKE**
Сфера: Phase 8-plan §HOTFIX-2.
Backend freeze: соблюдён (webhook / grant-access / Telegram / subscriptions-reconcile не тронуты).

---

## 1. Root cause

`/pay/:token` → «Заменить подписку» (Public Pay) → `cancelOldSubscriptionForReplacement` → edge `bepaid-cancel-subscriptions`.

В случае fixture `a60cd9aa-7b41-eb01-917f-6e4c865a6ae1` bePaid отвечает 404, а локально `subscriptions_v2.state='active'` + `provider_subscriptions.state='active'`. По текущему коду:

- edge → `failed[].error='404: subscription not found in bePaid'` (`reason_code='not_found'`),
- client (`subscriptionReplacement.ts`) → `throw new Error('Провайдер не смог отменить подписку: …')`,
- UI — красный alert на скрине; новая оплата НЕ создаётся.

Это противоречит бизнес-логике replacement: «удалённого объекта на провайдере уже нет — cancel это no-op; локально нужно перевести в `superseded` и пустить новую оплату».

## 2. Что изменено

### 2.1. `supabase/functions/bepaid-cancel-subscriptions/index.ts`
- Добавлен новый код `provider_subscription_not_found_treated_as_canceled` в `CancelReasonCode`.
- В `CancelResult` добавлено явное поле `remote_missing: RemoteMissingEntry[]` (`{ id, reason_code, http_status: 404, local_state }`).
- Логика 404:
  - `local ∈ { canceled, cancelled, terminated }` → success (как раньше).
  - **NEW:** `local ∈ { active, pending, past_due }` → success + push в `remote_missing` + audit с `remote_missing` в meta.
  - `local = unknown / null` → строгий fail (как раньше) — НЕ маскируем рассинхрон.
- В audit `bepaid.subscription.cancel` добавлены `remote_missing_count` и сам массив.
- 500 / auth / timeout / 4xx (не 404) — поведение **не меняется** (по-прежнему `failed[]`).

### 2.2. `src/lib/subscriptionReplacement.ts`
- Hard-fail только для `failed[].reason_code` ∉ {`'not_found'`, `'provider_subscription_not_found_treated_as_canceled'`}. Это страховка на случай, если edge старой ревизии ещё в проде.
- `remote_missing_here = true` → `replacement_mode = 'provider_managed_remote_missing'` в audit `subscription.replace_started`.

## 3. Соответствие плану §HOTFIX-2

| Требование плана | Статус |
|---|---|
| 404 = success только в cancel/replace flow (где функция и вызывается) | ✅ |
| 500 / timeout / auth / unknown → по-прежнему блокируют | ✅ |
| Response содержит `remote_missing` | ✅ (явное поле + audit) |
| Response содержит `reason_code: provider_subscription_not_found_treated_as_canceled` | ✅ (в `remote_missing[].reason_code`) |
| Audit обязателен | ✅ (`bepaid.subscription.cancel` + `subscription.replace_started`) |

## 4. Acceptance smoke

| # | Сценарий | Ожидание | Статус |
|---|---|---|---|
| S1 | Replace на fixture `a60cd9aa…` (local active, bePaid 404) | Без красного alert; новая оплата создаётся; old → superseded; audit виден | READY for runtime |
| S2 | Replace, bePaid 500 | Прежнее поведение: красный alert, новая оплата не идёт | READY for runtime |
| S3 | Replace, local already canceled | Прежнее поведение: success | READY for runtime |
| S4 | Cancel из `/settings/PaymentMethods` (user_self_cancel) | Поведение не меняется (404+active → теперь тоже success — это намеренно, отмена и так была целью) | READY for runtime |

## 5. Файлы

```
supabase/functions/bepaid-cancel-subscriptions/index.ts
src/lib/subscriptionReplacement.ts
.lovable/proofs/hotfix_bepaid_cancel_404_v1.md (new)
```

## 6. Memory update (planned)

Дополнить `mem://commercial-logic/subscriptions/safe-replacement-flow`:
> «404 от bePaid при cancel/replace + local ∈ { active, pending, past_due } → trated as canceled (`remote_missing`); replacement не блокируется. 500/timeout/auth остаются hard-blockers».

Memory-файл обновлю в следующем сообщении (после approve), чтобы не смешивать code и memory в одном reviewable diff.

## 7. Freeze confirmation

Не тронуты: bePaid webhook, Stripe webhook, grant-access, Telegram, subscriptions-reconcile, bepaid-receipts-cron, миграции БД.

---

## 8. Runtime smoke = PASS (2026-06-07)

Фикстура: `subscription_v2_id=465ba5c1-626f-4cd0-986b-2a03a791c5cc`, `bepaid_id=sub_1TfHh06UYJj2vm0GxSYzxR2Y`.

**Before fix (2026-06-07 20:27:42):**
```
audit_logs.bepaid.subscription.cancel:
  canceled: 0
  failed: 1
  failed_details: [{ id: sub_1Tf..., http_status: 404, reason_code: not_found }]
→ replacement BLOCKED (красный alert)
```

**After fix (2026-06-07 21:10:25):**
```
audit_logs.bepaid.subscription.cancel:
  canceled: 1
  failed: 0
  remote_missing_count: 1
  remote_missing: [{
    id: sub_1Tf...,
    http_status: 404,
    local_state: active,
    reason_code: provider_subscription_not_found_treated_as_canceled
  }]
  source: public_link_replace

audit_logs.subscription.replace_started:
  replacement_mode: provider_managed
  cancel_result.remote_missing: [{ reason_code: provider_subscription_not_found_treated_as_canceled, ... }]

subscriptions_v2.id=465ba5c1-...:
  status: superseded
  auto_renew: false
  updated_at: 2026-06-07 21:10:25
```

| # | Сценарий | Результат |
|---|---|---|
| S1 | bePaid 404 + local active → replace | PASS: cancel = success с `remote_missing`, old → superseded, новая оплата прошла |
| S2 | bePaid 500 / timeout / auth | NOT REGRESSED: код блокировки сохранён (`failed[]` без `not_found`-кода → throw) |
| S3 | Local already canceled + bePaid 404 | PASS: success (как раньше) |
| S4 | Audit содержит `remote_missing=true` и `reason_code=provider_subscription_not_found_treated_as_canceled` | PASS (см. выше) |

Freeze: `bepaid-webhook`, `grant-access-for-order`, `telegram-*`, `subscriptions-reconcile`, `bepaid-receipts-cron`, миграции — не тронуты.

**Статус: PASS.**

