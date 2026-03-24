# да, согласен, с учетом правок:

&nbsp;

1. **PATCH 2.1**
  Считать закрытым только после **реального UI-proof**, не только code/sql proof:
  &nbsp;
  - сохранить в template_notes токен {{[meeting.date](http://meeting.date)}};
  - переоткрыть форму;
  - подтвердить, что отображается корректный chip/label [Дата собрания].
    Это обязательный runtime-proof перед финальным закрытием PATCH 2.1.
  &nbsp;
2. **PATCH 2.5 — totals исправить строго и явно**
  Если person = 12, тогда:
  &nbsp;
  - new add-only = **39**, не 38;
  - total registry = **98**, не 97.
    В matrix и в summary все totals должны совпадать без расхождений.
  &nbsp;
3. **docs/token_[matrix.md](http://matrix.md)**
  Поддерживаю правки:
  &nbsp;
  - добавить entity_type в каждую строку;
  - добавить отдельную колонку source;
  - оставить resolver_scope отдельно;
  - расширить legacy_alias до полного списка всех legacy ad-hoc ключей.
  &nbsp;
4. **Legacy aliases**
  Делай не просто список, а **явный mapping**:
  &nbsp;
  - legacy_alias
  - canonical_key
  - status
    Для ключей, где одновременно живут canonical и legacy, статус должен быть legacy+canonical.
  &nbsp;
5. **Reuse block**
  Расширить блок reuse не только для package.*, но и для всего annual meeting scope:
  &nbsp;
  - какие existing meeting.* были reused 1:1;
  - какие legal_details.* reused 1:1;
  - почему новый key не создавался.
  &nbsp;
6. **Gate перед PATCH 2.6**
  Открывать PATCH 2.6 только если:
  &nbsp;
  - totals в matrix сходятся;
  - entity_type и source добавлены;
  - все legacy aliases задокументированы;
  - doc1–doc4 usage сверены с реальными DOCX;
  - matrix утверждена.
  &nbsp;
7. **PATCH 2.6 scope**
  Подтверждаю состав snapshot schema:
  &nbsp;
  - placeholder_data_snapshot
  - token_manifest_snapshot
  - template_tokens_snapshot
  - template_id
  - template_code
  - template_version
  - registry_version
  - resolver_version
  - warnings_snapshot
  - source_trace
  &nbsp;

&nbsp;

&nbsp;

После исправления matrix и прохождения gate можно запускать **PATCH 2.6**.

&nbsp;

PATCH 2.5 fixes + PATCH 2.1 final proof + pre-PATCH 2.6 gate

## 1. PATCH 2.1 — Final proof status

**SQL proof:** Migration `20260324170019` adds `template_notes text` to `document_templates`. Column exists.

**Code proof:** `AiDocumentTemplatesManager.tsx` lines 170 and 188 — `template_notes` is included in both `createTemplate()` and `updateTemplate()` calls. Existing templates without this field get `NULL` (safe).

**UI proof:** Requires manual verification — save a template with `{{meeting.date}}` in `template_notes`, reopen form, confirm chip `[Дата собрания]` restores. This is a runtime check to be performed after PATCH 2.5 fixes are applied.

**Verdict:** PATCH 2.1 code-complete. UI proof is a manual runtime step.

---

## 2. PATCH 2.5 — Matrix fixes (4 issues)

### A. Person count: 12, not 11

Line 34 and line 112 of `token_matrix.md` say "11 записей" but list 12 keys:
`full_name, initials, address, birth_date, email, phone, personal_number, passport_series, passport_number, passport_issued_by, passport_issued_date, passport_valid_until`

**Fix:** Change "11" → "12" in both places. Update totals: New add-only = 39 (not 38), Total = 98 (not 97).

### B. Add `entity_type` column to every row in full matrix

Currently `entity_type` is only in section headers. Add it as an explicit column in every table row for machine readability.

### C. Add `source` column separate from `resolver_scope`

New column `source` with values: `client_legal_details.column`, `persons.column`, `entity_person_links.column`, `computed`, `package_role`, `loop`, `manual`, `system`.

### D. Complete legacy_alias list

Current matrix lists only 6 aliases. Full audit of `aiDocumentSnapshotResolver.ts` + edge functions reveals **50+ legacy ad-hoc keys**:

**Document (3):** `document_number`, `document_date`, `document_date_short`

**Entity (14):** `entity_name`, `entity_short_name`, `entity_unp`, `entity_address`, `entity_bank`, `entity_bank_code`, `entity_account`, `entity_phone`, `entity_email`, `entity_director`, `entity_director_short`, `entity_director_position`, `entity_acts_on_basis`, `entity_org_form`

**Client aliases (7):** `client_name`, `client_address`, `client_unp`, `client_phone`, `client_email`, `client_bank`, `client_account`

**Person (12):** `person_full_name`, `person_short_name`, `person_personal_number`, `person_birth_date`, `person_passport_series`, `person_passport_number`, `person_passport_issued_by`, `person_passport_issued_date`, `person_passport_valid_until`, `person_phone`, `person_email`, `person_address`

**Signer (11):** `signer.full_name`, `signer.short_name`, `signer.personal_number`, `signer.passport_series`, `signer.passport_number`, `signer.passport_issued_by`, `signer.passport_issued_date`, `signer.passport_valid_until`, `signer.phone`, `signer.email`, `signer.address`

**Link (4):** `link.role_label`, `link.position`, `link.acts_on_basis`, `link.share_percent`

Each legacy alias will be mapped to its canonical replacement in the matrix.

### E. Reuse 1:1 mapping expansion

Add full reuse mapping not just for `package.*` but for all annual meeting scope reuses — specifically the 12 existing `meeting.*` keys reused without new creation.

### F. Add `status` column verification

Ensure `legacy+canonical` status is applied to keys that have both a canonical registry entry AND active legacy aliases in edge functions (e.g., `entity.name` has legacy `entity_name`).

---

## 3. Pre-PATCH 2.6 gate checklist

After matrix fixes:

- Totals verified: reused + new = total (no arithmetic gaps)
- `entity_type` column present in every row
- `source` column present in every row
- All 50+ legacy aliases documented with canonical replacement
- doc1–doc4 usage matches real DOCX templates
- Matrix approved → gate open for PATCH 2.6

---

## 4. PATCH 2.6 scope confirmation

Snapshot schema fields (all required):

- `placeholder_data_snapshot` — resolved `{key: value}`
- `token_manifest_snapshot` — requested/found/missing
- `template_tokens_snapshot` — tokens extracted from DOCX
- `template_id`, `template_code`
- `template_version`, `registry_version`, `resolver_version`
- `warnings_snapshot`
- `source_trace` — per-key `{source, table, column}`

---

## Files to change


| File                   | What                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `docs/token_matrix.md` | Fix person count, add entity_type/source columns, expand legacy_alias to 50+, fix totals, expand reuse mapping |


## What does NOT change

- No code changes — matrix-only fix
- Existing editors, billing flows, RLS untouched