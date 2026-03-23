# да, согласен, с учетом правок:

1. До начала PATCH 7 PROOF-2 сначала **формально закрыть PATCH 6**:
  - ручной `probable duplicate`
  - ручной `keyboard select`
  - подтвердить cleanup тестовых person-records
2. В подготовке для PATCH 7 использовать **временное второе физлицо**, созданное через UI, и в конце proof round обязательно:
  - деактивировать его
  - удалить/очистить все временные links
  - вернуть систему в чистое состояние
3. В сценариях 1–4 после каждого create фиксировать **не только скриншот UI, но и SQL-proof**:
  - `role_type`
  - `person_id`
  - `legal_details_id`
  - `share_percent` / `position_catalog_id` / `custom_position_text` / `custom_role_text`
4. В сценарии 5 (duplicate) нужно проверить **именно UI-сообщение**:
  - toast или form error должен быть человекочитаемым
  - без сырого PostgreSQL текста
5. В сценарии 6 (delete) добавить обязательный proof:
  - удалена только запись из `legal_details_entity_person_links`
  - person остался активным
  - entity не изменена
  - read-only блок в карточке физлица обновился
6. В сценарии 7 (reassign) обязательно доказать **runtime invalidation**, а не только итог после перезагрузки:
  - в карточке юрлица сразу новый человек
  - у старого физлица связь исчезла
  - у нового физлица связь появилась
  - по возможности без hard refresh
7. Бонус `inactive person edit` сделать не факультативным, а обязательным:
  - это один из критичных кейсов PATCH 7
  - picker должен показать текущего inactive person и не ломать edit flow
8. В финальном отчёте отдельными блоками показать:
  - `PATCH 7 PROOF-2`
  - `SQL verification`
  - `Cleanup выполнен`
  - `Не затронуто`:
    - `/settings/legal-details`
    - documents / generate-from-template
    - billing/payment flow
    - PATCH 6 persons module
    - entity shell/edit flow
9. Если browser automation упрётся в `PersonPicker`, это надо явно фиксировать как ограничение инструмента, но сначала сделать максимум через runtime UI, а не уходить сразу в SQL-only proof.
10. &nbsp;
11. PATCH 7 PROOF-2 — Runtime UI Verification Plan

## Цель

Провести browser-based runtime proof по 7 обязательным UI-сценариям в карточке юрлица/ИП на странице `/ai`.

## Предварительные условия

- Пользователь должен быть авторизован в preview
- Нужно минимум 2 активных физлица. Сейчас есть 1 (Федорчук). Нужно создать второе через persons tab перед началом proof round, а после — деактивировать.

## Сценарии (7 штук)

### 1. Founder в UI

- Открыть карточку АЖУР инкам → view → секция «Связанные лица» → «Добавить»
- Выбрать физлицо → роль «Учредитель» → доля 50 → Save
- Screenshot: badge «Учредитель» + «50%» в списке

### 2. Position через catalog в UI

- «Добавить» → физлицо → роль «Должностное лицо» → выбрать «Директор» из справочника → Save
- Screenshot: badge «Должностное лицо» + «Директор»

### 3. Position через custom text в UI

- «Добавить» → роль «Должностное лицо» → не выбирать из справочника → ввести «Финансовый аналитик» → Save
- Screenshot: badge + custom текст

### 4. Other в UI

- «Добавить» → роль «Другое» → ввести «Доверенное лицо» → Save
- Screenshot: badge «Другое» + «Доверенное лицо»

### 5. Duplicate в UI

- Повторить создание одной из уже существующих связей
- Screenshot: toast с человекочитаемой ошибкой «Такая связь уже существует»

### 6. Delete в UI

- Удалить одну связь → confirm → toast «Связь удалена»
- Screenshot: связь исчезла из списка
- SQL verify: person активен, entity не изменена

### 7. Reassign в UI

- Edit существующую связь → сменить person → Save
- Screenshot карточки юрлица: новый человек
- Проверить карточку старого физлица: связь исчезла
- Проверить карточку нового физлица: связь появилась

### Бонус: Inactive person edit

- Деактивировать второе физлицо
- Открыть edit связи с ним
- Screenshot: picker показывает inactive person, форма не ломается

## Ограничения browser automation

PersonPicker — это custom combobox (Popover + Input), не стандартный select. Может потребовать специфическую навигацию через automation. Если combobox не поддастся — зафиксировать для ручной проверки.

## Порядок выполнения

1. Подготовка: создать второе физлицо
2. Сценарии 1–4 (create links разных типов)
3. Сценарий 5 (duplicate)
4. Сценарий 7 (reassign) — пока есть несколько links
5. Сценарий 6 (delete)
6. Бонус (inactive person edit)
7. Cleanup: деактивировать/удалить временные данные
8. Финальный отчёт с screenshots и SQL

## Не меняем код

Никаких правок файлов. Только browser testing + SQL verification.