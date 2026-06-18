# да, согласен, с учетом правок:

1. **Исправить Stage 7: detected-поле определяется токеном в активной DOCX-версии, а не записью в** `document_package_item_field_assignments`**.** Канонический переход:
  &nbsp;
  ```text
  создать отдельное контролируемое orphan-поле
  → сохранить session-level значение X
  → вставить {{pf-XXXXXX}} в DOCX документа D
  → загрузить и активировать новую версию шаблона
  → перезагрузить сессию
  → поле исчезло из orphan-блока и появилось в карточке D
  ```
  Обратный переход:
  ```text
  удалить токен из DOCX
  → загрузить и активировать следующую версию
  → поле снова стало orphan
  ```
  Sprint 3G assignment UI не является SOT для detected-полей и не должен использоваться для этого proof.
2. **Для Stage 7 не брать архивированное** `pf-000002`**.** После cleanup создать новое тестовое активное поле с отдельным `pf-XXXXXX`, пройти полный transition и затем выполнить cleanup тестового поля, версий, session-value и generated documents. Историческое значение `pf-000002` не изменять.
3. **Исправить Stage 6 workflow полей.** Фраза «привязать поля через UI» допустима только для создания каталога/настройки метаданных. Появление поля в карточке должно быть доказано через:
  &nbsp;
  ```text
  pf-каталог
  → токен в DOCX
  → загрузка версии
  → активация current_version_id
  → автоматический detection
  ```
  Прямые INSERT и старые item-field assignments не использовать.
4. **Stage 6 должен включать генерацию обоих документов как обязательный DoD, а не “если orchestrator подключён”.** Ранее это уже утверждено. Требуется:
  - два generated-документа;
  - разные per-item значения;
  - разные роли;
  - отсутствие смешения;
  - корректные snapshots с `package_template_item_id`;
  - статус `generated`.
  Если генерация недоступна, Stage 6 получает `FAIL`, а не частичный PASS.
5. **Исправить проверку snapshots Stage 5.0.3.** Для package-токенов канонический runtime proof находится в:
  &nbsp;
  ```text
  meta.tokens_snapshot[]
  template_tokens_snapshot
  ```
  `snapshot.fields` и `token_manifest_snapshot` ранее оставлены billing-only. Не требовать появления package-токенов в `package_snapshot.fields[*]`, если такого канонического поля в текущей модели нет.
  Для каждого токена показать:
6. **Billing regression не сравнивать полным diff документа, если документ содержит динамические реквизиты.** Проверять точечные значения соответствующих токенов и отсутствие регрессии форматирования:
  &nbsp;
  ```text
  FLD-000011 → АЖУР инкам
  FLD-000345 → ЗАО «АЖУР инкам»
  FLD-000010 → ЗАО
  FLD-000010|format=long → Закрытое акционерное общество
  ```
  Различия номера, даты, времени генерации и других динамических полей не считать регрессией.
7. **В Stage 5 broken-payload proof использовать предметную серверную ошибку, а не синтаксически битый JSON.** Например:
  - чужой `person_id`;
  - `stale_template_version`;
  - field вне package;
  - role вне package.
  Битый JSON может быть отклонён до RPC и не доказывает atomic rollback. Требуется фактический вызов `save_session_document_atomic`, который начал серверную валидацию и завершился без изменений данных и success-audit.
8. **Не фиксировать заранее HTTP 4xx.** RPC через PostgREST может вернуть конкретный HTTP-статус в зависимости от SQLSTATE. В proof фиксировать фактический статус и точный semantic error code. Критерий PASS:
9. **No-op сценарий Stage 5 запускать через реальный UI clean-state.** При отсутствии изменений кнопка должна быть disabled и сетевого вызова быть не должно:
  &nbsp;
  ```text
  save_session_document_atomic calls = 0
  audit delta = 0
  ```
  Повтор идентичного payload напрямую — отдельный idempotency-факт RPC, но он не заменяет UI-proof clean-state.
10. **В role-only proof не считать все отсутствующие строки “удалёнными”.** Проверять только управляемый desired-state текущего item. Системные, hidden и неразрешённые пользователю назначения не должны архивироваться. Соседний item остаётся без изменений.
11. **Уточнить SQL Stage 6.** Проверка:

```text
field_public_id вне списка assignments
```

противоречит token-driven модели. Заменить её на:

- per-item value относится к `pf`, обнаруженному в `current_version_id` соответствующего документа;
- session-level orphan value может существовать без detected token;
- нет per-item phantom rows по полям, отсутствующим в active/current DOCX;
- нет данных другого item/package/session.

12. **Stage 5.0.4 не должен создавать искусственную сессию без активной версии только ради скриншота, если такой fixture отсутствует.** Empty-state можно доказать компонентным тестом или существующим безопасным fixture. Не отключать `current_version_id` у рабочих шаблонов «Идеологии» и «Годового собрания».
13. **Tooltip-проверка должна учитывать отсутствие description.** Иконка `i` обязательна только для полей с заполненным `catalog.description`. Для поля без описания отсутствие иконки является правильным поведением.
14. **Нумерацию проверить на пакете с несколькими документами.** Недостаточно доказать «единственный документ = 1». Для «Годового собрания» подтвердить последовательность:

```text
1, 2, 3, ...
```

после фактической фильтрации и сортировки, без зависимости от исходного `sort_order`.

15. **Не смешивать proof-only с cleanup, который меняет рабочие данные.** Все временные Stage 6–7 сущности должны иметь отдельный manifest:

- созданные UUID;
- исходное состояние;
- выполненный cleanup;
- финальные нулевые остатки;
- рабочие шаблоны и исторические generated documents не удалены.

16. **Финальный отчёт разделить строго на:**

```text
Stage 5.0.3 runtime naming contract
Stage 5.0.4 visual/runtime parity
Stage 5 atomic UI runtime
Stage 6 new-package E2E
Stage 7 token-driven orphan transition
Cleanup
```

Для каждого: `PASS / FAIL`, network proof, SQL proof, UI screenshots, generated-document proof и изменённые данные. Patch закрывается только при полном PASS всех блоков.

&nbsp;

План: закрытие Stage 5.0.4 → 5 → 6 → 7 + runtime proof для 5.0.3

Все этапы — proof-only. Никаких новых RPC, edge-функций, helper'ов. Любой обнаруженный вне рамок баг → стоп и обсуждение, не чинить молча.

---

## Stage 5.0.4 — Runtime + visual proof (включая отложенный runtime для 5.0.3)

Инструменты: `browser--view_preview` под dev-паролем `123456`, `browser--list_network_requests` / `get_network_request_details`, `supabase--read_query`. Скриншоты — в `.lovable/proofs/stage5_0_4_runtime/`.

### A. Сессия «Идеология» (`Шаблон — Приказ об организации идеологической работы`, v6)

1. Единственный документ нумеруется как «1», заголовок и описание подтянуты.
2. Архивное поле `pf-000002` (UAT B5) НЕ отображается ни в полях, ни в badge «общее значение».
3. Поля идут одностолбцово; у каждого справа от label иконка `i` (Tooltip с описанием FLD из catalog).
4. Роли видны, обязательность считается, badge «обязательное» совпадает с `required` из `document_package_item_role_assignments`.
5. Если у `document_templates.current_version_id` версия отсутствует → explicit empty-state «Шаблон не настроен», без падений.

### B. Сессия «Годовое собрание» (`1. Приказ о проведении годового общего собрания участников ООО`, v2)

1. Заголовок присутствует, 7/7 полей, роли и обязательность считаются.
2. Календарь и кнопка «Сохранить» работают (`save_session_document_atomic` → 200, audit +1).
3. UI 1:1 как в «Идеологии» (та же геометрия карточки, те же отступы, та же иконка `i`).

### C. SQL-валидация архивного `pf-000002`

```sql
SELECT dt.id, dt.name, dtv.id AS current_version_id, dtv.version_number,
       (dtv.detected_tokens::text LIKE '%pf-000002%') AS has_pf2
FROM document_templates dt
JOIN document_template_versions dtv ON dtv.id = dt.current_version_id
WHERE dt.id IN ('<идеология>', '<годовое собрание>');
```

Ожидание: `has_pf2 = false` для обеих current-версий. Если `true` — стоп, проблема не в UI, поднимаем отдельно.

### D. Runtime generation proof (отложено из Stage 5.0.3)

В сессии «Идеология» с реальными реквизитами `ЗАО «АЖУР инкам»` (`leg_org_form=ЗАО`, `leg_name='АЖУР инкам'`):

1. Сгенерировать DOCX через канонический путь (`canonical-document-generate-strict` или UI-кнопка генерации в карточке).
2. Распарсить через `pandoc --to=plain` (или через `docx-text-extract`, чем уже пользовался Stage 5.0.4 baseline).
3. Сохранить snapshot `package_snapshot.fields[*].raw_value` и `rendered_value` из `ai_generated_documents.meta` для токенов:
  - `package.ul.FLD-000011` → `АЖУР инкам`;
  - `package.ul.FLD-000345` → `ЗАО «АЖУР инкам»`;
  - `package.ul.FLD-000010` → `ЗАО`;
  - `package.ul.FLD-000010|format=long` → `Закрытое акционерное общество`.
4. Явные негативные ассерты по тексту DOCX: `not contains "ЗАО «ЗАО «АЖУР инкам»»"`, `not contains "«ЗАО «АЖУР инкам»»"`, `not contains "«ЗАО»"`.
5. Billing-регресс: сгенерировать актуальный `Шаблон. Счёт-акт на услуги ЮЛ - Исполнитель v3` на тех же реквизитах → `field:FLD-000345` всё ещё даёт `ЗАО «АЖУР инкам»`, без двойных кавычек. Diff с baseline должен быть пустым.

### E. Таблица «Плейсхолдеры для Word» (group «Пакет: ЮЛ»)

Скриншот раздела `/admin/documents` → каталог; визуально подтвердить строки:


| Название                                                 | FLD          | Пример                          | Токен                                   |
| -------------------------------------------------------- | ------------ | ------------------------------- | --------------------------------------- |
| Название (без формы собственности)                       | `FLD-000011` | `АЖУР инкам`                    | `{{package.ul.FLD-000011}}`             |
| Краткое наименование                                     | `FLD-000345` | `ЗАО «АЖУР инкам»`              | `{{package.ul.FLD-000345}}`             |
| Форма собственности (кратко)                             | `FLD-000010` | `ЗАО`                           | `{{package.ul.FLD-000010}}`             |
| Форма собственности (развёрнуто, modifier `format=long`) | `FLD-000010` | `Закрытое акционерное общество` | `{{package.ul.FLD-000010|format=long}}` |


### F. Скриншоты

`.lovable/proofs/stage5_0_4_runtime/`:

- `ideology_desktop_light.png`, `ideology_desktop_dark.png`, `ideology_mobile_390x844.png`;
- `meeting_desktop_light.png`, `meeting_mobile_390x844.png`;
- `card_ready.png`, `card_partial.png`, `card_empty.png`, `card_dirty.png`, `save_disabled_tooltip.png`;
- `placeholders_catalog_ul.png`;
- `docx_ideology_plaintext.txt` (распакованный текст сгенерированного приказа);
- `billing_invoice_plaintext_before.txt` / `..._after.txt` (для diff billing-регресса).

Финальный proof: `.lovable/proofs/stage5_0_4_runtime.md` со ссылками на скриншоты + результаты SQL + результаты ассертов D.4 / D.5.

---

## Stage 5 — Atomic runtime proof

Контракт `save_session_document_atomic` (без правок кода). Каждая проверка = отдельный сценарий в сессии «Идеология» или Stage 6 пакете.

1. **Field-only save** — изменить 1 поле → 1 запись `audit_logs.action='save_session_document_atomic'`, изменён ровно один `document_package_session_field_values` per-item row, остальные доки не задеты.
2. **Role-only save (full desired-state)** — переназначить роль участника → 1 audit, в `document_package_item_role_assignments` остаются только указанные в payload (лишние удалены) **только для этого item**, у соседних item — без изменений.
3. **Field + role в одной транзакции** → 1 audit, оба эффекта применены.
4. **No-op save** (повтор payload) → 1 audit с пометкой `noop=true` или БЕЗ записи (зависит от текущего контракта — зафиксировать factual поведение, не править).
5. **Broken payload** (битый JSON / missing FK) → HTTP 4xx, dirty в UI сохраняется, БД не меняется (snapshot до/после идентичен), success-toast не показан, error normalized через `normalizeEdgeFunctionError`.
6. **Orphan session-level значение** (`document_package_session_field_values.package_session_id is not null AND package_template_item_id is null`) не меняется ни в одном из сценариев 1–5.

Каждый сценарий — отдельный snapshot (psql `SELECT ... ORDER BY id` до/после) + сетевой запрос из `browser--list_network_requests` + cumulative `audit_logs` дельта.

Proof: `.lovable/proofs/stage5_unified_runtime.md`.

---

## Stage 6 — E2E нового пакета

Чистый пользовательский путь, без админ-консолей и SQL-инъекций:

1. Через UI `/admin/document-packages` (Sprint 3G) создать новый `document_package_template` с двумя `document_package_template_items` (новый или duplicate шаблон + любой существующий, чтобы был mix).
2. Привязать поля и роли через тот же UI (никаких прямых INSERT).
3. Под обычным пользователем (НЕ super_admin) открыть `/cabinet/documents` → создать `document_package_session` от этого template.
4. Через `PackageDocumentCard` заполнить поля, назначить роли, сохранить.
5. Перезагрузить страницу → состояние совпадает.
6. Сгенерировать оба документа.
7. SQL-проверки:
  - в `document_package_session_field_values` нет строк с `field_public_id` вне list'а assignments;
  - нет phantom `document_package_item_role_assignments` без `person_id` / `role_key`;
  - `audit_logs` — по 1 записи `save_session_document_atomic` на каждый сохранённый документ;
  - `ai_generated_documents` — 2 строки, обе со `status='generated'` и не пустым `meta.package_snapshot`.
8. Grep по коду: убедиться, что новых ветвлений `if (packageId === '<новый uuid>')` нет (никаких хардкодов под новый шаблон).

Proof: `.lovable/proofs/stage6_new_package_e2e.md`.

---

## Stage 7 — Orphan → detected transition

В сессии «Идеология» после 5.0.1 cleanup:

1. **Baseline**: orphan-блок показывает значение `X` для поля `FLD-XXX`, не привязанного к документу. Snapshot БД: session-level row есть, per-item — нет.
2. **Привязка** через Sprint 3G UI: добавить `FLD-XXX` в `document_package_item_field_assignments` для документа `D`.
3. **Reload карточки**: orphan-блок исчез (значение «съехало» в документ `D`), per-item row по-прежнему нет, session-level row жива, значение `X` подтягивается как fallback.
4. **Изменение в карточке**: ввести `Y`, сохранить → atomic save создаёт per-item row со значением `Y`, session-level row остаётся `X`.
5. **Откат привязки**: убрать `FLD-XXX` из assignments → orphan-блок снова показывает `X` (session-level), per-item `Y` для документа `D` либо физически удалён, либо помечен `archived` (зафиксировать factual поведение).
6. **DOCX-проверка** между шагами 3 и 4: сгенерированный документ содержит `X`. Между шагами 4 и 5: содержит `Y`.
7. **Audit delta**: на чистом transition (шаги 2, 3, 5) запись в `audit_logs` для save_session_document_atomic НЕ растёт; растёт только запись для UI/admin assignments-mutation.

Proof: `.lovable/proofs/stage7_orphan_transition.md`.

---

## DoD

- Все 4 proof-файла созданы и в `.lovable/plan.md` стадии помечены PASS.
- Никаких новых helper'ов / RPC / edge-функций.
- DOCX-шаблоны не правятся.
- При расхождении наблюдаемого поведения с ожиданием — стоп, фиксируем расхождение в proof и эскалируем, не чиним.

## Порядок исполнения

1. Stage 5.0.4 целиком (A → F), включая отложенный runtime для 5.0.3 (D).
2. Stage 5 (только после 5.0.4 — нужна рабочая сессия).
3. Stage 6 (новый пакет — изолирован).
4. Stage 7 (требует 5.0.1 cleanup baseline и Sprint 3G UI).

Каждый stage заканчивается коротким отчётом «Отчёт о выполнении» с ссылкой на proof и явным PASS/FAIL по чек-листу.