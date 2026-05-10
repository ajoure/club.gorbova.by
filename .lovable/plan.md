План:

# PATCH E.2 — document-field-resolver-v2 + scope_lock в snapshot pipeline (rev 2)

Add-only к предыдущей редакции. Все ранее заявленные DoD, файлы, proof и zero-touch list сохранены. Ниже выделены изменения rev 2 (E2.x.A — E2.x.G).

## Цели
1. Новый резолвер как **отдельный безопасный слой** (shadow mode), без переключения production.
2. Зафиксировать scope/source/priority в snapshot через `scope_lock=true`, чтобы повторный rebuild не переопределял поля.
3. Резолв строго по `field_id` / `public_id` (`FLD-XXXXXX`); label — display only.
4. Корректная классификация коллизий labels (см. §E2.x.A).
5. Полный `source_trace` для диагностики, включая sample no-label-resolution.

---

## E2.x.A — Дубли labels: warning vs conflict (исправлено противоречие)

| Случай | Классификация | Поведение резолвера | Запись в snapshot |
|---|---|---|---|
| Один и тот же label в разных `scope` (например «Сделка: валюта» в `scope=deal/null` и `scope=document/null`) | `label_collision_cross_scope` — **diagnostic warning** | НЕ блокирует резолв. Шаблон ссылается на конкретный `FLD-XXXXXX`, поле резолвится строго по `field_public_id`. | Записывается |
| Один и тот же label внутри одного `(scope, subject_type)` | `label_collision_within_scope` — **реальный conflict** | Блокирует резолв. value НЕ записывается. | НЕ записывается, status=`conflict` |
| Шаблон ссылается на FLD, которого нет в catalog | `field_unknown` | НЕ резолвится | НЕ записывается, status=`missing` |

Response payload:
```jsonc
{
  "warnings":  [ { "type":"label_collision_cross_scope", "label":"Сделка: валюта",
                   "candidates":[ {field_public_id, scope, subject_type} ] } ],
  "conflicts": [ { "type":"label_collision_within_scope", "label":"...",
                   "scope":"...", "subject_type":"...",
                   "candidates":[ {field_public_id} ] } ]
}
```

DoD «Сделка: валюта» переформулирован: **diagnostics возвращают warning** `label_collision_cross_scope`, поля корректно резолвятся по `field_public_id` в обе стороны (deal- и document-scope шаблоны), value записывается в snapshot. Blocking conflict для этого кейса быть НЕ должно.

---

## E2.x.B — UI диагностики: страница зафиксирована сейчас

Вкладка **«Resolver v2 (диагностика)»** добавляется в **`src/pages/admin/AdminProductsDocs.tsx`** (Documents Hub) как новая под-вкладка рядом с существующими. Admin-only, RBAC enforced, не production UI.

Файлы:
- `src/components/admin/resolver-v2/ResolverV2DiagnosticsCard.tsx` (NEW) — основной компонент.
- `src/pages/admin/AdminProductsDocs.tsx` (MODIFIED, минимально) — регистрация под-вкладки.

Никаких других UI-страниц не трогаем. Открытый пункт «подтвердить в execute» — снят.

---

## E2.x.C — Contract для manual_override

`document-field-resolver-v2-snapshot` ОБЯЗАН до записи прочитать текущий `orders_v2.meta.document_data.fields[FLD-...]`. Логика:

| Текущее состояние поля | mode=`apply` | mode=`rebuild` (default) | mode=`rebuild` + `include_manual_overrides=true` |
|---|---|---|---|
| `manual_override=true` | НЕ трогать | НЕ трогать | Перезаписать |
| `scope_lock=true`, `manual_override=false` | НЕ трогать | Перезаписать | Перезаписать |
| Пусто / нет поля | Записать | Записать | Записать |

В `source_trace` статус для manual-override полей: **`locked_manual_override`** (отдельно от `locked` для scope_lock без manual). Контракт `canonical-deal-fields-update` остаётся каноническим writer'ом для manual override — резолвер его не дублирует.

---

## E2.x.D — Naming canon: `scope_lock`

Единственно допустимое имя — **`scope_lock`** (snake_case). Запрещено: `snapshot_lock`, `scope_locked`, `scopeLock` (в новом коде/proof/audit/snapshot-payload).

- В snapshot: `"scope_lock": true`.
- В response: `"scope_lock": true` (тот же ключ, без второго термина).
- В audit meta: `"scope_lock_term": "scope_lock"` (как в Stage E).
- STOP-guard E2.guard.2 (без изменений): `rg -n "snapshot_lock" supabase/functions/document-field-resolver-v2* src/components/admin/resolver-v2/ .lovable/proofs/requisites_v2_stage_e2*` → **0**.
- Доп. STOP-guard E2.guard.6: `rg -n "scope_locked|scopeLock" <те же пути>` → **0**.

---

## E2.x.E — Dry-run режим в snapshot-функции

`document-field-resolver-v2-snapshot` режимы (расширено):

| mode | dry_run | Запись в DB | Возврат |
|---|---|---|---|
| `apply` | `false` (default) | да | counts + diff |
| `apply` | `true` | **нет** | counts + diff (для proof до execute) |
| `rebuild` | `false` | да | counts + diff |
| `rebuild` | `true` | **нет** | counts + diff |

Counts payload:
```jsonc
{
  "would_write": 12, "would_skip_locked": 3, "would_skip_manual_override": 2,
  "would_warn_collision": 1, "would_conflict": 0,
  "fields_changed":   [ "FLD-000123", ... ],
  "fields_skipped":   [ { "FLD-...":"locked" }, { "FLD-...":"locked_manual_override" } ]
}
```

Dry-run обязателен перед execute — proof `requisites_v2_stage_e2_dryrun.md` строится на dry_run-вызовах.

---

## E2.x.F — Audit без PII (явный whitelist)

В `audit_logs.meta` для `document_field_resolver_v2.*` пишем ТОЛЬКО:

```jsonc
{
  "order_id":         "<uuid>",
  "template_id":      "<uuid>",
  "resolver_version": "v2-1.0.0",
  "force_rebuild":    false,
  "dry_run":          false,
  "include_manual_overrides": false,
  "counts": {
    "written": 12, "skipped_locked": 3, "skipped_manual_override": 2,
    "warnings": 1, "conflicts": 0, "missing": 0
  },
  "field_public_ids_changed": [ "FLD-000123", "FLD-000124" ]
}
```

**Запрещено** в meta: ФИО, УНП, паспортные данные, адреса, телефоны, email, IBAN/БИК, любые `value` из snapshot, любые JSON-поля requisites. Только идентификаторы и счётчики.

---

## E2.x.G — Catalog: только active/non-deprecated

Resolver catalog (`_shared/document-resolver-v2/catalog.ts`) загружает `fields_registry` со строгими фильтрами:
- `is_active = true` (если колонка существует);
- `archived_at IS NULL`;
- `options->>'deprecated_at' IS NULL` (Stage E маркер).

Discovery: реальный набор колонок `fields_registry` фиксируется в **первом разделе** `requisites_v2_stage_e2_dryrun.md` (`SELECT column_name FROM information_schema.columns WHERE table_name='fields_registry'`). Если `is_active` отсутствует — фильтр по этой колонке снимается, фиксируется в proof. Иначе — применяется.

Deprecated 71 поле из Stage E (`legal_details/entity/entity_person/person`) автоматически исключаются из catalog → не участвуют в резолве, не попадают в `source_trace` как кандидаты.

---

## Что трогаем (add-only, никаких rewrite)

### Backend — новые edge-функции
- `supabase/functions/document-field-resolver-v2/index.ts` (NEW) — preview-only.
  - admin-only (JWT + RBAC через `user_roles_v2`).
  - input: `{ order_id, template_id?, mode: 'preview' }`.
  - читает `orders_v2`, `fields_registry` (active+non-deprecated, см. E2.x.G), `legal_entities_requisites` / `individual_requisites` / `system_customer*` / `executors`.
  - резолвит ТОЛЬКО по `FLD-XXXXXX` / `field_id`.
  - возвращает: `resolved`, `source_trace`, `warnings`, `conflicts`, `missing`, `locked` (см. E2.x.A).
  - production resolver (`canonical-document-generate-strict`) **не трогаем**.

- `supabase/functions/document-field-resolver-v2-snapshot/index.ts` (NEW)
  - admin-only, idempotent.
  - режимы: `apply` / `rebuild` × `dry_run` ∈ {true, false} (см. E2.x.E).
  - флаг `include_manual_overrides=true` обязателен для перезаписи `manual_override=true` полей (см. E2.x.C).
  - пишет в `orders_v2.meta.document_data.fields[FLD-...]`:
    ```jsonc
    {
      "value": ...,
      "scope": "system_customer|platform_executor|user_requisites|deal|document",
      "subject_type": "legal|individual|null",
      "entity_type": "customer|executor|user_requisites|...",
      "source": "client_legal_details|legal_entities_requisites|order_meta|computed|manual",
      "source_priority": <int>,
      "scope_lock": true,
      "locked_at": "...",
      "resolver_version": "v2-1.0.0",
      "manual_override": false
    }
    ```
  - `manual_override=true` поля НЕ трогаются (см. E2.x.C).
  - audit `audit_logs.action='document_field_resolver_v2.snapshot_applied'` с meta по whitelist (E2.x.F).

- `supabase/functions/_shared/document-resolver-v2/` (NEW)
  - `catalog.ts` — load active/non-deprecated `fields_registry` (E2.x.G); группировка `(scope, subject_type, label)` для классификации коллизий (E2.x.A).
  - `sources.ts` — карта source → priority (см. ниже).
  - `resolver.ts` — чистая функция `(catalog, sources, order, requisites, executors) → ResolverResult`.

### DB — никаких schema changes
- `orders_v2.meta.document_data.fields` ключ `FLD-XXXXXX`.
- `fields_registry.options.scope` (Stage E).
- Никаких новых таблиц/ALTER. Если потребуется extension `audit_logs` action enum — миграция отдельным шагом (после dry-run discovery).

### UI — минимальный read-only
- `src/components/admin/resolver-v2/ResolverV2DiagnosticsCard.tsx` (NEW).
- `src/pages/admin/AdminProductsDocs.tsx` (MOD, минимально) — регистрация вкладки «Resolver v2 (диагностика)» (E2.x.B).
- Контролы: order picker + template picker; кнопки **Preview (v2)** / **Snapshot apply (dry_run)** / **Snapshot apply (write)** / **Force rebuild (dry_run)** / **Force rebuild (write)** / **Force rebuild + manual_overrides (write, требует подтверждения)**.
- Таблицы: `source_trace` (field_id, label, scope, subject_type, source, status, reason), `warnings`, `conflicts`, `locked`, `missing`.
- `DealDocumentsPanel` НЕ переключаем на v2.
- `PlaceholdersCatalogTab` НЕ перестраиваем (PATCH E.3).

---

## Source priority (без изменений)
```
100  manual_override (canonical-deal-fields-update)
 80  computed (passport_number_full, ru-words, ...)
 60  scope=user_requisites (legal_entities_requisites / individual_requisites)
 50  scope=system_customer (system_customer / system_customer_signer)
 50  scope=platform_executor (executors)
 30  order.meta (final_price, currency, order_number, dates)
 10  legacy fallback (client_legal_details — read-only, migration window)
  0  not_resolved
```
При equal priority **внутри одного `(scope, subject_type)` с одинаковым label** → conflict (E2.x.A).

---

## STOP-guards (расширено)
- E2.guard.1: `rg -n "label.*===|label.*indexOf|byLabel" supabase/functions/document-field-resolver-v2* supabase/functions/_shared/document-resolver-v2/` → **0**.
- E2.guard.2: `rg -n "snapshot_lock" supabase/functions/document-field-resolver-v2* src/components/admin/resolver-v2/ .lovable/proofs/requisites_v2_stage_e2*` → **0**.
- E2.guard.3: `git diff supabase/functions/canonical-document-generate-strict/` → **0 строк**.
- E2.guard.4: legacy таблицы не тронуты (никаких DROP/DELETE/ALTER).
- E2.guard.5: dry-run `apply` → real `apply` → repeat `apply`: финальный `would_write`/`written` = **0**, `skipped_locked` = locked count предыдущего шага.
- E2.guard.6 (NEW, E2.x.D): `rg -n "scope_locked|scopeLock" supabase/functions/document-field-resolver-v2* src/components/admin/resolver-v2/ .lovable/proofs/requisites_v2_stage_e2*` → **0**.
- E2.guard.7 (NEW, E2.x.F): grep по audit meta — отсутствуют PII-маркеры. SQL: `audit_logs WHERE action LIKE 'document_field_resolver_v2.%' AND (meta::text ~* 'паспорт|УНП|IBAN|БИК|@|\\+375|address')` → **0**.

---

## Dry-run (proof до execute)

`.lovable/proofs/requisites_v2_stage_e2_dryrun.md`:
1. Discovery: фактические колонки `fields_registry` (E2.x.G).
2. Catalog stats: active/deprecated/excluded counts.
3. Sample collisions:
   - **warning** sample: «Сделка: валюта» — два FLD в разных scope, оба резолвятся.
   - **conflict** sample: если найден реальный within-scope дубль (ожидание: 0 после Stage E), иначе фиксируется отсутствие.
4. Прогон preview на 3 представительных order'ах (legal customer / individual customer / executor-only template).
5. Прогон snapshot `dry_run=true` на тех же order'ах: counts, fields_changed, fields_skipped.
6. SQL-инвариант: snapshot в DB не записан (`SELECT meta->'document_data' FROM orders_v2 WHERE id IN (...)` — без новых полей).

---

## Execute
1. Деплой 2 edge-функций.
2. На контрольном order: `dry_run=true apply` → `apply` (write) → повторный `apply` → 0 переписано (E2.guard.5).
3. На том же order: `dry_run=true rebuild` → `rebuild` (write, без manual override flag) → manual-override поля НЕ тронуты (E2.x.C).
4. Опционально: `rebuild + include_manual_overrides=true` (с подтверждением) — на тестовом order.

---

## Verify (DoD, обновлено)
- [ ] `document-field-resolver-v2` и `document-field-resolver-v2-snapshot` задеплоены.
- [ ] `canonical-document-generate-strict` без изменений (E2.guard.3).
- [ ] Snapshot содержит `scope_lock=true`, `scope`, `subject_type`, `source`, `source_priority`, `resolver_version='v2-1.0.0'`.
- [ ] Apply повторно → `written`=0, `skipped_locked` корректен.
- [ ] Force rebuild без флага → `manual_override=true` поля НЕ тронуты (E2.x.C).
- [ ] Force rebuild + `include_manual_overrides=true` → manual-поля перезаписаны.
- [ ] **«Сделка: валюта» → diagnostics warning `label_collision_cross_scope`** (НЕ blocking conflict), оба FLD корректно резолвятся по `field_public_id` (E2.x.A).
- [ ] Within-scope дубль (если найден) → status=`conflict`, value НЕ записан.
- [ ] Резолв по label = 0 (E2.guard.1 grep) + sample no-label-resolution в proof (см. ниже).
- [ ] `scope_lock` единственный термин (E2.guard.2 + E2.guard.6).
- [ ] Audit без PII (E2.guard.7), whitelist соблюдён (E2.x.F).
- [ ] Catalog исключает deprecated (71 Stage E поле) и archived.
- [ ] Dry-run режим работает (`dry_run=true` → 0 записей в DB).
- [ ] Legacy таблицы не тронуты, archived_at не сдвинут.
- [ ] PATCH D.3 (`StructuredAddressBlock`) остаётся следующим UI-патчем.
- [ ] `address_structured` сохраняется в snapshot как plain JSON value (read-only из формы D.1).
- [ ] proof: `.lovable/proofs/requisites_v2_stage_e2_execute.md` со счётчиками, source_trace sample, **explicit no-label-resolution sample** (два FLD с одинаковым label в разных scope, шаблон содержит FLD-A → резолвится FLD-A; шаблон содержит FLD-B → резолвится FLD-B; label НЕ участвовал), audit, grep proof, PII grep proof.

---

## Что НЕ делаем (zero-touch list, без изменений)
- ❌ Не переключаем `DealDocumentsPanel` / `canonical-document-generate-strict` на v2.
- ❌ Не удаляем legacy `client_legal_details` / `entity` / `entity_person` / `person`.
- ❌ Не пересчитываем существующие snapshot в `orders_v2.meta.document_data` массово (только через UI диагностики per-order).
- ❌ Не вводим `StructuredAddressBlock` (PATCH D.3).
- ❌ Не перестраиваем `PlaceholdersCatalogTab` (PATCH E.3).
- ❌ Не трогаем JSONB-колонку `meta` у `fields_registry` — она называется `options` (Stage E).
- ❌ Не пишем PII в audit_logs (E2.x.F).

---

## Файлы (итог)

**Создаются:**
- `supabase/functions/document-field-resolver-v2/index.ts`
- `supabase/functions/document-field-resolver-v2-snapshot/index.ts`
- `supabase/functions/_shared/document-resolver-v2/catalog.ts`
- `supabase/functions/_shared/document-resolver-v2/sources.ts`
- `supabase/functions/_shared/document-resolver-v2/resolver.ts`
- `src/components/admin/resolver-v2/ResolverV2DiagnosticsCard.tsx`
- `.lovable/proofs/requisites_v2_stage_e2_dryrun.md`
- `.lovable/proofs/requisites_v2_stage_e2_execute.md`

**Изменяются (минимально):**
- `src/pages/admin/AdminProductsDocs.tsx` — регистрация вкладки «Resolver v2 (диагностика)» (E2.x.B).
- `supabase/functions.registry.txt` — добавление двух новых функций в registry.

**НЕ изменяются:**
- `canonical-document-generate-strict/`
- `canonical-deal-fields-update/` (канонический writer для manual override)
- `DealDocumentsPanel.tsx`
- legacy tables / production resolver / production UI.

После approve плана — Dry run → Execute → Verify-отчёт.
