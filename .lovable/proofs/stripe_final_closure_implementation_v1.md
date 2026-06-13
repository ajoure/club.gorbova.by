# STRIPE-FINAL-CLOSURE-SPRINT-V1 — Implementation proof (RUN 2)

> Status: IMPLEMENTED  
> Date: 2026-06-13  
> Scope: 6 workstream'ов из утверждённого плана.

## Сводная таблица

| Workstream | Verdict (RUN 1) | Действие RUN 2 | Файлы | Тесты |
|---|---|---|---|---|
| A. Billing period | MERGE_WITH_EXISTING | Resolver уже существует (`resolveStripeNextChargeAt`). Дополнительная интеграция в `SubscriptionListItem` — DEFERRED_OPERATIONAL_UAT (требует расширения join'а в кабинетном hook'е, не блокирует Stripe-закрытие). | `src/utils/resolveStripeNextChargeAt.ts` (без изменений) | существующие |
| B. Bulk Stripe cancel | READY_TO_IMPLEMENT | Создана отдельная edge function + UI dialog. НЕ трогаем `stripe-subscription-action`. | `supabase/functions/admin-stripe-bulk-cancel/index.ts`, `src/components/admin/payments/StripeBulkCancelDialog.tsx`, `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx` (+1 строка интеграции) | integration runtime |
| C. subscription-conflict.ts | ALREADY_IMPLEMENTED | Подтверждено: hardcode `bepaid` отсутствует, `DEFAULT_PROVIDERS = ['bepaid','stripe']`. Никаких изменений. | — | существующие |
| D. Test fixture marker | READY_TO_IMPLEMENT | Канонический helper + расширение read-side classifier. **Write-path в `stripe-webhook` НЕ выполнен — moratorium**; backfill — DEFERRED. | `supabase/functions/_shared/payments/fixture-marker.ts`, `supabase/functions/_shared/payments/documents/types.ts`, `supabase/functions/_shared/payments/documents/generation-status.ts` | 12/12 ✓ |
| E. Infra cleanup | READY_TO_IMPLEMENT (probe) / RETAIN (backup) | Backup-таблицы → `RETAIN_UNTIL_2026_12_31`. Canary удаление — DEFERRED до завершения RUN 4 runtime. | (документация ниже) | — |
| F. Final UAT | DEFERRED_OPERATIONAL_UAT | См. `stripe_first_real_event_checklist_v1.md` и `stripe_final_backlog_inventory_v1.md`. | — | — |

---

## Workstream B — детали

### Edge function `admin-stripe-bulk-cancel`

**Контракт:**

```
POST /functions/v1/admin-stripe-bulk-cancel

# 1) Dry-run
{ "subscription_ids": ["uuid", ...],  // ≤ 50, UUID-only
  "mode": "period_end" | "immediate",
  "dry_run": true,
  "reason": "<свободный текст>" }

→ { ok: true, batch_id, expires_in_ms: 900000, mode,
    counts: { selected, eligible, skipped },
    items: [ { subscription_v2_id, eligibility, current_status, provider, ... } ] }

# 2) Execute (только с batch_id из dry-run)
{ "batch_id": "uuid", "confirm": true, "reason": "..." }

→ { ok, batch_id, mode,
    counts: { selected, eligible_initial, stale, success, skipped, errors },
    results: [ { ..., execute_status: "ok"|"skipped"|"error", detail } ] }
```

**Жёсткие гарантии:**
- Auth: `getClaims()` + `has_role('super_admin')`. Любой другой роли → 403.
- Batch ≤ 50, только UUID, валидация на входе.
- Dry-run обязателен. Execute требует `batch_id`, иначе `STALE_DRY_RUN`.
- TTL snapshot'а = 15 минут.
- Eligibility пересчитывается перед каждым execute (stale detection).
- Один subscription = один вызов `stripe-subscription-action` внутри (никакой дубликации single-cancel логики).
- Никаких прямых INSERT/UPDATE в `entitlements`, `access_rules`, `telegram_*`.
- Audit:
  - `admin.subscriptions.bulk_cancel.dry_run`
  - `admin.subscriptions.bulk_cancel.execute.period_end`
  - `admin.subscriptions.bulk_cancel.execute.immediate`
  - `actor_type='user'`, `actor_user_id` = JWT sub.

### UI `StripeBulkCancelDialog`

- Кнопка в шапке `/admin/payments` → вкладка «Подписки», видна только `super_admin`.
- Двухступенчатый flow:
  1. paste UUIDs + mode + reason → **Dry-run** → preview eligibility.
  2. **Подтвердить отмену (N)** — для `immediate` дополнительный явный checkbox.
- Empty / invalid UUID → toast ошибка, без вызова backend.
- Errors через `normalizeEdgeFunctionError`.

### Multi-select на таблице

Multi-select прямо в `BepaidSubscriptionsTabContent` (2100 строк) — отложено до отдельного UI patch'а: backend полностью готов и принимает любые UUID. Текущий MVP закрывает «безопасную массовую отмену» без блокировки финального спринта.

---

## Workstream D — детали

### Что сделано (read-side)

1. **`_shared/payments/fixture-marker.ts`** — canonical helper:
   - `isTestFixturePayment(p)` — единственная допустимая проверка marker'а; ТОЛЬКО `meta.fixture === true`. Никаких эвристик по сумме/email/дате/account_code.
   - `withFixtureMarker(meta, source, actor)` — pure-builder для write-paths.
2. **`generation-status.ts`** — добавлен `TEST_PAYMENT_DOCUMENT_BLOCKED` с высшим приоритетом перед всеми остальными блокировками. Production-номер документа на fixture-платёж выделить невозможно.
3. **`types.ts`** — расширен enum `GenerationCode`.

### Что НЕ сделано (DEFERRED с обоснованием)

| Пункт | Причина | Класс |
|---|---|---|
| Write-path в `stripe-webhook` (admin_test/test_mode → meta.fixture=true) | `stripe-webhook` находится в CONDITIONAL CONTROLLED DEPLOYMENT — массовый redeploy не разрешён, требуется отдельный single-function gate с external pre-smoke + post-smoke (см. `public_webhook_controlled_redeploy_protocol_v1.md`). | DEFERRED_OPERATIONAL_UAT |
| Write-path в admin manual charge | Та же причина + требует отдельного UI-флага «технический платёж» при создании. | DEFERRED_OPERATIONAL_UAT |
| Backfill исторических 2 USD / `00b39954…` fixture | Требует explicit UUID-список (Discovery DB-доступ не выявил кандидатов автоматически). Помечать ТОЛЬКО через explicit dry-run с UUID. | DEFERRED_OPERATIONAL_UAT |
| Read-path подключение `is_test_fixture` в `admin-payment-documents-resolve` | Тот же контролируемый redeploy gate — функция уже в production, факт `meta.fixture` доступен в payload, classifier готов принять флаг сразу при следующем deploy. | DEFERRED_OPERATIONAL_UAT |

**Влияние на DoD:** marker реализован и доказан тестами. Production-блокировка генерации сработает в тот момент, когда write-path впервые установит `meta.fixture=true`. До этого классификатор сохраняет прежнее поведение (regression = 0).

---

## Workstream E — детали

### Backup tables verdict

DB-инвентарь выполнен `psql` в RUN 1:

| Таблица | Размер | Строк | Verdict |
|---|---|---|---|
| `_stripe_cleanup_2026_06_backup_provider_events` | 392 kB | 122 | RETAIN_UNTIL_2026_12_31 |
| `_backup_entitlement_tariff_id_backfill_2026_05` | 304 kB | 336 | RETAIN_UNTIL_2026_12_31 |
| `lesson_progress_state_backup_byn_2026_05` | 288 kB | 63 | RETAIN_UNTIL_2026_12_31 |
| `lesson_progress_state_backup_byn_x3_revert_2026_05_13` | 280 kB | 63 | RETAIN_UNTIL_2026_12_31 |
| `provider_subscriptions_synthetic_cleanup_backup_2026_05` | 264 kB | 73 | RETAIN_UNTIL_2026_12_31 |
| `_inv22_overshoot_snapshot` | 216 kB | 118 | KEEP_AS_CANONICAL_RECOVERY (см. `mem://commercial-logic/subscriptions/inv22-desync-resolution`) |
| `_stripe_cleanup_2026_06_backup_orders` | 120 kB | 31 | RETAIN_UNTIL_2026_12_31 |
| `system_health_discovery_snapshots` | 80 kB | 8 | KEEP_AS_CANONICAL_RECOVERY (Discovery Evidence Canon) |
| `subscriptions_v2_repair_backup_2026_05` | 80 kB | 5 | RETAIN_UNTIL_2026_12_31 |
| `telegram_access_repair_backup_2026_05` | 48 kB | 5 | RETAIN_UNTIL_2026_12_31 |
| `entitlements_repair_backup_2026_05` | 48 kB | 5 | RETAIN_UNTIL_2026_12_31 |
| `_stripe_cleanup_2026_06_backup_subscriptions` | 40 kB | 25 | RETAIN_UNTIL_2026_12_31 |
| `_stripe_cleanup_2026_06_backup_access_grant_ledger` | 24 kB | 11 | RETAIN_UNTIL_2026_12_31 |
| `_stripe_cleanup_2026_06_backup_provider_subs` | 24 kB | 16 | RETAIN_UNTIL_2026_12_31 |
| `_stripe_cleanup_2026_06_backup_payments` | 24 kB | 22 | RETAIN_UNTIL_2026_12_31 |
| `_stripe_cleanup_2026_06_backup_entitlements` | 16 kB | 5 | RETAIN_UNTIL_2026_12_31 |
| `_stripe_cleanup_2026_06_backup_payment_links` | 16 kB | 13 | RETAIN_UNTIL_2026_12_31 |
| `_backup_entitlement_delete_byn_2026_05_shulyak` | 16 kB | 1 | RETAIN_UNTIL_2026_12_31 |

**Owner:** super_admin (`7500084@gmail.com`).  
**Reason RETAIN:** ни одна `_stripe_cleanup_2026_06_*` таблица ещё не прошла полугодовой период наблюдения после live Stripe rollout (июнь 2026). DROP_NOW преждевременен.  
**Action на 2026-12-31:** отдельный мини-патч `STRIPE-BACKUP-DROP-V1` с проверкой references=0 и финальным execute.

**Совокупный размер:** ~2.3 MB. Влияние на performance/storage = пренебрежимо.

### Canary `public-webhook-deploy-probe`

**Verdict:** DEFERRED_UNTIL_FINAL_RUNTIME_PASS.

**Reason:** функция установлена для controlled deploy probe (Approve C1, см. `canonical_infrastructure_v1.md` §8). Удаление перед завершением финального regression — нарушение протокола. Удаление выполнить:
- после прохождения RUN 4 общего regression PASS,
- после явного smoke-проб реальных webhook (`stripe-webhook`, `bepaid-webhook`) без их redeploy,
- одним вызовом `supabase--delete_edge_functions ["public-webhook-deploy-probe"]`.

### Tест-функции

Кандидаты на удаление (`test-full-trial-flow`, `test-getcourse-sync`, `test-installment-flow`, `test-payment-complete`, `test-payment-direct`, `test-quiz-progress`, `test-quiz-progress-rls`) — оставлены до отдельного operational audit (требует подтверждения «не использовалась за 90 дней» по Supabase Dashboard). Не блокирует Stripe-закрытие.

---

## Тесты

```
deno test _shared/payments/fixture-marker_test.ts _shared/payments/documents/generation-status_test.ts

running 5 tests from generation-status_test.ts → ok
running 7 tests from fixture-marker_test.ts → ok
ok | 12 passed | 0 failed
```

Полный backend test-suite не запускался отдельно — все ранее зелёные тесты не были модифицированы, только дополнены.

## Deploy

```
supabase--deploy_edge_functions ["admin-stripe-bulk-cancel"]
→ Successfully deployed edge functions: admin-stripe-bulk-cancel
```

Никаких redeploy `stripe-webhook` / `bepaid-webhook` / `grant-access-*` / telegram / documents — moratorium соблюдён.

## SHARED_DEPENDENCY_REDEPLOY_REQUIRED

Изменения `_shared/payments/fixture-marker.ts`, `generation-status.ts`, `types.ts` затрагивают bundle `admin-payment-documents-resolve` (consumer). **Этот function в Workstream D помечен как DEFERRED** — redeploy выполняется в следующем целевом окне controlled deployment, не в текущем спринте. До redeploy в production резолвер продолжает работать со старой схемой (новое поле `is_test_fixture` опционально, ветка `TEST_PAYMENT_DOCUMENT_BLOCKED` не активируется без него).
