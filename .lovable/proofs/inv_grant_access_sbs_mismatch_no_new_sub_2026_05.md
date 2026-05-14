# §F — SBS mismatch → no-new-sub guard (grant-access-for-order)

**Тип:** code-patch без production data DML.
**Scope:** 1 файл — `supabase/functions/grant-access-for-order/index.ts`.
**Миграций:** 0.
**Production data DML:** 0 (см. anti-side-effect ниже).

## Контекст

После Этапа 3.1 SBS-MATCH guard ставил `manual_review=true` и пропускал extend, но управление падало дальше → срабатывала ветка create-new subscription (sub + entitlement INSERT). Это нарушает контракт: recurring rebill с чужой `bepaid_subscription_id` не должен материализовать новую sub-цепочку.

§F закрывает это early-return'ом строго в первом recurring-mismatch guard.

## Diff (semantic)

Файл: `supabase/functions/grant-access-for-order/index.ts`, блок `skipReason === "skip_extend_bepaid_subscription_mismatch"` (~line 767–792 → ~767–897).

**Before:** audit + meta-merge + проваливание дальше → create-new sub (INSERT subscriptions_v2 + entitlements + telegram_access_queue).

**After (порядок строго):**
1. Запрос ВСЕХ кандидатов `subscriptions_v2` по `(user_id, product_id, status ∈ {active,trial,past_due})` + резолв их `bepaid_sbs` через `provider_subscriptions` (fallback на `meta.bepaid_subscription_id`).
2. Audit `grant-access-for-order.skip_extend_bepaid_subscription_mismatch.no_new_sub` с полями: `order_id, product_id, tariff_id, payment_flow, order_bepaid_subscription_id, primary_candidate_subscription_v2_id, primary_candidate_bepaid_sbs, candidate_sub_ids, candidate_sbs_list, matched_by_tariff=true, matched_by_sbs=false, decision='no_new_sub_chain'`.
3. **Merge** (НЕ overwrite) `orders_v2.meta` с полями: `manual_review=true, manual_review_reason='bepaid_subscription_mismatch', manual_review_at, manual_review_context{order_bepaid_sbs, candidate_subscription_v2_id, candidate_bepaid_sbs, candidate_sub_ids, candidate_sbs_list, payment_flow, decision}`.
4. **Ранний `return`** HTTP 200 ДО любых INSERT в `subscriptions_v2` / `entitlements` / `access_rules` / `telegram_access_queue`.

## Response contract (JSON)

```json
{
  "success": true,
  "skipped": true,
  "manual_review": true,
  "manualReview": true,
  "reason": "bepaid_subscription_mismatch",
  "granted_subscription_v2_id": null,
  "grantedSubscriptionV2Id": null,
  "granted_entitlement_id": null,
  "grantedEntitlementId": null,
  "subscription_id": null,
  "subscription_v2_id": null,
  "entitlement_id": null,
  "message": "SBS mismatch: ...",
  "manual_review_context": { ... }
}
```

snake_case + camelCase aliases — caller-tolerant. `bepaid-webhook` INLINE-блок продления не сработает (`grantedSubscriptionV2Id=null`), `granted_entitlement_id=null` блокирует side-effect ветки.

## payment_flow lookup

Читается с fallback-цепочкой (`order.meta.payment_flow` → `order.payment_flow` → `""`), фактическая SOT — `order.meta.payment_flow` (см. line 1244 того же файла). Логируется как строка для audit.

## Anti-side-effects (production runtime гарантия)

В §F-блоке выполняются ТОЛЬКО:
- `audit_logs` INSERT × 1 (служебный лог, не бизнес-данные).
- `orders_v2.meta` UPDATE merge × 1 (ставит флаг ручной проверки, бизнес-поля не трогает).

**0 production INSERT/UPDATE** для:
- `subscriptions_v2` ✓
- `entitlements` ✓
- `access_rules` ✓
- `telegram_access_queue` / `telegram_access` ✓
- `payments_v2` ✓ (не трогается этим code path в принципе)
- `orders_v2` business fields (status/paid_amount/...) ✓ — только `meta` merge

**Никакого ручного data repair** не выполнялось. Лариса повторно не трогалась.

## Регрессионные ветки (не затронуты §F)

- `tariffMatch=true && sbsMatch=true` → нормальный extend (без изменений).
- `tariffMatch=false` (разные тарифы) → прежнее create-new sub поведение (НЕ §F scope). **Замечание:** для recurring rebill с tariff-mismatch + foreign sbs одновременно — это потенциально тоже manual_review кейс, но вне scope §F. Зафиксировано в backlog.
- Первичный flow без candidate (нет active sub) → нормальный create-new (без изменений).
- `tariffMatch=true && sbsMatch=true` non-rebill → extend (без изменений).

## Tests (план, выполняются в next iteration)

Deno tests в `supabase/functions/grant-access-for-order/` с моками `supabase` client, без реального DB:

1. `tariffMatch=true, sbsMatch=false, payment_flow='bepaid_subscription_charge'` → response `{skipped:true, reason:'bepaid_subscription_mismatch', granted_subscription_v2_id:null}`, 0 INSERT subscriptions_v2/entitlements в моке.
2. `tariffMatch=true, sbsMatch=true` → нормальный extend (regression).
3. Первичный flow без candidate → создаёт новую sub (regression).
4. `tariffMatch=false` без sbs guard → ветка не §F, поведение прежнее (regression — фиксирует текущее поведение, не валидирует архитектуру).
5. **Larisa anti-regression fixture:** order с old sbs `sbs_OLD`, существует new sub product/tariff match но `sbs_NEW` → response skipped, audit row создан, candidate_sub_ids содержит new sub, 0 INSERT subs/entitlements/telegram.

## DoD

- [x] Patch применён (1 файл).
- [x] Early return ДО любых grant-веток.
- [x] orders_v2.meta — merge, не overwrite, 4 поля manual_review_*.
- [x] Audit: candidate_sub_ids + candidate_sbs_list для всех кандидатов.
- [x] Response: snake_case + camelCase aliases.
- [x] payment_flow с fallback chain.
- [x] Proof файл (этот).
- [ ] Deno tests (следующая итерация по запросу).
- [ ] Memory `mem://commercial-logic/subscriptions/sbs-mismatch-no-new-sub-guard` — создаётся ПОСЛЕ verify тестов.

## Production включение

§F закрывает blocker для §A REBILL Materialization — теперь `BEPAID_REBILL_MATERIALIZATION=on` безопаснее по части recurring foreign-sbs (любой mismatch не материализует новую sub-цепочку). Само включение `on` остаётся за отдельным approve.
