# Plan

## Sprint 3B v2.1 — DONE (with addendum)

**Status:** `completed: package person FLD + role aliases + resolver skeleton added; pre-req proof verified; feature flag disabled; generation deferred`

**Proofs:**
- `.lovable/proofs/package_documents_sprint3b_v2_1_execution_report_2026_05.md` — основной отчёт.
- `.lovable/proofs/package_documents_sprint3b_v2_1_addendum_2026_05.md` — pre-req `fields_registry.public_id NOT NULL UNIQUE` + 4 verification-блока.

### Verified (2026-05-28, read-only)
- `fields_registry`: 370 строк, `public_id` NOT NULL + UNIQUE, FK `dpta_canonical_fk` valid.
- `document_package_token_aliases`: RLS on, 0 policies, 0 grants для anon/authenticated → service_role only.
- FLD-000372/000373 `entity_type='person'` → НЕ в billing/customer/executor picker-группах.
- `resolve-package-tokens.ts`: 0 production imports, `HARDCODED_ENABLED=false`.
- 0 active templates / versions ссылаются на FLD-000372/000373 или `package.roles.*`.

### Backlog → Sprint 3C
- UI ролей участников пакета НЕ имеет поля «Должность», `document_package_session_participants.metadata.position` нигде не пишется. Без этого alias-токены `package.roles.*.position` всегда вернут `unresolved`.

---

## Sprint 3C — Package role metadata UI + resolver dry-run integration plan (TODO, отдельный approve)

**Цель:** добавить/проверить должности в анкете пакета и подготовить безопасный dry-run resolver, **без реальной генерации документов**.

1. **UI metadata.position** (обязательно):
   - В форме участников пакета (`DocumentPackageIdeologyView` + связанный save-path в `useDocumentPackageSession`) добавить поле «Должность» для ролей `company_head` / `responsible_person`.
   - Save-path: писать в `document_package_session_participants.metadata.position` (НЕ создавать column).
   - Read-path: подтянуть в UI существующее значение.

2. **Resolver dry-run integration plan** (план, без включения flag):
   - Routing-точка в `canonical-document-generate-strict` за фича-флагом (`HARDCODED_ENABLED=false`).
   - Полная интеграция `|case=` через `_shared/case-format.ts` в resolver.
   - Dry-run контракт: `{ resolved, value, warnings[] }` без записи в snapshot / source_trace, без обращения к Gotenberg.
   - Smoke-фикстуры по обеим ролям и обоим FLD.

3. **UI picker для пакетных alias-токенов** (опционально, после §1/§2):
   - Если решим открыть picker — выдать `authenticated` SELECT грант на `document_package_token_aliases` с RLS-policy `USING (true)`.
   - Иначе оставить service_role only.

4. **Включение flag → раскатка** — отдельный спринт после успешного dry-run.

5. **Обсуждение `package.context.plan_year`** (deferred-decision):
   - A) reuse `FLD-000082 meeting.report_year` если не meeting-specific;
   - B) generic package context token из `document_package_sessions.metadata.plan_year`;
   - C) deferred.
