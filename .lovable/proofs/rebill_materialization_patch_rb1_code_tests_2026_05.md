# PATCH-RB1 — REBILL materialization wired into bepaid-webhook (code + tests)

## Что сделано
Подключён уже существующий движок `runRebillFlow` в реальный диспетчер `supabase/functions/bepaid-webhook/index.ts` для повторных (cycle ≥ 2) списаний provider-managed подписок. Future-flow: каждое повторное списание создаёт отдельный `orders_v2` (REBILL-сделку), а не дописывает деньги в первичную сделку.

Historical repair двух кейсов (Юлия Смолик 100 BYN, Ольга Черкашина 250 BYN) в этом патче НЕ выполнялся — отдельный dry-run будет следующим шагом.

## Измененные файлы
- `supabase/functions/bepaid-webhook/index.ts` — импорты + REBILL guard перед `Update order to paid` + skip legacy `STEP A grant` при `rebillHandled=true`.
- `supabase/functions/bepaid-webhook/rebill_deps_adapter.ts` (новый) — live-адаптер `RebillFlowDeps` поверх Supabase-клиента: `findRebillOrderByOrderNumber`, `findMainPaymentByUid`, `sumRefundsForPaymentUid`, `checkSbsMismatchBeforeRebill`, `insertRebillOrder`, `insertPaymentRow`, `updatePaymentOrderId`, `invokeGrantAccess`, `mergeOrderMeta`, `writeAudit`.
- `supabase/functions/bepaid-webhook/patch_rb1_wiring_test.ts` (новый) — 6 regression-кейсов.

Не трогалось: `rebill_flow.ts`, `rebill_builders.ts`, `grant-access-for-order`, `subscriptions_v2`, `entitlements`, `access_rules`, провайдер-API, секреты, конфиг режима.

## Измененные элементы системы
- Edge function `bepaid-webhook` — повторно задеплоена (deploy OK).
- БД-схема — без изменений (миграций нет).
- Cron/jobs — без изменений.
- Secrets/env — без изменений. Контракт: `BEPAID_REBILL_MATERIALIZATION ∈ {off|dry_run|on}`. Дефолт = `off` (engine spec `resolveKillSwitchMode`), безопасно для production.

## Логика gating
```text
if (subscriptionState=='active' && tx.status=='successful'
    && rebillMode != 'off'
    && paid_billing_cycles >= 2
    && transactionUid && orderV2):
    runRebillFlow(...)
    if (!result.proceedLegacy):
        rebillHandled = true
        # legacy "Update order to paid" пропускается
        # legacy STEP A grant пропускается
        # STEPS C/D/E (provider-sync) выполняются как было
```
- `cycle == 1` (первая активация) → REBILL НЕ вызывается, legacy продолжает работать.
- `mode == off` → no-op, legacy не меняется.
- `mode == dry_run` → audit `bepaid.rebill.dry_run`, без INSERT/UPDATE, legacy продолжает.
- `mode == on` + грант упал → `manual_review` на REBILL, **никакого fallback на legacy access**.

## Подтверждение результата
### Tests
`supabase--test_edge_functions bepaid-webhook` → exit 0. Все 6 новых PATCH-RB1 тестов + 16 builders + 17 flow + 13 wiring + 7 canonical-writer-enforcement + 10 legacy-retirement = 0 failed.

```
PATCH-RB1: mode=on + repeat charge → REBILL materialized, legacy short-circuited ... ok
PATCH-RB1: mode=dry_run → audit only, no INSERT, legacy proceeds ... ok
PATCH-RB1: mode=off → no-op, no audits, legacy proceeds ... ok
PATCH-RB1: env-driven mode resolver covers on/dry_run/off ... ok
PATCH-RB1: failed grant → manual_review on REBILL, proceedLegacy stays false ... ok
PATCH-RB1: SBS mismatch pre-check → skip, no REBILL, manual_review on parent ... ok
```

### Deploy
`supabase--deploy_edge_functions bepaid-webhook` → `Successfully deployed`.

### Runtime mode proof (TODO до execute по historical)
До перевода в `on` в проде нужно отдельно подтвердить:
1. `BEPAID_REBILL_MATERIALIZATION` секрет действительно установлен и доступен в runtime (`Deno.env.get(...)` != null).
2. На реальном repeat-webhook’е в `audit_logs` появляется `bepaid.rebill.dry_run` (при `dry_run`) или `bepaid.rebill.materialized` (при `on`).
3. Logs `[WEBHOOK-SUBSCRIPTION] REBILL flow decision=...` показывают выбранный режим.

Рекомендуемая последовательность:
- сначала установить `BEPAID_REBILL_MATERIALIZATION=dry_run`, дождаться следующего реального автосписания, проверить audit_logs;
- затем перевести в `on` после подтверждения dry_run-аудита.

## Что не сделано
- Historical repair кейсов 17.05.26 (Юлия 100 BYN, Ольга 250 BYN) — НЕ выполнен. Это отдельный PATCH-RB2 после dry-run и approve, с проверкой «доступ уже продлён legacy?» и решением о вызове `grant-access-for-order`.
- Link-order orphan recovery через provider_subscriptions chain (кейс Юлии) — НЕ включён в RB1. Требует отдельной логики восстановления parent_order и попадёт в RB2/RB3.
- Включение `BEPAID_REBILL_MATERIALIZATION=on` в production — НЕ делалось. Текущий дефолт `off` гарантирует zero behavior change до явного переключения секрета.

## Следующие шаги
1. Перевести секрет `BEPAID_REBILL_MATERIALIZATION` в `dry_run`.
2. Дождаться следующего реального автосписания, забрать audit `bepaid.rebill.dry_run` как proof runtime-режима.
3. Подготовить PATCH-RB2 dry-run для двух historical uid: `21613f63-dc85-406f-a8dd-34a936bc0784` (Ольга) и `113f7667-369c-4cb2-8c88-c2b92bb854da` (Юлия).
4. Только после approve — переключить секрет в `on` и выполнить targeted repair.
