# да, согласен, с учетом правок:

&nbsp;

1. **PATCH 2.1 сначала обязательно дожать до полного save/load proof**
  &nbsp;
  - добавить template_notes в БД;
  - включить его в create/update;
  - подтвердить reopen/reload cycle:
    &nbsp;
    - сохранено {{[meeting.date](http://meeting.date)}},
    - после повторного открытия формы chip восстанавливается.
    &nbsp;
  - Без этого PATCH 2.1 не закрыт.
  &nbsp;
2. **Для template_notes добавь add-only/compat proof**
  &nbsp;
  - existing шаблоны без template_notes должны открываться и сохраняться без поломки;
  - migration должна быть безопасной: NULL/'' допустимы.
  &nbsp;
3. **PATCH 2.5 matrix поддерживаю, но делай её не “полу-ручной”, а максимально из live registry + отдельно помеченный manual layer**
  &nbsp;
  - колонки оставить:
    &nbsp;
    - canonical_key
    - ui_label
    - entity_type
    - source
    - scope
    - scalar_array
    - computed_db_manual
    - doc1_order
    - doc2_notice
    - doc3_registration
    - doc4_protocol
    - validation
    - legacy_alias
    - token_context
    - resolver_scope
    &nbsp;
  - и отдельно помечать, что usage по 4 документам — это manual classification/gate artifact.
  &nbsp;
4. **В начале matrix обязательно сделать 2 блока**
  &nbsp;
  - **Reuse 1:1**
    &nbsp;
    - какие existing legal_details.* / meeting.* / др. reused без создания новых ключей;
    &nbsp;
  - **New add-only**
    &nbsp;
    - какие ключи реально созданы в рамках новой модели.
      Это нужно для контроля no-duplicate.
    &nbsp;
  &nbsp;
5. **Добавь в matrix ещё колонку status**
  &nbsp;
  - reused
  - new
  - legacy-only
  - legacy+canonical
    Это поможет для deprecation и финальной миграции шаблонов.
  &nbsp;
6. **legacy_alias делай не свободным текстом, а списком legacy ad-hoc token names**
  &nbsp;
  - чтобы потом можно было автоматически строить deprecation report.
  &nbsp;
7. **Gate-правило уточнить**
  &nbsp;
  - без утверждённой docs/token_[matrix.md](http://matrix.md) нельзя:
    &nbsp;
    - переходить к PATCH 2.6,
    - начинать финальную canonical-нормализацию 4 DOCX,
    - убирать legacy aliases.
    &nbsp;
  &nbsp;
8. **После PATCH 2.1 и PATCH 2.5 в отчёте нужны 3 proof**
  &nbsp;
  - SQL proof, что колонка template_notes существует;
  - code proof, что create/update реально включают template_notes;
  - UI proof, что save/load cycle восстанавливает tokenized field корректно.
  &nbsp;
9. **docs/token_[matrix.md](http://matrix.md) — правильное место**
  &nbsp;
  - поддерживаю как постоянный артефакт проекта, не временный файл.
  &nbsp;
10. **Порядок выполнения поддерживаю**

&nbsp;

&nbsp;

&nbsp;

- сначала закрыть gap в PATCH 2.1;
- потом сделать PATCH 2.5 как обязательный gate.

&nbsp;

&nbsp;

PATCH 2.1 fix + PATCH 2.5: Master Token Matrix

## PATCH 2.1 — Critical gap found

**Problem:** `template_notes` field exists in the UI form but is **never saved to the database**.

Evidence:

- `document_templates` table columns: `id, name, code, description, document_type, template_path, placeholders, is_active, created_at, updated_at, template_scope` — no `template_notes`
- `handleSave` in `AiDocumentTemplatesManager.tsx` (lines 161-170, 172-187) does not include `template_notes` in either `createTemplate()` or `updateTemplate()` calls
- On edit load (line 142): `template_notes: (t as any).template_notes || ""` — always falls back to `""`

**Fix required:**

1. **SQL migration**: `ALTER TABLE public.document_templates ADD COLUMN IF NOT EXISTS template_notes text`
2. **AiDocumentTemplatesManager.tsx**: Include `template_notes` in both `createTemplate()` and `updateTemplate()` calls
3. After fix, the E2E proof is complete: `[` → picker → `{{meeting.date}}` stored in `template_notes` column → reload → chip restored via `tokenStringToLabel()`

**Files:**

- SQL migration (1 ALTER TABLE)
- `src/components/ai-documents/AiDocumentTemplatesManager.tsx` (add `template_notes` to save calls)
- Possibly the template hooks if `createTemplate`/`updateTemplate` type doesn't include `template_notes`

---

## PATCH 2.5 — Master Token Matrix

Generate `docs/token_matrix.md` (permanent project artifact) from current `fields_registry` data.

**Columns:**
| canonical_key | ui_label | entity_type | source | scope | scalar_array | computed_db_manual | doc1_order | doc2_notice | doc3_registration | doc4_protocol | validation | legacy_alias | token_context | resolver_scope |

**Reuse block at top:**

- Existing `legal_details.*` keys (47 entries) — reused 1:1, no new aliases
- Existing `meeting.*` keys (15 entries) — reused 1:1, package defaults mapped to meeting namespace
- Reuse proof: `package.notice.method` → skipped, reuses `meeting.notice.method`

**New add-only keys:**

- `entity.*` (6 computed)
- `entity_person.*` (5 join/column)
- `person.*` (9 db)
- `document.*` (3 generated/computed)
- `package.*` (6: 4 scalar roles + 2 arrays)
- `agenda.*` (1 array)
- `decision.*` (1 array)

**Data sources:** Direct query of `fields_registry` + manual doc usage mapping for the 4 annual meeting documents.

**Gate rule:** This matrix must be approved before proceeding to PATCH 2.6 or final DOCX normalization.

**Files:**

- `docs/token_matrix.md` — new permanent artifact

---

## Execution order

1. Fix PATCH 2.1 (migration + save logic) — closes the E2E gap
2. Generate PATCH 2.5 matrix from live registry data

## What does NOT change

- Existing Telegram/email editors
- Existing `legal_details.*` entries
- `generate-from-template` (billing)
- RLS policies