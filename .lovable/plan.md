да, согласен, с учетом правок:

1. **3A.1 нужен. Sprint 3B v1 правильно поставить на паузу**  
Текущий Sprint 3B execution plan v1 действительно преждевременный. До любых новых FLD нужно доказать, что существующих FLD для ФИО, падежей, номера, даты, года и города нет или они непригодны.
2. **Уточнить синтаксис role-aware placeholder**  
В варианте A не фиксировать заранее синтаксис:  
{{cf.person.FLD-XXXXXX|role=responsible_person}}  
Нужно написать безопаснее:
3. **plan_year не считать обычным system field автоматически**  
Да, сначала нужно проверить existing year/system FLD. Но если “год плана” — это значение, которое пользователь выбирает в анкете пакета, то это не всегда равно текущему/следующему году.  
Добавить:
4. **Должность: правильно, это role-context**  
Подтверждаю: должность не надо делать как “должность физлица” навсегда. Один человек в разных пакетах может иметь разные роли/должности.  
Оставить:
5. **Добавить проверку склонения должности из metadata**  
Если должность хранится в participants.metadata.position, нужно проверить, сможет ли текущая морфология склонять эту строку.  
Добавить в DoD:
6. **Расширить поиск по token registry и aliases**  
Кроме fields_registry, добавить read-only проверку:  
Проверить `document_token_registry`, `document_token_aliases`, token manifests и template snapshots на наличие person/date/year/document aliases.  
Иначе можно не найти уже существующий alias.
7. **Номер и дата приказа: проверить не только FLD-000069/070**  
В счете-акте действительно есть поля номера и даты документа: FLD-000069 и FLD-000070.    
Но нужно подтвердить, что они универсальны для всех документов, а не только для счета-акта.  
Добавить:
8. **Город приказа: не создавать новый до проверки адресной модели**  
Верно: сначала брать из выбранного юрлица. Но нужно проверить, есть ли отдельная колонка города, а не только полный адрес.  
Добавить:
9. **Coverage matrix должна иметь статус “existing FLD найден, но context не подтвержден”**  
Добавить decision:  
existing*_found_*but*_context_*unconfirmed  
Это важно для FLD, которые есть, но могут быть billing-specific.
10. **Итоговый статус 3A.1**

Добавить финальные варианты:

completed: all first-order fields covered by existing FLD + role-context, no new FLD required

или

completed: minimal new alias/wrapper tokens required, source fields reused

или

blocked: existing FLD/context insufficient, architecture decision required

**Итог**

План 3A.1 правильный. Его можно запускать как read-only discovery.

Главная цель: **не создавать FLD для ФИО/даты/номера/года/города, пока не доказано, что существующие поля нельзя безопасно использовать в package context**.

# План: Sprint 3A.1 — Corrective Discovery (reuse-first, до Sprint 3B execution)

Документ-результат: `.lovable/proofs/package_documents_sprint3a1_corrective_discovery_2026_05.md`
Обновления:

- `.lovable/plan.md` — Sprint 3B execution = **PAUSED**, статус: `blocked_by_sprint_3a1_corrective_discovery`.
- Sprint 3A closure clarifications — добавить ссылку на 3A.1 как обязательное pre-condition.

В рамках 3A.1 НЕ выполняется ни одна миграция, INSERT, deploy, UI-патч. Это read-only discovery + reuse-first manifest.

## 1. Причина паузы

В черновике Sprint 3B execution plan предложено создать 5 новых package FLD, включая:

- `package.roles.company_head.full_name`
- `package.roles.responsible_person.full_name`
- `package.context.plan_year`

Это нарушает reuse-first canon: ФИО физлица, падежи ФИО, год/дата/номер документа, город юрлица уже должны существовать как FLD. Discovery в 3A был слишком узким (только `entity_type='legal_details_person'`) и не доказал отсутствие.

## 2. Корректная модель (фиксируется как инвариант)

```
роль в пакете (role_key)  =  кто выбран (person_id или legal_entity_id)
поле физлица/юрлица (FLD) =  какое значение взять
```

- ФИО / фамилия / имя / отчество / падежи — **existing person FLD**, выбираются через package role assignment.
- Должность в пакете — `document_package_session_participants.metadata.position` (может отличаться от пакета к пакету; **не** свойство карточки физлица).
- Номер/дата приказа — **existing document/system FLD** (например `FLD-000069`, `FLD-000070`).
- Город — из адреса выбранного юрлица (`package_session.selected_legal_entity_id → client_legal_details.*`).
- Год плана — сначала проверить existing system/document year FLD; новый FLD создавать только при доказанном отсутствии.

Новые FLD разрешены **только** для значений, которые реально не существуют как existing FLD.

## 3. Discovery scope (read-only SQL)

### 3.1 Existing person FLD — расширенный поиск

```sql
SELECT id, public_id, key, label, entity_type, data_type, category, description, archived_at
FROM fields_registry
WHERE archived_at IS NULL
  AND (
    entity_type IN ('person','legal_details_person','legal_details_persons',
                    'individual','entity_person','natural_person','contact')
    OR key ILIKE '%person%'
    OR key ILIKE '%individual%'
    OR key ILIKE '%full_name%'
    OR key ILIKE '%surname%' OR key ILIKE '%last_name%'
    OR key ILIKE '%first_name%' OR key ILIKE '%middle_name%' OR key ILIKE '%patronymic%'
    OR key ILIKE '%passport%'
    OR label ILIKE '%физ%' OR label ILIKE '%ФИО%'
    OR label ILIKE '%фамил%' OR label ILIKE '%имя%' OR label ILIKE '%отчеств%'
    OR label ILIKE '%паспорт%' OR label ILIKE '%должност%'
    OR category ILIKE '%person%' OR category ILIKE '%физ%'
  )
ORDER BY entity_type, key;
```

### 3.2 Падежи ФИО

```sql
SELECT id, public_id, key, label, entity_type
FROM fields_registry
WHERE archived_at IS NULL
  AND (
    key ILIKE '%genitive%' OR key ILIKE '%dative%' OR key ILIKE '%accusative%'
    OR key ILIKE '%instrumental%' OR key ILIKE '%prepositional%'
    OR key ILIKE '%case%'
    OR label ILIKE '%родительн%' OR label ILIKE '%дательн%'
    OR label ILIKE '%винительн%' OR label ILIKE '%творительн%' OR label ILIKE '%предложн%'
    OR label ILIKE '%падеж%'
  );
```

### 3.3 Document/system FLD (номер, дата, год)

```sql
SELECT id, public_id, key, label, entity_type
FROM fields_registry
WHERE archived_at IS NULL
  AND (
    entity_type IN ('document','system','order','common')
    OR key ILIKE '%document.number%' OR key ILIKE '%doc_number%'
    OR key ILIKE '%document.date%'   OR key ILIKE '%doc_date%'
    OR key ILIKE '%year%' OR key ILIKE '%current_year%'
    OR key ILIKE '%next_year%' OR key ILIKE '%previous_year%'
    OR label ILIKE '%номер документ%' OR label ILIKE '%дата документ%'
    OR label ILIKE '%год%'
  )
ORDER BY entity_type, key;
```

Дополнительно: явно подтвердить наличие `FLD-000069` (номер) и `FLD-000070` (дата) и их семантику.

### 3.4 Legal_details: город / адрес / место нахождения

```sql
SELECT id, public_id, key, label
FROM fields_registry
WHERE archived_at IS NULL
  AND entity_type = 'legal_details'
  AND (
    key ILIKE '%city%' OR key ILIKE '%address%' OR key ILIKE '%location%'
    OR label ILIKE '%город%' OR label ILIKE '%адрес%' OR label ILIKE '%место%'
  );
```

### 3.5 Связки данных physical-person

- Проверить структуру `legal_details_persons` (колонки full_name / surname / first_name / middle_name / падежи / passport / position).
- Проверить структуру `document_package_session_participants` (наличие `metadata` JSONB, `role_key`, `person_id`).
- Проверить, есть ли существующий resolver / column-mapping для `legal_details_persons` в `fields_registry` (по `description` или `meta`).

## 4. Coverage Matrix первого приказа (заполняется по итогам 3.1–3.5)


| Поле приказа              | Кандидат existing FLD (public_id, key) | Источник (table/column)                          | Решение                                                |
| ------------------------- | -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Наименование организации  | ?                                      | client_legal_details.*                           | reuse                                                  |
| УНП                       | FLD-000009 (ожидаемо)                  | client_legal_details.leg_unp                     | reuse                                                  |
| Юр. адрес                 | ?                                      | client_legal_details.*                           | reuse                                                  |
| Город приказа             | ? (поиск в 3.4)                        | client_legal_details.city/address                | reuse / нужен новый только при доказанном отсутствии   |
| Номер приказа             | FLD-000069 (верифицировать)            | document.number                                  | reuse                                                  |
| Дата приказа              | FLD-000070 (верифицировать)            | document.date                                    | reuse                                                  |
| Год плана                 | ? (поиск в 3.3)                        | system year / package_session.metadata.plan_year | reuse system FLD приоритет; иначе — обоснованный новый |
| ФИО руководителя          | existing person ФИО (поиск в 3.1)      | legal_details_persons.full_name                  | reuse через role=company_head                          |
| ФИО руководителя (падежи) | existing (поиск в 3.2)                 | legal_details_persons.* падежи                   | reuse                                                  |
| Должность руководителя    | participants.metadata.position         | participants (role_key=company_head)             | role-context, не новый FLD-источник                    |
| ФИО ответственного        | existing person ФИО                    | legal_details_persons.full_name                  | reuse через role=responsible_person                    |
| Должность ответственного  | participants.metadata.position         | participants (role_key=responsible_person)       | role-context                                           |


Любая ячейка «нужен новый» допускается только с phrase **«доказано отсутствие existing FLD: <SQL+результат>»**.

## 5. Архитектурное решение role-context (фиксируется в 3A.1 manifest)

Две альтернативы переходят в Sprint 3B planning:

**Вариант A — role-aware placeholder (предпочтительный, если рендер поддерживает модификаторы):**

```
{{cf.person.FLD-XXXXXX|role=responsible_person}}
{{cf.person.FLD-XXXXXX|role=company_head|case=genitive}}
```

- Источник данных — existing person FLD.
- Role/case — модификаторы резолвинга, не новые FLD.

**Вариант B — alias/wrapper (если рендер не умеет модификаторов):**

- Создаётся wrapper-токен `package.role.responsible_person.full_name`, который НЕ имеет собственного источника данных, а ссылается на existing person FLD `source_field_id` + `role_key`.
- В `fields_registry` фиксируется как `is_alias=true` (или эквивалент); column mapping отсутствует.
- Удобно для UI picker'а, но физически дублирующих источников не создаёт.

Решение между A и B принимается в 3A.1 на основе capability check текущего DOCX-рендера (`{{field:FLD-XXXXXX}}` синтаксис: умеет ли pipe-модификаторы).

## 6. Должность как role-context

- Должность хранится **только** в `document_package_session_participants.metadata.position`.
- Discovery: проверить, есть ли существующий generic FLD «должность физлица» в карточке физлица. Если есть — он **не** используется в package-документах (должность пакет-специфична).
- Если в карточке физлица есть «текущая должность» как справочное поле — это UI-подсказка для предзаполнения `participants.metadata.position`, не источник package-токена.

## 7. Запрет на новые FLD (до доказательства)

Запрещено в Sprint 3A.1 и Sprint 3B execution создавать FLD:

- `package.roles.*.full_name` (любого варианта роли) — без доказательства отсутствия existing person ФИО.
- `package.roles.*.full_name_genitive/dative/...` — без доказательства отсутствия existing падежей.
- `package.context.plan_year` — без доказательства отсутствия existing system/document year FLD.
- `package.context.document_number/date/city` — без доказательства отсутствия existing document/legal_details FLD.

## 8. DoD Sprint 3A.1

- Выполнены SQL §3.1–§3.4 (read-only), результаты приложены к proof-файлу.
- Подтверждены/опровергнуты `FLD-000069`, `FLD-000070` как номер/дата документа.
- Coverage matrix §4 заполнена с конкретными `public_id` и SQL-доказательствами.
- Зафиксирован capability check рендера (поддержка `|role=` / `|case=` модификаторов).
- Принято решение A vs B (§5) с обоснованием.
- Зафиксирован контракт «должность = participants.metadata.position» (§6).
- Список разрешённых новых FLD (если такие останутся) с доказательством отсутствия existing — отдельным разделом proof-файла.

## 9. Что НЕ делается в 3A.1

- Никаких миграций, INSERT, UPDATE, DELETE.
- Никаких deploy edge functions.
- Никаких UI-патчей.
- Никакого создания `resolvePackageTokens`.
- Никакого включения feature flag.

## 10. Условия для Sprint 3B execution plan v2

Sprint 3B execution plan переписывается **после** одобрения 3A.1 со следующими свойствами:

- Список новых FLD сокращён до доказанно отсутствующих (потенциально 0).
- Resolver `resolvePackageTokens` оперирует existing person/document/legal_details FLD + `role_key` + `case` модификаторами (или alias-wrapper'ами по варианту B).
- Минимальная routing-точка по `template_scope='package'` сохраняется.
- Feature flag `documents_package_resolver_enabled=false` по умолчанию — сохраняется.
- Soft-disable rollback через `archived_at` — сохраняется (применим к alias-токенам или к минимальному набору доказанно-новых FLD).
- Billing/customer/executor resolver не затрагивается.
- Sprint 3B execution v2 не стартует без отдельного approve.

## 11. Статусы

- Sprint 3B execution plan v1 — **отозван** (`superseded_by_sprint_3a1`).
- Sprint 3A.1 — `planned, awaiting approval to run read-only discovery`.
- Sprint 3B execution v2 — `blocked until Sprint 3A.1 closure approved`.