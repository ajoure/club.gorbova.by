да, согласен, с учетом правок:

1. **Проверить реальный контракт** `bulk_set_section_access`  
В плане указано:
  &nbsp;
  ```ts
  bulk_set_section_access({
    roleId,
    sectionAccess: [{ sectionCode, accessLevel }]
  })
  ```
  Но ранее `bulk_set_section_access` описывался как action для одной секции/её ресурсов. Перед выполнением нужно проверить фактическую сигнатуру в `roles-admin/index.ts`.
  Если batch-формата нет — делать цикл по секциям через существующий action:
  ```ts
  set_section_access({
    roleId,
    sectionCode: section.code,
    accessLevel: preset
  })
  ```
  Либо аддитивно добавить batch-action, но это уже будет не только frontend-патч.
2. **Не называть** `bulk_set_section_access`**, если он выставляет все ресурсы секции**  
Для preset нужно выставить **section-level access по всем секциям**, чтобы ресурсы наследовали уровень.  
Не нужно массово писать resource overrides.
  &nbsp;
  То есть целевая запись:
3. **Если bulk/preset частично упал — показать частичный результат**  
Сейчас указано: роль остаётся созданной, rollback не делаем. Это ок.  
Но нужно добавить:
  - какие секции успешно применились;
  - какие упали;
  - toast/error + оставить роль выбранной для ручной донастройки.
4. **После preset обязательно refetch прав новой роли**  
Инвалидации недостаточно, если UI сразу показывает выбранную роль. После `setSelectedRoleId(role.id)` нужно гарантировать, что `get_role_access` перезапрошен и не показывает старое пустое состояние.
5. **DoD уточнить по** `custom`  
Для `custom` корректный результат:
6. `rg` **по legacy недостаточен только по одному файлу**  
Проверить минимум:
  - `RoleAccessEditor.tsx`
  - `AdminRoles.tsx`
  - `useAdminRoles.tsx`
  Цель: `/admin/roles` не должен читать `permissions` / `role_permissions`.

После этих правок план можно выполнять.

&nbsp;

План: PATCH-RBAC-V3-CREATE-ROLE-ACCESS-PRESET

## Цель

В диалоге «Новая роль» (вкладка «Доступ» → редактор `RoleAccessEditor`) вернуть быстрый выбор шаблона доступа поверх RBAC v3, без возврата к legacy `permissions` / `role_permissions`.

## Scope

Только фронтенд-патч в `src/components/admin/roles/RoleAccessEditor.tsx`. Backend (`roles-admin`) уже поддерживает всё необходимое: `create_role`, `bulk_set_section_access`, `list_catalog`. Новые миграции, RPC и edge-функции не нужны.

## Изменения в UI

### Диалог «Новая роль»

После поля «Описание» добавить блок «Тип доступа» (RadioGroup, ровно 3 варианта, по умолчанию `custom`):

1. **Только просмотр** (`view`)
  — после `create_role` пакетно выставить `access_level='view'` всем секциям из `list_catalog.sections`.
2. **Полный доступ** (`manage`)
  — аналогично, `access_level='manage'` всем секциям.
3. **Индивидуальная настройка** (`custom`, default)
  — никакого массового preset; роль создаётся пустой и сразу открывается в редакторе.

Вариант «Нет доступа» НЕ добавляем (этот сценарий покрывается `custom`, если ничего не назначить вручную).

Под радиогруппой — короткая подсказка-описание выбранного варианта (1 строка `text-xs text-muted-foreground`).

### Логика `handleCreateRole`

```
1. callRolesAdmin("create_role", { roleCode, roleName, roleDescription }) → { role.id }
2. if preset === "view" | "manage":
     sectionAccess = catalogQ.data.sections.map(s => ({
       sectionCode: s.code, accessLevel: preset
     }))
     callRolesAdmin("bulk_set_section_access", { roleId, sectionAccess })
     toast.success("Роль создана, доступы применены")
   else:
     toast.success("Роль создана")
3. invalidateQueries: ["roles-admin","catalog"], ["roles-admin","role-access", roleId], ["admin-access"]
4. setSelectedRoleId(role.id) — роль автоматически выбрана и открыта в редакторе
5. setCreateOpen(false) + reset формы (включая preset → "custom")
```

Ресурсы наследуют уровень секции через существующую логику резолвера — отдельный `bulk_set_resource_access` вызывать не нужно (в `RoleAccessEditor` resource-level не задаётся при пустых записях, наследование уже работает на чтении).

Ошибка на шаге 2 (bulk) показывается через `toast.error(normalizeEdgeFunctionError(e))`, но роль остаётся созданной — её можно донастроить вручную (никакого rollback `delete_role`).

### Состояния и сброс

- Новый state: `const [newRolePreset, setNewRolePreset] = useState<"view"|"manage"|"custom">("custom")`.
- В обработчике `onOpenChange` диалога сбрасывать `newRolePreset` в `"custom"` вместе с name/desc.
- Кнопка «Создать» дизейблится как сейчас (по name + generatedCode + creating).

## Что НЕ меняем

- `roles-admin/index.ts` — без изменений.
- Backend модели `role_admin_section_access` / `role_admin_resource_access` — без изменений.
- Legacy `permissions`, `role_permissions` — не используем, не возвращаем.
- Системные/защищённые роли (`super_admin` и т.п.) — preset применим только к новосозданной роли, существующие не трогаются.

## DoD / проверки

1. Создание роли с preset **Только просмотр** → запись в `role_admin_section_access` для всех секций каталога с `access_level='view'`; в UI у новой роли все секции отображаются как «Просмотр».
2. Создание роли с preset **Полный доступ** → то же, `access_level='manage'`; в UI все секции «Управление».
3. Создание роли с preset **Индивидуальная настройка** → `role_admin_section_access` пуст для роли; роль открыта в редакторе, все секции `none`.
4. После создания новая роль автоматически выбрана (`selectedRoleId === role.id`) и редактор показывает применённые уровни без перезагрузки страницы.
5. По умолчанию в диалоге выбран **Индивидуальная настройка** — случайной выдачи полного доступа нет.
6. `permissions` / `role_permissions` не читаются и не пишутся (проверка `rg` по обновлённому файлу).
7. tsgo проходит без ошибок.

## Технические детали

- Файл: `src/components/admin/roles/RoleAccessEditor.tsx`
- Используемые экшены edge-функции `roles-admin`:
  - `create_role` (uses `roleCode`, `roleName`, `roleDescription`)
  - `bulk_set_section_access` (uses `roleId`, `sectionAccess: [{sectionCode, accessLevel}]`)
- Источник списка секций для bulk: `catalogQ.data.sections` (уже загружен через `list_catalog`).