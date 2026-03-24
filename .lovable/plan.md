# да, согласен, с учетом правок:

&nbsp;

1. **Overlay лучше править не через AlertDialogContent, а через AlertDialogOverlay или локальный wrapper-variant.**
  Если в проекте overlay стилизован централизованно, нужно сделать локальное, точечное переопределение именно для этого confirm dialog, чтобы не повлиять на другие alert dialogs.
2. **На mobile в flex-col-reverse проверьте реальный визуальный порядок.**
  Важно, чтобы итогово главным действием визуально оставалось **«Сохранить и выйти»**, а destructive не оказывался первым из-за особенностей DOM/stack order.
3. **Для destructive-кнопки добавьте не только text-destructive, но и спокойный hover/focus state.**
  Чтобы она оставалась заметно опасной по смыслу, но не спорила визуально с primary. Нужен мягкий hover без яркой заливки.
4. **Для primary-кнопки с loading оставить фиксированную ширину не меньше min-w-[160px], как вы указали, и проверить одинаковую высоту всех трех кнопок.**
  Это важно для аккуратного ритма в footer.
5. **В DoD добавьте proof, что reopen dialog не изменился побочно.**
  Поскольку рядом есть второе модальное окно, нужно отдельно показать, что патч затронул только confirm dialog выхода, а reopen flow визуально и логически не сломан.

&nbsp;

&nbsp;

В остальном план точный и безопасный.

&nbsp;

PATCH 1.2.1 — UI polish окна выхода из corporate wizard

## Scope

Только визуальные правки confirm dialog закрытия (строки 379-407 в `CorporateWizard.tsx`). Логика `handleSaveAndClose`, `handleExitWithoutSave`, `flushSave` не затрагивается.

---

## Что меняется

**Файл:** `src/components/corporate/CorporateWizard.tsx` (строки 379-407)

### 1. Overlay — сделать легче

Добавить кастомный класс на `AlertDialogContent`: уменьшить overlay через обёртку `AlertDialog` или переопределить overlay opacity на `bg-black/40` вместо стандартного `bg-black/80`.

### 2. Контент — компактнее

- `AlertDialogContent` → добавить `max-w-md` (вместо default `max-w-lg`), `p-5` (вместо `p-6`), `gap-3` (вместо `gap-4`)
- Убрать лишний воздух между header и footer

### 3. Текст — короче

- Заголовок: `Выйти из мастера?` (уже есть ✓)
- Описание: заменить «У вас есть активная черновая сессия. Что вы хотите сделать?» → `У вас есть несохранённые данные. Что сделать с черновиком?`

### 4. Иерархия кнопок

Текущий порядок: `Остаться` (cancel) → `Выйти без сохранения` (outline) → `Сохранить и выйти` (primary action)

Новый порядок и стили:

```
Выйти без сохранения          Остаться    Сохранить и выйти
(ghost + text-destructive)    (outline)   (primary/default)
```

- **«Выйти без сохранения»** → `variant="ghost"` + `className="text-destructive hover:text-destructive"` — визуально приглушённая, но destructive по смыслу
- **«Остаться»** → `variant="outline"` — secondary action
- **«Сохранить и выйти»** → `AlertDialogAction` (primary) — остаётся как есть, это главное безопасное действие

На desktop: destructive слева, outline + primary справа (стандартный паттерн «опасное действие — в стороне от безопасных»).

### 5. Footer layout

- `AlertDialogFooter` → `className="flex-col-reverse sm:flex-row sm:justify-between gap-2"` — destructive action слева, safe actions справа
- На mobile: stack вертикально, primary сверху (первый визуальный фокус)

### 6. Loading state

- При `closeSaving`: все кнопки `disabled`, у primary — `Loader2` spinner (уже есть)
- Добавить `min-w-[160px]` на primary кнопку чтобы при появлении spinner ширина не прыгала

---

## Файлы


| Файл                                           | Что                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `src/components/corporate/CorporateWizard.tsx` | Строки 379-407: стили AlertDialog, текст, порядок и стили кнопок |


## Что НЕ меняется

- Логика close protection, flushSave, reopen
- Draft persistence, saveStatus
- Step компоненты, rule engine, edge functions
- Reopen dialog (строки 410-435) — не трогаем в этом патче

## DoD

- Overlay легче (40% вместо 80%)
- Dialog компактнее (max-w-md, меньше padding)
- Destructive — ghost/приглушённая, Primary — доминирующая
- Текст короче и понятнее
- Layout не ломается на узких экранах
- Loading state стабильный (ширина кнопки не прыгает)
- Логика PATCH 1.2 не затронута