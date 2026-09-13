# План: Продукты3 — уточнения владельца 13.09.2026 (PLAN-ONLY / READ-ONLY)

Ничего не изменено: ни код, ни коммиты, ни миграции, ни данные, ни доступы, ни Auth,
ни платежи, ни Telegram, ни Publish. Выполнены только SELECT и чтение файлов.

## 0. Сверка main

- HEAD рабочего дерева = `origin/main` = `ea81d44f7dd504ef2892fa3cf17fbe19f36fd784`, дерево чистое.
- Прошлый scope PR447–453 в коде присутствует: RPC `admin_repair_historical_cb_dates`
  (15 фиксированных payload-хэшей) и `admin_repair_historical_cb_scope`
  (1 фиксированный payload-хэш) живы в БД, оба `service_role only`.

## 1. Три подтверждённых клиента (live, sanitized)

Объединение между собой и с phone-other карточками не предлагается; телефон не переносится.

| строка | profile | user | status | archived | merged_to | ban_case | normalized email SHA256 |
|---|---|---|---|---|---|---|---|
| 17:22 | 3fbf50d7… | c9e8dd78… | active | нет | нет | нет | `0fc32d349fa6c2e183c0976a8070c8559b9d80632835a7e44a610fd966ef6fe3` |
| 17:53 | 4bf084ed… | 0b7efe20… | active | нет | нет | нет | `6545cfe2358ad815c6b071ba224ded2929dcfbff9e1c5d8b075804e13c307812` |
| 17:85 | d80e20b1… | f1ea9093… | active | нет | нет | нет | `2dcf257ce1e62118f25047d03051261701092207e2b1d33e36a422cb505093ec` |

Email/ФИО/телефоны не возвращаются. Хэш = sha256(lower(btrim(email))).

## 2. Source historical coverage (оплаченные, не удалённые заказы по 9 продуктам)

- 17:22 (c9e8dd78…): 3 продукта — `7101ed3c` (курс, tariff `543940b1`), `d7effaf4`, `064dd768`.
  Источник: `reconcile_source=getcourse_historical`, deal_date 2024-05-16 / 09-12 / 11-04.
- 17:53 (0b7efe20…): 3 продукта — `7101ed3c` (курс, tariff `9bc81736`), `d7effaf4`, `9187db54`.
  Источник: `getcourse_historical`, deal_date 2024-05-23 / 09-03 / 11-04.
- 17:85 (f1ea9093…): 9 продуктов (курс + все 8 модулей), отдельные заказы 2024-05-25.

Заказов с `reconcile_source='owner_confirmed_historical'` у этих трёх пользователей нет —
их покупки уже подтверждены более ранними историческими источниками.

## 3. Existing grants (entitlements по 9 продуктам)

- 17:22: 3 записи (`7101ed3c`, `d7effaf4`, `064dd768`), все `expired`, expires_at 2026-05-08 20:59:59.
- 17:53: 4 записи — 3 `active` до 2026-09-26 12:00 (`7101ed3c`, `d7effaf4`, `9187db54`)
  и 1 `expired` `ea98d043` (src `historical_backfill`, покупкой не подтверждён).
- 17:85: 9 записей, все `active` до 2026-10-04 12:00.

## 4. Club Business prior_purchase preview (rule `1b497fba…`)

Правило проверено live: `is_active=true`, product `11c9f1b8…`, tariff `7c748940…`,
`condition_type=prior_purchase`, `match_mode=per_product`, 9 required = 9 target продуктов.

Квалифицирующая подписка = current finite, start<=now<end, status active/past_due/canceled,
не trial, заказ paid/не удалён/не trial, tariff совпадает, NET BYN >= 250.

| user | всего Business-подписок | квалифицирующих current | max current end |
|---|---|---|---|
| c9e8dd78… (17:22) | 9 | 0 | — (текущая активная подписка NET 100 BYN < 250) |
| 0b7efe20… (17:53) | 9 | 1 | 2026-09-26 12:00:00Z |
| f1ea9093… (17:85) | 5 | 1 | 2026-10-04 12:00:00Z |

Preview действий по правилам владельца:

| user | купленные продукты | целевой expiry | требуемых действий |
|---|---|---|---|
| c9e8dd78… | 3 | нет квалифицирующей подписки → выдача запрещена | **0** |
| 0b7efe20… | 3 | 2026-09-26 12:00:00Z | **0** (все 3 entitlements уже active ровно до этой даты) |
| f1ea9093… | 9 | 2026-10-04 12:00:00Z | **0** (все 9 entitlements уже active ровно до этой даты) |

**Ожидаемый итог preview: 0 grant/extend действий, 0 revoke, 0 shorten, 0 новых
пользователей/контактов.** Ни одна чужая/manual/revoked/foreign запись не затрагивается;
`ea98d043` у 17:53 остаётся expired, т.к. покупка этого модуля источником не подтверждена.
Подписки status `pending`/`superseded` с NET 0 и trial исключены, 20/21 потоки не затрагиваются.

Поэтому execute-этап для prior_purchase не требуется вовсе; при вашем согласии достаточно
зафиксировать «no-op verified» и не запускать никаких записей.

## 5. Прочие строки

- 18:31 — новых фактов/доступов/пользователей не предлагается.
- 18:9 — ban сохраняется, действий нет.
- 17:42 — отозванный ИП не трогаем.
- G9 — HOLD, без email и без операций Auth.

## 6. Строка 17:87 — точная дата от владельца

Фактическая строка `orders_v2` id `16472b5c-9a11-8805-836c-4484ec9ccbe4` (без ПД):

- profile `1eb42e6f-6af2-4f34-a0ee-c37534c2a085`, user `6164fa9e-36cc-4477-b882-4612a8f90379`
- product `abee24cd…` (модуль «Розничная торговля»), tariff `NULL`, flow `NULL`
- status `paid`, `is_deleted=false`, `is_trial=false`
- `deal_date = NULL`; `meta.deal_month` отсутствует (месяц не открыт)
- base_price / final_price / paid_amount = `0.00`, currency BYN
- created_at = updated_at = 2026-09-11 13:20:10.714919Z
- reconcile_source `owner_confirmed_historical`
- meta: batch `hist-cb17-18-20260911-v1`, `history_only=true`, `owner_confirmed_paid=true`,
  `source_refs=["17:87"]`, `source_amount_unknown=true`, `source_purchase_date_unknown=true`,
  spreadsheet `1dw8ljnBwfyNn26…`, idempotency_key `…:17:1eb42e6f…:abee24cd…:module`
- purchase_snapshot: `historical_purchase_type=module_only_standalone`,
  `import_source=owner_confirmed_sheet_17_18`, `module_list_mapped=[abee24cd…]`

### Можно ли существующим admin/editor API?

Технически да — админ-диалог редактирования сделки пишет `orders_v2.deal_date` и
логирует `deal.deal_date.updated` в `audit_logs`. Но как канонический путь он не подходит:

- тем же UPDATE он переписывает `status`, `base_price`/`final_price`, `product_id`,
  `tariff_id`, `offer_id`, `profile_id`, `user_id` значениями формы — риск тихой порчи
  history-only записи с нулевыми суммами и `tariff_id=NULL`;
- нет идемпотентности (повтор перезапишет дату), нет проверки batch/refs/provenance;
- не снимает `source_purchase_date_unknown` и не фиксирует `source='user_confirmed'`.

Существующий `admin_repair_historical_cb_dates` использовать нельзя: его 15 whitelists
покрывают только 285 фактов с источником D, и расширять их без source provenance запрещено.

### Рекомендуемый минимальный путь: новый узкий fixed RPC (код готовит Codex)

Контракт `public.admin_set_historical_purchase_date_user_confirmed(_payload jsonb, _mode text default 'dry-run')`:

- `security definer`, `set search_path=public`, `lock_timeout=5s`, `auth.role()='service_role'`;
- `_mode in ('dry-run','rollback','execute')`; ровно один закреплённый sha256(payload::text);
- размер payload = 1 элемент: `{id, refs:["17:87"], product_id, profile_id, user_id,
  deal_date:"2026…"→"2024-05-15T09:17:17Z", source:"user_confirmed", repair_id}`;
- preconditions (иначе RAISE и откат всего вызова): `reconcile_source='owner_confirmed_historical'`,
  `meta.historical_batch_id='hist-cb17-18-20260911-v1'`, `meta.history_only='true'`,
  `meta.source_spreadsheet_id` совпадает, `meta.source_refs = ["17:87"]`,
  `product_id`/`profile_id`/`user_id` совпадают, `status='paid'`, `is_deleted=false`,
  `tariff_id IS NULL`, `base_price=final_price=paid_amount=0`,
  `meta->>'deal_month' IS NULL`, `deal_date IS NULL OR deal_date = целевой`;
- патч ровно: `deal_date := '2024-05-15T09:17:17Z'`,
  `meta := meta || {source_purchase_date_unknown:false, source_purchase_date:'2024-05-15T12:17:17+03:00',
  source_purchase_date_source:'user_confirmed', source_date_repair_id:'…-17-87-user-confirmed-v1',
  source_date_repaired_at:now()}`; `deal_month` не создаётся;
- запрещено менять `created_at`, `profile_id`/`user_id`, любые суммы, `status`,
  `purchase_snapshot`, entitlements, подписки, платежи, доступы;
- идемпотентность: если `deal_date` уже равен целевому и `source_date_repair_id` совпадает —
  `CONTINUE`, `changes=0`;
- `rollback`-режим выполняет те же проверки и откатывает транзакцию (RAISE + capture);
- аудит: одна запись в `audit_logs` (`action='deal.deal_date.source_repair'`,
  `actor_label='historical_cb_user_confirmed'`, meta: order_id, refs, old/new deal_date,
  repair_id, mode) — без ПД;
- возврат: `{repair_id, mode, matched:1, changes:0|1, replay:0|1, before/after deal_date}`.

Порядок применения (после вашего разрешения): merged migration → `dry-run` (ожидание
`matched=1, changes=1`) → `rollback` (проверка, что дата не изменилась) → `execute`
(`changes=1`) → повторный `execute` (`changes=0, replay=1`) → read-back строки:
`deal_date=2024-05-15T09:17:17Z`, created_at/суммы/owner/status неизменны, `deal_month`
отсутствует, 0 новых платежей/подписок/доступов.

## 7. Фактические counts

- клиентов проверено: 3; активных/не banned/не merged: 3/3
- historical products покрыто: 3 + 3 + 9 = 15 связей
- existing entitlements по 9 продуктам: 3 + 4 + 9 = 16 (active 3 + 9 = 12, expired 4)
- квалифицирующих Business-подписок: 0 + 1 + 1 = 2
- предлагаемых grant/extend/revoke действий: **0**
- строк 17:87 к исправлению даты: 1 (whitelists 285 не расширяются)

Execute не выполняется. Жду вашего решения по разделу 6.
