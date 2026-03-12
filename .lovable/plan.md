# План: Исправление скролла + Унификация карточек (v2 — финальный)

---

## Фаза 1: Исправление вертикального скролла

### Проблема
Внутренние контейнеры диалогов используют `max-h-full overflow-y-auto`, но родитель `DialogContent` задаёт только `max-height` (без явного `height`). CSS `max-height: 100%` от элемента без фиксированной `height` = `auto` → `overflow-y-auto` не срабатывает → контент обрезается `overflow-hidden` на `DialogContent`.

### Целевая формула
`max-h-[calc(100dvh-2rem)]` — идентична стандарту из memory `global-dialog-standards-v2`. Внутренний padding `p-4 sm:p-6` входит в скроллируемый контент (Variant A), header/footer — тоже внутри scroll-контейнера, поэтому вычитаем только отступ самого `DialogContent` от edges viewport.

### Точные места замены (4 реальных замены)

| # | Файл | Строка | Контекст | Замена |
|---|-------|--------|----------|--------|
| 1 | `AdminProductDetailV2.tsx` | **793** | Tariff Dialog: `max-h-full overflow-y-auto` | `max-h-full` → `max-h-[calc(100dvh-2rem)]` |
| 2 | `AdminProductDetailV2.tsx` | **937** | Offer Dialog: `max-h-full overflow-y-auto` | `max-h-full` → `max-h-[calc(100dvh-2rem)]` |
| 3 | `AdminProductDetailV2.tsx` | **1708** | Flow Dialog: `max-h-full overflow-y-auto` | `max-h-full` → `max-h-[calc(100dvh-2rem)]` |
| 4 | `AdminProductsV2.tsx` | **655** | Create/Edit Product Dialog: `max-h-full overflow-y-auto` | `max-h-full` → `max-h-[calc(100dvh-2rem)]` |

**Не требуют изменений:**
- Delete Confirmation Dialog (строка 1798) — маленький диалог, контент не переполняется
- Dry-run reasons list (строка 772) — фиксированная `max-h-40`, работает корректно

---

## Фаза 2: Унификация карточек + bulk-действия

### 2.1 Аудит существующих мутаций

| Сущность | Update (is_active) | Delete | Тип delete | Confirm dialog | Каскады |
|----------|-------------------|--------|------------|----------------|---------|
| **Tariff** | `useUpdateTariff` → `.update({is_active})` ✅ | `useDeleteTariff` → `.delete()` ✅ | **Hard** | Общий `deleteConfirm` state | FK cascade → удаляет офферы тарифа |
| **Offer** | `useUpdateTariffOffer` → `.update({is_active})` ✅ | `useDeleteTariffOffer` → `.delete()` ✅ | **Hard** | Общий `deleteConfirm` | Нет каскадов |
| **Flow** | `useUpdateFlow` → `.update({is_active})` ✅ | `useDeleteFlow` → `.delete()` ✅ | **Hard** | Общий `deleteConfirm` | Нет каскадов |

**Bulk-обёртки (новые, UI-only):**
- Bulk activate/deactivate: `Promise.all` по существующим `updateTariff/updateOffer/updateFlow`
- Bulk delete: `Promise.all` по существующим `deleteTariff/deleteOffer/deleteFlow` + confirm dialog
- **Новых миграций/RPC не нужно**

### 2.2 Сортировка

**Источник:** Клиентская сортировка через `useTableSort` (данные загружены целиком через `useQuery`).

| Вкладка | Поля сортировки |
|---------|----------------|
| Тарифы | `name`, `is_active` (статус) |
| Кнопки оплаты | `tariff_name`, `amount`, `offer_type` |
| Потоки | `name`, `start_date`, `is_active` |

### 2.3 Выделение / drag-select

`useDragSelect` работает через `registerItemRef(id, HTMLElement)` — не зависит от `<table>`.

**3 независимых инстанса** — по одному на вкладку (tariffs, offers, flows).

**DoD выделения:**
- ☐ Клик по чекбоксу — toggle одного элемента
- ☐ Ctrl/Cmd + клик — additive toggle
- ☐ Shift + клик — range select
- ☐ Drag-select (зажатие и протягивание) — выделение прямоугольником
- ☐ «Выбрать все» чекбокс — выделяет все элементы текущей вкладки
- ☐ Переключение вкладки — не сбрасывает выделение других вкладок

### 2.4 Поведение клика по карточке

**Вариант A: клик → открыть edit dialog** (единообразно для всех):
- Тариф → `setTariffDialog({ open: true, editing: tariff })`
- Оффер → `setOfferDialog({ open: true, editing: offer })`
- Поток → `setFlowDialog({ open: true, editing: flow })`
- `stopPropagation` на: checkbox, кнопки (edit, delete, switch, copy)

### 2.5 Группировка офферов

Сохраняем группировку заголовком тарифа (**не selectable**, без чекбокса):
```
[Select All] [SortPill: Тариф] [SortPill: Сумма] [SortPill: Тип]

─── Тариф «Базовый» (заголовок) ───
  ☐ Оплатить  1500 BYN  pay_now  ★Основная  🔛 ✎ 🗑
  ☐ Попробовать  1 BYN  trial  ✎ 🗑

─── Тариф «Продвинутый» ───
  ☐ Оплатить  3000 BYN  pay_now  ★Основная  🔛 ✎ 🗑
```

«Выбрать все» выделяет только офферы. Сортировка внутри групп.

### 2.6 SortPill — вынос в компонент

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
- ☐ Вертикальный скролл работает во всех 3 диалогах (tariff, offer, flow) на 390×844
- ☐ Скролл работает в диалоге создания/редактирования продукта
- ☐ Контент не обрезается, все поля доступны

### Фаза 2
- ☐ Карточки тарифов/офферов/потоков визуально идентичны ProductCard
- ☐ SortPill вынесен, сортировка продуктов не сломана
- ☐ Сортировка на каждой вкладке работает с индикацией направления
- ☐ Выделение: click, ctrl, shift, drag, select-all — на каждой вкладке (3 независимых стора)
- ☐ Bulk Actions Bar: Активировать / Деактивировать / Удалить
- ☐ Клик по карточке → edit dialog
- ☐ Группировка офферов с несортируемыми заголовками
- ☐ Нет горизонтального скролла на 390px, 768px, 1024px
