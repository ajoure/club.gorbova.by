да, согласен, с учетом правок:

**1. Подтверждение по открытому вопросу**

Применяем новый стандарт ФИО **ко всей системе**, включая billing-плейсхолдеры директора ЮЛ / ИП / ФЛ / package / роли.

Legacy-формат с пробелом между инициалами больше не используем.

Правильно:

format=short:

Федорчук Сергей Валерьевич → Федорчук С.В.

&nbsp;

format=signature_short:

Федорчук Сергей Валерьевич → С.В.Федорчук

Неправильно:

Федорчук С. В.

С.В. Федорчук

&nbsp;

**2. Helper должен сразу поддерживать падеж**

В §2 изменить сигнатуру helper:

export function formatPersonName(

  fullName: string | null | undefined,

  opts?: {

    format?: 'full' | 'short' | 'signature_short';

    case?: CaseName | null;

  },

): string

Правила:

- format=full + case=genitive → склоняются фамилия, имя, отчество:  
Федорчука Сергея Валерьевича
- format=short + case=genitive → склоняется только фамилия:  
Федорчука С.В.
- format=signature_short + case=genitive → склоняется только фамилия:  
С.В.Федорчука

Так мы убираем спор о порядке «сначала падеж или сначала short».

&nbsp;

**3. Обязательно добавить**

**packageFieldFormatter.ts**

**в scope**

В список файлов добавить:

supabase/functions/_shared/packageFieldFormatter.ts

Потому что package UL/IP/FL уже используют этот formatter. Все ФИО-поля там тоже должны перейти на новый formatPersonName.

&nbsp;

**4. Ошибка modifier должна быть**

**unknown_modifier**

**, а не legacy**

В canonical-template-apply-markup и strict-validator:

- старые токены PKR, package.role.PKR, package.roles.* → invalid_legacy_role_placeholder;
- неизвестный modifier → unknown_modifier.

Не смешивать legacy token и ошибку modifier.

&nbsp;

**5. Парсер modifiers**

UI всегда строит токен в порядке:

|format=...|case=...

Но backend parser должен безопасно читать оба порядка:

{{ln-000012|format=short|case=genitive}}

{{ln-000012|case=genitive|format=short}}

Если один modifier повторён дважды — error duplicate_modifier.

&nbsp;

**6.**

**format=full**

В UI format=full считается default и в токен не пишется.

То есть copy:

{{ln-000012}}

Но backend должен принимать и явный вариант:

{{ln-000012|format=full}}

&nbsp;

**7. Старые примеры тоже проверить**

Сделать grep по codebase:

rg "И\\. И\\.|С\\. В\\.|Федорчук С\\. В\\.|Иванов И\\. И\\." src supabase

Все user-facing code examples заменить на новый формат.

Если старые примеры лежат в БД fields_registry и реально отображаются в UI — не менять молча. Зафиксировать в proof как DB-example gap и вынести отдельным manifest/fix, если потребуется.

&nbsp;

**8. Proof должен включать billing-output**

Так как мы сознательно меняем short-format глобально, proof должен показать не только package/roles, но и billing.

Добавить в proof:


|                               |            |                           |
| ----------------------------- | ---------- | ------------------------- |
| **Контекст**                  | **Токен**  | **Результат**             |
| Billing ЮЛ руководитель short | `{{field:… | format=short}}`           |
| Package роль short            | `{{ln-…    | format=short}}`           |
| Package роль signature        | `{{ln-…    | format=signature_short}}` |


&nbsp;

**9. Runtime DOCX proof**

В proof обязательно проверить generated DOCX, а не только unit tests:

- {{ln-...}} → ФИО полностью;
- {{ln-...|format=short}} → Федорчук С.В.;
- {{ln-...|format=signature_short}} → С.В.Федорчук;
- {{ln-...|format=short|case=genitive}} → Федорчука С.В.;
- raw {{...}} отсутствуют.

&nbsp;

**10. Memory**

В memory записать:

ФИО кратко по всей системе: Фамилия И.О.

ФИО кратко для подписи: И.О.Фамилия

Роли ln по умолчанию выводят ФИО человека, а не название роли.

output_template роли больше не влияет на default ln-output.

**Финальный DoD**

- format=short везде даёт Федорчук С.В.
- format=signature_short везде даёт С.В.Федорчук
- billing и package используют один helper;
- роли {{ln-XXXXXX}} поддерживают format и case;
- UI показывает новый формат;
- generated DOCX подтверждает результат;
- старый формат Федорчук С. В. больше не появляется в новых preview/output.

&nbsp;

# План: Sprint 3J-Roles — modifier-parity для ролей и единый стандарт ФИО

## 0. Цель

1. Привести `{{ln-XXXXXX}}` к тому же набору modifiers, что и FL/IP/UL: `format=full|short|signature_short`, `case=…`, мульти-назначение через `;` , по умолчанию — ФИО без названия роли.
2. Ввести единый стандарт коротких ФИО по всей системе (billing + package + роли):
  - `format=short` → `Федорчук С.В.` (пробел после фамилии, без пробелов между инициалами).
  - `format=signature_short` → `С.В.Федорчук` (без пробелов).
3. UI «Пакет: Роли» получает те же контролы, что строки ФЛ, и расширяется новой опцией «ФИО кратко для подписи» во всех ФИО-группах.

## 1. Каноны и запреты

- Канон токена роли: только `{{ln-XXXXXX}}`. Никаких `{{ln-XXXXXX.full_name}}`, `{{ln-XXXXXX.short_name}}`, `{{package.roles.*}}`, `{{package.role.PKR-…}}`.
- НЕ создаём новые FLD, новые алиасы, новые таблицы, новые edge functions.
- НЕ трогаем billing/order generation pipeline, `/purchases`, `document_templates`, миграции, RLS, Gotenberg, `ai_generated_documents` контракт, `preresolved_package_fields` schema.
- НЕ создаём отдельный formatter для ролей — переиспользуем helpers ФЛ.

## 2. Единый helper ФИО

Файл: `supabase/functions/_shared/typed-tokens-resolver.ts`.

Добавить новый shared API (рядом с существующим `fullNameToInitials`):

```ts
export type PersonNameFormat = 'full' | 'short' | 'signature_short';
export function formatPersonName(
  fullName: string | null | undefined,
  opts?: { format?: PersonNameFormat },
): string
```

Правила:

- `full` — исходное ФИО `trim()`-нормализовано.
- `short` — `Фамилия И.О.` (пробел между фамилией и инициалами, между инициалами пробела НЕТ, после каждой буквы точка). Пример: `Федорчук С.В.`, `Иванов И.И.`.
- `signature_short` — `И.О.Фамилия` (без пробелов нигде). Пример: `С.В.Федорчук`.

Существующий `fullNameToInitials` переписать как обёртку `formatPersonName(name, { format: 'short' })`, чтобы все текущие call-сайты автоматически перешли на новый формат `Иванов И.И.` (без пробела между инициалами). Это сознательное изменение — см. §10 «Риски».

## 3. Backend resolver ролей (`{{ln-XXXXXX}}`)

Файл: `supabase/functions/_shared/resolve-package-tokens.ts`, функция `resolveLnRoleToken`.

Изменения:

1. Расширить `parseRawToken` поддержкой `format=full|short|signature_short` (`caseMod` уже есть).
2. Сигнатуру `resolveLnRoleToken(input, lnPublicId, caseMod, formatMod)` дополнить `formatMod`.
3. Поведение по умолчанию (no modifiers) — ТОЛЬКО ФИО назначенного человека (`formatPersonName(person.full_name, { format: 'full' })`). Игнорируем `role.output_template` для default-канона; `position` больше не подмешивается в значение по умолчанию. (Существующий шаблон `"{{position}}, {{full_name}}"` остаётся в БД как legacy — резолвер его перестаёт использовать. Перенести этот факт в memory.)
4. Если `formatMod` задан — применить `formatPersonName` соответственно.
5. Падеж — через тот же inflection-pipeline, что у ФЛ (`inflectRu`/`case-format.ts`), применяется ПОСЛЕ форматирования имени:
  - `case` для `full` — склонение всех трёх частей,
  - `case` для `short`/`signature_short` — склонение только фамилии (инициалы не склоняются), сохраняя позицию (`Федорчука С.В.`, `С.В.Федорчука`).
6. Мульти-assignment: больше не возвращаем `multiple_role_assignments` warning как блокер — резолвим всех активных, каждое имя форматируем по тем же modifiers, объединяем через `;`  (с пробелом после `;`).
7. Неактивные/`is_active=false` — не попадают (уже так).

## 4. Strict-парсер плейсхолдеров

Файл: `supabase/functions/canonical-document-generate-strict/index.ts`.

- В уже существующий блок парсинга `{{ln-XXXXXX|…}}` добавить распознавание `format=short|full|signature_short` (рядом с `case=…`).
- Те же модификаторы разрешить для `{{field:FLD-…}}` и `{{package.(ul|ip|fl).FLD-…}}` ТОЛЬКО для полей, у которых UI поддерживает FIO-форматы (см. §6) — фильтрация по `tech_key` / `data_type` из существующего каталога. Прочие modifiers → `unknown_modifier` (поведение не меняем).
- Применение делегируется helpers из §2 + `inflectRu`.

## 5. Markup validator

Файл: `supabase/functions/canonical-template-apply-markup/index.ts`, RX_PACKAGE_ROLE_LN.

- Whitelist modifiers для `ln-XXXXXX`: `case=<6>`, `format=<full|short|signature_short>`. Любой другой modifier — текущая ошибка «устаревший формат».
- Аналогично расширить whitelist для package FL/IP/UL фио-полей.

## 6. UI — `PlaceholdersCatalogTab`

Файл: `src/components/ai-documents/PlaceholdersCatalogTab.tsx` + `src/utils/packagePlaceholderCatalog.ts` + `src/components/ai-documents/FieldFormatPicker.tsx`.

1. Расширить `SupportsKind` / `classifyDataType`: для ФИО-полей вернуть новый kind `person_name`.
2. В `FieldFormatPicker` для kind=`person_name` показать три радио-опции формата:
  - `ФИО полностью` → `format=full` (default, в токен не пишем).
  - `ФИО кратко` → `format=short`.
  - `ФИО кратко для подписи` → `format=signature_short`.
   И блок падежей (все 6 + «без падежа»).
3. Группу «Пакет: Роли» отрисовать через тот же row-renderer, что строки ФЛ (вместо текущей «роль без модификаторов»). Удалить ветку «роли игнорируют modifiers».
4. `buildPackagePlaceholderToken` расширить параметром `format` со значениями `full|short|signature_short`. Порядок модификаторов в выводе: `|format=…|case=…` (как уже принято).
5. Для `ln-XXXXXX` (роли) использовать тот же helper-builder, выводящий `{{ln-XXXXXX|format=…|case=…}}`.
6. Preview:
  - Если есть live-resolver / реальное назначение — показать реальное значение.
  - Иначе — статический demo `Федорчук Сергей Валерьевич` / `Федорчук С.В.` / `С.В.Федорчук` / падеж по выбору, через тот же `formatPersonName`+`inflectRu` (frontend-аналог уже есть).
  - Если ничего недоступно — fallback «Пример появится после заполнения анкеты документа».
7. Применить новый список форматов ФИО ко всем рядам ФЛ-семантики в каталоге: ФЛ-полное имя, руководитель ЮЛ, ФИО ИП-владельца, package-аналоги.

## 7. Frontend helper

Файл: `src/utils/personNameFormat.ts` (новый, единый источник для UI):

```ts
export type PersonNameFormat = 'full' | 'short' | 'signature_short';
export function formatPersonNameClient(fullName: string, opts?: { format?: PersonNameFormat }): string
```

Реализация байт-в-байт зеркалит backend `formatPersonName`. Используется в `FieldFormatPicker` preview и `PlaceholdersCatalogTab` demo. Существующие фронтовые «`Фамилия И. И.`» helpers (если есть) переключить на этот helper.

## 8. Тесты

1. `supabase/functions/_shared/personNameFormat_test.ts` (новый, Deno):
  - `Иванов Иван Иванович` → short `Иванов И.И.`, signature `И.И.Иванов`.
  - `Федорчук Сергей Валерьевич` → short `Федорчук С.В.`, signature `С.В.Федорчук`.
  - 2-словные ФИО (`Иванов Иван`), одно слово, пустая строка — без падений.
2. `supabase/functions/_shared/resolve-package-tokens_test.ts`: для `{{ln-…}}`
  - default → full ФИО (без position).
  - `format=short`, `format=signature_short`.
  - `case=genitive`, комбинации `format=short|case=genitive` / `format=signature_short|case=genitive`.
  - 2 active assignments → `Федорчук С.В.; Иванов И.И.`.
  - inactive не попадают.
3. `src/utils/packagePlaceholderCatalog.test.ts`:
  - copy-token `{{ln-000012|format=short|case=genitive}}` (правильный порядок).
  - роли поддерживают signature_short.
  - старые `PKR` / `package.roles.*` не появляются.
4. `src/utils/personNameFormat.test.ts` (vitest) — зеркало Deno-теста.

## 9. Proof

Файл: `.lovable/proofs/sprint_3j_roles_modifier_parity_2026_05.md`.

Содержание:

- Copy examples (5 вариантов для `ln-000012`).
- Preview examples (full / short / signature_short / падеж).
- Таблица «ФИО formatting parity» (4 строки из спецификации §7 user message).
- Runtime DOCX: вставить в тестовый шаблон 5 токенов, сгенерировать, показать выдержку.
- Чек-лист: billing/order не тронуты, `/purchases` не тронуты, миграции отсутствуют, новых FLD нет.

## 10. Риски и явные подтверждения

- **Изменение `fullNameToInitials` (с пробелом) → новый стандарт без пробела затрагивает billing output** (директор ЮЛ короткое имя, ИП short_name и т.д.). Пользователь явно требует «правило применяется ко всем ФИО в системе: billing, package, роли». Это сознательный refactor формата, не изменение бизнес-логики. Если требуется сохранить legacy-формат в billing — нужно сказать сейчас, иначе исполняем единый стандарт.
- `output_template` ролей в БД (`document_package_role_catalog.output_template`) больше не влияет на default-вывод `{{ln-…}}`. Поле остаётся в схеме, фактически становится legacy. Зафиксируем в memory.

## 11. Файлы (только перечень)

Backend:

- `supabase/functions/_shared/typed-tokens-resolver.ts` (+ `formatPersonName`, переделать `fullNameToInitials`).
- `supabase/functions/_shared/resolve-package-tokens.ts` (`parseRawToken`, `resolveLnRoleToken`, мульти-assignment join).
- `supabase/functions/canonical-document-generate-strict/index.ts` (whitelist `format=` для ФИО).
- `supabase/functions/canonical-template-apply-markup/index.ts` (whitelist modifiers `ln-`).
- `supabase/functions/_shared/personNameFormat_test.ts` (new).
- `supabase/functions/_shared/resolve-package-tokens_test.ts` (extend).

Frontend:

- `src/utils/personNameFormat.ts` (new).
- `src/utils/personNameFormat.test.ts` (new).
- `src/utils/packagePlaceholderCatalog.ts` (+ `signature_short` в `buildPackagePlaceholderToken`, classifier `person_name`).
- `src/utils/packagePlaceholderCatalog.test.ts` (extend).
- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` (роль-rows c modifier-controls, preview).
- `src/components/ai-documents/FieldFormatPicker.tsx` (kind `person_name` с тремя форматами + падеж).

Memory / proof:

- `.lovable/proofs/sprint_3j_roles_modifier_parity_2026_05.md`.
- Обновить `.lovable/memory/architecture/documents/package-billing-parity-v1.md` (новый стандарт ФИО + `signature_short` + поведение `{{ln-…}}` по умолчанию).

## 12. DoD

- `{{ln-XXXXXX}}` без модификаторов → ФИО полностью назначенного человека (без названия роли).
- `format=short` → `Фамилия И.О.` (без пробела между инициалами) везде в системе.
- `format=signature_short` → `И.О.Фамилия` (без пробелов) везде.
- `case=…` работает совместно с обоими форматами; реальный DOCX рендер совпадает с preview.
- Множественное назначение роли выводится через `;` .
- UI «Пакет: Роли» имеет те же modifier-контролы, что строки ФЛ; copy-button формирует корректный токен.
- В UI больше нигде не появляются `PKR`, `package.role.PKR`, `package.roles.*`.
- Старый формат `Фамилия И. И.` (с пробелом) удалён из codebase.
- Proof сформирован, тесты зелёные, миграций и новых FLD нет.

## 13. Открытый вопрос (требует ответа до build)

Подтвердите явно: применяем новый стандарт `short` (`Иванов И.И.` без пробела) **в том числе к billing-плейсхолдерам директора ЮЛ / ИП**, или там оставляем legacy `Иванов И. И.` и меняем только package/роли? В тексте спецификации указано «применяется ко всем ФИО в системе» — план исходит из этого. Если billing трогать нельзя, helper будет ветвиться (`legacy_short` для billing, `short` для package/ln), это +1 risk.