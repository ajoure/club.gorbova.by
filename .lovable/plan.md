# да, согласен, с учетом правок:

1. **Legal form хранить только в полном canonical-виде.**  
В плане сейчас есть ошибка:  
`handleGrpConfirm → leg_org_form (через маппинг полная→короткая)`  
Это противоречит выбранному правилу. Нужно наоборот:
  - в БД хранить: `Закрытое акционерное общество`
  - сокращение `ЗАО` получать только через display/helper
  - selector/option list в форме либо перевести на полные значения, либо ввести mapping `full <-> short`, где source of truth = full form
2. **Название компании сохранять отдельно от формы и без кавычек.**  
Зафиксируй явно:
  - `parseOrgFormAndName()` возвращает:
    - `orgFormFull`
    - `orgFormShort`
    - `cleanName`
  - в save-path:
    - `leg_org_form = orgFormFull`
    - `leg_name = cleanName`
  - `short_name` использовать отдельно, но не как fallback для основного названия, если уже удалось распарсить `cleanName`
3. **Не сохранять** `registration_date`**,** `tax_office_code`**,** `tax_office_name` **“в side-state через onSubmit”, пока не подтверждено место хранения.**  
Здесь план пока сырой. Нельзя тихо протащить новые данные без подтвержденной persistence-модели. По правилам сначала diagnose, потом execute.  
Выбираю такой вариант:
  - в PATCH 3.1 эти поля показываем в diff-dialog
  - применяем в UI только если уже есть подтвержденные поля хранения
  - если подтвержденных полей нет — не сохраняем их в БД в этом патче, не придумываем временный side-state как будто это persistence
4. **Адрес МНС нужно разбирать в отдельном adapter/service слое, а не просто “внутри сервиса как regex helper”.**  
Лучше так:
  - `GrpAutofillService` — orchestration/build diff
  - `GrpAddressAdapter` или `GrpAddressParser` — flat address → `StructuredAddress`  
  Это соответствует правилу: бизнес-логика в сервисах, интеграции через adapters, внутренняя модель не зависит от внешнего формата.
5. **PATCH должен покрывать не 3, а все фактически затронутые места apply.**  
В плане перечислены:
  - `LegalEntityDetailsForm`
  - `EntrepreneurDetailsForm`
  - `AdminExecutors`  
  Это правильно для GRP apply.  
  Но отдельно зафиксируй, что:
  - `IndividualDetailsForm` в этот PATCH не входит по GRP,
  - там только address rollout уже сделан и этот PATCH его не трогает, кроме если потребуется bugfix по legacy/canonical consistency.
6. **Для** `GrpConfirmDialog` **зафиксируй не только ширину, но и структуру контента.**  
Добавь:
  - label отдельной строкой
  - старое значение отдельной строкой
  - новое значение отдельной строкой
  - длинные значения с `break-words`
  - список diff со scroll внутри
  - модалка не должна схлопывать длинный адрес или длинное название  
  По скринам это как раз текущая проблема.
7. **Apply после confirm должен реально заполнять structured address, а не только flat поля.**  
Явно пропиши:
  - `setAddress(parsedStructuredAddress)`
  - `setAddressSource('grp')`
  - при submit:
    - canonical JSONB = parsed structured address
    - legacy string = `formatFullAddress(canonical)`  
    Это должно работать одинаково для `LegalEntity`, `Entrepreneur`, `Executors`.
8. **Нужен explicit DRY RUN перед EXECUTE.**  
Сейчас в плане сразу действия. Добавь отдельный блок:
  - какие поля реально применяются в каждой форме
  - какие поля только показываются в diff, но не сохраняются
  - какие existing components/services переиспользуются
  - что не создаются новые таблицы/миграции  
  Safe workflow обязателен: `DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY`.
9. **Добавь duplication prevention.**  
Перед новым кодом нужно явно переиспользовать уже созданные элементы:
  - `StructuredAddressBlock`
  - `useGrpLookup`
  - Phase 2 address adapters
  - existing canonical payload helpers  
  Это обязательное правило против дублирования.
10. **Добавь VERIFY/DoD по факту хранения, а не только по UI.**  
Нужны пруфы:

- до confirm
- после confirm
- после save
- после reopen  
И отдельно подтвердить:
- `leg_org_form` хранится в полном виде
- `leg_name` хранится без формы и без кавычек
- адрес из МНС разложен по ячейкам
- legacy string согласована с canonical JSONB
- `AdminExecutors` не ломает текущий save flow

11. **Audit logging добавить хотя бы для apply из МНС.**  
Это критическая операция автозаполнения и по правилам должна логироваться в `audit_logs`.  
Минимум:

- apply from GRP confirm
- actor_type system/user по вашей текущей схеме
- какие поля были изменены

Итоговый ключевой выбор для вставки в план:

- `leg_org_form` хранить **в полном виде**, не в сокращении
- `leg_name` хранить **без формы и без кавычек**
- `registration_date / tax_office_*` **не сохранять в БД в этом PATCH**, пока не подтверждено место хранения
- flat address МНС разбирать через **отдельный adapter/parser** в `StructuredAddress`
- PATCH 3.1 закрывает: dialog UI + full apply + canonical name/form normalization + structured address apply + verify/save/reopen proof
- &nbsp;
- План: Phase 3.1 — PATCH-пакет: GRP autofill + StructuredAddress

## Проблемы (DIAGNOSE)

1. **GrpConfirmDialog**: `truncate` и `max-w-[140px]` обрезают текст; модалка `max-w-lg` слишком узкая
2. **handleGrpConfirm** во всех 3 формах применяет только `name`/`short_name`, игнорируя address, registration_date, tax_office_*, status_*
3. **Нет парсинга org form** из `full_name` МНС (например `Закрытое акционерное общество "АЖУР инкам"` → form + name)
4. **Нет парсинга адреса МНС** в structured-поля — адрес остается flat-строкой
5. `orgForms` в форме — короткие аббревиатуры (`ООО`, `ЗАО`), нет маппинга из полных форм МНС

## Файлы и изменения

### 1. `src/lib/legal-entities/GrpAutofillService.ts` — расширить service layer

**Добавить:**

- `parseOrgFormAndName(fullName)` — выделяет org form и чистое название:
  - словарь полных форм → коротких (`Закрытое акционерное общество` → `ЗАО`, `Общество с ограниченной ответственностью` → `ООО`, и т.д.)
  - убирает кавычки из названия
  - возвращает `{ orgForm: string, cleanName: string }`
- `parseGrpAddress(flatAddress)` — разбирает типичный формат МНС `г. Минск,ул. Панфилова, д.2, оф. 123` в `StructuredAddress`:
  - regex для `г.`/`город` → city
  - regex для `ул.`/`улица`/`пр.`/`проспект` → street
  - regex для `д.`/`дом` → house
  - regex для `корп.`/`к.` → building
  - regex для `оф.`/`кв.` → apartment
  - source = `'grp'`
- Расширить `GrpAutofillFields` добавив `org_form`, `clean_name` (derived fields)
- Обновить `grpDataToAutofillFields` — вызывать `parseOrgFormAndName` и `parseGrpAddress` внутри

### 2. `src/components/legal-details/GrpConfirmDialog.tsx` — UI fix

- `max-w-lg` → `max-w-2xl`
- Убрать `truncate` и `max-w-[140px]` со старых значений
- Убрать `truncate` с новых значений
- Заменить `flex items-center` на `flex flex-col items-start` для diff-строк
- `max-h-64` → `max-h-96`
- Старое значение и новое — каждое на своей строке, с `break-words`

### 3. `src/components/legal-details/LegalEntityDetailsForm.tsx` — полный apply

**handleGrpConfirm:**

- Применять `org_form` → `leg_org_form` (через маппинг полная→короткая)
- Применять `clean_name` → `leg_name` (без кавычек, без формы)
- Применять `short_name` → `leg_name` fallback
- Применять parsed address → `setAddress(parsedStructured)` + `setAddressSource('grp')`
- Применять `registration_date`, `tax_office_code`, `tax_office_name` — сохранять в отдельных полях (нужно добавить в form schema или в side-state)

**Проблема:** registration_date, tax_office_code/name не имеют полей в текущей форме. Решение: сохранять их при submit через дополнительный state, но не показывать в форме (они пойдут в БД через onSubmit).

### 4. `src/components/legal-details/EntrepreneurDetailsForm.tsx` — полный apply

Аналогично: `handleGrpConfirm` должен применять name, address (parsed), registration_date и прочие поля через side-state.

### 5. `src/pages/admin/AdminExecutors.tsx` — полный apply

`handleGrpConfirm` (строка 245): добавить apply для address (parsed → setAddress), и прочих полей.

### 6. Нет новых таблиц, нет миграций

Все данные уже есть в существующих полях. `registration_date`, `tax_office_code`, `tax_office_name` для client_legal_details — нужно проверить, есть ли эти колонки в таблице.

## Порядок выполнения

1. Расширить `GrpAutofillService` (парсеры org form, name, address)
2. Исправить `GrpConfirmDialog` UI
3. Обновить `handleGrpConfirm` в 3 формах (LegalEntity, Entrepreneur, Executors)
4. VERIFY: скрины до/после

## DoD

- Текст в confirm-dialog читается полностью, без обрезания
- Apply заполняет: org form, clean name, short name, parsed address, registration_date, tax_office
- `leg_org_form` автоматически выбирается по данным МНС
- `leg_name` хранится без формы и без кавычек
- Адрес из МНС разложен по ячейкам в StructuredAddressBlock
- Legacy string пересчитывается из canonical при save
- Бизнес-логика (парсинг) в service layer, не в UI