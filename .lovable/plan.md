# да, согласен, с учетом правок:

&nbsp;

1. **PATCH D не делать через formId, если у вас нет отдельной канонической сущности form_id.**
  Сейчас в плане одновременно фигурируют:
  &nbsp;
  - data-form-id
  - page_id
  - route /embed/form/:formId
  &nbsp;
  Это риск новой псевдо-сущности.
  Нужно зафиксировать один канонический ключ:
  &nbsp;
  - либо block_id формы на странице
  - либо page_id + block_id
  &nbsp;
  Для этого везде заменить:
  &nbsp;
  - formId → blockId
  - route лучше сделать вида /embed/form/:pageId/:blockId
  - snippet должен передавать именно stable id блока, а не выдуманный formId
  &nbsp;
2. **В PATCH D сначала зафиксировать reuse submit path как обязательный, а не “verify”.**
  Здесь уже достаточно оснований не оставлять свободу выбора.
  Нужно прямо записать:
  &nbsp;
  - site-form-submit — канонический submit path
  - новый submit endpoint запрещён, если discovery не покажет критический blocker
  - допустимо только add-only расширение metadata (embed_origin, embed_mode, embed_block_id)
  &nbsp;
3. **В EmbedFormPage нельзя делать “минимальную форму”, если уже есть canonical renderer формы.**
  Иначе снова получится второй UI.
  Надо записать:
  &nbsp;
  - EmbedFormPage рендерит тот же form block renderer, что и обычная site page
  - без отдельной вёрстки полей
  - без второго runtime path
  &nbsp;
4. **Для PATCH E нужно жёстко запретить создание собственного editor questionnaire.**
  Сейчас фраза “кнопка создать новый → открывает existing lesson_blocks editor” правильная, но её надо усилить:
  &nbsp;
  - не создавать новый визуальный конструктор вопросов
  - не копировать schema blocks
  - только open existing editor / existing lesson flow
  &nbsp;
5. **Virtual lesson/module — допустимо, но только если это действительно reuse existing engine 1:1.**
  Добавить явный guard:
  &nbsp;
  - нельзя делать отдельные site_questionnaire_response tables
  - нельзя делать отдельный site_questionnaire_player
  - нельзя делать отдельный detail viewer
  - StudentProgressModal остаётся canonical viewer
  &nbsp;
6. **В PATCH E нужно заранее зафиксировать, как questionnaire попадёт в /admin/forms.**
  Сейчас написано “добавить source site_questionnaire”, но нужно уточнить:
  &nbsp;
  - это отдельный source_type в forms hub
  - в карточке контакта он должен отображаться в существующей вкладке “Анкеты и обучение”
  - если используется тот же training path, то detail открывается через existing training bridge без специальных новых компонентов
  &nbsp;
7. **Нужен отдельный STOP-guard по миграции служебного module.**
  Добавить:
  &nbsp;
  - если в проекте уже существует скрытый системный module для site/questionnaire задач, новый не создавать
  - сначала discovery по training_modules.slug='__site_questionnaires__'
  - миграция только если такого module ещё нет
  &nbsp;
8. **В PATCH F добавить invalidate/query-proof точнее.**
  Не ['forms-hub'], а реальные query keys проекта:
  &nbsp;
  - forms-hub-data
  - forms-hub-products
  - contact-artifacts-* для карточки контакта, если submit идёт внутри активной сессии
    Иначе подрядчик может написать несуществующий invalidate.
  &nbsp;
9. **В QA runbook для Embed добавить proof contact resolve.**
  После submit нужно проверять не только site_form_submissions, но и:
  &nbsp;
  - найден/создан ли корректный profile/contact
  - появилась ли запись у нужного контакта
  - не создался ли дубль контакта
  &nbsp;
10. **В QA runbook для Site questionnaire добавить proof конкретной политики repeat.**
  Сейчас policy выбрана хорошая: new session every submit.
  Но надо прямо требовать:

&nbsp;

&nbsp;

&nbsp;

- два submit подряд одним user
- две разные записи в user_lesson_progress
- обе видны в истории контакта
- обе видны в /admin/forms

&nbsp;

&nbsp;

&nbsp;

11. **Нужен явный regression-блок по уже сделанным PATCH A/B/C.**
  Добавить в runbook:

&nbsp;

&nbsp;

&nbsp;

- anchor scroll после внедрения embed/questionnaire не сломан
- button actions show_block / toggle_block / open_form не сломаны
- hidden blocks по-прежнему корректно работают

&nbsp;

&nbsp;

&nbsp;

12. **Финальный критерий закрытия спринта нужно усилить.**
  Спринт считать закрытым только если есть:

&nbsp;

&nbsp;

&nbsp;

- UI proof
- DB proof
- proof contact resolve
- proof /admin/forms
- proof contact card
- regression proof по anchors/actions/visibility

&nbsp;

&nbsp;

В остальном логика плана правильная. Основа хорошая: reuse existing engine, без второго storage path, без второго viewer, без второго submit flow.

&nbsp;

План: Site Builder Sprint — Phase 2 (PATCH D + PATCH E + PATCH F + E2E QA)

## Статус

- ✅ PATCH A (anchors), B (button actions), C (visibility) — выполнены
- ❌ PATCH D, E, F + E2E QA — в работе

## Discovery (обязательно ДО execution)

### D.0 Reuse-guard для embed form

1. Прочитать `supabase/functions/site-form-submit/index.ts` — CORS, auth, contact resolve, dedup
2. Зафиксировать вердикт:
  ```
   existing path: /functions/v1/site-form-submit
   reuse для external embed: ДА / НЕТ
   причина: <CORS=*/RLS/contact resolve/dedup>
  ```
3. Новый endpoint создавать **только если** reuse невозможен (по предыдущему discovery — CORS=`*`, reuse возможен)

### E.0 Questionnaire engine discovery

1. Прочитать `lesson_blocks` структуру и questionnaire renderer (`LessonPlayer`, blocks с `block_type='questionnaire'/'diagnostic_table'`)
2. Прочитать `user_lesson_progress` — поля, RLS, как пишется response
3. Прочитать `loadTrainingDetailContext` (используется в `FormsDetailOpener` → `StudentProgressModal`)
4. Решение:
  - **A**: reuse через canonical lesson path (виртуальный lesson внутри служебного module `__site_questionnaires__`)
  - **B**: blocker report
5. **Запрещено**: второй editor вопросов, второй renderer, второй storage

### E.0.1 Политики (фиксируем ДО execution)

- **guest/auth**: `auth-required` (default) — questionnaire требует логин. Guest mode не открываем в этом спринте (избегаем второго storage path).
- **contact resolve**: `auth.uid()` → `profiles.id` (canonical, тот же путь, что training)
- **repeat policy**: `new session every submit` (default) — каждое прохождение = новая запись `user_lesson_progress` с новым `id`. Отображение:
  - в карточке контакта: история (все сессии)
  - в `/admin/forms`: одна строка per session
  - в detail viewer: открывается конкретная выбранная сессия

---

## PATCH D — Embeddable form

**Файлы:**

- `supabase/functions/site-form-submit/index.ts` — verify CORS=`*`, добавить опциональный `embed_origin` в metadata (add-only)
- `public/embed/form.js` (новый, статический) — popup loader, читает `data-form-id` / `data-page-id`, открывает iframe с минимальной формой, postMessage для submit
- `src/pages/embed/EmbedFormPage.tsx` (новый) — публичная страница `/embed/form/:formId`, рендерит canonical form block, на submit вызывает existing `site-form-submit`
- `src/components/admin/site-builder/blocks/FormBlockEditor.tsx` — добавить кнопку «Получить embed-код» с modal (snippet)
- `src/App.tsx` — добавить route `/embed/form/:formId` (без AdminLayout)

**DoD:** snippet на внешней странице → submit → DB row in `site_form_submissions` → видна в `/admin/forms` → detail через canonical viewer.

---

## PATCH E — Site questionnaire (reuse training engine)

**Гейты**: D.0 + E.0 + E.0.1 пройдены.

**Канонический путь хранения:** `user_lesson_progress` с virtual lesson внутри служебного module `__site_questionnaires__` (создаётся миграцией один раз).

**Миграция:**

- Создать служебный `training_modules` row с `slug='__site_questionnaires__'`, `is_hidden=true`
- Каждый site-questionnaire = `training_lessons` row внутри этого module
- `lesson_blocks` для site-questionnaire помечаются `metadata.source='site'` + `metadata.site_block_id=<UUID>`
- Расширить `useFormsHubData.ts` add-only: добавить source `site_questionnaire` (читает `user_lesson_progress` где lesson принадлежит служебному module)

**Файлы:**

- `src/components/site-renderer/blocks/SiteQuestionnaireBlock.tsx` (новый, тонкий wrapper) — резолвит `lesson_id` из block content, рендерит существующий questionnaire renderer 1:1
- `src/components/admin/site-builder/blocks/QuestionnaireBlockEditor.tsx` (новый, тонкий selector) — выбор существующего questionnaire ИЛИ кнопка «Создать новый» → открывает existing `lesson_blocks` editor для нового virtual lesson. **БЕЗ собственного editor вопросов.**
- `src/services/sitePages/types.ts` — добавить block type `site_questionnaire` с content `{ lessonId: string }`
- `src/components/site-renderer/SitePageRenderer.tsx` — wire новый block type
- `src/components/admin/site-builder/SiteBlockEditor.tsx` — добавить block type в палитру
- `src/hooks/useFormsHubData.ts` — расширить fetchTrainingResponses чтобы включить site source

**DoD:** block добавляется → step flow → submit → `user_lesson_progress` → видно в карточке контакта (ContactArtifactsTab) и в `/admin/forms` → detail через `StudentProgressModal`.

---

## PATCH F — Unified contact/data path

**Только wiring/invalidate, без переделки UI:**

- После site_form submit → `queryClient.invalidateQueries(['forms-hub'])`
- После embed submit → idem (через webhook/realtime, если уже есть, иначе just rely on next fetch)
- После site_questionnaire submit → idem
- Verify: `useFormsHubData` корректно показывает все 3 source-типа

**DoD:** все 3 потока видны в `/admin/forms` и в карточке контакта без ручного reload.

---

## QA runbook

### D. Embed form

1. Создать форму в site builder, опубликовать страницу
2. Скопировать embed snippet
3. Вставить в тестовый HTML файл локально, открыть в браузере
4. Submit → DB proof: `SELECT id, page_id, form_data, created_at FROM site_form_submissions ORDER BY created_at DESC LIMIT 1` → UUID
5. Открыть `/admin/forms` → найти строку → screenshot
6. Открыть detail → screenshot

### E. Site questionnaire

1. Добавить questionnaire block в site page → выбрать/создать questionnaire
2. Опубликовать страницу
3. Залогиниться тестовым user → пройти step flow → screenshot каждого шага
4. Required validation → screenshot
5. Submit → DB proof: `SELECT id, lesson_id, user_id, response, created_at FROM user_lesson_progress WHERE lesson_id IN (SELECT id FROM training_lessons WHERE module_id IN (SELECT id FROM training_modules WHERE slug='__site_questionnaires__')) ORDER BY created_at DESC LIMIT 1`
6. Карточка контакта → ContactArtifactsTab → запись видна → screenshot
7. `/admin/forms` → строка видна → screenshot
8. Detail viewer (`StudentProgressModal`) → открывается → screenshot
9. Повторное прохождение → новая `user_lesson_progress` row (`new session every submit` policy verified) → DB proof

### F. Regression

- existing site forms submit (старый flow) → работает
- existing training progress → не сломан
- `/admin/forms` filters/export → работают
- contact card artifacts tab → работает
- `/admin/contacts`, `/admin/payments` → не сломаны

### Site-builder E2E

- save страницы с anchors/actions/questionnaire → reopen editor → данные на месте
- preview корректен
- publish → live URL → всё работает

---

## Архитектурные guards

- НЕ трогать `/admin/forms` UI, `ContactArtifactsTab`, viewers, exports, filters, table engine
- НЕ создавать второй questionnaire engine / editor / storage / renderer
- НЕ создавать новые формы submit endpoint без reuse-guard fail
- Target в button actions — только stable id/anchorId

## Финальный DoD

- embed form работает через canonical `site-form-submit`
- site questionnaire работает через existing training engine
- все записи попадают в `/admin/forms`
- все записи видны в карточке контакта
- detail viewers existing, без дублей
- полный E2E DB-chain proof для D и E
- regression checklist пройден

## Порядок

Discovery (D.0 + E.0 + E.0.1) → миграция (служебный module) → PATCH D → PATCH E → PATCH F → QA → отчёт.