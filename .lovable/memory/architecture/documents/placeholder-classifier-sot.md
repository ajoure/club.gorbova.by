---
name: Placeholder Classifier SOT
description: Единый источник истины классификации синтаксиса плейсхолдеров шаблонов; портабл для frontend и edge; pf/ln/package/field + scope-гейт
type: feature
---

# Placeholder Classifier — SOT (PATCH-PACKAGE-CUSTOM-FIELDS-V1, итерация 2)

**Канон:** `supabase/functions/_shared/placeholderClassifier.ts`
**Frontend mirror:** `src/lib/documents/placeholderClassifier.ts` (byte-identical, parity-тест в `placeholderClassifier.parity.test.ts`).

## Что внутри

Чистая (pure) функция без I/O. Никаких Supabase/Deno globals.

```ts
classifyPlaceholder(inside): PlaceholderClassification
evaluatePlaceholderInScope(inside, scope: 'billing'|'package'|'unknown'): { valid, reason, classification }
extractPackageFieldTokens(text): string[]
```

## Канонические виды токенов

| kind                  | синтаксис                                |
| --------------------- | ---------------------------------------- |
| `field`               | `field:FLD-XXXXXX[\|format=...\|case=...]` |
| `package_field`       | `pf-XXXXXX[\|...]`                       |
| `package_role`        | `ln-XXXXXX[\|...]`                       |
| `package_requisite`   | `package.<ul\|ip\|fl>.FLD-XXXXXX[\|...]` |
| `legacy_role_format`  | `package.role.PKR-*` / `package.roles.*` |
| `legacy_namespace`    | `document.*` / `executor.*` / …          |
| `unknown_modifier`    | неизвестный ключ модификатора            |
| `invalid_modifier_value` | известный ключ + недопустимое значение |
| `invalid`             | всё остальное                            |

## Модификаторы (строгий парсинг)

- `format=words|text` (field / pf / package.*)
- `format=full|short|signature_short` (ln)
- `case=nominative|genitive|dative|accusative|instrumental|prepositional`
- Любой другой ключ → `unknown_modifier`.
- Известный ключ + недопустимое значение → `invalid_modifier_value`.
- Никаких permissive `\|[^}]+)?` шаблонов.

## Scope-гейт (синтаксический)

- `billing`: только `field`. Любой package/ln/pf → `reason = 'package_token_outside_package_context'`.
- `package`: все 4 канонических вида.
- `unknown`: все 4 канонических вида (фактический binding-гейт выполняется выше).

## Контекст-гейт активации (defense-in-depth)

`canonical-template-apply-markup` после классификации проверяет, что любой шаблон с `{{pf-XXXXXX}}` имеет минимум одну запись в `document_package_template_items` (`template_id ↔ package_template_id`). Иначе → `validation_status='invalid'` с кодом `package_token_outside_package_context` → `canonical-template-activate-version` отказывает.

`document_package_template_items` — единственный SOT привязки шаблона к пакету. Никаких `meta.package_bound=true` bypass'ов.

## Антидрейф

- Любая правка только в **canonical** `_shared/`, потом скопировать в mirror, либо наоборот — parity-тест `placeholderClassifier.parity.test.ts` упадёт при расхождении.
- Никаких локальных `RX_PACKAGE_*` regex в новых файлах. Существующие в `TemplateMarkupDialog.tsx` и `PackageTemplateValidationPanel.tsx` — отложенный refactor (нерискованный).

## Где использовано (после итерации 2)

- `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`
- `supabase/functions/canonical-template-apply-markup/index.ts`

## Где НЕ использовано (отложенный refactor)

- `src/components/ai-documents/TemplateMarkupDialog.tsx` (chip renderer)
- `src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx` (DB-aware validator с собственной логикой `pfCatalog`)
- `supabase/functions/canonical-document-generate-strict/index.ts` (pf-аware уже через свой путь B4)
