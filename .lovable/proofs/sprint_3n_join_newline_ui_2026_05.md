# Sprint 3N — UI-разделитель для ролевых плейсхолдеров (`|join=…`)

**Дата:** 2026-05-31
**Scope:** только presentation-layer (UI + helper + тесты)

## Что сделано

### 1. `src/utils/packagePlaceholderCatalog.ts`
- `buildPackagePlaceholderToken` принимает 5-й аргумент `joinMode?: 'semicolon' | 'comma' | 'newline' | null`.
- Канонический порядок модификаторов зафиксирован: **`format → case → include_position → join`**.
- `joinMode='semicolon'` — default, в токен **не записывается**.
- `joinMode` и `includePosition` применяются **только для ln-токенов** (`groupId === 'package_roles'`); для FLD/`package.ul|ip|fl.*` — игнорируются.

### 2. `src/components/ai-documents/PlaceholdersCatalogTab.tsx`
- `RowSettings` расширен `joinMode?: 'semicolon' | 'comma' | 'newline' | null`.
- `isDefault` учитывает `joinMode` (null или `semicolon` = default).
- В `RowSettingsCell` появился `<Select>` с тремя опциями для ролей:
  - `; через точку с запятой` (default)
  - `, через запятую`
  - `↵ с новой строки`
- Контрол виден **только** когда `kind === 'person_name' && supportsJoin === true` (передаётся `isRolesGroup`).
- Тултип на контроле: «Применяется, если на одну роль назначено несколько человек.»
- Demo-preview для роли показывает реальный эффект: при выборе comma/newline отображаются два участника (через `whitespace-pre-line` — настоящий перевод строки).

## Как пользователь включает «каждое ФИО с новой строки»

1. `/admin/documents` → вкладка **Каталог плейсхолдеров**.
2. Найти ролевую строку (группа «Пакет: Роли», `ln-XXXXXX`).
3. В колонке «Модификаторы» — справа от падежа и кнопки «С должностью» — открыть селектор разделителя и выбрать **↵ с новой строки**.
4. Скопировать обновлённый токен. Примеры:
   - `{{ln-000012|join=newline}}`
   - `{{ln-000012|case=genitive|include_position=true|join=newline}}`
5. Вставить в DOCX-шаблон. При генерации все ФИО с этой ролью будут перечислены каждое с новой строки.

## Backend

Парсер `|join=semicolon|comma|newline` для ln-токенов уже реализован в `supabase/functions/canonical-document-generate-strict/index.ts` (Sprint 3L, строки 727/784/793/1145). В этом спринте backend **не менялся**.

## Тесты

`bunx vitest run src/utils/packagePlaceholderCatalog.test.ts` → **36/36 passed**.

Новые / обновлённые кейсы:
- `ln + joinMode=newline → {{ln-000012|join=newline}}`
- `ln + joinMode=comma → {{ln-000012|join=comma}}`
- `ln + joinMode=semicolon` (default) — токен без модификатора
- `ln + format+case+include_position+join` — порядок `format → case → include_position → join`
- `joinMode` для package-полей (не-роль) — игнорируется
- Обновлён существующий кейс `include_position`: новый канон `case` ставится перед `include_position`.

## Definition of Done

- [x] Контрол выбора разделителя виден на ролевых строках; скрыт на FLD/package-полях.
- [x] `↵ с новой строки` → `|join=newline` в копируемом токене.
- [x] `; через точку с запятой` (default) → токен без `join=…`.
- [x] Канонический порядок модификаторов: `format → case → include_position → join`.
- [x] `joinMode` для не-ролевых токенов игнорируется в helper'е (guard в `buildPackagePlaceholderToken`).
- [x] Preview демонстрирует реальный эффект разделителя на двух участниках.
- [x] vitest зелёный (36/36).

## Runtime DOCX (manual smoke)

Backend-парсинг `|join=newline` уже покрыт в Sprint 3L (см. `canonical-document-generate-strict/index.ts:1145`: `pt.join === 'newline' ? '\n' …`). Ручная проверка на шаблоне «Приказ об организации идеологической работы» с ролью из 2 участников и токеном `{{ln-000003|join=newline}}` — выполняется пользователем после редеплоя UI (изменения backend не требуются).

## Что НЕ трогали

- billing, Gotenberg, /purchases
- `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`
- миграции, RLS, edge-runtime, контракты `ai_generated_documents`
- `canonical-document-generate-strict/index.ts` (parsing `join` уже был в Sprint 3L)
- `ai-generate-document-package/index.ts`
- `supabase/functions/_shared/packagePlaceholderCatalog.ts`
