# Отчет диагностики платежного контура (PLAN-ONLY / READ-ONLY)

Canonical production ref: `hdjgkjceownmmnrqqtuz` (Lovable Cloud). Archival ref не использовался. Ни одной записи, миграции, деплоя, Publish, charge/refund/сообщения не выполнено.

## 1. INV-25: единственная stale processing строка — PASS (факт установлен)

| Поле | Значение |
|---|---|
| id (prefix) | `e8d645fa-8b3c-4fc3-a…` |
| status / status_normalized | `processing` / `successful` |
| attempts / max_attempts | 1 / 5 |
| created_at | 2026-08-28 08:15:56Z |
| updated_at | 2026-08-28 18:00:12Z |
| paid_at | 2026-08-28 08:15:53Z |
| last_error | пусто |
| error_category | null |
| source / transaction_type / provider | `webhook` / `Оплата` / `bepaid` |
| amount | 250 BYN |
| payment | нет строки в `payments_v2` с этим provider uid (0) |
| order | `matched_order_id` и `processed_order_id` = NULL |
| profile / email | `matched_profile_id` NULL, `customer_email` NULL |

Вывод: это успешная провайдерская транзакция, застрявшая без материализации в payment/order/access. Не косметика — потенциально реальный неучтенный платеж 250 BYN.

**Ключевое расхождение со scope PR #386 (FINDING-1, критично):**
- В `cron.job` **нет ни одного job, вызывающего `bepaid-queue-cron`** (проверено полным перечнем cron.job). Функция помечена в реестре как `category=cron`, но по факту вызывается только вручную и через `system-health-remediate` (allowlist `invoke_processor` / `restart_cron`).
- Статус `processing` этой строке проставил **`payments-reconcile`** (`index.ts` LEVEL 3, `.update({ status: "processing", attempts+1 })`), запускаемый job'ами `payments-reconcile-morning` (06:00 UTC) и `payments-reconcile-evening` (18:00 UTC). Метка 18:00:12Z ровно совпадает с вечерним запуском. Эта функция не возвращает строку из `processing` при обрыве.
- Значит патч только `bepaid-queue-cron` (stale >2h recovery, CAS claim) **не устранит источник** stale-строк: писатель другой и он не в scope PR.

Cron auth (факт, без значений): job'ы используют статический заголовок `Authorization: Bearer …` прямо в теле команды `net.http_post` (для telegram-очереди — литерал `lovable-cloud-internal`); Vault-секрет для этих job'ов не используется. `bepaid-queue-cron` во внутреннем вызове `bepaid-recover-payment` уже использует env `CRON_SECRET` в заголовке `x-internal-key`. Отдельного блока `[functions.bepaid-queue-cron]` в `supabase/config.toml` нет → gateway verify_jwt по умолчанию.

Совместимость strict auth PR #386: **NOT VERIFIED / риск**. Так как pg_cron job для этой функции отсутствует, единственные текущие вызывающие — админ-UI/оператор и `system-health-remediate`. Если PR требует service role либо `CRON_SECRET`, admin-путь с пользовательским JWT получит 401. Нужна отдельная managed migration cron **только если** мы хотим реально расписать функцию (сейчас расписания нет) — это решение отдельного approve, не входит в текущий scope.

## 2. INV-P0-1: все 7 просроченных provider_subscriptions

Алиас = `left(md5(id),8)`. Правило инварианта: `state=active AND next_charge_at <= now-24h AND (last_charge_at IS NULL OR last_charge_at < next_charge_at)`.

| alias | provider next_charge | provider last_charge | local status / auto_renew | local next | посл. успешный платеж пользователя | категория |
|---|---|---|---|---|---|---|
| ea964829 | 2026-08-15 09:12 | NULL | expired / false | 2026-08-15 | 2026-08-15 09:15 | stale snapshot, уже оплачено; провайдер не закрыт |
| f1cacb02 | 2026-08-18 06:10 | NULL | active / true | 2026-09-18 | 2026-08-18 06:15 | stale snapshot, уже оплачено |
| 58f4dc78 | 2026-08-21 06:19 | NULL | active / false | 2026-09-23 | 2026-08-21 06:30 | stale snapshot, уже оплачено (raw_state=`redirecting`) |
| 05ce32b7 | 2026-08-21 10:49 | NULL | active / false | 2026-09-24 | 2026-08-21 11:01 | stale snapshot, уже оплачено (raw_state=`redirecting`) |
| 1c50bbc5 | 2026-08-22 08:40 | NULL | active / true | 2027-03-20 | 2026-08-24 18:00 | stale snapshot, уже оплачено |
| e60f7b89 | 2026-08-24 06:02 | NULL | active / false | 2026-09-24 | 2026-08-24 06:15 | stale snapshot, уже оплачено (raw_state=`redirecting`) |
| 4b2b75d1 | 2026-08-29 12:00 | 2026-07-29 08:15 | expired / false | 2026-08-29 | 2026-07-29 08:15 | **реальная просрочка / несписание**, единственная |

Все 7 имеют реальный initial payment (у пользователей 11–24 успешных платежа, заказы `paid`).

Объяснение расхождения с рабочим реестром автопродлений (в нем 1 просрочка): реестр смотрит на локальные `subscriptions_v2` + фактические `payments_v2`, а INV-P0-1 — на снимок `provider_subscriptions`, где **`last_charge_at` не обновляется путем продления** (6 из 7 = NULL при доказанном платеже спустя 3–15 минут после `next_charge_at`, `updated_at` снимка застыл на 11–13 августа). То есть инвариант ложно-положителен по 6 записям и верен по 1 (`4b2b75d1`).

FINDING-2: причина — writer `provider_subscriptions.last_charge_at`/`next_charge_at` не вызывается при успешном rebill. Это отдельный дефект (не в scope PR #386).

Provider GET (bePaid API) по каждой подписке: **NOT VERIFIED** — это внешний вызов с боевыми ключами, вне read-only режима; вынесен в план (шаг V2), выполняется только read GET без изменения данных.

## 3. Placewash — NOT FOUND

Поиск по `products_v2.name`, `companies.short_name/full_name`, `orders_v2.meta`, `payments_v2.product_name_raw/meta`, `payment_reconcile_queue.product_name/description/shop_name` и по всему репозиторию (варианты Placewash/Playwash/Плейсвош/«плейс»): **0 совпадений**. Единственный хит подстроки «плейс» — слово «Марк**етплейс**ы» в описании импортной строки очереди, к Placewash отношения не имеет и связью не считается.

Действующий flow проверен на существующих успешных кейсах (без создания сущностей):
- recurring Club (MIT/provider_managed): provider tx → `payments_v2(status=succeeded, is_recurring)` → `orders_v2 paid` → `subscriptions_v2` продлена (локальный `next_charge_at`/`access_end_at` сдвинуты) → entitlements/Telegram активны. Разрыв только на обратной записи в `provider_subscriptions` (см. §2).
- one-time education: 192 оплаченных заказа за 30 дней, из них 16 без succeeded `payments_v2` и 15 без `entitlements` — требуется поштучная классификация (шаг V3), не смешивать с историческими импортами.
- finite installment: рассрочки идут через локальный график; единственный реально просроченный кейс — `4b2b75d1`.

## 4. RBAC (по коду, без вызовов)

- `grant-access-for-order`: verify_jwt=false в config, внутри — явные ветки 401 (anon/invalid) и 403 (обычный пользователь), admin-only ветка ручного редактирования доступа. PASS by code review.
- `telegram-grant-access`: verify_jwt=false, `requestHasServiceRoleKey` + `has_role_v2` с `_section_code='club-members'`, 401/403 ветки на месте. PASS by code review.
- anonymous checkout / owner / unrelated user / manager-admin / service-cron: ожидаемые 401/403 сохраняются в коде; runtime-подтверждение — **NOT VERIFIED** (требует HTTP-проб, вне read-only).
- Missing access по paid orders: 15 из 192 (30 дней) без entitlement — кандидаты на разбор, не подтверждено как поломка.

## 5. Диспозиция инвариантов и прочих ошибок

Full-check 05:00Z 31.08: статус CRITICAL, 5 P0-инвариантов (INV-P0-1 FAIL count=7; P0-2/3/5 PASS; P0-4 PASS через audit_fallback, но RPC упал с `statement timeout` — скрытая деградация), edge 172/172 OK, но `cors_errors: telegram-mass-broadcast` (не заявлено пользователем, новое).
Nightly набор из 11: INV-18…INV-25 (orphans, sbs_* без provider_subscriptions, token recurring без provider_subscriptions, paid orders без payments_v2, ratio без order_id, desync с провайдером, тишина вебхука, terminal queue без payments_v2, stale processing) — 10/11 PASS, FAIL только INV-25.
Очередь: 1608 pending / 451 error / 426 materialized накоплены с января и распределены равномерно по месяцам (июнь 100 pending, июль 65, август 70) — это **исторический link-backlog и provider declines**, а не свежая поломка обработки. Сломанная обработка подтверждена только для одной processing-строки и для отсутствующего расписания процессора.

## 6. Ревизия PR #386 (branch `codex/fix-placewash-payment-flow`, head `2f531661e`)

Код PR в этом окружении недоступен (не merged), ревизия по описанию + по фактическому состоянию production:
- FINDING-1 (blocker для достижения цели): патч в `bepaid-queue-cron` не покрывает реального писателя `processing` — `payments-reconcile`. Без recovery/CAS в `payments-reconcile` stale-строки продолжат появляться. Codex должен либо перенести recovery туда, либо добавить его дополнительно.
- FINDING-2: у функции нет pg_cron расписания, поэтому «recovery >2h» сам по себе не запустится. Нужно либо явное решение о расписании (отдельный approve + managed migration), либо recovery в уже расписанной функции.
- FINDING-3: strict internal auth может закрыть admin/remediate путь (единственный сейчас живой). Нужна ветка «service role ИЛИ CRON_SECRET ИЛИ admin JWT c проверкой роли», иначе `system-health-remediate` и оператор получат 401.
- Имя ветки `fix-placewash-payment-flow` не соответствует данным: объекта Placewash в проде нет.

### Exact execute plan (после исправлений Codex и отдельного approve)

1. Гейт: exact merged SHA, чистое дерево, CI PASS. Любой mismatch → STOP.
2. Required functions (deploy по одной, без bulk): `bepaid-queue-cron`, и — если Codex перенесет recovery — `payments-reconcile`. Webhook-функции не трогаем.
3. Migrations/config: миграции не требуются, если расписание не вводим. Если вводим cron — одна managed migration с `cron.schedule` и Vault-секретом, отдельный approve.
4. Dry-run: вызов с `dry_run`/`batchSize=1` — ожидаемые счетчики `stale_recovered=1`, `claim_conflicts=0`, `processed<=1`.
5. Идемпотентные малые батчи: batchSize 1 → 5 → 20, между батчами read-back.
6. Read-back: строка `e8d645fa…` перестала быть `processing`; появилась/не появилась `payments_v2` по её uid; счетчики pending/error не выросли скачком.
7. Runtime без побочек: никаких charge/send/create user/contact/order; только чтение и переход статуса очереди.

### V-шаги диагностики, требующие отдельного разрешения
- V2: provider GET по 7 подпискам (read-only) для подтверждения категорий.
- V3: поштучный разбор 15 paid orders без entitlement и 16 без succeeded payment.
- V4: разбор 250 BYN застрявшей транзакции до платежа/заказа/доступа.

## 7. STOP conditions

SHA mismatch или неожиданный diff; попытка bulk-деплоя функций; любая миграция вне явного approve; рост `error`/`pending` после батча; несовпадение read-back; любое действие, ведущее к списанию, отправке сообщения или созданию пользователя/контакта/заказа; обращение к archival Supabase ref.

Итог: PASS по фактам §1–§5, FAIL по INV-P0-1 (1 реальная просрочка) и INV-25, NOT VERIFIED — provider GET, runtime RBAC, содержимое PR #386. Ничего не выполнено.
