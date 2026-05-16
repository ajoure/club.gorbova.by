# PATCH H2.1b-i — grant-access-for-order 3DS writer extension

**Дата:** 2026-05-16 (Minsk)
**Scope:** writer-only расширение `grant-access-for-order`. Webhook 3DS finalize ветка НЕ менялась (H2.1b-ii — отдельный план).
**Status:** closed

---

## Changelog

### Создано
- `supabase/functions/grant-access-for-order/three_ds_writer.ts` (418 строк)
  - `handleThreeDsFinalize(orderId, deps)` — entrypoint;
  - pure helpers: `resolveExtendFromDate`, `applyProration`, `bootstrapTrial`, `computeNextChargeAt`, `classifyCandidates`;
  - типы: `ThreeDsOutcome`, `ExtendFromReason`, `SubShape`, `TariffShape`, `OrderShape`.

- `supabase/functions/grant-access-for-order/three_ds_writer_test.ts` (20 тестов).
- `.lovable/proofs/patch_h2_1b_i_writer_extension_2026_05.md` (этот файл).

### Изменено
- `supabase/functions/grant-access-for-order/index.ts` (lines 244-263)
  - добавлена ранняя ветка `if (_body.context === '3ds_finalize')` → делегирует в `handleThreeDsFinalize`;
  - backward-compat: остальные контексты (`link_order`, `webhook_subscription`, без context) идут прежним путём;
  - audit инжектируется как замыкание с `actor_label = 'grant-access-for-order:3ds_finalize'`.

---

## Payload контракт

```ts
POST /functions/v1/grant-access-for-order
{
  "orderId": "<uuid>",        // или legacy "order_id"
  "context": "3ds_finalize",  // ← активирует новую ветку
  "source": "bepaid_webhook"  // optional, попадает в audit.meta.source
}
```

Response (HTTP 200):
```ts
{
  "context": "3ds_finalize",
  "outcome": { "kind": "...", ... }
}
```

---

## Outcome matrix

| kind                              | Когда                                                                     | DB writes                       | Возвращает next_charge_at |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------- | ------------------------- |
| `ok`                              | (зарезервирован, не возвращается текущим хэндлером)                       | -                               | да                        |
| `bootstrap_created`               | Нет live кандидатов → insert новой подписки (recurring или trial)         | 1× insert subscriptions_v2      | да                        |
| `extended`                        | 1 кандидат → update: same-tariff extend / past_due reattach / proration   | 1× update subscriptions_v2      | да                        |
| `manual_review_multi_candidate`   | >1 live кандидат (active/past_due/trialing) на (user_id, product_id)      | 0 (audit only)                  | —                         |
| `skip_already_processed`          | `subscriptions_v2.order_id === orderId` уже существует                    | 0                               | —                         |
| `skip_no_order`                   | Order не найден                                                            | 0                               | —                         |
| `skip_inactive_offer`             | `order.status !== 'paid'`                                                  | 0                               | —                         |
| `skip_tariff_mismatch`            | (зарезервировано, текущий handler не использует)                          | 0                               | —                         |
| `error`                           | DB ошибка на insert/update/load                                            | 0 (или partial — описано в reason) | —                     |

---

## Покрытие сценариев H2.1b

| # | Сценарий                          | Реализовано в                                                                |
| - | --------------------------------- | ---------------------------------------------------------------------------- |
| 1 | Multi-candidate guard             | `classifyCandidates` + `manual_review_multi_candidate` outcome               |
| 2 | past_due reattach                 | `resolveExtendFromDate` reason `past_due_reattach_from_max` + status flip    |
| 3 | Proration при смене tariff_id     | `applyProration` (bonus_days = round(remaining * old_amount / new_amount))   |
| 4 | Trial bootstrap по trial_end_at   | `bootstrapTrial` + status='trialing' + `access_end_at = trial_end_at`        |
| 5 | extendFromDate logic              | `resolveExtendFromDate` (5 reasons)                                          |
| 6 | nextChargeAt contract             | `computeNextChargeAt` — возвращается в response, **НЕ пишется в БД**         |
| 7 | Structured outcomes               | Union `ThreeDsOutcome` из 8 kinds                                            |

---

## Безопасность / Constraints

- **БД-writes** только в `subscriptions_v2` (insert/update). `entitlements`, `access_rules`, `telegram_access_queue` НЕ трогаются.
- **Telegram**: новая ветка НЕ зовёт `telegram-grant-access` напрямую. Canonical Telegram path остаётся за существующими ветками writer'а (вызываемыми из не-3DS контекстов).
- **next_charge_at**: writer **возвращает** значение, **не пишет** в `subscriptions_v2.next_charge_at`. Provider-sync остаётся за `bepaid-webhook` (H2.1b-ii).
- **forceExtend=true** не введён.
- **Idempotency**: ранний guard `subscriptions_v2.order_id = orderId` → `skip_already_processed`.
- **backward compat**: контексты `link_order`, `webhook_subscription`, отсутствие `context` идут прежним путём — ни строчки в существующих ветках не тронуто.

---

## Static check (по index.ts)

```
$ rg -n "context === '3ds_finalize'" supabase/functions/grant-access-for-order/index.ts
247:    if (_body.context === '3ds_finalize') {
```

Webhook 3DS finalize ветка (lines ≈4500-4951 в `bepaid-webhook/index.ts`) **не изменялась** — будет рефакторена в H2.1b-ii.

---

## Tests

`supabase--test_edge_functions grant-access-for-order` → **35 passed | 0 failed** (включая 15 ранее существующих).

### 20 новых тестов `three_ds_writer_test.ts`:

Pure helpers (12):
1. `resolveExtendFromDate`: new sub + non-trial → `new_from_now`
2. `resolveExtendFromDate`: trial → `trial_from_trial_end`
3. `resolveExtendFromDate`: active same tariff → `same_tariff_from_end`
4. `resolveExtendFromDate`: tariff change → `tariff_change_from_now`
5. `resolveExtendFromDate`: past_due → `past_due_reattach_from_max`
6. `applyProration`: bonus = round(remaining * ratio)
7. `applyProration`: zero amount → no bonus
8. `bootstrapTrial`: returns trial_end_at + 'trialing'
9. `bootstrapTrial`: not trial → null
10. `computeNextChargeAt`: trial → -1d, recurring → -3d
11. `classifyCandidates`: 0/1/N decisions
12. `classifyCandidates`: canceled subs ignored

Handler (8):
13. create_new_subscription → bootstrap_created + 1 insert
14. extend_same_tariff → extended, accessEnd = oldEnd + tariff.access_days
15. tariff_change_with_proration → extended + bonus_days>0 + `grant.proration_applied` audit
16. trial_bootstrap → status='trialing', access_end_at=trial_end_at + `grant.trial_bootstrap` audit
17. past_due_reattach → status='active', meta.reattached_from_order_id, `grant.subscription_order_attached` audit
18. multi_candidate → `manual_review_multi_candidate`, 0 writes, `grant.multi_candidate_review` audit
19. skip_already_processed когда order уже привязан
20. response всегда содержит `next_charge_at_suggested` для ok/extended/bootstrap_created

---

## Production / Migrations

- production DML = 0
- migrations = 0
- `BEPAID_REBILL_MATERIALIZATION` = dry_run (не менялся)
- `mode=on` НЕ включался

---

## Next steps

1. **H2.1b-ii** — отдельный план: рефакторинг `bepaid-webhook` 3DS finalize ветки на вызов canonical writer с `context: '3ds_finalize'`, удаление 8 прямых access-writes, оставление только provider-sync полей.
2. **H2.1c** — legacy one-time path (отдельный план).
3. **H2b** — atomic append через RPC (backlog).
4. **H3** — data-repair.
5. **H4** — preconditions + `BEPAID_REBILL_MATERIALIZATION=on`.

Параллельно: **PATCH G** — read-only discovery bonus/secondary access.
