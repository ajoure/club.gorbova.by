# companies_ui_inventory.md

UI-паттерны CRM для строгой consistency `AdminCompanies` + `CompanyDetailSheet`.

## 1. Sheet / Drawer

- Primitive: shadcn `Sheet` / `SheetContent`.
- Ширина: определяется классом `SHEET_SHELL_CLASS` (общий constant в двух sheet'ах, `code: src/components/admin/ContactDetailSheet.tsx:L1624`, `DealDetailSheet.tsx:L539`).
- Направление: справа (по умолчанию shadcn Sheet).
- Использовать тот же `SHEET_SHELL_CLASS`.

## 2. Tabs

- Primitive: shadcn `Tabs` / `TabsList` / `TabsTrigger`.
- Паттерн из `ContactDetailSheet.tsx:L1754-L1787`:
  - `Tabs value=... onValueChange=... className="flex-1 flex flex-col min-h-0 overflow-hidden"`.
  - `TabsList className="mx-4 sm:mx-6 mt-0 mb-0 inline-flex w-auto whitespace-nowrap bg-transparent h-auto"`.
  - `TabsTrigger className="text-xs sm:text-sm px-2.5 sm:px-3"`.
- `CompanyDetailSheet` использует те же классы.

## 3. Toolbar / actions

- Header actions — иконки/кнопки в `SheetHeader`, паттерн из `ContactDetailSheet.tsx`.
- Bulk actions bar — snap-to-bottom при выделении (см. `KanbanBulkActionsBar.tsx`, `TasksBulkActionsBar.tsx`).

## 4. Filters

- Layout: горизонтальная панель, `DealsFiltersBar.tsx`, `tasks/filters/*`.
- Хранение состояния: `useDealsFilters`, `useCrmTasks`.
- URL sync: query params (см. `code: src/hooks/useDealsFilters.ts`).

## 5. Pagination

- Server-side через параметры RPC `_filters.limit`, `_filters.offset` (см. `useCrmTasks.ts:L60-L83`).
- Client — infinite scroll или классическая пагинация. `AdminCompanies` — классическая с 50 записей/страница.

## 6. Empty state

- Паттерн: центрированная иконка + текст + primary action. Проверить `admin/tasks/TasksListView.tsx`, `admin/deals/DealsKanbanBoard.tsx`.

## 7. Search input

- Обычный shadcn `Input` с иконкой Lucide.
- Debounce 300ms.

## 8. Table

- shadcn `Table` (см. `src/components/admin/table/*`).
- Плотность: `text-xs sm:text-sm`.
- Actions column — dropdown-меню.

## 9. Icons

- Lucide React.
- Для company: `Building2` (уже используется в проекте).

## 10. Colors / badges

- Semantic tokens из `index.css` (see design-system-prompt). Не хардкодить `text-white`, `bg-black`.
- Статусы: `active` (default), `archived` (muted), `merged` (secondary).

## 11. Dialogs

- shadcn `Dialog` для confirm/edit; `AlertDialog` для destructive.
- Паттерн из `admin/tasks/CreateCrmTaskDialog.tsx`, `EditCrmTaskDialog.tsx`.

## 12. Чек-лист consistency для Phase 7

- [ ] `SheetContent` использует `SHEET_SHELL_CLASS`.
- [ ] `TabsList` — `bg-transparent h-auto inline-flex`.
- [ ] `TabsTrigger` — `text-xs sm:text-sm px-2.5 sm:px-3`.
- [ ] Table — shadcn primitive, actions dropdown.
- [ ] Filters — как `DealsFiltersBar.tsx`.
- [ ] Bulk actions — как `KanbanBulkActionsBar.tsx`.
- [ ] Empty state — единый паттерн.
- [ ] Иконка компании — `Building2`.
- [ ] Statuses — semantic tokens.
- [ ] Все action-иконки — Lucide.
- [ ] Никаких кастомных цветов вне `index.css` токенов.
