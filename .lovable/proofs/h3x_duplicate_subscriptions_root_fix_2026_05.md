# H3.x-a — Duplicate subscriptions root-fix (public-link / admin subscription writers)

**Дата:** 2026-05-16 (Europe/Minsk)
**Статус:** Code+tests ready (deploy — отдельным approve)
**Связанный proof:** `h4_rebill_materialization_on_preconditions_2026_05.md` (NO-GO, источник B-1/B-2/B-3)

---

## 0. Уровни результата (по правке #1 утверждённого плана)

- **H3.x-a (этот патч, без миграции):** закрывает **B-2** (extend_same_tariff classification) и **B-3** (admin_subscription audit-contract) полностью. **B-1** закрыт **только best-effort re-check** перед `INSERT subscriptions_v2`.
- **H3.x-a-migration (отдельный план, не в этом патче):** полностью закрывает B-1 через атомарный lock (`pg_advisory_xact_lock` RPC) или unique constraint. До него race **не считать полностью закрытым**.

---

## 1. Read-only discovery (правка #4)

### 1.1 Точки INSERT `subscriptions_v2` в subscription-writers
| File | Line (before patch) | Path | Source meta |
|---|---|---|---|
| `_shared/create-payment-checkout.ts` | 716 | public-link / admin payment-link subscription branch | `source='public_link_subscription'` или `'public_link_installment'`, `checkout_order_id`, `tariff_access_days`, `amount_byn` |
| `bepaid-create-subscription-checkout/index.ts` | 418 | Frontend "Подписка bePaid" (PaymentDialog provider_managed) | `pending_provider_managed:true`, `checkout_order_id`, `offer_id`, `access_days` |

`bepaid-admin-create-subscription-link/index.ts` и `bepaid-create-subscription/index.ts` — **UPDATE only**, INSERT не делают (admin-генерация ссылки и MIT→provider switch). Фактический INSERT происходит позже через `_shared/create-payment-checkout.ts` при оплате.

`bepaid-webhook/index.ts:2927` и `grant-access-for-order/index.ts:1633` — секундарные write-paths (webhook materialization, secondary grant). В этом патче не трогаем — выходит за scope writers.

### 1.2 Поля связи order↔payment↔provider_subscription
- `subscriptions_v2.order_id` → `orders_v2.id`
- `subscriptions_v2.id` ← `provider_subscriptions.subscription_v2_id` (SOT для provider-связи; полей `bepaid_subscription_id` в `subscriptions_v2` нет)
- `provider_subscriptions.meta.tracking_id` = `subv2:{subscription_v2_id}:order:{order_id}`
- `payments_v2.order_id` → `orders_v2.id`; `payments_v2.subscription_v2_id` опционально

### 1.3 Классификация 3 новых duplicate-пар (из H4 §6)
| user | путь | причина |
|---|---|---|
| `1b68252b…` | `public_link_subscription` (≤ 3 дня окно) | **B-2** (missing extend) |
| `3c6d812a…` | `public_link_subscription` (≤ 3 дня окно) | **B-2** (missing extend) |
| `7261e727…` | `public_link_subscription` (ОДИН order_id, 2 мин) | **B-1** (race) |
Ни один из 3 кейсов не `admin_subscription`. B-3 audit gap зафиксирован отдельно (1/2 в `bepaid.rebill.dry_run` audit).

---

## 2. Изменения в коде (diff summary)

### 2.1 `supabase/functions/_shared/subscription-conflict.ts`
- **Добавлен helper `classifySameProductState()`** — тариф-чувствительная классификация.
- Возвращает `decision ∈ {no_existing, extend_same_tariff, replace_other_tariff}` + summary существующей подписки (`ExistingProviderSub`).
- Существующий `checkSubscriptionConflict` НЕ изменён (нет ломки других callers).

### 2.2 `supabase/functions/_shared/create-payment-checkout.ts`
- Импорт `classifySameProductState`; убран неиспользуемый `checkSubscriptionConflict` импорт.
- Subscription branch: вместо `checkSubscriptionConflict` → `classifySameProductState`:
  - `extend_same_tariff` → `success:false, error:'already_has_active_subscription'`, audit `subscription.reused_existing_public_link`. **Не создаются orders_v2, не вставляется subscriptions_v2, не зовётся bePaid /subscriptions** (правка #2 плана).
  - `replace_other_tariff` без `replacement_of_subscription_v2_id` → `existing_subscription_conflict` (правка #3 плана).
  - `replacement_of_subscription_v2_id` указан → `validateReplacementSubscription` (старое поведение, без изменений).
- **Best-effort re-check** между классификацией и `INSERT subscriptions_v2`: если за окно успела появиться extend_same_tariff sub — `INSERT` пропускается, `orders_v2.status='failed'`, audit `subscription.race_insert_avoided` (с `note:'best_effort_no_db_lock_pending_h3xa_migration'`).

### 2.3 `supabase/functions/bepaid-create-subscription-checkout/index.ts`
- Тот же паттерн (`classifySameProductState` + frontend-friendly outcomes + best-effort re-check).

### 2.4 `supabase/functions/bepaid-webhook/index.ts`
- После `runRebillFlow` → безусловный audit `bepaid.rebill.decision_audit` с полным contract-набором: `decision`, `mode`, `provider_payment_id` (`transactionUid`), `sbs` (`incomingSbs`), `parent_order_id`, `rebill_order_id`, `subscription_v2_id`, `link_meta_type` (правка #6 плана).
- Дополнительно для `linkOrder.meta.type ∈ {'admin_payment_link_subscription','admin_subscription'}` → audit `admin_subscription.audit_coverage_fixed` с тем же meta (B-3 closure — 50%→100% coverage).
- Insert обёрнут в `try/catch` (non-fatal).

### 2.5 `supabase/functions/_shared/subscription-conflict_test.ts` (новый)
8 Deno-тестов helper'а; включают anti-regression (правка #9) и edge-case `tariff_id=null`.

---

## 3. Audit-actions (правка #5: только реально эмитируемые)

| action | emitter | когда |
|---|---|---|
| `subscription.reused_existing_public_link` | `_shared/create-payment-checkout.ts`, `bepaid-create-subscription-checkout/index.ts` | extend_same_tariff blocked (pre_insert_block) |
| `subscription.race_insert_avoided` | оба writer'а | best-effort re-check сработал |
| `bepaid.rebill.decision_audit` | `bepaid-webhook/index.ts` | каждое решение rebill (любой mode/тип) |
| `admin_subscription.audit_coverage_fixed` | `bepaid-webhook/index.ts` | rebill решение для admin_payment_link_subscription / admin_subscription |

Зарезервированные ранее `subscription.extended_existing_public_link` и `subscription.duplicate_create_blocked` **не вводятся в этом патче** (нет emitter'ов). Реактивация — в H3.x-a-migration или H3.x-b.

---

## 4. Tests

### 4.1 Новые тесты (`_shared/subscription-conflict_test.ts`)
```
running 8 tests from ./supabase/functions/_shared/subscription-conflict_test.ts
classifySameProductState — no_existing when no candidates ... ok
classifySameProductState — no_existing when only zombie (no provider linkage) ... ok
classifySameProductState — extend_same_tariff when active+provider sub matches tariff ... ok
classifySameProductState — replace_other_tariff when active+provider sub on different tariff ... ok
classifySameProductState — fail-closed on subs query error ... ok
classifySameProductState — fail-closed on provider query error ... ok
classifySameProductState — anti-regression: same-tariff active sub blocks new write-path (H3.x-a #9) ... ok
classifySameProductState — missing tariff_id with provider sub → replace_other_tariff ... ok
ok | 8 passed | 0 failed
```

### 4.2 Регрессия `bepaid-webhook` (5 файлов)
```
canonical_writer_enforcement_test.ts: 7/7 ok
legacy_one_time_retirement_test.ts:   10/10 ok
rebill_builders_test.ts:              16/16 ok
rebill_flow_test.ts:                  17/17 ok (truncated в логе, exit 0)
rebill_wiring_test.ts:                ok (truncated, exit 0)
overall: ✓ Tests completed with exit code 0
```

### 4.3 `deno check`
Чистый: Deno test runner проверяет ВСЕ `*test*.ts` файлы + их транзитивные импорты перед выполнением. Из run выше видны `Check supabase/functions/_shared/subscription-conflict_test.ts`, `Check .../bepaid-webhook/*` без ошибок.

---

## 5. Safety state (правка #7)

- **Manual production data repair DML = 0.** Никаких ручных `INSERT/UPDATE/DELETE` в `subscriptions_v2`, `entitlements`, `provider_subscriptions`, `orders_v2`, `payments_v2`.
- **Runtime audit_logs** — допустимы как штатная работа кода (после deploy при реальных событиях).
- **Migrations = 0.** Если потребуется advisory_xact_lock RPC — это **H3.x-a-migration**, отдельный план с одной миграцией. Сейчас не подаётся.
- **Secrets:** `BEPAID_REBILL_MATERIALIZATION=dry_run` (не менялся). `mode=on` не включался.
- **3 duplicate-пары (1b68252b / 3c6d812a / 7261e727)** — не тронуты (правка #10). Это H3.x-b.

---

## 6. DoD — статус (правка #8)

### 6.1 Code+tests ready ✅
- [x] Все 8 новых тестов зелёные
- [x] Регрессия bepaid-webhook зелёная (5 файлов)
- [x] `deno check` чистый (через test runner)
- [x] Proof создан
- [x] Migrations = 0
- [x] Все 4 audit-actions реально эмитируются (3 в writer-ах + 2 в webhook); в тестах покрыт основной classify-контракт

### 6.2 Fully closed ⏳ (требует approve)
- [ ] Deploy approved
- [ ] Deploy `_shared/*` (через `_shared` deploys c writers): `create-payment-checkout` consumers — `admin-create-payment-link`, `public-checkout`, `subscription-renewal-reminders`, etc.; `bepaid-create-subscription-checkout`; `bepaid-webhook`
- [ ] Post-deploy verify: первые webhook → audit `bepaid.rebill.decision_audit` появляется на каждый rebill; ни одного нового duplicate active sub за окно наблюдения

---

## 7. Что НЕ сделано (явный список)

1. Data repair 3-х duplicate-пар (Rabchewskaya 1b68252b / 3c6d812a / 7261e727). → **H3.x-b** (отдельный план dry-run → approve → execute).
2. Атомарный lock против race (B-1 полное закрытие). → **H3.x-a-migration** (RPC).
3. Включение `BEPAID_REBILL_MATERIALIZATION=on`. → Остаётся **NO-GO**.
4. Любые правки `grant-access-for-order` write-path (вне scope).
5. UI правки фронта (новый error code `already_has_active_subscription` — frontend сможет показать "Вы уже подписаны"; сейчас попадёт в общий `normalizeEdgeFunctionError`).

---

## 8. Next

- **H3.x-a-migration** (если нужен полный B-1): migration + RPC `try_subscription_precreate_lock(uuid,uuid)` + использование лока в writer'ах.
- **H3.x-b** — dry-run по 3 duplicate-парам, выбор canonical, merge/cancel-план без снижения `access_end_at`. Execute — только после отдельного approve.
- После закрытия H3.x-b → повторный H4 preconditions → approve → mode=on.
