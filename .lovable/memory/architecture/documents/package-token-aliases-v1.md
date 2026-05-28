---
name: Package Token Aliases v1
description: Sprint 3F canonical role-token model — package-aware namespace (`{{package.ul|ip|fl.FLD-XXXXXX}}` + `{{package.role.PKR-XXXXXX}}`); legacy `package.roles.<role_key>.<attr>` deprecated; per-package custom roles via `document_package_role_catalog`; validator scope rules; FLD-000209 = «Сегодня прописью»
type: feature
---

# Package Token Aliases — canonical model (Sprint 3F)

## 1. Canonical syntax

| Назначение | Token | Источник |
|---|---|---|
| Реквизиты ЮЛ пакета | `{{package.ul.FLD-XXXXXX}}` | `client_legal_details` (через `document_package_sessions.selected_legal_entity_id`) |
| Реквизиты ИП пакета | `{{package.ip.FLD-XXXXXX}}` | `client_legal_details` (ent_*) |
| Реквизиты ФЛ пакета | `{{package.fl.FLD-XXXXXX}}` | `legal_details_persons` (через `document_package_session_participants.role_key`) |
| Роль пакета (физлицо + должность) | **`{{package.role.PKR-XXXXXX}}`** | `document_package_role_catalog.public_id` → `document_package_session_participants` → `legal_details_persons` + `metadata.position` |

Один токен на роль. Никаких `.full_name / .short_name / .position` — формат вывода управляется полем `output_template` роли (NULL → дефолт `«{{position}}, {{full_name}}»`).

## 2. Custom roles per package

`document_package_role_catalog` (per-package: FK `package_template_id`):
- `public_id` — `PKR-XXXXXX`, авто-назначается триггером `assign_package_role_public_id`, стабильный (не меняется при переименовании роли);
- `is_system` — `true` для системных (11 ролей пакета «Идеология» из Sprint 3B), `false` для custom;
- `output_template` — шаблон вывода роли, поддерживает `{{full_name}} / {{short_name}} / {{position}}`.

Custom-роль создаётся админом → автоматически получает PKR-код → сразу появляется в dropdown анкеты и в UI каталога плейсхолдеров (группа «Пакет: Роли»). Переименование role label не ломает Word-шаблоны.

## 3. Legacy / deprecated

Sprint 3B alias-токены `{{package.roles.<role_key>.<attr>}}` остаются в `document_package_token_aliases` как **read-only deprecated** (для совместимости со старыми шаблонами). Validator принимает их как valid syntax, но эмитит warning `deprecated_package_roles_syntax` с подсказкой мигрировать на `{{package.role.PKR-XXXXXX}}`. `package.roles.company_head.*` отдельно помечается deprecated: «дублирует Пакет: ЮЛ → Руководитель *» — для руководителя ЮЛ/ИП используются package-requisite FLD, не package-role.

## 4. Validator scope rules

Точка валидации upload: `canonical-template-apply-markup` (server) + `StrictDocumentTemplatesManager.strictValidate` (client mirror).

- `{{field:FLD-XXXXXX}}` — valid в любом scope; системные (FLD-000209 «Сегодня прописью», FLD-000211 «Текущий год»), документные (FLD-000069 «Номер документа»), общие — разрешены в package-template **без warning**.
- `{{package.ul|ip|fl.FLD-XXXXXX}}` — valid syntax всегда; scope (package vs billing template) проверяется controlled-validation панелью / runtime резолвером, **не** на upload.
- `{{package.role.PKR-XXXXXX}}` — valid syntax всегда; существование PKR — controlled validation; роль должна принадлежать тому же `package_template_id`, что и привязка шаблона.
- `{{package.roles.<role_key>.<attr>}}` — valid + warning `deprecated_package_roles_syntax`.
- `{{document.*}} / {{customer.*}} / {{executor.*}} / {{deal.*}} / {{cf.*}}` — по-прежнему error `legacy_placeholder_format_detected`.

В **package-template** биллинговый `{{field:FLD-XXXXXX}}` из групп «Заказчик ЮЛ/ИП/ФЛ» или «Исполнитель ЮЛ» планируется как warning `billing_token_in_package_template_warning` (controlled validation, фаза следующая).

## 5. Template scope SOT

`document_package_template_items` — source of truth: если строка `template_id` есть → шаблон package-scoped. `document_templates.template_scope` существует и используется как denormalized hint, обновляется явно при link/unlink (без триггера).

## 6. FLD-000209 ≠ номер документа

FLD-000209 = «Сегодня прописью» (системный токен текущей даты прописью). Номер документа = FLD-000069 (`document.number`). Текущий год = FLD-000211 (`system.year`). Документация и тесты обновлены, в плановых артефактах не путать.

## 7. Что НЕ делается

- Не создаются новые package-role токены типа `company_head.*`, `document_signer.*`, `document_preparer.*`, `control_person.*`, `ideology_responsible.*` как отдельные namespace. Всё это — строки в `document_package_role_catalog` с собственным PKR.
- Не создаются новые FLD без manifest-proof.
- `canonical-document-generate-strict` / Gotenberg / `ai_generated_documents` / billing-резолвер — не трогаются.
- HARDCODED_ENABLED в `resolve-package-tokens.ts` остаётся `false` — реальная генерация по package-токенам deferred.

## 8. Файлы

- `src/utils/packagePlaceholderCatalog.ts` — frontend SOT каталога UL/IP/FL + `buildPackageRoleItems`.
- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` — UI каталога с четырьмя группами.
- `supabase/functions/canonical-template-apply-markup/index.ts` — upload validator (server).
- `src/components/ai-documents/StrictDocumentTemplatesManager.tsx` — client validator mirror.
- `supabase/functions/_shared/resolve-package-tokens.ts` — package resolver (HARDCODED_ENABLED=false).
- `document_package_role_catalog` — SOT ролей пакета (с `public_id`, `is_system`, `output_template`).
- `document_package_token_aliases` — Sprint 3B legacy aliases (read-only deprecated).
