

# План: Visual polish pipeline selector

## Scope
Только визуальные изменения в `PipelineManagementPopover.tsx`. Логика, порядок, rename, create, delete — без изменений.

## Изменения

### 1. Trigger button
- Gradient border effect: `bg-gradient-to-r from-card/60 to-card/40` с `ring-1 ring-primary/20`
- Active dot: пульсирующий `animate-pulse` или `ring` вокруг точки
- Более насыщенный backdrop: `backdrop-blur-xl` вместо `md`
- Hover: `hover:shadow-md hover:border-primary/30`

### 2. PopoverContent
- Richer glass: `bg-card/70 backdrop-blur-3xl` + subtle inner gradient overlay
- Более глубокая тень: `shadow-[0_8px_40px_rgba(0,0,0,0.12)]`
- Header: gradient text или accent underline для "Воронки продаж"
- Divider: gradient line вместо `bg-border/20`

### 3. Active pipeline item
- Вместо простого `bg-primary/10` + `border-l-2` → более выразительный:
  - `bg-gradient-to-r from-primary/12 to-primary/5`
  - Accent dot слева (маленький кружок primary) вместо border-l
  - Текст `text-primary` для active name
  - Subtle glow: `shadow-[inset_0_0_12px_rgba(59,130,246,0.08)]`

### 4. Default pipeline items
- Hover: `hover:bg-muted/30` с `hover:shadow-sm`
- Subtle left accent dot (transparent по дефолту, muted при hover)
- Drag state: добавить `ring-1 ring-primary/20` при перетаскивании

### 5. Badge "основная"
- Gradient badge: `bg-gradient-to-r from-primary/20 to-primary/10` с `ring-1 ring-primary/25`

### 6. Create button
- Subtle gradient hover: `hover:bg-gradient-to-r hover:from-primary/8 hover:to-transparent`
- Icon accent: `text-primary/60` для Plus

## Изменяемый файл
`src/components/admin/deals/PipelineManagementPopover.tsx` — только className изменения.

## Что НЕ меняется
- Props, callbacks, логика reorder, guards, rename/delete
- Структура компонентов
- Интеграция в AdminDeals.tsx

