# да, согласен, с учетом правок:

&nbsp;

1. PATCH 8.4.4 и PATCH 9 делать двумя фазами в одном спринте, но не смешивать их в одну реализацию без промежуточного proof.
  Сначала полностью закрыть 8.4.4 по всем найденным Sheet, потом переходить к пакетам документов.
2. PATCH 8.4.4 — не просто “заменить 13 className”, а сделать это через единый стандарт + proof по ключевым экранам.
  Обязательно показать before/after минимум для:
  &nbsp;
  - ContactDetailSheet
  - DealDetailSheet
  - EntityRecordSheet
  - PersonRecordSheet
  - AiDocumentTemplatesManager
  - GenerateAiDocumentDialog
    DoD:
  - видны 4 угла;
  - есть inset от viewport;
  - один внутренний scroll;
  - footer не уезжает;
  - нет обрезания header/body.
  &nbsp;
3. PATCH 9 — таблицы пакетов должны быть owner-scoped, а не “open for authenticated”.
  В document_package_templates обязательно добавить:
  &nbsp;
  - profile_id uuid not null
  - created_by uuid null
  - created_at
  - updated_at
    RLS:
  - владелец по profile_id;
  - admin/superadmin через has_role_v2;
  - никаких открытых insert/update/delete для всех authenticated.
  &nbsp;
4. document_package_templates не перегружать лишними полями.
  Если пакеты сейчас только для AI, то:
  &nbsp;
  - template_scope в пакете не нужен;
  - никаких code/slug в UI;
  - идентификатор только id.
    Название + описание + active — достаточно.
  &nbsp;
5. document_package_template_items усилить ограничениями.
  Добавить:
  &nbsp;
  - unique(package_template_id, template_id)
  - check(sort_order >= 0)
  - индекс по (package_template_id, sort_order)
    Это нужно, чтобы один и тот же шаблон не попадал в пакет дважды.
  &nbsp;
6. Сразу подготовить фундамент под будущую генерацию пакета, чтобы потом не ломать историю документов.
  Add-only правка:
  &nbsp;
  - в ai_generated_documents добавить nullable-поля:
    &nbsp;
    - package_template_id uuid null
    - package_item_id uuid null
      Пока они не используются генератором, но закладывают правильную модель для следующего патча.
    &nbsp;
  &nbsp;
7. UI пакетов — без drag&drop в этом патче.
  Не тратить спринт на DnD.
  Для foundation достаточно:
  &nbsp;
  - создать пакет;
  - добавить в него шаблоны;
  - менять порядок кнопками “вверх/вниз” или через sort_order.
    Drag&drop — отдельный future patch.
  &nbsp;
8. В AiDocumentsGenerateView пакетные карточки показывать отдельно от одиночных шаблонов.
  Не смешивать их визуально в один список без маркировки.
  Для пакета:
  &nbsp;
  - badge Пакет
  - badge N документов
  - кнопка пока не “Сформировать”, а нейтральная Открыть / Скоро
    Одиночные шаблоны продолжают работать как сейчас.
  &nbsp;
9. Менеджер пакетов делать отдельным компонентом, а не перегружать текущий manager шаблонов.
  Лучше:
  &nbsp;
  - AiDocumentTemplatesManager — только одиночные шаблоны;
  - AiDocumentPackagesManager — только пакеты.
    Открытие можно оставить из одной точки входа, но логически не смешивать два CRUD в одном тяжёлом компоненте.
  &nbsp;
10. PATCH 9 сейчас только foundation и отображение, без генерации пакета.
  Не добавлять недоделанный wizard пакета в этом же патче.
  Должно быть только:
  &nbsp;
  - миграции;
  - owner-safe RLS;
  - UI создания/редактирования пакета;
  - привязка существующих document_templates;
  - отображение пакета в AI Documents.
  &nbsp;
11. Финальный proof по PATCH 9 обязателен.
  Показать:
  &nbsp;
  - создание пакета;
  - добавление 2–4 шаблонов в пакет;
  - изменение порядка;
  - пакет виден в AI Documents как отдельная карточка;
  - одиночные шаблоны не сломаны;
  - RLS/ownership работают корректно;
  - никаких изменений в billing flow.
  &nbsp;
12. Add-only mapping зафиксировать явно.
  Старое:
  &nbsp;
  - одиночные AI шаблоны
    Новое:
  - одиночные AI шаблоны остаются как есть
  - сверху добавляется новый слой пакетных шаблонов
    Ничего из уже рабочего по PATCH 8.1–8.4 не удалять и не переделывать 1:many без явного mapping.
  &nbsp;

&nbsp;

&nbsp;

Готовый блок для вставки:

```
ЖЁСТКИЕ ПРАВИЛА ИСПОЛНЕНИЯ ДЛЯ LOVABLE.DEV

- Ничего не ломать и не трогать лишнее.
- Add-only: новые изменения только добавляются, существующую рабочую логику не удалять.
- Сначала dry-run/анализ, потом execute.
- Не менять billing flow, generated_documents, generate-from-template, public checkout, settings/legal-details.
- Не ломать PATCH 5/6/7/8.
- Все proof и UI-проверки показывать на основной админ-учётке 7500084@gmail.com.
- В финале дать отчёт: что изменено, какие файлы, какие миграции, какие экраны проверены.

PATCH 8.4.4 — ГЛОБАЛЬНАЯ УНИФИКАЦИЯ SHEET

Цель:
распространить единый `SHEET_SHELL_CLASS` на все remaining right-side Sheet, которые ещё визуально прилипают к краям и не соответствуют shell-стандарту реквизитов.

Что сделать:
1. Найти все remaining `SheetContent` с устаревшим inline shell.
2. Перевести их на `SHEET_SHELL_CLASS`.
3. Для экранов со своей стилизацией сохранять стили add-only через `cn(SHEET_SHELL_CLASS, ...)`.
4. Не менять бизнес-логику окон — только shell/layout/scroll/footer.

Обязательный proof:
- `ContactDetailSheet`
- `DealDetailSheet`
- `EntityRecordSheet`
- `PersonRecordSheet`
- `AiDocumentTemplatesManager`
- `GenerateAiDocumentDialog`

DoD:
- видны все 4 угла;
- есть inset сверху/снизу/справа;
- один внутренний scroll;
- footer не уходит вниз;
- нет двойного scrollbar;
- окна визуально одного стандарта.

PATCH 9 — FOUNDATION ДЛЯ ПАКЕТОВ ДОКУМЕНТОВ

Контекст:
в AI шаблон может быть не одиночным документом, а пакетом документов для одного действия. Пакет — это бизнес-сценарий, внутри которого несколько `document_templates`.

Что сделать:

1. Создать таблицу `document_package_templates`
Поля:
- `id uuid primary key default gen_random_uuid()`
- `profile_id uuid not null`
- `name text not null`
- `description text null`
- `is_active boolean not null default true`
- `created_by uuid null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

2. Создать таблицу `document_package_template_items`
Поля:
- `id uuid primary key default gen_random_uuid()`
- `package_template_id uuid not null references document_package_templates(id) on delete cascade`
- `template_id uuid not null references document_templates(id) on delete restrict`
- `sort_order integer not null default 0`
- `is_required boolean not null default true`
- `title_override text null`
- `created_at timestamptz not null default now()`

Ограничения:
- `unique(package_template_id, template_id)`
- `check(sort_order >= 0)`
- индекс `(package_template_id, sort_order)`

3. Подготовить future foundation в `ai_generated_documents`
Add-only поля:
- `package_template_id uuid null`
- `package_item_id uuid null`

Пока не использовать в генераторе, только добавить для будущей совместимости.

4. RLS
Для `document_package_templates`:
- owner access по `profile_id`
- admin/superadmin через `has_role_v2`
- никаких открытых insert/update/delete для всех authenticated

Для `document_package_template_items`:
- доступ через join к owner package
- admin/superadmin через `has_role_v2`

5. UI
Создать отдельный manager:
- `AiDocumentPackagesManager`
Функции:
- список пакетов
- создать пакет
- редактировать пакет
- удалить пакет
- привязать существующие `document_templates`
- менять порядок элементов кнопками вверх/вниз или через `sort_order`
- без drag&drop в этом патче

6. AI Documents
В `AiDocumentsGenerateView`:
- одиночные шаблоны оставить как есть
- пакетные шаблоны показать отдельными карточками
- на карточке пакета показать:
  - badge `Пакет`
  - badge `<N> документов`
- без рабочей генерации пакета в этом патче
- кнопка у пакета: `Открыть` или `Скоро`, но не запуск генерации

7. Что НЕ делать
- не реализовывать multi-generate wizard
- не менять edge function `ai-generate-document`
- не менять billing admin
- не удалять существующие одиночные шаблоны
- не смешивать manager шаблонов и manager пакетов в один тяжёлый CRUD-компонент

DoD:
- пакет создаётся;
- в пакет можно добавить несколько существующих `document_templates`;
- порядок элементов меняется;
- пакет виден в AI Documents как отдельная карточка;
- одиночные AI шаблоны продолжают работать;
- billing flow не затронут;
- owner/RLS работают корректно;
- показан proof на UI и SQL.

PATCH 8.4.4 + PATCH 9 — Глобальная унификация Sheet + Foundation пакетов документов
```

## PATCH 8.4.4 — Глобальная унификация Sheet

### Анализ

Найдено **13 SheetContent** без `SHEET_SHELL_CLASS`. Из них right-side panels, подходящие под унификацию:


| Файл                             | Текущий className                                          | Тип                             |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| `ContactDetailSheet.tsx`         | `w-full sm:max-w-[60vw] lg:max-w-3xl p-0 ...` inline shell | Большая панель — кандидат       |
| `DealDetailSheet.tsx`            | `w-full sm:max-w-[60vw] lg:max-w-3xl p-0 flex flex-col`    | Большая панель — кандидат       |
| `MemberDetailsDrawer.tsx`        | `w-full sm:max-w-xl overflow-y-auto`                       | Средняя панель — кандидат       |
| `ConsentDetailSheet.tsx`         | `w-full sm:max-w-lg`                                       | Малая панель — кандидат         |
| `AccessHistorySheet.tsx`         | `w-full sm:max-w-lg`                                       | Малая панель — кандидат         |
| `PreregistrationDetailSheet.tsx` | `w-full sm:max-w-lg overflow-y-auto`                       | Малая панель — кандидат         |
| `BillingDetailSheet.tsx`         | `w-full sm:max-w-lg`                                       | Малая панель — кандидат         |
| `SubscriptionActionsSheet.tsx`   | `sm:max-w-lg overflow-y-auto`                              | Малая панель — кандидат         |
| `IntegrationLogsSheet.tsx`       | `sm:max-w-lg`                                              | Малая панель — кандидат         |
| `FeedbackDrawer.tsx`             | `w-full sm:max-w-lg flex flex-col p-0 backdrop-blur...`    | Стилизованная панель — кандидат |
| `DocumentLogTab.tsx`             | `w-[400px] sm:w-[540px] overflow-y-auto`                   | Малая панель — кандидат         |
| `OrderDocuments.tsx`             | `w-[400px] sm:w-[540px]`                                   | Малая панель — кандидат         |
| `SubscriptionDetailSheet.tsx`    | `sm:max-w-md overflow-y-auto`                              | Малая панель — кандидат         |


### Решение

Применить `SHEET_SHELL_CLASS` ко всем 13 файлам:

- Заменить inline className на `SHEET_SHELL_CLASS`
- Для `ContactDetailSheet` и `DealDetailSheet` — они уже имеют похожий inline shell, замена 1:1
- Для малых панелей (sm:max-w-lg) — shell даст `sm:max-w-3xl` + rounded corners + inset; это расширит их, но унифицирует визуал
- Для `FeedbackDrawer` — сохранить `backdrop-blur` и glassmorphism поверх shell через `cn(SHEET_SHELL_CLASS, "backdrop-blur-xl ...")`
- Внутренняя бизнес-логика НЕ меняется — только className на SheetContent

### Файлы (13 правок)

Каждый файл: `import { SHEET_SHELL_CLASS } from "@/lib/sheetShell"` + замена className.

---

## PATCH 9 — Foundation для пакетов документов

### Новые таблицы

`**document_package_templates**` — пакетный шаблон (бизнес-сценарий):

- `id` uuid PK
- `name` text NOT NULL
- `description` text
- `is_active` boolean DEFAULT true
- `template_scope` text DEFAULT 'ai'
- `created_at` / `updated_at` timestamptz

`**document_package_template_items**` — привязка шаблонов к пакету:

- `id` uuid PK
- `package_template_id` uuid FK → document_package_templates
- `template_id` uuid FK → document_templates
- `sort_order` int DEFAULT 0
- `is_required` boolean DEFAULT true
- `title_override` text (опциональное имя вместо имени шаблона)
- `created_at` timestamptz

RLS: authenticated select/insert/update/delete (admin-only через has_role или open для AI scope).

### UI изменения

В `AiDocumentsGenerateView.tsx`:

- Рядом с одиночными шаблонами показывать пакетные шаблоны
- Пакет = карточка с badge «Пакет • N документов»
- Пакет пока нельзя генерировать (badge «Скоро» или disabled)
- Одиночные шаблоны продолжают работать как раньше

В `AiDocumentTemplatesManager.tsx`:

- Добавить вкладку/секцию для управления пакетами
- CRUD пакета: имя, описание, активен
- Привязка существующих document_templates к пакету с drag-sort

### Что НЕ делать

- Не реализовывать multi-generate wizard
- Не менять edge function
- Не ломать текущую одиночную генерацию

### Порядок выполнения

1. Сначала PATCH 8.4.4 (унификация shell)
2. Затем PATCH 9 (миграции + UI пакетов)