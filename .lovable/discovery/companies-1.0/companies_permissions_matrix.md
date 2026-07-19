# companies_permissions_matrix.md

Только реально существующие роли (проверено через `SELECT code FROM roles`). Явные основания указаны через ссылки на существующие resource/section access.

## 1. Реальные роли в проекте

| code | Статус | Комментарий |
|---|---|---|
| `super_admin` | existing | полный доступ |
| `admin` | existing | admin CRM |
| `admin_gost` | existing | **фактически без CRM-доступа** — см. §2 discovery |
| `editor` | existing | редактор контента |
| `menedzher` | existing | CRM manager (транслит) |
| `support` | existing | поддержка |
| `user` | existing | обычный пользователь |

Не найдено: `crm_manager`, `readonly`, `employee`. Все упоминания в `.lovable/discovery/crm-tasks-diagnose.md` — future roles, out of scope.

## 2. Discovery существующего доступа (машинно, `SELECT ...`)

Проверено (read-only):

```sql
SELECT r.code, count(*) FROM role_admin_resource_access ra
JOIN roles r ON r.id=ra.role_id GROUP BY r.code;
-- admin: 18; support: 1; admin_gost: 0; menedzher: 0; super_admin: 0; editor: 0; user: 0.

SELECT r.code, s.code AS section, sa.access_level
FROM role_admin_section_access sa
JOIN roles r ON r.id=sa.role_id
JOIN admin_section s ON s.id=sa.section_id
WHERE s.code IN ('crm','contacts','deals','tasks','calls','clients');
-- admin: contacts=manage, deals=manage
-- menedzher: contacts=manage, deals=manage, calls=manage
-- support: contacts=manage, deals=manage
-- admin_gost: (нет записей)
```

Выводы:

- `admin_gost` не имеет ни одной записи `role_admin_resource_access` и `role_admin_section_access` для CRM-секций. Роль исторически ограничена не-CRM областями. Копирование поведения `admin` для CRM не имеет фактического основания.
- `super_admin` доступ обеспечивается bypass через `has_role_v2` в RLS-политиках, а не через `role_admin_*_access`.
- `menedzher` — фактическая CRM manager роль (contacts/deals/calls manage).
- `support` — read-only паттерн для контактов/сделок.

## 3. Итоговая матрица Companies (Phase 7 target)

Каждая роль — с явным основанием (referenced resource / section).

| Действие | super_admin | admin | admin_gost | menedzher | support | editor | user | Основание |
|---|---|---|---|---|---|---|---|---|
| View list `/admin/companies` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | аналог `section=contacts`: admin/menedzher/support=manage; admin_gost/editor/user=none |
| View `CompanyDetailSheet` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | тот же паттерн |
| Create company (manual) | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | write-паттерн `section=deals` (support=read-only по факту, здесь то же) |
| Edit company fields | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | write-паттерн |
| Archive/merge | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | destructive-паттерн admin-only (аналог bulk delete в `KanbanBulkActionsBar`) |
| Link/unlink contact | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | write-паттерн |
| Import (Amo/CSV) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | admin-only (аналог existing `integration_sync_settings` доступа) |
| View timeline | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | аналог `ContactFeedTab` read access |
| Delete (hard) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | destructive: только super_admin (bypass через has_role_v2) |

Discovery `admin_gost` завершён: роль **не** получает CRM-доступ в Phase 7. Если позже потребуется — отдельный ADR + вставка row в `role_admin_section_access`, без изменения текущего freeze.

## 4. Guards (все слои)

| Слой | Реализация в Phase 7 |
|---|---|
| Sidebar/navigation | `admin_section` code=`companies`, route_prefix=`/admin/companies`; видимость через `role_admin_section_access` для admin/menedzher/support (manage/read) |
| Route guard | `src/pages/admin/AdminCompanies.tsx` обёрнут в `AdminRouteGuard` с ролями `{super_admin, admin, menedzher, support}` |
| RPC authorization | `search_companies`, `crm_company_get_or_create`, `crm_company_link_contact`, `crm_company_upsert_from_billing`, `crm_company_merge`, `crm_company_archive` — SECURITY DEFINER + `has_role_v2` guard |
| RLS на `companies` | SELECT — read-роли; INSERT/UPDATE — write-роли; DELETE — только super_admin; `admin_gost` явно не включён |
| Resource/section registry | Phase 7: INSERT в `admin_section` (code=`companies`, section_type=`crm`); INSERT в `admin_resource` (code=`companies`); INSERT в `role_admin_section_access` для 4 CRM-ролей (не 5) |
| Hidden UI actions | Кнопки archive/merge/import → `useRbac().isAdmin || isSuperAdmin` |

## 5. Что запрещено

- Не создавать роль `crm_manager` — использовать `menedzher`.
- Не давать `anon` доступа к `companies` / `company_contacts` / `client_legal_details_company_map` / `company_sync_queue`.
- Не давать `authenticated` доступа к `company_sync_queue` даже SELECT — только service_role (см. `companies_phase1_execution_plan.md` §3 и `companies_migration_strategy.md` §8).
- Не проверять роль на клиенте без дублирования на RLS.
- Не расширять `admin_gost` доступом к Companies без отдельного ADR.
