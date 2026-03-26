# да, согласен, с учетом правок:

&nbsp;

1. Не оставлять в документации сокращение {{cf..}}.  
Везде, где описывается Class A, писать полный общий формат:  

  - {{cf.<entity_type>.<PUBLIC_ID>}}
  - пример: {{[cf.legal](http://cf.legal)_details.FLD-000042}}  
  То же самое для legacy-примера:
  - {{cf.product.<UUID>}}  
  Сейчас {{cf..}} и {{cf.product.}} как шаблон стандарта слишком размыты.
2. &nbsp;
3. Это нужно исправить и в DoD.  
Вместо:  

  - Class A format documented as {{cf..}}  
  должно быть:
  - Class A format documented as {{cf.<entity_type>.<PUBLIC_ID>}}
  - example: {{[cf.legal](http://cf.legal)_details.FLD-000042}}
4. &nbsp;
5. Если требование “каждое правило помечено статусом” literal, то проставь теги и на вводные bullets.  
Сейчас секции в целом размечены хорошо, но строки типа:  

  - “Class is determined by resolution mechanism”
  - “Explicit rule: cf.product is a legacy compatibility exception”  
  тоже лучше пометить [implemented] / [target] / [legacy compat], чтобы не было формального спора.
6. &nbsp;

&nbsp;

&nbsp;

После этих двух правок план можно принимать.

&nbsp;

Dual-Class Token Architecture — Documentation (final)

## Files to change

### 1. New: `docs/TOKEN_ARCHITECTURE.md`

**§1 Two token classes — by resolution model, not entity name**

Class is determined by resolution mechanism:

- **Class A** = registry-backed data token. Canonical format: `{{cf.<entity_type>.<PUBLIC_ID>}}`. Example: `{{cf.legal_details.FLD-000042}}`
- **Class B** = computed / package / procedure token. Format: `{{canonical.key}}`. Example: `{{meeting.date}}`


| Token family         | Class            | Format example                    | Resolution                                   | Status                                                 |
| -------------------- | ---------------- | --------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `cf.legal_details.*` | A                | `{{cf.legal_details.FLD-000042}}` | `public_id` → `fields_registry` → DB column  | [implemented]                                          |
| `cf.product.*`       | legacy exception | `{{cf.product.<UUID>}}`           | UUID → `fields_registry` → `field_values_v2` | [legacy compat] — not a model for new Class A families |
| `meeting.*`          | B                | `{{meeting.date}}`                | canonical key → resolver                     | [implemented]                                          |
| `document.*`         | B                | `{{document.number}}`             | canonical key → resolver                     | [implemented]                                          |
| `package.*`          | B                | `{{package.signer.full_name}}`    | canonical key → resolver                     | [target]                                               |
| `person.*`           | B (may evolve)   | `{{person.full_name}}`            | canonical key → resolver                     | [implemented]                                          |


Explicit rule: `cf.product` is a **legacy compatibility exception**, not a template for new Class A token families. New entity types must use `public_id` format `{{cf.<entity_type>.<PUBLIC_ID>}}`.

**§2 ID cell rules**

- UUID is not used in new canonical tokens for DOCX/UI [implemented for legal_details, target as general rule]
- Exception: legacy compatibility tokens such as `{{cf.product.<UUID>}}` [legacy compat]
- Class A tokens use `public_id` in the token string [implemented]
- Class B tokens use canonical key in the token string [implemented]
- **Class A token never degrades to Class B token** — a registry-backed field is not replaced by a canonical key even if an alias exists [target — rule established, enforcement not yet automated]

**§3 Token resolution flow**

- Class A token arrives in `public_id` format (e.g. `{{cf.legal_details.FLD-000042}}`) [implemented]
- System performs registry lookup: `public_id` → `fields_registry` entry [implemented]
- Internal resolution proceeds by UUID / ID-bound context (column lookup, value fetch) [implemented]
- Outside (DOCX/UI) = `public_id`; inside (resolver logic) = UUID [implemented]
- Class B token arrives as canonical key, resolved directly by resolver function [implemented]

**§4 Context binding — source slots**

- Multi-party documents use named source slots: [target]
  - `party.customer_legal_details_id` [target]
  - `party.executor_legal_details_id` [target]
  - `selected_signer_link_id` [target]
  - `selected_person_ids[]` [target]
  - Additional as needed: `beneficiary`, `representative` [target]
- For bilateral documents, each party must have an explicit source slot [target]
- Generator resolves data only by UUID-bound context, never by name/email/label [implemented in edge functions]

**§5 Snapshot source trace** — per source slot:

- `source_slot` (role name) [target]
- `source_entity_id`, `source_legal_details_id` [target]
- `source_link_ids[]` [target]
- `token_set_version` / `resolver_version` [target]

**§6 Registry-first with class distinction**

- Structured/registry field → Class A with `public_id`. No degradation to Class B [target — rule established]
- Canonical key only for computed/domain/package tokens (Class B) [implemented]

**§7 Pre-generation validation — source-binding completeness**

- Required source slots selected? [target]
- Required `legal_details_id` per slot? [target]
- Required signer/link per slot? [target]
- Required fields populated for each selected source? [target]

**§8 Compatibility layer**

- New Class A tokens → only `public_id` format: `{{cf.<entity_type>.<PUBLIC_ID>}}` [target — rule established, implemented for legal_details]
- New Class B tokens → only canonical key format: `{{canonical.key}}` [implemented]
- Legacy UUID/key aliases are permitted only as a compatibility layer [implemented]
- `{{cf.product.<UUID>}}` — legacy compatibility exception, not a model for new token families; supported via dual-resolve + diagnostics [legacy compat]
- Legacy key-based aliases (e.g. `entity_name` → `legal_details.leg_name`) — dual-resolve, flagged for migration [legacy compat]

### 2. Update `docs/token_matrix.md` — insert after line 8

Add a "Token Class Reference" section with the §1 table. Explicitly note that `cf.product` is a legacy exception, not canonical.

### 3. Update `src/lib/tokens/tokenRegistry.ts` — replace header lines 1–27

Replace "Four levels of representation" with dual-class model:

- Class A: registry-backed data tokens, format `{{cf.<entity_type>.<PUBLIC_ID>}}`, example `{{cf.legal_details.FLD-000042}}`, resolved via `public_id` → `fields_registry`
- Class B: computed/domain/package tokens, format `{{canonical.key}}`, resolved via canonical key → resolver
- `{{cf.product.<UUID>}}` is legacy compatibility, not canonical for new tokens
- Keep Groups list unchanged

## DoD

1. Class assignment is by resolution model, not by business entity name
2. Class A format documented as `{{cf.<entity_type>.<PUBLIC_ID>}}` with example `{{cf.legal_details.FLD-000042}}`
3. `{{cf.product.<UUID>}}` documented as legacy compatibility exception, explicitly not a model for new Class A families
4. UUID rule: not used in new canonical tokens; legacy compat tokens are the only exception
5. Token resolution flow: outside = `public_id`, inside = UUID-bound context
6. "Class A never degrades to Class B" rule explicit
7. Source slots for multi-party documents documented
8. Snapshot trace includes slot, entity ID, resolver version
9. §8 states: new Class A → `public_id` only, new Class B → canonical key only, legacy → compat layer only
10. Every rule in every section tagged `[implemented]`, `[target]`, or `[legacy compat]`