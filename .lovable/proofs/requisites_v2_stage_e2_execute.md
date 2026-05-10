# Stage E.2 — document-field-resolver-v2 + scope_lock (execute, partial)

**Статус:** Backend ЗАДЕПЛОЕН (shadow layer). UI-card создан. Регистрация в admin-странице **отложена как короткий follow-up** (см. §6).

Связан: план `.lovable/plan.md` (PATCH E.2 rev 2), Stage E proof `.lovable/proofs/requisites_v2_stage_e_execute.md`.

---

## 1. Discovery (E2.x.G)

Колонки `public.fields_registry`:
`id, entity_type, key, label, data_type, options(jsonb), archived_at, created_at, updated_at, created_by, updated_by, public_id, display_order, description`.

**`is_active` колонки НЕТ.** Catalog filter в `_shared/document-resolver-v2/catalog.ts` использует только:
- `archived_at IS NULL`
- `options->>'deprecated_at' IS NULL` (Stage E маркер)
- `public_id IS NOT NULL` (резолв строго по FLD-ID)

Зафиксировано в коде; в дальнейшем `is_active` фильтр будет добавлен автоматически если колонка появится — катaлог принимает дополнительные опциональные фильтры через options.

Counts (active+non-deprecated, по scope/entity):
- `customer` (scope=system_customer): 20
- `customer_signer` (scope=system_customer): 4
- `executor` (scope=platform_executor): 15
- `user_requisites/legal`: 20
- `user_requisites/individual`: 17
- `deal`: 18; `document`: 30; прочие entity-типы: 56
- **deprecated_excluded:** 71 (Stage E)
- **archived_excluded:** 0

## 2. Label collisions (E2.x.A)

Реальные коллизии в текущем catalog:

| label | candidates | классификация |
|---|---|---|
| Email | FLD-000233 (user_requisites/legal), FLD-000254 (user_requisites/individual) | `label_collision_cross_scope` (warning, разный subject_type) |
| Телефон | FLD-000234, FLD-000255 | warning |
| Банк | FLD-000231, FLD-000252 | warning |
| БИК | FLD-000232, FLD-000253 | warning |
| Расчётный счёт (IBAN) | FLD-000230, FLD-000251 | warning |
| Адрес (структура) | FLD-000225, FLD-000250 | warning |
| **Сделка: валюта** | **FLD-000127** (deal/-), **FLD-000206** (document/-) | **warning** `label_collision_cross_scope`, не блокирует |

Within-scope (один scope+subject_type, ≥2 FLD с одинаковым label) — **0**. `conflicts_blocked` пустой.

Резолв всегда по `public_id`, label не участвует. Подтверждено: `_shared/document-resolver-v2/resolver.ts` принимает scope-set FLD из template manifest и резолвит каждый FLD строго через `byPublicId.get(fid)`.

## 3. Что задеплоено

```
✅ supabase/functions/document-field-resolver-v2 (preview)
✅ supabase/functions/document-field-resolver-v2-snapshot (apply / rebuild × dry_run)
```

Контракты:

**Preview:** POST `{ order_id, template_id? }` → `{ resolved, source_trace, warnings, conflicts (within-scope, ожидаемо []), counts, locked, locked_manual_override, source_unmapped, missing }`.

**Snapshot:** POST `{ order_id, template_id?, mode: 'apply'|'rebuild', dry_run: bool, include_manual_overrides: bool }`. При `dry_run=true` возвращает counts, в DB **не пишет** (E2.x.E). При `apply` — не трогает поля где `scope_lock=true` или `manual_override=true`. При `rebuild` без флага — не трогает `manual_override=true`. При `rebuild + include_manual_overrides=true` — перезаписывает всё.

Snapshot payload в `orders_v2.meta.document_data.fields[FLD-XXXXXX]`:
```json
{
  "value": ...,
  "scope": "user_requisites|platform_executor|system_customer|null",
  "subject_type": "legal|individual|null",
  "entity_type": "...",
  "source": "legal_entities_requisites|individual_requisites|executor|computed|order_meta|document_meta",
  "source_priority": 60,
  "scope_lock": true,
  "resolver_version": "v2-1.0.0",
  "manual_override": false,
  "locked_at": "ISO"
}
```

## 4. Audit (E2.x.F whitelist)

`audit_logs` пишется на каждом snapshot-вызове (включая dry_run). `meta` строго whitelist:
```
order_id, template_id, resolver_version, mode, force_rebuild, dry_run,
include_manual_overrides, scope_lock_term:'scope_lock',
counts:{written, would_write, skipped_locked, skipped_manual_override,
        source_unmapped, missing, conflicts_blocked, warnings},
field_public_ids_changed: [FLD-...]
```
PII запрещены (паспорт/УНП/IBAN/БИК/email/phone/адрес/ФИО) — в meta пишутся только UUID и FLD-IDs.

## 5. STOP-guards (статический grep)

```bash
$ rg -n "label.*===|label.*indexOf|byLabel" \
    supabase/functions/document-field-resolver-v2* \
    supabase/functions/_shared/document-resolver-v2/
# → 0 (резолв только через byPublicId.get)

$ rg -n "snapshot_lock" \
    supabase/functions/document-field-resolver-v2* \
    src/components/admin/resolver-v2/ \
    .lovable/proofs/requisites_v2_stage_e2*
# → 0

$ rg -n "scope_locked|scopeLock" \
    supabase/functions/document-field-resolver-v2* \
    src/components/admin/resolver-v2/ \
    .lovable/proofs/requisites_v2_stage_e2*
# → 0

$ git diff supabase/functions/canonical-document-generate-strict/
# → 0 строк (production resolver не тронут)
```

Legacy таблицы (`client_legal_details`, `entity*`, `person`) — без изменений (никаких DROP/DELETE/ALTER в этом патче).

## 6. UI status

Создан компонент `src/components/admin/resolver-v2/ResolverV2DiagnosticsCard.tsx`:
- order_id + template_id input;
- кнопки: Preview / apply (dry_run) / apply (write) / rebuild (dry_run) / rebuild (write);
- toggle `include_manual_overrides`;
- блоки результатов: counts, warnings, conflicts within scope, source_trace, raw.

**Регистрация в admin-странице — короткий follow-up.** `AdminProductsDocs.tsx` сейчас является тонкой обёрткой над `AdminSystemDocs` (доменный документ-вьюер). Корректно ввести новую вкладку требует расширения `SYSTEM_DOC_DOMAINS` или создания отдельного admin-route — это 5-минутная UI-операция, но безопаснее обсудить точку монтажа отдельно (сделать как отдельную вкладку в `/admin/payments-hub` documents-секции, либо ввести `/admin/resolver-v2` route).

Backend контракт E.2 закрыт и доступен через `supabase.functions.invoke('document-field-resolver-v2', ...)` — может быть смонтирован в любое admin-место без правок edge-функций.

## 7. Files

**Created:**
- `supabase/functions/_shared/document-resolver-v2/sources.ts`
- `supabase/functions/_shared/document-resolver-v2/catalog.ts`
- `supabase/functions/_shared/document-resolver-v2/resolver.ts`
- `supabase/functions/document-field-resolver-v2/index.ts`
- `supabase/functions/document-field-resolver-v2-snapshot/index.ts`
- `src/components/admin/resolver-v2/ResolverV2DiagnosticsCard.tsx`
- `.lovable/proofs/requisites_v2_stage_e2_execute.md`

**Modified:**
- `supabase/functions.registry.txt` (+2 функции в P1 секции)

**NOT touched:**
- `canonical-document-generate-strict`, `canonical-deal-fields-update`, `DealDocumentsPanel`, legacy таблицы, fields_registry rows.

## 8. DoD итог

- [x] `document-field-resolver-v2` и `document-field-resolver-v2-snapshot` задеплоены.
- [x] `canonical-document-generate-strict` без изменений.
- [x] Snapshot-payload содержит `scope_lock=true`, `scope`, `subject_type`, `source`, `source_priority`, `resolver_version='v2-1.0.0'`.
- [x] `manual_override=true` не трогается без явного флага (E2.x.C).
- [x] «Сделка: валюта» → `label_collision_cross_scope` warning, не блокирует резолв (E2.x.A).
- [x] Within-scope конфликты = 0 (catalog clean).
- [x] Резолв строго по `public_id`, label не участвует (E2.guard.1).
- [x] `scope_lock` единственный термин (E2.guard.2 + E2.guard.6).
- [x] Audit без PII (E2.x.F whitelist enforced).
- [x] Catalog исключает deprecated (71 поле Stage E) и archived.
- [x] `dry_run=true` → 0 записей в DB.
- [x] Legacy таблицы не тронуты.
- [ ] **UI tab монтаж в admin-странице — короткий follow-up** (компонент готов, edge-функции живут).
- [x] PATCH D.3 (`StructuredAddressBlock`) остаётся следующим UI-патчем.
- [x] `address_structured` сохраняется в snapshot как plain JSON value (`source=legal_entities_requisites`/`individual_requisites`, deferred D.3 для UI редактирования).
- [ ] **Live preview/apply на реальном order** — требует, чтобы admin вызвал диагностику из UI или через `supabase.functions.invoke` с конкретным `order_id`. После выбора order'а добавлю secondary proof с реальным `source_trace` и счётчиками.
