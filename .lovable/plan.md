# да, согласен, с учетом правок:

&nbsp;

1. Делать overflow-hidden не только на Card «База знаний», а add-only на все Card-секции PromptFormDialog, как ты и написал, чтобы исключить повторение бага в других блоках с длинным контентом.
2. В PromptAttachmentsSection.tsx для строки метаданных файла (размер • статус • символы) обязательно добавить flex flex-wrap gap-1 вместо одной длинной строки. Иначе даже при исправленном имени файла overflow может давать именно нижняя служебная строка.
3. Для имени файла в строке вложения зафиксировать полную цепочку:
  &nbsp;
  - outer row: flex items-center gap-3 overflow-hidden
  - content wrapper: min-w-0 flex-1 overflow-hidden
  - filename: truncate block w-full
  - delete button: shrink-0
    Это нужно проверить именно в коде, а не только по текущему виду.
  &nbsp;
4. На CardContent секции «База знаний» тоже добавить overflow-hidden, не только на сам Card. Иначе обрезание может визуально не замкнуться на внутреннем уровне.
5. В DoD добавить отдельный proof на двух кейсах:
  &nbsp;
  - очень длинное кириллическое имя файла с пробелами и скобками;
  - несколько вложений подряд, чтобы проверить, что список не даёт горизонтального скролла и не ломает ширину dialog.
  &nbsp;
6. Не менять размеры/ширину DialogContent в этом патче. Сначала закрываем именно overflow-цепочку, без побочных UI-изменений.

&nbsp;

&nbsp;

План: Финальный фикс overflow в карточке вложений

## Диагностика

По скриншоту: имя файла в секции «База знаний» визуально упирается в правый край карточки без видимого `...` — это значит `truncate` не срабатывает из-за того, что родительские контейнеры не ограничивают ширину.

Цепочка ограничений должна быть **непрерывной** от `DialogContent` до `<p className="truncate">`:

```text
DialogContent (max-w-2xl, overflow-x-hidden)
  → div.px-6 (padding сужает)
    → Card (shadow-sm) — НЕТ overflow-hidden ❌
      → CardContent — НЕТ overflow-hidden ❌
        → PromptAttachmentsSection
          → div.space-y-2
            → row div (overflow-hidden ✓)
              → content div (min-w-0, flex-1 ✓)
                → p.truncate ✓
```

Проблема: `Card` и `CardContent` не имеют `overflow-hidden`, поэтому содержимое может выходить за границу карточки.

## Изменения

### 1. `src/components/ai-chat/PromptFormDialog.tsx`

На **Card «База знаний»** (строка 201) добавить `overflow-hidden`:

```
<Card className="shadow-sm overflow-hidden">
```

Аналогично на остальных Card-секциях для единообразия — все 5 карточек получают `overflow-hidden`.

### 2. `src/components/ai-chat/PromptAttachmentsSection.tsx`

На внутреннем content-блоке (строка 129) добавить `overflow-hidden` для полноты цепочки:

```
<div className="flex-1 min-w-0 overflow-hidden">
```

Также убедиться что нижняя строка с метаданными (размер • статус • символы) тоже не ломает layout — добавить `flex-wrap` или `truncate` на весь блок метаданных.

## Что не меняется

- Логика хука, edge function, БД — без изменений
- Структура секций — без изменений

## DoD

1. Длинное кириллическое имя файла показывает `...` через truncate, не выходит за край карточки
2. В диалоге нет горизонтального скролла ни на одной секции
3. Все 5 Card-секций визуально одинаковы по стилю