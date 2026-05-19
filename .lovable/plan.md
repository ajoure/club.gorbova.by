# да, согласен, с учетом правок:

1. В discovery обязательно добавить отдельный раздел **«Почему типизированные группы пустые»** с конкретным кодовым выводом:
  - какие поля/metadata/category/group нужны для попадания в «Заказчик ФЛ / ЮЛ / ИП»;
  - какие фактические значения сейчас у токенов;
  - точная причина `actual count = 0`.
2. Отдельно проверить баг **«скрыто без field_id: 154»**:
  - какие это токены;
  - должны ли они иметь `field_id`;
  - если это нормальные runtime-токены без `field_id`, каталог не должен скрывать их как ошибочные.
3. В отчёте обязательно разделить сущности:
  - `document.*` → группа «Документ»;
  - `deal.*` / `order.*` → группа «Сделка»;
  - `payment.*` → группа «Оплата»;
  - `system.*` → группа «Системные поля»;
  - dynamic `customer.*` / `executor.*` → группа «Универсальные поля».
4. По группе **«Подписант»** не просто описать, а дать решение:
  - если нет UI-источника заполнения — убрать из обычного каталога и перенести в «Технические / override»;
  - если источник есть — показать точный UI path, где пользователь это заполняет.
5. В mapping UI ↔ registry добавить колонку:
  &nbsp;
  ```text
  visible_in_catalog_now: yes/no
  ```
  Чтобы было видно, какие поля уже есть, но не отображаются из-за фильтров.
6. В execute v4 не предлагать массовое добавление новых токенов до тех пор, пока не будет доказано:
  - какие токены уже существуют;
  - какие не видны только из-за UI-фильтра;
  - какие реально отсутствуют.
7. В итоговом summary отдельно вывести:

```text
Главная причина текущего хаоса:
- проблема данных registry;
- проблема UI-фильтрации;
- проблема группировки;
- проблема отсутствующих токенов;
- проблема лишних/orphan токенов.
```

После этих правок план можно запускать как read-only discovery.

&nbsp;

План: Полный read-only discovery плейсхолдеров и UI реквизитов

## Цель

Остановить любые правки registry/резолверов/UI каталога и собрать единый отчёт о фактическом состоянии:

- какие поля реально заполняет пользователь в UI реквизитов (ФЛ / ЮЛ / ИП, заказчик / исполнитель);
- какие token_key реально существуют в `fields_registry` / `document_token_registry` / `document_token_aliases`;
- по какой логике каталог плейсхолдеров группирует токены и почему группы «Заказчик ФЛ/ЮЛ/ИП», «Исполнитель ФЛ/ЮЛ/ИП» пустые;
- что такое «Подписант» и «Динамические поля» в текущем каталоге;
- предложить новую структуру групп и labels — но НЕ применять.

Итоговый артефакт: `.lovable/proofs/placeholders_full_discovery_2026_05_13.md`.
Execute v4 — только после явного approve.

## Жёсткие ограничения (до окончания discovery)

Запрещено:

- любые миграции (schema, data, RLS, enum, triggers, functions);
- добавление / архивация / переименование токенов;
- изменения `fields_registry`, `document_token_registry`, `document_token_aliases`;
- изменения резолверов токенов и UI каталога плейсхолдеров;
- правки в production-шаблонах документов;
- любые действия в `payments_v2`, `orders_v2`, `allocate_document_number`, document scenarios, Contact Center, морфологии.

Разрешено только: чтение БД, чтение файлов, статический анализ, написание единого markdown-отчёта в `.lovable/proofs/`.

## Этап 1. Discovery UI реквизитов

Маршрут: `/settings/legal-details` (а также `src/pages/settings/UserRequisites.tsx`, формы ФЛ/ЮЛ/ИП).

Для каждого subject_type (`individual`, `legal_entity`, `entrepreneur`) выписать все поля формы в таблицу:

| UI section | UI label | form field | DB table | DB path (column / jsonPath) | required | пример |

Источники для чтения:

- `src/pages/settings/UserRequisites.tsx`
- компоненты форм `IndividualDetailsForm`, форм ЮЛ/ИП (поиск по `legal_entities_requisites`, `individual_requisites`, `subject_type`);
- `src/lib/requisites-v2/fieldMap.ts` (canonical keys + legacy map);
- `src/lib/legal-details/fieldMap.ts` (legacy field map);
- `src/constants/demoLegalDetails.ts`.

Особое внимание:

- структурированный адрес (`address_structured.{street,house,building,apartment,city,region,district,postal_code,country}`);
- override подписанта ИП (`ent_director_position`, `ent_director_full_name`, `ent_director_short_name`, `ent_acts_on_basis_override`);
- ФЛ-поля `passport_*`, `personal_number`, `birth_date`, банковские;
- ЮЛ-поля `org_form`, `name`, `short_name`, `director_*`, `acts_on_basis`;
- правило отображения ИП без кавычек (`ИП Иванов И.И.`, не `ИП "Иванов И.И."`).

## Этап 2. Discovery registry в БД (read-only)

Через read_query собрать срезы:

1. `fields_registry`: `public_id, category, data_type, ui_label, archived_at`.
2. `document_token_registry`: `token_key, ui_label, category, source_type, resolver_key, field_id, metadata, archived_at, example_value`.
3. `document_token_aliases`: `alias, canonical_token_key`.
4. Counts по `category`, по `source_type`, по `archived_at IS NULL`.
5. Токены без `field_id` (текущая надпись «скрыто без field_id: 154»).
6. Список namespace’ов: `customer.*`, `executor.*`, `deal.*`, `order.*`, `payment.*`, `document.*`, `system.*`, `customer.signer.*`, `customer.ind.*`, `customer.leg.*`, `customer.ent.*`, `legal_details.*` и т.д.

Сводная таблица в отчёте:

| UI group | token_key | field_id | label | example | source_type | resolver_key | active/archived | comment |

## Этап 3. Discovery логики группировки каталога

Файлы:

- `PlaceholdersCatalogTab` и связанные (поиск по rg);
- dropdown групп, фильтры, `groupBy`, видимость «скрыто без field_id».

Выписать фактическую механику в таблицу:

| UI group | filter condition (код) | expected tokens | actual count | проблема |

Обязательно объяснить:

- почему «Заказчик ФЛ / ЮЛ / ИП» и «Исполнитель ФЛ / ЮЛ / ИП» = 0 (нет токенов с нужным namespace? нет нужной `category`? фильтр требует `field_id`?);
- почему «Подписант» = 4 — какие именно token_key туда попадают и откуда они берутся в UI;
- почему «Системные / Документ / Сделка / Оплата» = 81 (одна общая `category` вместо четырёх);
- что значит «скрыто без field_id: 154» — это нормальные plain `token_key` или незавершённая привязка;
- что сейчас лежит в «Динамические поля» и по какому признаку.

## Этап 4. Mapping UI ↔ registry

Для каждого поля из Этапа 1 — строка в сводной таблице:

| UI field | DB path | ожидаемый token_key | текущий token_key | label | статус |

Статусы:

- `ok` — поле и токен есть, связь корректна;
- `missing_token` — поле в UI есть, токена нет;
- `orphan_token` — токен есть, источника заполнения в UI нет;
- `duplicate_token` — несколько токенов на одно UI-поле;
- `legacy_token` — старый `leg_*` / `ent_*` / `ind_*` / `legal_details.*`, требует решения.

Отдельные списки в отчёте: `missing_token[]`, `orphan_token[]`, `duplicate_token[]`, `legacy_token[]`.

## Этап 5. Разбор «Подписант» и «Динамические поля»

Подписант (`customer.signer.*`):

- где и кем заполняется (карточка сделки? override? нигде?);
- если источника нет — пометить как «orphan / override-only»;
- предложить (без выполнения): переименовать группу в «Подписант сделки / override» либо скрыть из обычного каталога.

Динамические / универсальные (`customer.name`, `customer.address`, ...):

- какие токены выбирают значение по типу плательщика;
- предложить переименование группы в «Универсальные поля» и понятные labels («Заказчик: ФИО / название автоматически по типу плательщика»);
- зафиксировать правило: универсальные ≠ типизированные, не смешиваются с системными/сделкой/оплатой.

## Этап 6. Предложение новой структуры (только текст в отчёте)

Группы каталога:

1. Заказчик ФЛ
2. Заказчик ЮЛ
3. Заказчик ИП
4. Исполнитель ФЛ
5. Исполнитель ЮЛ
6. Исполнитель ИП
7. Универсальные поля
8. Документ
9. Сделка
10. Оплата
11. Системные поля
12. Подписант сделки / override
13. Технические / legacy

Правила:

- «Документ», «Сделка», «Оплата», «Системные» — четыре разные группы, не сливать;
- в «Документ» только `document.*`, в «Сделка» только `deal.*` / `order.*`, в «Оплата» только `payment.*`, в «Системные» только `system.*`;
- в «Универсальные» только dynamic `customer.*` / `executor.*` по типу плательщика;
- labels по шаблону «Заказчик ФЛ: …» / «Исполнитель ЮЛ: …» — полный список приведён в отчёте (как в запросе пользователя).

## Этап 7. Артефакт

Файл: `.lovable/proofs/placeholders_full_discovery_2026_05_13.md`

Разделы:

1. Фактическая структура UI реквизитов (ФЛ / ЮЛ / ИП).
2. Фактические таблицы и поля БД (`legal_entities_requisites`, `individual_requisites`, JSONB `data` и каноничные ключи).
3. Фактические `token_key` в registry (сводная таблица).
4. Фактическая логика группировки каталога (код + таблица).
5. Почему группы «Заказчик ФЛ/ЮЛ/ИП», «Исполнитель ФЛ/ЮЛ/ИП» пустые.
6. Почему системные / документ / сделка / оплата смешались в одну группу.
7. Mapping UI field → DB path → token_key → label.
8. Списки: `missing_token`, `orphan_token`, `duplicate_token`, `legacy_token`.
9. Разбор «Подписант».
10. Разбор «Динамические поля» → «Универсальные поля».
11. Предложение новой структуры групп и labels.
12. Черновик «Execute v4» (план миграций и правок) — БЕЗ выполнения.

## Этап 8. Стоп и summary

После записи отчёта — остановиться и выдать summary вида:

```
Discovery завершён.

Найдено:
- UI-полей: N
- активных плейсхолдеров: N
- пустых групп: N
- missing_token: N
- orphan_token: N
- duplicate_token: N
- legacy_token: N

Предлагаемый execute v4:
1. ...
2. ...
3. ...

Жду подтверждения execute v4.
```

## DoD

- Создан `.lovable/proofs/placeholders_full_discovery_2026_05_13.md` со всеми 12 разделами;
- Все таблицы заполнены реальными данными из кода и БД (не плейсхолдеры);
- Никаких изменений в БД, registry, резолверах, UI каталога, шаблонах;
- В чате — summary и явное ожидание approve на execute v4.