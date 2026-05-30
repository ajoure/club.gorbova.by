# Sprint 3J — Parity пакетных плейсхолдеров с биллинговыми

**Статус:** core DONE (backend parity + tests). UI modifier-controls для package-групп в PlaceholdersCatalogTab — отдельный мини-спринт 3J-UI.

## 1. Parity manifest (выдержка по проблемным полям)

| package_token | package label | billing analog FLD | billing output | до 3J (package) | после 3J (package) | formatter | status |
|---|---|---|---|---|---|---|---|
| `{{package.ul.FLD-000011}}` (short_name) | Пакет ЮЛ: краткое название | FLD-000345 (`customer.leg.short_name`) | `ЗАО «АЖУР инкам»` | `АЖУР инкам` | `ЗАО «АЖУР инкам»` | `canonicalizeLegalEntity().short_name` | **OK** |
| `{{package.ul.FLD-000011}}` (name) | Пакет ЮЛ: название | FLD-000342 (`customer.leg.name`) | `АЖУР инкам` | `АЖУР инкам` | `АЖУР инкам` | `canonicalizeLegalEntity().name` | OK |
| `{{package.ul.FLD-000010}}` | Пакет ЮЛ: форма собственности | FLD-000343 (`customer.leg.org_form`) | `ЗАО` | (как было) | `ЗАО` (+ `format=long` → `Закрытое акционерное общество`) | `canonicalizeLegalEntity().org_form` + `expandOrgFormToLong` | OK |
| `{{package.ul.FLD-000014}}` (director_short_name) | Пакет ЮЛ: руководитель ФИО (кратко) | FLD-000340 (`customer.leg.director_short_name`) | `Иванов И. И.` | `Иванов Иван Иванович` | `Иванов И. И.` | `fullNameToInitials(leg_director_name)` | OK |
| `{{package.ul.FLD-000013}}` | Пакет ЮЛ: должность руководителя | FLD-000339 | `Управляющий` | `Управляющая` (raw) | `Управляющий` | `normalizeMasculinePosition` | OK |
| `{{package.ul.FLD-000012}}` (address_full) | Пакет ЮЛ: юр.адрес | FLD-000330 (`customer.leg.address.full`) | `formatStructuredAddress` rendered | raw `leg_address` | `formatStructuredAddress` рендер (Минск whitelist) | `formatStructuredAddress` | OK |
| `{{package.ip.FLD-000017}}` (name) | Пакет ИП: ФИО | FLD-000293 (`customer.ent.name`) | `ИП Федорчук Сергей Валерьевич` | `Федорчук Сергей Валерьевич` | `ИП Федорчук Сергей Валерьевич` | `formatEntrepreneurDisplayName` | OK |
| `{{package.ip.FLD-000017}}` (short_name) | Пакет ИП: ФИО (кратко) | FLD-000295 (`customer.ent.short_name`) | `ИП Федорчук С. В.` | `Федорчук Сергей Валерьевич` | `ИП Федорчук С. В.` | `ИП ${fullNameToInitials(clean)}` | OK |
| `{{package.fl.FLD-000372}}` (full_name) | Пакет ФЛ: ФИО | FLD-000313 | `Петров Пётр Петрович` | как есть | как есть | raw | OK |
| `{{package.fl.FLD-000372}}` (full_name_short) | Пакет ФЛ: ФИО кратко | FLD-000314 | `Петров П. П.` | `Петров Пётр Петрович` | `Петров П. П.` | `fullNameToInitials` | OK |
| `{{package.fl.FLD-000023}}` (passport_number_full) | Пакет ФЛ: серия+номер | FLD-000318 | `MP1234567` | `''` (нет колонки) | `MP1234567` | `series+number` | OK |

UL/IP/FL банк/телефон/email/УНП/паспорт/даты — `raw` pass-through (паритет с billing tokens, которые тоже raw для этих полей).

## 2. Modifiers parity

| token | case=genitive | format=long | format=words |
|---|---|---|---|
| `{{package.ul.FLD-000011\|case=genitive}}` | `inflectRu` → паритет с billing | n/a (string) | n/a |
| `{{package.ul.FLD-000010\|format=long}}` | + `case=` | `expandOrgFormToLong` (`Закрытое акционерное общество`) — паритет с `*.leg.org_form\|format=long` | n/a |
| `{{ln-XXXXXX\|case=...}}` | `inflectRu` | n/a | n/a |

`case`, `format=long`, `format=words` whitelisted в `canonical-document-generate-strict` (lines 727–742, 1101–1122). Apply-markup whitelist допускает любой tail-modifier через `(\|[^}]+)?`.

## 3. Double-format guard

Покрыто Deno-тестом «UL short_name: идемпотентность»:
- raw `ЗАО «Foo»` → `ЗАО «Foo»` (не `ЗАО ЗАО «Foo»`, не `«ЗАО «Foo»»`).
- raw `ИП Федорчук …` для IP → `ИП Федорчук …` (не `ИП ИП …`).

`canonicalizeLegalEntity` идемпотентна: распознаёт ведущую форму, отрезает дублирующие кавычки.

## 4. Tests

`supabase/functions/_shared/packageFieldFormatter_test.ts` — 13 кейсов: UL short/full/org_form/idempotency/director_short/director_position/raw, IP name/idempotency/short_name, FL initials/passport_full/address jsonb, address_full empty, unknown tech_key → ''.

Запуск через `supabase--test_edge_functions` — exit code 0. Все 13 assertions зелёные. Один из них — побайтное равенство с `canonicalizeLegalEntity` результатом из `typed-tokens-resolver.ts` (биллинговый SOT).

## 5. Что НЕ менялось (доказательство нетронутости)

- `supabase/functions/_shared/typed-tokens-resolver.ts` — только `fullNameToInitials` экспортирована (`function` → `export function`); тело без изменений; billing-резолверы и кастомер/исполнитель токены без изменений.
- `customer.leg.*`, `customer.ent.*`, `customer.ind.*`, `executor.leg.*`, billing-FLD маппинг — без изменений.
- `/purchases`, `purchase-document-rules`, `canonical-document-generate-strict` для **order-mode** ветки (`generationContext !== 'package_session'`) — без изменений.
- Миграции, RLS, contract `preresolved_package_fields`, edge config `verify_jwt`, Gotenberg — без изменений.
- `document_templates`, `document_template_versions`, billing шаблоны — не модифицированы.

## 6. Изменённые файлы

```
supabase/functions/_shared/typed-tokens-resolver.ts   # export fullNameToInitials
supabase/functions/_shared/packageFieldFormatter.ts   # NEW — Sprint 3J SOT
supabase/functions/_shared/packageFieldFormatter_test.ts  # NEW
supabase/functions/ai-generate-document-package/index.ts  # use formatPackageFieldValue
supabase/functions/canonical-document-generate-strict/index.ts  # parser+resolver: package format=long
.lovable/proofs/sprint_3j_package_placeholder_parity_2026_05.md  # this file
```

`git diff` НЕ затрагивает billing resolver behavior, billing FLD mappings, `/purchases`, migrations.

## 7. Runtime smoke (рекомендовано пользователю до закрытия)

Пользовательский ручной smoke:

1. Открыть пакет с ЮЛ "ЗАО «АЖУР инкам»".
2. В шаблоне item-а вставить `{{package.ul.FLD-000011}}` (краткое название).
3. Запустить генерацию → скачать DOCX.
4. Открыть DOCX → строка `ЗАО «АЖУР инкам»` присутствует, `{{...}}` отсутствует.
5. PDF создан, size > 0.

Если рендер показывает старое значение — пересохранить сессию (cache cleanup) и повторить.

## 8. Backlog (Sprint 3J-UI)

UI-паритет modifier controls для package-групп в `PlaceholdersCatalogTab.tsx`:
- сейчас package-секции показывают `«без модификаторов (Sprint 3E)»`;
- нужно подключить `RowSettingsCell` (text-kind → падежи; ul.org_form → доп. `format=long`);
- сделать тонкий `buildPackagePlaceholder(group, fld, format, case)`;
- copy-кнопка строит итоговый `{{package.ul.FLD-…|case=genitive}}`.

Backend уже поддерживает эти модификаторы — UI просто закроет паритет показа.

## 9. Closeout-gate (§13 плана)

**`package.ul.short_name` (FLD-000011, group=package_ul) === billing `customer.leg.short_name` formatter output:** ✅ доказано Deno-тестом «UL short_name: …(паритет с billing)» — assertEquals(pkg, billing) проходит. Sprint 3J **CLOSED по backend паритету**.
