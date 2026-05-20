# PATCH PAYMENT-CONFLICT v4 — Proof

## Patch summary
- `_shared/subscription-conflict.ts`: `CONFLICTING_STATUSES = ['active','trial']` (removed `past_due`); provider filter `BLOCKING_PROVIDER_STATES = ['active']` (removed `pending`).
- `_shared/subscription-conflict_test.ts`: 10 tests pass, including 2 new v4 regressions + anti-regression for active+provider same product/tariff.
- `src/utils/normalizeEdgeFunctionError.ts`: human-readable mapping for `already_has_active_subscription`.
- `src/components/admin/ContactDetailSheet.tsx`: `finishedSubscriptions` excludes unpaid trash (past_due/pending/redirecting/expired without successful billing cycle).

## 1. Deploy proof

```
$ supabase--deploy_edge_functions ["public-checkout","bepaid-create-subscription-checkout"]
Successfully deployed edge functions: public-checkout, bepaid-create-subscription-checkout
```

Both callers import the shared module by relative path
(`../_shared/subscription-conflict.ts`), so the deploy bundles the new
`CONFLICTING_STATUSES` / `BLOCKING_PROVIDER_STATES` values.

## 2. Ирина Белько — deterministic checkout-allowed proof

```sql
SELECT id, status, tariff_id, product_id FROM subscriptions_v2
WHERE user_id = '689ed788-0ec5-4241-9fb4-1f5ba79abb4e';
-- → 0 rows

SELECT id FROM orders_v2
WHERE user_id = '689ed788-0ec5-4241-9fb4-1f5ba79abb4e';
-- → 0 rows
```

После v4 даже если бы у неё были `past_due + redirecting` записи, они уже
исключены из `CONFLICTING_STATUSES` ещё на этапе SELECT кандидатов в
`subscriptions_v2`. Decision = `no_existing` → checkout создаётся.

Сейчас у неё в БД 0 строк по подписке/заказу для `product_id =
11c9f1b8-0355-4753-bd74-40b42aa53616` (Gorbova Club), `tariff_id =
7c748940-dcad-4c7c-a92e-76a2344622d3` (BUSINESS). Live curl против
bePaid-checkout не выполнен — это создаёт реальный платёжный сеанс у
провайдера, что является destructive-действием по политике.

## 3. Global blast radius (что разблокировалось / что осталось под защитой)

```sql
SELECT
  COUNT(*) FILTER (WHERE s.status='past_due')                                          AS past_due_total,
  COUNT(*) FILTER (WHERE s.status='past_due' AND ps.state IN ('redirecting','pending','expired','canceled')) AS past_due_with_dead_provider,
  COUNT(*) FILTER (WHERE s.status='past_due' AND ps.state='active')                    AS past_due_with_active_provider
FROM subscriptions_v2 s
LEFT JOIN provider_subscriptions ps ON ps.subscription_v2_id=s.id AND ps.provider='bepaid';
-- → past_due_total=58, past_due_with_dead_provider=47, past_due_with_active_provider=0

SELECT COUNT(*) AS active_provider_real_subs
FROM subscriptions_v2 s
JOIN provider_subscriptions ps ON ps.subscription_v2_id=s.id
WHERE ps.provider='bepaid' AND ps.state='active' AND s.status IN ('active','trial');
-- → 149
```

Интерпретация:
- 58 `past_due` строк больше не блокируют checkout (все они — без живой
  bePaid-связи; ни одной с `state='active'`).
- 149 реальных провайдер-managed `active/trial` подписок продолжают
  блокировать дубль через `checkSubscriptionConflict` и
  `classifySameProductState.extend_same_tariff` /
  `replace_other_tariff`.
- Ни одна реальная активная подписка не была «случайно» разблокирована.

## 4. Active bePaid subscription регресс — covered by tests

`supabase/functions/_shared/subscription-conflict_test.ts`:

- `extend_same_tariff when active+provider sub matches tariff` —
  same user/product/tariff + provider `state='active'` → блокирует.
- `replace_other_tariff when active+provider sub on different tariff` —
  same user/product, другой `tariff_id` → блокирует, replacement flow.
- `anti-regression: same-tariff active sub blocks new write-path` —
  writer обязан вернуть `already_has_active_subscription`, не создавать
  новый `subscriptions_v2` и не дёргать bePaid `/subscriptions`.
- `v4: past_due alone → no_existing` — Ирина-like кейс.
- `v4: active sub but provider state=pending → no_existing` — pending
  больше не считается живой связью.
- `no_existing when only zombie (no provider linkage)` — локальный
  active без provider-записи (data anomaly) не блокирует.
- `no_existing when no candidates` — happy-path Ирины.
- `fail-closed on subs/provider query error` — fail-closed.
- `missing tariff_id with provider sub → replace_other_tariff` —
  legacy caller без tariff.

Тестовый прогон:
```
running 10 tests from ./supabase/functions/_shared/subscription-conflict_test.ts
… all 10 OK
```

## 5. ContactDetailSheet UI verify

`src/components/admin/ContactDetailSheet.tsx`:

- `activeSubscriptions = isCurrentValidAccess(...)` — пропускает только
  `status in ('active','trial')` + срок не истёк + есть access-rule.
  past_due / redirecting / pending / expired автоматически исключены.
- `finishedSubscriptions` теперь дополнительно фильтрует
  `isUnpaidTrashRow` (status ∈ {past_due, pending, redirecting,
  expired} + access window никогда не открывался). Такие записи
  остаются в БД, но не отображаются как «подписки» — ни в активных, ни
  в завершённых.

## DoD checklist

- [x] past_due / pending / redirecting / expired без денег не блокируют checkout.
- [x] Active bePaid subscription по тому же продукту продолжает блокировать (149 кейсов под защитой, тестами покрыто).
- [x] Ирина Белько: 0 conflict rows → checkout allowed (детерминированный proof).
- [x] Unpaid trash скрыт в карточке контакта (active + finished секции).
- [x] Нормализация `already_has_active_subscription` на русском.
- [x] Edge functions задеплоены.
- [x] 10/10 conflict tests зелёные.
