# Sprint 3L — short_name + role position + filename render + ln multiline

Date: 2026-05-31

## Scope
1. `{{package.ul.FLD-000011}}` → «ЗАО «Ажур инкам»» (короткая форма + кавычки) вместо голого имени.
2. `{{ln-XXXXXX|include_position=true[|case=…]}}` — должность перед ФИО, склоняется по case с `forceGender` (default `m`, override через `metadata.position_gender`).
3. `{{ln-XXXXXX|join=semicolon|comma|newline}}` — разделитель для multi-assignment. Default = `semicolon` (backward-compat).
4. `file_name_template` для package-шаблонов: package/ln токены теперь резолвятся (раньше → пустая строка).

## Diff

### 1. Catalog reorder (FLD-000011 → short_name first)
- `supabase/functions/_shared/packagePlaceholderCatalog.ts` (95–96): short_name перед name.
- `src/utils/packagePlaceholderCatalog.ts` (186–192): зеркало.

Эффект: `findByPackageToken('package.ul.FLD-000011')` → `package.ul.short_name`.
`canonicalizeLegalEntity().short_name` → `ЗАО «Ажур инкам»`.

### 2. Position pass-through (ai-generate-document-package)
`preresolved_ln_tokens[lnPublicId]` теперь несёт `positions: string[]` и `position_genders: ('m'|'f'|null)[]` (длина = `persons[]`), source = `metadata.position` / `metadata.position_gender`. Backward-compat: пустая позиция → только ФИО.

### 3. ln modifiers parser + resolver (canonical-document-generate-strict)
- Парсер (~776): принимает `include_position=true|false`, `join=semicolon|comma|newline`. Прочее → `unknown_modifier`.
- Резолвер (~1130) переписан как единая ветка для `kind='ln'`:
  - per-person: `formatPersonName(fn, {format, case})`;
  - если `include_position=true` и `positions[i]` непуст → `normalizeMasculinePosition` + `inflectRu(case, {forceGender: position_genders[i] ?? 'm'})` + конкатенация перед ФИО;
  - join: `'; '` | `', '` | `'\n'`.
- Default `{{ln-XXXXXX}}` без модификаторов: fmt='full', cs=null, include=false, sep='; '. Sprint 3J-Roles regression сохранён.

### 4. Filename render fix
В двух местах (`_filenameTokenMapEarly` для core-props и финальный `filenameTokenMap`):
- если `generationContext === 'package_session'` → копируем из `resolved` все ключи, матчащие `^package\.(ul|ip|fl)\.FLD-\d{6}(\|.*)?$` и `^ln-\d{6}(\|.*)?$` (полный ключ + base);
- `renderFileName(..., { scope: 'package' })` для package-контекста; иначе `'billing'` (legacy).

После фикса:
`Приказ ... в {{package.ul.FLD-000011}} от {{field:FLD-000133}}` → `Приказ ... в ЗАО «Ажур инкам» от 31.05.2026` (вместо обрыва «в от»).

## Verify

- `bunx tsc --noEmit` → 0 errors.
- `bunx vitest run` → 127 tests pass (4 fail в Deno-only файлах с https:-импортами — pre-existing, не Sprint 3L).
- Runtime verification («Приказ об организации идеологической работы» на реальном пакете «Идеология») — ОЖИДАЕТСЯ от пользователя; ожидаемые подстроки:
  - заголовок: `об организации идеологической работы в ЗАО «Ажур инкам»`;
  - 2.1 с `{{ln-XXXXXX|include_position=true|case=genitive}}`: `юрисконсульта Федорчука Сергея Валерьевича`;
  - имя файла: `Приказ об организации идеологической работы в ЗАО «Ажур инкам» от 31.05.2026.pdf`.

## Sprint 3J-Roles regression
`{{ln-XXXXXX}}` → только ФИО (по `formatPersonName(fn, {format:'full', case:null})`), join `; `. include_position=false по умолчанию. Без regression.

## Deferred (по решению скоупа)
- UI каталога «Пакет: Роли»: control для `include_position` + `join` в `RowSettingsCell` не добавлен. Backend готов; пользователь может вручную дописать `|include_position=true|join=newline` в Word-шаблоне. Полный UI control — отдельным sprint.
- Deno-тесты для `resolveLnRoleToken` с position — не добавлены: `resolveLnRoleToken` (в `_shared/resolve-package-tokens.ts`) — это dry-run путь, production использует preresolver в `ai-generate-document-package`. Реальная логика покрыта integration-flow.

## Non-goals (не тронуто)
- `package.ip.*`, `package.fl.*` маппинги.
- Billing resolver, `customer.leg.*`, `typed-tokens-resolver.ts`.
- Миграции, RLS, edge runtime, Gotenberg, `/purchases`, billing, `subscriptions_v2`.
- `ai_generated_documents.file_name` контракт (без расширения для PDF).
- Production-строки `document_templates.file_name_template`.

## Files
- supabase/functions/_shared/packagePlaceholderCatalog.ts
- supabase/functions/ai-generate-document-package/index.ts
- supabase/functions/canonical-document-generate-strict/index.ts
- src/utils/packagePlaceholderCatalog.ts
- .lovable/proofs/sprint_3l_short_name_role_position_filename_render_newline_2026_05.md
