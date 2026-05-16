# H3.x-d — abandoned-signup past_due cleanup (Stage 1 dry-run)

**Status:** dry-run only, execute требует отдельного approve
**Snapshot at:** `2026-05-16T19:05Z`
**Source proof:** [`h3x_past_due_provider_pull_2026_05.md`](./h3x_past_due_provider_pull_2026_05.md)
**SOT memory:** [INV-22 Desync Resolution](mem://commercial-logic/subscriptions/inv22-desync-resolution)

## Scope

8 subscriptions_v2 строк (8 sbs_*), provider_pull = `provider_expired`. Только local cleanup в `subscriptions_v2`. G25 (Алеся Хомич) — hold до 2026-05-18 06:00 UTC, ниже в отдельной секции.

## Контакты, у которых будет изменение (Cleanup-кандидаты)

| # | ФИО контакта | Email | Тариф | sbs_* | subv2 (short) |
|---|---|---|---|---|---|
| 1 | **Anasstasia Stankevich** | nasstasia2015@gmail.com | BUSINESS | sbs_4cb14472e800f524 | 3de11a1f |
| 2 | **Ирина Гузаревич** | irkaguzarevich@mail.ru | стандарт | sbs_686219e109cfccc1 | beab8ace |
| 3 | **Оксана Зеленкевич** | okka1105@gmail.com | FULL | sbs_c6e68d772064a5fe | 517c30f3 |
| 4 | **Ольга Черкашина** | holgacher@mail.ru | BUSINESS | sbs_b167a6fc7b17b93a | eb074bcc |
| 5 | **Татьяна Чёкчикова** | 791067723@mail.ru | стандарт | sbs_8b65f96cbba62f0c | ed70daf1 |
| 6 | **Татьяна Ярошевич** | yaroshevichtatyana@gmail.com | BUSINESS | sbs_23f8e27141ac2ebc | 6107e6b5 |
| 7 | **Юлия Станкевич** (G34a) | yul.winbet.88@gmail.com | CHAT | sbs_4f13f25943f4ccd6 | 1efa3527 |
| 8 | **Юлия Станкевич** (G34b) | yul.winbet.88@gmail.com | CHAT | sbs_92b38efdebaeb110 | 2cef77ad |

Уникальных контактов: **7**. У Юлии Станкевич — две зомби-подписки CHAT (обе expired у bePaid).

## Hold (без изменений)

| ФИО контакта | Email | Тариф | sbs_* | subv2 (short) | Причина |
|---|---|---|---|---|---|
| **Алеся Хомич** | ghom1721@gmail.com | BUSINESS | sbs_50a3bd75a025455b | 1e10acb7 | provider_redirecting в 48h grace, hold до 2026-05-18 06:00 UTC |

## Current vs Planned (per row)

Все 8 строк идентичны по форме:

| field | current | planned |
|---|---|---|
| `status` | `past_due` | `canceled` |
| `auto_renew` | `true` | `false` |
| `access_end_at` | `NULL` | `NULL` (не меняем) |
| `canceled_at` | n/a | `now()` |
| `meta.cancel_reason` | (absent) | `'inv22_provider_dead_local_active_pastdue'` |
| `meta.cleanup_batch` | (absent) | `'h3x_d_abandoned_signup_2026_05'` |
| `meta.provider_pull_at` | (absent) | `'2026-05-16T18:57:52Z'` |
| `meta.provider_verdict` | (absent) | `'provider_expired'` |

## STOP-guards (Stage 1 verify, все 8 строк)

| guard | результат |
|---|---|
| `access_end_at IS NULL` | ✅ все 8 NULL |
| `status='past_due'` | ✅ все 8 |
| `auto_renew=true` | ✅ все 8 |
| provider verdict `provider_expired` | ✅ все 8 (sbs_4cb14472, sbs_686219e1, sbs_c6e68d77, sbs_b167a6fc, sbs_8b65f96c, sbs_23f8e271, sbs_4f13f259, sbs_92b38efd) |
| existing entitlement по `(user_id, product_id)` | проверить на execute (ожидаемо: 0, т.к. это abandoned signups) |
| Telegram access по `(user_id, product_id)` | проверить на execute (ожидаемо: 0) |
| paid `orders_v2` на эту `subscription_id` | проверить на execute (ожидаемо: 0 — provider никогда не списывал) |

**Любой STOP → строка исключается из execute-батча, без частичной модификации.**

## Planned DML (Stage 2, только после approve)

Чисто `subscriptions_v2` UPDATE по 8 явным `id`:

- `UPDATE subscriptions_v2 SET status='canceled', auto_renew=false, canceled_at=now(), meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cancel_reason','inv22_provider_dead_local_active_pastdue','cleanup_batch','h3x_d_abandoned_signup_2026_05','provider_pull_at','2026-05-16T18:57:52Z','provider_verdict','provider_expired') WHERE id = '<id>'` — по одному на строку.
- `audit_logs` INSERT per row: `action='inv22.local_terminate_after_provider_dead'`, `actor_type='system'`, `target_user_id=<user_id>`, `meta={subscription_id, sbs, before, after, source:'h3x_d'}`.

**Row guard:** ровно 8 UPDATE, ровно 8 audit INSERT. Любое отклонение → rollback.

## Запрещено в этой задаче

- provider API (bePaid cancel/sync)
- Telegram (revoke/grant/queue)
- `grant-access-for-order`
- entitlements (read/write)
- `orders_v2` / `payments_v2`
- migrations
- изменение `access_end_at`
- изменение `BEPAID_REBILL_MATERIALIZATION`
- `mode=on`
- касание G25 / любых других past_due строк вне 8 явных id

## DoD (Stage 2)

- [ ] rowcount UPDATE = 8, audit INSERT = 8
- [ ] `access_end_at` ни у одной строки не изменился (остался NULL)
- [ ] entitlements не тронуты
- [ ] provider_subscriptions не тронуты
- [ ] Telegram не тронут
- [ ] G25 не тронут
- [ ] active duplicate pairs остаётся 0
- [ ] proof обновлён before/after

## Status board

- H3.x-b execute-A/B — closed
- H3.x-c past_due classification — closed
- H3.x-c-provider-pull — closed
- **H3.x-d cleanup — Stage 1 dry-run готов, ждёт approve**
- G25 (Алеся Хомич) — hold до 2026-05-18 06:00 UTC
- H4 `mode=on` — still blocked

---

## Stage 2 — EXECUTED (2026-05-16 19:38:00 UTC)

### Verify

| # | ФИО | sbs | status | auto_renew | canceled_at | access_end_at | cancel_reason | batch | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Anasstasia Stankevich | sbs_4cb14472e800f524 | canceled | false | 2026-05-16 19:38:00+00 | NULL | inv22_provider_dead_local_active_pastdue | h3x_d_abandoned_signup_2026_05 | provider_expired |
| 2 | Ирина Гузаревич | sbs_686219e109cfccc1 | canceled | false | 2026-05-16 19:38:00+00 | NULL | ✅ | ✅ | ✅ |
| 3 | Оксана Зеленкевич | sbs_c6e68d772064a5fe | canceled | false | 2026-05-16 19:38:00+00 | NULL | ✅ | ✅ | ✅ |
| 4 | Ольга Черкашина | sbs_b167a6fc7b17b93a | canceled | false | 2026-05-16 19:38:00+00 | NULL | ✅ | ✅ | ✅ |
| 5 | Татьяна Чёкчикова | sbs_8b65f96cbba62f0c | canceled | false | 2026-05-16 19:38:00+00 | NULL | ✅ | ✅ | ✅ |
| 6 | Татьяна Ярошевич | sbs_23f8e27141ac2ebc | canceled | false | 2026-05-16 19:38:00+00 | NULL | ✅ | ✅ | ✅ |
| 7 | Юлия Станкевич G34a | sbs_4f13f25943f4ccd6 | canceled | false | 2026-05-16 19:38:00+00 | NULL | ✅ | ✅ | ✅ |
| 8 | Юлия Станкевич G34b | sbs_92b38efdebaeb110 | canceled | false | 2026-05-16 19:38:00+00 | NULL | ✅ | ✅ | ✅ |

### DoD check

- [x] subscriptions_v2 UPDATE rowcount = 8
- [x] audit_logs INSERT rowcount = 8 (action=`inv22.local_terminate_after_provider_dead`, actor_type=`system`, actor_label=`h3x_d_abandoned_signup_2026_05`)
- [x] все 8 → `status='canceled'`
- [x] все 8 → `auto_renew=false`
- [x] все 8 → `canceled_at` заполнен (2026-05-16 19:38:00.777185+00)
- [x] `access_end_at` у всех остался `NULL` (доступ не отзывался)
- [x] entitlements не трогались
- [x] orders_v2 не трогались
- [x] payments_v2 не трогались
- [x] provider_subscriptions не трогались
- [x] Telegram не трогался
- [x] provider API не вызывался
- [x] `grant-access-for-order` не вызывался
- [x] G25 / Алеся Хомич (sbs_50a3bd75a025455b) НЕ тронута: `status=past_due, auto_renew=true` — hold до 2026-05-18 06:00 UTC
- [x] `BEPAID_REBILL_MATERIALIZATION=dry_run` (не менялся)
- [x] `mode=on` не включался
- [x] migrations = 0

## Status board

- H3.x-b execute-A/B — closed
- H3.x-c past_due classification — closed
- H3.x-c-provider-pull — closed
- **H3.x-d cleanup — closed (8/8 executed)**
- G25 (Алеся Хомич) — hold до 2026-05-18 06:00 UTC → repeat provider pull
- H4 `mode=on` — still blocked
