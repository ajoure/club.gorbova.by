

да, согласен, с учетом правок:

1. Discovery подтверждаю: текущий `{{ln-XXXXXX}}` закрывает только ФИО/должность назначенного на роль физлица, но не даёт доступ к паспортным данным, адресу, дате рождения, личному номеру и другим полям этого же физлица. Значит, `PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1` нужен.
2. Whitelist sub-полей v1 подтверждаю. Включить сразу:
3. Multi-person scalar policy принимаю в безопасном варианте:
  - `full_name`, `short_name`, `signature_short`, `address_full` → можно join через `;` ;
  - паспортные данные, личный номер, даты, телефон, email, банк → НЕ join, а явная ошибка:
  ```text
  multiple_persons_for_scalar_role_subfield
  ```
  Причина: склеивать паспортные данные нескольких людей в один токен опасно и юридически некорректно.
4. `address_*` breakdown включить сразу в v1.
  &nbsp;
  Не откладывать только на `address_full`, потому что для документов часто нужны отдельные части адреса: город, улица, дом, квартира, индекс. Если `address_structured` содержит не все ключи — отсутствующее поле возвращает пустое значение/предупреждение по текущему контракту resolver, но токен должен существовать.
5. Table-repeat по списку участников НЕ включать в этот PATCH.
  &nbsp;
  Это отдельный Stage E/F, потому что там уже нужна логика повторения строк таблицы DOCX, а не просто scalar placeholder.
  В этом PATCH делаем только scalar role-scoped person placeholders:
6. Голый `{{ln-XXXXXX}}` не менять вообще.
  &nbsp;
  Текущая семантика остаётся:
  ```text
  {{ln-000015}}
  ```
  работает как раньше, чтобы не сломать существующие шаблоны.
7. Новый формат токенов утверждаю:
  &nbsp;
  ```text
  {{ln-XXXXXX.<sub_field>}}
  {{ln-XXXXXX.<sub_field>|case=genitive}}
  {{ln-XXXXXX.<sub_field>|format=dotted}}
  ```
  Примеры для роли «Участник»:
8. Форматы дат:
  &nbsp;
  Поддержать:
  ```text
  format=dotted   → 15.01.1990
  format=short    → 15.01.1990 / текущий короткий формат проекта
  format=full     → 15 января 1990 г.
  ```
  Если в проекте уже есть canonical date formatter — использовать его, не создавать второй.
9. `case=` поддерживать только для:
  - `full_name`;
  - `short_name`;
  - `signature_short`;
  - при технической готовности — `address_full`.
  Для паспорта, телефона, email, личного номера, банковских данных `case=` запрещён:
10. Unknown subfield должен давать явную ошибку/validation warning:

```text
ln_subfield_unknown:<field>
```

Не подставлять пустоту молча.

11. Если значение поля у физлица пустое, вернуть понятный код:

```text
ln_subfield_value_empty
```

При этом генератор не должен падать 500-ошибкой; это должна быть управляемая ошибка/предупреждение валидации шаблона.

12. В `PlaceholdersCatalogTab` нужно показать эти sub-fields именно внутри блока роли.

UI-логика:

- пользователь видит роль `Участник / ln-000015`;
- раскрывает её;
- видит список полей физлица этой роли;
- копирует готовый токен:

```text
{{ln-000015.passport_number_full}}
```

Это должно работать и в верхней вкладке «Плейсхолдеры», и в новой вкладке «Плейсхолдеры» внутри пакета, потому что используется один и тот же `PlaceholdersCatalogTab`.

13. Проверить strict token parser обязательно.

Если сейчас strict пропускает только `ln-\d{6}`, расширить его так, чтобы `ln-000015.passport_number_full` не считался invalid token. Без этого resolver будет готов, но генерация DOCX не пройдёт.

14. Добавить тест на реальном бизнес-сценарии «Список зарегистрированных лиц».

Минимум один DOCX/dry-run должен содержать:

```text
{{ln-000015.full_name}}
{{ln-000015.passport_number_full}}
{{ln-000015.personal_number}}
{{ln-000015.address_full}}
```

И proof должен показать, что данные берутся именно из физлица, назначенного на роль `Участник`, а не из `package.fl.*`.

15. В proof обязательно сравнить два namespace:

```text
{{package.fl.FLD-XXXXX}} — физлицо уровня пакета
{{ln-000015.passport_number_full}} — физлицо, назначенное на роль Участник в конкретном документе
```

Это важно, чтобы не было путаницы в каталоге.

16. В DoD добавить проверку отсутствия регрессии:

- старый `{{ln-000015}}` работает как раньше;
- старый `{{ln-000015|case=dative}}` работает как раньше;
- `{{package.fl.*}}` работает как раньше;
- `{{pf-*}}` работает как раньше;
- `recipient.*` из Stage C работает как раньше.

17. Proof-файл:

```text
.lovable/proofs/role_scoped_person_placeholders_v1.md
```

18. После реализации обновить архитектурную заметку:

```text
mem://architecture/documents/package-token-aliases-v1
```

Добавить отдельный раздел:

```text
Role-scoped person fields: ln-XXXXXX.<sub_field>
```

После этих правок можно выполнять PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1.

Отчет о выполнении discovery — role-scoped person placeholders

### 1. Что есть сейчас (факты из кода)

**Резолвер:** `supabase/functions/_shared/resolve-package-tokens.ts`, функция `resolveLnRoleToken` (строки 134–301).

Контракт текущего `{{ln-XXXXXX}}`:

- Регэксп: `/^ln-\d{6}$/` (строго 6 цифр, **без `.field`-суффикса**).
- SOT роли: `document_package_role_catalog.public_id`.
- SOT назначения: `document_package_item_role_assignments` (per-document, `package_template_item_id` обязателен).
- Из `legal_details_persons` читается **только `full_name**` (строка 262: `.select('id, full_name')`).
- Поддерживаются модификаторы: `|format=full|short|signature_short` и `|case=<RU>` (через `formatPersonName`).
- Multi-assignment: join через `'; '` (Sprint 3J-Roles).
- Output по умолчанию для toolbar-вставок: `"{{position}}, {{full_name}}"` (см. `output_template`).

**Каталог UI:** `src/utils/packagePlaceholderCatalog.ts` строки 569–620 (`PackageRolePlaceholder`) — экспонирует только базовый токен `{{ln-XXXXXX}}` + UI-модификаторы по ФИО/должности/разделителю. Никаких `.passport_*`, `.birth_date`, `.address` и т.п.

`**{{package.fl.FLD-XXXXXX}}**` — это namespace физлица, **выбранного на уровне всего пакета** (`document_package_sessions` → `client_legal_details` / `legal_details_persons` пакетного «владельца»), а не физлица, назначенного на конкретную роль документа. Для документа с несколькими ролями-физлицами или несколькими физлицами в одной роли он бизнес-задачу не решает.

### 2. Ответ на вопрос пользователя

**Не реализовано.** Сейчас невозможно из DOCX-шаблона взять паспорт/дату рождения/личный номер/адрес физлица, назначенного на конкретную роль документа. Доступно только ФИО (с падежами и форматами) через `{{ln-XXXXXX}}` и `{{ln-XXXXXX|case=...|format=...}}`.

В `legal_details_persons` все нужные колонки **уже физически существуют** и доступны через `person_id` назначения:

```
full_name, birth_date, personal_number,
passport_series, passport_number, passport_number_full,
passport_issued_by, passport_issued_date, passport_valid_until,
phone, email, address_structured (jsonb),
bank_account, bank_name, bank_code
```

Т.е. SOT уже есть — не хватает только resolver-ветки и каталога.

### 3. План PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1 (только discovery + scalar; repeat/table — out of scope)

**Цель:** добавить scalar role-scoped токены вида `{{ln-XXXXXX.<field>}}` с модификаторами `|case=`, `|format=` (для name) и `|format=full|short|dotted` (для дат), без изменения текущей семантики голого `{{ln-XXXXXX}}` и без трогания `{{package.fl.*}}` / `{{package.ul.*}}` / `{{package.ip.*}}` / `{{pf-XXXXXX}}`.

**Канонический формат токена**

```
{{ln-XXXXXX.<sub_field>}}
{{ln-XXXXXX.<sub_field>|case=genitive}}
{{ln-XXXXXX.<sub_field>|format=short}}
```

**Whitelist `<sub_field>` v1 (1:1 с колонками `legal_details_persons` + name-форматы):**


| sub_field                                                                                                                                                     | Источник                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `full_name`                                                                                                                                                   | full_name (= голый `{{ln-XXXXXX}}` без `position`) |
| `short_name`                                                                                                                                                  | производное от full_name (Иванов И. И.)            |
| `signature_short`                                                                                                                                             | производное от full_name (И. И. Иванов)            |
| `birth_date`                                                                                                                                                  | birth_date (формат через `                         |
| `personal_number`                                                                                                                                             | personal_number                                    |
| `passport_series`                                                                                                                                             | passport_series                                    |
| `passport_number`                                                                                                                                             | passport_number                                    |
| `passport_number_full`                                                                                                                                        | passport_number_full                               |
| `passport_issued_by`                                                                                                                                          | passport_issued_by                                 |
| `passport_issued_date`                                                                                                                                        | passport_issued_date                               |
| `passport_valid_until`                                                                                                                                        | passport_valid_until                               |
| `phone`                                                                                                                                                       | phone                                              |
| `email`                                                                                                                                                       | email                                              |
| `address_full`                                                                                                                                                | address_structured (склейка)                       |
| `address_city` / `address_street` / `address_house` / `address_building` / `address_apartment` / `address_region` / `address_postal_code` / `address_country` | address_structured->>'&nbsp;'                      |
| `bank_account` / `bank_name` / `bank_code`                                                                                                                    | bank_account / bank_name / bank_code               |


**Multi-assignment policy для scalar sub-field:**

- 0 активных → `role_assignment_missing` (как сейчас).
- 1 → значение.
- > 1 → join через `'; '` для `full_name`/`short_name`/`signature_short`/`address_full` (как уже для `{{ln-}}`).
- > 1 для других скаляров (паспорт/личный номер/даты/телефон/email/банк) → возвращать `multiple_persons_for_scalar_role_subfield` (без молчаливого join — это безопаснее: разные паспорта склеивать ; в один токен запрещено). UI каталога подсветит warning.
- Табличный repeat (по одному ряду на участника) — **отдельный backlog** (Stage E/F), здесь не делаем.

**Изменения в коде (backend, без миграций):**

1. `supabase/functions/_shared/resolve-package-tokens.ts`
  - Новый regex: `LN_SUB_RE = /^ln-(\d{6})\.([a-z_]+)$/`.
  - В `resolvePackageTokenCore` ветка `LN_SUB_RE` → новая `resolveLnRoleSubFieldToken(input, lnPublicId, subField, caseMod, formatMod)`.
  - Селект расширить до полного набора колонок `legal_details_persons`.
  - Whitelist sub_field → колонка/jsonb-path; неизвестное → `ln_subfield_unknown:<name>`.
  - Форматирование дат через существующий `DATE_FULL_FMT`/`DATE_SHORT_FMT` (+ `dotted` = `dd.MM.yyyy`).
  - `|case=` применяется только к name-полям и `address_*` (через `inflectRu`-совместимый layer, как у `formatPersonName`); для остальных — `config_error: ln_case_not_supported_for_subfield`.
  - Новые `code`-коды: `ln_subfield_unknown`, `ln_case_not_supported_for_subfield`, `multiple_persons_for_scalar_role_subfield`, `ln_subfield_value_empty`.
  - Голый `{{ln-XXXXXX}}` (без точки) **не меняется**.
2. `src/utils/packagePlaceholderCatalog.ts` + `supabase/functions/_shared/packagePlaceholderCatalog.ts`
  - Расширить `PackageRolePlaceholder` под сабтокены: per-role item получает массив `subFields[]` со списком `{ key, label, kind: 'text'|'date'|'name'|'address_jsonb', supportsCase }`.
  - Toolbar/вставка: для роли — выпадающий список «поле физлица» (ФИО / Паспорт серия / Паспорт номер / Дата рождения / …).
3. `src/components/ai-documents/PlaceholdersCatalogTab.tsx`
  - В блоке «Роли пакета» добавить per-role раскрытие со списком sub-fields и кнопкой копирования полного токена (`{{ln-000015.passport_number_full}}` и т.д.).
  - Зеркальная копия внутри `PackagesWorkspace` уже использует тот же компонент — отдельных правок UI не нужно.
4. `supabase/functions/_shared/resolve-package-tokens.smoke.test.ts` / `.pf.test.ts`
  - Кейсы: known subfield (1 person) / unknown subfield / multi-person scalar → `multiple_persons_for_scalar_role_subfield` / multi-person name → join / date format / case modifier для name / case на passport_number → `ln_case_not_supported_for_subfield`.
5. `canonical-document-generate-strict`: проверить, что strict-парсер пропускает `ln-XXXXXX.<name>` (один из вариантов — расширить токен-регэксп; иначе уже сейчас может зарезаться как `invalid_legacy_role_placeholder`). Подтвердить тестом в `__tests__/snapshot_builder_smoke.test.ts`.

**Что НЕ делаем в этом PATCH:**

- Никаких новых таблиц / FLD / миграций.
- Не трогаем `{{ln-XXXXXX}}` (голая форма), `{{pf-}}`, `{{package.ul|ip|fl.*}}`, биллинговые `{{field:FLD-...}}`.
- Не реализуем table-repeat по нескольким назначенным физлицам — это Stage E (per-row generation).
- Не меняем `output_template` ролей.

**DoD:**

- В шаблоне работает `{{ln-000015.passport_number_full}}`, `{{ln-000015.birth_date|format=dotted}}`, `{{ln-000015.address_city}}`, `{{ln-000015.full_name|case=genitive}}`.
- Каталог плейсхолдеров (и его копия внутри пакета) показывает sub-fields для каждой роли с copy-кнопкой.
- Strict generator успешно резолвит на реальном пакете; неизвестный sub_field даёт явный warning, не падает.
- Multi-person scalar (не name/address) даёт `multiple_persons_for_scalar_role_subfield`, а не молчаливый join.
- Smoke + pf-тесты резолвера и snapshot_builder проходят.
- Proof: `.lovable/proofs/role_scoped_person_placeholders_v1.md` с реальным dry-run по существующему пакету (например, `06068dcf-…`).
- `mem://architecture/documents/package-token-aliases-v1` дополнен записью о новом sub-namespace `ln-XXXXXX.<field>`.

### 4. Open questions (нужны до старта реализации)

1. Подтвердить whitelist sub-полей v1 (выше) — добавить/убрать что-то?
2. Multi-person scalar для паспорта/телефона/email — гарантируем ошибку `multiple_persons_for_scalar_role_subfield` (рекомендация), или всё-таки join через `;` ?
3. Реализуем сразу `address_*`-breakdown из `address_structured` jsonb или v1 только `address_full` (строка), а breakdown — отдельный Sprint?
4. Нужен ли в v1 уже table-repeat по списку участников (один ряд на физлицо) или это явный Stage E?