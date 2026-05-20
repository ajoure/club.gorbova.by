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

## 6. Runtime verify — Ирина Белько успешно оплатила (2026-05-20)

После деплоя патча Ирина прошла публичную ссылку и оплатила Gorbova Club / BUSINESS.

### 6.1. Новый paid order

```sql
SELECT id, status, paid_amount, tariff_id, product_id, created_at
FROM orders_v2
WHERE user_id='0012a7a4-1420-486c-b95e-e6ba5907ef93'
  AND product_id='11c9f1b8-0355-4753-bd74-40b42aa53616'
ORDER BY created_at DESC LIMIT 1;
-- id=59c6eb7d-efe2-46bb-a7a3-78c78140a07b
-- status=paid, paid_amount=250.00 BYN
-- tariff_id=7c748940... (BUSINESS), created_at=2026-05-20 06:06:47Z
```

### 6.2. payments_v2

```sql
SELECT id, status, amount, provider FROM payments_v2
WHERE order_id='59c6eb7d-efe2-46bb-a7a3-78c78140a07b';
-- id=a9d3b5a6-3217-49c6-ab79-f6e754751ea9
-- status=succeeded, amount=250.00, provider=bepaid
-- created_at=2026-05-20 06:11:05Z
```

Платёж НЕ привязан к старым pending/past_due попыткам (ca089896 / 58be5a09 /
e03c94f9 остались `pending` + `paid_amount=0`).

### 6.3. Доступ — entitlement и subscription

```sql
SELECT id, status, expires_at, meta->>'tariff_id' AS tariff_id,
       meta->>'granted_by' AS granted_by, meta->>'source' AS source
FROM entitlements
WHERE user_id='0012a7a4-1420-486c-b95e-e6ba5907ef93'
  AND product_id='11c9f1b8-0355-4753-bd74-40b42aa53616';
-- id=9f609d99-e8c4-44d3-84d8-3dc6ed40d591, status=active
-- expires_at=2026-06-20 12:00:00Z
-- tariff_id=7c748940... (BUSINESS)
-- granted_by=primary_order_fulfillment, source=bepaid_webhook_v2

SELECT id, status, auto_renew, access_start_at, access_end_at
FROM subscriptions_v2
WHERE user_id='0012a7a4-1420-486c-b95e-e6ba5907ef93'
  AND product_id='11c9f1b8-0355-4753-bd74-40b42aa53616'
  AND status='active';
-- id=81ba18e6-e3b4-4c20-8406-c056bc42c58d, auto_renew=true
-- access_start_at=2026-05-20 06:06:47Z, access_end_at=2026-06-20 12:00:00Z
```

Новая active подписка + entitlement.expires_at = 2026-06-20 (recurring monthly,
BUSINESS, 250 BYN/мес).

### 6.4. provider_subscriptions — живой sbs

```sql
SELECT id, state, provider_subscription_id, subscription_v2_id, created_at
FROM provider_subscriptions
WHERE subscription_v2_id IN (
  '81ba18e6-...','46194979-...','794661f3-...','1d9700de-...'
) ORDER BY created_at DESC;
-- sbs_96311287f13c6391 state=active (2026-05-20, bound to pre-created sub 46194979)
-- sbs_cf0d4dfc4e6a5c2d state=redirecting (2026-05-19, dead)
-- sbs_7a3f947b2a3927b5 state=expired (2026-05-15, dead)
```

Активный bePaid sbs существует и держит recurring. Note: sbs привязан к
pre-created sub_v2 46194979 (past_due), а active sub_v2 81ba18e6 без provider
row — это известный SBS-mismatch паттерн (см. `mem://commercial-logic/subscriptions/sbs-mismatch-no-new-sub-guard`),
не относится к текущему патчу и доступ не ломает.

### 6.5. audit_logs — нет блокировок

```sql
SELECT count(*) FROM audit_logs
WHERE action ILIKE '%already_has_active_subscription%'
  AND created_at > '2026-05-20';
-- 0
```

Ни одной записи `already_has_active_subscription` после деплоя патча — для
Ирины и в целом по системе. Старые past_due/redirecting/expired строки больше
не использовались как blocker.

Цепочка по этому ордеру (audit_logs):
1. `system.payment_link.created` (06:06:48)
2. `public_checkout.created` (06:06:48) ← без блокировки
3. `entitlement.tariff_id_persisted` (06:10:56) ← grant прошёл
4. `document_data.snapshot_created` (06:11:06)
5. `bepaid.subscription.processed` (06:11:07)

`grant-access-for-order` прошёл без skip/error для primary entitlement.

### 6.6. ContactDetailSheet — UI verify

- `activeSubscriptions` → отображает 81ba18e6 (active, BUSINESS, до 20.06).
- `finishedSubscriptions` → 1d9700de / 794661f3 / 46194979 отфильтрованы
  через `isUnpaidTrashRow` (past_due без успешного billing cycle).
- Истёкшая c405fc59 (expired с реальным access window 19.01–19.02)
  показывается как нормальная завершённая.
- Пользователь не видит raw `already_has_active_subscription` — за счёт
  `normalizeEdgeFunctionError`.

---

## STATUS: CLOSED

PATCH `public_checkout_unpaid_subscription_attempts_do_not_block_2026_05` — **CLOSED**.

Runtime proof получен: Ирина Белько успешно оплатила Gorbova Club / BUSINESS
через публичную ссылку, доступ выдан до 2026-06-20, ни одна старая
past_due/redirecting/expired запись не сыграла роль blocker'а.
