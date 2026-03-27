# да, согласен, с учетом правок:

&nbsp;

1. В AdminDocumentTemplates.tsx при embedded=true убрать не только H1/description, но и лишний верхний вертикальный зазор над TabsList, чтобы строка внутренних вкладок поднималась вплотную к общему блоку sub-tabs /admin/ai → Документы. Нужен единый верхний offset, без второй «ступеньки».
2. Кнопку Добавить шаблон во встроенном режиме оформить не как обычную page-action вне контекста, а как CTA той же строки управления, на одном baseline с TabsList, справа, без лишнего внешнего контейнера и без увеличения высоты строки.
3. В AdminExecutors.tsx при embedded=true убрать не только stats-card’ы, но и любые дополнительные page-level section wrappers, которые создают ощущение отдельной страницы внутри вкладки. Должна остаться только верхняя строка управления + стандартная таблица.
4. Для ExecutorsContent во встроенном режиме кнопку Добавить выровнять по той же схеме, что и в шаблонах: справа в верхней строке управления, на одном уровне с контентом вкладки, без отдельного hero/header блока.
5. В обоих компонентах embedded=true не должен ломать standalone-маршруты визуально и по spacing. Нужен явный split:
  &nbsp;
  - embedded=false → текущее page-layout поведение 1:1
  - embedded=true → компактный tab-layout без page-header/summary
  &nbsp;
6. В AiPageContent.tsx передавать embedded только для render внутри /admin/ai. Standalone routes /admin/document-templates и /admin/executors оставить на default embedded=false без дополнительных изменений.
7. DoD дополнить:
  &nbsp;
  - во вкладке Шаблоны документов нет дублирующего page-title и нет лишнего верхнего gap;
  - во вкладке Исполнители таблица начинается сразу после компактной строки управления;
  - обе встроенные вкладки визуально выглядят как часть одной admin-AI страницы, а не как вложенные отдельные страницы;
  - standalone страницы визуально не изменились 1:1.
  &nbsp;

&nbsp;

&nbsp;

План: Убрать дублирующие заголовки и метрики, унифицировать layout вкладок «Шаблоны документов» и «Исполнители» внутри /admin/ai

## Подход

Добавить prop `embedded?: boolean` в оба content-компонента. Когда `embedded=true` (из AiPageContent), скрывать заголовки, метрики и менять layout. Standalone-маршруты продолжают работать как есть (`embedded` по умолчанию `false`).

## Изменяемые файлы

### 1. `src/pages/admin/AdminDocumentTemplates.tsx`

`DocumentTemplatesContent` получает prop `embedded?: boolean`.

Когда `embedded=true`:

- **Убрать** блок H1 + description (строки 187-193)
- **Убрать** `container mx-auto py-6 space-y-6` обёртку → заменить на `space-y-2`
- **Перестроить** строку вкладок: `TabsList` + кнопка «Добавить шаблон» в одном `flex` row:
  ```tsx
  <div className="flex items-center justify-between gap-2">
    <TabsList>...</TabsList>
    <Button size="sm" onClick={handleOpenDialog}>
      <Plus /> Добавить шаблон
    </Button>
  </div>
  ```
- Когда `embedded=false` (default) — всё как сейчас, standalone не ломается

### 2. `src/pages/admin/AdminExecutors.tsx`

`ExecutorsContent` получает prop `embedded?: boolean`.

Когда `embedded=true`:

- **Убрать** блок H1 + description (строки 360-366)
- **Убрать** stats-карточки «Всего / Активных / По умолчанию» (строки 376-406)
- **Убрать** `space-y-6` → заменить на `space-y-2`
- Кнопка «Добавить» переносится в верхнюю строку управления:
  ```tsx
  <div className="flex items-center justify-end gap-2">
    {canEdit && <Button size="sm" onClick={handleOpenDialog}>
      <Plus /> Добавить
    </Button>}
  </div>
  ```
- Badge «По умолчанию» в строке таблицы **уже есть** (строки 434-438) — ничего добавлять не нужно
- Когда `embedded=false` — всё остаётся как есть

### 3. `src/components/ai-chat/AiPageContent.tsx`

Передать `embedded` prop при рендере:

```tsx
<LazyDocumentTemplatesContent embedded />
<LazyExecutorsContent embedded />
```

## Что НЕ меняется

- Бизнес-логика, hooks, handlers, модалки, mutation logic
- Standalone маршруты `/admin/document-templates` и `/admin/executors`
- `AdminLayout.tsx`, `App.tsx`, `useAdminMenuSettings.tsx`
- БД, RLS, edge functions

## DoD

1. Во вкладке «Шаблоны документов» нет дублирующего H1/description
2. Кнопка «Добавить шаблон» находится в строке внутренних вкладок справа
3. Во вкладке «Исполнители» нет summary-card'ов
4. Исполнитель по умолчанию помечен badge в строке таблицы (уже есть)
5. Обе вкладки визуально выровнены: минимальные отступы сверху, CTA справа в управляющей строке
6. Standalone маршруты визуально и функционально не изменились