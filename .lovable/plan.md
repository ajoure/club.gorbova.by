# PATCH 1+2: Canonical Token Standard + Reuse Existing Picker

## Статус: ВЫПОЛНЕНО

### Что сделано

#### 1. fields_registry — seed новых entity_types (39 записей)
- `person` (12 записей): full_name, initials, birth_date, personal_number, passport_*, phone, email, address
- `entity_person` (6 записей): role_label, position, share_percent, acts_on_basis, start_date, is_primary
- `document` (3 записи): number, date, date_short
- `meeting` (12 записей): date, time, location.full, notice.date, notice.method, registration.*, review.*, report_year, candidates.deadline
- `entity` (6 записей): name, settlement_display, director_short, address.legal.full, settlement.type.short, settlement.name
- Existing `legal_details.*` (47 записей) и `product` (2 записи) — НЕ тронуты

#### 2. tokenRegistry.ts — расширен
- Добавлены 5 новых loader-функций: loadPersonFields, loadEntityPersonFields, loadDocumentFields, loadMeetingFields, loadEntityFields
- Добавлены соответствующие кэши и setter-функции
- tokenStringToLabel() обновлён для поиска по всем новым кэшам
- Добавлена helper-функция getDocumentTokenGroups() для UI
- Универсальный loadFieldsByEntityType() для DRY
- JSDoc обновлён: задокументировано правило registry-first и 4 уровня представления токена

#### 3. TokenizedRichInput.tsx — расширен
- Добавлен prop `extraTokenGroups?: Array<{ heading: string; tokens: TokenDef[] }>`
- В picker dropdown после существующих групп рендерятся дополнительные группы
- Существующие вызовы (Telegram/email) не затронуты — у них нет extraTokenGroups

#### 4. Compatibility layer в edge functions
- ai-generate-document: canonical key aliases добавлены параллельно с ad-hoc
- ai-generate-document-package: аналогично
- Старые DOCX шаблоны с ad-hoc ключами продолжают работать
- Новые шаблоны могут использовать canonical keys (e.g. {{person.full_name}}, {{entity.name}})

### Canonical Naming Standard

4 уровня представления:
1. **internal id**: UUID (fields_registry.id)
2. **canonical key**: e.g. `meeting.notice.date` (fields_registry.key)
3. **system token**: `{{meeting.notice.date}}` (хранится в тексте/шаблонах)
4. **UI token**: `[Дата направления извещения]` (показывается в редакторе)

### Файлы изменены
- `src/lib/tokens/tokenRegistry.ts` — полная переработка с новыми loaders
- `src/components/admin/TokenizedRichInput.tsx` — +prop extraTokenGroups, +рендер
- `supabase/functions/ai-generate-document/index.ts` — +canonical key aliases
- `supabase/functions/ai-generate-document-package/index.ts` — +canonical key aliases
- `fields_registry` — +39 записей (add-only)

### Что НЕ менялось
- Existing `legal_details.*` записи в fields_registry
- Existing `LEGAL_DETAILS_FIELD_MAP`
- Existing `token-resolver.ts`
- Existing DOCX шаблоны
- Existing Telegram/email использование TokenizedRichInput
- `generate-from-template` (protected billing flow)

### Следующие шаги (PATCH 3+)
- Token catalog service layer (registry + computed + package + loop)
- Package roles namespace (package.signer.*, package.chairperson.*)
- Loops/arrays support (package.participants[], agenda.items[])
- Draft sessions + snapshots
- Schema-driven forms + legal warnings
- Multi-role model
- 4 шаблона годового собрания на canonical standard
- Deprecation plan для legacy ad-hoc tokens
