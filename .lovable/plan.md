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

### PATCH 2.3 — Context-based token source adapter: НЕ НАЧАТ

### PATCH 2.1 — End-to-end proof: НЕ НАЧАТ

### PATCH 2.5 — Master token matrix (gate): НЕ НАЧАТ

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
