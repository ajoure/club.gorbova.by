Да, согласен, с учетом правок:

1. **Сначала dry-run до code edit.**  
Перед изменением функции нужно зафиксировать, что именно эти 2 REBILL-заказа классифицируются как collision через orders_v2.provider_payment_id.
2. **SELECT должен добавить не только provider_payment_id, но и provider.**  
Чтобы не использовать колонку UID для чужого провайдера.
3. **Fallback по колонке разрешить только если provider='bepaid'.**  
Иначе можно ошибочно схлопнуть чужие UID.
4. **Добавить regression-test/fixture на эти 2 кейса.**  
Нужно доказать, что:
  - meta пустой по UID;
  - column provider_payment_id заполнен;
  - payments_v2 уже содержит такой UID;
  - заказ получает superseded_by_repair=true.
5. **Execute через UI System Health — только после deploy и dry-run результата.**  
В proof отдельно зафиксировать:
  - patch deployed;
  - execute запущен пользователем из UI;
  - rowcount superseded;
  - INV-20 после execute.

**Текст для Lovable**

План принимаю с правками.

&nbsp;

PATCH-INV20-REBILL-SUPERSEDED-2026-05 подтверждаю.

&nbsp;

Scope остаётся минимальный:

- только `supabase/functions/admin-repair-missing-payments/index.ts`;

- без изменений bepaid-webhook;

- без изменений grant-access-for-order;

- без изменений payments_v2 schema;

- без миграций;

- без RLS;

- без cron;

- без UI System Health.

&nbsp;

Обязательные правки:

&nbsp;

1. Перед code edit выполнить read-only dry-run:

- проверить 2 REBILL-order:

  - REBILL-2071054f-906;

  - REBILL-97fb20f7-f7c;

- доказать, что `meta` не содержит UID;

- доказать, что `orders_v2.provider_payment_id` содержит UID;

- доказать, что `payments_v2.provider_payment_id` уже существует и привязан к каноническому SUB-order;

- expected classification после patch = `uid_collision_via_column.provider_payment_id`.

&nbsp;

2. В SELECT добавить:

- `provider_payment_id`;

- `provider`.

&nbsp;

3. Добавить helper `extractOrderUid(order)`:

- сначала использовать текущий `extractUidFromMeta(order.meta)`;

- если пусто, использовать `order.provider_payment_id`;

- fallback по колонке разрешён только если `order.provider='bepaid'`;

- вернуть source:

  - `meta.*`

  - или `column.provider_payment_id`.

&nbsp;

4. Заменить вызовы `extractUidFromMeta(order.meta as any)` на `extractOrderUid(order)` только в:

- Step 2c;

- Step 5 collision detection.

&nbsp;

5. Не менять `extractUidFromMeta` напрямую.

&nbsp;

6. Добавить regression test/fixture:

- order source=bepaid_rebill;

- meta без transaction_uid / bepaid_payment_uid / provider_payment_id;

- column `provider_payment_id` заполнена;

- matching `payments_v2.provider_payment_id` существует;

- результат = superseded collision, not orphan.

&nbsp;

7. Deploy function.

&nbsp;

8. Execute:

- через UI System Health;

- mode=execute;

- since_days=30;

- после deploy;

- с admin/super_admin JWT.

&nbsp;

9. Verify:

SQL:

SELECT order_number,

       meta->>'superseded_by_repair' AS sup,

       meta->>'superseded_by_order' AS by_order,

       meta->>'superseded_reason' AS reason

FROM orders_v2

WHERE order_number IN ('REBILL-2071054f-906','REBILL-97fb20f7-f7c');

&nbsp;

Ожидание:

- `sup=true` по обеим строкам;

- `by_order` указывает на канонический SUB-order;

- `reason LIKE 'uid_collision_via_column.provider_payment_id%'`.

&nbsp;

Дополнительно:

- INV-20 paid-orders без payments_v2 минус superseded = 0 за 30 дней;

- новых строк в payments_v2 = 0;

- orphan bucket уменьшился минимум на 2;

- proof создан:

  `.lovable/proofs/patch_inv20_rebill_superseded_2026_05.md`.

&nbsp;

STOP-guards:

- если `provider != 'bepaid'`, column fallback не применять;

- если UID из колонки конфликтует с meta UID — manual_review, не supersede;

- если matching payment принадлежит другому пользователю/провайдеру без доказуемого SUB-order — не supersede;

- если больше 2 неожиданных новых collision в since_days=30 — показать diff в proof, не скрывать.

Коротко: план правильный, но нужен **provider guard** и **dry-run доказательство до code edit**, чтобы колонка provider_payment_id не начала случайно схлопывать не-bePaid заказы.

&nbsp;

## План: PATCH-INV20-REBILL-SUPERSEDED-2026-05

### Diagnose

INV-20 алерт указывает 2 paid заказа за 30д без `payments_v2`:

- `REBILL-2071054f-906` (provider_payment_id=`2071054f-906d…`)
- `REBILL-97fb20f7-f7c` (provider_payment_id=`97fb20f7-f7cc…`)

Оба — артефакты `source=bepaid_rebill`. Фактический платёж по этим же `provider_payment_id` уже записан в `payments_v2` и привязан к каноническим `SUB-*` заказам:

- `2071054f-906d…` → `SUB-26-MLQD06YA6MGY` (payment id `e1238eac…`, status=succeeded).
- `97fb20f7-f7cc…` → `SUB-26-MO5IUQ6K1UHL` (payment id `c5c7dcd0…`, status=succeeded).

Это классический UID-collision (Strategy 5 в `admin-repair-missing-payments`). Однако функция не помечает их как `superseded`, потому что `extractUidFromMeta` читает UID только из `meta.{transaction_uid|bepaid_payment_uid|provider_payment_id}`. В REBILL-заказах эти ключи в `meta` отсутствуют — UID лежит ТОЛЬКО в колонке `orders_v2.provider_payment_id`. В результате эти заказы каждый прогон уходят в `orphaned` вместо `superseded`.

Дополнительный контекст алерта: orphan=23, synthetic=0, suppressed=0. Скорее всего, бóльшая часть оставшегося orphan-bucket — однотипные REBILL-* за более старый период; этот же фикс их подцепит.

### Изменения (минимальный scope)

**Файл:** `supabase/functions/admin-repair-missing-payments/index.ts`

1. Добавить helper `extractOrderUid(order)`:
  - сначала пробует `extractUidFromMeta(order.meta)` (как сейчас);
  - если не нашлось — читает `order.provider_payment_id` и возвращает `{ uid, source: "column.provider_payment_id" }`.
2. Расширить SELECT на шаге 1 — добавить `provider_payment_id` в список колонок.
3. Заменить вызовы `extractUidFromMeta(order.meta as any)` на `extractOrderUid(order)` в:
  - Step 2c (materialization UID из самого order'а);
  - Step 5 (collision detection).
4. Никаких изменений в логике записи/удаления, в `superseded_reason`-маркировке, в bepaid-webhook, grant-access, payments_v2-схеме или write-path. Это только пост-фактум классификация сиротских записей.

После деплоя — запустить функцию из UI System Health в режиме `execute, since_days=30` (требует JWT admin/super_admin; запускает пользователь — у меня нет admin-сессии в превью).

### Verify (DoD)

- SQL: `SELECT order_number, meta->>'superseded_by_repair' AS sup, meta->>'superseded_by_order' AS by_order, meta->>'superseded_reason' AS reason FROM orders_v2 WHERE order_number IN ('REBILL-2071054f-906','REBILL-97fb20f7-f7c');` → обе строки `sup=true`, `by_order` указывает на `c11a518d…` и `ea774d6c…` соответственно, `reason LIKE 'uid_collision_via_column.provider_payment_id'`.
- Повторный INV-20 sweep за 30д: paid-orders без `payments_v2` минус superseded → 0 алертов.
- Никаких новых строк в `payments_v2` (репарация только меняет `orders_v2.meta`).
- `orphan` bucket уменьшается минимум на 2 (точнее — после execute посмотрим итог в audit/ответе функции).

### Scope-guard

- Не трогаем: `bepaid-webhook`, `grant-access-for-order`, `payments_v2` schema, write-path заказов, UI System Health, RPC, миграции, cron, RLS.
- Не создаём новые таблицы/функции/секреты.
- Не меняем `extractUidFromMeta` (только добавляем обёртку поверх).

### Файлы

- edit: `supabase/functions/admin-repair-missing-payments/index.ts`
- create: `.lovable/proofs/patch_inv20_rebill_superseded_2026_05.md` (после Verify)