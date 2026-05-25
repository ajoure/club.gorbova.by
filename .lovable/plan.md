## да, согласен, с учетом правок:

1. **Заголовок привести к обязательному формату**
  &nbsp;
  Сейчас указано `## План: ...`. Нужно:
  `План: Вкладка «Документы» → подвкладка «Идеология» на /document-generation`
2. **Добавить обязательный блок языка для Lovable**
  &nbsp;
  В начало плана добавить:
  План должен быть составлен на русском языке.  
  Отчет о выполненной работе должен быть составлен на русском языке.  
  Вся переписка, пояснения, diff-summary, proof и результаты должны быть только на русском языке.
3. **Явно зафиксировать UI-only / reuse-only scope**
  &nbsp;
  Добавить:
  Это frontend-only patch. Новые таблицы, RPC, edge-functions, RLS, Supabase-типы, новый pipeline генерации, новый token registry, новый template picker и новый компонент списка шаблонов не создаются. Используется существующий `StrictDocumentTemplatesManager` с параметрами фильтрации.
4. **Не смешивать** `documents` **и** `doc-packages` **семантически**
  &nbsp;
  Добавить пояснение:
  - `documents` — существующая админская секция управления шаблонами/плейсхолдерами/историей/исполнителями.
  - `doc-packages` — новая пользовательская секция пакетов документов внутри `/document-generation`.
  - Названия не должны конфликтовать в `SECTIONS`, `DEFAULT_SUB`, `hiddenSections`, analytics/state.
5. `categoryFilter` **нельзя использовать как произвольную строку без константы**
  &nbsp;
  Добавить константу:
  ```ts
  const DOCUMENT_PACKAGE_CATEGORIES = {
    ideology: "ideology",
  } as const;
  ```
  И использовать её в `AiPageContent`, чтобы не плодить строковые литералы.
6. **Загрузка шаблонов: проверить текущий query chain**
  &nbsp;
  Перед правкой добавить read-only discovery:
  - где именно формируется query к `document_templates`;
  - есть ли сортировка;
  - есть ли join/загрузка versions отдельным запросом;
  - где insert нового шаблона;
  - где создаётся новая версия;
  - есть ли `category` только у `document_templates` или также у версий.
7. **Уточнить поведение** `/admin/documents`
  &nbsp;
  В DoD пункт 3 сейчас противоречивый:
  загруженный через «Идеология» не светится в `/admin/documents`, пока admin не снимет фильтр
  Но выше сказано, что `/admin/documents` фильтр не передаёт и отображает все шаблоны как прежде. Значит шаблон с `category='ideology'` **должен отображаться в** `/admin/documents → Шаблоны документов`, потому что админка плоская и без фильтра.
  Исправить DoD:
  Загруженный через `/document-generation → Документы → Идеология` `.docx` получает `category='ideology'`, отображается в пакете «Идеология» и также виден в `/admin/documents → Шаблоны документов`, так как админка пока остаётся общим плоским списком всех шаблонов.
8. `embedded` **должен скрывать только лишнюю оболочку, но не ломать действия**
  &nbsp;
  Уточнить:
  - `embedded=true` может менять заголовок/отступы/карточную оболочку;
  - не должен отключать upload, preview, validation, `FileNameTemplateEditor`, activation/delete actions;
  - если какие-то admin-only действия внутри менеджера завязаны на роль, они остаются под текущими RBAC-guard.
9. **Права доступа на пользовательскую загрузку шаблонов проверить отдельно**
  &nbsp;
  В плане сейчас предполагается, что пользователь сможет загрузить `.docx` через `/document-generation`. Нужно добавить discovery/guard:
  - проверить, разрешены ли эти операции обычному user;
  - если upload/insert шаблонов сейчас admin-only — не расширять права в рамках этого патча;
  - в таком случае для user показывать read-only список или стандартный permission-state, а загрузку оставить админам.
  Это критично: UI-only patch не должен менять RLS/edge/RBAC.
10. **Insert** `category=categoryFilter` **применять только к template, не к version, если version не имеет category**

Добавить:

При создании нового шаблона category записывается только в `document_templates.category`, если именно эта таблица является SoT категории. Не добавлять category в versions/storage/meta без discovery.

11. **Добавить fallback при пустой категории**

Если `categoryFilter="ideology"` вернул 0 строк, empty-state должен быть понятным:

В пакете «Идеология» пока нет шаблонов документов.

Но не создавать отдельный empty-state компонент, если можно передать `title/subtitle` или использовать существующий.

12. **Расширение** `SubTab` **сделать без поломки существующих секций**

Добавить проверку:

- `DEFAULT_SUB["doc-packages"] = "pkg-ideology"` добавляется без изменения default для `ai`, `documents`, `requisites`;
- при смене `activeSection` должен корректно сбрасываться/подбираться `activeSubTab`;
- `hiddenSections` не должен оставлять активной скрытую секцию.

13. **STOP-guards**

Добавить:

- STOP, если для `categoryFilter` требуется миграция БД или изменение Supabase types.
- STOP, если обычный user не имеет прав на upload/insert, а задача требует сделать загрузку доступной без изменения RBAC.
- STOP, если `StrictDocumentTemplatesManager` невозможно безопасно embedded-переиспользовать без разделения бизнес-логики.
- STOP, если правка требует менять edge-functions/validator/storage policies.
- STOP, если `/admin/documents` начинает показывать только `ideology` вместо всех шаблонов.

14. **DoD дополнить проверкой обратной совместимости**

Добавить:

- `/admin/documents → Шаблоны документов` без `categoryFilter` показывает все категории.
- Создание/валидация/активация/удаление шаблона в админке работает как раньше.
- `/document-generation → Реквизиты` остались доступными соседней вкладкой.
- `/document-generation` по умолчанию открывает `Документы → Идеология`.
- При пустом списке `ideology` нет ошибки, показывается корректный empty-state.

15. **Финальный отчет должен содержать proof**

Добавить в DoD отчета:

- список изменённых файлов;
- diff-summary;
- подтверждение, что БД/RLS/RPC/edge-functions/types не менялись;
- скрин `/document-generation → Документы → Идеология`;
- скрин `/document-generation → Реквизиты`;
- скрин `/admin/documents → Шаблоны документов`, где общий список не сломан;
- proof, что загруженный/созданный через пакет шаблон получает `category='ideology'`, если права позволяют upload.

Главная правка: **админка без фильтра должна видеть все шаблоны, включая** `ideology`, иначе это уже изменение поведения `/admin/documents`, которого план сам запрещает.

&nbsp;

План: вкладка «Документы» → подвкладка «Идеология» на /document-generation

### Цель

На странице `/document-generation` слева от вкладки «Реквизиты» добавить новую секцию верхнего уровня **«Документы»**. Внутри — подвкладки-пакеты документов; первый пакет — **«Идеология»**. Содержимое каждого пакета — список шаблонов в том же визуальном стиле, что уже реализован в `StrictDocumentTemplatesManager` (раскрывающийся список из `/admin/documents → Шаблоны документов`). Никаких новых компонентов списка не создаём — только переиспользуем существующий с фильтром по категории.

### Что меняется (только фронт)

**1. `src/components/ai-documents/StrictDocumentTemplatesManager.tsx**`

- Расширить props:
  ```ts
  { embedded?: boolean; categoryFilter?: string | null; title?: string; subtitle?: string }
  ```
- В `loadTemplates()` добавить `.eq("category", categoryFilter)` только если `categoryFilter` задан. Поведение без пропса — без изменений (обратная совместимость для `/admin/documents`).
- При загрузке нового `.docx` через эту обёртку — проставлять `category = categoryFilter` в insert (если задан), чтобы новые шаблоны сразу попадали в пакет.
- Опционально подменять заголовок «Шаблоны документов» на `title` (для «Идеология»).

**2. `src/components/ai-chat/AiPageContent.tsx**`

- Добавить новую секцию в `Section` тип и в `SECTIONS`:
  ```ts
  { id: "doc-packages", label: "Документы", icon: FileStack }
  ```
  Порядок в `SECTIONS`: `ai`, `documents`, `doc-packages`, `requisites`. На `/document-generation` секции `ai` и `documents` уже скрыты через `hiddenSections`, поэтому пользователь увидит слева от «Реквизиты» именно «Документы» (это `doc-packages`).
- Добавить новый массив подвкладок-пакетов `PACKAGE_SUB_TABS`:
  ```ts
  [{ id: "pkg-ideology", label: "Идеология", icon: FileText, … }]
  ```
- Расширить `SubTab` типом `"pkg-ideology"` и `DEFAULT_SUB["doc-packages"] = "pkg-ideology"`.
- В рендере при `activeSection === "doc-packages" && activeSubTab === "pkg-ideology"` отрисовать:
  ```tsx
  <StrictDocumentTemplatesManager
    embedded
    categoryFilter="ideology"
    title="Пакет «Идеология»"
  />
  ```

**3. `src/pages/DocumentGeneration.tsx**`

- Сменить `initialSection` с `"requisites"` на `"doc-packages"`, оставить `hiddenSections={["ai","documents"]}`. «Реквизиты» остаются доступными как соседняя вкладка справа.

### Что НЕ трогаем

- БД (`document_templates.category` уже есть как `text`, миграции не нужны).
- Edge functions, RLS, типы Supabase.
- `/admin/documents` (старая секция «Документы» с подвкладками Плейсхолдеры/Шаблоны/История/Исполнители) — работает как раньше, потому что `categoryFilter` там не передаётся.
- `ColumnSettings`, таблицы реквизитов, бизнес-логику генерации, snapshot, audit.

### Diagnose → Dry run

- `loadTemplates` сейчас читает все строки `document_templates`. С фильтром `.eq('category','ideology')` на текущей БД вернёт 0 строк → пустое состояние (`empty-state` уже отрисовывается компонентом). Это и есть «подготовленная почва»: загруженные через эту вкладку `.docx` лягут с `category='ideology'` и сразу появятся в списке.
- Активация/валидация/удаление шаблонов остаются на текущих edge functions — никаких изменений контракта.

### DoD

1. На `/document-generation` слева от «Реквизиты» видна вкладка **«Документы»** с подвкладкой **«Идеология»**.
2. Содержимое подвкладки — тот же визуальный список с раскрытием и `FileNameTemplateEditor`, что и в `/admin/documents → Шаблоны документов`.
3. Загруженный через эту подвкладку `.docx` появляется только в «Идеология» (category=ideology) и не светится в `/admin/documents`, пока admin не снимет фильтр (поведение ожидаемое: пакет = категория).
4. `/admin/documents` отображает все шаблоны как прежде.
5. Мобильная вёрстка не ломается (используются уже починенные ранее `flex-col sm:flex-row`, `min-w-0`, `table-scroll-x`).
6. Никаких новых таблиц/RPC/edge functions/типов.

### Открытый вопрос (по умолчанию решаю «нет», если не возражаете)

Делать ли `/admin/documents → Шаблоны документов` тоже разрезанным на пакеты-вкладки сейчас? По вашему сообщению — нет, только «подготовить почву» в пользовательской `/document-generation`. Админка остаётся плоской.