да, согласен, с учетом правок:

```text
Phase 3.1.0-B план можно принять как основу, но перед execute нужны уточнения.

1. Stage B.2 сейчас слишком слабый.
   Guard "готов к вызову", но не подключён к реальному writer'у.
   Для разблокировки Price Mapping этого достаточно, но для MVP — нет.
   Добавить явный DoD:
   - Phase 3.1.0-B закрывает только helper + cleanup readiness;
   - реальное подключение `checkPendingCheckoutConflict` в `stripe-create-subscription-checkout` обязательно в Phase 3.1 MVP до первого INSERT pending.

2. Cleanup function может изменить строки.
   Поэтому перед execute cleanup должен быть только на тестовых фикстурах, а не на production pending.
   Добавить guard:
   - execute=true разрешён только для rows с `meta.test_fixture=true` в proof-сценарии;
   - для реальных pending rows текущего окружения — только dry_run.
   Иначе можно случайно закрыть будущие валидные pending.

3. Нельзя удалять placeholder provider_subscriptions без точного фильтра.
   Добавить условие:
   - provider_subscription_id LIKE 'pending:%';
   - state='pending';
   - provider IN ('stripe');
   - subscription_v2_id = конкретный pending subscriptions_v2.id.
   Не трогать provider='bepaid'.

4. `status='expired'` для abandoned checkout нужно подтвердить.
   Добавить в proof:
   - expired pending не даёт доступ;
   - expired pending не блокирует новую попытку checkout;
   - expired pending не попадает в reminders/telegram.

5. `checkPendingCheckoutConflict` должен возвращать не только `pending`, но и:
   - subscription_v2_id;
   - created_at;
   - age_minutes;
   - order_id, если есть;
   - provider_subscription_id, если есть;
   - recommended_action: `reuse_or_block` / `cleanup_candidate` / `none`.

6. Duplicate pending conflict должен быть по:
   - user_id;
   - product_id;
   - tariff_id;
   - status='pending';
   
   Provider можно включить в результат, но не в условие блокировки.
   Иначе Stripe pending не заблокирует bePaid/другой provider pending того же продукта.

7. Stage A добавить аудит:
   - есть ли уже pending rows после enum migration;
   - если есть — список и источник.
   Ожидаемо pending=0.

8. Memory update не делать автоматически.
   Сначала proof, потом отдельное approve на memory.
   В DoD заменить на:
   - memory update candidate.

9. Phase 3.1.1 Price Mapping можно разблокировать после:
   - helper готов;
   - cleanup dry_run работает;
   - execute cleanup протестирован только на фикстуре;
   - proof подтверждает, что pending не grantable/active.

10. Добавить STOP:
   Если cleanup function требует новых RLS/RPC/grants — остановиться и отдельный mini-plan.
```

Итог: план правильный, но execution cleanup должен быть максимально ограничен тестовыми фикстурами. Не нужно случайно закрывать реальные будущие pending-подписки.

&nbsp;

План: Phase 3.1.0-B — Pending Checkout Guard + Cleanup Policy

## Цель

Безопасно управлять `pending` записями в `subscriptions_v2`, которые будут создаваться до Stripe Checkout (Phase 3.1 MVP pre-create). Закрыть CR-2 из Phase 3.1.0: блокировка duplicate pending checkout по `user_id + product_id + tariff_id`. Без этого MVP остаётся заблокированным.

## Жёсткие инварианты (не должны нарушаться)

- `pending` НЕ grantable: `grant-access-for-order`, `resolve-effective-access`, `access-resolver` НЕ видят его как живой статус.
- `pending` НЕ active: не идёт в reminders, Telegram auto-grant, broadcasts «active subscribers», renewal cron.
- `pending` НЕ блокирует bePaid `active/trial/past_due` flow: текущая логика `subscription-conflict.ts` для bePaid не меняется по семантике, только расширяется отдельной веткой.
- 0 строк в существующих `subscriptions_v2` не изменяется этим патчем.
- `provider_subscriptions` схема не меняется.

## Stage A — Read-only Discovery (proof перед кодом)

Сбор фактов, без правок:

1. **Точки создания `subscriptions_v2**` — grep на `from('subscriptions_v2').insert` / `.upsert` во всех edge functions. Зафиксировать список writers и текущий минимально допустимый набор полей (status NOT NULL, user_id, product_id, …).
2. **Текущие вызовы `subscription-conflict.ts**` — где зовётся `checkSubscriptionConflict` и `classifySameProductState`. Подтвердить, что Stripe-flow ещё не подключён ни к одному writer.
3. **Readers `pending**` — повторная проверка из Phase 3.1.0 audit, что ни один reader не трактует `pending` как живой/grantable.
4. **Stripe pre-create writer** — определить, какой edge function будет владельцем pre-create в MVP (новый `stripe-create-subscription-checkout` или расширение `create-payment-checkout`). В этом mini-plan только фиксируем имя и контракт, код не пишется.
5. **TTL источник** — `subscriptions_v2.created_at` достаточно для классификации `pending < 24h` vs `pending >= 24h`. Дополнительные поля не нужны.

Выход Stage A: файл `.lovable/proofs/stripe_phase_3_1_0b_pending_guard_discovery_v1.md` с матрицей writers/readers и подтверждением, что guard можно расширить add-only.

STOP-GATE A: если найден reader, который трактует `pending` как grantable/active/billable — остановиться, отдельный patch плана.

## Stage B — Implementation (add-only, минимальный объём)

### B.1 Расширить `supabase/functions/_shared/subscription-conflict.ts`

Add-only, без изменения существующих экспортов и поведения для bePaid:

- Новая константа `PENDING_TTL_MS = 24 * 60 * 60 * 1000`.
- Новая функция `checkPendingCheckoutConflict(supabase, { user_id, product_id, tariff_id, provider })`:
  - SELECT `subscriptions_v2` where `user_id` + `product_id` + `tariff_id` + `status='pending'`.
  - Если найдена строка с `created_at >= now() - 24h` → `{ status: 'pending_conflict', pending: {...} }`.
  - Если найдена только `created_at < now() - 24h` → `{ status: 'stale_pending', stale: [...] }` (guard НЕ изменяет статус — только репортит, чтобы caller знал, что есть кандидат на cleanup).
  - Иначе → `{ status: 'no_pending' }`.
- Существующие `checkSubscriptionConflict` / `classifySameProductState` / `CONFLICTING_STATUSES` / `TERMINAL_STATUSES` НЕ трогаются. `pending` НЕ добавляется в `CONFLICTING_STATUSES` (это сломает bePaid семантику конфликта).
- Контракт ошибок fail-closed сохраняется.

### B.2 Подключение guard (без активации бизнес-flow)

В этом mini-plan guard только **готов к вызову**. Реальные точки вызова из Stripe writer'а подключаются в Phase 3.1 MVP. Это явно фиксируется, чтобы не размывать scope.

Единственное исключение — добавить `checkPendingCheckoutConflict` в код-ревью чек-листа Phase 3.1 MVP plan как обязательный шаг перед любым `subscriptions_v2.insert({ status: 'pending' })`.

### B.3 Admin cleanup function (manual-only для MVP)

Новая edge function `admin-cleanup-stale-pending-subscriptions`:

- `verify_jwt = true`, super_admin only (RBAC через `has_role_v2`).
- Принимает `{ dry_run: boolean, limit?: number }`.
- Находит `subscriptions_v2` where `status='pending'` AND `created_at < now() - 24h`.
- Для каждой:
  - НЕ зовёт bePaid/Stripe (pending по определению не имеет активного provider subscription).
  - Удаляет связанный placeholder в `provider_subscriptions` (если есть, `state='pending'`, `provider_subscription_id LIKE 'pending:%'`).
  - UPDATE `status='expired'`, `meta.lifecycle.timeout_reason='checkout_abandoned'`, `meta.lifecycle.cleaned_at=now()`, `auto_renew=false`.
  - audit_logs: `subscription.pending_cleaned_up` с actor=admin JWT.
- Возвращает summary: `{ found, would_change, changed, dry_run }`.

В `supabase/config.toml` зарегистрировать функцию (`verify_jwt = true` — для админов с JWT).

### B.4 Cron — отложен

Для MVP cron НЕ создаётся. Cleanup запускается админом вручную через `admin-cleanup-stale-pending-subscriptions` (UI кнопка добавляется в Phase 3.2). Это явная архитектурная декларация, фиксируется в plan.md и memory.

### B.5 Не делаем в этом mini-plan

- Новые поля в `subscriptions_v2` / `provider_subscriptions`.
- Изменения RLS / grants.
- Изменения bePaid edge functions, `grant-access-for-order`, reminders, Telegram.
- UI (CTA «продолжить оплату», admin cleanup кнопка) — отложено в Phase 3.2.
- Cron worker — отложено.
- Подключение guard в реальные Stripe writers — будет в Phase 3.1 MVP.

## Stage C — Proof (обязательные gates)

Файл `.lovable/proofs/stripe_phase_3_1_0b_pending_guard_proof_v1.md` с проверками (через test fixtures на staging или unit/integration tests):

1. **Guard unit test:** создаём pending row (created_at = now), `checkPendingCheckoutConflict` возвращает `pending_conflict`.
2. **TTL boundary test:** pending row с created_at = now-25h → `stale_pending`, статус строки в БД НЕ изменён guard'ом.
3. **No-pending test:** нет pending row → `no_pending`.
4. **bePaid non-regression:** существующие тесты `checkSubscriptionConflict` для active bePaid sub остаются зелёными.
5. **Access non-regression:** pending row не появляется в access-resolver, reminders cron, Telegram queue (повторный grep + smoke).
6. **Cleanup function:** dry_run возвращает корректный счёт; реальный run переводит pending>24h → expired, audit_logs запись создана, bePaid не дергался.
7. **Counts before/after для existing data:** `subscriptions_v2` rows с `status IN ('active','trial','past_due','canceled','expired','superseded','expired_reentry')` не изменились.

STOP-GATE C: если хотя бы один gate упал — откат, отдельный patch, не двигаемся к Price Mapping.

## Files (создание / изменение)

**Изменяется (add-only):**

- `supabase/functions/_shared/subscription-conflict.ts` — добавить `PENDING_TTL_MS`, `checkPendingCheckoutConflict`, новые типы. Существующие экспорты не трогаются.
- `supabase/config.toml` — регистрация новой функции с `verify_jwt = true`.
- `.lovable/plan.md` — обновление статуса Phase 3 sequence.

**Создаётся:**

- `supabase/functions/admin-cleanup-stale-pending-subscriptions/index.ts` — admin-only manual cleanup.
- `.lovable/proofs/stripe_phase_3_1_0b_pending_guard_discovery_v1.md`
- `.lovable/proofs/stripe_phase_3_1_0b_pending_guard_proof_v1.md`
- Memory: `mem://commercial-logic/subscriptions/pending-checkout-guard-v1` — фиксация правила «pending не grantable / не active / блокирует duplicate < 24h / manual cleanup для MVP».

**Не трогается:**

- `grant-access-for-order`, `bepaid-*`, `subscription-renewal-reminders`, `telegram-*`, `resolve-effective-access`, `access-resolver`, frontend, RLS, RPC, `provider_subscriptions` schema, `subscriptions_v2` schema, cron jobs.

## Phase 3 sequence после этого mini-plan

1. ✅ Discovery
2. ✅ Pending State Strategy
3. ✅ Phase 3.1.0 — enum `pending`
4. 🟡 **Phase 3.1.0-B — этот план (CR-2 closure)** ← следующий шаг
5. ⛔ Phase 3.1.1 — Price Mapping STOP-GATE
6. ⛔ Phase 3.1 Infinite Subscription MVP
7. ⛔ Runtime Proof
8. ⛔ Phase 3.2+ (Customer Portal, Dunning, Reconcile) deferred

## DoD

- Guard функция существует и покрыта тестами.
- Manual cleanup function задеплоена, super_admin only, dry_run работает.
- 0 строк существующих subscriptions_v2 не изменено.
- bePaid conflict behavior идентичен pre-patch (proof grep + tests).
- Memory + plan.md обновлены.
- Phase 3.1.1 разблокирован.