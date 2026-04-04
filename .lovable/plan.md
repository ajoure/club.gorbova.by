# да, согласен, с учетом правок:

&nbsp;

1. Для поля **«Эфир»** в BroadcastTemplateDialog полностью убрать текущий Radix Select.
  Не пытаться его чинить локальными хаками. Он конфликтует с Dialog по focus/pointer events и уже доказано сломан.
2. Вместо него **полностью переиспользовать рабочий паттерн Popover + Command** по образцу из OrgFormCombobox.tsx.
  Нужен именно reuse существующего боевого решения проекта:
  &nbsp;
  - Popover
  - Command
  - CommandInput
  - CommandList
  - CommandItem
  &nbsp;
3. Блок выбора эфира переписать так:
  &nbsp;
  - trigger-кнопка с текущим значением или placeholder Выберите эфир
  - внутри PopoverContent поиск по названию
  - список результатов с нормальным hover, scroll, keyboard navigation
  - выбор item по мыши и Enter
  - после выбора: setLiveEventId(...), закрытие popover, мгновенный пересчёт computedButtonUrl и readiness
  &nbsp;
4. Для **неготовых эфиров** не использовать сломанный disabled у CommandItem, если он ломает interaction.
  Разрешаю два варианта, но итог должен быть UX-рабочим:
  &nbsp;
  - либо item визуально disabled и не выбирается через onSelect
  - либо item выбирается только для просмотра причин, но сохранение шаблона блокируется
    Главное: список, поиск и мышка не должны ломаться.
  &nbsp;
5. В item списка эфиров сохранить текущую бизнес-логику и визуал:
  &nbsp;
  - название
  - badge типа Живой / Видео
  - badge readiness
  - причина блокировки
    Меняем только механизм выбора, не правила readiness.
  &nbsp;
6. Обязательно проверить и сохранить совместимость с popup переменных в тексте сообщения.
  После замены selector-а нужно доказать, что:
  &nbsp;
  - ввод в textarea работает
  - popup переменных по [ открывается
  - поиск переменных работает
  - выбор переменной мышкой работает
  - модалка не закрывается
  - dropdown выбора эфира и popup переменных не конфликтуют по z-index/focus
  &nbsp;
7. Проверить dialog.tsx и оставить guard-совместимость с cmdk:
  &nbsp;
  - cmdk-item
  - cmdk-list
  - data-token-picker
    Ничего не ломать в уже рабочем token picker.
  &nbsp;
8. В BroadcastTemplateDialog не трогать:
  &nbsp;
  - getEventReadiness()
  - getEventTypeLabel()
  - computedButtonUrl
  - isValid
  - сохранение шаблона
    Эти части менять только если без этого новый selector не работает.
  &nbsp;
9. После выбора эфира должно происходить фактически:
  &nbsp;
  - значение отображается в поле
  - readiness summary обновляется
  - URL кнопки пересчитывается
  - если эфир готов и остальные поля заполнены, кнопка сохранения становится рабочей
  &nbsp;
10. Нужен runtime-proof именно по этому патчу:

&nbsp;

&nbsp;

&nbsp;

- открыть BroadcastTemplateDialog
- выбрать тип Приглашение на эфир
- кликнуть в поле Эфир
- ввести поиск
- найти эфир
- выбрать мышкой
- увидеть выбранное значение в поле
- убедиться, что URL/summary обновились
- ввести текст сообщения
- через [ вставить переменную
- успешно сохранить шаблон

&nbsp;

&nbsp;

&nbsp;

11. Этот патч считать blocker. Пока поле выбора эфира не работает мышкой и поиском, PATCH не принимать, даже если readiness и badges отображаются правильно.

&nbsp;

&nbsp;

План: Замена сломанного Select на рабочий Popover+Command в BroadcastTemplateDialog

## Диагностика

### Корневая причина

Текущий селектор эфира использует Radix `Select` (строки 245-297 в `BroadcastTemplateDialog.tsx`). Radix Select внутри Radix Dialog конфликтует по focus trap и pointer events — dropdown не реагирует на мышь, поиск невозможен, items не кликаются.

### Рабочий паттерн

`OrgFormCombobox.tsx` использует `Popover + Command (cmdk)` — тот же стек, что уже работает в проекте:

- Popover не конфликтует с Dialog focus trap
- Command (cmdk) даёт встроенный поиск, навигацию клавиатурой, скролл
- `onPointerDownOutside` guard в `dialog.tsx` уже защищает от закрытия диалога при клике в cmdk

### TokenizedRichInput (popup переменных)

Использует портал с `createPortal` и Command. Guard в `dialog.tsx` (строки 39-48) уже обрабатывает `data-token-picker` / `cmdk-item` / `cmdk-list`. После замены Select на Popover+Command конфликта не будет — оба используют один механизм.

---

## Изменения

### Файл: `src/components/admin/communication/BroadcastTemplateDialog.tsx`

**1. Заменить импорты**

Убрать:

```
Select, SelectContent, SelectItem, SelectTrigger, SelectValue
```

Добавить:

```
Popover, PopoverContent, PopoverTrigger
Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem
Check, ChevronsUpDown
```

**2. Заменить блок выбора эфира (строки 245-297)**

Вместо `<Select>` использовать паттерн из `OrgFormCombobox`:

```
Popover (open/onOpenChange)
  PopoverTrigger → Button с текущим названием эфира или placeholder
  PopoverContent (z-50, p-0)
    Command (shouldFilter={false}, ручная фильтрация по title)
      CommandInput (поиск по названию)
      CommandList
        CommandEmpty ("Эфир не найден")
        CommandGroup
          CommandItem для каждого эфира:
            - title
            - badge типа (Живой / Видео)
            - badge readiness (✓ Готов / причина блокировки)
            - disabled items: pointer-events-none + opacity, но видимы
            - onSelect: setLiveEventId, setOpen(false)
```

**3. Disabled items — видимые, но не выбираемые**

Для `!readiness.ready`:

- Рендерить как обычный `CommandItem`
- Добавить `className="opacity-60 pointer-events-none"`
- НЕ использовать `disabled` prop (он скрывает из навигации)
- Tooltip с причинами блокировки остаётся

**4. Сохранить Select для "Тип шаблона"**

Select на строках 212-224 (general / webinar_invite) — он вне Popover, работает нормально. Не трогать.

**5. Бизнес-логика без изменений**

- `getEventReadiness()` — без изменений
- `getEventTypeLabel()` — без изменений
- `liveEventId` / `setLiveEventId` — без изменений
- `computedButtonUrl` — без изменений
- `isValid` — без изменений

---

## Проверка TokenizedRichInput

После замены Select на Popover+Command:

- Оба dropdown (эфир и переменные) используют cmdk
- Guard в `dialog.tsx` (`onPointerDownOutside`) уже защищает cmdk-элементы
- Конфликт невозможен — они открываются в разных Popover/Portal

Если token picker всё же конфликтует — проверить `z-index` порталов (Popover эфира vs token picker portal). Token picker уже использует `createPortal(document.body)` с `z-[9999]`.

---

## Файлы


| Файл                                                             | Изменения                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------- |
| `src/components/admin/communication/BroadcastTemplateDialog.tsx` | Заменить Radix Select на Popover+Command для выбора эфира |


## DoD

1. Поле «Эфир» открывается кликом
2. Поиск по названию работает
3. Выбор мышкой и клавиатурой работает
4. Недоступные эфиры видны с причиной, но не выбираются
5. После выбора: liveEventId установлен, URL обновлён, шаблон можно сохранить
6. Token picker (переменные через `[`) работает без конфликтов
7. Recorded flow и readiness logic не затронуты