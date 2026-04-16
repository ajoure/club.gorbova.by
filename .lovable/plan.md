# да, согласен, с учетом правок:

&nbsp;

1. Не делать новый домен как просто набор вкладок без единого source contract. Сначала зафиксировать канонический read-model для раздела /admin/forms:
  &nbsp;
  - site_form_submissions
  - course_preregistrations / текущая сущность предзаписей
  - training progress (lesson_progress_state, user_lesson_progress, lesson_progress)
  - единый нормализованный row contract для списка
    Иначе вкладка «Все» превратится в хаотичную смесь разных таблиц.
  &nbsp;
2. Не копировать useContactArtifacts в глобальный hub почти дословно. Это хук уровня карточки контакта, а не общего домена.
  Нужен отдельный read-only query layer для /admin/forms, который:
  &nbsp;
  - работает глобально, без привязки к одному контакту
  - умеет фильтры, пагинацию, группировку
  - возвращает единый тип записи для таблицы и продукта/источника
    Переиспользовать логику только точечно, без второго source of truth.
  &nbsp;
3. Вкладку Все делать не как eager merge всего на клиенте, а как серверно-управляемый список/представление данных. Иначе при росте данных раздел быстро станет тяжелым.
  Минимум нужно:
  &nbsp;
  - серверные фильтры
  - серверная пагинация
  - детерминированная сортировка по created_at desc, source_type, id
  - явный limit/offset или cursor
    Без этого раздел будет пригоден только для маленького объема данных.
  &nbsp;
4. PreregistrationsTabContent не тащить внутрь как “black box as-is”, если он живет логикой старого домена платежей.
  Нужно сначала проверить:
  &nbsp;
  - не завязан ли он на payments-specific counters, labels, empty states, actions
  - не использует ли он route assumptions /admin/payments/preorders
  - нет ли там локальной фильтрации и локального query-state, конфликтующего с новым hub
    Если завязан — выделить из него table/view слой и переиспользовать, а не просто вставить целиком.
  &nbsp;
5. Добавить явное правило по деталям:
  &nbsp;
  - training → только existing StudentProgressModal
  - site form → только existing SiteFormDetailDialog
  - preregistration → только existing detail sheet/dialog
    И запретить создание новых detail renderers для этих трех типов.
  &nbsp;
6. В AdminPaymentsHub не просто убрать tab “Предзаписи”, а проверить:
  &nbsp;
  - counters/summary cards не используют эти записи
  - query params ?tab=preorders не ломают экран
  - ссылки из меню, breadcrumbs, внутренних кнопок не ведут в старый раздел
    Нужен backward compatibility patch:
  - route redirect
  - legacy tab param redirect
  - исправление внутренних ссылок.
  &nbsp;
7. В маршрутизации лучше делать один канонический маршрут /admin/forms с query/tab state, а не размножать 6 отдельных почти одинаковых страниц, если различие только во вкладке.
  Предпочтительно:
  &nbsp;
  - /admin/forms?tab=all
  - /admin/forms?tab=site
  - /admin/forms?tab=preorders
  - /admin/forms?tab=training
  - /admin/forms?tab=by-product
  - /admin/forms?tab=export
    Это упростит breadcrumbs, active state, redirects и reuse фильтров.
    Отдельные nested routes нужны только если реально есть разные page-level loaders/layout.
  &nbsp;
8. Раздел «По продуктам» не должен быть отдельной второй реализацией списка.
  Это должен быть альтернативный режим представления того же read-model:
  &nbsp;
  - list mode
  - grouped-by-product mode
    Иначе будет дублирование логики фильтров, сортировки, действий и деталей.
  &nbsp;
9. Для фильтров надо зафиксировать минимальный обязательный набор и не перегружать первый релиз:
  P1:
  &nbsp;
  - продукт
  - тип источника
  - период
  - поиск по клиенту/email/телефону
  - есть/нет сделки
  - есть/нет аккаунта
    P2:
  - страница/урок
  - статус
  - сложные комбинированные фильтры
    Иначе UI перегрузится.
  &nbsp;
10. В строке записи обязательно показать канонические поля:

&nbsp;

&nbsp;

&nbsp;

- клиент
- источник (site_form / preorder / training)
- продукт
- сущность-источник (страница / урок / анкета)
- дата
- статус
- аккаунт
- контакт
- сделка
  Но действия делать только безопасные:
- открыть детали
- открыть контакт
- открыть сделку
  Без write-actions в этом спринте.

&nbsp;

&nbsp;

&nbsp;

11. Раздел Экспорт не делать отдельной “страницей ради страницы”, если он просто экспортирует текущую выборку. Лучше:

&nbsp;

&nbsp;

&nbsp;

- кнопка export в общем toolbar
- либо компактная вкладка только с настройками формата и scope
  Но export должен работать от текущих фильтров текущего набора, а не от отдельного параллельного запроса.

&nbsp;

&nbsp;

&nbsp;

12. Нужен явный scope-guard по БД:

&nbsp;

&nbsp;

&nbsp;

- не создавать новые таблицы только ради hub
- не делать новые training renderers
- не переносить данные из источников в новый storage
- новый раздел — только read-domain поверх existing sources
  Исключение допустимо только если для серверной пагинации/фильтрации понадобится RPC/view, но без нового source of truth.

&nbsp;

&nbsp;

&nbsp;

13. Добавить обязательный discovery перед execute:

&nbsp;

&nbsp;

&nbsp;

- где именно живут предзаписи и как называется canonical table/source
- какие existing detail components уже есть и можно открыть без дублирования
- какие поля доступны для глобальной фильтрации во всех трех источниках
- какие индексы уже есть для дат, profile/contact, product_id, page_id, lesson_id
  Без этого легко построить красивый, но медленный hub.

&nbsp;

&nbsp;

&nbsp;

14. Добавить DoD по миграции домена:

&nbsp;

&nbsp;

&nbsp;

- пункт меню «Анкеты и данные» появился
- вкладка “Предзаписи” удалена из “Платежей”
- все legacy ссылки и redirects работают
- ни один existing detail flow не продублирован
- training details открываются только через StudentProgressModal
- site form details открываются только через existing form dialog
- глобальные фильтры реально влияют на данные, а не только на клиентский массив
- список выдерживает реальные данные без зависаний

&nbsp;

&nbsp;

&nbsp;

15. По названию раздела я бы оставил именно Анкеты и данные, как вы предложили, а не Формы. Это шире и лучше соответствует будущему домену: анкеты, предзаписи, формы сайта, обучение, ответы, история клиента.

&nbsp;

&nbsp;

Итог: идея правильная и направление хорошее.

Но план надо поправить в сторону единого read-model, серверной фильтрации/пагинации и жесткого переиспользования existing detail-компонентов без дублирования логики.

&nbsp;

План: новый раздел «Анкеты и данные» в левом меню

## Суть

Вынести «Предзаписи» из раздела «Платежи» в новый отдельный домен «Анкеты и данные». Объединить в нём все клиентские анкеты, формы сайта, предзаписи и training progress. Это read-domain поверх existing sources of truth — без новых таблиц и систем хранения.

## Шаги

### 1. Создать новую страницу `AdminFormsHub`

**Файл:** `src/pages/admin/AdminFormsHub.tsx`

- Аналогично `AdminPaymentsHub.tsx` — AdminLayout + вкладки pill-tabs
- Вкладки: Все / Анкеты сайта / Предзаписи / Обучение / По продуктам / Экспорт
- Роут: `/admin/forms` (base), `/admin/forms/site`, `/admin/forms/preorders`, `/admin/forms/training`, `/admin/forms/by-product`, `/admin/forms/export`

### 2. Добавить маршруты в `App.tsx`

- Добавить роуты `/admin/forms`, `/admin/forms/*`
- Redirect `/admin/payments/preorders` → `/admin/forms/preorders` (backward compat)
- Redirect `/admin/preregistrations` → `/admin/forms/preorders`

### 3. Убрать «Предзаписи» из `AdminPaymentsHub`

- Удалить tab `preorders` из массива `tabs` в `AdminPaymentsHub.tsx`
- Убрать import `PreregistrationsTabContent`

### 4. Добавить пункт в левое меню

**Файл:** `src/hooks/useAdminMenuSettings.tsx`

- Добавить `{ id: "forms", label: "Анкеты и данные", path: "/admin/forms", icon: "ClipboardList", order: 4 }` в группу CRM
- Добавить `ClipboardList` в `MENU_ICONS` (уже есть)

### 5. Создать контент вкладок

**Вкладка «Все»** — unified list из site_form_submissions + course_preregistrations + training progress (reuse `useContactArtifacts` logic, но без привязки к конкретному контакту — глобальный запрос).

**Вкладка «Анкеты сайта»** — фильтр `source_type = site_form` из site_form_submissions.

**Вкладка «Предзаписи»** — reuse `PreregistrationsTabContent` as-is.

**Вкладка «Обучение»** — training progress из lesson_progress_state/user_lesson_progress.

**Вкладка «По продуктам»** — группировка по product_id с collapsible секциями (reuse pattern из ContactArtifactsTab).

**Вкладка «Экспорт»** — CSV/Excel экспорт текущей выборки (reuse `exportToExcel` / `exportToCSV` из `exportTableData.ts`).

### 6. Единые фильтры

Панель фильтров для всех вкладок (кроме «Экспорт»):

- Продукт (select из products_v2)
- Тип данных (site_form / preorder / training)
- Период (date range)
- Контакт (поиск)
- Страница/урок
- Статус
- Есть/нет сделки
- Есть/нет аккаунта

### 7. Строка записи

Каждая запись показывает: клиент, продукт, источник, тип, дата, страница/урок/анкета, статус, наличие сделки, наличие аккаунта, действия (Открыть / Контакт / Сделка).

### 8. Детали по клику

- Training item → `StudentProgressModal` (existing)
- Site form / preorder → existing form detail dialog / `PreregistrationDetailSheet`

### 9. Обновить breadcrumbs и route titles

- `AdminLayout` `routeToTitle`: добавить `/admin/forms` → «Анкеты и данные»
- `DashboardBreadcrumbs`: добавить `/admin/forms` → «Анкеты и данные»

## Scope guard

- Training details = только existing `StudentProgressModal`
- Site form details = только existing form dialog
- Preregistrations = reuse existing `PreregistrationsTabContent`
- Никаких новых training renderers / normalizers
- Никаких новых таблиц БД — read-domain поверх existing tables

## Файлы


| Файл                                             | Действие                             |
| ------------------------------------------------ | ------------------------------------ |
| `src/pages/admin/AdminFormsHub.tsx`              | Создать — hub с вкладками            |
| `src/App.tsx`                                    | Добавить роуты, redirect legacy      |
| `src/pages/admin/AdminPaymentsHub.tsx`           | Убрать tab «Предзаписи»              |
| `src/hooks/useAdminMenuSettings.tsx`             | Добавить пункт «Анкеты и данные»     |
| `src/components/layout/AdminLayout.tsx`          | Добавить title/help для /admin/forms |
| `src/components/layout/DashboardBreadcrumbs.tsx` | Добавить breadcrumb                  |


## DoD

1. Пункт «Анкеты и данные» появился в левом меню
2. Предзаписи убраны из «Платежей»
3. `/admin/payments/preorders` → redirect на `/admin/forms/preorders`
4. Вкладки Все / Анкеты сайта / Предзаписи / Обучение / По продуктам / Экспорт работают
5. Training → existing StudentProgressModal
6. Site form → existing form dialog
7. Preregistrations → reuse existing PreregistrationsTabContent
8. Никаких новых training renderers