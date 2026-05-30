---
name: Package ↔ billing placeholder parity v1
description: Package-токены {{package.(ul|ip|fl).FLD-…}} резолвятся через те же billing helpers (canonicalizeLegalEntity, formatEntrepreneurDisplayName, fullNameToInitials, formatStructuredAddress, normalizeMasculinePosition); package.ul.short_name выводится с формой собственности.
type: feature
---

**SOT formatter:** `supabase/functions/_shared/packageFieldFormatter.ts`. Единственный путь резолва значений `{{package.(ul|ip|fl).FLD-…}}` в orchestrator `ai-generate-document-package`. Использует ТОЛЬКО уже существующие billing helpers из `typed-tokens-resolver.ts`/`address-format.ts`/`ru-inflection.ts`. Контракт `preresolved_package_fields` не изменён.

**Канон значений:**
- `package.ul.short_name` → `ЗАО «АЖУР инкам»` (форма + кавычки), НЕ `АЖУР инкам`.
- `package.ul.org_form` → `ЗАО`; `|format=long` → `Закрытое акционерное общество`.
- `package.ul.director_short_name` → `Иванов И. И.` через `fullNameToInitials`.
- `package.ul.director_position` → всегда `normalizeMasculinePosition`.
- `package.ul.address_full` / `package.ip.address_full` → `formatStructuredAddress` (Минск/облцентры whitelist).
- `package.ip.name` → `ИП Федорчук Сергей Валерьевич` (`formatEntrepreneurDisplayName`).
- `package.ip.short_name` → `ИП Федорчук С. В.`.
- `package.fl.full_name_short` → `fullNameToInitials`.
- `package.fl.passport_number_full` → `series+number`.
- Все остальные tech_key → raw pass-through.

**Modifiers (strict, package-mode):** `|case=<6 падежей>` через `inflectRu`; `|format=long` ТОЛЬКО для `package.*.org_form` через `expandOrgFormToLong`. `|format=words` whitelisted, no-op для строк. Любой другой modifier → `unknown_modifier`. Парсер: `canonical-document-generate-strict/index.ts` (parsedPackageTokens).

**Идемпотентность:** `canonicalizeLegalEntity` и `formatEntrepreneurDisplayName` гарантируют отсутствие двойной формы/кавычек/префикса (raw `ЗАО «Foo»` → `ЗАО «Foo»`; raw `ИП ИП …` → `ИП …`). Покрыто Deno-тестом `packageFieldFormatter_test.ts`.

**Запреты:**
- НЕ читать сырые колонки `leg_name`/`leg_org_form`/`ent_name`/`full_name` напрямую в orchestrator (`readSourcePath` для package групп удалён).
- НЕ создавать новые formatter-функции — только импорт из billing helpers.
- НЕ менять `preresolved_package_fields` schema.
- НЕ применять modifiers в orchestrator — они применяются только в `canonical-document-generate-strict`.

**Proof:** `.lovable/proofs/sprint_3j_package_placeholder_parity_2026_05.md`.

**Backlog:** UI modifier-controls для package-групп в `PlaceholdersCatalogTab` (Sprint 3J-UI) — backend уже поддерживает.
