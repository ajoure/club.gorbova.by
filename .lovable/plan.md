# Ответ для Lovable:

да, согласен, с учетом правок:

1. Не сохранять автоматически первую активную роль при переключении в `per_role_person`.
  &nbsp;
  В плане указано: «если есть — сохраняем сразу с первой ролью как дефолтом». Это рискованно: можно случайно выбрать не ту роль, например «Ревизор» вместо «Участник».
  Правильно:
  - пользователь выбирает `Отдельный документ для каждого физлица с ролью`;
  - селектор роли становится обязательным;
  - пока роль не выбрана — не отправлять update в БД либо показывать validation state;
  - сохранить `generation_mode='per_role_person'` можно только вместе с явно выбранным `repeat_role_catalog_id`.
  Если в UI технически нужно временное состояние — держать его локально, но не писать в БД `per_role_person` без роли.
2. В карточке документа блок «Режим генерации документа» должен быть не “под полями и назначениями ролей”, а лучше между «Поля документа» и «Роли документа» либо сразу перед «Роли документа».
  Логика для пользователя:
  - сначала поля;
  - потом режим генерации;
  - потом роли/назначения, которые участвуют в генерации.
  Главное: блок должен быть видим без поиска на вкладке «Шаблоны пакета».
3. Сохранение режима генерации должно быть понятно отделено от atomic save полей/ролей.
  `save_session_document_atomic` сохраняет значения полей и role assignments сессии.  
  `generation_mode / repeat_role_catalog_id` — это настройка `document_package_template_items`, то есть настройка template item.
  Поэтому в proof нужно показать:
  - какая мутация сохраняет режим генерации;
  - что она не ломает `save_session_document_atomic`;
  - что кнопка «Сохранить документ» не создаёт конфликт двух разных save-path.
4. В UI нужно показать текущее состояние режима даже для `single`.
  &nbsp;
  В карточке документа должно быть видно:
  - `Один документ` выбран по умолчанию;
  - если включён repeat — бейдж `× по роли «Участник»`;
  - если repeat включён, но роль по историческим данным отсутствует/архивирована — destructive state `роль не задана / роль неактивна`.
5. В `PackageGenerationPanel` технический код ошибки можно оставить только в tooltip/title, но не в основном тексте.
  &nbsp;
  Видимый текст должен быть человекочитаемый:
  `Нет назначений для роли «Ревизор». Назначьте физлицо на эту роль или исправьте шаблон документа.`
  Технический код допустим только как служебная подсказка:
  `role_assignment_missing:ln-000014`
6. Важно не смешивать две разные проблемы:
  - `per_role_person` по роли «Участник» — это настройка множественной генерации;
  - `{{ln-000014}}` = «Ревизор» в DOCX-шаблоне — это отдельная обязательная роль шаблона.
  Если шаблон содержит `{{ln-000014}}`, то даже при repeat по «Участнику» генерация может корректно блокироваться, пока не назначен Ревизор или пока токен не заменён на `{{recipient.full_name}}`.
  Поэтому UI должен объяснять это пользователю, а не показывать техническую ошибку.
7. Backend bypass pre-scan делать строго только для repeat-роли.
  &nbsp;
  Правило:
  - если отсутствует assignment для `repeat_role_catalog_id`, pre-scan не должен блокировать, потому что per-role ветка подставит текущего recipient;
  - если отсутствует assignment для другой роли, например `ln-000014` «Ревизор», блокировка остаётся корректной.
  Это должно быть отдельно доказано в proof двумя кейсами:
  - repeat-role без assignment не падает в pre-scan;
  - non-repeat роль без assignment продолжает давать понятную ошибку.
8. Runtime proof разделить на два уровня.
  &nbsp;
  **Уровень 1 — обязательный для этого патча:**
  - блок режима генерации виден в карточке «Извещение»;
  - можно выбрать `per_role_person`;
  - можно выбрать роль «Участник»;
  - настройка сохраняется в `document_package_template_items`;
  - UI показывает понятную ошибку по `ln-000014` = «Ревизор», если Ревизор не назначен;
  - single-документы работают без изменений.
  **Уровень 2 — полный финальный Stage C PASS:**
  - после назначения Ревизора или исправления DOCX на `{{recipient.*}}`;
  - генерация создаёт 3 отдельных извещения;
  - в `ai_generated_documents.meta` заполнены `repeat_assignment_id`, `recipient_person_id`, `recipient_display_name`, `recipient_index`;
  - в DOCX реально подставлен recipient.
  Stage C нельзя закрывать как PASS, пока не выполнен уровень 2.
9. Не начинать Stage D до полного Stage C PASS.
  &nbsp;
  Если после этого патча будет только UI + понятная ошибка по Ревизору, статус должен быть:
  `Stage C runtime fix: PARTIAL, waiting for template/data readiness`
  А не PASS.
10. В proof добавить отдельную проверку, что настройка видна именно на вкладке «Анкеты документов», а не только на «Шаблоны пакета».

Обязательный скрин:

- карточка документа «2. Извещение…»;
- виден блок «Режим генерации документа»;
- выбран режим `Отдельный документ для каждого физлица с ролью`;
- выбрана роль `Участник`.

11. В proof добавить SQL after:

```sql
SELECT id, title_override, generation_mode, repeat_role_catalog_id
FROM document_package_template_items
WHERE id = 'febd1821-fba8-4290-babf-99c59c27f2f4';
```

Ожидание:

```text
generation_mode = 'per_role_person'
repeat_role_catalog_id = id роли "Участник"
```

12. В proof добавить SQL по активным assignments именно для item «Извещение»:

```sql
SELECT a.id, rc.public_id, rc.label, p.full_name
FROM document_package_item_role_assignments a
JOIN document_package_role_catalog rc ON rc.id = a.role_catalog_id
LEFT JOIN legal_details_persons p ON p.id = a.person_id
WHERE a.package_template_item_id = 'febd1821-fba8-4290-babf-99c59c27f2f4'
  AND a.is_active = true
ORDER BY rc.public_id, a.sort_order, a.id;
```

13. Уточнить DoD:

- В карточке документа на вкладке «Анкеты документов» виден блок «Режим генерации документа»: PASS.
- Роль не выбирается автоматически без явного действия пользователя: PASS.
- Можно явно выбрать роль «Участник»: PASS.
- Настройка сохраняется в `document_package_template_items`: PASS.
- Ошибка `role_assignment_missing:ln-000014` отображается как «Нет назначений для роли “Ревизор”…»: PASS.
- Pre-scan bypass работает только для repeat-роли: PASS.
- Single-документы работают без изменений: PASS.
- Полный Stage C PASS только после генерации 3 отдельных извещений с реальным recipient context: PASS.
- Stage D не начинать до полного Stage C PASS.

После этих правок план можно выполнять.

&nbsp;

План: PATCH-C-STAGE-RUNTIME-FIX-V1 (v2) — закрытие Stage C runtime

## Diagnose

1. **UI per_role_person существует только в `TemplateBindingControl` (вкладка «Шаблоны пакета»)**, что **не является рабочим сценарием** пользователя. Пользователь работает с документом в его карточке на вкладке «Анкеты документов» (`PackageDocumentCard`) — именно туда он заходит, чтобы заполнить поля, назначить роли и запустить генерацию. Настройка режима генерации обязана быть **рядом с полями и ролями документа**, а не на отдельной admin-вкладке. Текущее расположение в `TemplateBindingControl` оставляем как админ-дубль, основной сценарий — карточка документа.
2. `**role_assignment_missing:ln-000014` подтверждено**:
  - `ln-000014` = «Ревизор», `ln-000015` = «Участник» в каталоге ролей пакета `21764469…`.
  - Шаблон «2. Извещение…» содержит `{{ln-000014}}` (Ревизор).
  - На item «Извещение…» назначены 3 человека, **все на роль «Участник»**, на «Ревизор» — никто.
  - Это **корректная ошибка** (Ревизор реально не назначен), но техническое сообщение не объясняет, что произошло и что делать. Нужна человекочитаемая формулировка с label роли.
3. **Bug-risk в pre-scan**: в `ai-generate-document-package/index.ts` строки 447–460 валидация `{{ln-XXX}}` идёт до per-role ветки (строка 581). Если назначений именно для repeat-роли нет (а recipient'ы должны прийти из resolver) — pre-scan ложно заблокирует item. Нужна точечная защита.
4. **Жёсткое разделение проблем** (как требует пользователь):
  - **Проблема A**: UI per_role_person/repeat_role_catalog_id должен быть в карточке документа — фиксим в этом патче.
  - **Проблема B**: токен `{{ln-000014}}` (Ревизор) в шаблоне — это **отдельный вопрос**: либо назначить Ревизора, либо заменить токен на `{{recipient.full_name}}`. Решение принимает владелец шаблона/данных вне этого патча. UI-фикс per_role_person **не зависит** от того, как решат проблему B.

## Scope

### 1. UI: блок «Режим генерации документа» в карточке документа (основной сценарий)

Файл: `src/components/ai-documents/packages/PackageDocumentCard.tsx` (карточка одного документа на вкладке «Анкеты документов»).

Добавить блок **под полями и назначениями ролей**, до кнопок генерации:

```
Режим генерации документа
( ) Один документ
( ) Отдельный документ для каждого физлица с ролью
    └─ Роль-источник повторения: [ Select: активные роли пакета ]
```

Поведение:

- Источник опций селекта — `document_package_role_catalog` по `package_template_id` карточки, фильтр `is_active = true`. Используем уже существующий хук/запрос ролей пакета (тот же, что в `TemplateBindingControl`) либо лёгкий react-query.
- При переключении в `per_role_person`:
  - если активных ролей **нет** — опция disabled с подсказкой «Сначала добавьте роль пакета на вкладке „Роли и поля пакета"».
  - если есть — сохраняем сразу с первой ролью как дефолтом (как уже сделано в `TemplateBindingControl`, поведение единое).
- При выборе роли — апдейт `document_package_template_items` через ту же мутацию, что в `TemplateBindingControl` (RPC/прямой `update`). Извлечь общую логику в `src/hooks/usePackageItemGenerationMode.ts` (новый файл), переиспользовать в обоих местах — чтобы не было двух источников истины.
- При возврате в `single` — `repeat_role_catalog_id = null`.
- Бейдж в шапке карточки: `× по роли «<label>»`, при `per_role_person && !role` — `роль не задана` (destructive).
- Optimistic + toast: «Режим сохранён», «Не удалось сохранить».
- Якорь `id={`pkg-doc-card-${item.id}`}` на корне карточки — для будущих deeplink/scroll.

Реальный сценарий: пользователь открывает «Извещение» в «Анкеты документов» → выбирает «Отдельный документ для каждого физлица с ролью» → выбирает «Участник» → сохраняется. SQL проверка после клика:

```sql
SELECT id, generation_mode, repeat_role_catalog_id
FROM document_package_template_items
WHERE id = 'febd1821-fba8-4290-babf-99c59c27f2f4';
-- expected: generation_mode='per_role_person', repeat_role_catalog_id = id роли Участник (c8fc4200…)
```

### 2. UI: человекочитаемые ошибки в результатах генерации

Файл: `src/components/ai-documents/packages/PackageGenerationPanel.tsx`.

В блоке «Результат последнего запуска» нормализовать строки ошибок:


| Технический код                            | UI-сообщение                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `role_assignment_missing:ln-XXXXXX`        | `Нет назначений для роли «<label>». Назначьте физлицо на эту роль или исправьте шаблон документа.` |
| `ln_token_unknown:ln-XXXXXX`               | `Шаблон ссылается на неизвестную роль «<ln-XXXXXX>».`                                              |
| `ln_token_outside_bound_package:ln-XXXXXX` | `Роль «<label>» принадлежит другому пакету.`                                                       |
| `per_role_no_active_recipients`            | `Для режима «по одному на каждого участника роли» нет активных назначений выбранной роли.`         |
| `per_role_role_not_configured`             | `Не выбрана роль-источник. Откройте карточку документа и выберите роль.`                           |
| `per_role_role_inactive`                   | `Выбранная роль-источник неактивна.`                                                               |
| `per_role_role_package_mismatch`           | `Роль-источник принадлежит другому пакету.`                                                        |


Резолв `ln-XXXXXX → label` через тот же запрос ролей пакета. Если label не найден — fallback на сам код.

Бейдж «блок» остаётся; снизу — человекочитаемая строка вместо технической. Технический код доступен через `title`/тултип для саппорта.

### 3. Backend: защита pre-scan от ложной блокировки repeat-роли

Файл: `supabase/functions/ai-generate-document-package/index.ts` (строки ~447–460).

Перед циклом по item-ам вычислить `repeatRolePublicId` для текущего item:

- если `item.generation_mode === 'per_role_person'` и `repeat_role_catalog_id` задан → `repeatRolePublicId = roleById.get(repeat_role_catalog_id)?.public_id`.

В ветке `LN_RE` (строка 447):

- если `lnPublicId === repeatRolePublicId` и `asgs.length === 0` — **не пушить `role_assignment_missing**`, положить placeholder `preresolved_ln_tokens[lnPublicId] = { value: '', persons: [], positions: [], position_genders: [], role_catalog_id: repeat_role_catalog_id, person_id: null }`. Per-role ветка (строки 597–647) перепишет на каждого recipient.
- если `lnPublicId !== repeatRolePublicId` (например, Ревизор в этом кейсе) — `role_assignment_missing:<lnPublicId>` остаётся как сегодня (корректная ошибка).

Zero-diff для `generation_mode === 'single'`.

### 4. Runtime proof (обязательный)

Сценарий на пакете «Годовое собрание участников» (`package_template_id = 21764469-1ba9-49b3-90d9-5349bcbcd531`):

a) В UI карточки «Извещение» включить `per_role_person`, роль = «Участник» (`ln-000015`).

b) SQL after-проверка:

```sql
SELECT id, title_override, generation_mode, repeat_role_catalog_id
FROM document_package_template_items
WHERE package_template_id = '21764469-1ba9-49b3-90d9-5349bcbcd531'
ORDER BY sort_order;
-- Инструкция, Приказ → single, NULL
-- Извещение → per_role_person, c8fc4200-75c0-4c24-8eea-112c4e468aeb
```

c) SQL active assignments по «Извещение»:

```sql
SELECT a.id, rc.public_id, rc.label, p.full_name
FROM document_package_item_role_assignments a
JOIN document_package_role_catalog rc ON rc.id = a.role_catalog_id
LEFT JOIN legal_details_persons p ON p.id = a.person_id
WHERE a.package_template_item_id = 'febd1821-fba8-4290-babf-99c59c27f2f4'
ORDER BY rc.public_id;
-- ожидание: 3 строки ln-000015 «Участник»
```

d) Запуск «Сформировать пакет документов». Возможны два исхода в зависимости от состояния шаблона «Извещение»:

- **d.1.** Если шаблон всё ещё содержит `{{ln-000014}}` (Ревизор) — генератор корректно блокирует item с **человекочитаемой** ошибкой «Нет назначений для роли „Ревизор"…». Это **доказательство Проблемы B**, не Проблемы A. Для полного runtime proof владелец данных делает одно из двух (это **вне scope патча**, но требуется для runtime прогона):
  - назначить Ревизора на item «Извещение» (один человек), либо
  - удалить `{{ln-000014}}` из DOCX «Извещение» / заменить на `{{recipient.full_name}}`.
- **d.2.** После решения Проблемы B запускаем генерацию повторно: ожидаем «Инструкция» 1 + «Приказ» 1 + «Извещение» **3** = 5 документов.

e) SQL по `ai_generated_documents.meta` для каждого извещения:

```sql
SELECT id, meta->>'generation_mode', meta->>'repeat_role_catalog_id',
       meta->>'repeat_assignment_id', meta->>'recipient_person_id',
       meta->>'recipient_display_name', meta->>'recipient_index'
FROM ai_generated_documents
WHERE generation_batch_id = '<последний batch>'
ORDER BY created_at;
-- ожидание:
--   Инструкция, Приказ — все meta-поля per-recipient = NULL (zero-diff)
--   Извещение × 3 — generation_mode='per_role_person',
--                   repeat_role_catalog_id = id роли Участник,
--                   recipient_index = 1,2,3,
--                   recipient_display_name = ФИО
```

f) Скачать один DOCX «Извещение», убедиться, что `{{recipient.full_name}}` (если шаблон обновлён) или persisted поля — реально подставлены ФИО recipient'a.

g) Скрин UI: карточка «Извещение» с открытым блоком «Режим генерации документа», выбран per_role_person и роль «Участник».

h) Скрин UI: блок «Результат последнего запуска» с человекочитаемой строкой ошибки (если применимо) — техническая `role_assignment_missing:ln-000014` отсутствует в видимом тексте.

Proof-файл: `.lovable/proofs/package_repeatable_documents_stage_c_runtime_fix_v1.md` — все артефакты выше.

## Out of scope

- `supabase/functions/_shared/resolve-per-role-recipients.ts` — не трогаем.
- `canonical-document-generate-strict` — не трогаем (контракт `{{recipient.*}}` готов).
- Редактирование DOCX шаблонов и назначение Ревизора — делает владелец данных, не агент.
- Stage D (UI-группировка результатов по recipient, ретро-синхронизация) — отдельным планом, после закрытия Stage C runtime.
- Полный редизайн `TemplateBindingControl` — оставляем как admin-дубль, синхронизирован через общий хук.

## Технические детали

**Файлы (frontend)**

- **NEW** `src/hooks/usePackageItemGenerationMode.ts` — единый хук: query ролей пакета + мутация апдейта `generation_mode`/`repeat_role_catalog_id` для item-а. Используется и в `PackageDocumentCard`, и в `TemplateBindingControl`.
- `src/components/ai-documents/packages/PackageDocumentCard.tsx` — новый блок «Режим генерации документа» под полями/ролями, бейдж в шапке карточки, `id={pkg-doc-card-${item.id}}`.
- `src/components/ai-documents/packages/TemplateBindingControl.tsx` — заменить локальные query+mutation на `usePackageItemGenerationMode`, поведение и разметка не меняются.
- `src/components/ai-documents/packages/PackageGenerationPanel.tsx` — нормализатор ошибок (мапа кодов → текст с резолвом label роли).

**Файлы (backend)**

- `supabase/functions/ai-generate-document-package/index.ts` — точечный bypass `role_assignment_missing` для repeat-роли в pre-scan (см. §3). Deploy через стандартный workflow.

**Без миграций. Без изменений RLS/grants.**

## DoD

- В карточке документа на вкладке «Анкеты документов» виден блок «Режим генерации документа»: PASS
- Можно выбрать «Отдельный документ для каждого физлица с ролью»: PASS
- Можно выбрать роль «Участник» в селекте «Роль-источник повторения»: PASS
- Настройка сохраняется в `document_package_template_items` (SQL-подтверждение): PASS
- При попытке выбрать `per_role_person` без активных ролей — опция disabled с подсказкой: PASS
- `TemplateBindingControl` и карточка документа используют единый хук (нет дублирования логики): PASS
- Документ «Извещение» генерируется в 3 экземплярах по 3 участникам (после решения Проблемы B владельцем данных): PASS
- `recipient.*` реально подставляется в DOCX: PASS
- `ai_generated_documents.meta` per-recipient полностью заполнен; single-документы без recipient-meta (zero-diff): PASS
- В UI результатов генерации **нет** технических `role_assignment_missing:ln-XXX` — только человекочитаемые сообщения с label роли: PASS
- Pre-scan генератора не блокирует item, если отсутствует именно repeat-роль (другие ln-токены без назначений по-прежнему дают корректную ошибку): PASS
- Single-документы «Инструкция» и «Приказ» работают без изменений: PASS
- Proof создан: `.lovable/proofs/package_repeatable_documents_stage_c_runtime_fix_v1.md`: PASS

Stage D не начинаем до полного закрытия Stage C runtime.