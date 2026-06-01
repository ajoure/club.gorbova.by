## да, согласен, с учетом правок:

1. **Уточнить термин в UI: это не “тренинг”, а “домен выдачи”**
  - Если технически ветка называется `training_content`, визуально не писать пользователю/админу, что «Генерация документов» — это тренинг.
  - В UI лучше:
    - блок: **«Что выдаём» → Доступ к контенту**
    - поле: **«Куда выдаём» → База знаний / Генерация документов**
  - Если переименовать пункт «Доступ к контенту тренинга» сейчас сложно — оставить, но внутри не называть пакеты документов тренингами.
2. **Не использовать “прямой SELECT под клиентом” как обязательную логику для админской формы**
  - Для формы правил доступа админ должен видеть все активные глобальные пакеты независимо от клиентских грантов.
  - Поэтому список пакетов в `ProductAccessRulesTab.tsx` должен грузиться в admin-контексте:
    - активные глобальные пакеты;
    - `profile_id IS NULL`;
    - `is_active=true`.
  - Не завязывать админский список на пользовательскую видимость через `user_can_see_document_package`.
3. **Partial по “Генерации документов” должен сохранять только** `allowed_package_ids`
  - В `conditions` для `document_generation` не добавлять:
    - `allowed_template_ids`;
    - `allowed_module_ids`;
    - `allowed_lesson_ids`;
    - `auto_include_new_modules`.
  - Для `full` можно сохранять:
  - Для `partial`:
4. **При переключении домена очищать лишние поля формы**
  - Если админ переключил:
    - «База знаний» → «Генерация документов», очистить `tc_allowed_module_ids`, `tc_allowed_lesson_ids`, `tc_auto_include_new_modules`.
    - «Генерация документов» → «База знаний», очистить `tc_allowed_package_ids`.
  - Это нужно, чтобы в `conditions` не попадал мусор от другого домена.
5. **Edit-mode должен корректно открывать существующие** `document_generation` **правила**
  - При редактировании правила:
    - `grant_target_type='document_generation'` визуально открывается как «Доступ к контенту» + «Генерация документов»;
    - `access_mode` подтягивается из `conditions.access_mode`;
    - `allowed_package_ids` подтягивается из `conditions.allowed_package_ids`;
    - selected labels подтягиваются по UUID из пакетов.
6. **Legacy** `section_access → document_generation` **лучше не редактировать в новой форме**
  - Отображать как read-only или предложить создать новое правило.
  - Не пытаться автоматически конвертировать legacy в `document_generation`, чтобы не менять старую рабочую модель без явного действия.
7. **CRUD пакетов лучше оставить в** `/admin/documents`**, а не перегружать** `PackagesWorkspace` **без режима**
  - Кнопки «Новый пакет / Редактировать / Удалить» показывать только:
    - `mode="admin"`;
    - `admin/super_admin`;
    - вкладка/область «Пакеты документов».
  - В `/document-generation` пользователь этих кнопок видеть не должен.
8. **Добавить DoD по отсутствию лишних технических ключей**
  - После сохранения partial-правила проверить SQL:
    - `conditions.allowed_package_ids` — UUID[];
    - нет `name`, `slug`, `code`;
    - нет `allowed_template_ids`;
    - нет training-полей в document-generation правиле.
9. **Добавить DoD по переключению формы**
  - Создать правило:
    - сначала выбрать «База знаний» partial и модули;
    - переключить на «Генерация документов» partial и выбрать пакеты;
    - сохранить;
    - проверить, что в `conditions` нет старых module/lesson ids.
  - И обратный сценарий: документы → база знаний.

Копируемый блок для Lovable:

```text
План согласован, но дополни следующими правками.

1. Уточнить визуальную терминологию.

Технически можно переиспользовать ветку `training_content`, но в UI нельзя создавать ощущение, что «Генерация документов» — это тренинг.

Если возможно, визуально использовать:
- «Что выдаём» → «Доступ к контенту»;
- «Куда выдаём» → «База знаний» / «Генерация документов».

Если переименование «Доступ к контенту тренинга» сейчас затрагивает слишком много UI — оставить текущий текст, но внутри формы не называть пакеты документов тренингами.

2. Список пакетов в форме правил доступа грузить в admin-контексте.

В `ProductAccessRulesTab.tsx` список для выбора partial-доступа к «Генерации документов» должен показывать все активные глобальные пакеты:
- `profile_id IS NULL`;
- `is_active=true`.

Не завязывать этот список на пользовательский `user_can_see_document_package`, потому что это админская форма настройки правил доступа.

3. Для `document_generation` сохранять только document-specific conditions.

Для `grant_target_type='document_generation'` сохранять только:

Full:
{
  "access_mode": "full",
  "allowed_package_ids": []
}

Partial:
{
  "access_mode": "partial",
  "allowed_package_ids": ["<uuid>"]
}

Не сохранять:
- `allowed_template_ids`;
- `allowed_module_ids`;
- `allowed_lesson_ids`;
- `auto_include_new_modules`.

4. При переключении домена очищать лишние поля формы.

Если админ переключает:
- «База знаний» → «Генерация документов»:
  очистить `tc_allowed_module_ids`, `tc_allowed_lesson_ids`, `tc_auto_include_new_modules`.

Если админ переключает:
- «Генерация документов» → «База знаний»:
  очистить `tc_allowed_package_ids`.

Цель: в `conditions` не должен попадать мусор от другого домена.

5. Edit-mode для существующих правил.

При открытии существующего правила:
- `grant_target_type='training_content'` → домен «База знаний»;
- `grant_target_type='document_generation'` → визуально открыть тот же UI как «Доступ к контенту» + домен «Генерация документов»;
- подтянуть `conditions.access_mode`;
- подтянуть `conditions.allowed_package_ids`;
- названия пакетов показывать только как display label по UUID.

6. Legacy section_access не редактировать через новую форму.

Правило:
- `grant_target_type='section_access'`;
- `target_ref='document_generation'`

отображать как legacy/read-only:
«Доступ к генерации документов (legacy, полный)».

Не конвертировать автоматически в новый `document_generation`, чтобы не менять старую рабочую модель без явного действия.

7. CRUD пакетов показывать только в admin-режиме.

Кнопки:
- «Новый пакет»;
- «Редактировать»;
- «Деактивировать»;
- «Удалить»

показывать только если:
- `/admin/documents`;
- `mode="admin"`;
- пользователь `admin/super_admin`.

В `/document-generation` пользователь не должен видеть CRUD-кнопки пакетов.

8. Усилить DoD SQL-проверкой conditions.

После сохранения partial-правила для «Генерации документов» проверить:

- `conditions.allowed_package_ids` содержит только UUID;
- в `conditions` нет `name`;
- нет `slug`;
- нет `code`;
- нет `allowed_template_ids`;
- нет `allowed_module_ids`;
- нет `allowed_lesson_ids`;
- нет `auto_include_new_modules`.

9. Добавить DoD по переключению формы.

Проверить сценарий 1:
- выбрать «База знаний»;
- partial;
- выбрать модули/уроки;
- переключить на «Генерация документов»;
- выбрать partial и пакеты;
- сохранить;
- убедиться, что в `conditions` нет module/lesson ids.

Проверить сценарий 2:
- выбрать «Генерация документов»;
- partial;
- выбрать пакеты;
- переключить на «База знаний»;
- выбрать modules/lessons;
- сохранить;
- убедиться, что в `conditions` нет allowed_package_ids.

10. Генерацию документов, sessions, Gotenberg, edge-функции, RLS/RPC/audit/safe-delete не трогать.

План: Sprint 3S v2 — UI access model fix (домен «Генерация документов» внутри training_content)
```

### Цель

Исправить UI-модель выдачи доступа к пакетам документов: «Генерация документов» — это не отдельный тип в «Что выдаём» и не отдельный «тренинг» в селекторе. Это домен внутри «Доступа к контенту тренинга», параллельный «Базе знаний». Пакеты выбираются только при partial-доступе и сохраняются как UUID. Backend-контракт Sprint 3S v2 не меняется.

### Изменения только в UI (frontend)

**1. `src/components/admin/product/ProductAccessRulesTab.tsx**`

«Что выдаём» (grant_target_type) — оставить как есть; пункт `document_generation` НЕ показывать в дропдауне (legacy-правила продолжают читаться, но руками новые такие не создаются — создаются через домен ниже).

Внутри ветки `training_content` добавить новое поле «Куда выдаём» — domain selector:

- `knowledge_base` — База знаний (по умолчанию, текущее поведение);
- `document_generation` — Генерация документов.

Поведение по доменам:

- **База знаний** (без изменений):
  - Полный / Частичный доступ;
  - при partial — текущий выбор модулей/уроков (`tc_allowed_module_ids`, `tc_allowed_lesson_ids`, `tc_auto_include_new_modules`).
- **Генерация документов**:
  - Полный / Частичный доступ;
  - при partial — список активных глобальных пакетов (`document_package_templates` где `profile_id IS NULL AND is_active=true`) c чекбоксами; показывается только `name`, выбор хранится как UUID.

**2. Save-маппинг (внутри того же файла / `useAccessRules`)**

При сохранении правила с `training_content` + `document_generation` домен записывать в БД как:

- `grant_target_type = 'document_generation'`
- `target_ref` — текущий согласованный sentinel из Sprint 3S v2 (`'document_generation'`)
- `conditions.access_mode = 'full' | 'partial'`
- `conditions.allowed_package_ids = uuid[]` (только при partial)

При загрузке правила в форму:

- `grant_target_type='training_content'` → форма открывается с доменом «База знаний»;
- `grant_target_type='document_generation'` → форма открывается с `training_content` + домен «Генерация документов», `access_mode` и `allowed_package_ids` подставляются из `conditions`;
- legacy `section_access` + `target_ref='document_generation'` → отображается read-only бейджем «Доступ к генерации документов (legacy, полный)» и продолжает работать как full.

**3. `src/components/ai-documents/packages/PackagesWorkspace.tsx**`

Добавить admin-CRUD над глобальными пакетами (для admin/super_admin), используя уже существующие RPC из Sprint 3S v2:

- кнопка «Новый пакет» → `create_global_document_package`;
- «Переименовать» → `update_global_document_package`;
- «Деактивировать» → `deactivate_global_document_package`;
- «Удалить» → `safe_delete_document_package` (мягкий блок при зависимостях).

Поля: только `name` и опц. `description`. Ни `code`, ни `slug`, ни `public_id`.

### Что НЕ делаем (явные out-of-scope)

- Не добавляем `conditions.allowed_template_ids` и выбор шаблонов внутри пакета.
- Не вводим slug/code/text-key для пакетов в новой логике.
- Не трогаем backend-контракт Sprint 3S v2: миграции, RPC, RLS, аудит, safe-delete, триггеры — без изменений.
- Не трогаем `canonical-document-generate-strict`, edge-функции генерации, Gotenberg, `document_package_sessions`, `document_package_session_participants`, `ai_document_generation_batches`, `ai_generated_documents`.
- Не трогаем resolver `access-resolver.ts` (он уже умеет `document_generation` + `allowed_package_ids` + legacy).

### Технические детали

```text
ProductAccessRulesTab form state (training_content):
  grant_target_type: 'training_content'    // в UI; на save может стать 'document_generation'
  tc_domain: 'knowledge_base' | 'document_generation'   // NEW локальное поле
  tc_access_mode: 'full' | 'partial'
  // knowledge_base:
  tc_allowed_module_ids, tc_allowed_lesson_ids, tc_auto_include_new_modules
  // document_generation:
  tc_allowed_package_ids: string[]

Save mapping:
  if tc_domain === 'knowledge_base':
    insert { grant_target_type: 'training_content', target_ref: <product_id>,
             conditions: { access_mode, allowed_module_ids, allowed_lesson_ids, auto_include_new_modules } }
  if tc_domain === 'document_generation':
    insert { grant_target_type: 'document_generation', target_ref: 'document_generation',
             conditions: { access_mode, allowed_package_ids: access_mode==='partial' ? uuids : [] } }
```

Загрузка активных пакетов — прямым селектом из `document_package_templates` (RLS уже разрешает SELECT активных глобальных под клиентом).

### Dry-run / stop-guards

- Если save с `document_generation` падает на UNIQUE `(product_id, tariff_id, grant_target_type, target_ref)` — показать понятную ошибку «Правило для генерации документов уже существует, отредактируйте существующее» и не дублировать.
- Если RLS блокирует SELECT активных глобальных пакетов в форме доступа — остановиться и согласовать политику отдельно (текущая RLS позволяет, проверка нужна).
- Если в проде есть legacy-правило с `grant_target_type='document_generation'` и `target_ref != 'document_generation'` — не падать, отображать read-only.

### DoD

- В «Что выдаём» нет пункта «Доступ к генерации документов».
- В «Что выдаём» доступен «Доступ к контенту тренинга», внутри которого появляется выбор «Куда выдаём»: «База знаний» / «Генерация документов».
- «База знаний» работает как раньше (full/partial по модулям/урокам).
- «Генерация документов»: full = все активные пакеты, partial = список UUID выбранных пакетов в `conditions.allowed_package_ids`.
- В сохранённом правиле для partial — только UUID, без name/code/slug. Переименование пакета не ломает доступ.
- Legacy `section_access → document_generation` продолжает работать как full.
- `/admin/documents` → «Пакеты документов» имеет CRUD над глобальными пакетами через существующие RPC (audit пишется автоматически RPC).
- Генерация документов, sessions, Gotenberg и edge-функции — не изменены (диффом подтверждается).