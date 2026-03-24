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

### PATCH 2.4 — Package roles + arrays: НЕ НАЧАТ

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
