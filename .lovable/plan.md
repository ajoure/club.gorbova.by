

## PATCH: Симметричные разделители + стиль вкладок Telegram-style

### Файл: `src/components/admin/ContactDetailSheet.tsx`

### 1) Симметричные разделители

Проблема: `Separator` на строке 1362 имеет `my-2` (без `mx`), на строке 1430 — `mx-3`, на строке 1476 — `mx-4 sm:mx-6`. Все три разные.

Фикс: Все три `Separator` привести к единому отступу `mx-4 sm:mx-6`:
- Строка 1362: `<Separator className="my-2" />` → `<Separator className="my-2 mx-4 sm:mx-6" />`
- Строка 1430: `<Separator className="mx-3" />` → убрать (лишний — уже есть разделение через bg-muted блок)
- Строка 1476: `<Separator className="mx-4 sm:mx-6" />` — оставить как есть

Но поскольку SheetHeader имеет `p-4 sm:p-6`, separator на строке 1362 уже внутри padding. Нужно учесть, что `mx` внутри `p-4` блока создаст двойной отступ. Поэтому:
- Строка 1362 (внутри SheetHeader с p-4): оставить без mx, т.к. padding родителя уже обеспечивает отступ
- Строка 1430 (тоже внутри SheetHeader): убрать этот separator — достаточно нижнего padding SheetHeader
- Строка 1476 (вне SheetHeader, внутри Tabs): `mx-4 sm:mx-6` — корректно

Итого оба видимых разделителя будут с одинаковым визуальным отступом от краёв.

### 2) Убрать тень под блоком бейджей

Строка 1365: `bg-muted/30 rounded-lg px-3 py-2` — убрать `bg-muted/30 rounded-lg`, оставить просто `px-3 py-1.5`. Это уберёт фоновый блок с "тенью", бейджи будут просто в строке.

### 3) Вкладки в стиле Telegram — прозрачный фон + скрытие скроллбара

**TabsList** (строка 1436): Сделать фон почти прозрачным:
- `TabsList` сейчас имеет дефолтный `bg-muted`. Переопределить: `bg-transparent` или `bg-muted/20`.

**TabsTrigger**: Сделать как в Telegram — прозрачные вкладки, при выборе — лёгкая подсветка стеклом:
- Добавить в `TabsList`: `className="... bg-transparent p-0 h-auto gap-0"`
- Каждый `TabsTrigger`: добавить стили `data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none rounded-full`

**Скрытие скроллбара** (строка 1435): Добавить класс для скрытия полосы прокрутки:
- На `div` с `overflow-x-auto` добавить: `scrollbar-hide` (или inline стиль `scrollbarWidth: 'none'` + `-webkit-scrollbar: none`)
- Используем inline стиль `scrollbarWidth: 'none'` и `msOverflowStyle: 'none'` + CSS `[&::-webkit-scrollbar] { display: none }`

### Итого изменения

| Строка | Было | Стало |
|--------|------|-------|
| 1362 | `<Separator className="my-2" />` | `<Separator className="mt-3" />` |
| 1365 | `bg-muted/30 rounded-lg px-3 py-2` | `px-1 py-1` (без фона) |
| 1430 | `<Separator className="mx-3" />` | Удалить |
| 1435 | `overflow-x-auto` | `overflow-x-auto [&::-webkit-scrollbar]:hidden` + стиль `scrollbarWidth: 'none'` |
| 1436 | `TabsList` с дефолтами | `bg-transparent h-auto p-0.5 gap-0.5` |
| 1437+ | Все `TabsTrigger` | Добавить `data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none rounded-full` |
| 1476 | `<Separator className="mx-4 sm:mx-6" />` | Оставить |

