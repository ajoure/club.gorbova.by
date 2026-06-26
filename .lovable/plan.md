## да, согласен, с учетом правок:

1. **Добавить корректный заголовок плана**

В начало:

```text
План: PATCH-RBAC-V3-ADMINLAYOUT-CANONICAL-GATE
```

2. **Не делать гейт через** `ADMIN_SECTIONS.some(...)`**, если в** `useAdminAccess` **уже есть resolved access**

Лучше добавить/использовать явный helper:

```ts
access.hasAnyAdminSectionAccess
```

или локально считать по результату RPC:

```ts
const hasAnySectionAccess =
  access.isSuperAdmin ||
  access.isAdmin ||
  access.accessRows.some(row =>
    row.resource_code === null &&
    (row.access_level === "view" || row.access_level === "manage")
  );
```

Если использовать `ADMIN_SECTIONS.some(s => canAccessSection(s.code))`, нужно убедиться, что коды `ADMIN_SECTIONS` полностью совпадают с БД.

3. **Loading-state должен быть безопасным**

В `AdminLayout`:

- пока `useAdminAccess.isLoading === true` — показывать loader/skeleton;
- не редиректить раньше времени;
- при error — deny + лог/toast, но без allow fallback.

4. **Kill-switch не должен случайно открыть админку всем**

Если `admin_section_gating_enabled=false`, аварийный режим должен возвращать поведение старой админки только для пользователей, которые реально имеют admin-доступ по legacy-модели, а не для любого `user`.

Иначе обычный пользователь сможет открыть `/admin`.

5. **Проверить root** `/admin`

Сценарий:

- кастомная роль с одной секцией → `/admin` должен редиректить на первую доступную секцию;
- кастомная роль без секций → `/admin` → `/`;
- `support` → `/admin` → первая разрешённая секция, например `/admin/communication`.

6. **Playwright добавить именно для кастомной роли**

Кроме `qa.admin/support`, обязательно:

- создать QA-пользователя с кастомной ролью `manager`;
- выдать через RBAC v3 одну-две секции;
- убедиться, что `/admin` открывается;
- legacy `role_permissions` для этой роли пустые;
- это доказывает, что фикс реально отвязал вход от legacy `hasAdminAccess`.

7. **Отчёт оформить так**

```text
Отчет о выполненной работе: PATCH-RBAC-V3-ADMINLAYOUT-CANONICAL-GATE
```

В отчёте обязательно:

- root cause;
- изменённый файл;
- proof: кастомная роль без legacy permissions входит в `/admin`;
- proof: роль без секций не входит;
- proof: обычный `user` не входит;
- proof: `support/admin/super_admin` не сломаны.
- &nbsp;
- Проблема

Сотрудник с кастомной ролью «Менеджер» (создана в RBAC v3, имеет права на секции через `admin_section_access`) при заходе в админку редиректится на пользовательский дашборд (`/dashboard`).

## Причина (root cause)

`src/components/layout/AdminLayout.tsx:147` гейтит вход в админку через `useRbac().hasAdminAccess`. Эта проверка (`src/hooks/usePermissions.tsx:120-137`) смотрит **только legacy-таблицу `permissions**` — ищет `users.view`, `roles.view`, `admins.manage` и т.п.

Кастомные роли RBAC v3 (созданные в редакторе «Доступ») **не пишут** в legacy `role_permissions`. Их права живут в `admin_section_access` / `admin_resource_access` и читаются через RPC `get_admin_access` (хук `useAdminAccess`).

Итог: «Менеджер» имеет реальные права на секции, но `hasAdminAccess === false` → AdminLayout не пускает.

То же самое будет с любой новой кастомной ролью, у которой выставлен любой пресет («Полный доступ» / «Только просмотр» / индивидуальные секции).

## Решение

Перевести гейт входа в админку на **канонический источник RBAC v3** — `useAdminAccess` (тот же, что использует `AdminRouteGuard` и сайдбар). Доступ в админку = «есть хотя бы одна секция с уровнем ≥ view» **или** super_admin/admin (bypass уже встроен в `useAdminAccess`).

### Изменения

1. `**src/components/layout/AdminLayout.tsx**`
  - Удалить чтение `hasAdminAccess` из `useRbac`.
  - Подключить `useAdminAccess()`; ждать `isLoading`.
  - Условие входа: `access.isSuperAdmin || access.isAdmin || ADMIN_SECTIONS.some(s => access.canAccessSection(s.code))`.
  - При отсутствии доступа — `Navigate to="/"` (как сейчас), без бесконечного цикла.
2. **Никаких backend/SQL изменений** — RPC `get_admin_access` уже корректно возвращает секции для кастомных ролей; `AdminRouteGuard` уже работает по ней.
3. **Legacy `hasAdminAccess` не трогаем** — он ещё используется в других местах кода (поиск по проекту покажет точечно); в рамках этого фикса меняем только вход в `AdminLayout`. Полная депрекация legacy permissions — отдельный sprint.

## Проверка (DoD)

- **Менеджер (тестовый пользователь)**: после логина `/admin` открывается, виден сайдбар с разрешёнными секциями, запрещённые URL редиректят на первую доступную (через существующий `AdminRouteGuard`).
- **Роль без секций («Индивидуальная настройка», пусто)**: вход в `/admin` запрещён → редирект на `/`.
- **Обычный `user**`: вход в `/admin` запрещён → редирект на `/` (как и раньше).
- **super_admin / admin**: доступ сохранён (bypass в `useAdminAccess`).
- Проверить через Playwright под `qa.admin` (роль `support`) — поведение прежнее (вход разрешён, ограничения по секциям работают).

## Технические детали

```text
AdminLayout
  ├─ before: useRbac().hasAdminAccess  ← legacy permissions only
  └─ after:  useAdminAccess()          ← RPC get_admin_access (RBAC v3 SOT)
                ├─ isSuperAdmin / isAdmin → bypass
                └─ canAccessSection(code) over ADMIN_SECTIONS
```

Файлы: 1 (`src/components/layout/AdminLayout.tsx`). Без миграций, без edge-функций.