## да, согласен, с учетом правок:

1. **Не удалять записи из** `admin_section` **/** `admin_resource` **в этом патче**
  - Шаг 4 должен быть только read-only audit.
  - Если найдутся мусорные секции/ресурсы — вывести дамп в отчёт.
  - Удаление или `is_active=false` — только отдельным планом после явного подтверждения.
2. **Не использовать** `admins.manage`**, если такого permission-кода нет**
  - Проверить реальный gate в `roles-admin`.
  - Если сейчас используется `roles.manage` / `super_admin`, UI должен повторять именно его.
  - Не вводить новый permission-код ради кнопок «Создать роль» / «Удалить роль».
3. `create_role` **/** `delete_role` **не считать существующими без proof**
  - Сначала проверить реальные actions в `roles-admin`.
  - Если их нет — добавить аддитивно в этот patch:
    - `create_role`
    - `delete_role`
    - `preview_delete_role` желательно
    - audit `rbac_v3.role.create/delete`
    - запрет удаления системных ролей
    - запрет удаления роли, если она назначена пользователям, либо явный безопасный сценарий с подтверждением.
4. **Удаление legacy-компонентов — только после grep-proof**
  - Перед удалением:
    - `RolePermissionEditor.tsx`
    - `RoleTemplateSelector.tsx`
  - Нужно доказать, что они больше нигде не импортируются.
  - Если есть импорты вне `/admin/roles`, не удалять, а оставить deprecated.
5. `useAdminRoles.tsx` **чистить осторожно**
  - Не ломать вкладку «Сотрудники».
  - Оставить только реально используемые методы.
  - Если `createRole` нужен теперь в `RoleAccessEditor`, лучше перенести вызовы на `roles-admin`, а не оставлять две модели создания ролей.
6. **Создание новой роли должно сразу иметь безопасный baseline**
  - Новая роль не должна случайно получить доступ.
  - После создания:
    - либо нет access rows → deny-all;
    - либо явно создаются `none` по всем активным секциям.
  - В UI показать статус: «Доступ не настроен / всё закрыто».
7. **Системные роли синхронизировать с backend**
  - В плане указаны `super_admin/admin/user/support/editor`.
  - Нужно не хардкодить только во фронте.
  - Источник: `roles.is_system` + backend guard.
  - Если `support` сейчас должна быть редактируемой для настройки доступа — не помечать её как полностью locked, если backend это разрешает.
8. **Вкладку legacy “Роли и права” можно убрать, но низкоуровневые операции не должны исчезнуть навсегда без замены**
  - Сейчас `permissions/role_permissions` остаются deprecated.
  - Если в будущем нужны `users.block`, `users.delete`, `payments.refund`, их нужно будет вынести в отдельный блок «Особые операции».
  - В этом патче допустимо убрать legacy UI, но в отчёте явно написать: “операционные permissions больше не редактируются через UI”.
9. **Read-only проверку кнопок не раздувать**
  - Шаг 6 потенциально большой.
  - В этом патче проверить только топ-страницы:
    - contacts
    - deals
    - payments
    - communication/support
    - products/sites/editorial
  - Все найденные массовые проблемы — в deferred, если они не блокируют консолидацию редактора.
10. **Playwright по ролям не должен требовать реальных production-логинов**

- Только `qa.*@gorbova.test`.
- Helper должен быть включён только на время теста.
- После теста:
  - пароли ротированы;
  - helper выключен;
  - роли/override кастомной тестовой роли очищены или оставлены с явной пометкой test-only.

11. **Для** `editor` **сначала подтвердить baseline**

- Если в RBAC v3 для `editor` ещё нет корректных section/resource rows, не придумывать ожидаемое поведение.
- В таком случае:
  - либо сначала создать baseline для `editor` в отдельном seed/fix;
  - либо вынести `editor` runtime-proof в deferred.

12. **Route/section коды брать только из** `adminMenuRegistry.ts`

- Не писать руками `support-tickets`, `products-v2`, `forms-hub`, если код/route отличается.
- В отчёте дать таблицу: `role → allowed section codes → tested URLs`.

13. **DoD добавить по** `/admin/roles`

- На странице после патча:
  - ровно 2 вкладки;
  - legacy tab отсутствует;
  - сеть не делает запросы к `permissions` / `role_permissions` при открытии `/admin/roles`;
  - создание роли происходит через RBAC v3 API;
  - удаление кастомной роли пишет audit.

14. **Отчёт оформить строго**

- Заголовок:
- В отчёте обязательно:
  - удалённые файлы;
  - изменённые файлы;
  - grep-proof отсутствия legacy imports;
  - proof, что `/admin/roles` не читает `permissions/role_permissions`;
  - Playwright screenshots;
  - baseline по ролям;
  - deferred list.
  - &nbsp;
  - Контекст и проблемы

Текущая страница `/admin/roles` (`src/pages/admin/AdminRoles.tsx`) содержит 3 вкладки:

1. **Сотрудники** — назначение роли пользователю (оставить).
2. **Роли и права** — legacy редактор поверх `permissions` / `role_permissions` (через `useAdminRoles` + `RolePermissionEditor` + `RoleTemplateSelector`). Это та самая «другая модель доступа» (admins, executors, news 0/4 и т.д.), которая **не совпадает** с реальным RBAC v3 (sections/resources). Создание и удаление ролей сейчас живёт здесь.
3. **Доступ к разделам** — канонический RBAC v3 (`RoleAccessEditor` поверх `roles-admin`: `list_catalog`, `get_role_access`, `set_section_access`, `set_resource_access`). Это и есть SOT, который реально гейтит UI и роуты после `PATCH-RBAC-V3-FRONTEND-GATING-FIX`.

Цель: оставить только канонический доступ и убрать дубль-модель.

## План: PATCH-RBAC-V3-SINGLE-EDITOR-CONSOLIDATION

### Шаг 1. UI-консолидация в `AdminRoles.tsx`

- Удалить вкладку `roles` («Роли и права») целиком: разметку, view-toggle cards/table, обработчики `handleEditPermissions`, `handleSavePermissions`, `handleTemplateSelect`, dialog'и `RolePermissionEditor` и `RoleTemplateSelector`, состояние `editingRoleForEditor`, `templateSelectorOpen`, `rolesViewMode`, `newRolePermissions`, `createRoleDialog`.
- Переименовать вкладку `access` → **«Доступ»** (вместо «Доступ к разделам»). Заголовок секции «Сотрудники и роли» оставить.
- В табах остаются только: **Сотрудники** (default) и **Доступ**.

### Шаг 2. Перенос «Создать роль» и «Удалить роль» в `RoleAccessEditor.tsx`

- Добавить в заголовок панели редактора (справа от списка ролей):
  - кнопку **«+ Создать роль»** → диалог с полями «Название» и «Описание», авто-генерация `code` (translit, как сейчас в `AdminRoles`). Бэкенд: `roles-admin` action `create_role` (уже есть, проверю). Без выбора permissions — новая роль создаётся пустой и сразу настраивается через section/resource-уровни в этом же редакторе.
  - кнопку **«Удалить роль»** (иконка корзины) рядом с каждой кастомной ролью в левом списке (системные `super_admin/admin/user/support/editor` — disabled с tooltip "Системная роль"). Бэкенд: `roles-admin` action `delete_role` (уже есть). Подтверждение через `AlertDialog`. После удаления — invalidate `["roles-admin","catalog"]`.
- Кнопка должна быть скрыта/disabled если у текущего пользователя нет `admins.manage` или роль системная.

### Шаг 3. Чистка legacy permission-модели

- Удалить файлы, на которые больше нет ссылок:
  - `src/components/admin/RolePermissionEditor.tsx`
  - `src/components/admin/RoleTemplateSelector.tsx`
- В `src/hooks/useAdminRoles.tsx` оставить только то, что реально нужно для `AddEmployeeDialog`, `RemoveRoleDialog` и вкладки «Сотрудники» (`roles`, `assignRole`, `removeRole`, `createRole`?, `refetch`). Убрать `allPermissions`, `setRolePermissions`, чтение `role_permissions`/`permissions`.
- На бэкенде НЕ трогать таблицы `permissions`, `role_permissions`, `roles` и actions `set_role_permissions` в `roles-admin` (другие места читают; держим как deprecated). Только перестаём дёргать с фронта.
- `useRbac`/`hasPermission` оставить как есть — он используется по 30+ компонентам и не относится к редактору ролей.

### Шаг 4. Проверка каталога RBAC v3 на «мусор»

SQL-аудит (через read_query):

- Сравнить `admin_section.code` и `adminMenuRegistry.ts` — все пункты сайдбара должны иметь секцию; «висячих» секций без route_prefix быть не должно.
- Список ролей в `roles` vs `role_admin_section_access` / `role_admin_resource_access` — для каждой роли должен быть baseline. Если у кастомной роли вообще нет ни одной allow-записи → она по умолчанию deny-all (это ок, но в UI отразить "пусто" в списке).
- Удалить из `admin_section` / `admin_resource` явно неиспользуемые коды, если найдутся (только после явного дамповского отчёта в выводе — не вслепую).

### Шаг 5. Runtime-proof по каждой роли (Playwright)

По кругу логинимся под тестовыми пользователями (создаём через `qa-test-session-helper`, allowlist `qa.*@gorbova.test`) с ролями и проверяем:


| Роль                                                    | Ожидание sidebar                                                          | Ожидание deny path              | Ожидание read-only                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `super_admin`                                           | все секции                                                                | нет deny                        | все действия доступны                                                                                          |
| `admin`                                                 | все секции (минус super-only)                                             | нет deny                        | все действия                                                                                                   |
| `support`                                               | baseline 6 (communication, deals, contacts, payments, support, forms-hub) | `/admin/products-v2` → redirect | manage                                                                                                         |
| `editor`                                                | только контент-секции                                                     | `/admin/payments` → redirect    | manage в content                                                                                               |
| `user` (нет admin-роли)                                 | **админка вообще не открывается** (редирект на `/`)                       | любой `/admin/*` → redirect     | —                                                                                                              |
| любая новая кастомная роль с уровнем `view` на 1 секции | видит только эту секцию                                                   | остальное deny                  | кнопки "создать/редактировать/удалить" не работают (UI должен использовать `canAccessResource(..., "manage")`) |


Скриншоты складываем в `/tmp/browser/rbac-v3-consolidation/screenshots/`. После прогона — cleanup: ротация паролей, выключение helper'а.

### Шаг 6. Read-only проверка кнопок действий

Просмотреть критичные `/admin/*` страницы и убедиться, что кнопки create/edit/delete уже гейтятся через `useAdminAccess.canAccessSection/Resource(..., "manage")` (а не только видимость секции). Если где-то висит `hasPermission(...)` против legacy permission-кода — добавить дополнительный `canAccessSection(..., "manage")` гард, чтобы `view` действительно был read-only. Без массовой переделки — точечно по топ-страницам (communication, deals, payments, support, forms-hub, products, news/content, sites).

### DoD

- На `/admin/roles` остались ровно 2 вкладки: **Сотрудники** и **Доступ**.
- В вкладке «Доступ» можно создать роль, настроить уровни по секциям/ресурсам, удалить кастомную роль. Системные роли не удаляются.
- Legacy редактор прав и шаблоны удалены из фронта; `permissions` / `role_permissions` со страницы ролей не читаются.
- Playwright-прогон по 5 базовым ролям + 1 кастомной даёт PASS по sidebar + route deny + read-only кнопкам.
- В отчёте: список удалённых файлов, baseline по каждой роли (числа allow/deny), пути скриншотов, явное подтверждение что `useRbac`/legacy permissions таблицы оставлены нетронутыми на бэкенде.