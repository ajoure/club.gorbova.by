# Plan

## Sprint 3B v2.1 — DONE

**Status:** `completed: package person FLD + role aliases + resolver skeleton added; feature flag disabled; generation deferred`

**Proof:** `.lovable/proofs/package_documents_sprint3b_v2_1_execution_report_2026_05.md`

### Что сделано
- Pre-req: `fields_registry.public_id` → `NOT NULL` + `UNIQUE` (для FK target; данные уже соответствовали, 368/368).
- Создана таблица `public.document_package_token_aliases` (service_role only, RLS default-deny, partial-unique по `alias_token WHERE archived_at IS NULL`, FK на `fields_registry.public_id`, CHECK на `context_kind`+consistency).
- Созданы 2 canonical FLD: `FLD-000372 legal_details_persons.full_name`, `FLD-000373 legal_details_persons.position` (entity_type=`person`).
- Зарегистрированы 4 alias-токена: `package.roles.{company_head,responsible_person}.{full_name,position}`.
- Создан изолированный resolver: `supabase/functions/_shared/resolve-package-tokens.ts`, `HARDCODED_ENABLED=false`, **0 production imports**.
- Memory: `mem://architecture/documents/package-token-aliases-v1`.

### Что НЕ сделано (по контракту)
- `feature_flags` row — таблицы нет, flag hard-coded `false` в коде.
- `plan_year` FLD — deferred.
- Role-specific full_name/position FLD — отказались.
- Изменения в `canonical-document-generate-strict`, billing/customer/executor резолверах, шаблонах — НЕ ТРОГАЛИСЬ.

---

## Sprint 3C — TODO (отдельный approve)

1. Routing-точка пакетных aliases в `canonical-document-generate-strict` (за фича-флагом).
2. Полная интеграция `|case=` через `_shared/case-format.ts` в resolver.
3. UI picker для пакетных alias-токенов в редакторе шаблонов (тогда выдать `authenticated` SELECT грант с RLS-policy).
4. Включение flag → smoke-тесты на тестовом шаблоне → раскатка.
5. Обсуждение `package.context.plan_year`:
   - A) reuse `FLD-000082 meeting.report_year` если не meeting-specific;
   - B) generic package context token из `document_package_sessions.metadata.plan_year`;
   - C) deferred.
