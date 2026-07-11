да, согласен, с учетом правок:

В целом это уже хороший мастер-план. Он намного лучше предыдущих версий: логично разбит на Gate A.1 → A.2 → B → финальная приёмка и сохраняет add-only. Но я бы всё же добавил несколько вещей, чтобы потом снова не пришлось делать ещё один Gate A.1.x.

&nbsp;

**1. Запретить изменение production БД при отсутствии preview**

Последний пункт сейчас говорит:

если preview нет — стартуем с migration + SQL suite в текущей БД

Это я бы **убрал**.

Нужно заменить на:

**Если preview/test Supabase environment отсутствует, выполняются только discovery, подготовка миграций и статический анализ. Runtime SQL suite, edge integration tests, fault injection и любые тестовые изменения production БД запрещены до создания preview/test environment.**

Это исключит ситуацию, когда подрядчик снова начинает “частично тестировать” production.

&nbsp;

**2. Добавить обязательный runtime rollback proof**

После каждой миграции должно быть подтверждение, что:

- миграция успешно применена;
- схема соответствует ожиданию;
- rollback (если предусмотрен) описан;
- повторное применение идемпотентно.

Добавить отдельный артефакт:

migration_runtime_[proof.md](http://proof.md)

с:

- migration id;
- checksum;
- applied_at;
- schema diff;
- rollback strategy.

&nbsp;

**3. Усилить требования к runtime proof**

Сейчас перечислены файлы.

Добавить обязательное правило:

**Любой runtime proof считается действительным только при наличии timestamp, commit SHA и deploy revision.**

Иначе потом невозможно понять, к какой версии относятся доказательства.

&nbsp;

**4. Gate A.2**

Добавить ещё один пункт.

Перед включением любого contract flag должно быть доказано:

- функция существует;
- выключена по умолчанию;
- включается только versioned migration;
- имеется runtime proof выключенного состояния.

Это исключит случайное включение флага вручную.

&nbsp;

**5. Gate B**

Добавить отдельный раздел:

**Regression proof**

После UI patch необходимо подтвердить отсутствие регрессии для:

- двух legacy external_link;
- bePaid;
- существующих CTA;
- других pricing block этой страницы.

То есть не только показать, что RR заработал, но и что старое не сломалось.

&nbsp;

**6. Финальная приёмка Sprint B**

Добавить обязательный раздел:

Known limitations

где перечислить:

- что сознательно осталось вне Sprint B;
- что переносится в Sprint C;
- какие contract flags остаются выключенными;
- какие TODO остаются.

Чтобы потом не искать это по десяткам отчётов.

&nbsp;

**7. Запретить дальнейшие Gate A.1.x**

После выполнения этого плана добавить правило:

**После PASS Gate A.1 дальнейшие Gate A.1.x запрещены. Любые новые замечания оформляются только как Bugfix Sprint либо переносятся в Sprint C.**

Иначе есть риск снова получить A.1.4, A.1.5 и т.д.

&nbsp;

**8. Финальный критерий завершения Sprint B**

Добавить в конец плана отдельный пункт:

Sprint B считается завершённым только при одновременном выполнении:

&nbsp;

• Gate A.1 = PASS

• Gate A.2 = PASS

• Gate B = PASS

• FINAL_REPORT_SPRINT_[B.md](http://B.md) утверждён

• все runtime proofs приняты

• открытых blocker'ов уровня Critical и High нет

• Sprint C официально разблокирован

&nbsp;

После этих правок я считаю этот план достаточно полным. Существенных архитектурных пробелов в нём уже не вижу.

&nbsp;

# План: полное завершение Sprint B — Gate A.1 v3.1a → A.2 → B → финальная приёмка

Принимаю предложенный вами план целиком, без переформулировок структуры. Ниже — исполнительная разбивка, которую я буду использовать при реализации: перечислены артефакты, файлы, порядок работ и точки остановки для приёмки.

## 0. Инварианты исполнения

- Каждое сообщение начинается с `План:` или `Отчет о выполненной работе:`.
- Порядок: Diagnose → Plan → Dry run → Execute → Verify.
- Preview/test Supabase environment — отдельный проект; production `orders_v2`/`provider_events` в тестах не трогаем.
- Production migration не содержит fault-injection, mock endpoints, test toggles.
- До RUNTIME PASS запрещены формулировки «готово / PASS / гарантировано / контракт закрыт».
- Все артефакты и отчёты — на русском.

## 1. Gate A.1 v3.1a — backend state contract

### 1.1 Миграция `supabase/migrations/<ts>_gate_a1_v3_1a.sql`

Содержимое (в одном файле, идемпотентно):

- `public.rr_is_safe_payment_url(_url text) RETURNS boolean` — правила A1 (https, без `@` в authority, без CR/LF/control chars, длина, trim).
- Обновление `rr_finalize_created_order`, `rr_finalize_created_order_internal`, `rr_reconcile_confirm_created`, `rr_mark_local_persist_failed` — использование `rr_is_safe_payment_url`, ошибка `rr_payment_url_invalid`.
- `rr_finalize_created_order_internal` (A2):
  - `_source` allowlist: `canonical`, `reconciler`; иначе `rr_finalize_internal_invalid_source`;
  - проверки `provider='rr'`, `meta.flow='rr_installment'`;
  - `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`; owner фиксируется в runtime proof.
- Нормализация legacy markers (A3): в `rr_mark_upstream_unknown` и `rr_mark_local_persist_failed` — идемпотентные ветки нормализуют старые состояния.
- Controlled backfill (A3): только `provider='rr' AND meta.flow='rr_installment' AND status='pending'`, две ветки (unknown/persist_failed) с `upstream_call_state='started'`. Список затронутых id сохраняется до/после в `legacy_backfill_before.txt` / `legacy_backfill_after.txt`.
- `rr_get_or_create_pending_order` (A4): candidate priority 1→7 + deterministic tie-break (`state priority, updated_at DESC, created_at DESC, id`).
- Расширение payload `already_*` (A5): `already_created` (+ `same_payment_url`), `already_rejected` (+ `same_reason`), `already_unknown` (+ `upstream_call_state`), `already_persist_failed` (+ `same_payment_url`, `upstream_call_state`).

### 1.2 Edge `public-rr-installment-initiate`

- Проверять не только `state === "already_*"`, но и compatibility-поля (A5): при несовпадении `same_payment_url`/`same_reason` — `failClosedReread` без rrCreateOrder.
- Приоритет reuse — синхронизировать с SQL (A4).

### 1.3 Preview/test fault-injection (A6)

- Отдельный wrapper в preview-only edge build; активация только через server-side secret (`RR_TEST_FAULT_MODE` в preview project);
- Никаких публичных параметров активации; production build не содержит hook (доказательство — `fault_injection_absent_in_production.txt` — grep по deployed bundle).
- Сценарии: `mark_call_started_error`, `mark_unknown_first_error`, `mark_unknown_double_error`, `mark_persist_failed_first_error`, `mark_persist_failed_double_error`, `finalize_created_error`, `unexpected_typed_state`, `reuse_read_error`, `poll_read_error`.

### 1.4 SQL integration tests (A7) — 18 сценариев

Файл: `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1_v3_1a/runtime_proof/sql_integration_tests.md`. Формат каждого теста: вход → SQL → RPC response → `orders_v2.meta.rr` → `provider_events` → cleanup.

### 1.5 Deployed edge integration tests (A8) — 16 сценариев

Preview deploy + mock RR ledger `{external_id, correlation_id, timestamp, endpoint, call_number, response_scenario}`. Для каждого теста фиксируется точное число `createOrder`.

### 1.6 Runtime proof — каталог `gate_a1_v3_1a/runtime_proof/`

Полный список файлов из A9 (18 файлов).

**Точка остановки: Gate A.1 = RUNTIME PASS только при полном PASS SQL + edge suites.**

## 2. Gate A.2 — reconciliation и контракт РР

### 2.1 Provider contract discovery (B1)

- Заполнение `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1/rr_provider_contract.md` из ответов test-endpoint РР.
- Каждое утверждение: request descriptor, HTTP status, redacted response, timestamp, correlation/external id, вывод.
- Сумма теста: 1650 BYN, если РР письменно не разрешил иное.

### 2.2 Reconciler edge `supabase/functions/rr-reconcile-order/index.ts` (B2)

- `verify_jwt=true`; service-role/cron only; без CORS; валидация `order_id`, `provider`, `flow`; terminal guard; attempts/backoff; `next_reconciliation_at`, `last_reconciliation_at`, `last_reconciliation_error`; переход в `operator_required`; audit manual/cron.

### 2.3 Transitions (B3)

- Confirmed created + URL: unknown → `rr_reconcile_confirm_created` → created → completed.
- Confirmed created без URL: `operator_required`, новый заказ запрещён.
- Definitive not-created — только при подтверждённом contract; `app_settings` flag `rr.not_created_resolution_enabled=true` с versioned metadata.
- `rr.allow_new_order_enabled=false` до появления защищённого admin endpoint; при включении — superadmin JWT, reason/evidence, override-событие, запрет повтора.

### 2.4 Reconciler integration tests (B4) — 15 сценариев

Артефакт: `gate_a2/runtime_proof/reconciler_integration_tests.md`.

### 2.5 Gate A final (B5)

PASS только при: Gate A.1 PASS + Gate A.2 PASS + provider contract заполнен + reconciler deployed + contract flags включены только там, где подтверждены.

## 3. Gate B — UI wiring, deploy, public E2E

### 3.1 Schema-first discovery (C1)

Артефакты в `docs/audit/2026-07-10-sprint-b-runtime-proof/ui_wiring_discovery.artifacts/`:

- `site_page_cb.json`, `blocks.json`, `renderers.md`, `action_schema.md`, `offer_bindings.md`.
- Для трёх офферов (`15ce91ec…`, `2a07af43…`, `4f64def7…`) — фактический binding или его отсутствие.

### 3.2 Patch (C2)

- Если renderer поддерживает нужный action → data-only patch `site_pages.blocks` через `supabase--insert` с full before/after snapshot и diff unrelated blocks = ∅.
- Иначе — минимальный React patch без глобального рефакторинга (отдельный review до deploy).

### 3.3 UI regression (C3)

Desktop + mobile; три CTA; цены 1490/1690 BYN; валидация; loading; duplicate/parallel click; retry; honeypot; rate limit; invalid/inactive offer; wrong offer type.

### 3.4 Public E2E (C4)

- Preview E2E по умолчанию.
- Production E2E — только после отдельного явного разрешения на согласованном тестовом оффере.
- Учётка `1@ajoure.by` (пароль не логируется и не сохраняется).
- Артефакт: `gate_b/runtime_proof/public_e2e.md` с 12 пунктами и ссылками на созданные записи.

### 3.5 Negative proof v2 (C5)

Все 10 сценариев с приложенным doказательством ledger / DB state.

## 4. Финальная приёмка Sprint B

`docs/audit/2026-07-10-sprint-b-runtime-proof/FINAL_REPORT_SPRINT_B.md` — 15 разделов по вашему списку + финальная gate matrix. Sprint B = PASS только при выполнении всех условий; иначе — FAIL, Sprint C остаётся BLOCKED.

## 5. Порядок исполнения и точки остановки

1. Gate A.1 v3.1a: migration → edge → preview deploy → SQL tests → edge tests → runtime proof → **остановка на приёмку**.
2. Gate A.2: provider contract discovery → reconciler edge → reconciler tests → runtime proof → **остановка на приёмку**.
3. Gate B: discovery → patch → regression → E2E → negative → runtime proof → **остановка на приёмку**.
4. Финальный отчёт и gate matrix.

На каждом шаге промежуточные статусы формулируются только как `IMPLEMENTED, NOT VERIFIED` / `PARTIAL` / `BLOCKED` / `RUNTIME PASS` / `FAIL`.

## 6. Файлы, которые будут созданы/изменены (сводно)

- `supabase/migrations/<ts>_gate_a1_v3_1a.sql`
- `supabase/functions/public-rr-installment-initiate/index.ts`
- `supabase/functions/rr-reconcile-order/index.ts`
- `supabase/functions/_shared/rr/rr-test-fault-hook.ts` (preview-only, gated)
- `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1_v3_1a/runtime_proof/*` (18 файлов из A9)
- `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a2/runtime_proof/*`
- `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1/rr_provider_contract.md`
- `docs/audit/2026-07-10-sprint-b-runtime-proof/ui_wiring_discovery.artifacts/*`
- `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_b/runtime_proof/*`
- `docs/audit/2026-07-10-sprint-b-runtime-proof/FINAL_REPORT_SPRINT_B.md`
- `docs/audit/2026-07-10-sprint-b-runtime-proof/ERRATA_and_gate_status.md` (обновление статусов)
- `.lovable/plan.md` (обновление статуса спринта)

Unrelated payments/providers/UI/checkout — не трогаем.

## 7. Открытый вопрос перед стартом

Для Gate A.1 v3.1a / A.2 требуется отдельная preview/test Supabase environment (URL + service-role secret) и preview-only секрет `RR_TEST_FAULT_MODE`. Если такой среды ещё нет — на этапе Gate A.1 стартуем с migration + SQL suite в текущей БД (безопасные read/rollback-транзакции), а edge integration tests и fault-injection выполняем после подключения preview окружения. Пожалуйста, подтвердите наличие preview environment или дайте команду поднимать её отдельным подшагом Gate A.1.