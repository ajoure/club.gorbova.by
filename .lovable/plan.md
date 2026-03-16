# да, согласен, с учетом правок:

&nbsp;

1. **Это правильное направление.**
  Корень проблемы найден верно: clientSort поверх DB sort_order ломает предсказуемость ручного порядка. Пока существует UI-sort по имени/статусу, никакой reorder не будет стабильным.
2. **Сначала убрать конфликтующую сортировку, потом внедрять DnD.**
  Не делать “поверх старого”. Порядок выполнения:
  &nbsp;
  - убрать SortPill и clientSort для тарифов;
  - убедиться, что список уже идет строго по sort_order;
  - только потом включать drag-and-drop.
  &nbsp;
3. **Не создавать новый файл SortableTariffItem.tsx, если можно встроить это безопасно в текущий render-path.**
  Новый компонент допустим только если он реально нужен для чистоты кода. Иначе лучше не плодить сущности. Если создается — он должен быть thin-wrapper без новой логики данных.
4. **sort_order нужно нормализовать для всех тарифов продукта.**
  Ты сам отметил проблему с null. Добавь отдельный шаг:
  &nbsp;
  - если у части тарифов sort_order IS NULL или есть дубли/дырки,
  - сначала выполнить one-time normalize: 0,1,2,3... по текущему порядку,
  - и только после этого включать drag-and-drop.
    Иначе даже новый reorder может вести себя странно.
  &nbsp;
5. **Batch update — да, но нужен deterministic write.**
  useReorderTariffs должен сохранять полный новый порядок целиком, а не частично. После drop:
  &nbsp;
  - берется итоговый массив id в нужном порядке,
  - всем элементам назначается новый sort_order,
  - затем один reload/invalidates query.
    Не оставлять смешанный state.
  &nbsp;
6. **Нужен guard на click / selection / drag.**
  Правильно, что drag только через handle. Но явно зафиксируй:
  &nbsp;
  - клик по карточке открывает редактирование как раньше,
  - checkbox selection работает как раньше,
  - drag начинается только с handle,
  - случайный drag при обычном клике не должен происходить.
  &nbsp;
7. **Admin preview и public должны читать один и тот же порядок без дополнительной сортировки.**
  Это надо прямо записать в DoD:
  &nbsp;
  - admin list = sort_order ASC
  - admin preview = sort_order ASC
  - public = sort_order ASC
  - без сортировки по имени/статусу/created_at/display_order.
  &nbsp;
8. **display_order не использовать вообще для тарифов.**
  Если он остается в схеме — ок, но в этом домене он не должен больше участвовать ни в UI, ни в hook, ни в preview. Иначе конфликт вернется.
9. **PATCH A сюда не примешивать.**
  Правильно, что TariffCarouselGrid.tsx не трогаешь в этом патче. Этот PATCH должен быть только про ручной порядок тарифов.
10. **Добавь verify-шаг на publish/public mismatch.**
  Раз у тебя уже был кейс “в preview одно, на сайте другое”, после reorder надо проверить:

&nbsp;

&nbsp;

&nbsp;

- изменение видно в admin list,
- потом в admin preview,
- потом на public,
- и только после этого считать PATCH закрытым.

&nbsp;

&nbsp;

&nbsp;

11. **DoD надо усилить.**
  Добавь обязательные проверки:

&nbsp;

&nbsp;

&nbsp;

- список тарифов в админке больше не имеет SortPill/column sort;
- drag-and-drop меняет порядок предсказуемо;
- после refresh порядок не сбрасывается;
- после publish/public reload порядок тот же;
- тарифы с бывшим null sort_order теперь стабильны.

&nbsp;

&nbsp;

Итог: план хороший. Его уже можно отдавать в работу именно как **отдельный PATCH на ручной порядок через drag-and-drop с единственным source of truth = sort_order**.

&nbsp;

Plan: Replace Arrow Reorder with Drag-and-Drop + Remove Conflicting Sorts

## Root Cause Identified

**Line 144** in `AdminProductDetailV2.tsx`:

```
const sortedTariffs = useMemo(() => clientSort(tariffs || [], tariffSort.sortKey, tariffSort.sortDirection), ...)
```

The `SortPill` buttons (lines 743-745) for "Имя" and "Статус" apply a **client-side sort** that overrides the `sort_order` from the database. When a user clicks ↑/↓, the swap mutates `sort_order` in DB, but the UI re-renders through `clientSort` which may reorder by name/status — making the arrows appear non-deterministic.

Additionally, the ↑/↓ buttons use `(tariff as any).sort_order ?? idx` which falls back to array index when `sort_order` is null — this creates unpredictable swaps if any tariff has a null `sort_order`.

## Solution

### 1. Remove conflicting sort UI for tariffs

**File**: `src/pages/admin/AdminProductDetailV2.tsx`

- **Remove** `SortPill` for tariffs (lines 743-745) — tariff order must only come from `sort_order`
- **Remove** `tariffSort` usage from `useTableSort` (line 116)
- **Change** `sortedTariffs` (line 144) to simply use `tariffs || []` directly (already sorted by `sort_order ASC` from `useTariffs` hook)
- **Remove** ↑/↓ arrow buttons (lines 769-784)

### 2. Add drag-and-drop reorder with @dnd-kit

**File**: `src/pages/admin/AdminProductDetailV2.tsx`

- Wrap the tariff list in `DndContext` + `SortableContext` from `@dnd-kit/core` and `@dnd-kit/sortable`
- Each tariff item becomes a `SortableItem` using `useSortable` hook — the drag handle replaces the old ↑/↓ buttons area
- On `onDragEnd`: recalculate `sort_order` values (simple sequential: 0, 1, 2, ...) and save all via a new batch mutation

**File**: `src/hooks/useProductsV2.tsx`

- **Replace** `useSwapTariffOrder` with `useReorderTariffs` — a mutation that accepts an array of `{id, sort_order}` and updates all in one go
- This eliminates the two-step swap race condition

### 3. Sortable tariff item component

**New file**: `src/components/admin/product/SortableTariffItem.tsx`

- Wraps each tariff row with `useSortable` from `@dnd-kit/sortable`
- Provides a drag handle (grip icon) in place of the old ↑/↓ buttons
- Preserves existing checkbox selection, click-to-edit, and `TariffCardCompact` rendering

### 4. Selection interaction guard

The existing `useDragSelect` (mouseDown-based rectangular selection) could conflict with dnd-kit's drag. Solution: use a dedicated drag handle (grip icon) so the card body remains available for click/selection. dnd-kit's `useSortable` with `activationConstraint: { distance: 5 }` on `PointerSensor` prevents accidental drags.

## Files Changed


| File                                                  | Change                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/admin/AdminProductDetailV2.tsx`            | Remove SortPill for tariffs, remove tariffSort, remove ↑/↓ buttons, wrap tariff list in DndContext/SortableContext, use new SortableTariffItem |
| `src/hooks/useProductsV2.tsx`                         | Replace `useSwapTariffOrder` with `useReorderTariffs` (batch update)                                                                           |
| `src/components/admin/product/SortableTariffItem.tsx` | New component: sortable wrapper with drag handle + existing TariffCardCompact                                                                  |


## Not Changed

- TariffCard, TariffCardCompact — no modifications
- Offers, checkout, payment, access logic — untouched
- Public pages / edge functions — already use `sort_order ASC`
- `TariffCarouselGrid.tsx` — no changes (PATCH A already applied)
- Admin preview (line 1162-1178) — already uses `tariffs` from `useTariffs` which sorts by `sort_order`