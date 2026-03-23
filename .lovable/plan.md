# да, согласен, с учетом правок:

&nbsp;

1. Сохранение заполненных данных делать через БД, не через localStorage как основной источник.
  Для “между сессиями wizard” использовать последний ai_generated_documents по template_id + profile_id и брать prefill из snapshot/meta.
  localStorage можно использовать только как временный draft внутри текущей незавершённой сессии, но не как источник истины.
2. Не подставлять старые данные молча.
  Если для шаблона уже есть предыдущий документ, в шаге 1 показать явный CTA:
  &nbsp;
  - Использовать данные из последнего документа
  - Заполнить заново
    Автозамена без подтверждения не нужна.
  &nbsp;
3. Сохранить trace, откуда взят prefill.
  При генерации нового документа, если данные взяты из предыдущего, записывать в ai_generated_documents.meta:
  &nbsp;
  - prefill_from_document_id
  - prefill_source = "history"
  - selected_entity_id
  - selected_person_id
  - selected_signer_link_id
  &nbsp;
4. AiDocumentTemplatesManager сделать ещё шире, чем обычные реквизиты.
  Для менеджера шаблонов лучше не lg:max-w-4xl, а минимум lg:max-w-5xl, потому что там длинные имена файлов, токены и диагностические блоки.
  Для wizard генерации можно оставить ближе к shell реквизитов.
5. Убрать двойной vertical scroll полностью.
  Проверить, чтобы:
  &nbsp;
  - SheetContent имел overflow-hidden
  - scroll был только на body
  - footer был отдельным фиксированным блоком
  - список токенов внутри body не создавал второй лишний внешний scroll
  &nbsp;
6. TokenPreviewTable не должен создавать вложенный конфликтующий scroll.
  Если body уже скроллится, у preview-таблицы:
  &nbsp;
  - убрать лишний max-h, если он даёт nested scroll
  - оставить обычный flow-контент
    Отдельный внутренний scroll допустим только для очень длинного списка токенов и только если он не ломает основной body-scroll.
  &nbsp;
7. Для AiDocumentTemplatesManager разделить режимы list и create/edit визуально как в реквизитах.
  Не просто смена содержимого, а полноценные section/card-блоки:
  &nbsp;
  - header
  - основной контент
  - диагностический блок токенов
  - footer действий
    Сейчас это нужно привести к тому же уровню аккуратности, что и карточки реквизитов.
  &nbsp;
8. В режиме edit шаблона обязательно показать текущий файл и текущие токены.
  Если новый файл не загружен:
  &nbsp;
  - текущий файл не теряется
  - текущие placeholders остаются видимыми
  - пользователь понимает, что именно уже сохранено
  &nbsp;
9. DoD добавить явно.
  Нужно доказать:
  &nbsp;
  - Управление шаблонами открывается как широкий правый sheet
  - Заполнить документ wizard открыт в таком же shell-стиле
  - нет внешнего грубого вертикального scrollbar
  - footer всегда виден
  - при наличии предыдущего документа wizard предлагает reuse, но не подставляет молча
  - после выбора reuse select’ы реально prefilled
  - после генерации в meta записан источник prefill
  - layout не режет длинные имена файлов и длинные токены
  &nbsp;

&nbsp;

&nbsp;

Копируемый блок для Lovable:

```
PATCH 8.3 UI-FIX + PREFILL — привести AI Documents к shell-стандарту реквизитов и добавить reuse заполненных данных

1. AiDocumentTemplatesManager:
- перевести на тот же right-side Sheet shell, что EntityRecordSheet / PersonRecordSheet
- ширина менеджера шаблонов: минимум `lg:max-w-5xl`
- `SheetContent`: `p-0`, `flex flex-col`, `h-[100dvh] max-h-[100dvh]`, `overflow-hidden`
- header фиксированный
- body: `flex-1 overflow-y-auto`
- footer фиксированный, всегда видим
- никаких узких center modal

2. GenerateAiDocumentDialog:
- тоже перевести на тот же Sheet shell
- header фиксированный
- body scrollable
- footer фиксированный
- step indicator в header
- единый стиль с окнами реквизитов

3. Scroll:
- убрать двойной vertical scroll
- внешний shell только `overflow-hidden`
- основной scroll только на body
- nested scroll разрешён только там, где он реально нужен и не ломает UX

4. TokenPreviewTable:
- убрать конфликтующий nested scroll, если он есть
- не создавать вторую лишнюю полосу прокрутки
- токены и preview должны читаться в основном body-scroll

5. Сохранение / reuse заполненных данных:
- основной источник prefill = БД, не localStorage
- брать последний `ai_generated_documents` по `template_id + profile_id`
- доставать из `snapshot/meta` выбранные ids
- localStorage можно использовать только как временный draft внутри текущей незавершённой сессии

6. Не подставлять старые данные автоматически:
- при открытии wizard, если есть предыдущий документ, показать явный выбор:
  - `Использовать данные из последнего документа`
  - `Заполнить заново`
- без silent prefill

7. Trace reuse:
- при генерации нового документа, если был reuse, писать в `ai_generated_documents.meta`:
  - `prefill_from_document_id`
  - `prefill_source = "history"`
  - `selected_entity_id`
  - `selected_person_id`
  - `selected_signer_link_id`

8. Edit mode шаблона:
- если новый файл не загружен, текущий файл и текущие placeholders должны оставаться видимыми
- пользователь должен понимать, что сохранено сейчас

DoD:
- `Управление шаблонами` открывается wide right-side sheet
- `Заполнить документ` wizard открывается в том же shell-стандарте
- нет некрасивого внешнего vertical scrollbar
- footer всегда виден
- длинные имена файлов и токены не режутся
- wizard предлагает reuse последнего документа только через явный выбор
- после выбора reuse select’ы реально prefilled
- после генерации в `meta` сохранён источник prefill

PATCH 8.3 UI-FIX — Shell-стандарт реквизитов + сохранение заполненных данных
```

## Анализ

### Текущий shell-паттерн (EntityRecordSheet)

```text
Sheet (right side)
  SheetContent: w-full sm:max-w-[60vw] lg:max-w-3xl p-0 
                pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]
                flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden
    SheetHeader: p-4 sm:p-6 pb-3 flex-shrink-0
      Icon + Title + Subtitle
      Separator
      Badge pills + actions
    Body: flex-1 overflow-y-auto
      px-4 sm:px-6 py-4 pb-24
      Card sections with CardHeader/CardContent
```

### Текущие проблемы

1. `AiDocumentTemplatesManager` — узкий Dialog `max-w-lg`, тесно, обрезается
2. `GenerateAiDocumentDialog` — узкий Dialog `max-w-lg`, не совпадает с shell реквизитов
3. Нет сохранения заполненных данных — каждый раз wizard начинает с нуля
4. Скролл на всём Dialog вместо внутреннего body

## Решение

### 1. `AiDocumentTemplatesManager.tsx` — Dialog → Sheet

Заменить `Dialog/DialogContent` на `Sheet/SheetContent` с тем же shell, что EntityRecordSheet:

- `SheetContent className="w-full sm:max-w-[60vw] lg:max-w-4xl p-0 pt-[env(...)] pb-[env(...)] flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden"`
- Фиксированный `SheetHeader` с иконкой Upload + заголовок + описание
- `flex-1 overflow-y-auto` body
- Фиксированный footer для кнопок в режиме create/edit (sticky bottom)
- Блок токенов — отдельный `Card` с `max-h-[200px] overflow-y-auto` внутри, badges с `flex-wrap`

### 2. `GenerateAiDocumentDialog.tsx` — Dialog → Sheet

Заменить `Dialog/DialogContent` на `Sheet/SheetContent`:

- Тот же shell-паттерн
- `SheetHeader`: иконка FileText + имя шаблона + step indicator
- Body: `flex-1 overflow-y-auto px-4 sm:px-6 py-4`
- Footer: фиксированный с кнопками Назад/Далее/Сформировать
- Step indicator внутри header, не в body

### 3. Сохранение заполненных данных между сессиями wizard

Новая функциональность — при повторном "Заполнить документ" предлагать выбор:

- **Подход**: хранить последние использованные `entityId`, `personId`, `signerLinkId` per template в `localStorage` или в `ai_generated_documents.snapshot`
- При открытии wizard для шаблона, у которого уже есть сгенерированные документы:
  - Предлагать "Использовать данные из последнего документа" (подставить entityId/personId/signerLinkId из последнего snapshot)
  - Или "Заполнить заново"
- Реализация: в `GenerateAiDocumentDialog` при open подтягивать последний документ по `template_id` из `ai_generated_documents` и pre-fill select значения

### 4. Скролл

- Body за Sheet не скроллится (Sheet overlay блокирует)
- Внутренний скролл через `overflow-y-auto` на body div
- `ScrollArea` использовать не обязательно — достаточно `overflow-y-auto` как в EntityRecordSheet

## Файлы


| Файл                                                         | Действие                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| `src/components/ai-documents/AiDocumentTemplatesManager.tsx` | Dialog → Sheet shell, фикс layout, footer, token card       |
| `src/components/ai-documents/GenerateAiDocumentDialog.tsx`   | Dialog → Sheet shell, фикс layout, pre-fill из истории      |
| `src/components/ai-documents/TokenPreviewTable.tsx`          | Мини-правка — убрать внутренний max-h (sheet body скроллит) |


## Что НЕ трогаем

- `AI.tsx` — tabs не меняем
- `AiDocumentsGenerateView.tsx` — не меняем (кнопки уже ок)
- `AiDocumentsHistoryView.tsx` — не меняем
- billing flow, `generated_documents`, `generate-from-template`
- `EntityRecordSheet`, `PersonRecordSheet` — только reference
- PATCH 5/6/7