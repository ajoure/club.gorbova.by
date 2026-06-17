# Stage 3 — atomic + concurrent runtime proof (2026-06-17)

**Status: PASS (all_pass=true, 5/5 сценариев)**

Прогон выполнен через транзитную edge-функцию `proof-stage3-runtime` поверх транзитного SECURITY DEFINER-хелпера `_proof_stage3_call_atomic`, имитирующего `auth.uid()` пользователя в той же транзакции, что и `save_session_document_atomic`. После прогона хелпер, edge-функция, audit-записи прогона и временные роли удалены.

Фикстура: реальная сессия «Идеология» `b0b229b7-cf7e-4869-988e-8e97bdf54043` (owner `05cd3754-d589-4d90-97d1-89ba2bee610b`), item «Приказ» `a1291835-…`, item «Положение» `dac9d7b2-…`, роли `ln-000012`/`ln-000013`, person `26402449-…`, orphan-поле `pf-000002`.

## Сценарии

| # | Сценарий | Результат | Доказательство |
|---|----------|-----------|----------------|
| S1 | `orphan_field_not_writable_per_item` (попытка записать pf-000002 в карточке документа) | PASS | RPC возвращает ERRCODE 42501 `orphan_field_not_writable_per_item`; БД не изменена |
| S2 | `stale_template_version` (`_expected_template_version_id` = заведомо неверный uuid) | PASS | RPC возвращает ERRCODE 22023 `stale_template_version`; PostgREST не уходит в retry (исправлено с 40001) |
| S3 | Атомарный rollback (валидная роль + битый person_id во второй роли одного payload) | PASS | RPC RAISE `person_not_accessible`; audit не вырос (0→0); количество строк ролей не изменилось (5→5); маркер `rollback_marker_should_not_persist` отсутствует |
| S4 | Desired-state delete ролей: write {A,B} → write {A} | PASS | После 4a активны ровно {ROLE_A, ROLE_B}; после 4b активна ровно {ROLE_A}, ROLE_B архивирован (is_active=false); `deleted_roles=1` в результате RPC; другие items не затронуты |
| S5 | Concurrent 5×parallel разными payload на одном (session, item) | PASS | `success_count=5`, ошибок 0, дубликатов 0 (`duplicate_keys=[]`), финальное состояние когерентно (`winning_indices=["0"]` — все 2 активные роли принадлежат одному payload), `audit_delta=5` (по одной строке на каждую завершённую транзакцию), `elapsed_ms=119` |

## Дефекты, выявленные proof, и устранённые в этом же спринте

1. **UPDATE роли захватывал inactive-дубли.** `UPDATE … WHERE (session,item,role,person)` без `is_active=true` поднимал исторические `is_active=false` строки до `is_active=true` и срабатывал partial unique index `ux_dpira_active_person` → 23505. Исправлено: UPDATE ограничен `AND is_active = true`.
2. **Race UPDATE→INSERT под 5×parallel.** Заменено на `INSERT … ON CONFLICT` с inference против partial unique indexes (как для `document_package_session_field_values` item-level, так и для `document_package_item_role_assignments` active-only).
3. **`stale_template_version` использовал ERRCODE 40001.** PostgREST трактовал это как serialization_failure и уходил в бесконечный retry. Заменено на 22023 (invalid_argument) — precondition violation, не serialization.
4. **Audit-insert ссылался на несуществующие колонки** (`actor_id`, `resource_type`, `resource_id`, `payload`), `audit_logs` использует `actor_user_id`/`entity_type`/`entity_id`/`meta`. Любая успешная транзакция тихо откатывалась с ошибкой `column "actor_id" … does not exist`. Это означает, что Stage 2 «code-complete» статус был верен только по форме контракта — runtime никогда не работал. Исправлено.

Все четыре фикса вошли в финальную версию `save_session_document_atomic` (миграции `20260617_111…`).

## Полный JSON-результат

```json
{
  "all_pass": true,
  "steps": [
    {"name":"S1.orphan_per_item_rejected","ok":true,"details":{"error":"orphan_field_not_writable_per_item"}},
    {"name":"S2.stale_version_rejected","ok":true,"details":{"error":"stale_template_version"}},
    {"name":"S3.atomic_rollback","ok":true,"details":{"error":"person_not_accessible","audit_before":0,"audit_after":0,"leaked":false,"rows_before":5,"rows_after":5}},
    {"name":"S4.desired_state_delete","ok":true,"details":{"r4a":{"ok":true,"written_roles":2,"deleted_roles":0},"r4b":{"ok":true,"written_roles":1,"deleted_roles":1},"ids4a":["7f0bffd2-…","9b9a8b7a-…"],"active4b_count":1,"archivedB":true}},
    {"name":"S5.concurrent_5_parallel","ok":true,"details":{"elapsed_ms":119,"success_count":5,"errors":[null,null,null,null,null],"active_count":2,"duplicate_keys":[],"winning_indices":["0"],"audit_delta":5,"markers":["concurrent_payload_0_A","concurrent_payload_0_B"]}}
  ]
}
```

## Cleanup

- Восстановлены оригинальные роли сессии «Идеология» (5 строк, 1 активная с `position=юрисконсульт`, остальные `is_active=false`).
- Удалены 7 audit-записей, созданных прогоном S4+S5.
- Удалён хелпер `public._proof_stage3_call_atomic`.
- Удалена edge-функция `proof-stage3-runtime` (и её запись в `supabase/config.toml`).
