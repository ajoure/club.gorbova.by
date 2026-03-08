

## Sprint: Telegram-safe align + убрать Preview + стабилизировать позиционирование

### Текущее состояние (dry-run)

| Проблема | Факт |
|---|---|
| Align-маркеры в TG-отправке | `serializeDoc()` генерирует `[[align:center]]...` → это уходит в `telegram-mass-broadcast` и `telegram-send-test` как есть. **Telegram покажет это как текст.** |
| Кнопки Align в TG-редакторах | Bubble toolbar **всегда** показывает L/C/R — нет разделения TG vs Email |
| Preview TG | Строки 616-627 в `BroadcastsTabContent` показывают `TelegramMessagePreview` с сырыми `{{token}}` — вводит в заблуждение |
| Bubble позиционирование | Строки 592-608: через `window.getSelection().getRangeAt(0).getBoundingClientRect()` — в модалках съезжает |
| Dropdown clamp | Строки 394-420: уже есть editorRect clamp — корректный |
| Отправка без strip | `BroadcastsTabContent` строка 274/306: `message.trim()` без strip align. `MassBroadcastDialog` строка 41: то же. |

---

### PATCH 1 (P0): `allowAlign` проп + strip перед TG-отправкой

**Файл: `src/components/admin/TokenizedRichInput.tsx`**

1. Добавить проп `allowAlign?: boolean` (default `false`) в интерфейс (строка 294)
2. В bubble toolbar (строки 711-744): обернуть разделитель + 3 кнопки align в `{allowAlign && (...)}`
3. Если `!allowAlign` → в `serializeDoc()` не генерировать `[[align:...]]` префиксы (или strip после сериализации — проще: `if (!allowAlign) serialized = serialized.replace(/\[\[align:(left|center|right)\]\]/g, '')` в `onUpdate`)

**Файл: `src/components/admin/communication/BroadcastsTabContent.tsx`**

4. TG message (строка 600): оставить без `allowAlign` (default false) — кнопок align нет
5. Email body (строка 689): добавить `allowAlign={true}`
6. TG send — strip align как STOP-guard перед invoke:
   - Строка 274: `formData.append("message", message.trim().replace(/\[\[align:...\]\]/g, ''))`
   - Строка 307: аналогично в body.message
   - Строка 369 (test send): аналогично в messageText

**Файл: `src/components/telegram/MassBroadcastDialog.tsx`**
7. Строка 41: strip align перед отправкой: `message.trim().replace(/\[\[align:...\]\]/g, '')`
8. TokenizedRichInput без `allowAlign` (default false) — кнопок align нет

**Файл: `src/components/admin/communication/BroadcastTemplateDialog.tsx`**
9. TG message (строка 127): без `allowAlign` (default false)
10. Email body (строка ~180): `allowAlign={true}`

---

### PATCH 2 (P0): Убрать TG Preview в быстрой рассылке

**Файл: `src/components/admin/communication/BroadcastsTabContent.tsx`**

Удалить строки 616-627 (блок `{message && (...TelegramMessagePreview...)}`). Импорт `TelegramMessagePreview` (строка 62) и `Eye` (строка 48) — удалить если больше нигде не используются.

---

### PATCH 3 (P0): Bubble позиционирование через `coordsAtPos`

**Файл: `src/components/admin/TokenizedRichInput.tsx`**

Заменить `updateBubble()` (строки 571-613):
- Вместо `window.getSelection().getRangeAt(0).getBoundingClientRect()` использовать:
  ```
  const from = ed.state.selection.from;
  const to = ed.state.selection.to;
  const c1 = ed.view.coordsAtPos(from);
  const c2 = ed.view.coordsAtPos(to);
  const selRect = { left: min(c1.left,c2.left), right: max(c1.right,c2.right),
                    top: min(c1.top,c2.top), bottom: max(c1.bottom,c2.bottom) };
  ```
- Clamp по `editorRect` (как в dropdown), не по viewport:
  ```
  const editorRect = ed.view.dom.getBoundingClientRect();
  let top = selRect.top - toolbarH - 8;
  if (top < editorRect.top + 4) top = selRect.bottom + 6;
  let left = (selRect.left + selRect.right) / 2 - toolbarW / 2;
  left = clamp(left, editorRect.left + 4, editorRect.right - toolbarW - 4);
  ```

---

### Итого файлов

| Файл | Что меняется |
|---|---|
| `TokenizedRichInput.tsx` | `allowAlign` проп, условный рендер align-кнопок, bubble через coordsAtPos + editorRect clamp |
| `BroadcastsTabContent.tsx` | Убрать TG preview, strip align в 3 местах отправки, `allowAlign={true}` на email body |
| `MassBroadcastDialog.tsx` | Strip align перед отправкой |
| `BroadcastTemplateDialog.tsx` | `allowAlign={true}` на email body |

4 файла, без SQL/API/зависимостей.

### DoD
1. TG-редакторы: нет кнопок Align в bubble
2. Email-редакторы: есть кнопки Align
3. TG-отправка (test + mass): текст без `[[align:...]]`
4. TG preview убран из быстрой рассылки
5. Bubble toolbar позиционируется одинаково в модалке и на странице (через coordsAtPos + editorRect)
6. `/admin/communication` без runtime ошибок

