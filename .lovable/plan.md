# да, согласен, с учетом правок:

&nbsp;

1. Зафиксируй **trust boundary** для html block: такой iframe-рендер допустим только для **admin-authored content**. Его нельзя использовать для student/user-generated surfaces без отдельной sanitization policy. Иначе блок превращается в обход более строгих правил других HTML/render paths. Это важно для предсказуемого поведения и безопасного масштабирования. 
2. В HtmlIframePreview явно запиши, что это **shared infrastructure / adapter-like preview layer**, а не место для доменной логики. По стандарту общая логика должна выноситься в shared layer, а UI не должен содержать бизнес-логику. 
3. В VERIFY уточни пункт V3: проверять не “window.parent недоступен” буквально, а что **доступ к parent DOM / cookies / localStorage заблокирован sandbox boundary**. Это точнее отражает security invariant для iframe без allow-same-origin.
4. Добавь отдельный compatibility-check, что существующие TextSection и ColumnsSection **не меняют свое поведение** и остаются на sanitized fragment path. Это соответствует migration strategy: расширение через compatibility layer без поломки существующей production-логики. 
5. Для public renderer зафиксируй инвариант: HTML block не получает прямого доступа к платформенным сервисам и не становится способом выполнять cross-domain действия. По стандарту домены не должны напрямую менять данные других доменов, а интеграции должны идти через adapters. 

&nbsp;

&nbsp;

Plan: Унификация HTML-блока (с учётом всех правок)

## DRY RUN — существующие ресурсы


| Что искали                                | Результат                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Shared iframe preview                     | **Нет** — `src/components/shared/` содержит только `EntityCustomFields.tsx`            |
| `buildSrcdoc` / `IframePreview`           | **Только** в `HtmlRawBlock.tsx` (lesson domain)                                        |
| Другие iframe sandbox                     | **Нет** других iframe в проекте                                                        |
| `dangerouslySetInnerHTML` в site-renderer | 3 места: `HtmlSection.tsx`, `SitePageRenderer.tsx` (TextSection), `ColumnsSection.tsx` |
| Существующие srcdoc helpers               | **Нет** в shared                                                                       |


Вывод: нет существующих shared-компонентов для переиспользования. Нужно создавать с нуля в shared layer.

---

## Архитектура

```text
src/components/shared/
  └── HtmlIframePreview.tsx      ← NEW: buildSrcdoc + IframePreview (shared infra)

src/components/admin/
  ├── lesson-editor/blocks/
  │   └── HtmlRawBlock.tsx       ← MODIFY: импорт из shared, убрать локальные buildSrcdoc/IframePreview
  └── site-builder/blocks/
      └── HtmlBlockEditor.tsx    ← REWRITE: собственный editor с code↔html маппингом,
                                    импорт HtmlIframePreview из shared (НЕ из lesson domain)

src/components/site-renderer/blocks/
  └── HtmlSection.tsx            ← REWRITE: iframe через HtmlIframePreview вместо dangerouslySetInnerHTML
```

Ключевой принцип: **site-builder НЕ импортирует ничего из lesson domain**. Оба домена используют только shared layer.

---

## Шаги

### 1. Создать `src/components/shared/HtmlIframePreview.tsx`

Вынести из `HtmlRawBlock.tsx`:

- `buildSrcdoc(html)` — обёртка HTML в полный документ с auto-resize скриптом
- `IframePreview` — компонент с iframe, авто-высотой через postMessage

**Security boundary (зафиксировано):**

```
sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
```

- **НЕТ** `allow-same-origin` — iframe не получает доступ к parent window, cookies, localStorage
- Минимальные разрешения: скрипты внутри (для resize), ссылки наружу (для навигации), попапы (для target=_blank)
- `<base target="_blank">` в srcdoc — все ссылки открываются в новой вкладке
- iframe content НЕ интегрируется с платформенными сервисами напрямую

### 2. Рефакторить `HtmlRawBlock.tsx` (lesson domain)

- Удалить локальные `buildSrcdoc` и `IframePreview`
- Импортировать `HtmlIframePreview` из `@/components/shared/HtmlIframePreview`
- Остальная логика (file upload, textarea editor, title) — без изменений

### 3. Переписать `HtmlBlockEditor.tsx` (site-builder domain)

- Собственный editor-уровневый код (textarea, file upload, preview toggle)
- Маппинг данных: `content.code` ↔ `html` при передаче в preview
- Импорт **только** `HtmlIframePreview` из shared (не из lesson domain)
- Полная функциональность: загрузка .html файлов, preview, textarea

### 4. Переписать `HtmlSection.tsx` (public renderer)

- Заменить `dangerouslySetInnerHTML` + sanitization на `HtmlIframePreview`
- Маппинг: `content.code` → `html` prop

### 5. Compatibility rule (зафиксировано)

- Существующие site HTML blocks с `{ code: "..." }` продолжают работать без миграции данных
- Маппинг `code` → `html` происходит в runtime при рендере
- Опубликованные страницы не ломаются — iframe рендерит тот же HTML, только безопаснее
- Contract других block types не меняется — `TextSection`, `ColumnsSection` остаются на sanitized innerHTML (это отдельные типы блоков, не `html`)
- `SanitizationAdapter.ts` остаётся для обратной совместимости других блоков

### 6. Isolation invariant (зафиксировано)

HTML block = isolated content block:

- iframe без `allow-same-origin` — нет доступа к parent page
- Нет cross-domain действий через HTML block
- HTML content не интегрируется напрямую с платформенными сервисами
- Если нужна интеграция — используются специализированные block types (form, pricing, etc.)

---

## VERIFY checklist (обязательный после реализации)


| #   | Проверка                                         | Ожидание                           |
| --- | ------------------------------------------------ | ---------------------------------- |
| V1  | Ссылки в iframe открываются в новой вкладке      | target=_blank работает             |
| V2  | Кнопки/загрузки в iframe кликабельны             | Действие выполняется               |
| V3  | `window.parent` из iframe недоступен             | SecurityError при попытке          |
| V4  | Scripts внутри iframe не ломают редактор         | Parent page стабильна              |
| V5  | Существующие site pages с HTML blocks рендерятся | Нет регрессии                      |
| V6  | Lesson HTML blocks работают как раньше           | File upload, preview, student view |


---

## Файлы


| Файл                                                           | Действие                                             |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| `src/components/shared/HtmlIframePreview.tsx`                  | **Создать**                                          |
| `src/components/admin/lesson-editor/blocks/HtmlRawBlock.tsx`   | **Изменить** — импорт из shared                      |
| `src/components/admin/site-builder/blocks/HtmlBlockEditor.tsx` | **Переписать** — собственный editor + shared preview |
| `src/components/site-renderer/blocks/HtmlSection.tsx`          | **Переписать** — iframe вместо innerHTML             |
