# дополни план следующей информацией:

&nbsp;

1. **Жёсткий reuse-guard для embed form**
  Сначала в discovery докажи, можно ли переиспользовать **существующий публичный submit path site forms**.
  supabase/functions/embed-form-submit/index.ts создавать **только если** existing path нельзя безопасно использовать для внешнего popup/embed.
  В отчёте обязателен блок:
  existing submit path -> можно reuse / нельзя reuse -> почему.
2. **Явная политика guest/auth для questionnaire**
  Сейчас в плане не зафиксировано самое важное: questionnaire на сайте проходит
  &nbsp;
  - только авторизованный пользователь, или
  - гость тоже может пройти.
    Это нужно определить до execution, потому что от этого зависит canonical storage path и contact resolve.
    В discovery добавить отдельный раздел:
    guest mode policy / auth-required policy / contact-resolve chain / dedup rules.
  &nbsp;
3. **Явная политика повторного прохождения**
  Для questionnaire нельзя оставлять это “по факту посмотрим”.
  В плане нужно заранее зафиксировать для site-questionnaire:
  &nbsp;
  - new session every submit, либо
  - update latest response, либо
  - policy per questionnaire.
    И отдельно указать, как это отображается в:
  - карточке контакта
  - /admin/forms
  - detail viewer.
  &nbsp;
4. **Не создавать новый editor для questionnaire без discovery-proof**
  QuestionnaireBlockEditor.tsx допустим **только как тонкий selector/wrapper** над existing training/questionnaire editor schema.
  Запретить создание второго самостоятельного конструктора вопросов для сайта.
  В плане явно допиши:
  если existing lesson_blocks editor можно reuse -> нового редактора вопросов не делаем.
5. **Source-of-truth для site-questionnaire должен быть один**
  В плане сейчас есть две ветки решения. Это нормально для discovery, но нужен guard:
  &nbsp;
  - либо reuse user_lesson_progress через canonical/virtual lesson path,
  - либо blocker report.
    Не допускать параллельного хранения “часть в site_form_submissions, часть в отдельной questionnaire table”.
    Один questionnaire response path на весь проект.
  &nbsp;
6. **E2E proof должен включать полный путь по данным, не только UI**
  Для каждого из трёх потоков:
  &nbsp;
  - site_form
  - embed_form
  - site_questionnaire
    показать chain:
    submit -> DB row -> contact resolve -> /admin/forms -> contact card -> detail viewer.
    Не просто скрины, а ещё конкретные DB proof по связанным id.
  &nbsp;
7. **Для anchors/button actions добавь canonical runtime mapping**
  В discovery нужно отдельно показать:
  какой текущий runtime уже исполняет button click,
  где хранится block identity,
  какой canonical block id использовать как target.
  Нужно прямо запретить любые временные target-ключи по title/name/index. Только стабильный block id / anchor id.
8. **В regression добавить обязательную проверку конструктора сайтов end-to-end**
  Помимо submit flows, нужно отдельно проверить:
  &nbsp;
  - сохранение страницы после добавления anchors/actions/questionnaire
  - повторное открытие editor
  - preview
  - publish/live
  - что после publish всё ещё работает, а не только preview.
  &nbsp;
9. **Не трогать уже закрытый домен “Анкеты и данные” кроме invalidate/wiring**
  Явно допиши в guards:
  никакой переделки /admin/forms, ContactArtifactsTab, viewers, exports, filters, table engine — только подключение новых источников и invalidate, если действительно нужно.
10. **Финальный DoD по спринту**
  Добавь в конец плана короткий итоговый DoD:

&nbsp;

&nbsp;

&nbsp;

- anchors работают
- button actions работают
- visibility engine работает
- embed form сохраняет в canonical path
- site questionnaire использует existing engine, без второго движка
- все новые записи видны в /admin/forms и в карточке контакта
- полный E2E proof приложен
- regression по existing site forms и training не сломан

&nbsp;

&nbsp;

После этих правок план уже можно отдавать в работу.

&nbsp;

План: Конструктор сайтов — anchors, button actions, embed forms, унифицированный questionnaire engine (v2)

## 0. Discovery (обязателен до execution)

### 0.1 Canonical UI source of truth

- canonical таблица: `FormsHubTable` + `SortableResizableTableHead`
- canonical date picker: `src/components/ui/date-picker.tsx`
- canonical detail viewers: `StudentProgressModal`, `PreregistrationDetailSheet`, site_form detail dialog
- canonical button/block editor: `ButtonSection.tsx`, `ButtonBlockEditor.tsx`, `BlockSettingsEditor.tsx`

### 0.2 Canonical data sources

- existing **public submit path** для site forms — найти и зафиксировать (edge function/RPC/direct insert + RLS)
- existing questionnaire engine: `lesson_blocks` + `user_lesson_progress`
- contact resolve chain (как сейчас работает для site_form / preorder)
- dedup rules

### 0.3 Mapping (артефакт перед PATCH A)


| Новый функционал   | Reuse из                                                   | Расширение add-only    |
| ------------------ | ---------------------------------------------------------- | ---------------------- |
| anchor_id блока    | `BlockSettings`                                            | `+ anchorId?: string`  |
| button actions     | `ButtonSection`                                            | `content.action` union |
| visibility         | новый context                                              | —                      |
| embed form         | **existing public submit path** (см. discovery 0.4)        | popup/iframe wrapper   |
| site questionnaire | training engine (`lesson_blocks` + `user_lesson_progress`) | source-маркер          |


### 0.4 Reuse-guard для embed form (НОВОЕ, обязателен)

До любых правок:

1. Найти existing public submit endpoint для site forms (edge function или direct insert через anon RLS).
2. В отчёте discovery — обязательный блок:
  ```
   existing submit path: <путь>
   можно reuse для external embed: ДА / НЕТ
   причина: <CORS / RLS / contact resolve / dedup>
  ```
3. **Только если reuse невозможен** — создавать `supabase/functions/embed-form-submit/index.ts` как тонкий прокси к canonical contact-resolve, без дублирования бизнес-логики.

### 0.5 Guest/auth policy для questionnaire (НОВОЕ, обязателен)

Зафиксировать ДО execution отдельным разделом discovery:

- **режим**: только авторизованный / гость+авторизованный / выбирается per-questionnaire
- **canonical storage path** при guest mode (если разрешён): через какой механизм пишется `user_lesson_progress` без `auth.uid()`?
- **contact resolve chain**: email/phone из ответов → существующий contact resolve (тот же, что у site_form)
- **dedup rules**: что считается дубликатом submit

Решение принимается в discovery. Если guest mode требует второго storage — это **blocker report**, не execution.

### 0.6 Политика повторного прохождения (НОВОЕ, обязателен)

Зафиксировать ДО execution:

- **default**: `new session every submit` / `update latest response` / `policy per questionnaire` (поле в block content)
- как отображается:
  - в карточке контакта (одна запись vs история)
  - в `/admin/forms` (одна строка vs N строк)
  - в detail viewer (последняя vs выбор сессии)

Без этого решения PATCH E не стартует.

### 0.7 Canonical runtime mapping для anchors/button actions (НОВОЕ, обязателен)

В discovery показать:

- какой runtime сейчас исполняет click на site button (`ButtonSection.tsx` → `<a href>`)
- где хранится block identity (`SiteBlock.id` — UUID)
- canonical target ключ: **только stable `block.id` (UUID) и `anchorId` (slug, validated unique per page)**
- **запрещено**: target по title/name/index/order

### 0.8 Source-of-truth guard для site-questionnaire (НОВОЕ)

Только один из вариантов:

- **A**: reuse `user_lesson_progress` через canonical lesson путь (с маркером source='site' или virtual lesson внутри служебного module)
- **B**: blocker report

**Запрещено**: параллельное хранение части ответов в `site_form_submissions`, части — в отдельной questionnaire table. Один response path на весь проект.

---

## PATCH A — Anchors

**Файлы:** `services/sitePages/types.ts`, `BlockSettingsEditor.tsx`, `SitePageService.ts` (валидация уникальности), `useSitePageAnchors.ts` (новый, реестр), `SitePageRenderer.tsx` (рендер `id=` + smooth scroll).

**DoD:** anchor задаётся, дубликаты блокируются на save, scroll работает на preview/live, broken reference невозможен (select только из реестра).

---

## PATCH B — Button actions

**Файлы:** `services/sitePages/types.ts` (action union), `ButtonBlockEditor.tsx` (target picker из реального реестра — **только block.id / anchorId**), `ButtonSection.tsx` (runtime executor).

**Validation:** target обязателен для action≠link; self-target запрещён; target должен существовать; backward-compat для старых link-кнопок.

**DoD:** все 5 action types работают, invalid target не сохраняется, link не сломан.

---

## PATCH C — Visibility engine

**Файлы:** `BlockSettings.initialVisibility`, `BlockSettingsEditor.tsx`, `SiteVisibilityContext.tsx` (новый), `SitePageRenderer.tsx` (provider + skip render/`hidden`).

**DoD:** hidden block не виден на first render, show/toggle работает, reload восстанавливает initial state.

---

## PATCH D — Embeddable form

**Гейт**: PATCH D стартует только после прохождения reuse-guard 0.4.

**Если reuse possible**: добавить только popup/iframe wrapper + статический `public/embed/form.js` + админ-кнопка «Получить embed code». Никаких новых edge functions.

**Если reuse impossible**: тонкий `supabase/functions/embed-form-submit/index.ts` как прокси к canonical contact-resolve. Никакой бизнес-логики дубликатов.

**Запись только в `site_form_submissions**` (canonical). Никаких новых таблиц.

**DoD:** embed на внешней странице → submit → запись в `site_form_submissions` → видна в `/admin/forms` → detail через canonical viewer.

---

## PATCH E — Site questionnaire (reuse training engine)

**Гейты**: 0.5 (guest/auth) + 0.6 (повторное прохождение) + 0.8 (single source-of-truth) — ДО execution.

**Файлы:**

- `SiteQuestionnaireBlock.tsx` — тонкий wrapper, резолвит lesson_id → рендерит **существующий** questionnaire renderer 1:1
- `QuestionnaireBlockEditor.tsx` — **только тонкий selector/wrapper**: выбор существующего questionnaire из библиотеки ИЛИ открытие existing `lesson_blocks` editor. **Запрещено** создавать второй конструктор вопросов.

**Если existing `lesson_blocks` editor можно reuse → нового редактора вопросов НЕ делаем.** Только селектор + ссылка на canonical editor.

**Storage**: только `user_lesson_progress` (через canonical/virtual lesson path).

**Видимость в `/admin/forms**`: расширить `useFormsHubData.ts` add-only, чтобы включать `user_lesson_progress` с source='site'. Никаких изменений UI/viewers.

**DoD:** block добавляется → preview step flow → submit → `user_lesson_progress` → видно в карточке контакта (ContactArtifactsTab) и в `/admin/forms` → detail через `StudentProgressModal`.

---

## PATCH F — Unified contact path E2E

Никаких новых сущностей. Только верификация invalidate queries для трёх потоков (site_form / embed_form / site_questionnaire). Минимальное wiring, не более.

---

## QA runbook (E2E с DB proof)

Для каждого потока (**site_form / embed_form / site_questionnaire**) приложить полную цепочку:

```
submit → DB row (id) → contact resolve (contact_id) → /admin/forms (строка) → contact card (запись) → detail viewer (открылся)
```

С конкретными UUID, не только скринами.

### A. Anchors (5 кейсов): 2 scroll-кнопки, duplicate save, broken reference, edit/save/reload page.

### B. Button actions (5): show/toggle/open_form/link/invalid self-target.

### C. Visibility (3): initial hidden, show/toggle, reload.

### D. Embed form: вставка snippet → submit → DB chain proof.

### E. Site questionnaire: добавление block → step flow → required → submit → DB chain proof → повторное прохождение (зафиксированная политика 0.6).

### F. Regression site-builder end-to-end (НОВОЕ, обязателен)

Помимо submit flows:

- сохранение страницы после добавления anchors/actions/questionnaire → reopen editor → данные на месте
- preview корректен
- **publish → live URL → всё работает на published, не только в preview**

### G. Regression existing

- existing site forms submit
- existing training progress
- `/admin/forms` filters/export/details
- contact card «Анкеты» tab
- `/admin/contacts`, `/admin/payments`

---

## Архитектурные guards

- **НЕ трогать `/admin/forms` UI, ContactArtifactsTab, viewers, exports, filters, table engine, date picker, drag/resize/select** — только подключение новых источников данных и invalidate, если действительно нужно.
- НЕ создавать второй questionnaire engine.
- НЕ создавать второй form submit flow.
- НЕ создавать новый редактор вопросов (только selector/wrapper).
- НЕ дублировать viewers.
- Target в button actions — **только stable id/anchorId**, никаких title/index/name.

---

## Финальный DoD спринта

- anchors работают (preview + published)
- button actions работают (все 5 типов)
- visibility engine работает (initial + runtime)
- embed form сохраняет в canonical `site_form_submissions`
- site questionnaire использует existing training engine, без второго движка/storage/editor
- все новые записи видны в `/admin/forms` и в карточке контакта
- полный E2E DB-chain proof приложен для трёх потоков
- regression по existing site forms, training, `/admin/forms`, contacts — не сломан
- site-builder regression: save → reopen → preview → publish → live — работает

## Порядок

Discovery (0.1–0.8) → артефакт mapping + guest/auth + repeat policy + reuse-guard verdict → PATCH A → B → C → D → E → F → QA → отчёт.