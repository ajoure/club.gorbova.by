# да, согласен, с учетом правок:

&nbsp;

1. Страница ca44aae9-db96-4b4b-ae2b-540959b5873a остаётся **только черновиком-шаблоном**. Не публиковать, не привязывать к доменам, DomainRouter и routing gate сейчас не трогать.
2. PATCH A по rich-text принять как обязательный:
  &nbsp;
  - использовать **ровно тот же** FloatingToolbar + RichTextarea, что уже работают в тренингах;
  - не делать новый редактор и не вводить новый формат хранения;
  - подключить toolbar в Site Builder на верхнем уровне редактора;
  - перевести на reused rich-text **все контентные поля**, а не выборочно.
  &nbsp;
3. Перед execution PATCH A сделать короткий discovery-список:
  &nbsp;
  - какие поля переводятся на rich-text;
  - какие поля остаются plain/technical;
  - в каких renderer-блоках сейчас текст выводится как plain string и где нужно перейти на безопасный HTML renderer.
  &nbsp;
4. В PATCH A явно разделить поля:
  &nbsp;
  - **контентные**: title, subtitle, description, text, label, question, answer, testimonial text, CTA text, field labels формы и т.д. → rich-text;
  - **технические**: slug, anchorId, URL, domain, product_id, tariff_id, padding, color, width, enum/select/switch, numeric fields → не трогаем.
  &nbsp;
5. PATCH B по clone обязателен, иначе шаблон как шаблон не закрыт:
  &nbsp;
  - при копировании страницы очищать site_pages.product_id;
  - в дубле очищать content.product_id у всех pricing блоков;
  - дубль всегда создавать как draft;
  - title/slug дубля делать уникальными;
  - после открытия дубля должно быть видно, что продукт нужно выбрать вручную.
  &nbsp;
6. В proof по clone нужны факты, а не теория:
  &nbsp;
  - клик «Копировать»;
  - дубль появился в списке;
  - дубль открывается в editor без warnings;
  - у дубля page-level product_id = null;
  - у pricing-блока content.product_id = null;
  - preview дубля открывается.
  &nbsp;
7. В PATCH C по proof обязательно показать identity reused editor:
  &nbsp;
  - один скрин/доказательство toolbar в тренингах;
  - один скрин/доказательство того же toolbar в Site Builder;
  - одинаковый набор кнопок форматирования.
  &nbsp;
8. По rich-text proof нужен минимальный реальный сценарий:
  &nbsp;
  - изменить текст в шаблоне;
  - применить bold/italic/align;
  - сохранить;
  - открыть preview;
  - убедиться, что форматирование реально отображается;
  - вернуть обратно и снова сохранить.
  &nbsp;
9. Mobile proof нужен фактический, не теоретический:
  &nbsp;
  - либо viewport 390×844 в preview/editor;
  - либо опубликованный preview URL без публикации на домен;
  - но обязательно скрин реального mobile render после rich-text правки.
  &nbsp;
10. В финальном отчёте разделить статусы на 3 блока:

&nbsp;

&nbsp;

&nbsp;

- **подтверждено фактами**;
- **исправлено в этом PATCH**;
- **отложено вне scope**.

&nbsp;

&nbsp;

&nbsp;

11. Отдельно в финальном отчёте дать сводку по шаблону:

&nbsp;

&nbsp;

&nbsp;

- page_id;
- slug;
- текущий product_id;
- список 9 блоков по порядку;
- какие блоки используют reusable controls;
- что остаётся out-of-scope.

&nbsp;

&nbsp;

&nbsp;

12. Переименование страницы в **«Шаблон — Платная консультация»** допустимо только если не ломает текущие проверки и не мешает proof. Если мешает — оставить текущее имя, но в отчёте явно зафиксировать, что это шаблон.
13. Никаких page-specific хаков под Consultation не добавлять. И rich-text, и clone-fix должны быть **общими улучшениями конструктора сайтов**.

&nbsp;

&nbsp;

После этого уже можно будет отдельно делать следующий gate по routing/domain binding для [consultation-доменов.](http://consultation-доменов.Mini)

&nbsp;

[Mini](http://consultation-доменов.Mini)-plan: 3 PATCH (add-only) для конструктора + закрытие Фазы 4

## Контекст и фиксация по Фазе 4

**Статус:** draft-шаблон создан, **остаётся черновиком**. Публичный routing для consultation-доменов **не запускаем**, `DomainRouter` не трогаем. Страница `ca44aae9...` — шаблон для копирования и ручного редактирования через UI.

## Discovery (что уже подтверждено чтением кода)

**Канонический rich-text стек (из тренингов):**

- `src/components/ui/RichTextarea.tsx` — обёртка `contentEditable` с маркером `data-rich-editable="true"`
- `src/components/ui/FloatingToolbar.tsx` — глобальный popup, появляется при выделении внутри любого `[data-rich-editable]`. Поддерживает: **Bold, Italic, Underline, Strikethrough, Color, Font size, Link/Unlink, Align L/C/R**
- Хранение: HTML-строка в том же поле. Контракт уже используется `TextBlockEditor` (`content.html`) — второго формата вводить не нужно
- Toolbar монтируется **один раз** на верхнем уровне (`LessonBlockEditor`, строка 518: `<FloatingToolbar />`). В Site Builder его **не монтируют** — отсюда отсутствие popup

**Site Builder editor entry point:** `src/pages/admin/AdminSiteEditor.tsx` → `<SiteBlockEditor>` (строка 158). Сюда же добавляется `<FloatingToolbar />`.

**Clone:** `useSitePages.copyPage` (`AdminSiteBuilder.tsx:120`) — это и есть существующий путь дублирования. Падает из-за `idx_site_pages_product_id_unique` (зафиксировано в `mem://architecture/site-builder/clone-product-id-constraint.md`).

**Классификация полей по 25 редакторам блоков (`src/components/admin/site-builder/blocks/*`):**


| Группа                          | Поля → действие                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Контентные (→ RichTextarea)** | Hero: title, subtitle, buttonText. Heading: text. Cta: title, subtitle, buttonText. Faq: question, answer. Testimonials: text, author, role. Features: title, description (per item). Stats: label, suffix. Pricing: title, subtitle. Columns: cell text. Form: title, subtitle, buttonText, field.label. Logos: caption. Button: label. |
| **Технические (НЕ трогаем)**    | slug, anchorId, URL, href, video URL, embed code, productId, tariffId, formId, mappingKey, padding/margin/числовые, width/height, color hex, switch, select (variant/level/layout/icon mode), domain, sort_order, ID                                                                                                                     |


---

## PATCH A — Reused rich-text toolbar в Site Builder

**Цель:** один и тот же floating popup в тренингах и в Site Builder. Никакого второго редактора и второго формата хранения.

**Шаги:**

1. **Монтирование toolbar (1 строка):** в `src/pages/admin/AdminSiteEditor.tsx` рядом с `<SiteBlockEditor>` добавить `<FloatingToolbar />` (как в `LessonBlockEditor`). Это сразу включает форматирование для всех уже существующих `RichTextarea` в Site Builder (`TextBlockEditor`).
2. **Замена контентных `Input/Textarea` на `RichTextarea**` в редакторах блоков (только контентные поля из таблицы выше, технические не трогаем):
  - `HeroBlockEditor` — title (inline), subtitle, buttonText (inline)
  - `HeadingBlockEditor` — text (inline)
  - `CtaBlockEditor` — title (inline), subtitle, buttonText (inline)
  - `FaqBlockEditor` — question (inline), answer
  - `TestimonialsBlockEditor` — text, author (inline), role (inline)
  - `FeaturesBlockEditor` — title (inline), description (per item)
  - `StatsBlockEditor` — label (inline), suffix (inline)
  - `PricingBlockEditor` — title (inline), subtitle
  - `FormBlockEditor` — title (inline), subtitle, buttonText (inline), field.label (inline)
  - `ButtonBlockEditor` — label (inline)
  - `ColumnsBlockEditor` — text cells
  - `LogosBlockEditor` — caption (inline)
   Где сейчас `<Input>` для короткой строки → `<RichTextarea inline />` (контракт уже есть). Где `<Textarea>` → `<RichTextarea />`. Контракт `value: string (HTML) / onChange(html)` совпадает с текущим `e.target.value` после простой адаптации.
3. **Рендер на публичной стороне:** проверить, что соответствующие renderer-блоки уже выводят HTML через `dangerouslySetInnerHTML`/`SafeHtml`. Где встречается plain text вывод (`{title}`) — заменить на `<SafeHtml html={...} />` (компонент уже есть, используется в lesson blocks). Это разовая правка по тем же блокам.
4. **Backward compatibility:** старый plain-text сохранится — `RichTextarea` выведет его как есть (innerHTML текста = тот же текст).

**Out of scope:** новый редактор, новые библиотеки (TipTap и т.п.), новый формат хранения, любые правки технических полей.

---

## PATCH B — Clone-template fix для product-bound pages

**Цель:** `copyPage` работает на страницах с `product_id` без падения unique constraint; дубль создаётся как «несвязанный» шаблон.

**Шаги (в `useSitePages.copyPage` / `SitePageService`):**

1. При копировании **не переносить** `product_id` в дубль (записывать `null`).
2. Пройти по `blocks` дубля и для каждого блока с `type === "pricing"` обнулить `content.product_id` (и любые tariff overrides), оставив структуру блока валидной.
3. Поставить дубль в `status: "draft"`, добавить суффикс к title (`"… (копия)"`) и slug (`"<slug>-copy-<n>"` с проверкой уникальности).
4. После открытия дубля редактор показывает баннер «Страница не привязана к продукту» (используется существующий `selling-page-diagnostic-states`, состояние `not_linked`) — пользователь вручную выбирает product в `SiteSettingsPanel` и в `PricingBlockEditor`.

**Out of scope:** автоматическое присвоение product, новые поля в схеме, изменения unique constraint.

---

## PATCH C — Proof-пакет (browser live-proof, в default mode)

**Closing для Фазы 4 + acceptance для PATCH A/B.**

Сценарии (screenshots в порядке выполнения):

1. **Rich-text identity:** popup в тренинг-уроке + popup в Site Builder editor — одинаковые иконки/набор кнопок.
2. **Форматирование в Site Builder:** на странице `ca44aae9...` выделить текст в hero subtitle → Bold + Italic + Align center → Save.
3. **Persist:** перезагрузить editor → форматирование на месте; preview desktop → форматирование применено; preview mobile (390×844) → корректный рендер.
4. **UI Save (закрытие 8/9 пробелов Фазы 4):** изменение поля → save → reload → значение сохранилось → откат.
5. **Clone (закрытие 9/9):** на template-странице нажать «Дублировать» → дубль появляется в списке → открыть дубль → editor без warnings → product_id пуст → pricing block требует выбора продукта → screenshot всех четырёх состояний.
6. **Переименование template (опционально):** title → «Шаблон — Платная консультация» (если не ломает ссылки/проверки; иначе оставить, в отчёте назвать шаблоном).

---

## DoD Фазы 4 (финальная сводка по 3 блокам)

**Подтверждено фактами:**

- draft-шаблон создан, blocks JSON валиден, editor/preview desktop без warnings, pricing резолвит 4 тарифа канонически
- UI Save верифицирован (после PATCH C)

**Подтверждается этим mini-plan'ом (после PATCH A+B+C):**

- rich-text форматирование в Site Builder идентично тренингам
- UI Clone работает на product-bound страницах
- mobile preview — фактический скрин

**Отложено в следующий gate (явно):**

- routing gate / `site_domain_bindings` для consultation-доменов
- любые правки `DomainRouter`
- публикация шаблона

---

## Технические нотки

- Файлы в `src/components/admin/site-builder/blocks/*Editor.tsx` — точечные правки JSX (Input/Textarea → RichTextarea + при необходимости `inline`).
- `AdminSiteEditor.tsx` — одна строка `<FloatingToolbar />`.
- `useSitePages.copyPage` (или соответствующий `SitePageService.copyPage`) — добавить очистку product_id страницы и `content.product_id` в pricing-блоках.
- Никаких миграций БД, новых RPC, новых edge functions.
- Никаких page-specific хаков под Consultation: и rich-text, и clone-fix — общие reusable улучшения конструктора.

## Финальный блок шаблона (после PATCH B/C, для отчёта)

- `page_id`: `ca44aae9-db96-4b4b-ae2b-540959b5873a`
- `slug`: `consultation`
- `product_id`: `9d0d6de8-4b0e-477f-b6c4-ab7def8268f6`
- 9 блоков: hero · heading(#audience) · text · features(card-list) · stats(#results) · features(card-list) · pricing(#tariffs) · heading(#after-payment) · features(numbered-list)
- Reusable controls (после PATCH A): rich-text во всех контентных полях каждого блока
- Out-of-scope: routing/domain binding, публикация, html-fallback (gap=0), sticky nav, footer, animations