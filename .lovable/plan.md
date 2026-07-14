да, согласен, с учетом правок:

## Авторизация

```text
STAGE 6.1 DISCOVERY: AUTHORIZED READ-ONLY
STAGE 6.2–6.7:      NOT YET AUTHORIZED
ANY DML/MIGRATION:  FORBIDDEN DURING 6.1

```

## Обязательные правки к 6.1

### 1. Сверить новый baseline с ранее зафиксированным

Ранее для Stage 6 были зафиксированы ориентиры:

```text
safe backfill: 4
archive:       260
relink review: 52
HOLD:          11

```

Новый pre-flight предлагает другую модель:

```text
admin:          315
admin_test:       8
bank_transfer:    2
total legacy:   325

```

В deliverable нужна отдельная reconciliation-таблица:


| Ранее зафиксированная группа | Новый фактический состав | Count  | Причина изменения |
| ---------------------------- | ------------------------ | ------ | ----------------- |
| safe backfill                | &nbsp;                   | &nbsp; | &nbsp;            |
| archive                      | &nbsp;                   | &nbsp; | &nbsp;            |
| relink review                | &nbsp;                   | &nbsp; | &nbsp;            |
| HOLD                         | &nbsp;                   | &nbsp; | &nbsp;            |


Без объяснения расхождения нельзя переходить к DML.

### 2. Не считать `origin='bepaid'` доказательством провайдера

Для `admin` и `admin_test` отдельно показать:

```text
provider_payment_id
bepaid_uid
tracking_id
statement row match
provider event match
order linkage
amount/currency/date match

```

`origin='bepaid'` — только признак происхождения записи, но не достаточное основание для `provider='bepaid'`.

### 3. Proof-match должен быть формализован

Для будущего relink определить exact правила:

```text
MATCH_STRONG
  exact provider external ID
  + currency
  + amount
  + transaction identity

MATCH_COMPOSITE
  amount
  + currency
  + bounded timestamp window
  + order/contact evidence
  + unique candidate

COLLISION
  more than one candidate

NO_MATCH
  zero candidates

```

Никаких relink по одному amount/date или одному `origin`.

### 4. Writers разделить на активные и исторические

Inventory writers должен иметь формат:


| Writer | Файл/функция | Записывает provider | Есть runtime caller | Последнее использование | Решение |
| ------ | ------------ | ------------------- | ------------------- | ----------------------- | ------- |


Разделить:

- активный production writer;
- test/admin endpoint;
- deprecated edge function без caller;
- migration/backfill SQL;
- тестовый fixture;
- только reader/reference.

Упоминание строки в старой миграции не означает активный writer.

### 5. Отдельно исследовать известные подозрительные источники

Обязательно найти происхождение:

```text
admin_grant
admin_from_payment
admin_deal_only
admin_test
bank_transfer

```

И отдельно проверить `test-payment-complete`, поскольку ранее установлено, что endpoint способен:

- принять обычный order;
- отметить его оплаченным;
- вставить `provider='admin_test'`;
- выдать доступ.

Для каждого — callers, auth/RBAC, production reachability и последнее фактическое создание строки.

### 6. Inventory должен включать exact IDs

`stage6_inventory.csv` должен содержать минимум:

```text
id
provider
origin
classification
status
transaction_type
amount
currency
paid_at
created_at
order_id
profile_id/user_id
provider_payment_id
bepaid_uid
tracking_id
external_id
statement_match_count
statement_match_ids
provider_event_match_count
has_tombstone
is_deleted
deleted_at
meta.stage6_hold_reason
recommended_action
action_reason
confidence

```

Не включать в CSV секреты, токены, полный raw webhook payload или платёжные реквизиты.

Артефакт сохранить в доступном рабочем каталоге, например:

```text
/mnt/data/stage6_inventory.csv

```

а не только в `/mnt/documents`, если этот путь не выдаётся пользователю.

### 7. Проверить active-delete состояние

Все counts дать в двух разрезах:

```text
all rows
active rows:
  is_deleted = false
  AND deleted_at IS NULL

```

Нельзя смешивать уже архивированные строки с активными invalid providers.

### 8. HOLD пока не проектировать как окончательное состояние

Фраза:

```text
provider='admin' остаётся временно

```

допустима только как диагностическая рекомендация.

До отдельного approve нельзя:

- ставить `meta.stage6_hold_reason`;
- создавать backup/archive table;
- soft-delete;
- менять provider;
- добавлять trigger.

### 9. Guard пока только дизайн

На 6.1 подготовить варианты guard:

1. `BEFORE INSERT OR UPDATE OF provider` trigger, запрещающий новые non-canonical значения;
2. исключение только для уже существующих exact HOLD IDs;
3. отсутствие зависимости от `created_at > now()`, поскольку такой предикат ненадёжен при retry/import/backfill.

Предпочтительный дизайн:

```text
new provider must be canonical
OR row.id belongs to exact immutable HOLD registry

```

Но реализация только после отдельного approve.

## Deliverables Stage 6.1

1. `stage6_inventory.csv` — 325 legacy rows с exact IDs.
2. Writer inventory.
3. Reconciliation со старым baseline `4 / 260 / 52 / 11`.
4. Match-quality summary:


| Provider      | Strong match | Composite unique | Collision | No match | Already deleted |
| ------------- | ------------ | ---------------- | --------- | -------- | --------------- |
| admin         | &nbsp;       | &nbsp;           | &nbsp;    | &nbsp;   | &nbsp;          |
| admin_test    | &nbsp;       | &nbsp;           | &nbsp;    | &nbsp;   | &nbsp;          |
| bank_transfer | &nbsp;       | &nbsp;           | &nbsp;    | &nbsp;   | &nbsp;          |


5. Proposed action matrix без выполнения:


| Group             | Count  | Proposed action     | Confidence | Blocking issue |
| ----------------- | ------ | ------------------- | ---------- | -------------- |
| bank_transfer     | &nbsp; | bank                | &nbsp;     | &nbsp;         |
| admin_test        | &nbsp; | relink/archive/HOLD | &nbsp;     | &nbsp;         |
| admin regular     | &nbsp; | &nbsp;              | &nbsp;     | &nbsp;         |
| admin null        | &nbsp; | &nbsp;              | &nbsp;     | &nbsp;         |
| card verification | &nbsp; | &nbsp;              | &nbsp;     | &nbsp;         |
| orphan technical  | &nbsp; | &nbsp;              | &nbsp;     | &nbsp;         |


6. Checksums до любых будущих изменений:

```text
count by provider/status/currency
sum(amount) by provider/status/currency
hash of exact legacy IDs
hash of financial identity:
  id, amount, currency, paid_at, order_id, provider

```

## Gate

```text
STAGE 6.1 READ-ONLY DISCOVERY: EXECUTE AUTHORIZED
CSV INVENTORY:             REQUIRED
WRITER SWEEP:              REQUIRED
OLD/NEW BASELINE RECONCILIATION: REQUIRED
STAGE 6.2 DML:             BLOCKED UNTIL 6.1 REVIEW

```

&nbsp;

&nbsp;

Stage 6 — legacy provider cleanup. Цель: привести `payments_v2.provider` к canonical allowlist `{bepaid, stripe, rr, bank}` без потери финансовых данных. UI, канонический allowlist (`ACTIVE_PAYMENT_PROVIDERS`) и Stage 5 gate уже закрыты — эта работа только на серверной стороне (данные + writers).

## Текущий факт (read-only pre-flight выполнен)


| provider      | count | origin       | classification breakdown                        | temporal range    |
| ------------- | ----- | ------------ | ----------------------------------------------- | ----------------- |
| bepaid        | 5966  | bepaid       | canonical                                       | canonical         |
| admin         | 315   | bepaid       | 288 null / 24 regular / 2 card_verif / 1 orphan | 2023-05 → 2026-07 |
| rr            | 21    | —            | canonical                                       | canonical         |
| admin_test    | 8     | bepaid       | 7 null / 1 orphan_technical                     | 2026-01 → 2026-06 |
| stripe        | 6     | —            | canonical                                       | canonical         |
| bank          | 3     | manual_admin | null                                            | canonical         |
| bank_transfer | 2     | manual_admin | null                                            | 2026-07-13        |


`payment_reconcile_queue` — provider только `bepaid` (2199). `orders_v2.reconcile_source` legacy-меток не содержит.

Итого 4 legacy-провайдера: `admin`, `admin_test`, `bank_transfer`; плюс подтверждение, что `bank` уже canonical и оставляется. Всего 325 строк payments требуют решения.

## Стратегия классификации

Стадия 6 разбита на дискретные шаги; каждый — с diagnose → dry-run → execute → verify. Ни одна строка не удаляется физически — только relink/reprovider/archive/HOLD.

### Шаг 6.1 — Discovery + writer sweep (read-only)

1. `rg` по репозиторию: где записываются provider-значения `admin`, `admin_test`, `bank_transfer` в `payments_v2` (edge functions, migrations, RPC, UI). Ожидается: admin-manual-payment писатели, старый bank-transfer flow.
2. Собрать список writers → таблица: writer → provider → активен/deprecated → нужно ли переводить на canonical.
3. Для каждой legacy-строки собрать proof-CSV: `id, provider, amount, currency, origin, classification, paid_at, order_id, user_id, has_tombstone, has_bank_proof, meta`.

DoD: полный inventory writers + CSV inventory 325 строк в `/mnt/documents/stage6_inventory.csv`.

### Шаг 6.2 — `bank_transfer` → `bank` (2 строки)

Обе от 2026-07-13, origin=`manual_admin`, BYN. `bank_transfer` — синоним `bank` (canonical). План:

- dry-run: `SELECT id ... WHERE provider='bank_transfer'`, snapshot до/после.
- execute (migration): `UPDATE payments_v2 SET provider='bank' WHERE provider='bank_transfer'`.
- verify: `provider='bank_transfer' = 0`, count `bank` = 3+2=5, checksum по (amount,currency,paid_at,order_id) не изменился.
- writer sweep: если есть writer, пишущий `bank_transfer`, — переводится на `bank` в этой же миграции/PR.

### Шаг 6.3 — `admin_test` (8 строк)

Все — `origin=bepaid`, но `provider=admin_test`. Это тестовые admin-ручные вводы (2026-01…2026-06). Решение:

- если у строки есть валидный bepaid `provider_payment_id` и совпадает с bepaid_statement_rows → relink to `bepaid`;
- иначе — archive (soft-delete через `is_deleted=true, deletion_context='stage6_legacy_admin_test'`) с полным snapshot в `_stage6_legacy_archive_2026_07_backup`.

DoD: `provider='admin_test'` = 0, все 8 строк либо в bepaid (с bank proof match), либо в archive-таблице + is_deleted=true.

### Шаг 6.4 — `admin` (315 строк, самый большой блок)

Разбить по classification:

- **24 regular_purchase** + **288 null**: разбить по наличию bepaid provider_payment_id.
  - match to bepaid_statement_rows → reprovider to `bepaid` (backfill из bank proof).
  - без match → HOLD (пометить `meta.stage6_hold_reason='admin_no_bank_proof'`), провайдер оставляем `admin` временно, но исключаем из canonical allowlist reader — уже исключён.
- **2 card_verification**: reprovider to `bepaid` если есть card verification job, иначе HOLD.
- **1 orphan_technical**: archive (soft-delete как в 6.3).

DoD:

- `admin` без bepaid match = HOLD с явным meta-маркером;
- `admin` с bepaid match = relinked;
- orphan_technical = archived.
- Никаких физических deletes; всё через UPDATE + backup-таблица.

### Шаг 6.5 — Writer disablement

Все writers, определённые в 6.1 как пишущие legacy provider, переводятся:

- `admin_test` writers: удалить или переключить на `bepaid` (в зависимости от call-path).
- `bank_transfer` writers: переключить на `bank`.
- `admin` manual-payment writers: оставить, но только для HOLD-режима, если UI-фича сохранена; иначе deprecate.

Каждый writer PR — отдельный commit, но одна миграция.

### Шаг 6.6 — Provider CHECK constraint (только после всего выше)

После того, как invalid providers = 0 (все, что не в allowlist, либо relinked, либо HOLD с явным флагом):

- добавить `CHECK (provider IN ('bepaid','stripe','rr','bank'))` НЕ раньше, чем HOLD-строки будут либо resolved, либо reclassified. Возможно, отдельный follow-up ticket — этот шаг требует нулевого HOLD.

В рамках Stage 6 добавляется **только** partial-check или превентивный trigger, блокирующий будущие вставки non-canonical provider для новых строк (`created_at > now()`), но не ломающий legacy HOLD. Полный CHECK — Stage 7 gate.

### Шаг 6.7 — Финальный checksum verify

Preview + execute checksum-функций:

- row-count по (bepaid, stripe, rr, bank) до и после Stage 6 (bepaid должен вырасти на N relinked, stripe/rr не измениться, bank = old+2).
- SUM(amount) по currency неизменен (relink НЕ меняет сумму; archive выводит строку из allowlist, но остаётся в БД под is_deleted).
- CSV parity 5/5 на выборке ключевых экранов.

## Gate

- STAGE 6 INVENTORY:         REQUIRED
- STAGE 6.2 (bank_transfer): REQUIRED
- STAGE 6.3 (admin_test):    REQUIRED
- STAGE 6.4 (admin):         REQUIRED (частично может быть HOLD)
- STAGE 6.5 (writers):       REQUIRED
- STAGE 6.6 (guard):         PARTIAL (только new-rows trigger; полный CHECK — Stage 7)
- STAGE 6.7 (checksum):      REQUIRED

## Что НЕ входит в Stage 6

- Физическое удаление legacy строк (только soft-delete + archive-таблица).
- Полный CHECK constraint на `provider` (Stage 7).
- Изменения UI (Stage 5 закрыт, ничего не трогаем).
- Изменение `payment_reconcile_queue` (там только bepaid).
- Изменения в `payments_legacy_archive` (историческая таблица, не трогаем).

## Первый видимый deliverable

Шаг 6.1 discovery + inventory CSV — без единого write. После вашего approve этого артефакта переходим к 6.2 (`bank_transfer` → `bank`) как самому маленькому изолированному куску, чтобы верифицировать процесс.

STAGE 6 EXECUTION: NOT YET AUTHORIZED — жду approve на 6.1 discovery.