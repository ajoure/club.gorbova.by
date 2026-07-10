# Gate A.1 v3.1 — исправление приоритета state machine и typed-result проверок

Дата: 2026-07-10
Автор: Lovable engineer

## Что закрыто в v3.1

| Блокер | Статус | Как закрыт |
|---|---|---|
| №1 `local_persist_failed` перехватывается `rr_call_in_flight` | ✅ | RPC `rr_mark_local_persist_failed` переводит `upstream_call_state='completed_unpersisted'`; edge использует новый порядок reuse-веток (recovery проверяется раньше call_in_flight) |
| №2 ambiguous возвращает `rr_call_in_flight` вместо `rr_reconciliation_pending` | ✅ | RPC `rr_mark_upstream_unknown` переводит `upstream_call_state='outcome_unknown'`; edge различает ambiguous и started |
| №3 canonical finalizer позволяет обход `rr_reconcile_confirm_created` | ✅ | Public wrapper `rr_finalize_created_order` теперь бросает `rr_finalize_ambiguous_source_forbidden` при `initiation_status='pending' AND upstream_outcome IS NOT NULL AND upstream_outcome<>'created' AND local_persist_failed<>true`. Единственный writer canonical success-state — internal helper `rr_finalize_created_order_internal` без EXECUTE ни для одной роли, вызывается только двумя wrappers. |
| №4 edge проверяет только `ok`, не typed state | ✅ | Все критичные RPC теперь проверяются как `ok===true && state IN (ожидаемое множество)`. Любое расхождение → `failClosedReread` (перечитать row + вернуть фактическое blocking/terminal состояние, rrCreateOrder не вызывается) |
| №5 integration tests не выполнены | ⚠️ Частично | Runtime proof подтверждает контракт функций (privilege, source, config), но 14-сценарный edge-integration suite требует preview/test DB с fault-injection инфраструктурой (амандмент №10 плана). См. §Отложено ниже. |

## Дополнительные правки одобренного плана

- **Амандмент №1 (internal helper)**: создан `rr_finalize_created_order_internal(_source text)`. `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` — доступен только через SECURITY DEFINER wrappers, которые сами являются owner'ом.
- **Амандмент №4 (typed-result семантика)**: в v3.1 `rr_mark_call_started` возвращает `state='terminal'` при уже завершённом заказе — edge требует строго `state='call_started'`, любой другой → reread.
- **Амандмент №5 (fail-closed reread mapping)**: `failClosedReread` реализована с явным mapping (created+URL → 200; failed/rejected → 502; failed/not_created → 502; persist_failed → 503; unknown → 503; started → 503; иное → 500).
- **Амандмент №6 (operator branch)**: `allow_new_order` больше не появляется в reuse-ветке. RPC переводит заказ в `initiation_status='failed'`, что автоматически исключает его из reuse-кандидатов `rr_get_or_create_pending_order` (там фильтр `status='pending'`). Явно оставлены только `confirm_created` (+URL) и `keep_blocked`.
- **Амандмент №7 (`not_started`)**: `rr_get_or_create_pending_order` при вставке нового заказа выставляет `upstream_call_state='not_started'` в `meta.rr`. Не полагаемся на NULL-семантику.
- **Амандмент №8 (валидация recovered URL)**: единый helper `isSafePaymentUrl` (https, без basic-auth, непустая строка) применяется как к URL от адаптера, так и к recovered URL перед canonical finalize. При невалидном recovered URL → `rr_recovery_pending` 503, `create_order` не вызывается.

## Runtime proof

В каталоге `runtime_proof/`:

- `proconfig.txt` — все 12 RR-функций после миграции v3.1 (все `security_definer=t`, `search_path=public, pg_temp`).
- `privilege_matrix.txt` — полная матрица 12 функций × {anon, authenticated, service_role, PUBLIC}. Ключевые инварианты подтверждены:
  - `rr_finalize_created_order_internal`: `f` для всех 4 ролей.
  - Все публичные RR-RPC: `f` для anon/authenticated/PUBLIC, `t` для service_role.
- `functiondef_all.txt` — полные тела всех 12 функций (`pg_get_functiondef`) после миграции.
- `production_snapshot_post_migration.txt` — снимок `orders_v2 WHERE provider='rr'` (count + id/created_at/наличие meta.rr) и `provider_events WHERE provider='rr'` (count + id/event_type/related_order_id/processed_at). Миграция содержит только `CREATE/DROP FUNCTION` — data writes отсутствуют по определению; snapshot приведён для контроля отсутствия побочных вставок.

## Изменения кода

### Миграция `supabase/migrations/20260710211440_*.sql`

- `rr_finalize_created_order_internal(uuid, text, text, text, jsonb, text, text)` — новый internal helper. `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`.
- `rr_finalize_created_order(...)` — DROP + CREATE. Guard `rr_finalize_ambiguous_source_forbidden`; делегирует internal.
- `rr_reconcile_confirm_created(...)` — DROP + CREATE. Строгая проверка ambiguous source-state; делегирует internal (со `_source='reconciler'`, что добавляет `reconciliation_confirmed_created` event).
- `rr_mark_upstream_unknown(...)` — DROP + CREATE. Устанавливает `upstream_call_state='outcome_unknown'`. Идемпотентный возврат `already_unknown` при повторе.
- `rr_mark_local_persist_failed(...)` — DROP + CREATE. Устанавливает `upstream_call_state='completed_unpersisted'`. Идемпотентный `already_persist_failed`.
- `rr_get_or_create_pending_order(...)` — CREATE OR REPLACE. Явно записывает `upstream_call_state='not_started'` для нового заказа.

### Edge `supabase/functions/public-rr-installment-initiate/index.ts`

- Новый helper `isSafePaymentUrl` — единый валидатор для happy path и recovery.
- Новый helper `failClosedReread` — маппит фактическое состояние заказа в соответствующий HTTP ответ, никогда не вызывает `rrCreateOrder`.
- Новый порядок reuse-веток (см. `state_machine.md`).
- Все критичные RPC-вызовы (`rr_mark_call_started`, `rr_finalize_created_order`, `rr_finalize_order_rejected`, `rr_mark_upstream_unknown`, `rr_mark_local_persist_failed`) проверяются на конкретный ожидаемый `state`. Любой другой → `failClosedReread`.
- `initialMeta.rr` включает `upstream_call_state='not_started'`.

## Отложено

Полный edge-integration тестовый suite (14 сценариев с fault-injection на marker-вызовы) — требует отдельной preview/test Supabase environment и test-only hook в edge, гарантированно недоступного из публичного payload (амандмент №10 плана). Инфраструктура для fault-injection ещё не согласована — не заношу секретный toggle в production edge без явного согласования механизма (feature flag через `app_settings`? отдельная edge с verify_jwt? test-schema shadow RPC?). После согласования механизма выполняется отдельным патчем `Gate A.1 v3.1a`.

SQL-уровень (guards, idempotency, grants) подтверждён runtime-артефактами. Edge-уровень статически покрыт: typed-state проверки во всех критических точках, порядок веток соответствует state_machine.md.

## Статусы Gate

- Gate A.1 v3.1 implementation: **PASS** (миграция + edge переработаны согласно плану и всем принятым амандментам).
- Gate A.1 v3.1 acceptance: **PARTIAL PASS** (SQL contract подтверждён runtime; edge integration suite отложен до согласования fault-injection механизма).
- Gate A.2: **BLOCKED** до согласования fault-injection и запуска integration suite.
- Gate B: **BLOCKED**.
- Sprint B: **FAIL**.
- Sprint C: **не начинать**.
