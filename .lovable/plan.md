

# План: Добавить страницу «Нейросеть» в Панель управления

## Диагностика

- `AI.tsx` (~830 строк) — монолитный компонент в `DashboardLayout`, без зависимостей от контекстов DashboardLayout кроме обёртки
- Admin-страницы включают `AdminLayout` внутри себя
- `routeToTitle` / `routeToHelpAnchor` в `AdminLayout.tsx` — единственный SoT для admin titles
- В `DEFAULT_MENU` группа `service` использует `permission` для RBAC-фильтрации; `Bot` отсутствует в `MENU_ICONS`
- `mergeMenuSettings` автоматически добавляет новые пункты из `DEFAULT_MENU` в кастомизированные настройки из БД

## Изменяемые файлы

### 1. Новый: `src/components/ai-chat/AiPageContent.tsx`
- Механический перенос содержимого из `AI.tsx` (без `DashboardLayout` обёртки)
- Принимает `mode: "user" | "admin"`
- `mode === "admin"` → показать все `adminOnly` вкладки (только видимость)
- **Инвариант:** `mode="admin"` НЕ обходит `canManagePrompts`, `canManageTutorials`, mutation guards, disabled-state. Все проверки `canManage*`, `canEdit*`, кнопки и секции внутри вкладок остаются 1:1 как в текущем коде. Право видеть вкладку ≠ право на запись
- Add-only: не менять tab ids, subtab ids, query keys, state names, обработчики
- `AI_CONTAINER_OFFSET` оставить как есть

### 2. `src/pages/AI.tsx`
- **Только page wrapper:** `DashboardLayout` → `<AiPageContent mode="user" />`
- Не содержит: query hooks, tab/subtab state, локальных обработчиков, дублирующих констант вкладок

### 3. Новый: `src/pages/admin/AdminAI.tsx`
- **Только page wrapper:** `AdminLayout` → `<AiPageContent mode="admin" />`
- Не содержит: query hooks, tab/subtab state, локальных обработчиков, дублирующих констант вкладок
- Паттерн как у `AdminIlex`, `AdminEditorial`

### 4. `src/App.tsx`
- Lazy import: `const AdminAI = lazy(() => import("./pages/admin/AdminAI"))`
- Маршрут add-only в существующем блоке admin service routes, без изменения порядка существующих маршрутов:
  ```tsx
  <Route path="/admin/ai" element={<ProtectedRoute><LazyRoute><AdminAI /></LazyRoute></ProtectedRoute>} />
  ```

### 5. `src/hooks/useAdminMenuSettings.tsx`
- Добавить `Bot` в import из `lucide-react` и в `MENU_ICONS`
- В `DEFAULT_MENU`, группа `service`, новый пункт:
  ```ts
  { id: "ai", label: "Нейросеть", path: "/admin/ai", icon: "Bot", order: 12, permission: "roles.view" }
  ```
- **Примечание:** `permission: "roles.view"` — временное согласованное решение по текущему паттерну меню для admin-only пунктов, НЕ новый универсальный стандарт. Не копировать без проверки для будущих пунктов
- Новый пункт корректно появляется через `mergeMenuSettings` с `DEFAULT_MENU` без ручного сброса кастомизированных настроек меню из БД

### 6. `src/components/layout/AdminLayout.tsx`
- `routeToTitle`: добавить `'/admin/ai': 'Нейросеть'`
- `routeToHelpAnchor`: добавить `'/admin/ai': 'admin'` — допустимый временный fallback (более точного help-anchor для AI-раздела пока нет)

## Что НЕ изменяется
- БД, RLS, edge functions, Storage
- Все хуки, компоненты промптов/чата/реквизитов
- `AI_CONTAINER_OFFSET`
- Порядок существующих маршрутов в `App.tsx`

## STOP-guards
- Зависимости от контекстов `DashboardLayout` → минимальный adapter-layer, не тащить DashboardLayout в admin
- `Bot` конфликтует с import → другая иконка из lucide + mapping
- CSS-ограничения по высоте/offset дают визуальный сдвиг → отдельный visual-fix PATCH, не смешивать с маршрутизацией
- Побочные изменения в tab/subtab initial state, modal open state или query refetch → остановиться, восстановить 1:1 поведение user-версии, затем подключать admin route
- User-specific CSS/offset-логика в AI.tsx → не менять в том же патче с маршрутом и меню, вынести отдельным visual-fix PATCH

## DoD
1. Пункт «Нейросеть» в admin sidebar → `/admin/ai`, виден только при `roles.view`
2. `/admin/ai` рендерит тот же контент в `AdminLayout`, все admin-only вкладки видны
3. `/ai` для обычных пользователей — без изменений
4. Не-admin на `/admin/ai` блокируется `AdminLayout` guard
5. Admin view-only видит страницу, редактирование блокируется существующей RBAC-логикой мутаций
6. `/admin/ai` открывается без runtime-ошибок и без зависимости от `DashboardLayout`
7. F5 на `/admin/ai` — без редирект-петель и пустого экрана
8. Breadcrumb title и sidebar active state корректны для `/admin/ai`
9. Переключение между `/ai` и `/admin/ai` не ломает tab/subtab навигацию и не вызывает runtime-ошибок
10. Нет дублирования useState, query hooks, обработчиков между `AI.tsx` и `AdminAI.tsx`
11. Создание/редактирование промптов через `/admin/ai` работает
12. Переход из admin sidebar на `/admin/ai` и обратно не ломает layout, sticky header и scroll
13. Прямой вход по URL на admin-only вкладку внутри `/admin/ai` не ломает рендер, даже если аналогичная вкладка скрыта в `/ai`
14. Возврат со страницы `/admin/ai` на `/ai` не оставляет артефактов admin-only UI в пользовательском режиме

