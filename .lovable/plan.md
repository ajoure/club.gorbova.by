# да, согласен, с учетом правок:

1. **6.A — источник actor**
  - `meta.processed_by` брать из `auth.uid()` или существующего серверного audit-контекста.
  - Не принимать actor из клиентского параметра RPC.
  - Чтение queue, проверка provider и INSERT должны выполняться атомарно в существующей транзакции с сохранением текущей идемпотентности.
2. **6.B — устранить противоречие по публикации**
  - Нужно выбрать один вариант:
    - функция полностью удалена из registry/deploy и не публикуется;
    - либо временно опубликован 410-stub.
  - Нельзя одновременно требовать `410 Gone` и «функция не публикуется».
  - Discovery должен проверять не только frontend/e2e, но и edge functions, SQL/RPC, cron, scripts, CI и registry.
3. **6.C — fixture определяется не суммой**
  - Amount/currency могут быть дополнительными признаками, но не доказательством fixture.
  - Нужны детерминированные признаки: `source`, `origin`, metadata, test execution ID, E2E marker или lineage от `test-payment-complete`.
  - До DML проверить, что `payments_v2.is_deleted` реально существует и его учитывают все основные consumers.
4. **6.D.1 — защита от drift между preview и DML**
  - Зафиксировать `preview_generated_at`, approved row count и checksum исходного набора.
  - Перед UPDATE повторно выполнить все exact-match проверки.
  - DML должен иметь guard:
    - текущий `provider='admin'`;
    - текущий `source/origin='admin_from_payment'`;
    - тот же `meta.queue_payment_id`;
    - совпадение financial truth;
    - row count равен утвержденному количеству.
  - При любом drift — rollback всего DML, без частичного обновления.
5. **6.D.1 — checksum**
  - На preview формируются:
    - checksum текущего состояния;
    - checksum candidate-набора;
    - ожидаемый checksum после миграции.
  - Фактический post-DML checksum формируется только после отдельного approve и выполнения UPDATE.
6. **6.D.2 — убрать скрытый DML**
  - Формулировка «пометить `meta.stage6_hold_reason`» является UPDATE.
  - В текущем шаге только сформировать `stage6_d2_hold.csv`.
  - Запись hold-признака в БД — только отдельным DML после отдельного approve.
7. **6.E — runtime map нельзя ограничивать** `rg`  
Проверить также:
  - SQL-функции и процедуры;
  - views/materialized views;
  - triggers;
  - RLS policies;
  - cron/background jobs;
  - edge functions;
  - отчётные RPC и прямые запросы.
  Отсутствие чтения в frontend-коде не доказывает отсутствие зависимости.
8. **6.E — не создавать** `access_grant_ledger` **без duplication audit**
  - Сначала проверить существующие `entitlements`, audit/event/ledger-таблицы и механизмы ручной выдачи доступа.
  - Новая таблица допустима только если существующая каноническая модель действительно не подходит.
9. **6.F — исключение должно быть семантическим**
  - Исключать именно `source/origin='admin_grant'`, а не все строки `provider='admin'`.
  - Нулевая сумма является дополнительным guard, но не идентификатором типа записи.
  - Исторические `admin_from_payment` до выполнения 6.D не должны исчезнуть из общей финансовой выручки.
10. **6.G — trigger должен закрывать INSERT и изменение provider**
  - Не только `BEFORE INSERT`, но и изменение `provider` через UPDATE.
  - Trigger должен отклонять:
    - новый INSERT с non-canonical provider;
    - UPDATE, при котором `provider` реально изменяется на non-canonical значение.
  - Обновления других полей legacy-строк с `provider='admin'` блокироваться не должны.
11. **Порядок gates**
  - 6.G выполнять после завершения **6.A и 6.B**, а также после финального поиска всех writer’ов.
  - Иначе активный `admin_test` writer начнёт аварийно падать до его штатного отключения.
12. **DoD 6.A**
  - Вместо ожидания «следующей» production-сделки использовать контролируемый runtime-сценарий.
  - Proof должен показать одновременно:
    - queue provider;
    - созданный `payments_v2.provider`;
    - `origin/source`;
    - queue lineage;
    - отсутствие второй записи при повторном вызове.

После внесения этих уточнений можно начинать с **6.A**. Правило отдельного approve перед историческим DML сохранено корректно.

&nbsp;

План Stage 6 (revised): исправление writer'ов и разбор legacy `provider='admin'`

## Контекст и решение

Массовая миграция 315 строк `provider='admin'` отменяется. Диагностика Stage 6.1R показала, что это три разных класса записей, и их нельзя обрабатывать одинаково. Ручные писатели (`bank`/`rr`/`bepaid`/`stripe` + `origin=manual_admin`) работают правильно и не трогаются.

Реальная проблема — старый RPC `admin_create_deal_from_payment` пишет `provider='admin'`, хотя `admin` не является платёжным провайдером. Это единственный оставшийся источник «загрязнения» поля `provider`. Стратегия: сначала остановить приток, затем аккуратно разобрать исторические записи по классам.

Инвариант поля `provider` (целевое состояние): только `bepaid | stripe | rr | bank`. Способ обработки платежа хранится в `origin` / `source` / `meta`.

## Шаги

### 6.A — Fix writer `admin_create_deal_from_payment` (STOP THE BLEED)

Изменить RPC так, чтобы при создании канонической записи из queue провайдер брался из исходной queue-строки, а не хардкодился как `admin`:

```text
new payments_v2 row:
  provider              = <queue.provider>          -- обычно bepaid
  origin                = 'admin_from_payment'
  source                = 'admin_from_payment'
  meta.queue_payment_id = <queue.id>
  meta.processed_by     = <admin actor>
```

Fail-closed: если `queue.provider` пустой или не входит в canonical allowlist (`bepaid|stripe|rr|bank`) — RPC возвращает ошибку `invalid_source_provider`, ничего не пишет. Никаких fallback на `admin`.

Покрытие: расширить `supabase/tests/admin_create_deal_from_payment_stage2r.sql` сценарием «provider наследуется из queue» и «не-canonical queue.provider → error». Существующие сценарии (idempotency, financial truth, already_linked) остаются зелёными.

DoD 6.A:

- миграция RPC применена;
- новые интеграционные тесты проходят;
- ручная проверка: следующая admin-linked сделка создаёт `provider='bepaid'`, а не `admin`.

### 6.B — Отключить `test-payment-complete` (единственный оставшийся writer `admin_test`)

Убрать edge function `test-payment-complete/index.ts` из активных путей:

- либо полное удаление файла + вычистка из `supabase/functions.registry.txt`;
- либо no-op stub, возвращающий 410 Gone.

Выбор — на этапе Discovery-6.B: сначала `rg` по фронтенду и e2e, убедиться, что endpoint не дергается из production-путей.

DoD 6.B: нет живых вызовов, функция не публикуется, новые строки `provider='admin_test'` не появляются.

### 6.C — 8 исторических `admin_test` строк

Только read-only preview:

- собрать CSV (id, amount, currency, created_at, order_id, meta);
- подтвердить, что все они действительно fixture (сумма/currency/e2e-маркеры);
- предложить: soft-archive через `is_deleted=true` + `meta.stage6_archive_reason='admin_test_fixture'`, без физического удаления.

DoD 6.C выносится в отдельный approve — DML не выполняется до явного «да».

### 6.D — 113 `admin_from_payment`: точечный разбор

Разбить на две подгруппы по факту наличия живой queue-связи:

**6.D.1 — 104 строки с живой queue-записью.**
Preview-миграция (read-only, генерирует artifact, DML не выполняет):

- для каждой строки JOIN на `payment_reconcile_queue` по `meta.queue_payment_id`;
- проверить exact-match: `amount`, `currency`, `queue.status_normalized='successful'`, `queue.provider ∈ canonical allowlist`;
- если всё совпадает — предложить UPDATE `provider = queue.provider`, `origin='admin_from_payment'`, `meta.stage6_relink=true`;
- если хоть одно поле расходится — строка идёт в HOLD-бакет.

Артефакт: `/mnt/documents/stage6/stage6_d1_preview.csv` + checksum до/после.

**6.D.2 — 9 строк без queue-связи.**
Не угадывать. Не относить к финансовым фактам. Пометить `meta.stage6_hold_reason='no_queue_link'` и оставить как есть до отдельного product-решения.

DoD 6.D: preview утверждён отдельно. DML выполняется только после явного approve и только по 104 exact-match строкам. 9 HOLD-строк не мигрируются.

### 6.E — 201 `admin_grant`: не платежи

Read-only investigation:

1. `rg` по коду: где читаются строки `provider='admin' AND source='admin_grant'` (`grant-eligibility`, `document-resolver`, RPC, отчёты);
2. если строки участвуют в выдаче доступа/документов — НЕ трогать до отдельного product-решения о переносе в технический архив (отдельная таблица `access_grant_ledger` или флаг `is_financial=false`);
3. если строки нигде не читаются — предложить soft-archive с `meta.stage6_archive_reason='admin_grant_nonfinancial'`.

DoD 6.E: письменное подтверждение runtime-зависимостей + отдельный approve. В рамках текущего Stage 6 DML НЕ выполняется. Это pre-work для будущего Stage 6.E-DML.

### 6.F — Финансовые отчёты и фильтры

После 6.A + 6.D (даже до полной очистки 6.E) обновить финансовые агрегаты так, чтобы:

- `admin_grant` (zero-amount, non-financial) явно исключался из sum/checksum по выручке;
- provider-фильтр UI не показывал `admin` как выбираемого провайдера (уже гарантировано `ACTIVE_PAYMENT_PROVIDERS` в `src/lib/payments/providers.ts` — проверить, что SQL-стороны PaymentsStatsPanel/get_payments_stats соответствуют).

Это UI/aggregation-only правка, без DML по строкам.

### 6.G — Partial CHECK constraint на новые строки

Только после 6.A (bleed остановлен) добавить trigger BEFORE INSERT на `payments_v2`, отклоняющий `provider NOT IN ('bepaid','stripe','rr','bank')`. Полный table-level CHECK откладывается до Stage 7 (после закрытия 6.D/6.E).

## Порядок исполнения и gates

```text
6.A  writer fix              → own migration + tests    [approve]
6.B  disable test-writer     → code change + registry   [approve]
6.C  admin_test preview      → CSV report               [approve, DML deferred]
6.D  admin_from_payment      → preview CSV              [approve, DML deferred]
6.E  admin_grant runtime map → rg-report                [approve, DML deferred]
6.F  reports/filters         → UI/SQL sync              [approve]
6.G  BEFORE INSERT trigger   → migration                [approve, after 6.A]
```

Каждый шаг — отдельный approve. Никаких массовых DML в одном заходе. Никаких физических DELETE.

## Что НЕ делается

- не преобразуются `admin_grant` в `bank` / `bepaid`;
- не хардкодятся UUID конкретных платежей;
- не используется сумма как fixture-маркер (см. backlog `stripe_test_fixture_marker_v1.md`);
- не трогаются вчерашние ручные `bank`/`rr`/`stripe`/`bepaid` записи;
- не удаляется исторический profile / auth-user;
- `payment_reconcile_queue` не изменяется.

## Артефакты

- `/mnt/documents/stage6/stage6_a_writer_fix_report.md`
- `/mnt/documents/stage6/stage6_c_admin_test_preview.csv`
- `/mnt/documents/stage6/stage6_d1_preview.csv` + checksum
- `/mnt/documents/stage6/stage6_d2_hold.csv`
- `/mnt/documents/stage6/stage6_e_admin_grant_runtime_map.md`

## Следующий шаг после approve

Начать с **6.A** — миграция RPC + расширение `stage2r.sql`. Это единственный шаг, который меняет данные (только новые строки), и он не касается 315 исторических записей.