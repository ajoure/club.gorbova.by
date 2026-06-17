# Stage 2 — Atomic Save RPC

Date: 2026-06-17
Migration: `save_session_document_atomic` (CREATE OR REPLACE FUNCTION)

## Что реализовано

- RPC `public.save_session_document_atomic(_session_id, _package_template_item_id, _field_values, _role_assignments, _expected_template_version_id)` — `SECURITY DEFINER`, `LANGUAGE plpgsql`, `search_path=public`.
- Никаких `BEGIN/COMMIT/ROLLBACK` внутри функции; всё в одной транзакции; любая RAISE автоматически откатывает поля и роли.
- Guards (server-side, дублируются с hooks):
  - `forbidden` если `auth.uid()` пуст;
  - `session_not_found` / `forbidden` (не владелец и не admin/super_admin);
  - `item_not_found` / `item_outside_session_package`;
  - `stale_template_version` при несовпадении `_expected_template_version_id` с фактическим `document_templates.current_version_id` (fallback `is_current=true`);
  - `field_not_found` / `field_outside_session_package` / `field_archived`;
  - `orphan_field_not_writable_per_item` — pf, отсутствующий в `detected_tokens`/`tokens` активной версии шаблона item;
  - `value_type_mismatch` при невалидном cast (date/number/datetime/time/checkbox/multiselect);
  - `role_not_found` / `role_outside_session_package` / `role_archived` / `person_not_accessible`;
  - `role_or_person_missing` / `missing_field_catalog_id` / `invalid_arguments`.
- Fields — sparse patch (UPDATE→INSERT). Пропущенные поля НЕ удаляются. Reset only через `delete_session_field_value` (отдельный RPC, не трогается).
- Roles — desired full state: upsert по (session,item,role,person), затем `is_active=false` по всем `is_active=true`, не вошедшим в `v_kept_ids`. Другие items и сессии не трогаются.
- Audit: ровно одна запись в `audit_logs` с `action='package_document_atomic_save'`, payload содержит `package_template_item_id`, `template_version_id`, `written_fields`, `written_roles`, `deleted_roles`.
- GRANT EXECUTE → `authenticated, service_role`.

## Hook

`src/hooks/useAtomicDocumentSave.ts` — `useMutation`-обёртка. Invalidate queries только после `ok:true`. При ошибке прокидывается raw PostgrestError (вызывающий код нормализует через `normalizeEdgeFunctionError`).

## DoD статус

| DoD | Статус |
| --- | --- |
| Atomic rollback (ошибка в ролях откатывает fields) | PASS by construction (одна транзакция, RAISE откатывает всё) |
| Desired-state ролей: удаление из UI → soft-archive только в этом item | PASS by construction (`AND NOT (id = ANY(v_kept_ids))` scoped по item) |
| Concurrent (5× parallel, одно когерентное финальное состояние) | DEFERRED → Stage 3 proof script |
| Multi-tenant (6 сценариев) | DEFERRED → Stage 4 proof script |

## Регрессии

- `upsert_session_field_values` НЕ изменена; orphan session-level save для общих полей пакета по-прежнему идёт через старый путь (orphan-guard в новом RPC относится только к per-item write).
- `useDocumentItemRoleAssignments.saveMutation` остаётся как legacy fallback; будет вытеснён в Stage 5 (unified `PackageDocumentCard`).
- `canonical-document-generate-strict`, snapshot builder, билинговый резолвер — НЕ затронуты.
