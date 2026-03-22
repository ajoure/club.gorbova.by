## да, согласен, с учетом правок:

1. **Обычные поля физлица — да, address block — пока нет.**  
Для `PersonFieldsForm` можно и нужно добавить копирование FLD-ID у обычных полей (`ФИО`, `дата рождения`, `личный номер`, `паспорт`, и т.д.).  
Но **не возвращать сейчас копирование label внутри** `StructuredAddressBlock`, потому что именно address block уже был источником interaction-багов в `/ai`. Иначе можно снова сломать выбор адреса мышью.
2. **Значит scope этого фикса сузить так:**
  - добавить copy-by-label только для **неадресных** person fields;
  - `fieldIds` в `StructuredAddressBlock` можно пробросить только если они используются пассивно и не делают labels кликабельными;
  - если внутри `StructuredAddressBlock` label снова становится clickable — это **не входит** в текущий фикс.
3. **Не использовать** `FieldLabelWithId` **напрямую**, с этим согласен.  
Он завязан на `react-hook-form`.  
Для `PersonFieldsForm` сделать отдельный лёгкий компонент, например:
  - `CopyablePlainLabel`
  - без зависимости от RHF
  - обычный `Label`
  - `onClick` → copy `publicId`
  - toast при копировании
4. **Проверить ключи registry до реализации, ничего не угадывать.**  
Особенно:
  - `phone`
  - `email`
  - `ind_address_*`  
  Внести в план явную проверку: если ключа нет в `fields_registry`, не выдумывать fallback и не хардкодить FLD-ID.
5. **Address mapping зафиксировать только по реально существующим ключам.**  
В плане написать:
  - street → `ind_address_street`
  - house → `ind_address_house`
  - apartment → `ind_address_apartment`
  - city → `ind_address_city`
  - region → `ind_address_region`
  - district → `ind_address_district`
  - postal_code → проверить точный ключ в registry (`ind_address_index` или иной), не предполагать заранее
6. **STOP GUARD:**  
этим фиксом не трогать:
  - `StructuredAddressBlock` interaction behavior
  - mouse-path выбора адреса
  - `FieldLabelWithId`
  - settings forms  
  Это должен быть локальный PATCH только для labels в `PersonFieldsForm`.
7. **DoD уточнить:**
  - клик по label обычного поля физлица в create/edit копирует FLD-ID;
  - toast показывается;
  - address selection не регресснул;
  - settings forms не затронуты;
  - никаких изменений в view-mode не требуется, потому что там уже есть copyable values, а не FLD-ID.
8. **Итоговая формулировка фикса:**  
Это не “добавить копирование FLD-ID в карточку физлица вообще”, а  
**“добавить copy-by-label для обычных form-label полей в** `PersonFieldsForm`**, не вмешиваясь в address interaction layer”**.
9. &nbsp;
10. PATCH 6 FIX — добавить копирование FLD-ID в карточку физлица

### Текущая ситуация

В `fields_registry` уже зарегистрированы поля физлица с entity_type `legal_details` и ключами `ind_*`:


| Ключ                       | FLD-ID        | Label           |
| -------------------------- | ------------- | --------------- |
| `ind_full_name`            | FLD-000020    | ФИО             |
| `ind_birth_date`           | FLD-000021    | Дата рождения   |
| `ind_personal_number`      | FLD-000027    | Личный номер    |
| `ind_passport_series`      | FLD-000022    | Серия паспорта  |
| `ind_passport_number`      | FLD-000023    | Номер паспорта  |
| `ind_passport_issued_by`   | FLD-000024    | Кем выдан       |
| `ind_passport_issued_date` | FLD-000025    | Дата выдачи     |
| `ind_passport_valid_until` | FLD-000026    | Действителен до |
| `ind_address_*`            | FLD-000028–34 | Адресные поля   |


`IndividualDetailsForm` в settings уже использует эти ID через `useLegalDetailsFields` + `FieldLabelWithId`. В `PersonFieldsForm` ничего подобного нет — labels обычные, без копирования.

### Что делаем

**Файл 1: `src/components/ai-requisites/PersonFieldsForm.tsx**`

1. Импортировать `useLegalDetailsFields` и `FieldLabelWithId`
2. Загрузить `fieldsMap` из хука (те же `ind_*` записи, они уже в registry)
3. Заменить обычные `<Label>` на `<FieldLabelWithId>` с соответствующим `fieldEntry`:
  - `full_name` → `fieldsMap.get("ind_full_name")`
  - `birth_date` → `fieldsMap.get("ind_birth_date")`
  - `personal_number` → `fieldsMap.get("ind_personal_number")`
  - `passport_series` → `fieldsMap.get("ind_passport_series")`
  - `passport_number` → `fieldsMap.get("ind_passport_number")`
  - `passport_issued_by` → `fieldsMap.get("ind_passport_issued_by")`
  - `passport_issued_date` → `fieldsMap.get("ind_passport_issued_date")`
  - `passport_valid_until` → `fieldsMap.get("ind_passport_valid_until")`
  - `phone` → `fieldsMap.get("phone")` (if exists)
  - `email` → `fieldsMap.get("email")` (if exists)
4. Построить `addressFieldIds` map (аналогично `IndividualDetailsForm`):
  ```
   street → ind_address_street
   house → ind_address_house
   apartment → ind_address_apartment
   city → ind_address_city
   region → ind_address_region
   district → ind_address_district
   postal_code → ind_address_index
  ```
5. Передать `fieldIds={addressFieldIds}` в `StructuredAddressBlock`

**Важно:** `FieldLabelWithId` использует `FormLabel` из react-hook-form. Но `PersonFieldsForm` не использует react-hook-form — у него обычные `useState`. Поэтому `FieldLabelWithId` напрямую не подойдёт (он рендерит `<FormLabel>`, который требует `<FormField>` контекста).

Решение: создать легковесный аналог `CopyableLabel` внутри `PersonFieldsForm` (или как shared) — обычный `<Label>` с `onClick` для копирования `publicId`. Без зависимости на react-hook-form.

### Файлы


| Файл                   | Изменение                                                                |
| ---------------------- | ------------------------------------------------------------------------ |
| `PersonFieldsForm.tsx` | Добавить `useLegalDetailsFields`, `addressFieldIds`, кликабельные labels |


### Не трогаем

- `FieldLabelWithId` (он привязан к react-hook-form FormLabel)
- `StructuredAddressBlock` (уже поддерживает `fieldIds`)
- `PersonRecordSheet` — view mode `InfoRow` уже copyable для значений
- Никаких миграций — поля уже в registry

### DoD

- Клик по label поля в форме edit/create физлица → копирует FLD-ID в буфер + toast
- Address block labels кликабельны и копируют FLD-ID
- Не ломает settings forms