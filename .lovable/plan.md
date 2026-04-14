# да, согласен, с учетом правок:

&nbsp;

1. **PATCH 1 сформулировать как полный deterministic order contract.**
  Не просто добавить .order("id", { ascending: false }), а зафиксировать правило:
  &nbsp;
  - board full fetch всегда сортируется по updated_at DESC, id DESC;
  - этот же порядок используется на всех batched .range() запросах;
  - после фикса counts/totals проверяются именно на этом одном dataset.
  &nbsp;
2. **В PATCH 2 не делать кнопку Переместить только hover-visible.**
  Нужно добавить:
  &nbsp;
  - кнопка видна не только на hover, но и на focus-visible;
  - на touch/mobile она тоже доступна без hover;
  - карточка не должна терять эту action на устройствах без hover.
    То есть не ограничиваться только opacity-0 group-hover:opacity-100, а добавить нормальный focus/touch-safe сценарий.
  &nbsp;
3. **Иконка Переместить должна быть встроенной, но не перекрывать полезный контент карточки.**
  Зафиксировать:
  &nbsp;
  - absolute positioning допустимо;
  - при этом сумма, order number и badges не должны перекрываться;
  - карточка должна оставаться читаемой на коротких и длинных названиях.
  &nbsp;
4. **Tooltip оставить, но не делать его единственным способом понять действие.**
  Хорошо добавить:
  &nbsp;
  - aria-label / title для кнопки;
  - tooltip как дополнительный слой;
  - без зависимости usability от hover-only подсказки.
  &nbsp;
5. **В proof после PATCH 1 обязательно показать, что исчез ceiling именно по 3 сценариям.**
  То есть не только написать machine-check, а прямо включить в DoD:
  &nbsp;
  - all = 2847,
  - product scope = board count совпадает с DB count,
  - product + tariff scope = board count совпадает с DB count,
  - Успешно и summary меняются корректно при фильтрах.
  &nbsp;
6. **Отдельно проверить, что после удаления hover-bar не сломалось menu-move.**
  Нужно доказать:
  &nbsp;
  - icon-button открывает dropdown;
  - dropdown не инициирует drag;
  - selection stage works;
  - после refresh сделка остаётся в новой стадии.
  &nbsp;
7. **Добавить проверку длинной колонки после фикса ceiling.**
  После загрузки всех 2847 записей board должен остаться usable:
  &nbsp;
  - scroll не ломается,
  - tooltip/dropdown продолжают позиционироваться корректно,
  - карточки не дёргают layout.
  &nbsp;
8. **Сводное дополнение к плану:**

&nbsp;

```
Добавь к текущему плану следующие уточнения.

1. PATCH 1 оформить как строгий deterministic pagination contract:
- board fetch всегда сортируется по `updated_at DESC, id DESC`;
- этот порядок обязателен для всех batched `.range()` запросов;
- counts, summary и column totals считаются по этому же dataset.

2. В PATCH 2 кнопку `Переместить` не делать hover-only.
Нужно:
- доступна на hover;
- доступна на focus-visible;
- доступна на touch/mobile;
- не зависеть только от hover.

3. При absolute positioning кнопка `Переместить` не должна перекрывать сумму, badges, order number и другой полезный контент карточки.

4. Для кнопки `Переместить` добавить:
- tooltip `Переместить`;
- `aria-label` / доступное имя;
- корректный keyboard focus.

5. В итоговый proof включить не только общий сценарий, но и machine-check по 3 кейсам:
- all scope,
- product scope,
- product + tariff scope.
Для каждого кейса:
- board count = DB count,
- summary count = board count,
- successful count/sum корректны.

6. После удаления hover action bar отдельно доказать:
- icon-button открывает dropdown;
- dropdown не запускает drag;
- выбор стадии работает;
- после refresh состояние сохраняется.

7. После фикса ceiling проверить usability длинной колонки:
- board остаётся usable;
- scroll не ломается;
- dropdown и tooltip продолжают позиционироваться корректно.
```

После этих уточнений план можно исполнять.

&nbsp;

План: детерминированная пагинация + UI-fix карточки

## Root cause подтверждён

2106 сделок имеют идентичный `updated_at` (от backfill). При сортировке только по `updated_at DESC` Supabase/Postgres не гарантирует стабильный порядок между `.range()` вызовами — строки «плавают» между страницами, что приводит к дублям/пропускам и потолку ~1001.

## Изменения

### PATCH 1 — Детерминированная пагинация

**Файл**: `src/hooks/useDealsBoard.ts`, строка 68

Добавить вторичную сортировку по `id`:

```typescript
q = q.order("updated_at", { ascending: false }).order("id", { ascending: false });
```

Это единственное изменение, необходимое для устранения ceiling. Цикл `while/range` уже корректен — проблема только в нестабильном ORDER BY.

### PATCH 2 — Убрать hover action bar, встроить icon-button «Переместить»

**Файл**: `src/components/admin/deals/KanbanDealCard.tsx`

Что удалить:

- Весь блок `hidden group-hover:flex` (строки 147-191) — hover action bar
- Кнопку «Открыть» полностью
- Импорт `ExternalLink`

Что добавить:

- Импорт `Tooltip, TooltipTrigger, TooltipContent, TooltipProvider` из `@/components/ui/tooltip`
- Внутри основного контента карточки (после order number, строка 142), добавить compact icon-button:
  - Маленькая круглая кнопка `ArrowRightLeft` (16×16) в правом нижнем углу
  - `absolute bottom-2 right-2` позиционирование внутри карточки
  - `opacity-0 group-hover:opacity-100` — появляется при hover без изменения размеров
  - Обёрнута в `TooltipProvider > Tooltip > TooltipTrigger` с текстом «Переместить»
  - `onPointerDown={e => e.stopPropagation()}` — не инициирует drag
  - `onClick={e => e.stopPropagation()}` — не открывает detail sheet
  - `DropdownMenu` с тем же списком стадий, открывается от этой кнопки

Структура карточки после fix:

```
<div ref={setNodeRef} style={transform} className="group relative ...">
  <div {...attributes} {...listeners} onClick={onOpen} className="p-3 cursor-grab">
    {/* product, contact, amount, badges, order_number */}
  </div>
  {/* Icon button — absolute positioned, no layout impact */}
  {onMoveTo && availableStages?.length > 0 && (
    <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100"
         onPointerDown={e => e.stopPropagation()}
         onClick={e => e.stopPropagation()}>
      <TooltipProvider>
        <Tooltip>
          <DropdownMenu>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full">
                  <ArrowRightLeft className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Переместить</TooltipContent>
            <DropdownMenuContent ...>{stages}</DropdownMenuContent>
          </DropdownMenu>
        </Tooltip>
      </TooltipProvider>
    </div>
  )}
</div>
```

## Файлы


| Файл                                            | Изменение                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `src/hooks/useDealsBoard.ts`                    | Добавить `.order("id", { ascending: false })` на строке 68                 |
| `src/components/admin/deals/KanbanDealCard.tsx` | Убрать hover bar, убрать «Открыть», добавить compact icon-button с tooltip |


## Machine-check proof (после apply)

Запросы к БД для 3 сценариев:

- a) без фильтров: total должно быть 2847
- b) с фильтром по продукту: board count = DB count для того же product_id
- c) с фильтром по продукту + тарифу: board count = DB count

## DoD

1. Board загружает все 2847 сделок (не ~1001)
2. Summary и колонки считаются по одному полному dataset
3. Product/tariff фильтры корректно меняют counts/sums
4. Карточка не меняет высоту при hover
5. Hover action bar удалён
6. Кнопка «Открыть» удалена
7. Compact icon-button «Переместить» встроена в карточку
8. Tooltip «Переместить» работает
9. Dropdown открывается от кнопки, не улетает
10. Drag & drop не сломан
11. После refresh состояние сохраняется