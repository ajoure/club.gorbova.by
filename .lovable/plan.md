да, согласен, с учетом правок:

1. **Не писать “target_ref: NULL”, пока не подтверждено, что схема это допускает**
  - Перед миграцией проверить constraint/тип поля `target_ref`.
  - Если `target_ref NOT NULL`, не ломать схему ради этого спринта.
  - Вариант безопаснее: использовать стабильный singleton UUID/ID домена только если он уже существует в текущей модели.
  - Не использовать текст `document_generation` как технический ключ пакета.
2. `document_generation` **как новый** `grant_target_type` **допустим только после проверки enum/CHECK**
  - Если `grant_target_type` — enum, миграция должна безопасно добавить значение.
  - Если CHECK — расширить CHECK без потери старых значений.
  - В отчете показать фактический тип/constraint до и после.
3. **Четко разделить legacy full-access и новый UUID partial-access**
  - Legacy:
    - `grant_target_type='section_access'`
    - `target_ref='document_generation'`
    - трактуется только как full access.
  - Новый partial:
    - `grant_target_type='document_generation'`
    - `conditions.access_mode='partial'`
    - `conditions.allowed_package_ids=[uuid]`.
  - Не добавлять package-level partial в старый `section_access`.
4. `allowed_package_ids` **валидировать на сохранении**
  - Только UUID.
  - Только существующие `document_package_templates.id`.
  - Только глобальные пакеты: `profile_id IS NULL`.
  - Только активные пакеты: `is_active=true`.
  - Дубли удалять.
  - `partial + []` не сохранять.
5. `get_user_document_package_ids(p_user uuid)` **не должна доверять произвольному** `p_user`
  - Если функция вызывается клиентом, она должна работать только для `auth.uid()`.
  - Либо убрать параметр `p_user` и использовать `auth.uid()` внутри.
  - Admin/super_admin может получать расширенную картину только через отдельный admin-safe путь, если нужен.
6. **RLS-функции не должны рекурсивно читать таблицы с теми же RLS-политиками**
  - `user_can_see_document_package()` должна быть `SECURITY DEFINER`.
  - `SET search_path = public`.
  - Без динамического SQL.
  - Внутри не должно быть запроса, который вызывает эту же policy повторно.
  - Если появляется recursion / stack depth / permission loop — STOP.
7. **Удаление пакета оставить максимально безопасным**
  - В плане сейчас указано “если нет items и sessions”.
  - Нужно расширить: если dependency-discovery неполный — hard delete не делать.
  - По умолчанию для непустого/использованного пакета — только `is_active=false`.
  - Проверить также references в `access_rules.conditions.allowed_package_ids`.
8. **Добавить audit_logs для CRUD пакетов**
  - Создание, переименование, деактивация, удаление/попытка удаления должны писаться в `audit_logs`.
  - Для admin-действий фиксировать actor admin.
  - В DoD добавить SQL-proof записи в `audit_logs`.
9. `useUserVisibleDocumentPackages()` **не должен быть RPC-only без RLS**
  - Источник истины — RLS + `user_can_see_document_package`.
  - RPC может быть UX-проекцией, но не единственной защитой.
  - Клиентский фильтр не считается защитой.
10. **Добавить proof, что изменение имени не влияет на доступ**

- Уже есть в DoD, но нужно уточнить проверку:
  - создать rule по UUID;
  - переименовать пакет;
  - проверить, что UUID в `allowed_package_ids` не изменился;
  - клиентский доступ сохранился.

11. **В отчете обязательно показать отсутствие slug/code в новых артефактах**

- Скрин диалога создания пакета без поля “Код”.
- SQL-proof: access rule содержит только UUID.
- Diff-summary: не добавлялись поля `slug/code`, не создавались индексы по ним.

12. **Не трогать генерацию документов**

- Подтвердить в плане/отчете:
  - `canonical-document-generate-strict` не изменялся;
  - edge-функции генерации не изменялись;
  - sessions/participants не менялись;
  - Gotenberg не затрагивался.

13. **Добавить DoD по inactive package**

- Если пакет `is_active=false`, клиент не видит его даже при наличии UUID в `allowed_package_ids`.
- Admin в CRUD видит inactive пакет и может активировать обратно.

14. **Добавить DoD по backward compatibility**

- Старое правило `section_access → document_generation` открывает все активные глобальные пакеты.
- Новое правило `document_generation/full` делает то же самое.
- Новое правило `document_generation/partial` открывает только выбранные UUID.

Копируемый блок для Lovable:

```text
Дополни план следующими правками:

1. Не использовать `target_ref: NULL`, пока discovery не подтвердит, что поле `target_ref` допускает NULL.

Перед миграцией проверить фактическую схему/constraint `access_rules.target_ref`.

Если `target_ref NOT NULL`, не ломать схему ради этого спринта. Использовать совместимый вариант, но не использовать название пакета, slug или code как технический ключ.

2. Новый `grant_target_type='document_generation'` добавлять только после проверки enum/CHECK.

В отчете показать:
- какой тип/constraint был у `grant_target_type` до миграции;
- как он расширен;
- что старые значения не сломаны.

3. Разделить legacy и новую модель доступа.

Legacy:
- `grant_target_type='section_access'`
- `target_ref='document_generation'`
- всегда трактуется как full access ко всей генерации документов.

Новая модель:
- `grant_target_type='document_generation'`
- `conditions.access_mode='full' | 'partial'`
- `conditions.allowed_package_ids=[uuid]`.

Не добавлять package-level partial в старый `section_access`.

4. Валидировать `allowed_package_ids` при сохранении правила.

Правила:
- только UUID;
- только существующие `document_package_templates.id`;
- только глобальные пакеты `profile_id IS NULL`;
- только активные пакеты `is_active=true`;
- удалить дубли;
- `access_mode='partial'` + пустой массив не сохранять.

5. `get_user_document_package_ids` не должна доверять произвольному `p_user`.

Если функция вызывается с клиента, она должна использовать `auth.uid()` внутри или проверять, что `p_user = auth.uid()`.

Admin/super_admin-доступ к чужой картине доступа — только через отдельный admin-safe путь, если он нужен.

6. RLS-функции сделать безопасными.

Для `user_can_see_document_package` и связанных функций:
- `SECURITY DEFINER`;
- `SET search_path = public`;
- без динамического SQL;
- без рекурсии через политики `document_package_templates` / `document_package_template_items`;
- отдельные тесты под admin, клиентом с full, клиентом с partial, клиентом без доступа.

Если появляется recursion / permission loop / stack depth — STOP.

7. Удаление пакетов сделать безопасным.

Удаление разрешать только если dependency-check полный.

Проверить зависимости минимум:
- `document_package_template_items`;
- `document_package_sessions`;
- `access_rules.conditions.allowed_package_ids`;
- любые найденные references по package_template_id.

Если dependency-check неполный или пакет уже использовался — hard delete не делать, только `is_active=false`.

8. Добавить audit_logs для CRUD глобальных пакетов.

Фиксировать:
- создание;
- переименование;
- активацию/деактивацию;
- удаление или заблокированную попытку удаления.

В DoD добавить SQL-proof записей в `audit_logs`.

9. RLS остается source of truth.

`useUserVisibleDocumentPackages()` может использовать RPC для UX, но защита должна быть на уровне RLS через `user_can_see_document_package`.

Клиентский фильтр не считается защитой.

10. Усилить DoD по переименованию.

Проверка:
- создать rule с `allowed_package_ids=[UUID]`;
- переименовать пакет;
- проверить, что UUID в rule не изменился;
- клиент по-прежнему видит пакет.

11. В отчете доказать отсутствие slug/code.

Добавить:
- скрин диалога создания пакета без поля «Код»/«Slug»;
- SQL-proof, что access rule хранит только UUID;
- diff-summary: не добавлялись поля `slug/code`, индексы по ним и транслитерация названия.

12. Не трогать генерацию документов.

В отчете явно подтвердить, что не изменялись:
- `canonical-document-generate-strict`;
- edge-функции генерации;
- Gotenberg;
- `document_package_sessions`;
- `document_package_session_participants`.

13. Добавить DoD по inactive package.

Проверить:
- если пакет `is_active=false`, клиент не видит его даже при наличии UUID в `allowed_package_ids`;
- admin в CRUD видит inactive пакет и может активировать обратно.

14. Добавить DoD по backward compatibility.

Проверить:
- старое правило `section_access → document_generation` открывает все активные глобальные пакеты;
- новое правило `document_generation/full` открывает все активные глобальные пакеты;
- новое правило `document_generation/partial` открывает только выбранные UUID.

План: Спринт 3S v2 — Управляемые пакеты документов и UUID-only гранулярный доступ
```

> Версия 2: учитывает обязательные правки пользователя — никаких slug/code/transliterate, переиспользуем паттерн `training_content` partial access, всё на UUID.

---

## STOP-guards (соблюдать на всём спринте)

Немедленно остановиться и пересмотреть подход, если в любой момент появляется:

- генерация `slug` / `code` / транслитерация русского названия пакета («Идеология» → `ideologiya`);
- связывание доступа по названию, slug, code или любому текстовому ключу пакета;
- сохранение выбранных пакетов в access rule **не** как массив UUID;
- параллельная новая система partial access для документов вместо переиспользования механики `training_content`;
- UI показывает корректное название, но resolver/RLS читает текстовый ключ.

---

## Часть 0. Обязательное discovery (до миграций и UI)

Уже выполнено для паттерна `training_content` (см. результат ниже), результат фиксируем в `.lovable/proofs/document_packages_access_discovery.md`.

### Найденная модель partial access для тренингов

Реализована поверх `access_rules` + поле `conditions jsonb`:

- `grant_target_type = 'training_content'`, `target_ref = <root_training_uuid>`;
- `conditions.access_mode: 'full' | 'partial'`;
- `conditions.allowed_module_ids: uuid[]`;
- `conditions.allowed_lesson_ids: uuid[]`;
- `conditions.auto_include_new_modules: boolean`.

UI в `ProductAccessRulesTab.tsx`:

- form-поля `tc_access_mode`, `tc_allowed_module_ids`, `tc_allowed_lesson_ids`, `tc_auto_include_new_modules`;
- дерево выбора берётся из `trainingTree` по `target_ref`;
- при сохранении кладётся в `conditions` (см. строки 558–594, 651+).

Resolver: `access-resolver.ts` + memory-канон `training-content-resolver-rules` — приоритеты P1–P5, default-deny, UUID-only.

**Этот же паттерн полностью переносится на пакеты документов.**

---

## Часть A. RLS-фикс глобального справочника пакетов (фикс «Нет доступных пакетов»)

### Диагноз

`document_package_templates`: запись «Идеология» глобальная (`profile_id=NULL`). SELECT-политика требует owner или admin → клиент видит 0 строк → пустой стейт. То же на `document_package_template_items`.

### Что меняем (одна миграция, только SELECT)

1. `document_package_templates` — permissive SELECT для `authenticated`, разрешён, если security-definer `user_can_see_document_package(template_id uuid)` вернул `true`.
2. `document_package_template_items` — permissive SELECT через ту же функцию (по `package_template_id`).
3. Все write-политики и owner-политики не трогаем.

`user_can_see_document_package(uuid)` реализует:

- admin/super_admin → true;
- owner пакета (profile_id IS NOT NULL и совпадает) → true;
- глобальный (`profile_id IS NULL AND is_active`) + у пользователя есть active access rule с UUID-резолюцией (см. Часть C).

---

## Часть B. Админский CRUD глобальных пакетов (без slug/code)

### Модель

Таблица `document_package_templates` уже имеет: `id uuid`, `name`, `description`, `is_active`, `profile_id`, `created_by`, `created_at`, `updated_at`.

**Никаких новых полей `slug` / `code` / `public_id` для логики доступа не вводим.** Существующий столбец `code`, если присутствует, считается legacy display-only и в новых артефактах не используется (см. memory `no-product-code-in-new-artifacts`). Никакого `unique_global_package_code` индекса — пункт удалён.

### Миграция

- Триггер `assert_global_package_admin_only` на INSERT/UPDATE: запись с `profile_id IS NULL` может появиться/измениться только если `has_role_v2(auth.uid(), 'admin'|'super_admin')`.
- Никаких уникальных индексов по тексту. PK по `id` достаточно.

### UI (`/admin/documents` → «Пакеты документов», админский режим)

Диалог «+ Новый пакет»:

- «Название» (обязательно);
- «Описание» (опционально);
- «Активен» (toggle).
- **Поля «Код»/«Slug»/«Public ID» отсутствуют.**

Действия со строкой пакета: Переименовать, Активировать/Деактивировать, Удалить (только если нет items и sessions; иначе показать причину).

Все мутации идут по `id`. Имя — display-only.

---

## Часть C. Гранулярный доступ к пакетам — переиспользование `training_content`-паттерна

### Архитектурное решение

Не создаём «section_access» как основной сценарий. Расширяем существующий механизм «доступ к контенту внутри продукта» новым типом контента:

`**grant_target_type = 'document_generation'**` (новый), либо переиспользование `training_content`-схемы 1-в-1 через обобщение. Решение фиксируется по результатам discovery: предпочтительно ввести `'document_generation'` как новый тип контента, потому что `target_ref` для документов — не root training UUID, а сам домен «генерация документов» (синглтон, без иерархии).

Структура формы и `conditions` строго копирует `training_content`:

```
grant_target_type: 'document_generation'
target_ref: NULL        // домен синглтонный, иерархии нет
conditions:
  access_mode: 'full' | 'partial'
  allowed_package_ids: uuid[]   // ТОЛЬКО UUID document_package_templates.id
```

Семантика:

- `access_mode='full'` → доступ ко всем активным глобальным пакетам (обратная совместимость с уже выданным «доступом ко всему домену»).
- `access_mode='partial'` + `allowed_package_ids=[uuid1, uuid2]` → доступ только к этим пакетам.
- `partial` + пустой массив → форма не валидируется (как у тренингов).
- admin/super_admin всегда видит всё.

**Никаких `package_slug`, `package_code`, `package_name_ref`. Только UUID.**

### Backward compatibility со старым `section_access → document_generation`

Существующие правила `grant_target_type='section_access' AND target_ref='document_generation'` продолжают работать как `access_mode='full'`. Resolver в Части D учитывает оба источника. Миграция данных не требуется; админ может позже пересоздать правила в новом типе.

### Изменения

1. **Миграция:**
  - Добавить `'document_generation'` в enum `grant_target_type` (если enum) или допустимое значение CHECK-констрейнта.
  - Функция `get_user_document_package_ids(p_user uuid)` → `{ full_access: bool, package_ids: uuid[] }`:
    - резолв активных правил пользователя через тот же путь, что `access-resolver` (subscriptions_v2 → entitlements → access_rules);
    - `full_access=true`, если admin/super_admin **или** есть active rule (`section_access → document_generation`) **или** (`document_generation` с `access_mode='full'`);
    - иначе `package_ids` = union `conditions.allowed_package_ids` по всем active `document_generation`-правилам пользователя.
  - Функция `user_can_see_document_package(p_template_id uuid)` использует первую.
2. **RLS** (Часть A замыкается на эту функцию).
3. **UI правил доступа** (`ProductAccessRulesTab.tsx`):
  - В Select «КУДА ВЫДАЁМ» добавить пункт «Доступ к генерации документов» (тип `document_generation`).
  - Блок формы — копия `training_content`:
    - Radio «Полный доступ» / «Частичный доступ».
    - При «Частичный» — список активных глобальных пакетов (`document_package_templates WHERE profile_id IS NULL AND is_active`), multi-select с чекбоксами (тот же `ProductCheckboxList`-стиль или существующий tree-компонент в плоском режиме).
  - При сохранении: `conditions.access_mode`, `conditions.allowed_package_ids` (UUID[]); `target_ref=null`.
  - При редактировании: гидратация из `conditions`.
  - В списке правил label считается по `name` пакета через JOIN по UUID; UI показывает «Пакеты: Идеология, Тест-X» — это только display.
4. **Frontend клиента (`PackagesWorkspace.tsx`):**
  - Список пакетов фильтруется по результату `get_user_document_package_ids` (на стороне сервера через RLS — клиентский фильтр не нужен, RLS уже скроет).
  - Пустой стейт «Нет доступных пакетов» остаётся как safety-net.

---

## Часть D. Автопоявление нового пакета

- Источник списка пакетов в UI правил и в `/document-generation` — один и тот же запрос: `document_package_templates WHERE profile_id IS NULL AND is_active = true`. Никаких enum/хардкодов.
- При создании пакета он:
  - сразу появляется в multi-select правила (после react-query invalidate);
  - сразу доступен клиентам с `access_mode='full'`;
  - НЕ доступен клиентам с `access_mode='partial'`, у которых его UUID не в `allowed_package_ids` (default-deny).
- E2E-чек в DoD: создать «Тест-X», убедиться, что он появился в Select и видим/невидим по гранту.

---

## Затронутые файлы

### Миграция (одна)

`supabase/migrations/<ts>_sprint_3s_v2_document_packages_uuid_access.sql`:

- расширение enum/CHECK `grant_target_type` (+ `'document_generation'`);
- триггер `assert_global_package_admin_only`;
- функции `user_can_see_document_package`, `get_user_document_package_ids`;
- SELECT-политики на `document_package_templates` и `document_package_template_items`.

### Frontend

- `src/components/admin/product/ProductAccessRulesTab.tsx` — новый тип `document_generation`, форма по паттерну `training_content` (`dg_access_mode`, `dg_allowed_package_ids`), маппинг load/save в `conditions`.
- `src/components/ai-documents/StrictDocumentTemplatesManager.tsx` или новый `AdminGlobalPackagesPanel.tsx` — CRUD глобальных пакетов без `code`/`slug`.
- `src/hooks/useDocumentPackages.ts` — `useGlobalDocumentPackages()` (admin) + `useUserVisibleDocumentPackages()` (RPC).
- `src/components/ai-documents/packages/PackagesWorkspace.tsx` — без логических изменений (RLS + cache key с user id).

### Артефакты

- `.lovable/proofs/document_packages_access_discovery.md` — фиксированный результат discovery (training_content модель + решение переиспользовать).

### НЕ трогаем

- `canonical-document-generate-strict`, edge-функции генерации, Gotenberg, sessions/participants.
- `access-resolver.ts` SOT-логику (только подключаем новый content type).
- Никакие `code`/`slug`/text-ключи не вводим.

---

## DoD

1. Новый пакет создаётся через UI **без** поля «Код»/«Slug». В БД у пакета нет технического ключа на основе названия.
2. Изменение `name` пакета **не ломает** доступ (доказательство: переименовать «Идеология» → «Идеология (v2)», правило продолжает действовать).
3. Access rule типа `document_generation` хранит `conditions.allowed_package_ids` **только как массив UUID** (SELECT-доказательство).
4. UI правил показывает названия пакетов **только как display label**, подтянутый по UUID.
5. Партиал-доступ к генерации документов работает по той же UX-схеме, что partial access у `training_content` (Полный/Частичный + multi-select).
6. Клиент с `allowed_package_ids=[UUID_X]` видит только пакет X.
7. Клиент без UUID X в `allowed_package_ids` НЕ видит пакет X.
8. Клиент с `access_mode='full'` (или legacy `section_access → document_generation`) видит все активные глобальные пакеты, включая только что созданный.
9. Admin/super_admin на `/admin/documents` видит все пакеты независимо от грантов.
10. `supabase--linter` — без новых критических ошибок.
11. Скриншоты клиентского и админского экранов приложены к отчёту.

---

## План проверки (порядок выполнения)

1. Зафиксировать discovery-документ.
2. Применить миграцию → дождаться regen `types.ts`.
3. Под admin создать пакет «Тест-X» (без поля «Код»).
4. Создать правило `document_generation`, `access_mode='partial'`, `allowed_package_ids=[UUID(Идеология)]` на продукте.
5. Войти под клиентом с этим продуктом (пароль `123456`) → `/document-generation` → виден только Идеология.
6. Переключить правило в `access_mode='full'` → клиент видит и Идеологию, и Тест-X.
7. Переименовать пакет → доступ сохраняется.
8. Прогнать `pg_policy` — новые политики на месте; legacy `section_access → document_generation` правила продолжают давать full access.