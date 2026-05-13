# Да, согласен, с учетом правок:

```text
Да, план v3 в целом соответствует задаче: плейсхолдеры должны быть приведены к UI-реквизитам, с явным разделением Заказчик/Исполнитель + ФЛ/ЮЛ/ИП, с сохранением динамических customer.* / executor.* и backward-compatible aliases.

Перед execute дополни и уточни следующие пункты:

## 1. Сначала только dry-run v3, без execute

Execute не начинать, пока не будет показан полный dry-run:

- список всех новых token_key;
- список всех old_label → new_label;
- список aliases;
- список soft-deprecated дублей;
- список полей UI, которым не найден token_key;
- список token_key, которым не найдено UI-поле;
- отдельная таблица по ИП без кавычек.

Формат dry-run обязателен:

| UI section | UI field label | DB path | token_key | old_label | new_label | action | comment |

После dry-run остановиться и ждать подтверждения.

## 2. Уточнить counts: сейчас в плане есть арифметическая ошибка

В блоке «Заказчик ФЛ» написано «24 токена», но перечислено больше 24, если считать банк/телефон/email/адресные части.

Нужно не писать примерные counts, а посчитать фактически по UI и DB.

DoD dry-run:
- count по каждому блоку считается автоматически из таблицы mapping;
- если count в тексте отличается от mapping — исправить текст;
- не использовать `≈`, только точные цифры.

## 3. Руководитель / подписант — правильно, но нужно закрепить терминологию

Оставить так:

### Руководитель
Это основной блок реквизитов лица, которое подписывает документ от имени стороны.

Для ЮЛ и ИП обязательно:

- Руководитель должность
- Руководитель ФИО
- Руководитель ФИО кратко
- Руководитель действует на основании

Важно: не использовать label «Директор», кроме случаев, где это фактическое значение поля. Название плейсхолдера должно быть «Руководитель».

### Подписант
`*.signer.*` не удалять и не мержить.

Это отдельный override-слой, если подписант задан отдельно от реквизитов.

Labels:
- Заказчик подписант: Должность
- Заказчик подписант: ФИО
- Заказчик подписант: ФИО кратко
- Заказчик подписант: Действует на основании

И зеркально для исполнителя.

## 4. ИП — руководитель обязателен

Пункт в плане правильный: у ИП должен быть блок руководителя/подписанта.

Уточнить логику:

- по умолчанию:
  - `customer.ent.director_position` = `Индивидуальный предприниматель`;
  - `customer.ent.director_full_name` = ФИО ИП;
  - `customer.ent.director_short_name` = краткое ФИО ИП;
  - `customer.ent.acts_on_basis` = значение из реквизитов ИП;

- пользователь может вручную заменить:
  - должность;
  - ФИО;
  - краткое ФИО;
  - основание полномочий.

Это нужно для случаев представителя по доверенности.

## 5. ИП без кавычек — обязательно

В плане правильно указано, но нужно усилить DoD:

Неправильно:
- `ИП "Федорчук Сергей Валерьевич"`

Правильно:
- `ИП Федорчук Сергей Валерьевич`

Проверить все места:
- preview в UI;
- document render;
- DOCX/PDF;
- example_value;
- picker/catalog;
- autocomplete/token preview;
- smoke output.

Кавычки допускаются только для названия ЮЛ, но не для ФИО ИП.

## 6. Не добавлять новые физические колонки ради ИП-руководителя

В плане написано: `legal_entities_requisites.data` jsonb, без миграции колонок — это правильно.

Уточнить STOP:

- не добавлять новые SQL-колонки под `ent_director_*`;
- хранить override ИП-руководителя в существующем jsonb/data/meta-слое;
- если UI ещё не имеет этих полей — добавить UI-секцию, но запись делать в jsonb.

## 7. Проверить фактические источники таблиц

В плане местами смешаны названия:

- `client_legal_details`;
- `legal_entities_requisites`;
- `individual_requisites`;
- `legal_details`.

Перед execute нужно точно определить, какие таблицы реально являются SOT в текущем проекте.

Dry-run должен содержать отдельный блок:

| Entity | Actual table | Actual JSON path / columns | Used by renderer | Used by UI |

Без этого нельзя делать массовую нормализацию.

## 8. Alias-механизм — использовать существующий `document_token_aliases`

Не добавлять `alias_of` в `document_token_registry`, если уже есть рабочая таблица `document_token_aliases`.

В плане это в целом соблюдено, но в разделе «Code changes» не должно появляться нового alias-механизма.

Правило:
- canonical token — в `document_token_registry`;
- backward-compatible alias — в `document_token_aliases`;
- старый token не удалять hard-delete;
- duplicate — только `archived_at` / `archive_reason` + alias.

## 9. Soft-delete шаблонов — можно делать в этом же спринте, но отдельно от токенов

Soft-delete шаблонов логически отдельный блок. Чтобы не смешать риски, выполнить в порядке:

1. dry-run placeholders;
2. soft-delete migration + code guards;
3. placeholders migration;
4. resolver/code changes;
5. smoke.

Если soft-delete даёт ошибку — не блокировать нормализацию плейсхолдеров, но указать в отчёте.

## 10. Каталог плейсхолдеров: группировка должна быть пользовательской, не технической

В UI не показывать группы как `customer.ind.*`.

Показывать группы:

- Заказчик ФЛ
- Заказчик ЮЛ
- Заказчик ИП
- Исполнитель ФЛ
- Исполнитель ЮЛ
- Исполнитель ИП
- Динамические поля
- Подписант
- Системные / Документ / Оплата / Сделка — если они уже есть

Внутри группы label без лишнего повторения можно делать так:
- группа: `Заказчик ФЛ`
- поле: `Паспорт серия`

Но если поле отображается вне группы или в поиске, full label должен быть:
- `Заказчик ФЛ: Паспорт серия`

DoD:
- поиск по «Заказчик ФЛ паспорт» находит нужное поле;
- поиск по «ИП руководитель доверенность» находит `customer.ent.acts_on_basis`;
- поиск по «Исполнитель ЮЛ расчетный счет» находит нужный токен.

## 11. Smoke должен покрывать 3 типа плательщика

Правильно указано, но нужно добавить конкретные проверки:

### ФЛ
- ФИО;
- паспорт серия;
- паспорт номер;
- паспорт серия и номер;
- адрес полный;
- банк/IBAN.

### ЮЛ
- название;
- форма собственности;
- УНП;
- руководитель должность;
- руководитель ФИО;
- действует на основании;
- адрес полный;
- банк/IBAN.

### ИП
- `ИП Федорчук Сергей Валерьевич` без кавычек;
- УНП;
- руководитель автозаполнен данными ИП;
- override руководителя работает;
- основание полномочий может быть доверенность.

## 12. Полный адрес

Проверить, что есть и работают оба уровня:

- `customer.ind.address.full`
- `customer.leg.address.full`
- `customer.ent.address.full`
- `executor.ind.address.full`
- `executor.leg.address.full`
- `executor.ent.address.full`
- динамические:
  - `customer.address.full`
  - `executor.address.full`

Формат для Беларуси:
`ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь`

Для Минска не добавлять:
- район города;
- район;
- область.

## 13. Что нельзя делать

Добавить явно:

- не удалять production-шаблоны;
- не менять существующие token_key без alias;
- не делать hard-delete токенов;
- не ломать старые шаблоны;
- не менять `payments_v2`;
- не менять `orders_v2 schema`;
- не менять `allocate_document_number`;
- не менять document scenarios;
- не трогать Contact Center picker;
- не добавлять морфологию в этот спринт.

## 14. Итоговая команда

После этих правок план можно запускать только в режиме:

1. `Discovery v3 dry-run`
2. показать summary;
3. остановиться;
4. ждать подтверждения execute.
```

Ключевое: **план правильный по направлению**, но перед execute обязательно нужен новый dry-run v3 с точными counts и фактической сверкой UI ↔ DB ↔ token_key. Сейчас нельзя запускать массовые INSERT/UPDATE только по текстовому списку.

&nbsp;

План: нормализация плейсхолдеров с привязкой к ФЛ/ЮЛ/ИП (PLACEHOLDERS-NORMALIZATION-2026-05-13 v3)

Перерабатываем dry-run и порядок execute с учётом всех замечаний: per-type labels (ФЛ/ЮЛ/ИП), сохранение блока «Руководитель/Подписант» для ЮЛ и ИП, три отдельных паспортных поля, формат ИП без кавычек.

## Этап 1. Discovery v2 — UI ↔ token mapping (обязательно перед execute)

Источники UI (read-only):

- `src/components/settings/IndividualDetailsForm.tsx` — ФЛ
- `src/components/settings/OrganizationDetailsForm.tsx` — ЮЛ + ИП (через `subject_type`)
- `src/lib/requisites-v2/fieldMap.ts` — `LEGAL_ENTITY_CANONICAL_KEYS`, `ENTREPRENEUR_CANONICAL_KEYS`, `INDIVIDUAL_CANONICAL_KEYS`
- `src/components/admin/DealPayerDocumentsCard.tsx` — карточка плательщика
- `fields_registry` — 47 строк уже выгружено

Артефакт: `.lovable/proofs/placeholders_normalization_v3_dryrun_2026_05_13.md`. Единая таблица:

```
| UI section | UI field label | DB path | token_key (new) | token_key (legacy/alias) | new_label | action |
```

Семь блоков: Заказчик ФЛ / ЮЛ / ИП, Исполнитель ФЛ / ЮЛ / ИП, динамические верхнеуровневые `customer.*`/`executor.*`.

DoD: каждое UI-поле имеет ровно один canonical token_key; каждый существующий `customer.*`/`executor.*` либо переименован, либо помечен как dynamic, либо soft-deprecated с alias.

## Этап 2. Архитектура token namespaces

Типизированные namespaces параллельно с динамическими:

- `customer.ind.*` / `customer.leg.*` / `customer.ent.*`
- `executor.ind.*` / `executor.leg.*` / `executor.ent.*`

Динамические `customer.name`, `customer.address`, `customer.bank`, `customer.account`, `customer.bank_code`, `customer.unp`, `customer.acts_on_basis`, `customer.address.full` (+ executor) остаются — резолвятся по `payer_type`.

**Labels-конвенция:**

- Типизированный: `«Заказчик ФЛ: Паспорт серия»`
- Динамический: `«Заказчик: Название / ФИО по типу плательщика»`

## Этап 3. Карта labels (полная, с обновлёнными counts)

### Заказчик ФЛ (`customer.ind.*`) — 24 токена

ФИО полностью, ФИО кратко, Дата рождения, Личный номер, **Паспорт серия, Паспорт номер, Паспорт серия и номер** (3 поля — оставляем все), Паспорт кем выдан, Паспорт дата выдачи, Паспорт действителен до, Адрес полный, Адрес улица, Адрес дом, Адрес корпус, Адрес помещение/квартира, Адрес населённый пункт, Адрес район, Адрес район города, Адрес область, Адрес индекс, Адрес страна, Телефон, Email, Расчётный счёт / IBAN, Банк, БИК / код банка.

### Заказчик ЮЛ (`customer.leg.*`) — 23 токена

Название, Краткое название, УНП, Форма собственности, Адрес полный + 10 частей адреса, **Руководитель должность, Руководитель ФИО, Руководитель ФИО кратко, Руководитель действует на основании**, Расчётный счёт / IBAN, Банк, БИК / код банка, Телефон, Email.

### Заказчик ИП (`customer.ent.*`) — 23 токена (было 19, +4)

ФИО, ФИО кратко, УНП, Адрес полный + 10 частей адреса, **Руководитель должность, Руководитель ФИО, Руководитель ФИО кратко, Руководитель действует на основании** (по умолчанию автозаполняется данными самого ИП, но допускает override — подпись может ставить представитель по доверенности), Расчётный счёт / IBAN, Банк, БИК / код банка, Телефон, Email.

### Исполнитель ФЛ/ЮЛ/ИП (`executor.ind/leg/ent.*`) — зеркально (24+23+23 = 70)

### Динамические (relabel only, ~24)


| token_key              | new_label                                             |
| ---------------------- | ----------------------------------------------------- |
| customer.name          | Заказчик: Название / ФИО по типу плательщика          |
| customer.short_name    | Заказчик: Краткое название / ФИО по типу плательщика  |
| customer.address       | Заказчик: Адрес по типу плательщика                   |
| customer.address.full  | Заказчик: Адрес полный по типу плательщика            |
| customer.unp           | Заказчик: УНП (ЮЛ/ИП)                                 |
| customer.account       | Заказчик: Расчётный счёт / IBAN по типу плательщика   |
| customer.bank          | Заказчик: Банк по типу плательщика                    |
| customer.bank_code     | Заказчик: БИК / код банка по типу плательщика         |
| customer.acts_on_basis | Заказчик: Руководитель действует на основании (ЮЛ/ИП) |
| customer.email         | Заказчик: Email                                       |
| customer.phone         | Заказчик: Телефон                                     |
| customer.client_type   | Заказчик: Тип плательщика                             |
| executor.*             | зеркально                                             |


### Подписант — НЕ удаляем, НЕ мерджим с руководителем

`customer.signer.*` (4 токена) и `executor.signer.*` (если есть) сохраняются как отдельная группа «Подписант». Labels:

- `Заказчик подписант: Должность`
- `Заказчик подписант: ФИО`
- `Заказчик подписант: ФИО кратко`
- `Заказчик подписант: Действует на основании`

Это альтернативный канал для случаев, когда подписант сделки задан явно поверх данных реквизитов. Основной блок «Руководитель» остаётся в `*.leg.*`/`*.ent.*` потому что это лицо, подписывающее документ, а не обязательно директор:

- `Руководитель должность` = должность подписывающего (Директор / Юрисконсульт / Представитель / …)
- `Руководитель действует на основании` = Устав / Доверенность № X от … / Положение / …

### Soft-deprecate + alias


| legacy                      | canonical                        | reason                                                             |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| customer.director           | customer.leg.director_full_name  | rename (label содержал «директор», canonical = «Руководитель ФИО») |
| customer.director_full_name | customer.leg.director_full_name  | rename                                                             |
| customer.director_short     | customer.leg.director_short_name | rename                                                             |
| customer.director_position  | customer.leg.director_position   | rename                                                             |
| customer.basis              | customer.acts_on_basis           | duplicate                                                          |
| customer.bank_name          | customer.bank                    | duplicate                                                          |
| customer.legal_address      | customer.address                 | duplicate                                                          |
| customer.passport           | customer.ind.passport_full       | rename                                                             |
| customer.personal_number    | customer.ind.personal_number     | rename                                                             |
| executor.* (зеркально)      | executor.*                       | —                                                                  |


Aliases в `document_token_aliases` — backward-compat шаблонов сохраняется.

### Итоговый count v3


| Block                        | Tokens                            |
| ---------------------------- | --------------------------------- |
| customer.ind.*               | 24                                |
| customer.leg.*               | 23                                |
| customer.ent.*               | 23 (+4 руководитель)              |
| executor.ind.*               | 24                                |
| executor.leg.*               | 23                                |
| executor.ent.*               | 23 (+4 руководитель)              |
| dynamic customer/executor    | 24                                |
| signer (customer + executor) | 8 (без изменений, только relabel) |
| **Total typed (new INSERT)** | **140**                           |
| Aliases                      | ~22                               |
| Soft-deprecated              | ~10                               |


## Этап 4. Формат ИП — без кавычек (новое правило)

В резолверах, preview, DOCX/PDF и examples ИП печатается **без кавычек**:

- `ИП Федорчук Сергей Валерьевич` ✅
- `ИП "Федорчук Сергей Валерьевич"` ❌

Правила:

- Кавычки — только вокруг названия ЮЛ (например, `ООО "Ромашка"`).
- ФИО ИП в кавычки не берётся.
- Формы собственности (`ИП`, `ООО`, `ЗАО`, `ОАО`) в кавычки не ставятся.

Места правки:

- `supabase/functions/_shared/document-token-resolver.ts` — composer для `customer.ent.name` / `executor.ent.name` собирает `«ИП » + full_name` без кавычек.
- `src/utils/inflectCompanyName.ts` (если используется) — guard для ИП.
- Динамический `customer.name`/`executor.name` при `payer_type=entrepreneur` — то же правило.
- Examples в `document_token_registry.example_value` для ИП — без кавычек.

DoD:

- Smoke DOCX/PDF для трёх payer_type рендерит ИП без кавычек.
- В UI каталоге плейсхолдеров example для `customer.ent.name` отображается как `ИП Федорчук Сергей Валерьевич`.
- Старые рендеры с кавычками не ломаются (грязные данные читаются), но новый canonical output — без кавычек.

## Этап 5. Миграция БД (один transaction)

1. `ALTER TABLE document_templates ADD COLUMN deleted_at timestamptz`, индекс `WHERE deleted_at IS NULL`.
2. `INSERT` 140 типизированных токенов (`customer.ind/leg/ent.*` + `executor.ind/leg/ent.*`) в `document_token_registry`.
3. `UPDATE` ui_label на динамических customer/executor (~24 строки).
4. `UPDATE` ui_label на `*.signer.*` (8 строк) → префикс «Заказчик подписант / Исполнитель подписант».
5. `INSERT` ~22 alias-строк в `document_token_aliases`.
6. `UPDATE archived_at = now(), archive_reason = 'soft_deprecated_v3_typed_tokens'` на дублях (~10 строк).
7. `INSERT` audit-события: `document_tokens.typed_namespace_added`, `document_tokens.dynamic_relabeled`, `document_tokens.signer_relabeled`, `document_tokens.aliases_added`, `document_tokens.duplicates_soft_deprecated`, `document_tokens.entrepreneur_quotes_format_normalized`, `document_templates.deleted_at_added`.

## Этап 6. Code-changes

- `supabase/functions/_shared/document-token-resolver.ts` — резолверы для шести типизированных namespaces; ИП-композер без кавычек; ИП-руководитель: дефолт = ФИО ИП + «Индивидуальный предприниматель», override через явные поля `ent_director_*` (если их пока нет в схеме — читаем из meta/JSON и логируем missing).
- `supabase/functions/_shared/document-render.ts` — расширить `formatStructuredAddress` на 6 namespaces.
- `supabase/functions/canonical-document-generate-strict/index.ts` — guard `deleted_at IS NULL`.
- `src/hooks/useDocumentTemplates.tsx` — фильтр `deleted_at IS NULL` + soft-delete action.
- `src/components/admin/DealPayerDocumentsCard.tsx` — варнинг при удалённом template_override.
- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` — группировка по 8 секциям (6 типизированных + Динамические + Подписант), колонка «Пример».
- `src/utils/templateAutoSuggest.ts` — обновить ссылки на canonical token_keys.
- Schema-расширение для ИП-руководителя: добавить `ent_director_position`, `ent_director_full_name`, `ent_director_short_name`, `ent_acts_on_basis_override` (последнее уже частично есть как `ent_acts_on_basis`) в `legal_entities_requisites.data` (jsonb, без миграции колонок). UI: отдельная секция «Подписант / Руководитель» в форме ИП с автозаполнением и возможностью override.

## Этап 7. Verify

1. `tsc` clean, `deno check` clean.
2. Smoke DOCX/PDF через `templateEditorTestData.ts` со всеми 140 токенами; assert `unresolved_count = 0` для каждого payer_type.
3. Alias smoke: `{{customer.director}}` рендерится корректно через alias.
4. Адрес smoke: structured-адрес собирается через formatter.
5. ИП smoke: рендер «ИП Федорчук Сергей Валерьевич» без кавычек; override руководителя (Представитель + Доверенность) корректно перекрывает дефолт.
6. UI: `/admin/ai-documents` группирует токены по 8 секциям; названия совпадают с UI реквизитов.

## STOP-guards

- Не трогаем `payments_v2`, `orders_v2`, `allocate_document_number`, document scenarios, Contact Center, морфологию.
- Hard-delete токенов запрещён — только archived_at + alias.
- Production-шаблоны не удаляются.
- Никаких новых упоминаний product code в новых артефактах.
- Подписант (`*.signer.*`) НЕ удаляется и НЕ мерджится с руководителем.

## Финальный отчёт

`.lovable/proofs/placeholders_normalization_v3_report_2026_05_13.md`:

1. Таблица old_label → new_label по 8 секциям.
2. Список добавленных типизированных токенов (140).
3. Список aliases (~22).
4. Список soft-deprecated дублей (~10).
5. Подтверждение «ИП без кавычек» (smoke output).
6. UI-каталог: proof группировки.
7. Smoke DOCX/PDF + unresolved_count для трёх payer_type.
8. tsc + deno check логи.
9. Подтверждение всех STOP-guards.

## Перед execute

Сначала готовится dry-run v3 с обновлёнными counts (140 typed) и отдельной секцией «ИП без кавычек». Только после подтверждения dry-run — execute миграции и code-changes одной волной.