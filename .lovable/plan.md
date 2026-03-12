# План: Исправление скролла + Унификация карточек (v3 — финальный)

---

## Фаза 1: Исправление вертикального скролла (4 замены)

### Проблема
Внутренние контейнеры диалогов используют `max-h-full overflow-y-auto`, но родитель `DialogContent` задаёт только `max-height` (без явного `height`). CSS `max-height: 100%` от элемента без фиксированной `height` = `auto` → `overflow-y-auto` не срабатывает → контент обрезается `overflow-hidden` на `DialogContent`.

### Целевая формула (зафиксировано)
- **DialogContent**: `overflow-hidden p-0 bg-background` (без `max-h-*`) — уже так везде ✅
- **Внутренний wrapper**: `max-h-[calc(100dvh-4rem)] overflow-y-auto overflow-x-hidden scrollbar-none p-4 sm:p-6`
- Формула `-4rem` = padding p-4 (1rem×2) + визуальный запас (~1rem×2). Везде одинаково, без исключений.

### Точные места замены (4 штуки)

| # | Файл | Строка | Контекст | Замена |
|---|-------|--------|----------|--------|
| 1 | `AdminProductDetailV2.tsx` | **793** | Tariff Dialog wrapper | `max-h-full` → `max-h-[calc(100dvh-4rem)]` |
| 2 | `AdminProductDetailV2.tsx` | **937** | Offer Dialog wrapper | `max-h-full` → `max-h-[calc(100dvh-4rem)]` |
| 3 | `AdminProductDetailV2.tsx` | **1708** | Flow Dialog wrapper | `max-h-full` → `max-h-[calc(100dvh-4rem)]` |
| 4 | `AdminProductsV2.tsx` | **655** | Create/Edit Product Dialog wrapper | `max-h-full` → `max-h-[calc(100dvh-4rem)]` |

**Не требуют изменений (не трогаем):**
- Delete Confirmation Dialog (строка 1798) — маленький диалог, контент не переполняется
- Dry-run reasons list (строка 772) — фиксированная `max-h-40`, работает корректно

---

## Фаза 2: Унификация карточек + bulk-действия

### 2.0 STOP-GUARD
Фаза 2 = **UI-only**. Новых хуков, миграций, RPC не создаём. В bulk используем напрямую `updateX.mutateAsync` / `deleteX.mutateAsync`; invalidate уже есть по prefix (как сейчас).

### 2.1 Аудит существующих мутаций (всё есть ✅)

| Сущность | Update (is_active) | Delete | Тип delete | Confirm dialog | Каскады |
|----------|-------------------|--------|------------|----------------|---------|
| **Tariff** | `useUpdateTariff` → `.update({is_active})` ✅ | `useDeleteTariff` → `.delete()` ✅ | **Hard** | Общий `deleteConfirm` state | FK cascade → удаляет офферы тарифа |
| **Offer** | `useUpdateTariffOffer` → `.update({is_active})` ✅ | `useDeleteTariffOffer` → `.delete()` ✅ | **Hard** | Общий `deleteConfirm` | Нет каскадов |
| **Flow** | `useUpdateFlow` → `.update({is_active})` ✅ | `useDeleteFlow` → `.delete()` ✅ | **Hard** | Общий `deleteConfirm` | Нет каскадов |

### 2.2 Bulk-действия

**Bulk activate/deactivate:** `Promise.all(ids.map(id => updateX.mutateAsync({ id, is_active: true/false })))`

**Bulk delete:**
- Нажатие «Удалить (N)» → **один** confirm dialog: «Удалить N элементов?»
- По confirm → `Promise.all(ids.map(id => deleteX.mutateAsync(id)))`
- Старый `setDeleteConfirm({type, id})` остаётся для одиночных 🗑 кнопок

**Новых хуков не создаём; invalidate уже есть по prefix.**

### 2.3 Сортировка (клиентская, в памяти)

**Источник:** `useTableSort` по уже загруженным массивам через `useQuery`. Без refetch, без query params.

| Вкладка | Поля сортировки |
|---------|----------------|
| Тарифы | `name`, `is_active` (статус) |
| Кнопки оплаты | `amount`, `offer_type` (без `tariff_name` — группировка по тарифам уже задаёт порядок) |
| Потоки | `name`, `start_date`, `is_active` |

### 2.4 Выделение / drag-select

Копируем usage из `AdminProductsV2` и применяем к карточкам. Контракт хука — как уже реализован в `useDragSelect`:

```tsx
const tariffSelect = useDragSelect({ items: tariffs, getItemId: t => t.id });
const offerSelect = useDragSelect({ items: allOffers, getItemId: o => o.id });
const flowSelect = useDragSelect({ items: flows, getItemId: f => f.id });
```

**3 независимых инстанса** — по одному на вкладку.

**DoD выделения:**
- ☐ Клик по чекбоксу — toggle одного элемента
- ☐ Ctrl/Cmd + клик — additive toggle
- ☐ Shift + клик — range select
- ☐ Drag-select (зажатие и протягивание) — выделение прямоугольником
- ☐ «Выбрать все» чекбокс — выделяет все элементы текущей вкладки
- ☐ Переключение вкладки — не сбрасывает выделение других вкладок

### 2.5 Поведение клика по карточке

**Клик → открыть edit dialog** (единообразно для всех):
- Тариф → `setTariffDialog({ open: true, editing: tariff })`
- Оффер → `setOfferDialog({ open: true, editing: offer })`
- Поток → `setFlowDialog({ open: true, editing: flow })`
- `stopPropagation` на: checkbox, кнопки (edit, delete, switch, copy)

### 2.6 Группировка офферов

Сохраняем группировку заголовком тарифа (**не selectable**, без чекбокса):

```
[Select All] [SortPill: Сумма] [SortPill: Тип]

─── Тариф «Базовый» (заголовок, не selectable) ───
  ☐ Оплатить  1500 BYN  pay_now  ★Основная  🔛 ✎ 🗑
  ☐ Попробовать  1 BYN  trial  ✎ 🗑

─── Тариф «Продвинутый» ───
  ☐ Оплатить  3000 BYN  pay_now  ★Основная  🔛 ✎ 🗑
```

- Группы тарифов идут в порядке `tariff.name` (алфавитно)
- Внутри каждой группы офферы сортируются по выбранному SortPill (amount / offer_type)
- SortPill «Тариф» **убран** — при фиксированной группировке он бессмысленен
- «Выбрать все» выделяет только офферы, не заголовки

### 2.7 SortPill — вынос в компонент

**Файл:** `src/components/admin/SortPill.tsx`

**API:**
```tsx
interface SortPillProps {
  label: string;
  sortKey: string;
  currentSortKey: string | null;
  currentSortDirection: SortDirection;
  onSort: (key: string) => void;
}
```

**DoD:** `AdminProductsV2` импортирует из нового файла, сортировка продуктов (Имя/Сайт/Статус) не ломается.

---

## Файлы

| Файл | Действие |
|------|----------|
| `src/components/admin/SortPill.tsx` | **Создать** |
| `src/pages/admin/AdminProductsV2.tsx` | Импорт SortPill, фикс скролла (строка 655), удалить inline SortPill |
| `src/pages/admin/AdminProductDetailV2.tsx` | Фикс скролла (3 строки), карточки + bulk для tariffs/offers/flows |

## DoD (Definition of Done)

### Фаза 1
- ☐ Вертикальный скролл работает во всех 4 диалогах (tariff, offer, flow, product) на 390×844
- ☐ Контент не обрезается, все поля доступны
- ☐ Scrollbar track не виден (scrollbar-none)

### Фаза 2
- ☐ Карточки тарифов/офферов/потоков визуально идентичны ProductCard
- ☐ SortPill вынесен, сортировка продуктов не сломана
- ☐ Сортировка на каждой вкладке работает с индикацией направления
- ☐ Выделение: click, ctrl/cmd toggle, shift-range, drag-select, select-all — на каждой вкладке (3 независимых стора)
- ☐ Bulk Actions Bar: Активировать / Деактивировать / Удалить (один confirm dialog для bulk delete)
- ☐ Клик по карточке → edit dialog (единообразно)
- ☐ Группировка офферов: заголовки тарифов не selectable, сортировка внутри групп
- ☐ Нет горизонтального скролла: Тарифы/Офферы/Потоки на 390px, 768px, 1024px — все action-кнопки доступны
