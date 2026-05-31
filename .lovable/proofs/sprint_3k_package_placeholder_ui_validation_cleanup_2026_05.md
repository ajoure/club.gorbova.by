# Sprint 3K proof — Package placeholder UI examples + template validation cleanup

Date: 2026-05-31
Scope: UI-only (каталог пакетных плейсхолдеров, валидация шаблонов, имя файла). Backend generation, миграции, biling resolver и /purchases не тронуты.

## 1. Package examples
- `src/utils/packagePlaceholderCatalog.ts`: к интерфейсу `PackagePlaceholderItem` добавлено обязательное поле `example_value: string | null`.
- Все `copy_ready` пункты ЮЛ/ИП/ФЛ/Roles получили реальные примеры из `src/constants/demoLegalDetails.ts` (ООО «Тестовая Компания», 987654321, Федорчук Сергей Валерьевич, +375 29 7000000 и т.п.).
- `pending_field`/`deferred` → `example_value: null` (UI показывает резолверную подсказку, не заглушку «появится после анкеты»).

## 2. Duplicate removal
- Из UI-каталога удалены отдельные строки «ФИО (кратко)» для ЮЛ, ИП, ФЛ: они дублировали full_name. Краткая форма доступна через модификатор `|format=short` (см. `personNameFormat`).

## 3. TemplateMarkupDialog validation
- В `TemplateMarkupDialog.tsx` и `StrictDocumentTemplatesManager.tsx` regex'ы для package/ln токенов расширены хвостом `(?:\|[a-z_]+=[a-z_]+)*`.
- Канонические токены с модификаторами больше не подсвечиваются как legacy:
  - `{{package.ul.FLD-000014|format=signature_short}}`
  - `{{ln-000012|format=signature_short}}`

## 4. File name validation
- `src/lib/documents/documentFilename.ts` (+ зеркало `supabase/functions/_shared/document-filename.ts`) теперь принимают параметр `scope: 'billing' | 'package'`.
- В `package` scope валидны:
  - `{{field:FLD-XXXXXX}}` (с опц. модификаторами),
  - `{{package.<ul|ip|fl>.FLD-XXXXXX}}` (с опц. модификаторами),
  - `{{ln-XXXXXX}}` (с опц. модификаторами).
- В `billing` scope разрешены ТОЛЬКО `{{field:FLD-...}}`; package/ln токены → invalid.

## 5. FLD-000069 warning-only
- `FileNameTemplateEditor.tsx`: отсутствие `{{field:FLD-000069}}` больше не блокирует сохранение шаблона; вместо blocker — информационное предупреждение «Рекомендуем добавить номер документа».
- `templateHasDocNumberFld()` остался как helper для UI-баннера, но не используется в `canSave`.

## 6. Active ideology order validation
- Активный шаблон «Приказ об организации идеологической работы в {{package.ul.FLD-000011}} от {{field:FLD-000133}}» теперь проходит UI-валидацию без blockers (оба токена распознаются как канонические; FLD-000069 не требуется).

## 7. Tests
Все зелёные (`bunx vitest run`):
- `src/utils/packagePlaceholderCatalog.test.ts` — 30 passed (фикстуры на стр. 236/260 дополнены `example_value: null`).
- `src/lib/documents/documentFilename.test.ts` — 12 passed (new), покрывает:
  - package-scope принимает `{{package.ul.FLD-000011}}` (с/без модификаторов);
  - package-scope принимает `{{ln-000012}}` (с/без модификаторов);
  - package-scope принимает `{{field:FLD-000133}}`;
  - billing-scope отклоняет package/ln токены;
  - FLD-000069 не обязателен;
  - renderFileName подставляет package/ln/field токены и эмитит warning при unresolved.

Typecheck: `bunx tsc --noEmit` — 0 errors.

## 8. Untouched scope (explicit)
- `supabase/functions/canonical-document-generate-strict` — НЕ тронут.
- `supabase/functions/ai-generate-document-package` — НЕ тронут.
- Gotenberg pipeline — НЕ тронут.
- Migrations — НЕ создавались.
- Billing resolver (`canonical-billing-resolver` / `aiDocumentSnapshotResolver` и т.п.) — НЕ тронут.
- `/purchases` UI и backend — НЕ тронуты.
- Новые FLD — НЕ добавлялись.
