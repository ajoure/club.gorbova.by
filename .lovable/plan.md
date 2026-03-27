# да, согласен, с учетом правок:

&nbsp;

1. В AiPageContent.tsx для templates и executors обязательно использовать Suspense с fallback того же контейнерного типа, чтобы не было пустого экрана и скачка layout при lazy-load.
2. В AdminDocumentTemplates.tsx и AdminExecutors.tsx сделать именно механический extraction 1:1: без изменения внутренних hooks, query keys, table state, modal state, handlers и mutation-логики.
3. В AiPageContent.tsx проверить, что тип SubTab реально расширен значениями "templates" и "executors", и добавить импорт FileStack, иначе будут типовые и runtime-ошибки.
4. В useAdminMenuSettings.tsx удаление executors и templates из DEFAULT_MENU и добавление их в DEPRECATED_ITEM_IDS выполнить одновременно в одном патче. Это обязательно, чтобы mergeMenuSettings не возвращал старые пункты после reload.
5. В DoD добавить отдельную проверку: /admin/ai → Документы → Шаблоны документов и /admin/ai → Документы → Исполнители не создают двойной AdminLayout и не ломают scroll/sticky header.

&nbsp;

&nbsp;

План: Перенести «Шаблоны документов» и «Исполнители» в секцию «Документы» на /admin/ai

## Изменяемые файлы (4 файла, только extraction + add-only)

### 1. `src/pages/admin/AdminDocumentTemplates.tsx`

- Выделить content (строки 187–467, всё между `<AdminLayout>` и `</AdminLayout>`) в `export function DocumentTemplatesContent()`
- Вся логика (state, hooks, handlers, dialogs) остаётся внутри `DocumentTemplatesContent`
- Default export становится thin wrapper:
  ```tsx
  export default function AdminDocumentTemplates() {
    return <AdminLayout><DocumentTemplatesContent /></AdminLayout>;
  }
  ```

### 2. `src/pages/admin/AdminExecutors.tsx`

- Выделить content (строки 359–847, всё между `<AdminLayout>` и `</AdminLayout>`) в `export function ExecutorsContent()`
- Вся логика остаётся внутри `ExecutorsContent`
- Default export становится thin wrapper:
  ```tsx
  export default function AdminExecutors() {
    return <AdminLayout><ExecutorsContent /></AdminLayout>;
  }
  ```

### 3. `src/components/ai-chat/AiPageContent.tsx`

- Расширить тип `SubTab`: добавить `"templates" | "executors"`
- Add-only в конец `DOC_SUB_TABS`:
  ```ts
  { id: "templates", label: "Шаблоны документов", icon: FileStack, ... }
  { id: "executors", label: "Исполнители", icon: Building2, ... }
  ```
- `DEFAULT_SUB.documents = "generate"` — без изменений
- Lazy-импорт content-компонентов (не default page!):
  ```ts
  const DocumentTemplatesContent = lazy(() =>
    import("@/pages/admin/AdminDocumentTemplates").then(m => ({ default: m.DocumentTemplatesContent }))
  );
  const ExecutorsContent = lazy(() =>
    import("@/pages/admin/AdminExecutors").then(m => ({ default: m.ExecutorsContent }))
  );
  ```
- В рендере секции documents (после строки 795) добавить:
  ```tsx
  {activeSubTab === "templates" && (
    <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <DocumentTemplatesContent />
    </Suspense>
  )}
  {activeSubTab === "executors" && (
    <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <ExecutorsContent />
    </Suspense>
  )}
  ```
- Добавить `Suspense` и `FileStack` в импорты (lazy уже есть в React)
- Guard-эффекты (строки 460-485) уже покрывают невалидный subtab — дополнительных правок не нужно

### 4. `src/hooks/useAdminMenuSettings.tsx`

- Удалить из `DEFAULT_MENU` → `service.items` строки 121-122:
  ```
  { id: "executors", ... }
  { id: "templates", ... }
  ```
- Добавить оба id в `DEPRECATED_ITEM_IDS` (строка 132-138):
  ```ts
  "executors",   // → /admin/ai → Документы → Исполнители
  "templates",   // → /admin/ai → Документы → Шаблоны документов
  ```

## Что НЕ меняется

- `AdminLayout.tsx`, `App.tsx` (маршруты `/admin/document-templates` и `/admin/executors` остаются)
- БД, RLS, edge functions
- `DEFAULT_SUB.documents`, существующие `generate` и `history` sub-tabs
- Бизнес-логика, query hooks, mutation handlers внутри обоих компонентов

## DoD

1. `/admin/ai` → «Документы» показывает 4 sub-tabs: Создать документ, История, Шаблоны документов, Исполнители
2. Sub-tabs рендерят тот же UI что и standalone-страницы
3. Sidebar больше не показывает «Шаблоны документов» и «Исполнители»
4. Standalone routes `/admin/document-templates` и `/admin/executors` работают 1:1
5. На `/ai` секция «Документы» скрыта (adminOnly)
6. `mergeMenuSettings` вычищает удалённые пункты из сохранённых настроек через `DEPRECATED_ITEM_IDS`
7. templates и executors внутри /admin/ai не ломают sticky header и scroll контейнер
8. Если раньше был активен старый/битый subtab в секции documents, guard автоматически сбрасывает на generate