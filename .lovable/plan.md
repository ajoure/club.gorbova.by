План: восстановить горизонтальный И вертикальный скролл таблицы «Платежи» на мобильном/PWA

## Диагностика

После правок под PWA добавили жёсткое `overflow-x: hidden` на `html`, `body`, `#root` и `<main>` в `DashboardLayout`. Это убрало «выпирание» layout’а, но сломало внутренние скролл-контейнеры широких таблиц — горизонтальный свайп больше не работает.

Кроме того, у `PaymentsTable` контейнер строки 724 имеет `overflow-auto max-h-[600px]`. На мобильном:

1. Палец, начавший скролл внутри этого контейнера, «застревает»: iOS не передаёт жест родительской странице, когда внутренний контейнер достигает своего верха/низа (`overscroll-behavior: auto` по умолчанию + отсутствие `-webkit-overflow-scrolling: touch` → нет momentum, скролл «замирает»).
2. На viewport 518×940 высота 600px — это больше половины экрана; пользователь физически попадает пальцем именно в этот контейнер и не может прокрутить страницу дальше.
3. Двойная обёртка `overflow-x-auto` (TabContent) → `overflow-auto` (PaymentsTable) → `<div className="relative w-full overflow-auto">` (внутри `Table` из `ui/table.tsx`) создаёт ТРИ вложенных скролл-контекста. iOS такие конфигурации обрабатывает плохо.

Точки правок:
- `src/index.css` — глобальный `overflow-x: hidden` на `#root`.
- `src/components/layout/DashboardLayout.tsx` — `overflow-x-hidden` на корне и `<main>`.
- `src/components/admin/payments/PaymentsTabContent.tsx:625` — внешняя обёртка `overflow-x-auto`.
- `src/components/admin/payments/PaymentsTable.tsx:724` — `overflow-auto max-h-[600px]`.
- `src/components/ui/table.tsx` — встроенный `<div className="relative w-full overflow-auto">` вокруг `<table>`.

## Что меняем

### 1. `src/index.css`
- Убрать `overflow-x: hidden` с `#root`. Оставить на `html, body` (защищает от случайного выпирания всей страницы, но не блокирует жесты внутри потомков).
- Добавить утилиту `.touch-scroll`:
  ```css
  .touch-scroll {
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }
  ```
  Используется на скролл-контейнерах таблиц для inertial-скролла на iOS и корректной передачи overscroll родителю.

### 2. `src/components/layout/DashboardLayout.tsx`
- На корневом flex-контейнере (стр. 57): убрать `overflow-x-hidden`, оставить `min-w-0 max-w-full`.
- На `<main>` (стр. 73): заменить `overflow-x-hidden` → `overflow-x-clip`. `clip` не создаёт scroll-container и не мешает жестам потомков (в отличие от `hidden`).

### 3. `src/components/admin/payments/PaymentsTabContent.tsx`
- Удалить внешнюю обёртку `<div className="overflow-x-auto">` вокруг `<PaymentsTable>` (строка 625). Горизонтальный скролл должен жить ровно в одном месте — внутри самой таблицы.

### 4. `src/components/admin/payments/PaymentsTable.tsx` (строка 724) — ключевая правка
Заменить:
```tsx
<div className="overflow-auto max-h-[600px] relative">
```
на адаптивный контейнер:
```tsx
<div className="relative md:overflow-auto md:max-h-[600px] md:touch-scroll
                overflow-x-auto touch-scroll">
```

Логика:
- **Мобильный (< md):** только горизонтальный скролл (`overflow-x-auto`), вертикально — `visible`. Вертикальная прокрутка таблицы идёт вместе с прокруткой страницы → палец никогда не «застревает», всегда работает window scroll.
- **Десктоп (≥ md):** прежнее поведение `overflow-auto max-h-[600px]` со sticky header.
- На обоих — `.touch-scroll` (inertial + `overscroll-behavior: contain`, чтобы случайный horizontal swipe не уводил браузер на back-navigation).

Дополнительно: проставить `style={{ minWidth: totalColumnsWidth }}` на `<Table>` (сумма `column.width` из `sortedColumns`) чтобы скролл-контейнер знал реальную ширину контента и горизонтальный скролл работал детерминированно.

### 5. `src/components/ui/table.tsx` (canonical)
- Базовый `<Table>` сейчас оборачивает `<table>` в `<div className="relative w-full overflow-auto">`. Это создаёт лишний скролл-контекст внутри уже обёрнутого `PaymentsTable`. 
- Добавить опциональный prop `wrapperClassName` (default = `relative w-full overflow-auto`), но НЕ менять поведение по умолчанию для других страниц.
- В `PaymentsTable` передать `wrapperClassName="contents"` (или просто `""`) — чтобы внутренний div не создавал второго скролла поверх нашего основного контейнера.

Минимально-инвазивная альтернатива: в `PaymentsTable` обернуть `<Table>` с `className="!overflow-visible"` через дочерний селектор — но проще и чище через prop.

### 6. Sticky header
- На мобильном при `overflow-y: visible` sticky на `top-0` относительно ближайшего scroll-ancestor (теперь это window) → header будет прилипать к верху окна, что даже лучше UX. Если это нежелательно — на мобильном применим `md:sticky` (sticky только с десктопа). Применим `md:sticky` для безопасности.

## Верификация в симуляции

После правок провести browser-симуляцию от лица текущего пользователя:

1. `browser--navigate_to_sandbox` → `/admin/payments`, viewport 518×940 (как у пользователя).
2. Скриншот стартового состояния таблицы.
3. Свайп пальцем влево внутри таблицы → горизонтальный скролл работает, видны все колонки до конца.
4. Свайп вверх внутри таблицы (длинный, через несколько строк) → страница плавно прокручивается, скролл НЕ «зависает», пагинатор и нижние секции достижимы.
5. Свайп вниз — возврат наверх работает, нет «капкана» на таблице.
6. Сделать скриншоты до/после каждого этапа для подтверждения.
7. Проверить /admin/contacts и /admin/forms — их таблицы тоже используют тот же layout, должны продолжать работать (sticky на десктопе сохранён, на мобильном тоже не зависают).

## DoD

- На viewport 518×940 (iPhone PWA) таблица «Платежи»:
  - горизонтально прокручивается свайпом, видны все колонки;
  - не «захватывает» вертикальный скролл — страница продолжает прокручиваться сквозь таблицу;
  - имеет inertial momentum в PWA standalone.
- На десктопе (≥ md) sticky header + ограничение `max-h-[600px]` сохранены.
- Layout не «уезжает» горизонтально — `html/body` защита остаётся.
- Скриншоты браузер-симуляции прикреплены к отчёту.

## Файлы

- `src/index.css`
- `src/components/layout/DashboardLayout.tsx`
- `src/components/admin/payments/PaymentsTabContent.tsx`
- `src/components/admin/payments/PaymentsTable.tsx`
- `src/components/ui/table.tsx`
