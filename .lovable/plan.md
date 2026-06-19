План:

## Проблема (диагностика)

Скриншот «Шаблоны пакета» в пакете «Годовое собрание участников» показывает 7 элементов, из которых #1–#3 — это привязки к soft-deleted шаблонам:

```
#1 1. Приказ … ООО         tpl 682b16e8…  deleted_at 2026-06-19 12:35:54
#2 0. Приказ … инструкция  tpl aec8c851…  deleted_at 2026-06-19 12:35:56
#3 2. Извещение …          tpl 5b087851…  deleted_at 2026-06-19 12:35:59
#4 0. Приказ … инструкция  tpl 17c3105e…  активный (новый)
#5 1. Приказ … ООО         tpl a1934ddb…  активный (новый, draft)
#6 1. Приказ … (без ООО)   tpl fe2262c0…  активный
#7 2. Извещение …          tpl f8e2d8be…  активный (новый)
```

Причина: `document_templates` использует soft-delete (`deleted_at`), а `document_package_template_items.template_id` имеет FK `ON DELETE RESTRICT` и не реагирует на soft-delete. Поэтому при удалении и пересоздании шаблона старые привязки остаются в пакете и в UI выглядят как дубликаты.

## DoD

- При soft-delete шаблона (`document_templates.deleted_at = now()`) все строки `document_package_template_items.template_id = <tpl>` удаляются автоматически на уровне БД.
- В существующих пакетах не остаётся ни одной привязки на soft-deleted шаблон (одноразовый бэкфилл).
- UI «Шаблоны пакета» отдаёт только привязки, у которых базовый шаблон не удалён (defense-in-depth).
- Канонический write-path не трогается: write-операции остаются через текущие хуки/UI; новая логика только удаляет битые ссылки.

## Изменения

### 1. Миграция (single file)

a) Trigger `trg_package_items_unbind_on_template_soft_delete` на `document_templates AFTER UPDATE`:
   - если `OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL` → `DELETE FROM document_package_template_items WHERE template_id = NEW.id`.
   - SECURITY DEFINER, `SET search_path = public`.
   - Каскадно (через существующий FK CASCADE) подчистятся `document_package_item_field_assignments` и `document_package_item_role_assignments`. Сессионные значения (`document_package_session_field_values`) остаются (FK RESTRICT) — они исторические; ни сессии, ни сгенерированные документы не трогаем.

b) Бэкфилл одноразово: `DELETE FROM document_package_template_items WHERE template_id IN (SELECT id FROM document_templates WHERE deleted_at IS NOT NULL);` — это уберёт ровно те 3 «исторических» элемента из скриншота (и любые аналогичные в других пакетах).

c) Если бэкфилл наткнётся на ON DELETE RESTRICT от `document_package_session_field_values` — выполнить delete в two-step: сперва обнулить ссылку или пропустить items, у которых уже есть session-values (защита истории). Реализовать через `WHERE NOT EXISTS (SELECT 1 FROM document_package_session_field_values v WHERE v.package_template_item_id = i.id)`. Для остальных оставить — в UI они всё равно будут скрыты фильтром (см. п.2).

### 2. UI hook `src/hooks/useDocumentPackages.ts`

В `useDocumentPackageItems` после join с `document_templates` фильтровать `item.template_deleted === true` из возвращаемого массива (всё ещё помечать «(удалён)» нам не нужно — таких просто не будет). Это нужно как страховка для пакетов, где session-values заблокировали удаление в бэкфилле.

Никаких других файлов не правим. Канонический generate-strict / package-tokens resolver / sessions не трогаем.

## Технические детали

- Файлы:
  - `supabase/migrations/<ts>_package_items_auto_unbind.sql` — функция + триггер + бэкфилл.
  - `src/hooks/useDocumentPackages.ts` — добавить `.filter(i => !i.template_deleted)` перед `return` в `useDocumentPackageItems`.
- Аудит: добавить `RAISE NOTICE` в триггер не требуется — есть существующий `trg_audit_package_template_items` на DELETE, он зафиксирует автокаскад.
- Memory: тема узкая, новой записи в `mem://` не требуется.

## Проверка

После применения миграции:
1. `SELECT count(*) FROM document_package_template_items i JOIN document_templates t ON t.id=i.template_id WHERE t.deleted_at IS NOT NULL;` → 0 (или равно числу items, защищённых session-values; их UI скроет).
2. В UI пакета «Годовое собрание участников» останутся только #4–#7 (новые шаблоны), номера пересчитаются автоматически (`sort_order` уже разный — список покажется как 1..4).
3. Soft-delete любого шаблона из «Шаблоны документов» → запись в пакете пропадает без ручного «Отвязать».
