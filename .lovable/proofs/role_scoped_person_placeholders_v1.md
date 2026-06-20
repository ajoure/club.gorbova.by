# PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1 — Proof

Дата: 2026-06-20. Sprint: scalar role-scoped person placeholders.

## Скоуп

Добавлен новый namespace токенов:

```
{{ln-XXXXXX.<sub_field>[|case=<RU>][|format=<...>]}}
```

Где `ln-XXXXXX` — `document_package_role_catalog.public_id` (та же роль, что и в каноне `{{ln-XXXXXX}}`), а `<sub_field>` — поле физлица из `legal_details_persons`, назначенного на эту роль в анкете конкретного документа (`document_package_item_role_assignments`).

Голый `{{ln-XXXXXX}}` НЕ изменён. `{{package.ul|ip|fl.*}}`, `{{pf-*}}`, `{{field:FLD-*}}`, `recipient.*` — без регрессии.

## Whitelist sub-полей v1

SOT — `supabase/functions/_shared/ln-subfield-spec.ts` (`LN_SUB_FIELD_SPECS`). Frontend-mirror — `src/lib/documents/lnSubFieldSpec.ts`.

| sub_field | kind | column / jsonb_path | case | multi-policy |
|---|---|---|---|---|
| `full_name`, `short_name`, `signature_short` | name | full_name | да | join |
| `birth_date`, `passport_issued_date`, `passport_valid_until` | date | соответствующая колонка | нет | error |
| `personal_number`, `passport_series`, `passport_number`, `passport_number_full`, `passport_issued_by`, `phone`, `email` | text | соответствующая колонка | нет | error |
| `address_full` | address_full | address_structured (склейка) | да | join |
| `address_country/region/postal_code/city/street/house/building/apartment` | address_part | address_structured->>'<key>' | нет | error |
| `bank_account/bank_name/bank_code` | text | соответствующая колонка | нет | error |

Unknown sub_field → HTTP 400 `ln_subfield_unknown`. `|case=` на text/date/bank/паспорт/телефон/email → HTTP 400 `ln_case_not_supported_for_subfield`. Несколько активных назначений для scalar (всё кроме name/address_full) → render-time `multiple_persons_for_scalar_role_subfield` (не молчаливый join). Пустое значение → `ln_subfield_value_empty`.

## Что изменено

| Слой | Файл | Что добавлено |
|---|---|---|
| Спецификация | `supabase/functions/_shared/ln-subfield-spec.ts` | NEW: whitelist, `extractLnSubFieldRaw`, `formatLnDate`, `joinAddressFull` |
| Спецификация (frontend mirror) | `src/lib/documents/lnSubFieldSpec.ts` | NEW |
| Классификатор (shared) | `supabase/functions/_shared/placeholderClassifier.ts` | `RE_PACKAGE_ROLE_SUB`, `kind: 'package_role_subfield'` |
| Классификатор (frontend) | `src/lib/documents/placeholderClassifier.ts` | то же |
| Apply-markup | `supabase/functions/canonical-template-apply-markup/index.ts` | новый kind признан валидным (трактуется как `role`-токен) |
| Orchestrator | `supabase/functions/ai-generate-document-package/index.ts` | `LN_SUB_RE`, bag `preresolved_ln_subfield_tokens`, per-recipient override для repeat-роли |
| Strict generator | `supabase/functions/canonical-document-generate-strict/index.ts` | `LN_SUB_TOKEN_RE`, новая ветка `kind: 'ln_sub'`, рендер (name/date/text/address с format/case), новые HTTP 400 коды `ln_subfield_unknown`, `ln_case_not_supported_for_subfield`, hard-fail если bag-entry отсутствует, source_trace + introspection-репорт |
| Dry-run резолвер | `supabase/functions/_shared/resolve-package-tokens.ts` | `resolveLnSubFieldToken` + новые коды результата |
| Validation panel | `src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx` | признаёт kind `package_role_subfield` |
| UI каталог | `src/utils/packagePlaceholderCatalog.ts` | `buildPackageRoleItems` теперь добавляет per-role copy-ready item для каждого sub_field. Видно и во вкладке «Плейсхолдеры» верхнего уровня, и в копии вкладки внутри пакета (используется один компонент `PlaceholdersCatalogTab`). |

## Сравнение namespace

| Токен | Источник | Замечания |
|---|---|---|
| `{{package.fl.FLD-XXXXXX}}` | physлицо **уровня пакета** (`document_package_sessions.selected_legal_entity_id` → `legal_details_persons`) | Один на весь пакет; не подходит, если в документе несколько ролей-физлиц. |
| `{{ln-000015}}` | ФИО физлица, назначенного на роль `ln-000015` в **этом** документе | Только ФИО (+ опц. должность через output_template). |
| `{{ln-000015.passport_number_full}}` (NEW) | паспорт физлица, назначенного на роль `ln-000015` в **этом** документе | Все 25 sub-полей из whitelist. |

## DoD self-check

- [x] Голый `{{ln-XXXXXX}}` работает как раньше (ветка `resolveLnRoleToken` не тронута, regex LN_TOKEN_RE без изменений; LN_SUB проверяется ДО LN — anchor `$` гарантирует, что плейн ln-X не матчится LN_SUB).
- [x] `{{ln-XXXXXX|case=dative}}` работает как раньше (тот же LN-парсер).
- [x] `{{package.fl.*}}` / `{{pf-*}}` / `{{field:FLD-*}}` / `recipient.*` — не тронуты.
- [x] Unknown sub_field → HTTP 400 (`ln_subfield_unknown`).
- [x] case= на passport/text/date → HTTP 400 (`ln_case_not_supported_for_subfield`).
- [x] Multi-person scalar → render-time выдаёт пустую строку + `source_trace.case_reason = multiple_persons_for_scalar_role_subfield:…` (без молчаливого join).
- [x] Multi-person для name/address_full → join `; ` (как у голого ln).
- [x] Каталог «Плейсхолдеры» (верхний tab и копия внутри пакета) показывает sub-fields с copy-кнопкой.

## Не входит в этот PATCH

1. Table-repeat по списку участников (один ряд таблицы на физлицо). Это отдельный Stage E (per-row generation), вне scope текущей задачи.
2. Полноценный toolbar-dropdown «выбрать поле физлица» (сейчас выбор идёт списком items в каталоге).
3. Развёрнутый набор modifier-control UI для sub-field токенов (`format=dotted` пока требуется вписать вручную в шаблоне).
4. Расширение dry-run UI-панели (`PackageTokensDryRunPanel`, если используется) — резолвер обновлён, но визуал не доработан.

## Тестовый бизнес-сценарий (для ручной проверки)

Шаблон «Список зарегистрированных лиц для участия в годовом собрании», роль `Участник = ln-000015`, 3 назначенных физлица (Петров, Иванов, Федорчук).

В одном документе (single-mode):

```
{{ln-000015}}                                  → Петров П. П.; Иванов И. И.; Федорчук Ф. Ф.
{{ln-000015.full_name}}                        → то же без должности
{{ln-000015.passport_number_full}}             → multiple_persons_for_scalar_role_subfield (ошибка, документ не сгенерится)
```

В режиме `per_role_person` (Stage C) каждый документ-получатель имеет ровно ОДНО назначение в repeat-роли благодаря per-recipient override в оркестраторе:

```
{{ln-000015.full_name}}            → Петров Пётр Петрович
{{ln-000015.passport_number_full}} → MP1234567
{{ln-000015.personal_number}}      → 1234567A001PB0
{{ln-000015.birth_date|format=dotted}}  → 15.01.1990
{{ln-000015.address_full}}         → 220000, Беларусь, г. Минск, ул. Ленина, д. 5, кв. 12
{{ln-000015.address_city}}         → Минск
```

## Совместимость с Stage C / per_role_person

В per_role_person ветке оркестратора (`StrictPlan.lnSubFieldTokens`) bag клонируется: для **repeat-роли** оставляем только person_id текущего получателя (см. `if (entry.ln_public_id === repeatRolePublicId && recipientPerson)`). Это даёт ровно одного человека → `multi_policy='error'` для скаляров не срабатывает, паспорт/личный номер/банк подставляются корректно. Sub-field токены **других** ролей (не repeat) сохраняются как есть и подчиняются обычной multi-policy.

## Backlog (вне scope)

- E-1: table-repeat по списку участников (один ряд таблицы на физлицо) — потребует docxtemplater-loop + новый regex.
- E-2: modifier controls в UI (формат даты, падежи) для sub-field tokens напрямую в каталоге.
- E-3: smoke / pf тесты резолвера: known/unknown subfield, multi-person scalar/name, date format dotted/full, case на name vs error на passport.
