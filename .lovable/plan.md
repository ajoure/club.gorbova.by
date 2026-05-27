# План: пакеты документов — roadmap после Sprint 2.3

**Текущий статус:** Sprint 2.3 завершён (read-only corrective discovery).
**Proof:** `.lovable/proofs/package_documents_sprint2_3_generic_model_correction_2026_05.md`.

## Главное правило (закрепить в Core memory после approve)

Package placeholders — **единый generic namespace `documents:package`**. Per-package token namespaces (`documents:package:ideology`, `documents:package:<code>`, …) запрещены. Адаптация конкретного пакета — только через `document_package_role_catalog` и `document_package_sessions.package_template_id`. Generic role_keys расширяемы (новый пакет может добавлять свои role_keys), но **не** свой token-домен.

## Roadmap

### Sprint 2.3 — Corrective discovery ✅
- Пересмотрены 8 FLD `entity_type='package'` (93/94/95/96/97/98/101/102).
- 5 FLD (95/96/98/101/102) — legacy-corporate, не используются.
- 3 FLD (93/94/97) — кандидаты на label-генерализацию, решение в 3A.
- Generic роли (responsible_person, document_preparer, control_person, notified_person, participant) отсутствуют → создаются в 3B.

### Sprint 3A — Approve final generic token manifest (read-only/design-only)
- Аудит `TokenizedRichInput` + `tokenRegistry.ts`, выбор technical context-id.
- Финальный manifest generic токенов (reuse FLD-93/94/97 vs new).
- Финальное решение по generic role_keys (`responsible_person`, `participant`).
- Проверка массивных токенов (`participants[]`, `notified_persons[]`) на совместимость с DOCX-loop движком.
- Явное подтверждение защищённости billing templates (FLD актов выполненных работ не трогаются).
- Никаких изменений в БД и коде.

### Sprint 3B — Registry + picker + resolver skeleton
- INSERT generic токенов в `document_token_registry` (после approve 3A).
- Расширение `tokenRegistry.ts` группой «Пакеты документов».
- Skeleton package resolver: `document_package_sessions` → `_participants` → `role_catalog` → `client_legal_details` → `legal_details_persons`.
- НЕ подключать `canonical-document-generate-strict`.

### Sprint 4 — Package generation
- Генерация одного документа и пакета.
- `package_session_id` в snapshot, source_trace, warnings, validation.
- Только после Sprint 3B.

## STOP-зоны (на всех спринтах)

- `payments_v2`, `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `tariff_offers`.
- `allocate_document_number`, `document_scenarios`.
- billing/customer/executor resolver, FLD актов выполненных работ.
- signature `canonical-document-generate-strict`.
- Per-package token namespaces — запрещены.
- Дублирование `client_legal_details` / `legal_details_persons` — запрещено.

## Anti-fallback

Если generic token не разрешается из package_session → explicit warning + `unresolved`. Никакого silent fallback на legacy `package.signer.*` / `package.chairperson.*` / любой legacy-corporate FLD.
