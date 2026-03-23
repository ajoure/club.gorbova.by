# да, согласен, с учетом правок:

&nbsp;

1. Не менять глобально sheet.tsx и sheetVariants в этом патче.
  Это риск регресса по всему приложению. Делай локальный shared shell helper/class и подключай его только в:
  &nbsp;
  - EntityRecordSheet.tsx
  - PersonRecordSheet.tsx
  - AiDocumentTemplatesManager.tsx
  - GenerateAiDocumentDialog.tsx
  &nbsp;
2. Не использовать my-auto как основной способ inset/layout для fixed sheet.
  Нужны явные offsets, чтобы стабильно были видны все 4 угла:
  &nbsp;
  - !top-2 !bottom-2 !right-2 sm:!top-4 sm:!bottom-4 sm:!right-4
  - !left-auto
  - единая ширина как у реквизитов
    Иначе будут плавающие баги позиционирования.
  &nbsp;
3. Единый shell должен быть реально один и тот же по размеру.
  Никаких разных lg:max-w-3xl / 4xl / 5xl.
  Один эталонный размер, как у окна реквизитов, и один shared class/helper без копипасты.
4. Зафиксируй единый layout shell:
  &nbsp;
  - header flex-shrink-0
  - body flex-1 overflow-y-auto
  - footer flex-shrink-0
  - без двойного scroll
  - scrollbar аккуратный и не перекрывает контент/кнопки
  &nbsp;
5. Fix wizard state делай не через скрытие chooser, а через режимы.
  Нужны явные состояния:
  &nbsp;
  - history
  - fresh
  - none
    И на шаге 1 блок выбора режима должен оставаться доступным всегда, если есть lastDoc.
  &nbsp;
6. После Заполнить заново обязательно:
  &nbsp;
  - очистить entityId / personId / signerLinkId
  - сохранить возможность одним кликом вернуть прошлые данные
  - не требовать закрытия окна
  &nbsp;
7. Добавь DoD по визуалу:
  &nbsp;
  - у всех 4 окон видны все 4 скруглённых угла
  - окно не прилипает к краям
  - одинаковый размер shell
  - одинаковые header/body/footer
  - нет второго scrollbar
  - в wizard можно переключаться прошлые данные ↔ заполнить заново без закрытия
  &nbsp;
8. Добавь DoD по regression-check:
  &nbsp;
  - реквизиты не сломаны
  - AI manager не обрезает длинные названия файлов и токены
  - footer-кнопки всегда видны
  - шаг 1 wizard не теряет chooser после выбора fresh/history
  &nbsp;
9. Соблюдай add-only.
  Ничего из PATCH 8.3 не удалять, только переиспользовать и дофиксить.
10. Отдельно зафиксируй как future patch:
  после этого патча идём в пакеты документов / группы документов, где один сценарий создаёт 2–4 документа за один проход. Это не смешивать с PATCH 8.4.

&nbsp;

&nbsp;

PATCH 8.4 — Единый shell + fix reset/reuse в wizard

## Проблемы

1. **Все Sheet прилипают к краям** — `h-[100dvh]` + `inset-y-0 right-0` из `sheetVariants` = нет видимых 4 углов, нет inset от viewport
2. **Разные max-w** — EntityRecord/PersonRecord/GenerateDialog = `lg:max-w-3xl`, Manager = `lg:max-w-5xl`
3. **Prefill one-way** — `startFresh()` ставит `showPrefillChoice = false` и `prefillSource = null`, после чего вернуть данные невозможно без закрытия wizard

## Решение

### 1. Shared shell className — один источник истины

Создать `src/lib/sheetShell.ts`:

```ts
/** Unified sheet shell className for all right-side panels */
export const SHEET_SHELL_CLASS =
  "w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] sm:max-w-3xl " +
  "h-[calc(100dvh-1rem)] sm:h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] " +
  "my-auto mr-2 sm:mr-4 " +
  "rounded-2xl " +
  "p-0 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] " +
  "flex flex-col overflow-hidden";
```

Это даст:

- Inset от правого края: `mr-2 sm:mr-4`
- Inset сверху/снизу: `my-auto` + `h-[calc(100dvh-2rem)]`
- Видны все 4 округлённых угла: `rounded-2xl`
- Единая ширина для всех окон

Для `sheetVariants` в `sheet.tsx` — поправить вариант `right`: убрать `h-full`, чтобы не конфликтовал с кастомным `h-[calc...]`.

### 2. Применить SHEET_SHELL_CLASS в 4 файлах


| Файл                             | Было                     | Станет              |
| -------------------------------- | ------------------------ | ------------------- |
| `EntityRecordSheet.tsx`          | длинный inline className | `SHEET_SHELL_CLASS` |
| `PersonRecordSheet.tsx`          | длинный inline className | `SHEET_SHELL_CLASS` |
| `AiDocumentTemplatesManager.tsx` | `lg:max-w-5xl` inline    | `SHEET_SHELL_CLASS` |
| `GenerateAiDocumentDialog.tsx`   | `lg:max-w-3xl` inline    | `SHEET_SHELL_CLASS` |


### 3. Правка `sheet.tsx` — вариант `right`

Текущий вариант `right`:

```
inset-y-0 right-0 h-full w-3/4 border-r ...
```

Нужно убрать `h-full` и `inset-y-0` из варианта, чтобы SheetContent с кастомным `h-[calc...]` и `my-auto` мог работать. Заменить на более гибкий `top-0 right-0` или оставить позиционирование shell-классу.

Альтернатива (безопаснее): не менять `sheetVariants`, а передавать `side={undefined}` или переопределять через className с `!important`-like utilities (`!h-auto !inset-auto`). Но чище — поправить вариант `right`, добавив поддержку inset-окна.

**Выбранный подход**: в `SHEET_SHELL_CLASS` добавить override: `!h-auto !inset-y-auto` чтобы перебить вариант, не трогая `sheet.tsx` (add-only).

### 4. Fix prefill reset/reuse в GenerateAiDocumentDialog

Текущий баг: `startFresh()` ставит `showPrefillChoice = false`, после чего нет UI для возврата.

**Исправление**: 

- Убрать `setShowPrefillChoice(false)` из `startFresh()`
- Вместо скрытия banner, менять его состояние — показывать кнопку "Использовать прошлые данные" когда user в fresh mode
- Логика:
  - `prefillSource === null` и `lastDoc` существует → показать обе кнопки (initial state)
  - `prefillSource === "history"` → показать badge + кнопку "Заполнить заново"
  - `prefillSource === "fresh"` (новое значение) → показать badge "Заполнено вручную" + кнопку "Использовать прошлые данные"
- `startFresh()`: ставит `prefillSource = "fresh"` вместо `null`
- Banner всегда виден на шаге 1, пока есть `lastDoc`

## Файлы


| Файл                                                         | Действие                                         |
| ------------------------------------------------------------ | ------------------------------------------------ |
| `src/lib/sheetShell.ts`                                      | Создать — единая константа shell className       |
| `src/components/ai-requisites/EntityRecordSheet.tsx`         | Заменить inline className на `SHEET_SHELL_CLASS` |
| `src/components/ai-requisites/PersonRecordSheet.tsx`         | Заменить inline className на `SHEET_SHELL_CLASS` |
| `src/components/ai-documents/AiDocumentTemplatesManager.tsx` | Заменить inline className на `SHEET_SHELL_CLASS` |
| `src/components/ai-documents/GenerateAiDocumentDialog.tsx`   | Shell className + fix prefill toggle             |


## Что НЕ трогаем

- `sheet.tsx` sheetVariants (override через className)
- billing flow / generated_documents / generate-from-template
- PATCH 5/6/7
- AdminDocumentTemplates
- AI.tsx tabs