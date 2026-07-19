# companies_component_inventory.md

Инвентаризация UI-компонентов, релевантных Companies.

## 1. Sheet-шеллы

| Компонент | Ссылка | Размер | Вердикт |
|---|---|---|---|
| ContactDetailSheet | `code: src/components/admin/ContactDetailSheet.tsx` | 4074 строки | REUSE+PROPS для добавления вкладки «Компании» (Phase 8) |
| DealDetailSheet | `code: src/components/admin/DealDetailSheet.tsx:L539-L1260` | 1371 строка | REUSE+PROPS для отображения `deal.company_id` (Phase 5) |
| PreregistrationDetailSheet | `code: src/components/admin/PreregistrationDetailSheet.tsx` | — | REUSE (паттерн) |
| ConsentDetailSheet | `code: src/components/admin/ConsentDetailSheet.tsx` | — | REUSE (паттерн) |
| BillingDetailSheet | `code: src/components/admin/diagnostics/BillingDetailSheet.tsx` | — | REUSE (просмотр `client_legal_details`) |
| LinkDetailsDrawer | `code: src/components/admin/payments/links/LinkDetailsDrawer.tsx` | — | REUSE (паттерн drawer) |
| PaymentDocumentsDrawer | `code: src/components/admin/payments/PaymentDocumentsDrawer.tsx` | — | REUSE (паттерн drawer) |

**Общий Sheet-shell отсутствует.** Разметка `SHEET_SHELL_CLASS` дублируется. Extract shared — deferred (см. `companies_architecture_freeze.md` §Deferred D1). Для Phase 7 копируется паттерн, не блокирует релиз.

## 2. Разбор ContactDetailSheet (по блокам)

| Блок | Ссылка | Вердикт для Company reuse |
|---|---|---|
| Header (аватар, имя, статус) | `ContactDetailSheet.tsx` header-часть | REUSE+PROPS (компания: логотип, name, УНП, badge статуса) |
| Profile (форма полей) | внутри Tabs `value="profile"` L1758 | Company-specific: свои поля (`companies_architecture_freeze.md` §8) |
| Feed (Timeline) | Tab `value="feed"` L1759-L1762 → `ContactFeedTab.tsx` | REUSE+PROPS (`entity_type='company'`, `entity_id`) |
| Telegram chat | Tab `telegram` L1763-L1766 → `ContactTelegramChat.tsx` | Company-specific / N/A (Telegram привязан к profile) |
| Calls | Tab `calls` L1767-L1770 → `CallsHistorySection.tsx` | REUSE+PROPS (Phase 6) |
| SMS | Tab `sms` L1771-L1774 | Deferred (не в Phase 1/7) |
| Email | Tab `email` L1775-L1778 | Deferred |
| Access | Tab `access` L1779-L1781 | N/A: access — только по `profile_id` (инвариант) |
| Deals | Tab `deals` L1782-L1784 → `ContactDealsTab.tsx` | REUSE+PROPS (список сделок компании) |
| Tasks | Tab `tasks` L1785-L1787 → `CrmTasksSection.tsx` | REUSE+PROPS (Phase 6) |
| Documents | (не отдельный tab в контакте, есть `admin_docs`) | REUSE, Phase 10 |
| Notes | внутри профиля | REUSE (паттерн) |
| Actions/Toolbar | header actions | Company-specific: archive/merge/export |
| Permissions | оболочка через `useRbac` | REUSE |
| Dialogs | Create/Edit — dialogs в `admin/tasks/*` и др. | REUSE |

## 3. Разбор DealDetailSheet (по блокам)

| Блок | Ссылка | Вердикт |
|---|---|---|
| Header | `DealDetailSheet.tsx:L539+` | REUSE+PROPS (добавить бейдж компании) |
| Participants (contact) | внутри Deal | REUSE+PROPS: добавить `company_id` + переход в `CompanyDetailSheet` (Phase 5) |
| Timeline | `crm_activity_log` события сделки | REUSE (события компании кросс-отобразятся через `related_ids`) |
| Tasks | `useDealTaskSummary` + `CrmTasksSection` | REUSE (Phase 6 расширение на company_id) |
| Products / Offers | внутри Deal | REUSE (без изменений) |
| Payments | внутри Deal | REUSE |
| Documents | `admin_docs`, `document_package_sessions` | REUSE (Phase 10 — компания как участник) |
| Automation | `crm_task_automation_rules` | REUSE |
| Activity Feed | тот же `crm_activity_log` | REUSE |

## 4. Tabs, filters, toolbars

- Tabs: `code: src/components/admin/ContactDetailSheet.tsx:L1754-L1787` — паттерн `TabsList mx-4 sm:mx-6 mt-0 mb-0 inline-flex bg-transparent h-auto`, `TabsTrigger text-xs sm:text-sm px-2.5 sm:px-3`. Компания должна использовать тот же паттерн.
- Filters bar: `code: src/components/admin/deals/DealsFiltersBar.tsx`, `src/components/admin/tasks/filters/*`. Для `AdminCompanies` — тот же layout.
- Bulk actions: `code: src/components/admin/deals/KanbanBulkActionsBar.tsx`, `src/components/admin/tasks/TasksBulkActionsBar.tsx`.
- Pagination: везде server-side через параметры RPC (см. `useCrmTasks`).

## 5. Компоненты для reuse в Phase 7 (AdminCompanies + CompanyDetailSheet)

- `SheetContent`, `Tabs*` (shadcn).
- `ContactFeedTab.tsx` — при расширении `entity_type/entity_id`.
- `ContactDealsTab.tsx` — список сделок по фильтру `company_id`.
- `CallsHistorySection.tsx` (Phase 6).
- `CrmTasksSection.tsx` (Phase 6).
- Filters/Bulk/Toolbar паттерны из Deals/Tasks.
- Формы полей — новые (Company-specific), но с использованием shadcn primitives.

## 6. Что запрещено

- Копировать `ContactDetailSheet.tsx` целиком под `CompanyDetailSheet.tsx`. Собирать из блоков.
- Дублировать `ContactFeedTab.tsx` под `CompanyTimeline.tsx`. Расширять существующий.
- Создавать отдельный `CompanyTasks.tsx` / `CompanyCalls.tsx`.

## 7. Deferred технический долг

- D1: Извлечь общий Sheet-shell (`SHEET_SHELL_CLASS` + shared header slot). Не блокирует Phase 1–8. Планировать после Phase 8.
- D2: Разложить `ContactDetailSheet.tsx` (4074 строк) на секции. Не блокирует, но повышает риск конфликтов при параллельной работе.
