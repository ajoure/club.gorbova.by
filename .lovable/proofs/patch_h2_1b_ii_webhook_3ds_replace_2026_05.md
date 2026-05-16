# PATCH H2.1b-ii — bepaid-webhook 3DS finalize → canonical writer

**Дата:** 2026-05-16 (Minsk)
**Scope:** замена 3DS finalize ветки `bepaid-webhook` на делегацию в `grant-access-for-order(context='3ds_finalize')` + расширение writer'а (race-guard, ensurePrimaryEntitlement, canonical Telegram invoke).
**Status:** closed

---

## Changelog

### Изменено
- `supabase/functions/bepaid-webhook/index.ts` (3DS finalize handover region ≈4536–4767)
  - удалены ВСЕ 8 direct access-writes (subscriptions_v2 insert/access-update, entitlements insert/update, entitlement_orders insert, telegram-grant-access invoke);
  - вставлен единственный `fetch(grant-access-for-order, { context: '3ds_finalize', source: 'bepaid_webhook' })`;
  - provider-sync UPDATE по `grant.outcome.subscription_id` — только 5 разрешённых полей: `billing_type`, `auto_renew`, `next_charge_at`, `payment_method_id`/`payment_token`, `meta.bepaid_*`, `updated_at`;
  - skip/error/manual_review/ambiguous → 0 access writes, HTTP 200, audit `bepaid.webhook.grant_skipped_no_fallback`;
  - НЕТ fallback на legacy access-write ни при какой outcome.

- `supabase/functions/grant-access-for-order/three_ds_writer.ts`
  - добавлены `classifyBySbs` (multi-candidate guard по `meta.bepaid_subscription_id`);
  - best-effort pre-INSERT re-check → outcome `skip_concurrent_insert` + audit `grant.race_insert_avoided`;
  - `ensurePrimaryEntitlement` (GREATEST на `expires_at`, никогда не уменьшает);
  - canonical `invokeTelegram` → вызов `telegram-grant-access` из writer'а (после ensurePrimaryEntitlement);
  - расширен union `ThreeDsOutcome`: `manual_review_multi_candidate_sbs`, `incomplete_subscription_completed`, `skip_concurrent_insert`;
  - `skip_already_processed` теперь различает «sub + entitlement valid» vs «sub без entitlement» (последнее → `incomplete_subscription_completed` + ensure entitlement + Telegram).

- `supabase/functions/grant-access-for-order/three_ds_writer_test.ts`
  - стабилизирован Supabase mock: `.in()` фильтры, seed `profiles`/`products_v2`/`entitlements` для `ensurePrimaryEntitlement`.

### Создано
- `supabase/functions/grant-access-for-order/three_ds_writer_h2_1b_ii_test.ts` — 7 новых тестов.
- `.lovable/proofs/patch_h2_1b_ii_webhook_3ds_replace_2026_05.md` (этот файл).

---

## Тесты — все зелёные

### grant-access-for-order: **42 passed | 0 failed**

- `extended_by_orders_dedupe_test.ts` — 6/6
- `sbs_mismatch_guard_test.ts` — 9/9 (включая Larisa fixture)
- `three_ds_writer_test.ts` — 20/20 (H2.1b-i, без регрессий)
- `three_ds_writer_h2_1b_ii_test.ts` — 7/7:
  1. `manual_review_multi_candidate_sbs` при >1 subs с одинаковым `bepaid_subscription_id`
  2. `incomplete_subscription_completed` (sub exists by order_id, entitlement missing → reuse + fix)
  3. `skip_concurrent_insert` (race-recheck появление candidate перед INSERT)
  4. outcome union admits 3 новых kinds (static shape)
  5. `skip_no_order` (missing order) → 0 writes
  6. `skip_inactive_offer` (`order.status != paid`) → 0 writes
  7. **static check**: webhook 3DS handover region не содержит direct access writes / direct telegram invoke

### bepaid-webhook: **44 passed | 0 failed**

- `canonical_writer_enforcement_test.ts` — 7/7 (включая «provider-sync update has NO access fields»)
- `rebill_builders_test.ts` — 16/16
- `rebill_flow_test.ts` — 17/17
- `rebill_wiring_test.ts` — 4/4

---

## Static check

Команда (за пределами тестов):
```
awk 'NR>=4536 && NR<=4767' supabase/functions/bepaid-webhook/index.ts \
  | grep -nE "\.from\(['\"]subscriptions_v2['\"]\)|\.from\(['\"]entitlements['\"]\)|\.from\(['\"]entitlement_orders['\"]\)|functions\.invoke\(['\"]telegram-grant-access['\"]"
```

Результат — только 2 совпадения, оба легитимные:
- line 4639: `SELECT meta` (read-only, для merge provider-sync meta)
- line 4651: `UPDATE` provider-sync patch — содержит ТОЛЬКО `billing_type / auto_renew / next_charge_at / payment_method_id / payment_token / meta / updated_at`. Поля `access_start_at / access_end_at / status / canceled_at / is_trial` отсутствуют (валидируется отдельным test'ом `H2.1b-ii: bepaid-webhook 3DS finalize branch has zero direct access writes`).

Запрещённые паттерны (insert/update access, telegram-grant-access invoke, entitlements write) — **0 совпадений** в регионе.

---

## Outcome → webhook поведение

| writer outcome                              | webhook action                                              |
| -------------------------------------------- | ----------------------------------------------------------- |
| `bootstrap_created` / `extended` / `incomplete_subscription_completed` | provider-sync UPDATE по `subscription_id`, GetCourse sync, notify, HTTP 200 |
| `skip_already_processed`                    | provider-sync UPDATE по `subscription_id`, HTTP 200          |
| `skip_concurrent_insert`                    | audit `grant_skipped_no_fallback`, HTTP 200, no writes       |
| `manual_review_multi_candidate(_sbs)`       | audit `grant_skipped_no_fallback`, HTTP 200, no writes       |
| `skip_no_order` / `skip_inactive_offer`     | audit `grant_skipped_no_fallback`, HTTP 200, no writes       |
| `error`                                     | audit `grant_skipped_no_fallback`, HTTP 200, no fallback     |

`next_charge_at` берётся из `outcome.next_charge_at_suggested`, попадает только в provider-sync UPDATE.

---

## Race-INSERT guard (Рабчевская case)

- `classifyBySbs`: если по `meta.bepaid_subscription_id` уже есть ≥1 sub на (user_id, product_id) — ветка «match by sbs» → reuse или manual_review.
- `handleThreeDsFinalize`: перед INSERT новой подписки выполняется re-check live кандидатов; при появлении нового → `skip_concurrent_insert` + audit `grant.race_insert_avoided`.
- Best-effort, НЕ абсолютная race-safe атомарность (требует RPC/unique constraint, см. H2b backlog).

---

## Production / Migrations / Deploy

- production DML = 0
- migrations = 0
- `BEPAID_REBILL_MATERIALIZATION = dry_run` (не менялся)
- `mode=on` НЕ включался
- deploy НЕ выполнялся (по запросу — отдельным шагом после approve)

---

## Data-repair Рабчевской — dry-run plan (НЕ выполнен)

Кейс: user `7261e727-f6d4-4ccf-9c71-ba7ec49bcf6e`, order `d1080bf5-…`, две subs:
- `4469a81d-…` (07:54, `billing_type=provider_managed`, end 15.06.2026)
- `f7fda1d7-…` (07:57, `billing_type=mit`, end 16.06.2026)

Dry-run:
```sql
UPDATE subscriptions_v2
SET status='canceled',
    cancel_reason='duplicate_race_h2_1b_ii',
    meta = meta || jsonb_build_object('merged_into','4469a81d-...','merged_at',now())
WHERE id='f7fda1d7-...';
```
Entitlement сохраняется по `4469a81d` (большая access_end_at у второй — потеряется 1 день, приемлемо; primary subscription = первая по времени, провайдерский билинг привязан к ней).

Execute НЕ выполнен — отдельный PATCH после approve.

---

## Next

1. H2.1c — legacy one-time path (pending).
2. H2b — atomic RPC append (backlog).
3. H3 — широкий repair дублей (pending).
4. H4 — preconditions + `BEPAID_REBILL_MATERIALIZATION=on` (pending).
5. Data-repair Рабчевской — отдельным approve.
