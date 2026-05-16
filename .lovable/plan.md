
# План: PATCH H2.1b-i — grant-access-for-order 3DS writer extension

## Контекст

H2.1b analysis закрыт: 3DS finalize ветка в `bepaid-webhook` делает 8 прямых access-writes, дублируя логику writer'а. Перед рефакторингом webhook (H2.1b-ii) сначала расширяем сам canonical writer, чтобы он умел всё то же самое.

## Scope / Constraints

- Менять ТОЛЬКО `supabase/functions/grant-access-for-order/index.ts` (+ shared helpers, + tests).
- НЕ трогать `bepaid-webhook/index.ts` 3DS finalize ветку (это H2.1b-ii).
- НЕ трогать LINK-ORDER, WEBHOOK-SUBSCRIPTION renewal, legacy one-time.
- Production DML = 0, migrations = 0.
- `BEPAID_REBILL_MATERIALIZATION` остаётся `dry_run`.
- `mode=on` НЕ включать.
- Никаких прямых Telegram/entitlements/subscriptions_v2 writes вне writer'а — но это обеспечивается тем, что webhook пока не меняем.

## Что writer должен покрыть (out of analysis H2.1b)

### 1. Multi-candidate guard
- Селект `subscriptions_v2` по `(user_id, product_id)` где `status IN ('active','past_due','trialing')` ORDER BY `access_end_at DESC`.
- Если найдено >1 кандидата → outcome `manual_review_multi_candidate`, audit `grant.multi_candidate_review`, ZERO writes.
- Полностью изолировано от существующего single-candidate пути.

### 2. past_due reattach
- Если найден один кандидат со `status='past_due'` и его `tariff_id` совпадает с `order.tariff_id` → reattach:
  - update `status='active'`, `order_id = newOrder.id`, `meta.reattached_from_order_id = oldOrderId`;
  - extend через стандартный `extendFromDate` (см. п.5);
  - audit `grant.subscription_order_attached`.

### 3. Proration при смене tariff_id
- Если кандидат active + `tariff_id != order.tariff_id` → proration:
  - `remainingDays = max(0, ceil((sub.access_end_at - now) / day))`;
  - `bonusDays = round(remainingDays * (oldTariff.amount / newTariff.amount))` (формула как в webhook 4790-block);
  - `extendFromDate = now`, `accessDays = newTariff.access_days + bonusDays`;
  - в `meta`: `proration: { old_tariff_id, new_tariff_id, remaining_days, bonus_days }`;
  - audit `grant.proration_applied`.

### 4. Trial bootstrap по trial_end_at
- Если `order.is_trial = true` и `order.trial_end_at` присутствует:
  - на CREATE → `access_end_at = trial_end_at`, `status = 'trialing'`, `meta.bootstrap = 'trial'`;
  - `baseAccessDays` берётся как `ceil((trial_end_at - now) / day)` для последующего nextChargeAt;
  - audit `grant.trial_bootstrap`.

### 5. extendFromDate logic
- Унифицированная функция `resolveExtendFromDate(sub, order, now)`:
  - active + расширение того же tariff → `sub.access_end_at` (продление от конца);
  - past_due reattach → `max(now, sub.access_end_at)`;
  - tariff change → `now` (proration уже учла остаток);
  - trial → `trial_end_at` (после окончания триала уже recurring цикл).
- Возвращает `{ extendFromDate, reason }`, идёт в audit.

### 6. nextChargeAt contract
**Решение:** writer **возвращает** `nextChargeAt` в response, НЕ пишет в `subscriptions_v2.next_charge_at` сам (это provider-sync поле, остаётся за webhook).
- Расчёт: `nextChargeAt = access_end_at - offset`, где offset = `1d` для trial, `3d` для recurring (как в webhook).
- В audit пишем `grant.next_charge_at_computed` с offset/reason.
- Webhook потом просто берёт это поле и кладёт в provider-sync update.

### 7. Structured outcomes
Расширить `GrantOutcome`:
```ts
type GrantOutcome =
  | { kind: 'ok'; subscription_id, access_end_at, next_charge_at_suggested }
  | { kind: 'bootstrap_created'; subscription_id, access_end_at, next_charge_at_suggested }
  | { kind: 'extended'; subscription_id, access_end_at, extended_by_days, next_charge_at_suggested }
  | { kind: 'manual_review_multi_candidate'; candidate_ids: string[] }
  | { kind: 'skip_already_processed' | 'skip_tariff_mismatch' | 'skip_no_order' | 'skip_inactive_offer' }
  | { kind: 'error'; reason: string };
```
Все outcomes идут в response + audit.

## Технический срез

### Файлы
- **edit**: `supabase/functions/grant-access-for-order/index.ts` — добавить:
  - `findCandidateSubscriptions()` (multi-candidate select);
  - `applyProration()`;
  - `bootstrapTrial()`;
  - `resolveExtendFromDate()`;
  - `computeNextChargeAt()`;
  - расширенный `GrantOutcome` union;
  - context-aware ветка `context: '3ds_finalize'` (новый параметр в payload).
- **edit**: `supabase/functions/grant-access-for-order/extended_by_orders_dedupe.ts` — без изменений, переиспользуется.
- **create**: `supabase/functions/grant-access-for-order/three_ds_writer_test.ts` — Deno tests.
- **create**: `.lovable/proofs/patch_h2_1b_i_writer_extension_2026_05.md`.

### Payload контракт (новое)
```ts
{
  order_id: string,
  context?: 'link_order' | 'webhook_subscription' | '3ds_finalize',  // default 'link_order'
  source: 'bepaid_webhook' | 'admin' | ...,
  // existing fields
}
```
`context === '3ds_finalize'` включает новые ветки (multi-candidate, proration, trial bootstrap, past_due reattach).
Для остальных контекстов поведение НЕ меняется (backward compat).

### Безопасность
- Все новые select'ы — только чтение.
- Все write'ы — только в `subscriptions_v2` и `entitlements` через уже существующие helpers (`dedupeExtendedByOrders`, primary writer).
- Никаких новых Telegram-вызовов — canonical Telegram path остаётся как есть (`telegram-grant-access` вызывается из существующих веток).
- forceExtend=true НЕ вводится.

## Tests (Deno)

`three_ds_writer_test.ts`:
1. **create_new_subscription** — нет existing sub → `bootstrap_created`, 1 insert в subscriptions_v2.
2. **extend_same_tariff** — active sub same tariff → `extended`, accessEnd = oldEnd + tariff.access_days.
3. **tariff_change_with_proration** — active sub different tariff → `extended`, bonusDays > 0, audit `proration_applied`.
4. **trial_bootstrap** — order.is_trial=true → `bootstrap_created`, access_end_at = trial_end_at, status='trialing'.
5. **past_due_reattach** — past_due same tariff → `extended`, status flipped to 'active', meta.reattached_from_order_id set.
6. **multi_candidate_manual_review** — 2 active subs → `manual_review_multi_candidate`, 0 writes.
7. **no_direct_telegram_writes** — static check: новые ветки не вызывают telegram-grant-access напрямую дважды (только через существующий path).
8. **response_has_next_charge_at** — все ok/extended/bootstrap_created outcomes содержат `next_charge_at_suggested`.

## Proof

`.lovable/proofs/patch_h2_1b_i_writer_extension_2026_05.md` содержит:
- changelog по index.ts (line-level);
- payload контракт + примеры;
- outcome matrix;
- static check: 0 новых прямых writes из webhook (webhook не менялся);
- test results (7+ tests pass);
- next step: H2.1b-ii — рефакторинг webhook 3DS finalize ветки.

## DoD

- [ ] writer покрывает все 6 сценариев (multi-candidate, past_due, proration, trial, extendFromDate, nextChargeAt);
- [ ] structured outcomes реализованы;
- [ ] backward compat: контексты `link_order` и `webhook_subscription` ведут себя как раньше;
- [ ] tests pass (≥7);
- [ ] proof файл создан;
- [ ] `.lovable/plan.md` обновлён со статусом H2.1b-i = closed;
- [ ] webhook 3DS finalize ветка НЕ изменена;
- [ ] production DML = 0, migrations = 0, `BEPAID_REBILL_MATERIALIZATION` = dry_run, mode=on выключен.

## Что НЕ входит

- Рефакторинг `bepaid-webhook` 3DS finalize ветки (H2.1b-ii, отдельный план).
- Legacy one-time path (H2.1c).
- H2b atomic append, H3 data-repair, H4 mode=on.
- PATCH G (идёт параллельно read-only).
