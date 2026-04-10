# да, согласен, с учетом правок:

&nbsp;

1. Это только **PATCH на sanitization label/title**, а не закрытие всей задачи по динамической таблице прогресса. В плане явно пометь:
  &nbsp;
  - **старый scope**: dynamic columns + modal + feedback badges + feedback entry points + proof;
  - **новый PATCH**: только raw HTML in block labels/titles.
    Не заменять и не считать старую задачу закрытой.
  &nbsp;
2. Добавь **add-only mapping**:
  &nbsp;
  - старый пункт: dynamic progress table → остается без изменений;
  - старый пункт: universal modal renderer → остается без изменений;
  - старый пункт: feedback badges / drawer → остается без изменений;
  - новый пункт: stripHtml in shared label resolver → добавляется как отдельный bugfix.
  &nbsp;
3. Исправление должно покрывать **не только title, но и все display-label входы**, которые уходят в UI:
  &nbsp;
  - content.title
  - content.label
  - blockTitle для FeedbackDrawer
  - любые derived labels, если есть fallback из content.
    Нужно явно написать: **единый sanitize layer для display-only labels**.
  &nbsp;
4. stripHtml через regex слишком хрупкий. Добавь правило:
  &nbsp;
  - sanitize только для **display text**,
  - без dangerouslySetInnerHTML,
  - с decode HTML entities, если они встречаются,
  - с нормализацией пробелов после удаления тегов.
    Иначе можно получить мусорный текст вроде слипшихся слов.
  &nbsp;
5. Нужен отдельный guard:
  &nbsp;
  - если после sanitize строка пустая, использовать fallback blockTypeLabel(block.block_type).
    Иначе колонка/заголовок может стать пустым.
  &nbsp;
6. Добавь **proof requirements**:
  &nbsp;
  - before/after на таблице прогресса;
  - before/after на StudentProgressModal;
  - before/after на FeedbackDrawer;
  - пример именно с проблемным diagnostic_table, где раньше был raw HTML.
  &nbsp;
7. В DoD добавь:
  &nbsp;
  - в UI нигде не показываются raw tags <p>, <strong>, <span>, <br> в названиях блоков;
  - sanitize применяется только к label/title display layer и **не ломает** HTML там, где он должен рендериться как rich text внутри самих уроков;
  - старые пункты плана по dynamic progress / feedback остаются открытыми до отдельного runtime proof.
  &nbsp;
8. Добавь явную фразу:
  &nbsp;
  - **Этот PATCH не закрывает ранее выявленные замечания по runtime proof, anti-N+1, legacy fallback и полноте рендера block types.**
    Он чинит только конкретный дефект отображения label/title.
  &nbsp;

&nbsp;

&nbsp;

Если он внесет эти правки, план можно утверждать.

&nbsp;

План: Исправление багов в динамических таблицах прогресса

## Проблема

На скриншотах видно две критических ошибки:

1. **Raw HTML в заголовках колонок и модалке** — блок `diagnostic_table` имеет `title` с HTML-разметкой (`<div style="text-align: left;"><span style="font-size: 0.875rem;">...`). Функция `getBlockLabel()` в `blockProgressResolver.ts` возвращает его как есть, и он рендерится как текст.
2. **Raw HTML в заголовке FeedbackDrawer** — тот же HTML-title пробрасывается как `blockTitle` в Feedback Drawer (скриншот 3).

## Что делаем

### 1. Добавить stripHtml в blockProgressResolver.ts

Добавить утилиту `stripHtml(html: string): string` — убирает теги, оставляет только текст. Использовать в `getBlockLabel()`.

```typescript
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

export function getBlockLabel(block: BlockMeta): string {
  const content = block.content as Record<string, unknown> | null;
  if (content?.title && typeof content.title === "string") return stripHtml(content.title);
  if (content?.label && typeof content.label === "string") return stripHtml(content.label);
  return blockTypeLabel(block.block_type);
}
```

### 2. Проверка — без других файлов

Поскольку `getBlockLabel` — единый SoT для лейблов (используется и в `AdminLessonProgress`, и в `StudentProgressModal`), исправление в одном месте чинит оба экрана и Feedback Drawer.

## Файлы


| Файл                               | Что меняется                                      |
| ---------------------------------- | ------------------------------------------------- |
| `src/lib/blockProgressResolver.ts` | Добавить `stripHtml`, применить в `getBlockLabel` |


## DoD

- Колонка в таблице показывает чистый текст «Аналитика портфеля клиентов» вместо raw HTML
- Модалка показывает чистый текст в заголовке блока
- Feedback Drawer показывает чистый текст в заголовке