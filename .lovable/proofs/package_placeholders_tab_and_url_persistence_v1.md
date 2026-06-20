# Proof: «Плейсхолдеры» внутри пакета + URL persistence (v1)

## Scope
Frontend-only. Без БД, RPC, edge-функций, миграций.

## Изменённые файлы
- `src/components/ai-chat/AiPageContent.tsx`
  - + `useSearchParams` из `react-router-dom`
  - Инициализация `activeSubTab` из `?sub=...`, если задан
  - useEffect: `activeSubTab → ?sub=...` (replace, prev params сохраняются)
- `src/components/ai-documents/packages/PackagesWorkspace.tsx`
  - + `useSearchParams`, иконка `Tag`, импорт `PlaceholdersCatalogTab`
  - Константы `ADMIN_TABS` / `USER_TABS` для валидации `pkgTab`
  - Инициализация `selectedId` из `?pkg=`, валидация после загрузки списка
  - Инициализация `tab` из `?pkgTab=` с проверкой по `validTabs`
  - useEffect-ы: `selectedId → ?pkg=`, `tab → ?pkgTab=` (replace, prev params сохраняются)
  - Guard: при смене `isAdminUI` сбрасываем admin-only вкладку на `anketa`
  - Новый `<TabsTrigger value="placeholders">` строго между `roles` и `validation` (admin-only)
  - Новый `<TabsContent value="placeholders">` рендерит существующий `<PlaceholdersCatalogTab />` без обёрток/фильтров

## Поведение

### Новая вкладка
- `/admin/documents → Пакеты документов → Идеология`: между «Роли и поля пакета» и «Проверка шаблонов» появилась «Плейсхолдеры» (иконка `Tag`, admin-only).
- Контент идентичен верхней вкладке «Документы → Плейсхолдеры» (один и тот же компонент).

### Persistence (URL params)
| Действие | URL до | URL после |
|---|---|---|
| Выбор пакета X | `?sub=placeholders` | `?sub=placeholders&pkg=<X>&pkgTab=anketa` |
| Переход на «Анкеты документов» | `…&pkgTab=placeholders` | `…&pkgTab=anketa` |
| Открыть верхнюю «Пакеты документов» | `?sub=placeholders` | `?sub=pkg-ideology&pkg=<X>&pkgTab=<...>` |

`pkg`/`pkgTab` не стираются при смене верхней вкладки — сохраняются в URL и восстанавливают состояние при возврате.

### F5
- Любая комбинация `?sub`, `?pkg`, `?pkgTab` переживает hard refresh.
- `pkg=<несуществующий-uuid>`: после загрузки списка → fallback на `ideology`, URL чинится.
- `pkgTab=placeholders` в user-mode: fallback на `anketa` через guard `useEffect`.

### Share-link
`/admin/documents?sub=pkg-ideology&pkg=<uuid>&pkgTab=placeholders` открывается в новой вкладке ровно в этом состоянии.

## Anti-loop guarantees
- Каждый sync-useEffect делает early-return, если URL уже совпадает с state.
- `setSearchParams(..., { replace: true })` — не плодит history-entries.
- Зависимости useEffect ограничены контролируемым state (отключены `searchParams` в deps осознанно — мы пишем, а не читаем при ре-рендере).

## Что НЕ менялось
- БД, RPC, edge-функции, миграции, RBAC.
- Верхняя вкладка «Документы → Плейсхолдеры» — без изменений.
- Компонент `PlaceholdersCatalogTab` — переиспользован как есть.
- Логика других вкладок пакета (templates / anketa / roles / validation / generation).
- Навигация сайдбара, маршруты.
