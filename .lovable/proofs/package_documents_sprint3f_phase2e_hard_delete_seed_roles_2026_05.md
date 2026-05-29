# Sprint 3F Phase 2e — Hard-delete seed-ролей «Идеологии»

Дата: 2026-05-29

## Решение владельца

PKR-000001…PKR-000011 — тестовые seed/system-роли, не используются в реальных шаблонах. Подлежат полному удалению без блокирующих проверок usage.

## Что сделано (migration)

Одна миграция (`cleanup_ideology_seed_roles`):

1. Резолв `package_template_id` пакета «Идеология» через `is_system=true AND code='ideology'` (без хардкода UUID).
2. Snapshot до удаления → `audit_logs.meta.snapshot_before`.
3. `DELETE` из `document_package_session_participants` для назначений whitelist-PKR.
4. `ALTER TABLE ... DISABLE TRIGGER trg_guard_package_role_catalog_mutations` (per-table, scoped) → `DELETE` whitelist-ролей → `ENABLE TRIGGER`. Никакого `session_replication_role=replica`.
5. `INSERT` в `audit_logs` (action=`package_role_seed_cleanup_deleted`, actor_type=`system`, meta содержит package_template_id, deleted_public_ids[], snapshot_before, reason, sprint).
6. `DROP FUNCTION public.cleanup_ideology_seed_roles()` — никакого permanent bypass.

## Verify

```
SELECT count(*) FROM public.document_package_role_catalog
 WHERE package_template_id='06068dcf-6943-425c-aa6b-8bfaa550cfd2'
   AND is_system=true;
-- → 0
```

Результат RPC: `deleted_roles=11`, `deleted_assignments=0`.

## Автосоздание seed-ролей

Поиск `seedPackageRoles | ensureDefaultRoles | createDefaultPackageRoles | package_company | ideology_responsible` по `src/` и `supabase/functions/` — runtime автосоздания **нет**. Единственный источник — DO-блок в исходной миграции `20260526210730` (выполнена однократно, миграции append-only, повторно не запускается). Защита триггера от удаления системных ролей для всех будущих ролей **сохранена**.

## Empty state UI

- Вкладка «Роли» → «Активные»: «Ролей пока нет. Добавьте первую роль вручную...» + кнопка «+ Добавить роль».
- Секция «Системные роли» в `PackageRolesManager` не рендерится, если `systemRoles.length === 0`.
- Dropdown анкеты: только «— без роли —» + «+ Добавить роль» (для админа).
- Каталог «Пакет: Роли»: пусто для «Идеологии», пока не создана новая роль.

## Инварианты

- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, `record_refund_atomic`, billing resolver, биллинговые шаблоны и FLD — **не тронуты**.
- Триггер `trg_guard_package_role_catalog_mutations` восстановлен в строгий режим.
- Custom-роль PKR-000012 (созданная пользователем ранее) сохранена.

## Финальный статус

```
completed: package UX cleaned; seed/system roles hard-deleted from Ideology
package (11/11); roles are now admin-created only; PKR placeholders are
per-package and rename-safe; ordinary UI contains no dev dry-run or
technical role fields; template upload supports package binding;
generation still deferred
```
