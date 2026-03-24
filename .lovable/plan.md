# да, согласен, с учетом правок:

&nbsp;

1. **PATCH 2.2 — UNIQUE(key) вводить только после dry-run proof**
  &nbsp;
  - сначала показать SQL-проверку на глобальные конфликты по fields_registry.key;
  - если конфликтов нет — вводить UNIQUE(key);
  - если есть архивные/исторические дубли — сначала дать mapping и план очистки.
  - В отчёте нужен явный proof: duplicate_keys = 0.
  &nbsp;
2. **PATCH 2.2 — duplicate guard должен работать не только для UI/admin, но и для seed/migration flow**
  &nbsp;
  - любой insert новых токенов обязан идти через единое правило registry-first;
  - если migration добавляет токен с existing key — не insert, а reuse/skip с отчётом;
  - fuzzy duplicate не создавать автоматически.
  &nbsp;
3. **PATCH 2.4 — package roles поддерживаю, но добавить ещё package-level defaults/overrides**
  &nbsp;
  - package.notice.method
  - package.meeting.location.full
  - [package.review](http://package.review).location.full
  - [package.review](http://package.review).from/to
  - [package.review](http://package.review).break_from/to
  - package.candidates.deadline
  - это именно пакетные данные собрания, а не document-specific.
  &nbsp;
4. **PATCH 2.4 — loops/arrays сразу разделить на source и render**
  &nbsp;
  - в registry хранить только canonical key + metadata/item_schema;
  - в resolver отдельно зафиксировать, как массив собирается;
  - в docxtemplater отдельно задокументировать loop syntax;
  - не смешивать registry-модель и render-логику.
  &nbsp;
5. **PATCH 2.3 — tokenContext сделать финальным standard**
  &nbsp;
  - новые интеграции только через tokenContext;
  - extraTokenGroups оставить временно, но пометить deprecated и не использовать в новых местах;
  - contexts лучше зафиксировать сразу как:
    &nbsp;
    - messages
    - documents
    - documents:annual_meeting
    - с возможностью дальнейшего расширения.
    &nbsp;
  &nbsp;
6. **PATCH 2.1 — не встраивать TokenizedRichInput в wizard искусственно, если там нет реального бизнес-поля**
  &nbsp;
  - proof нужен в реальном production document context;
  - если в GenerateAiDocumentDialog / GenerateAiDocumentPackageDialog нет естественного tokenized text field, не добавлять его “ради теста”;
  - тогда сделать отдельный реальный admin/template editor или placeholder preview field внутри document flow, который действительно нужен продукту.
  &nbsp;
7. **PATCH 2.5 — master token matrix сделать не во временный /mnt/..., а как постоянный артефакт проекта**
  &nbsp;
  - хранить в репозитории/админ-документации проекта;
  - формат ок: CSV/markdown;
  - обязательные колонки:
    &nbsp;
    - canonical_key
    - ui_label
    - entity_type
    - source
    - scope
    - scalar_array
    - computed_db_manual
    - doc1/doc2/doc3/doc4
    - validation
    - legacy_alias
    &nbsp;
  &nbsp;
8. **PATCH 2.5 — matrix сделать gate перед финальной переделкой 4 DOCX**
  &nbsp;
  - без утверждённой matrix не переходить к финальной canonical-нормализации всех шаблонов;
  - это обязательный checkpoint.
  &nbsp;
9. **PATCH 2.6 — snapshot strategy дополнить template_id / template_code и resolver_version**
  &nbsp;
  - помимо template_version, registry_version, template_tokens_snapshot;
  - нужен ещё resolver_version, чтобы потом понимать, какой логикой было собрано значение.
  &nbsp;
10. **PATCH 2.6 — admin legacy report обязателен, не ограничиваться логами**
  &nbsp;
  - console.warn — только вспомогательно;
  - нужен отдельный UI/админ-отчёт:
    &nbsp;
    - шаблон
    - найденные legacy tokens
    - canonical replacement
    - статус миграции
    - дата последней проверки
    &nbsp;
  &nbsp;
11. **Порядок выполнения поддерживаю, но с уточнением gate**
  &nbsp;
  - PATCH 2.2
  - PATCH 2.4
  - PATCH 2.3
  - PATCH 2.1
  - PATCH 2.5 как обязательный gate
  - PATCH 2.6
  - после этого только переход к полной нормализации пакета из 4 документов.
  &nbsp;
12. **Добавить явный reusable rule**
  &nbsp;
  - любые будущие функции в проекте, где используются placeholder-ы, обязаны:
    &nbsp;
    1. сначала искать existing key в global registry;
    2. использовать existing square-bracket picker;
    3. не создавать новый локальный список токенов без proof, что reuse невозможен.
    &nbsp;
  &nbsp;

&nbsp;

&nbsp;

PATCH 2.1–2.6: Завершение архитектуры токенов (с учётом правок)

## Текущее состояние (подтверждено кодом)

- `getDocumentTokenGroups()` определена в `tokenRegistry.ts`, но **нигде не вызывается** — ни один document editor не использует её
- `extraTokenGroups` prop существует в `TokenizedRichInput`, но **ни одна точка не передаёт его**
- Все 10+ использований `TokenizedRichInput` — Telegram/email, без document context
- `fields_registry` имеет `UNIQUE(entity_type, key)` — нет глобального UNIQUE на `key`
- Document editors: `GenerateAiDocumentDialog`, `GenerateAiDocumentPackageDialog` — form-based wizards, не текстовые редакторы

---

## Порядок выполнения (утверждённый)

### PATCH 2.2 — Duplicate guard + registry-first create policy

**Что делать:**

1. Добавить SQL constraint `UNIQUE(key)` глобально на `fields_registry` (canonical key уникален по всей системе, не только в рамках entity_type)
2. Создать service `src/lib/tokens/tokenDuplicateGuard.ts`:
  - `checkExactKeyDuplicate(key)` → block
  - `checkExactTokenDuplicate(tokenString)` → block
  - `checkFuzzyLabelDuplicate(label, entityType)` → warning (Levenshtein < 3 или normalized match)
3. Обязательный flow: любой новый INSERT в `fields_registry` проходит через guard (service-level, не только helper)
4. JSDoc: registry-first create policy

**STOP-guard:** проверить, что existing keys не конфликтуют по глобальному UNIQUE перед миграцией

---

### PATCH 2.4 — Package roles (scalar) + arrays/loops

**A. Scalar package roles** — новые записи в `fields_registry` (entity_type = `package`):

```text
package.signer.full_name        → "ФИО подписанта"
package.signer.position         → "Должность подписанта"
package.chairperson.full_name   → "ФИО председателя"
package.secretary.full_name     → "ФИО секретаря"
package.report_year             → "Отчётный год"
```

metadata: `{"source_strategy": "package_role", "role": "signer"}`

**B. Array/loop entities** — записи с `data_type = "array"`:

```text
package.participants[]          → item_schema: {full_name, share_percent, votes_count}
package.registered_persons[]    → item_schema: {full_name, registration_time, representative}
agenda.items[]                  → item_schema: {number, title, speaker, decision_text, votes_for, votes_against}
decision.items[]                → item_schema: {agenda_item, text, result}
```

metadata: `{"source_strategy": "loop", "item_schema": [...]}`

**C. Resolver contract для arrays:**

- Resolver возвращает массив объектов для loop tokens
- docxtemplater получает: `{#package.participants}{full_name} — {share_percent}%{/package.participants}`
- item_schema хранится в `options` JSONB
- Обязательные поля item-а валидируются при генерации

---

### PATCH 2.3 — Context-based token source adapter

**Что делать:**

1. В `tokenRegistry.ts` добавить:
  ```text
   type TokenContext = "messages" | "documents" | "documents:annual_meeting"
   function getTokenGroupsForContext(context: TokenContext): TokenGroup[]
  ```
2. Маппинг:
  - `"messages"` → Contact + DateTime + Product (текущее)
  - `"documents"` → Contact + DateTime + LegalDetails + Entity + Person + EntityPerson + Document + Meeting
  - `"documents:annual_meeting"` → documents + Package roles + Agenda + Attendance
3. В `TokenizedRichInput` добавить prop `tokenContext?: TokenContext`
  - Если передан — группы загружаются через `getTokenGroupsForContext()`
  - `extraTokenGroups` пометить `@deprecated` в JSDoc, оставить для backward compat
  - Новые document integrations обязаны использовать только `tokenContext`

---

### PATCH 2.1 — End-to-end proof в production document context

**Целевой экран:** `GenerateAiDocumentDialog` или `GenerateAiDocumentPackageDialog` — production wizard для генерации документов.

**Что делать:**

1. Подключить `TokenizedRichInput` с `tokenContext="documents"` в целевом document wizard (например, для поля описания/промпта документа или для preview/editing placeholder-ов)
2. Загрузить все кэши (person, meeting, document и т.д.) при mount через loaders
3. Проверить полную цепочку:
  - `[` → picker с document groups → выбор `[Дата собрания]`
  - В stored value: `{{meeting.date}}`
  - Reload → chip `[Дата собрания]` восстанавливается через `tokenStringToLabel()`

**DoD:**

- Picker подключён в реальном document context, а не во временном тестовом поле
- `[` → выбор → `{{system.token}}` в SoT → reload → chip восстановлен
- Existing Telegram/email editors не затронуты

---

### PATCH 2.5 — Master token matrix (gate-артефакт)

**Формат:** CSV в `/mnt/documents/`

| canonical_key | ui_label | entity_type | source | scope | scalar_array | computed_db_manual | doc1 | doc2 | doc3 | doc4 | validation | legacy_alias |

Документы 1-4: Приказ, Извещение, Список зарегистрированных, Протокол.

**Gate-правило:** без утверждённой matrix нельзя считать canonical migration complete и нельзя переходить к финальной нормализации 4 DOCX шаблонов.

**Колонка `legacy_alias**` — для управления compatibility layer и deprecation.

---

### PATCH 2.6 — Snapshot strategy + deprecation plan

**A. Snapshot schema** — в `document_generation_snapshots` сохранять:

- `placeholder_data_snapshot` — resolved values `{key: value}`
- `token_manifest_snapshot` — requested tokens, found, missing
- `template_tokens_snapshot` — какие токены реально были в DOCX на момент генерации
- `template_version`, `registry_version` (timestamp)
- `warnings_snapshot` — validation warnings
- `source_trace` — per-key: `{source: "db|computed|manual", table, column}`

**B. Deprecation plan:**

- **Phase A:** Dual resolve (текущее)
- **Phase B:** Diagnostic logging: если DOCX template использует ad-hoc key при наличии canonical → `console.warn`
- **Phase C:** Админ-отчёт в UI (не только логи): таблица «шаблон → legacy tokens → canonical replacement → статус миграции»
- **Phase D:** После полной миграции — удаление ad-hoc aliases

**Deliverable Phase C:** отдельная страница/секция в админке со списком шаблонов и их legacy/canonical статусом.

---

## STOP-guards

- Не ломать existing Telegram/email token flows
- Не менять формат уже сохранённых `{{system.token}}`
- Не менять billing/template flows (`generate-from-template`)
- Не создавать новый picker component
- `extraTokenGroups` не использовать в новых интеграциях (deprecated, только bridge)

## Файлы, которые меняются


| Файл                                          | Патч | Что                                                                  |
| --------------------------------------------- | ---- | -------------------------------------------------------------------- |
| SQL migration                                 | 2.2  | UNIQUE(key) на fields_registry                                       |
| `src/lib/tokens/tokenDuplicateGuard.ts`       | 2.2  | Новый: guard service                                                 |
| SQL migration                                 | 2.4  | INSERT package/agenda/decision entries                               |
| `src/lib/tokens/tokenRegistry.ts`             | 2.3  | +TokenContext, +getTokenGroupsForContext, deprecate extraTokenGroups |
| `src/components/admin/TokenizedRichInput.tsx` | 2.3  | +tokenContext prop                                                   |
| Document wizard component                     | 2.1  | +TokenizedRichInput с tokenContext="documents"                       |
| Edge functions                                | 2.6  | +legacy diagnostic logging                                           |
| `/mnt/documents/token_matrix.csv`             | 2.5  | Master matrix artifact                                               |


## Что НЕ меняется

- Existing Telegram/email editors
- Existing `legal_details.*` записи
- `generate-from-template` (billing)
- `client_legal_details` schema
- RLS policies
- Формат сохранённых `{{token}}` строк