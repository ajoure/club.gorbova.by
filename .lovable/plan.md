План:

## Проблема (диагностика)

После soft-delete старых шаблонов + повторной загрузки новых в пакете «Годовое собрание участников»:

1. В таблице `document_package_template_items` остались **2 строки**, ведущие на soft-deleted шаблоны:
   - item `a1a40df2…` → tpl `682b16e8…` «1. Приказ … ООО» (`deleted_at` стоит)
   - item `652b2288…` → tpl `5b087851…` «2. Извещение …» (`deleted_at` стоит)
2. Bulk-delete из прошлой миграции не сработал на этих двух — они защищены FK `document_package_session_field_values.package_template_item_id` (`ON DELETE RESTRICT`); по ним 12 исторических значений анкеты тестовых сессий.
3. UI `TemplateBindingControl` (вкладка «Шаблоны пакета») делает свой запрос без `deleted_at IS NULL` и без join с `document_templates.deleted_at`, поэтому показывает эти 2 «зомби»-привязки со статусом `active` (статус самого шаблона), хотя шаблон уже удалён.
4. Счётчик «Шаблонов в пакете: 0» во вкладке «Генерация» — другой запрос, он фильтрует по deleted_at, поэтому видит 0, а соседняя вкладка — 2. Отсюда расхождение и впечатление «привязалось к старым данным».
5. Сессионные значения старой анкеты (`Анкета пакета сохранена ✓` + бэйджи «7/7», «6/6») всё ещё лежат в `document_package_session_field_values` для тех же зомби-items.

## DoD

- В пакете «Годовое собрание участников» (и любом другом) не остаётся ни одной строки `document_package_template_items`, ведущей на шаблон с `deleted_at IS NOT NULL`. Включая защищённые сессионными значениями.
- Старые тестовые значения этих сессий (`document_package_session_field_values` по удалённым items) физически удаляются — каскадом, не вручную.
- Вкладка «Шаблоны пакета» дополнительно фильтрует deleted-шаблоны в собственном запросе (defense-in-depth, на случай, если впредь кто-то снова попадёт в RESTRICT).
- Канонический write-path не меняется: bind/unbind по-прежнему через RPC `package_template_bind_template` / `package_template_unbind_template`; новых INSERT/UPDATE не добавляем.
- Сами `document_package_sessions` и `ai_generated_documents` не трогаем (исторические сессии остаются как audit trail, без обнулённых значений по удалённым items).

## Изменения

### 1. Миграция — single file

a) Сменить FK `document_package_session_field_values.package_template_item_id` с `ON DELETE RESTRICT` на `ON DELETE CASCADE`. Обоснование: если привязка шаблона удалена/отвязана, сессионные значения по ней теряют смысл — мы и сейчас не используем их в генерации, потому что шаблона нет.

```sql
ALTER TABLE public.document_package_session_field_values
  DROP CONSTRAINT document_package_session_field_va_package_template_item_id_fkey,
  ADD  CONSTRAINT document_package_session_field_va_package_template_item_id_fkey
    FOREIGN KEY (package_template_item_id)
    REFERENCES public.document_package_template_items(id)
    ON DELETE CASCADE;
```

b) Перезапустить бэкфилл (теперь сработает на 2 оставшихся):

```sql
DELETE FROM public.document_package_template_items i
WHERE i.template_id IN (
  SELECT id FROM public.document_templates WHERE deleted_at IS NOT NULL
);
```

c) Триггер `package_items_unbind_on_template_soft_delete` уже существует и работает корректно — оставляем как есть; убираем из него условие `NOT EXISTS … session_field_values`, так как CASCADE теперь сам подчищает значения. Перевыпускаем `CREATE OR REPLACE FUNCTION` без этого условия.

### 2. UI `src/components/ai-documents/packages/TemplateBindingControl.tsx`

В `boundQuery` после загрузки шаблонов отфильтровать привязки на удалённые шаблоны: добавить выбор поля `deleted_at` в select по `document_templates` и в финальном `.map`/`.filter` убрать те, у которых `tpl.deleted_at != null`. Это нужно как страховка; в норме после миграции таких записей не будет.

### 3. Memory

Тема узкая, новой памяти не требуется. Существующее правило «Canonical Write Path» не нарушено — мы только смягчаем каскад на чистку.

## Технические детали

- Файлы:
  - `supabase/migrations/<ts>_package_items_cascade_session_values.sql` — ALTER FK + DELETE + переcоздание trigger function (без NOT EXISTS).
  - `src/components/ai-documents/packages/TemplateBindingControl.tsx` — расширить select и .filter.
- После миграции инвалидация UI-кэша произойдёт автоматически при следующем переходе в пакет (React Query reload по mount).

## Проверка

1. `SELECT count(*) FROM document_package_template_items i JOIN document_templates t ON t.id=i.template_id WHERE t.deleted_at IS NOT NULL;` → 0.
2. `SELECT count(*) FROM document_package_session_field_values v LEFT JOIN document_package_template_items i ON i.id=v.package_template_item_id WHERE i.id IS NULL;` → 0 (каскад отработал).
3. В UI пакета «Годовое собрание участников» вкладка «Шаблоны пакета» становится пустой → ползунок «Привязать» работает для новых шаблонов; счётчики «Шаблонов в пакете» в «Генерация» и список во вкладке «Шаблоны пакета» совпадают.
4. Soft-delete любого шаблона из «Шаблоны документов» → строка в пакете и связанные session_field_values исчезают автоматически.
