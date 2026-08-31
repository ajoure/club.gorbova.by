# План: финальный preflight трёх mirror repairs (PLAN-ONLY, read-only выполнено)

SHA origin/main `0ca59b01`. Ни кода, ни файлов проекта, ни миграций, ни бизнес-DML, ни grant/notify/deploy/Publish. Выполнены только SELECT и два технических GET-only enqueue через `net.http_post` → `bepaid-readonly-pull` (`no_writes: true`).

## 0. Технический канал

- Vault `name='payments_reconcile_cron_secret'`: count = **1** (секрет не читался наружу).
- request_id `548401` (SBS, 5 шт.) и `548404` (транзакции, 5 шт.), оба `status_code 200`, `pulled_at 2026-08-31T17:42Z`.
- `payments_reconcile_cron_secret()` не вызывался, ACL/auth не менялись.

## 1. Свежее состояние провайдера (GET-only)

| PS | SBS | state | renew_at / active_to | last tx | tx status | amount | paid_at |
|---|---|---|---|---|---|---|---|
| cdddfa67 | sbs_75324adf | active | 2026-09-27T08:14:58Z | 41ad0f04 | successful | 250.00 BYN | 2026-08-28T08:15:55.394Z |
| d9d68d35 | sbs_50c2b31e | active | 2026-09-29T11:50:45Z | 4bf9d295 | successful | 250.00 BYN | 2026-08-30T12:00:31.574Z |
| c5b621df | sbs_6eb6a4dc | **failed_attempt** | 2026-08-30T09:10:52Z | 115f7985 | **failed** (Insufficient funds) | 250.00 BYN | 2026-08-31T03:01:37.002Z |
| cde3dadc | sbs_e79bcf52 | active | 2026-09-29T09:31:51Z | 231bc602 | successful | 250.00 BYN | 2026-08-30T09:45:10.638Z |
| ef99dcc8 | sbs_076d0afb | active | 2026-09-29T09:16:01Z | 3e7de8ff | successful | 250.00 BYN | 2026-08-30T09:30:16.554Z |

Уникальность: по каждому из пяти `provider_subscription_id` ровно **1** строка PS (из 852). Дублей нет.

## 2. Три mirror repair: before → after, CAS, rowcount

Каждый repair — один `UPDATE provider_subscriptions … WHERE id = <точный> AND updated_at = <снимок ниже>`, ожидаемый rowcount = **1**. Никаких изменений в subscriptions_v2 / entitlements / orders / telegram / dunning в рамках этих трёх операций.

### R1 — PS cdddfa67 (C1)
- CAS `updated_at = 2026-08-31T09:23:53.168109Z`
- before: `subscription_v2_id = 0fc9ec31`, `last_charge_at = 2026-07-29T08:15:12Z`, `next_charge_at = 2026-09-27T08:14:58Z`, `order_id = 95607a89`, `state = active`
- after: `subscription_v2_id = 209ead26`, `last_charge_at = 2026-08-28T08:15:55.394Z` (provider paid_at tx 41ad0f04)
- НЕ меняются: `order_id` (95607a89, parent), `next_charge_at` (совпадает с provider renew_at), `state`, `provider_subscription_id`

### R2 — PS d9d68d35
- CAS `updated_at = 2026-08-02T11:23:53.067002Z`
- before: `last_charge_at = NULL`, `next_charge_at = 2026-08-30T11:50:45Z`
- after: `last_charge_at = 2026-08-30T12:00:31.574Z`, `next_charge_at = **2026-09-29T11:50:45Z**`
- Расхождение с прежней гипотезой: ожидалась цель Sep30T12:00Z (по локальному entitlement `ec8eab84` до 2026-09-30T12:00Z). Провайдер даёт renew_at **2026-09-29T11:50:45Z**. Зеркало обязано отражать провайдера — берём Sep29T11:50:45Z; доступ клиента (Sep30T12:00Z) не трогаем.
- НЕ меняются: `subscription_v2_id` (94cb9348), `order_id` (f8814968), `state`.

### R3 — PS c5b621df
- CAS `updated_at = 2026-08-05T06:23:58.023131Z`
- before: `state = active`, `last_charge_at = NULL`, `next_charge_at = 2026-08-30T09:10:52Z`
- after: `state = failed_attempt`. Всё остальное без изменений: `last_charge_at` остаётся NULL (успешного списания не было), `next_charge_at` = provider renew_at (совпадает).
- Задолженность, dunning, retry, доступ не трогаются. Локальная sub `5a909ae1` уже `expired` (30.08 21:00) штатно — это отдельное состояние, не правится.

### Идемпотентность и rollback
- Повтор любого R даёт rowcount 0 (CAS `updated_at` уже другой) — безопасно.
- Rollback: обратный UPDATE тех же 2–3 полей по зафиксированным before-значениям, CAS по новому `updated_at`, rowcount 1.
- Audit: 3 строки (по одной на repair) с before/after JSON, без PII и ключей.
- STOP-условия: любой рассинхрон CAS `updated_at`, rowcount ≠ 1, изменение provider state между preflight и execute, появление новой строки PS с тем же SBS.

## 3. INV-показатели (точный предикат кода)

`isProviderRenewalOverdue`: `state='active' AND next_charge_at < now - 24h AND (last_charge_at IS NULL OR last_charge_at < next_charge_at)`.

- **INV-25**: **1** — очередь `e8d645fa`, uid 41ad0f04, `processing`, attempts 1, `updated_at 2026-08-28T18:00:12.505159Z`. Не закрывать до полного paid window.
- **INV-P0-1: 5** (не 4 и не 40): `c5b621df`, `ef99dcc8`, `cde3dadc`, `d9d68d35`, **`d65026ce`** (новая: sub 46bb65e3, order 73784ba0, next 2026-08-30T13:54:18Z, last NULL). `d65026ce` вне согласованного scope — только зафиксирована.
- После R1–R3 расчётно останутся: `cde3dadc`, `ef99dcc8`, `d65026ce` (R3 уходит по `state`, R2 — по свежему next/last, R1 в выборку не входил).

## 4. Снимок cde / ef перед exact grant (без исполнения)

| | cde | ef |
|---|---|---|
| user | 97df997b | 4a94ab96 |
| sub_v2 | 945d33c1 active, 2026-08-01T03:01:20.906Z → **2026-09-01T12:00Z** | 37cb6139 active, → **2026-08-31T03:01:53.529Z** (истекла) |
| entitlement | 6fb4738f `club` active до 2026-09-01T12:00Z (order 3d52acdd) | 7a3cd953 `buh_business` **expired** 2026-08-31T03:01:53.529Z (order c05ea0fa) |
| paid order (parent CAS) | `4cde4b4a` SUB-LINK-MPV0EFUF, paid, `bepaid_subscription_id = NULL`, updated_at 2026-08-31T06:00:13.530366Z | `a64743db` SUB-LINK-MPUZS7FZ, paid, `bepaid_subscription_id = NULL`, updated_at 2026-08-31T06:00:12.639316Z |
| CAS-репейр заказа | NULL → `sbs_e79bcf52b7f1b6f0` (подтверждён GET, tracking указывает на этот же order) | NULL → `sbs_076d0afbbbbe4589` (подтверждён GET, tracking указывает на этот же order) |
| очередь | `58846a90` uid 231bc602 pending, attempts 2 | `e52535ae` uid 3e7de8ff pending, attempts 2 |
| notifications по paid order | 0 строк (по прежнему REBILL-заказу 3d52acdd: 1 email + 1 telegram + 5 admin, все sent) | 0 строк (по c05ea0fa: 1+1+5 sent) |
| цель | Oct 1 T12:00Z | Sep 30 T03:01:53.529Z |

Ожидаемое при execute (позже, отдельно): 1 UPDATE заказа (CAS), 1 UPDATE sub_v2, UPDATE entitlement(ов), запись ledger. Чужой Club-продукт ef (club fa547c41, grant до 2026-09-30T12:00Z) не трогать.

**Блокировка уведомлений:** обе очереди (`58846a90`, `e52535ae`) в `pending`. Любое действие, снимающее mismatch (CAS `bepaid_subscription_id`, деплой workers, возврат очереди в обработку), делает эти строки обрабатываемыми и приведёт к фоновой клиентской отправке. Поэтому CAS заказов и repair R2/R3 не должны применяться раньше, чем получено разрешение на уведомления двух новых клиентов, либо строки очереди заранее переведены в согласованное состояние.

## 5. C1 — подтверждения

- Provider `next` не изменился при grant: renew_at/active_to = **2026-09-27T08:14:58Z** до и после (совпадает с локальным `next_charge_at`). Grant затронул только sub_v2 209ead26 (access_end 2026-09-29T12:00Z, start 2026-08-28T08:15:55Z сохранён) и entitlement 9cf82316 (2026-09-29T12:00Z).
- Уведомления order 35589108: 1 email + 1 telegram + 6 telegram_admin = **8 sent**, новых нет.
- Telegram: `telegram_access.active_until = 2026-09-29T12:00:00Z`, `last_sync_at 2026-08-31T14:38:19Z`, `state_chat = pending`, `state_channel = pending`, `invites_pending = false` → **инвайт отправлен, вступление не подтверждено (invite ≠ joined)**.
- Расхождение: `telegram_access_grants.b7e4409e` (active, source `grant-access-for-order`) хранит `end_at = 2026-09-27T20:59:59Z` — старое окно, не Sep29T12Z. Это отдельный, не входящий в три repair дефект зеркала Telegram; фиксируется как кандидат в follow-up, ничего не менялось.

## 6. Деплой

- `payments-reconcile` **можно** развернуть отдельно для exact dry-run: exact-ветка (`queueItemId` + `expectedUpdatedAt` + `dryRun`) не запускает уровни 1/2, не пишет audit/lease и не шлёт уведомление о массовой сверке. Единственный побочный эффект деплоя — следующий scheduled run уже нового кода, поэтому окно деплоя должно быть согласовано так же, как восстановление доступа.
- Timeout-migration (`20260831073813`) и остальные 4 workers (`grant-access-for-order`, `bepaid-queue-cron`, `bepaid-auto-process`, `bepaid-webhook`, `admin-materialize-post-cancel-charge`) применять **после** PASS exact dry-run и **после** разрешения на клиентские уведомления — их включение открывает обработку 1613 pending-строк очереди.

## Definition of Done (для будущего execute)

- R1–R3: rowcount 1 каждый, before/after в audit, повтор = 0.
- INV-25 = 1 (без изменений на этом этапе), INV-P0-1 пересчитан по коду.
- Provider state/renew_at не изменялись (только чтение).
- Никаких новых уведомлений, грантов, ACL и Publish.
