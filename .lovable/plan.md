# да, согласен, с учетом правок:

1. План approve, но строго придерживаться упрощённой UX-модели: отдельную вкладку «Админ. пакеты» убрать. Всё управление пакетом должно быть внутри «Пакеты документов → Идеология».

2. Внутри пакета «Идеология» должны быть подвкладки:

   - Состав;

   - Шаблоны;

   - Анкета;

   - Роли;

   - Проверка.

3. Роли добавляются прямо из анкеты пакета через пункт «+ Добавить роль» в выпадающем списке ролей.

4. Форма добавления роли должна быть простой:

   - Название роли — обязательно;

   - Описание — необязательно.

   

   Не показывать в основном UI: `role_key`, `output_template`, `min_count`, `max_count`, `sort_order`, `is_system`, `template_scope`, `package_template_id`.

5. После создания роли система автоматически присваивает ей PKR-код. Единственный рабочий плейсхолдер роли:

   `{{package.role.PKR-XXXXXX}}`

6. Старые форматы:

   `{{package.roles.<role_key>.full_name}}`

   `{{package.roles.<role_key>.position}}`

   `{{package.roles.<role_key>.short_name}}`

   

   не показывать в UI и каталоге плейсхолдеров. Оставить только как deprecated warning в валидаторе.

7. Роли не глобальные. Каждая роль принадлежит конкретному `package_template_id`. Если PKR из другого пакета вставлен в шаблон текущего пакета — validator должен выдавать ошибку `pkr_outside_bound_package`.

8. Одна роль может быть назначена нескольким физлицам. Не спрашивать это при создании роли. Назначение происходит в анкете пакета.

9. Шаблоны DOCX загружаются только через вкладку «Шаблоны документов». В форме загрузки добавить:

   - Тип шаблона: Биллинговый документ / Пакет документов;

   - если выбран «Пакет документов» — селект пакета.

10. После загрузки package-template автоматически привязывается к выбранному пакету через `package_template_bind_template`.

11. Внутри «Пакеты документов → Идеология → Состав / Шаблоны» показывать список уже привязанных шаблонов:

   - название;

   - версия;

   - статус проверки;

   - открыть;

   - проверить плейсхолдеры;

   - отвязать.

12. В каталоге плейсхолдеров группа «Пакет: Роли» должна показывать роли, сгруппированные по пакетам:

   - Пакет: Идеология;

   - далее другие пакеты.

   

   В каждой строке показывать русское название роли и PKR-плейсхолдер.

13. Все пользовательские надписи только на русском языке. Технические поля показывать только в debug-режиме для super_admin, если нужно.

14. Validation:

   - `{{field:FLD-XXXXXX}}` для системных/документных полей — valid;

   - billing-реквизиты `{{field:FLD-XXXXXX}}` внутри package-template — warning, не error;

   - `{{package.ul.FLD-XXXXXX}}`, `{{package.ip.FLD-XXXXXX}}`, `{{package.fl.FLD-XXXXXX}}` — valid при наличии source path;

   - `{{package.role.PKR-XXXXXX}}` — valid только если PKR принадлежит пакету шаблона.

15. Не трогать:

   - `canonical-document-generate-strict`;

   - Gotenberg;

   - `ai_generated_documents`;

   - billing resolver;

   - биллинговые FLD и группы «Заказчик/Исполнитель»;

   - существующие реквизитные таблицы.

&nbsp;

План: Sprint 3F Phase 2c — Упрощение UX пакетов документов

## 0. Цель

Привести админский раздел `/admin/documents` к простой рабочей модели:

```
Документы
  → Пакеты документов
      → Идеология
          → Состав пакета
          → Шаблоны пакета
          → Анкета пакета
          → Роли пакета
          → Проверка шаблонов
```

Отдельная вкладка «Админ. пакеты» удаляется. Управление ролями и проверкой шаблонов живёт **внутри пакета**. Загрузка DOCX остаётся во вкладке «Шаблоны документов», но получает выбор пакета.

---

## 1. Жёсткие ограничения (invariants)

- НЕ трогать `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing resolver.
- НЕ менять биллинговые группы плейсхолдеров и `legal_details_*` источники.
- НЕ создавать новые таблицы реквизитов.
- НЕ вводить новые FLD-коды.
- Канонический role-token — только `{{package.role.PKR-XXXXXX}}`. Старые `{{package.roles.<role_key>.full_name|position|short_name}}` — deprecated warning, в UI не показываются.
- Роль всегда принадлежит конкретному `package_template_id`. PKR из другого пакета → error `pkr_outside_bound_package`.
- Переименование роли НЕ меняет PKR-плейсхолдер.
- Hard delete ролей запрещён (только архив).
- Все пользовательские надписи — на русском. Технические термины (`role_key`, `template_scope`, `min/max_count`, `output_template`, `sort_order`, `is_system`) скрыты из основного UI.

---

## 2. Удалить вкладку «Админ. пакеты» из верхнего меню

**Где:** `src/components/ai-chat/AiPageContent.tsx` (sub-tab `pkg-admin`), `src/pages/admin/AdminDocuments.tsx`, `DOC_SUB_TABS`.

**Что сделать:**

- Убрать пункт `pkg-admin` из меню `/admin/documents`.
- Компонент `PackageAdminPanel` физически НЕ удалять — переиспользуется внутри пакета.
- Все ссылки на `?tab=pkg-admin` перенаправляются на `?tab=doc-packages`.

**DoD:** в `/admin/documents` нет верхней вкладки «Админ. пакеты».

---

## 3. Перестроить вкладку «Пакеты документов»

**Где:** новый файл `src/components/ai-documents/packages/PackagesWorkspace.tsx` + переработка существующего раздела doc-packages внутри `AiPageContent`.

**Структура UI:**

```text
┌─ Пакеты документов ──────────────────────────────────────┐
│ [Идеология] [Бухгалтерский баланс*] [Ответ налоговой*]   │  ← переключатель пакетов
├──────────────────────────────────────────────────────────┤
│ Пакет: Идеология                                          │
│                                                           │
│ [Состав] [Шаблоны] [Анкета] [Роли] [Проверка]            │  ← внутренние подвкладки
│                                                           │
│ <содержимое выбранной подвкладки>                         │
└──────────────────────────────────────────────────────────┘
```

- серым — пакеты, которые ещё не настроены (no-op placeholder с надписью «появится позже»).

**Подвкладки:**

1. **Состав пакета** — список привязанных шаблонов (см. §7).
2. **Шаблоны пакета** — то же, что Состав, но с действиями привязки (read-only список + кнопка «Загрузить шаблон» → ссылка на вкладку «Шаблоны документов» с пресетом пакета).
3. **Анкета пакета** — существующий UI анкеты + dropdown ролей с пунктом «+ Добавить роль» (см. §5).
4. **Роли пакета** — упрощённый CRUD (см. §4).
5. **Проверка шаблонов** — существующая `PackageTemplateValidationPanel` без изменений логики.

**DoD:** все настройки пакета доступны в одном месте, отдельной админ-вкладки нет.

---

## 4. Упростить форму роли (`PackageRolesManager`)

**Где:** `src/components/ai-documents/packages/PackageRolesManager.tsx`.

**В UI оставить только:**

- Название роли (обязательно).
- Описание (необязательно).
- Бейдж PKR (read-only, с кнопкой «Скопировать `{{package.role.PKR-XXXXXX}}`»).
- Кнопка «Архивировать» / «Восстановить».

**Скрыть из основного UI** (поля остаются в БД с дефолтами):

- `role_key` (генерируется автоматически в хуке, см. существующий `slugifyRoleKey`).
- `output_template` — всегда `null`, дефолт «должность + ФИО» применяется в будущем генераторе.
- `min_count`, `max_count` — `null` (роль может быть назначена 1+ физлицам).
- `required` — `false` по умолчанию.
- `sort_order` — автоинкремент по `created_at`.
- `is_system` — `false` для новых, системные роли остаются read-only.
- `allowed_entity_types` — фиксированно `['person']`.

**Что НЕ показывать совсем:** «Как выводить в документе», «один человек / несколько человек». Любая роль по умолчанию multi-assignable.

**Debug-режим:** под флагом `super_admin + ?debug=1` показывать развёрнутый редактор (read-only вьюшка для диагностики). Это опционально, не блокирует Phase 2c.

**DoD:** создание роли по одному обязательному полю (название), PKR присваивается автоматически.

---

## 5. Добавление роли из анкеты пакета

**Где:** компонент анкеты в `src/components/document-packages/*` (использующий `useDocumentPackageSession`) — добавить dropdown с пунктом «+ Добавить роль».

**Сценарий:**

1. В строке физлица — Select со списком активных ролей текущего пакета.
2. Последний пункт списка: `+ Добавить роль`.
3. По клику открывается `Dialog` (новый компонент `AddPackageRoleInlineDialog`) с двумя полями: название, описание.
4. Submit → `usePackageRoleCatalog.create({ package_template_id, label, description })`.
5. После успеха роль автоматически выбрана для текущего физлица; список ролей в dropdown обновляется через `queryClient.invalidateQueries`.

**Multi-assignment:** одна и та же роль может быть выбрана у нескольких физлиц — на уровне `document_package_session_participants` уникальность не накладывается (текущая схема это уже позволяет; проверить и при необходимости снять лишний unique constraint в отдельной мини-миграции, но **только если реально мешает**).

**DoD:** роль создаётся inline, сразу доступна в dropdown, появляется в каталоге плейсхолдеров.

---

## 6. Загрузка DOCX с выбором пакета (вкладка «Шаблоны документов»)

**Где:** `src/components/ai-documents/StrictDocumentTemplatesManager.tsx` (форма загрузки).

**Добавить в форму загрузки:**

```
Имя шаблона: [_______________]
Тип шаблона: ( ) Биллинговый документ
             ( ) Пакет документов
   ↳ Пакет:  [ Идеология ▼ ]    ← показывается только при выборе «Пакет документов»
Файл .docx:  [Выбрать файл]
[Загрузить]
```

**Логика submit:**

1. Загрузка файла в storage + INSERT в `document_templates` (как раньше).
2. Если выбран «Биллинговый документ» → `template_scope='billing'`, поведение как сейчас.
3. Если «Пакет документов» → вызов RPC `package_template_bind_template(_template_id, _package_template_id)`. RPC уже:
  - выставляет `template_scope='package'`,
  - вставляет в `document_package_template_items` с `sort_order = max+1`,
  - пишет audit `package_template_item_linked`.
4. Toast: «Шаблон загружен и привязан к пакету “Идеология”».

**DoD:** загрузка → шаблон сразу в составе пакета, без отдельного шага привязки.

---

## 7. Состав пакета

**Где:** новый/переиспользуемый `PackageContentsList` внутри `PackagesWorkspace`.

**Источник данных:** `document_package_template_items` + join `document_templates` (как в текущем `TemplateBindingControl`).

**Колонки:**

- Название шаблона.
- Версия (`template_version`).
- Статус (`draft / active / archived`).
- Результат последней проверки плейсхолдеров (badge: valid / warning / error / не проверялся).
- Действия: «Открыть» (→ страница шаблона), «Проверить плейсхолдеры» (→ запуск `PackageTemplateValidationPanel` для этого шаблона), «Отвязать» (RPC `package_template_unbind_template`).

**Empty-state:** «В пакете пока нет шаблонов. Загрузите шаблон во вкладке "Шаблоны документов" и выберите пакет "Идеология".» + кнопка-ссылка на вкладку «Шаблоны документов».

**DoD:** виден реальный состав пакета, все действия работают через существующие RPC.

---

## 8. Каталог плейсхолдеров: группа «Пакет: Роли»

**Где:** `src/components/ai-documents/PlaceholdersCatalogTab.tsx`, `src/utils/packagePlaceholderCatalog.ts`.

**Изменения:**

- Группа `Пакет: Роли` с подзаголовками по пакетам (`Пакет: Идеология`, `Пакет: Бухгалтерский баланс`, …).
- Источник — `document_package_role_catalog` where `is_active=true`, отсортировано по `package_template_id`, `sort_order`.
- Для каждой роли — строка: `<label> — {{package.role.PKR-XXXXXX}}` + кнопка «Скопировать».
- Поиск работает по `label` и `public_id`.
- Старые `package.roles.<role_key>.*` варианты НЕ выводятся в каталоге (остаются только как deprecated warning в валидаторе).

**DoD:** в каталоге виден только PKR-формат, сгруппированный по пакетам.

---

## 9. Validation rules (без изменений в Gotenberg/генерации)

**Где:** `supabase/functions/canonical-template-apply-markup/index.ts` + клиентский `PackageTemplateValidationPanel`.

Валидатор принимает:

- `{{field:FLD-XXXXXX}}` — системные/документные общие поля → **valid** в любом scope.
- `{{field:FLD-XXXXXX}}` биллинговой группы внутри package-template → **warning** (не error).
- `{{package.ul|ip|fl.FLD-XXXXXX}}` → **valid**, если FLD существует и есть source path.
- `{{package.role.PKR-XXXXXX}}` → **valid**, если PKR принадлежит `package_template_id` шаблона; иначе → **error** `pkr_outside_bound_package`; неизвестный PKR → **error** `pkr_unknown`.
- `{{package.roles.<role_key>.full_name|position|short_name}}` → **deprecated warning**, не показывается в каталоге.

Никаких вызовов Gotenberg, никаких записей в `ai_generated_documents`.

---

## 10. Технические детали

### Backend

- **Без новых миграций**, если уникальность `document_package_session_participants(package_session_id, role_catalog_id)` уже допускает несколько физлиц на одну роль. Если мешает — отдельная мини-миграция, снимающая лишний unique constraint (проверить перед реализацией через `supabase--read_query` на `pg_indexes`).
- Существующие RPC `package_template_bind_template` / `package_template_unbind_template` — переиспользуются.
- Триггер `assign_package_role_public_id` уже выставляет PKR — не трогаем.

### Frontend

- `AiPageContent.tsx`: убрать пункт `pkg-admin` из `DOC_SUB_TABS`.
- `AdminDocuments.tsx`: убрать `doc-packages` из `hiddenSections` (если присутствует — он там НЕ скрыт сейчас, но проверить).
- Новый компонент `PackagesWorkspace.tsx` объединяет:
  - `PackageSelector` (горизонтальные карточки/тэбы пакетов).
  - Внутренний `Tabs`: Состав / Шаблоны / Анкета / Роли / Проверка.
  - Переиспользует существующие: `PackageRolesManager` (упрощённый), `PackageTemplateValidationPanel`, новый `PackageContentsList`.
- `PackageRolesManager.tsx`: вырезать UI-поля per §4, оставить минималистичную форму.
- Новый `AddPackageRoleInlineDialog` для inline-создания из анкеты.
- `StrictDocumentTemplatesManager.tsx`: радио «Биллинговый / Пакет документов» + select пакета + вызов RPC после INSERT шаблона.
- `PlaceholdersCatalogTab.tsx` + `packagePlaceholderCatalog.ts`: группировка PKR-токенов по пакетам, удаление старых форматов из выдачи.

### Тексты UI

Все надписи — на русском. Технические термины спрятаны.

---

## 11. Что НЕ входит в Phase 2c

- Реальная генерация документов из пакета (Sprint 3G).
- Тонкая настройка формата вывода роли при множественном назначении.
- Полное удаление deprecated `package.roles.<key>.*` из валидатора (пока warning).
- Новый пакет «Бухгалтерский баланс» / «Ответ налоговой» — только серые placeholders в селекторе.

---

## 12. Proof

Создать `.lovable/proofs/package_documents_sprint3f_phase2c_ux_correction_2026_05.md` со скриншотами:

1. До/после структуры `/admin/documents` (нет вкладки «Админ. пакеты»).
2. Пакет «Идеология» внутри «Пакеты документов» с 5 подвкладками.
3. Inline-добавление роли из dropdown анкеты.
4. Созданная роль с PKR-бейджем.
5. Группа «Пакет: Роли» в каталоге плейсхолдеров.
6. Форма загрузки DOCX с выбором пакета.
7. Состав пакета с привязанным приказом.
8. Validation report (valid/warning/error на PKR из другого пакета).
9. Billing regression: скриншоты, что биллинговые шаблоны/группы плейсхолдеров не изменились.
10. No-generation proof: подтверждение, что `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents` не вызываются и не модифицируются.

---

## 13. DoD

- В `/admin/documents` нет вкладки «Админ. пакеты».
- Вкладка «Пакеты документов» содержит пакет «Идеология» с подвкладками Состав / Шаблоны / Анкета / Роли / Проверка.
- Роль создаётся inline из dropdown анкеты простой формой (название + описание).
- PKR присваивается автоматически, не меняется при переименовании.
- Placeholder роли только `{{package.role.PKR-XXXXXX}}`.
- Одна роль может быть назначена нескольким физлицам.
- Роли в каталоге сгруппированы по пакетам.
- При загрузке DOCX выбирается пакет, шаблон сразу появляется в составе пакета.
- Validation работает без генерации; PKR из чужого пакета → error.
- Все UI-надписи на русском, технические поля скрыты.
- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing resolver не тронуты.
- Биллинговые шаблоны и группы плейсхолдеров не изменились.

---

## 14. Финальный статус

```
completed: package document UX corrected;
package roles managed inside package workspace (Идеология);
PKR role placeholders are per-package and rename-safe;
inline role creation from questionnaire dropdown;
DOCX upload supports package binding from Шаблоны документов;
template validation works without generation;
generation still deferred to Sprint 3G
```