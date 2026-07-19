# companies_permissions_matrix.md

Только реально существующие роли (проверено через `SELECT code FROM roles`).

## 1. Реальные роли в проекте

| code | Статус | Комментарий |
|---|---|---|
| `super_admin` | existing | полный доступ |
| `admin` | existing | admin CRM |
| `admin_gost` | existing | admin с ограничениями (проверить в Phase E execution) |
| `editor` | existing | редактор контента |
| `menedzher` | existing | менеджер (транслит) — фактическая CRM manager роль |
| `support` | existing | поддержка |
| `user` | existing | обычный пользователь |

**Не найдено (не создавать концептуально):** `crm_manager`, `readonly`, `employee`. `employee` фигурирует в `.lovable/discovery/crm-tasks-diagnose.md` как ожидание, но в таблице `roles` его нет — трактовать как **not found → future role, outside scope**.

## 2. Матрица доступа Companies (Phase 7 target)

| Действие | super_admin | admin | admin_gost | menedzher | support | editor | user |
|---|---|---|---|---|---|---|---|
| View list `/admin/companies` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| View `CompanyDetailSheet` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Create company (manual) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit company fields | ✅ | ✅ | ✅ (ограниченно, см. §3) | ✅ | ❌ | ❌ | ❌ |
| Archive/merge | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Link/unlink contact | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Import (Amo/CSV) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View timeline | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete (hard) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

## 3. Оговорки

- `admin_gost` — необходимо в Phase 1 execution уточнить фактические ограничения (пока копируем поведение из `admin` для CRM, кроме archive/merge/delete).
- `menedzher` — код роли — транслит; RLS-выражения `has_role_v2(auth.uid(), 'menedzher')`. **Не заменять на 'manager'** без миграции ролей.

## 4. Guards (все слои)

| Слой | Как проверить в Phase 7 |
|---|---|
| Sidebar/navigation | Добавить пункт «Компании» в `admin_section` (code=`companies`, route_prefix=`/admin/companies`); видимость через `admin_section_access` + `has_role_v2` |
| Route guards | `code: src/pages/admin/AdminCompanies.tsx` (Phase 7) — обернуть в `AdminRouteGuard` с ролью-множеством |
| RPC authorization | Все `search_companies`, `company_upsert_*`, `company_link_contact`, `company_merge`, `company_archive` — SECURITY DEFINER с проверкой `has_role_v2` внутри |
| RLS на `companies` | `USING (has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin') OR has_role_v2(auth.uid(), 'menedzher') OR has_role_v2(auth.uid(), 'support'))`; `support` — только SELECT |
| Resource/section registry | Добавить в `admin_resource` (code=`companies`, section=`crm`); связать в `role_admin_resource_access` |
| Hidden UI actions | Кнопки archive/merge — рендерить по `useRbac().isAdmin` / `isSuperAdmin` |

## 5. Что запрещено

- Не создавать роль `crm_manager` — использовать `menedzher`.
- Не давать `anon` доступа к `companies` / `company_contacts` — только `authenticated` + `service_role`.
- Не проверять роль на клиенте без дублирования на RLS — client-side проверка только для UX.
