да, согласен, с учетом правок:

1. Блок footer нужно не только добавить в палитру, но и **сразу автоматически вставить в уже созданный draft Consultation** в конец страницы, чтобы шаблон был полностью собран без ручной сборки.
2. Зафиксируй явно модель данных:
  - **источник дефолтов один** — shared constants/module;
  - **после вставки блока** данные становятся обычным block.content этой страницы;
  - дальнейшее редактирование footer в странице **не должно менять** глобальный UnifiedFooter и другие страницы.
3. Нужна таблица соответствия **“текущий UnifiedFooter → поле нового footer block”**, чтобы не потерять ни один элемент:
  - бренд,
  - контакты,
  - email,
  - телефон,
  - адрес,
  - УНП/юр. данные,
  - публичная оферта,
  - политика,
  - consent,
  - order-payment,
  - copyright,
  - прочие текущие ссылки.
4. В editor footer-блока использовать тот же reusable rich-text стек, который уже добавлен в Site Builder:  

  - RichTextarea + FloatingToolbar
  - для брендового текста,
  - описания,
  - заголовков секций,
  - copyright,
  - подписей ссылок, где это уместно.  
  Технические поля (href, email, phone, route) оставить обычными input.
5. Для ссылок и контактов добавь не только label/url, но и минимально нужные флаги:
  - openInNewTab,
  - isExternal или эквивалент без дублирования логики,
  - для телефона/email рендер tel: / mailto:.  
  Это нужно, чтобы footer был реально reusable для новых сайтов.
6. Нужен явный proof, что **визуально footer-блок совпадает с текущим UnifiedFooter**:
  - текущий footer,
  - новый footer block в preview,
  - сравнение бок о бок.  
  Не просто “похож”, а фактический parity-proof.
7. Нужен proof, что **редактирование footer в Consultation draft** не ломает глобальный footer:
  - поменять 1 поле в footer block,
  - увидеть изменение только в draft preview,
  - открыть страницу/экран, где используется UnifiedFooter,
  - подтвердить, что там всё осталось как было.
8. Проверь и зафиксируй поведение clone:
  - если копируем страницу с footer block, весь footer content должен переноситься как есть;
  - никаких скрытых привязок к global state после копии быть не должно.
9. В финальном отчёте раздели статус на:
  - **подтверждено фактами**,
  - **не подтверждено**,
  - **отложено**.  
  И отдельным блоком дай:
  - page_id Consultation draft,
  - был ли footer автоматически добавлен,
  - список секций footer,
  - какие поля реально настраиваются через UI.
10. Не публиковать, не трогать routing/domain bindings, не менять global footer поведение на действующих сайтах. Только reusable block + вставка в draft Consultation + proof.

&nbsp;

&nbsp;

## План: reusable footer-блок для конструктора сайтов

### Решение

**Вариант A** — новый block type `footer` в Site Builder. Без глобальных settings, без второго source of truth. Дефолты блока берём из единственного существующего источника — `UnifiedFooter.tsx` — через **shared constants module**, чтобы текущий `UnifiedFooter` и новый блок читали одни и те же данные. Никакой второй копии данных.

### Почему так

- Глобальный footer на builder-страницах сейчас НЕ рендерится (`SitePageBySlug`, `SiteBuilderPageWithPricing` — без footer). Двойного footer не будет by design.
- `getDefaultContent()` уже даёт нам «insert with preset». Отдельный template-механизм не нужен.
- Расширять `UnifiedFooter` под data-driven props — лишний риск регрессии. Делаем add-only: новый блок + новый renderer-компонент, который визуально идентичен `UnifiedFooter`, но получает данные из `block.content`.

### Discovery proof (already done)

- Текущий footer: `src/components/layout/UnifiedFooter.tsx` (хардкод).
- Re-exports: `LandingFooter`, `ConsultationFooter`, `ProductLandingFooter` — все обёртки над `UnifiedFooter`. Не трогаем.
- Builder render path: `SitePageRenderer` → отдельные `*Section.tsx`. Footer-секции нет.
- Реестр блоков: `BLOCK_TYPES`, `getDefaultContent`, `BlockEditorComponent` в `SiteBlockEditor.tsx`.
- Схема: `blockContentSchemas` в `src/services/sitePages/types.ts`.
- Preset-механика: уже встроена в `addBlock` через `getDefaultContent`.

### Что меняется (add-only)

1. `**src/components/layout/footerDefaults.ts**` (новый) — единственный источник company/legal/contacts/social/документов. Экспортирует константы:
  - `COMPANY_INFO` (название, УНП, адреса, телефон, email, режим работы)
  - `LEGAL_LINKS` (offer / order-payment / privacy / consent)
  - `SOCIAL_LINKS` (пусто по умолчанию — `UnifiedFooter` сейчас соцсети не показывает)
  - `BRAND_INFO` (logo path, brand name, subtitle)
  - функция `buildFooterDefaultContent()` → возвращает дефолтный `content` для нового блока.
2. `**src/components/layout/UnifiedFooter.tsx**` — рефакторинг **только на чтение констант** из `footerDefaults.ts`. Внешний контракт компонента не меняется. Визуально идентично. Это устраняет дублирование «второй копии данных».
3. `**src/services/sitePages/types.ts**` — добавить `footerContentSchema` и зарегистрировать в `blockContentSchemas`:
  ```
   footer: {
     brand: { logoUrl, name, subtitle, showBrand },
     company: { name, unp, legalAddress, mailingAddress, phone, email, workHours, showCompany },
     navigation: { showNavigation, title, items: [{ label, href, anchor }] },
     legal: { showLegal, title, items: [{ label, href }] },
     social: { showSocial, items: [{ platform, url, label }] },
     payments: { showPayments },
     copyright: { showCopyright, text }  // text пустой → авто "© YYYY {company.name}"
   }
  ```
   Все группы имеют `show*` toggle для скрытия секций.
4. `**src/components/admin/site-builder/blocks/FooterBlockEditor.tsx**` (новый) — UI редактор:
  - 6 свернутых секций (Collapsible): Бренд / Компания / Навигация / Документы / Соцсети / Прочее.
  - В каждой секции — `Switch` (показывать/скрыть) + поля.
  - Списки (навигация, документы, соцсети) — `Input` rows с кнопками «Добавить» / «Удалить» / «Вверх» / «Вниз». Reuse паттерна из `FaqBlockEditor` / `SocialBlockEditor`.
  - Соцсети — переиспользовать `SOCIAL_PLATFORMS` enum из `socialContentSchema`.
5. `**src/components/site-renderer/blocks/FooterSection.tsx**` (новый) — публичный рендерер. Визуально идентичен `UnifiedFooter`, но данные берёт из `block.content`. Уважает все `show*` флаги. Если все секции скрыты — `return null`.
6. `**src/components/admin/site-builder/SiteBlockEditor.tsx**`:
  - В `BLOCK_TYPES` добавить запись `{ type: "footer", label: "Подвал", icon: <PanelBottom .../> }`.
  - В `getDefaultContent("footer")` вернуть `buildFooterDefaultContent()` — блок вставляется уже заполненным.
  - В `BlockEditorComponent` — кейс `"footer"` → `<FooterBlockEditor />`.
7. `**src/components/site-renderer/SitePageRenderer.tsx**` — добавить кейс `"footer"` → `<FooterSection />`. (Найти switch блоков и добавить ветку. Wrapping/visibility через существующий `BlockWrapper`.)

### Что НЕ меняется

- `UnifiedFooter` визуально и по контракту props — не меняется (только источник данных = константы).
- `LandingFooter`, `ConsultationFooter`, `ProductLandingFooter` — не трогаем.
- Routing, domain bindings, publish flow — не трогаем.
- `SitePageBySlug`, `DomainRouter` — не трогаем (footer-блок добавляется опционально в самой странице).
- БД, EF, миграции — не нужны (`block.content` — JSON).
- `pricingContentSchema`, `tariff_filter_mode`, checkout — не задеты.

### Файлы

Новые:

- `src/components/layout/footerDefaults.ts`
- `src/components/admin/site-builder/blocks/FooterBlockEditor.tsx`
- `src/components/site-renderer/blocks/FooterSection.tsx`

Изменяемые (add-only):

- `src/services/sitePages/types.ts` — добавить `footerContentSchema` в schemas map.
- `src/components/admin/site-builder/SiteBlockEditor.tsx` — регистрация типа + default + editor.
- `src/components/site-renderer/SitePageRenderer.tsx` — рендер кейс.
- `src/components/layout/UnifiedFooter.tsx` — заменить хардкод на чтение из `footerDefaults.ts` (визуально без изменений).

### DoD / Proof

1. **Discovery proof** — описан выше: единственный источник footer = `UnifiedFooter`, builder-страницы footer не рендерят, preset-механика уже встроена в `getDefaultContent`.
2. **Палитра** — в дропдауне «Добавить блок» виден пункт «Подвал» с иконкой `PanelBottom`.
3. **Insert preset** — после клика блок вставлен с заполненными: название «БУКВА ЗАКОНА», УНП 193405000, адрес Минск/Панфилова, тел `+375 29 171-43-21`, email `info@ajoure.by`, ссылки `/offer`, `/order-payment`, `/privacy`, `/consent`, copyright `© {год} ЗАО «АЖУР инкам»…`.
4. **Editor** — открывается без warnings, все 6 секций редактируемы, toggles работают, добавление/удаление пунктов работает, изменение названия компании отражается в copyright (если поле пустое).
5. **Preview** — в `SitePreview` блок рендерится визуально идентично `UnifiedFooter`. Скрытие секции через toggle убирает её из preview.
6. **Consultation draft** — можно добавить `footer`-блок в существующий draft без правок кода. Глобального footer на builder-странице нет → двойного footer не возникает.
7. **Regression** — `Landing`, `Consultation`, `Pay`, `Privacy`, `Consent`, `Contacts`, `BusinessTraining`, `ProductLanding` рендерят footer как раньше (`UnifiedFooter` не сломан, props не меняются, визуал идентичен).
8. **Backward-compat** — существующие builder-страницы без `footer`-блока рендерятся как раньше (новый кейс в switch — additive).