# Runtime-proof templates Gate A.1 v3.1a

Каталог: `docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1_v3_1a/runtime_proof/`.
Заполняется только после выполнения suite в preview environment.

Каждый файл обязан содержать:
- `timestamp_utc`
- `commit_sha` (git rev-parse HEAD)
- `deploy_revision` (Supabase deploy id / git SHA edge bundle)
- `environment` (`preview` / `production`)

## Файлы

1. `migration_applied.txt` — вывод применения миграции (id, checksum, applied_at, дубли CREATE FUNCTION = 0).
2. `migration_runtime_proof.md` — migration id, checksum, applied_at, schema diff, rollback strategy ref, доказательство идемпотентности (двойное применение = no-op).
3. `functiondef_before.txt` — `pg_get_functiondef` всех затронутых RPC до миграции.
4. `functiondef_after.txt` — то же после.
5. `proconfig.txt` — `SELECT proname, pg_get_function_arguments(oid), prosecdef, proconfig FROM pg_proc WHERE proname LIKE 'rr\_%' ORDER BY 1;`.
6. `owner_security_matrix.txt` — owner каждой RR-функции + `prosecdef`.
7. `privilege_matrix.txt` — `has_function_privilege(role, funcname, 'execute')` для `{anon, authenticated, service_role}` × все RR-функции.
8. `internal_helper_privileges.txt` — доказательство, что `rr_finalize_created_order_internal` недоступен ни одной API-роли (все три = false).
9. `legacy_backfill_before.txt` — список затронутых `order_id` + `meta.rr` до backfill.
10. `legacy_backfill_after.txt` — список затронутых `order_id` + `meta.rr` после backfill.
11. `sql_integration_tests.md` — результаты 18 SQL-тестов (см. `sql_test_suite.md`).
12. `edge_integration_tests.md` — результаты 16 edge-тестов (см. `edge_test_suite.md`).
13. `mock_rr_ledger.json` — экспорт ledger mock RR (см. `mock_rr_ledger_contract.md`).
14. `fault_injection_enable_disable.txt` — enable/disable журнал секрета `RR_TEST_FAULT_MODE` в preview.
15. `fault_injection_absent_in_production.txt` — grep production bundle по `rr-test-fault-hook`; ожидается пустой вывод.
16. `deploy_proof.txt` — preview deploy id + timestamp + edge bundle SHA.
17. `production_snapshot_before.txt` — `SELECT count(*), max(updated_at) FROM orders_v2 WHERE provider='rr'` (production) до применения миграции. Только read.
18. `production_snapshot_after.txt` — то же после применения миграции (только Gate A.1 v3.1a, без тестовых заказов).
19. `production_attribution_diff.txt` — diff snapshots + перечень reasons для каждой изменившейся строки.
20. `rollback_strategy.md` — итоговый rollback ref (см. `rollback_strategy.md` draft).

## Формат заголовка каждого файла

```
timestamp_utc: 2026-07-10T21:34:00Z
commit_sha: <git SHA>
deploy_revision: <deploy id>
environment: preview | production
migration_id: <migration filename>
```

Без всех четырёх полей файл считается недействительным доказательством (правило поправки №3).
