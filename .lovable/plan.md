# да, согласен, с учетом правок:

&nbsp;

1. В PromptFormDialog.tsx лучше заменить фон DialogContent не на bg-muted, а на bg-background или оставить дефолтный solid фон диалога. bg-muted может снова дать ощущение серой подложки, а не белого окна как в EntityRecordSheet.
2. В DialogContent добавить не только overflow-hidden, но и проверить/зафиксировать max-h-[90vh] overflow-y-auto overflow-x-hidden, чтобы длинные секции не создавали горизонтальный скролл.
3. В PromptAttachmentsSection.tsx для строки карточки файла нужен полный набор:
  &nbsp;
  - внешний row: flex items-center gap-3 overflow-hidden
  - средний контент-блок: min-w-0 flex-1 overflow-hidden
  - filename: truncate
    Иначе truncate может снова не сработать.
  &nbsp;
4. Кнопку удаления файла справа сделать shrink-0, чтобы длинное имя не выталкивало её за пределы карточки.
5. Проверить не только список файлов, но и все длинные текстовые поля в диалоге (slug, launcher_description, response_format, подсказки), чтобы у всего контейнера не было горизонтального overflow.
6. В DoD добавить proof:
  &nbsp;
  - длинный кириллический filename в списке вложений не выходит за край;
  - в диалоге нет горизонтального скролла;
  - фон окна визуально solid, без полупрозрачности.
  &nbsp;

&nbsp;

&nbsp;

План: Фикс overflow и прозрачности карточек в PromptFormDialog

## Диагностика

1. **Overflow справа**: `DialogContent` имеет `max-w-2xl`, но внутренние карточки с длинными именами файлов не ограничены по ширине — `min-w-0` отсутствует на flex-контейнерах, и `truncate` не срабатывает из-за этого.
2. **Прозрачность**: `DialogContent` использует `bg-muted/30` — полупрозрачный фон. В EntityRecordSheet используется стандартный непрозрачный фон. Нужно убрать `/30` и сделать фон solid.

## Изменения

### 1. `src/components/ai-chat/PromptFormDialog.tsx`

- Строка 145: заменить `bg-muted/30` на `bg-muted` (убрать прозрачность)
- Добавить `overflow-hidden` на `DialogContent` для предотвращения горизонтального overflow

### 2. `src/components/ai-chat/PromptAttachmentsSection.tsx`

- Строка 126: на карточке файла `div` с `flex items-center` — убедиться что есть `overflow-hidden` на контейнере
- Строка 130: `truncate` уже есть на имени файла, но родительский flex-контейнер нуждается в `min-w-0` и `overflow-hidden` чтобы truncate сработал

Конкретно:

- Строка 126: добавить `overflow-hidden` к классам контейнера файла
- Внутренний div (строка 129) уже имеет `min-w-0`, это корректно

## Что не меняется

- Логика хука, edge function, БД, RLS — без изменений
- Структура Card-секций — без изменений

## DoD

1. Длинные имена файлов обрезаются через truncate, не выходят за правый край карточки
2. Фон диалога solid, без прозрачности, как в реквизитах