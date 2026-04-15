# да, согласен, с учетом правок:

&nbsp;

1. Уточни fix для preview более жёстко:
  проблема не только в auto-submit, а в том, что preview использует реальную admin-session.
  Нужно явно ввести guard:
  &nbsp;
  - в preview/editor режиме **никогда не выполнять реальный submit автоматически**;
  - шаг check_session может использоваться только для UI-ветвления, но не для side effects;
  - submit только по явному нажатию пользователя.
    Это надо зафиксировать как hard rule, а не только как “убрать auto-submit”.
  &nbsp;
2. Добавь явное различение контекстов:
  &nbsp;
  - editor preview
  - published public page
    И опиши, как renderer понимает, что он в preview. Сейчас это не прописано, а без этого fix останется полуописанным.
  &nbsp;
3. В FormSection.tsx лучше не вводить абстрактный шаг ready_to_submit без точного контракта.
  Зафиксируй state machine явно:
  &nbsp;
  - check_session
  - email_check/login/signup/email_confirm_wait
  - telegram_prompt
  - extra_fields
  - ready
  - submitting
  - success
    И отдельно: ready всегда требует явного клика по кнопке.
  &nbsp;
4. В formContentSchema и defaults добавь ещё одно поле-контракт для preview-safe поведения не нужно.
  Не надо хранить preview/runtime flags в block content.
  Это надо прямо записать в план, чтобы подрядчик не начал сохранять технические runtime состояния в JSON блока.
5. Для product_binding_enabled=false и deal_creation_enabled=false недостаточно “игнорировать на backend”.
  Нужно выбрать один из двух режимов и зафиксировать:
  &nbsp;
  - либо при выключении toggle зависимые поля очищаются из content,
  - либо поля сохраняются, но гарантированно не участвуют в runtime.
    Сейчас у тебя implied второй вариант, но это лучше написать явно.
  &nbsp;
6. Для deal_creation_enabled=true опиши validation pipeline точнее:
  &nbsp;
  - pipeline должен существовать;
  - stage должен существовать;
  - stage должен принадлежать pipeline;
  - если validation не проходит, submit не должен тихо продолжаться как success.
    Нужен явный error contract.
  &nbsp;
7. Не называй reuse guard “race guard: 5 секунд” как готовое решение без оговорки.
  Это слишком эвристично. Лучше так:
  &nbsp;
  - основной reuse идёт по deterministic key для draft/pending;
  - дополнительный anti-double-submit guard допустим как короткое временное окно, только если не ломает нормальные повторные отправки.
    Иначе можно случайно скрыть легитимный второй submit.
  &nbsp;
8. Для site_form_submissions укажи явно, что новая submission создаётся **всегда**, даже если deal reuse-ится.
  Это у тебя уже подразумевается, но лучше зафиксировать как hard invariant.
9. Для orders_v2 уточни exact contract сценария “deal without product”:
  &nbsp;
  - допускается product_id = null
  - допускается tariff_id = null
  - UI/queries/admin views должны это переваривать без ошибок
    Это должно быть не только в dry-run, но и в DoD.
  &nbsp;
10. Для tenant guard формулировка пока слишком сильная:
  “все сущности в этом workspace” может не соответствовать текущей схеме, если profiles/CRM не workspace-scoped напрямую.
  Лучше зафиксировать мягче и точнее:

&nbsp;

&nbsp;

&nbsp;

- submission всегда создаётся в workspace страницы;
- order/deal создаётся в контексте страницы/сайта этого workspace;
- profile linkage не должен приводить к cross-page/cross-tenant side effects вне допустимой текущей модели.
  Иначе подрядчик может упереться в несуществующие поля/ограничения.

&nbsp;

&nbsp;

&nbsp;

11. Для Telegram recheck добавь явные статусы UI:

&nbsp;

&nbsp;

&nbsp;

- idle
- starting
- pending
- linked
- failed
- skipped
  И правило переходов. Сейчас логика описана, но не как контракт.

&nbsp;

&nbsp;

&nbsp;

12. Уточни, что visibilitychange listener — add-only enhancement, но не единственный механизм.
  Основной механизм должен быть manual recheck/retry button, потому что visibilitychange ненадёжен сам по себе.
13. В разделе про Instagram normalization добавь, что normalization применяется:

&nbsp;

&nbsp;

&nbsp;

- в renderer перед submit
- и повторно на backend как source of truth
  Нельзя полагаться только на client-side нормализацию.

&nbsp;

&nbsp;

&nbsp;

14. Для machine-checkable proof добавь обязательный пункт:

&nbsp;

&nbsp;

&nbsp;

- proof, что publish/unpublish не меняет JSON content блока
  Ты это вынес в STOP-guard, но лучше включить и в verify.

&nbsp;

&nbsp;

&nbsp;

15. Нужен отдельный negative DoD для preview:

&nbsp;

&nbsp;

&nbsp;

- preview при auth_mode=true и активной admin-session **не создаёт submission**
- preview **не создаёт orders_v2**
- preview **не пишет audit/domain events**, если submit не был явно нажат
  Это один из главных багов, и его надо доказать отдельно.

&nbsp;

&nbsp;

&nbsp;

16. Добавь explicit rule: при auth_mode=true и уже активной session, но без extra fields, форма должна показывать обычную кнопку submit, а не silently переходить в success.
  Это следует из текста, но лучше записать отдельно как UX-ожидание.
17. В плане не хватает явной проверки editor persistence для зависимых селекторов:

&nbsp;

&nbsp;

&nbsp;

- product_id
- tariff_id
- pipeline_id
- pipeline_stage_id
  Нужно доказать не только сохранение toggles, но и сохранение выбранных значений этих селекторов после reload.

&nbsp;

&nbsp;

&nbsp;

18. Финальный DoD усили:
  добавь, что при deal_creation_enabled=false и product_binding_enabled=true:

&nbsp;

&nbsp;

&nbsp;

- metadata по продукту сохраняется,
- но orders_v2 не создаётся.
  Это важный комбинированный сценарий, а не только отдельные positive/negative проверки.

&nbsp;

&nbsp;

План: Patch блока Form — persistence, preview bug, deal creation, Telegram flow

## Диагностика

### Корневая причина бага "Спасибо" в предпросмотре

`AuthFormSection` (строка 277-293 FormSection.tsx): при `check_session` шаге обнаруживает активную admin-сессию → `customFields.length === 0` (нет дополнительных полей) → сразу `setFormStep("submit")` → auto-submit → "Спасибо". Это происходит потому что **admin уже залогинен**, а в preview используется тот же `useAuth()` контекст.

### Корневая причина потери настроек после reload

`formContentSchema` (types.ts:165-176) **не содержит** `auth_mode`, `telegram_link`, `product_id`, `tariff_id`, `product_binding_enabled`, `deal_creation_enabled`, `pipeline_id`, `pipeline_stage_id`. Эти поля не проходят через schema validation при save/load.

### Корневая причина: product binding / deal creation не разделены

В editor продукт и сделка смешаны. В `site-form-submit` нет логики `deal_creation_enabled` и `pipeline_id/pipeline_stage_id`.

## Решение

### 1. Починить `formContentSchema` в `types.ts`

Добавить все новые поля с backward-compatible defaults:

```
auth_mode: z.boolean().default(false)
telegram_link: z.boolean().default(false)
product_binding_enabled: z.boolean().default(false)
product_id: z.string().default("")
tariff_id: z.string().default("")
deal_creation_enabled: z.boolean().default(false)
pipeline_id: z.string().default("")
pipeline_stage_id: z.string().default("")
```

### 2. Починить `getDefaultContent("form")` в `SiteBlockEditor.tsx`

Добавить те же поля в defaults.

### 3. Починить preview bug в `FormSection.tsx`

В `AuthFormSection` при `check_session` шаге: если пользователь уже залогинен **но form находится в preview/editor контексте**, НЕ авто-сабмитить. Конкретный fix: убрать auto-submit. Шаг `submit` не должен запускаться автоматически из `check_session`. Вместо этого:

- Если есть active session → показать extra_fields (если есть) или показать кнопку "Отправить" (а не auto-submit)
- Добавить явный шаг `ready_to_submit` между `extra_fields` и `submit`, где пользователь нажимает кнопку

### 4. Добавить независимые toggles в `FormBlockEditor.tsx`

- `product_binding_enabled` — отдельный toggle вместо текущего неявного наличия `product_id`
- `deal_creation_enabled` — новый toggle с выбором воронки (`crm_pipelines`) и стадии (`crm_pipeline_stages`)
- При `product_binding_enabled=false` → скрыть product/tariff selectors
- При `deal_creation_enabled=false` → скрыть pipeline/stage selectors
- Validation: если toggle on, зависимое поле обязательно

### 5. Обновить `site-form-submit` Edge Function

Разделить на 4 последовательных этапа:

1. **create submission** — всегда
2. **resolve canonical profile** — по JWT (`auth.uid()`) если auth_mode, иначе legacy
3. **apply product binding** — только если `product_binding_enabled=true` в content; игнорировать `product_id/tariff_id` при `false`
4. **apply deal creation** — только если `deal_creation_enabled=true`; создать draft `orders_v2` с `pipeline_id`, `pipeline_stage_id`, `reconcile_source='site_form'`

Reuse policy для deal: reuse только `draft/pending` с тем же `(profile_id, page_id, product_id, pipeline_id, pipeline_stage_id, reconcile_source='site_form')`. Никогда не reuse `paid/completed/cancelled`. Race guard: проверка на submission с тем же `page_id + profile_id` за последние 5 секунд.

`pipeline_id` и `pipeline_stage_id` дополнительно сохраняются в `site_form_submissions.metadata` как snapshot.

Tenant guard: `page_id → site_pages.workspace_id → все сущности в этом workspace`.

### 6. Telegram flow

- При `telegram_link=true` шаг optional, skip всегда разрешён, submit не блокируется
- После `handleTelegramDone` добавить recheck: `useTelegramLinkStatus` refetch + проверка `active/pending/not_linked`
- Добавить `visibilitychange` listener для auto-recheck при возврате на вкладку

### 7. Instagram normalization

Каноничный формат хранения в `profiles.instagram_url`: **normalized handle** (без `@`, без URL-префикса, lowercase). Compat-rule: несмотря на legacy имя колонки `_url`, хранится handle.

## Файлы

1. `src/services/sitePages/types.ts` — расширить `formContentSchema`
2. `src/components/admin/site-builder/SiteBlockEditor.tsx` — расширить defaults
3. `src/components/admin/site-builder/blocks/FormBlockEditor.tsx` — 4 независимых toggle, pipeline/stage selectors, validation
4. `src/components/site-renderer/blocks/FormSection.tsx` — убрать auto-submit, добавить Telegram recheck, fix preview parity
5. `supabase/functions/site-form-submit/index.ts` — 4-этапный pipeline, deal creation, product binding guards

## Что НЕ меняется

- `PaymentDialog` — не рефакторится
- Новый block type не создаётся
- Auth semantics не меняются (add-only расширение)
- Ghost merge вне scope
- Legacy `auth_mode=false` — без изменений

## DoD

**Positive:**

1. Toggles `auth_mode`, `telegram_link`, `product_binding_enabled`, `deal_creation_enabled` сохраняются после save+reload (proof: JSON content до/после)
2. Preview НЕ показывает "Спасибо" сразу при `auth_mode=true`
3. Preview и published используют один renderer и один content contract
4. Telegram шаг появляется при `telegram_link=true`, пропускается при `false`
5. При `deal_creation_enabled=true` создаётся draft `orders_v2` с правильными `pipeline_id/pipeline_stage_id` (proof: запись в БД)
6. `pipeline_id/pipeline_stage_id` записаны в `site_form_submissions.metadata`
7. `auth.users → profiles.user_id → submission → orders_v2` — canonical linkage

**Negative:**
8. `product_binding_enabled=false` → `product_id/tariff_id` не влияют на submit
9. `deal_creation_enabled=false` → `orders_v2` не создаётся
10. `telegram_link=false` → Telegram шаг не появляется
11. Старые form blocks без новых полей открываются, сохраняются, публикуются без ошибок
12. Повторный submit тем же юзером не создаёт второй профиль

**Machine-checkable proof:**

- JSON content блока до/после reload
- Запись в `site_form_submissions.metadata`
- Запись/отсутствие `orders_v2` с `reconcile_source='site_form'`
- Audit logs: `auth_mode_form_submitted`, `profile_linked`, `deal_created/skipped`, `telegram_step_started/completed/skipped`

## STOP-guards

- Если новые флаги не переживают save+reload → стоп
- Если `auth_mode=false` ломается → стоп
- Если "deal without product" ломает AdminDeals/DealDetailSheet → стоп
- Save без изменения других полей не должен сбрасывать новые флаги
- Publish/unpublish не должен менять block content