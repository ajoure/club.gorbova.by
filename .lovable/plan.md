# да, согласен, с учетом правок:

&nbsp;

1. **Canonical key = только namespace-key, без cf.* внутри key**
  Зафиксировать 4 уровня строго:
  &nbsp;
  - internal id: uuid
  - canonical key: [meeting.notice.date](http://meeting.notice.date)
  - system token: {{[meeting.notice.date](http://meeting.notice.date)}}
  - UI token: [Дата направления извещения]
    Не смешивать key и transport/token format.
    cf.person.FLD-XXXXXX — это не canonical key, а legacy/transport layer. Иначе потом снова будет путаница.
  &nbsp;
2. **Registry-first делать не через fields_registry “как есть”, а через единый token registry layer поверх него**
  Потому что текущий fields_registry уже ориентирован на custom fields и public_id, а документы потребуют:
  &nbsp;
  - computed tokens
  - package/document scoped tokens
  - arrays/loops
  - role-context tokens
    Поэтому: reuse fields_registry, но ввести единый слой token_catalog / view / service contract, где source может быть:
  - registry field
  - computed
  - package field
  - document field
  - loop item field
    Иначе fields_registry начнет хранить сущности разной природы без четкой модели.
  &nbsp;
3. **Не делать entity_person.signer_full_name и подобные role-specific permanent keys**
  Это неверный уровень абстракции.
  Правильно:
  &nbsp;
  - базовые данные: person.full_name
  - связь: entity_person.position.label, entity_person.share_percent
  - package-role selection: package.signer.person.full_name, package.chairperson.person.full_name, package.secretary.person.full_name
    Иначе один и тот же человек/линк будет плодить много “спец-ключей”.
  &nbsp;
4. **Обязательно добавить отдельный scope для package roles**
  В плане не хватает явного namespace:
  &nbsp;
  - package.signer.*
  - package.chairperson.*
  - package.secretary.*
  - package.participants[]
  - package.attendees[]
  - package.invited[]
    Это нужно, потому что роли в конкретном собрании не равны постоянным ролям в компании.
  &nbsp;
5. **Loops/arrays надо заложить сразу в registry/schema**
  Для 4 документов пакета это критично. Нужны массивы:
  &nbsp;
  - package.participants[]
  - package.registered_persons[]
  - agenda.items[]
  - decisions.items[]
  - board_candidates[]
  - auditor_candidates[]
    Для каждого массива нужен item-schema с canonical keys. Без этого протокол и список зарегистрированных опять уйдут в ad-hoc.
  &nbsp;
6. **settlement_display поддерживаю, но нужен полный адресный стандарт**
  Добавить computed/address keys:
  &nbsp;
  - entity.settlement.type.short
  - [entity.settlement.name](http://entity.settlement.name)
  - entity.settlement.display
  - [entity.address.legal](http://entity.address.legal).full
  - meeting.location.full
  - [meeting.review](http://meeting.review).location.full
    Иначе позже снова появятся разрозненные city, address, location_text.
  &nbsp;
7. **Compatibility layer делать с явным deprecation plan**
  Не просто “оставить старые ad-hoc ключи”, а:
  &nbsp;
  - Phase A: dual resolve old + canonical
  - Phase B: лог/диагностика использования legacy tokens
  - Phase C: отчет, какие шаблоны еще сидят на legacy
  - Phase D: только после миграции отключение legacy
    Иначе compatibility останется навсегда.
  &nbsp;
8. **Token picker не только extraTokenGroups, а единый source adapter**
  Лучше не прокидывать руками группы в каждый вызов.
  Нужен режим:
  &nbsp;
  - context="messages"
  - context="documents"
  - context="documents:annual_meeting"
    А уже внутри picker грузит разрешенные группы через registry/service. Это масштабируемее и не расползется по UI.
  &nbsp;
9. **Нужен mandatory duplicate guard по 3 уровням**
  Перед созданием нового token:
  &nbsp;
  - exact key duplicate
  - same system token duplicate
  - fuzzy label/search duplicate
    Если найден existing — create запрещать, только reuse/alias decision.
  &nbsp;
10. **Для документов обязателен snapshot не только values, но и token resolution manifest**
  В document_generation_snapshots сохранять:

&nbsp;

&nbsp;

&nbsp;

- placeholder_data_snapshot
- token_manifest_snapshot
- template_version
- registry_version
- warnings_snapshot
- source_trace по ключевым полям
  Это нужно, чтобы потом понимать, из какого именно поля/вычисления взялось значение.

&nbsp;

&nbsp;

&nbsp;

11. **Validation schema отделить от token schema**
  Нужны 2 разные структуры:

&nbsp;

&nbsp;

&nbsp;

- placeholder_schema_jsonb — что есть и откуда берется
- validation_schema_jsonb — правила, severity, legal reference, message, popup text
  Не смешивать это в одной плоской модели.

&nbsp;

&nbsp;

&nbsp;

12. **Для годового собрания добавить reusable defaults на entity level**
  Поддержать defaults в карточке юрлица:

&nbsp;

&nbsp;

&nbsp;

- default notice method
- default meeting location
- default review location
- default signer
- default agenda preset
- default governance flags
  И кнопку: **сбросить к дефолтам юрлица**.

&nbsp;

&nbsp;

&nbsp;

13. **Отдельно зафиксировать русские UI labels как editable display layer**
  Canonical key должен быть стабильным, а UI label можно менять без поломки шаблонов.
  Значит:

&nbsp;

&nbsp;

&nbsp;

- key immutable
- UI label editable
- aliases/search keywords editable
- token string derived from key

&nbsp;

&nbsp;

&nbsp;

14. **В DoD добавить обязательный proof по square-bracket flow**
  Нужно доказать:

&nbsp;

&nbsp;

&nbsp;

- [Русское название] в UI
- хранение system token
- render chip/preview
- reuse в document editor без нового picker
  Это один из ключевых reuse-proof.

&nbsp;

&nbsp;

&nbsp;

15. **Для 4 документов пакета сразу требовать общий master registry matrix**
  До execute нужен артефакт:

&nbsp;

&nbsp;

&nbsp;

- key
- UI label
- source scope
- reusable scope
- data type
- computed/manual/db
- document usage (1/2/3/4)
- loop/scalar
- validation rules
  Без этой матрицы дальше будет хаос.

&nbsp;

&nbsp;

Итог: англоязычные namespace-ключи вида [meeting.notice.date](http://meeting.notice.date) утверждаем как canonical standard; русские названия оставляем только для UI в квадратных скобках.

&nbsp;

PATCH 1 — Canonical Token Standard + PATCH 2 — Reuse Existing Picker

## Текущее состояние (подтверждено кодом)

### Existing token picker

- **Компонент:** `TokenizedRichInput.tsx` (857 строк, TipTap-based)
- **Триггер:** `[` открывает dropdown, `[[` вставляет литерал
- **Группы в picker (hardcoded):** «Контакт / Профиль» (6 токенов), «Дата / Время» (9), «Продукт» (динамическая из `fields_registry`)
- **SoT хранения:** `{{tokenString}}` — UI показывает chip с русским label

### Existing registry

- `fields_registry` таблица с `entity_type` = `product` | `legal_details`
- ~50 `legal_details.*` ключей в `LEGAL_DETAILS_FIELD_MAP`
- `public_id` (FLD-*) → canonical token `{{cf.legal_details.FLD-XXXXXX}}`

### Gap: DOCX tokens полностью ad-hoc

- `ai-generate-document/index.ts` строки 214-286: hardcoded `tokenData` с ключами `entity_name`, `person_full_name`, `signer.full_name`, `link.role_label` и т.д.
- Эти ключи **не зарегистрированы** в `fields_registry`
- Picker **не подключён** к AI-документам
- Нет `person.*`, `entity_person.*`, `meeting.*`, `document.*` entity_types

---

## План выполнения

### Шаг 1: Зафиксировать canonical naming standard (документ + код)

**Правило registry-first:**

1. Перед созданием нового токена — поиск existing key в `fields_registry`
2. Existing `legal_details.*` ключи **не дублировать** — reuse 1:1
3. Новые namespace только для scope, которых нет:

```text
Новые entity_type в fields_registry:
  person           → person.full_name, person.passport_series, ...
  entity_person    → entity_person.share_percent, entity_person.position, ...
  meeting          → meeting.date, meeting.notice.date, ...
  document         → document.number, document.date, ...
  package          → package.report_year, ...
  agenda           → agenda.item_number, agenda.title, ...
  decision         → decision.text, decision.result, ...
  attendance       → attendance.registration_date, ...
```

**Маппинг existing ad-hoc → registry:**


| Ad-hoc ключ в DOCX         | Existing registry key                                   | Действие                                    |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| `entity_name`              | `legal_details.leg_name` / `ent_name` / `ind_full_name` | Reuse existing, добавить computed alias     |
| `entity_unp`               | `legal_details.leg_unp` / `ent_unp`                     | Reuse existing                              |
| `entity_address`           | `legal_details.leg_address` / `ent_address`             | Reuse existing                              |
| `entity_bank`              | `legal_details.bank_name`                               | Reuse existing                              |
| `entity_bank_code`         | `legal_details.bank_code`                               | Reuse existing                              |
| `entity_account`           | `legal_details.bank_account`                            | Reuse existing                              |
| `entity_phone`             | `legal_details.phone`                                   | Reuse existing                              |
| `entity_email`             | `legal_details.email`                                   | Reuse existing                              |
| `entity_director`          | `legal_details.leg_director_name`                       | Reuse existing                              |
| `entity_director_position` | `legal_details.leg_director_position`                   | Reuse existing                              |
| `entity_acts_on_basis`     | `legal_details.leg_acts_on_basis`                       | Reuse existing                              |
| `entity_org_form`          | `legal_details.leg_org_form`                            | Reuse existing                              |
| `person_full_name`         | — (нет в registry)                                      | **Новый:** `person.full_name`               |
| `person_passport_series`   | —                                                       | **Новый:** `person.passport_series`         |
| `signer.full_name`         | —                                                       | **Новый:** `entity_person.signer_full_name` |
| `link.role_label`          | —                                                       | **Новый:** `entity_person.role_label`       |
| `link.share_percent`       | —                                                       | **Новый:** `entity_person.share_percent`    |
| `document_number`          | —                                                       | **Новый:** `document.number`                |
| `document_date`            | —                                                       | **Новый:** `document.date`                  |


**Computed placeholders (source_strategy = computed):**

- `entity.name` — выбирается по `client_type` из `leg_name`/`ent_name`/`ind_full_name`
- `entity.settlement_display` — тип н.п. + название (г. Минск, аг. Лесная)
- `person.initials` — вычисляется из `person.full_name`
- `entity.director_short` — вычисляется из `leg_director_name`

### Шаг 2: Migration — seed новых entity_types в `fields_registry`

SQL migration (add-only):

- INSERT ~25 записей для `person.*` (full_name, birth_date, passport_*, phone, email, address)
- INSERT ~8 записей для `entity_person.*` (role_label, position, share_percent, acts_on_basis, signer_*)
- INSERT ~3 записей для `document.*` (number, date, date_short)
- INSERT ~10 записей для `meeting.*` (date, time, location, notice.date, notice.method, ...)
- Для computed fields: `options` JSONB с `{"source_strategy": "computed", "compute_from": "..."}`
- Каждая запись получает `public_id` (FLD-*), `label` (русский), `data_type`, `display_order`
- **Existing `legal_details.*` записи НЕ трогаем**

### Шаг 3: Расширить `tokenRegistry.ts` — загрузка новых групп

Добавить функции-загрузчики по аналогии с `loadProductFields()` / `loadLegalDetailsFields()`:

- `loadPersonFields()` — entity_type = 'person'
- `loadEntityPersonFields()` — entity_type = 'entity_person'
- `loadDocumentFields()` — entity_type = 'document'
- `loadMeetingFields()` — entity_type = 'meeting'

Добавить соответствующие кэши и обновить `tokenStringToLabel()`.

### Шаг 4: Расширить `TokenizedRichInput` — новые группы в picker

**Не создавать новый компонент.** Добавить prop:

```typescript
interface TokenizedRichInputProps {
  // ...existing props...
  /** Additional token groups to show (e.g. for document editors) */
  extraTokenGroups?: Array<{
    heading: string;
    tokens: TokenDef[];
  }>;
}
```

В picker dropdown (строки 814-843) после existing групп рендерить `extraTokenGroups`:

```tsx
{extraTokenGroups?.map(group => (
  group.tokens.length > 0 && (
    <CommandGroup heading={group.heading} key={group.heading}>
      {group.tokens.map(t => (
        <CommandItem key={t.key} value={t.searchKeywords} ...>
          <span>{t.label}</span>
          <Badge>{t.badge}</Badge>
        </CommandItem>
      ))}
    </CommandGroup>
  )
))}
```

Существующие вызовы `TokenizedRichInput` (Telegram/email) **не меняются** — у них нет `extraTokenGroups`, поведение идентичное.

### Шаг 5: Compatibility layer в DOCX resolver

В `ai-generate-document/index.ts` и `ai-generate-document-package/index.ts`:

1. Оставить existing ad-hoc tokenData mapping как compatibility layer
2. Добавить **параллельно** маппинг canonical keys: `tokenData["legal_details.leg_name"] = tokenData.entity_name`
3. Docxtemplater получает объединённый tokenData — старые DOCX шаблоны с ad-hoc ключами продолжают работать, новые шаблоны используют canonical keys

Это gradual migration: old templates работают, new templates используют registry tokens.

---

## Файлы, которые меняются


| Файл                                                       | Что                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `src/lib/tokens/tokenRegistry.ts`                          | +4 loader функции, +4 кэша, обновить `tokenStringToLabel` |
| `src/components/admin/TokenizedRichInput.tsx`              | +prop `extraTokenGroups`, +рендер в picker dropdown       |
| `supabase/functions/ai-generate-document/index.ts`         | +canonical key aliases в tokenData                        |
| `supabase/functions/ai-generate-document-package/index.ts` | +canonical key aliases в tokenData                        |
| SQL migration                                              | INSERT ~46 записей в `fields_registry`                    |


## Что НЕ меняется

- Existing `legal_details.*` записи в `fields_registry`
- Existing `LEGAL_DETAILS_FIELD_MAP`
- Existing `token-resolver.ts`
- Existing DOCX шаблоны (compatibility layer)
- Existing Telegram/email использование `TokenizedRichInput`
- `generate-from-template` (protected billing flow)
- `buildContactUrl`, `client_legal_details` schema

## DoD

1. Registry-first rule задокументирован в коде (JSDoc в tokenRegistry)
2. `fields_registry` содержит новые entity_types: person, entity_person, document, meeting
3. Existing `legal_details.*` записи не задублированы
4. Picker показывает новые группы через `extraTokenGroups`
5. Новый picker компонент **не создан**
6. Existing DOCX шаблоны работают через compatibility layer
7. Новые шаблоны могут использовать canonical `{{cf.person.FLD-XXXXXX}}` tokens
8. `settlement_display` зарегистрирован как computed placeholder