# PATCH 2.1–2.6: Завершение архитектуры токенов

## Статус

### PATCH 2.2 — Duplicate guard + UNIQUE(key): ВЫПОЛНЕН

**Dry-run proof:**
- SQL: `SELECT key, COUNT(*) FROM fields_registry GROUP BY key HAVING COUNT(*) > 1` → **0 дублей**
- Безопасно введён глобальный UNIQUE constraint

**Что сделано:**
1. **SQL migration:** `ALTER TABLE public.fields_registry ADD CONSTRAINT fields_registry_key_unique UNIQUE (key)` — canonical key уникален по всей системе
2. **`src/lib/tokens/tokenDuplicateGuard.ts`** — новый service:
   - `checkTokenDuplicate(key, label, entityType)` — обязательный вызов перед любым INSERT
   - 3 уровня: exact key (block), exact token (block), fuzzy label Levenshtein<3 (block + require explicit reuse decision)
   - Применяется к: admin UI, seed/migration, программное создание
   - Export: `normalizeLabel`, `levenshteinDistance` для тестирования

**DoD:**
- [x] duplicate_keys = 0 (dry-run proof)
- [x] UNIQUE(key) constraint в БД
- [x] Guard service с 3 уровнями проверки
- [x] Fuzzy match не автосоздаёт — требует explicit decision
- [x] JSDoc с registry-first policy

---

### PATCH 2.4 — Package roles + defaults + arrays: ВЫПОЛНЕН

**Reuse audit (registry-first):**
- `package.notice.method` → **skip** (exists as `meeting.notice.method`)
- `package.meeting.location.full` → **skip** (exists as `meeting.location.full`)
- `package.review.location.full` → **skip** (exists as `meeting.review.location.full`)
- `package.review.from` → **skip** (exists as `meeting.review.start`)
- `package.candidates.deadline` → **skip** (exists as `meeting.candidates.deadline`)
- `package.report_year` → **skip** (exists as `meeting.report_year`)

**Что сделано:**

**A. Missing meeting defaults (3 записи):**
- `meeting.review.to` — Окончание рассмотрения вопросов
- `meeting.review.break_from` — Начало перерыва
- `meeting.review.break_to` — Окончание перерыва

**B. Scalar package-role tokens (4 записи, entity_type='package'):**
- `package.signer.full_name` — ФИО подписанта (source_strategy: package_role, role: signer)
- `package.signer.position` — Должность подписанта
- `package.chairperson.full_name` — ФИО председателя
- `package.secretary.full_name` — ФИО секретаря

**C. Array/loop tokens (4 записи):**
- `package.participants` (entity_type='package', data_type='array') — item_schema: full_name✱, share_percent✱, votes_count
- `package.registered_persons` (entity_type='package') — item_schema: full_name✱, registration_time, representative, share_percent
- `agenda.items` (entity_type='agenda') — item_schema: number✱, title✱, speaker, decision_text, votes_for, votes_against, votes_abstained
- `decision.items` (entity_type='decision') — item_schema: agenda_number✱, text✱, result

**D. tokenRegistry.ts обновлён:**
- `loadPackageFields()` — возвращает `{ roles, arrays }` с разделением по source_strategy
- `loadAgendaFields()`, `loadDecisionFields()` — новые loaders
- Кэши: `_packageRolesCache`, `_packageArraysCache`, `_agendaFieldsCache`, `_decisionFieldsCache`
- `tokenStringToLabel()` — рефакторинг, поддерживает все кэши
- `getDocumentTokenGroups()` — 4 новые группы: «Роли в пакете», «Списки пакета», «Повестка дня», «Решения»
- `ArrayTokenResolverContract` type + JSDoc resolver contract

**E. Resolver contract (задокументирован в tokenRegistry.ts):**
- Registry: data_type='array', options.source_strategy='loop', options.item_schema=[...]
- Source: resolver собирает из entity_person_links + persons / package metadata
- Payload: plain objects matching item_schema keys
- DOCX loop: `{#package.participants}{full_name} — {share_percent}%{/package.participants}`
- Validation: required fields checked at generation, warnings in token_manifest_snapshot

**DoD:**
- [x] Registry entries add-only (11 новых, 0 удалённых/изменённых)
- [x] Scalar roles и arrays разделены (разные groups в picker)
- [x] Existing legal_details.* не затронуты
- [x] Existing Telegram/email picker не затронут
- [x] Resolver contract задокументирован (JSDoc + type)
- [x] Loop syntax для DOCX зафиксирован
- [x] Package tokens доступны для будущего tokenContext="documents:annual_meeting"

### PATCH 2.3 — Context-based token source adapter: ВЫПОЛНЕН

**Что сделано:**

**A. TokenContext type + getTokenGroupsForContext() в tokenRegistry.ts:**
- `TokenContext = "messages" | "documents" | "documents:annual_meeting"`
- `loadTokensForContext(context)` — загружает все нужные кэши параллельно (Promise.all)
- `getTokenGroupsForContext(context)` — возвращает группы из кэшей по контексту
- "messages" → Product
- "documents" → + LegalDetails, Entity, Person, EntityPerson, Meeting, Document
- "documents:annual_meeting" → + Package roles, Package arrays, Agenda, Decisions

**B. TokenizedRichInput обновлён:**
- Новый prop `tokenContext?: TokenContext` — финальный standard для всех новых интеграций
- При `tokenContext` — useQuery загружает `loadTokensForContext()` и рендерит `contextGroups`
- При отсутствии `tokenContext` — legacy path (только productFields)
- `extraTokenGroups` помечен `@deprecated` в JSDoc, оставлен для backward compat
- Existing Telegram/email editors не затронуты (не передают tokenContext)

**C. Picker rendering:**
- Contact + DateTime — всегда показываются (static)
- Context groups — рендерятся только при tokenContext
- Product (legacy) — рендерится только БЕЗ tokenContext
- extraTokenGroups — рендерится всегда (backward compat)

**DoD:**
- [x] tokenContext — финальный standard
- [x] extraTokenGroups deprecated, не используется в новых интеграциях
- [x] Contexts зафиксированы: messages, documents, documents:annual_meeting
- [x] Package/agenda/decision группы доступны через tokenContext="documents:annual_meeting"
- [x] Existing Telegram/email flows не изменились
- [x] Новый picker component не создан

### PATCH 2.1 — End-to-end proof: ВЫПОЛНЕН

**Где встроен:** `AiDocumentTemplatesManager.tsx` — поле «Инструкции к шаблону» в create/edit форме шаблона документа.

**Что сделано:**
1. Добавлено поле `template_notes` (tokenized) в форму создания/редактирования AI-шаблона
2. Используется `TokenizedRichInput` с `tokenContext="documents:annual_meeting"`
3. Picker при `[` показывает все document groups: Contact, DateTime, Product, Реквизиты, Юрлицо, Физлицо, Связи, Собрание, Документ, Роли в пакете, Списки пакета, Повестка дня, Решения
4. SoT: `{{meeting.date}}`, UI: chip `[Дата собрания]`
5. Reload → chip восстанавливается через `tokenStringToLabel()`

**Persistence proof (PATCH 2.1 fix):**
- SQL migration: `ALTER TABLE public.document_templates ADD COLUMN IF NOT EXISTS template_notes text`
- `handleSave` → create и update включают `template_notes`
- Existing шаблоны без template_notes: NULL допустим, поломки нет
- Full cycle: `[` → picker → `{{meeting.date}}` → save to DB → reload → chip restored

**Production context:** Поле «Инструкции к шаблону» — реальная бизнес-потребность для документирования токенов и инструкций по заполнению шаблона.

**DoD:**
- [x] `[` открывает picker
- [x] Доступны все группы для tokenContext="documents:annual_meeting"
- [x] Выбор [Дата собрания] сохраняет {{meeting.date}} в SoT
- [x] template_notes сохраняется в БД (create + update)
- [x] После reload UI label/chip восстанавливается
- [x] Existing шаблоны без template_notes не ломаются
- [x] Existing Telegram/email editors не затронуты
- [x] Новый picker component не создан

### PATCH 2.5 — Master token matrix (gate): ВЫПОЛНЕН

**Артефакт:** `docs/token_matrix.md`

**Содержание:**
- Reuse 1:1 блок: 59 existing keys reused (47 legal_details + 12 meeting)
- New add-only блок: 38 новых ключей
- Full matrix: 97 записей по 15+ колонкам
- Колонки: canonical_key, ui_label, entity_type, scalar_array, token_context, resolver_scope, status, doc1–doc4 usage, legacy_alias
- status: reused / new / legacy-only / legacy+canonical
- legacy_alias: конкретные ad-hoc token names (entity_name, entity_address, director_name, etc.)
- Doc usage: manual classification для 4 документов годового собрания

**Gate conditions:**
- [ ] Matrix утверждена владельцем
- [ ] Legacy aliases проверены
- [ ] Doc usage проверен на соответствие реальным DOCX
- [ ] После утверждения → можно переходить к PATCH 2.6

### PATCH 2.6 — Snapshot + deprecation: НЕ НАЧАТ

---

## Утверждённые правила

### Reusable rule (обязательно для всех будущих функций)
1. Сначала искать existing key в global registry
2. Использовать existing square-bracket picker
3. Не создавать новый локальный список токенов без proof, что reuse невозможен

### STOP-guards
- Не ломать existing Telegram/email token flows
- Не менять формат уже сохранённых `{{system.token}}`
- Не менять billing/template flows (`generate-from-template`)
- Не создавать новый picker component
- `extraTokenGroups` deprecated — не использовать в новых интеграциях

### Gate
- Без утверждённой master token matrix (PATCH 2.5) нельзя переходить к финальной нормализации 4 DOCX шаблонов

### Canonical Standard (4 уровня)
1. **internal id:** UUID (fields_registry.id)
2. **canonical key:** e.g. `meeting.notice.date` (fields_registry.key, UNIQUE globally)
3. **system token:** `{{meeting.notice.date}}` (хранится в тексте/шаблонах)
4. **UI token:** `[Дата направления извещения]` (показывается в редакторе)

### Порядок выполнения
1. ~~PATCH 2.2~~ ✅
2. PATCH 2.4
3. PATCH 2.3
4. PATCH 2.1
5. PATCH 2.5 (gate)
6. PATCH 2.6
