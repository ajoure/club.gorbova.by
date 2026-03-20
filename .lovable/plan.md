# да, согласен, с учетом правок:

1. **Раздели Phase 3 на стадии** `DRY RUN → EXECUTE → VERIFY`**.**  
Сейчас это только rollout-план. Нужно отдельно зафиксировать:
  - какие формы и save-path будут затронуты,
  - какие read-path перейдут на `structured first`,
  - какие legacy-поля остаются fallback,
  - какие риски обратной совместимости есть.  
  Workflow `DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY` обязателен.
2. **Не делай silent auto-apply по УНП.**  
Допустимо:
  - при 9 цифрах сделать lookup,
  - показать preview/diff,  
  но **запись в форму только после явного подтверждения**.  
  Это особенно важно для `LegalEntity`, `Entrepreneur`, `Executors`.
3. **Зафиксируй точный маппинг полей, которые разрешено заполнять из МНС.**  
Сейчас написано слишком широко: “название, адрес, и т.д.”  
Нужно отдельно перечислить:
  - заполняем: `unp`, `name`, `address`, `status`, `registration_date`, `tax_office`
  - не перетираем автоматически: вручную введённые поля без confirm
  - не трогаем без отдельного решения: директор, основания действия, внутренние служебные поля
4. **Вынеси rollout-логику из форм в service/adapters.**  
Формы не должны содержать бизнес-логику; интеграции должны идти через adapters.  
Добавь отдельные слои:
  - `GrpAutofillService`
  - compatibility adapters для каждой формы  
  А `LegalEntityDetailsForm`, `EntrepreneurDetailsForm`, `IndividualDetailsForm`, `AdminExecutors` должны только вызывать их.
5. **Добавь read-path rollout, а не только form rollout.**  
Сейчас план меняет только UI-формы, но этого мало.  
Нужно явно включить:
  - генерацию документов,
  - preview/шаблоны,
  - серверные функции, читающие адреса/реквизиты,  
  по правилу: `*_address_structured` → fallback на legacy.  
  Иначе формы будут писать по-новому, а чтение останется старым.
6. **Для физлица зафиксируй compatibility mapping подробнее.**  
Замена 7 полей на `StructuredAddressBlock` нормальная, но нужно явно описать:
  - как `country / country_code / building / google_place_id / lat / lng / source` живут в `ind_address_structured`,
  - как старые `ind_address_*` пересчитываются из canonical,
  - какие legacy-поля останутся обязательными для старых шаблонов.
7. **Добавь audit logging для критических автозаполнений.**  
Автозаполнение из Google/MNS и compatibility-save — критические операции, они должны логироваться в `audit_logs` с системной маркировкой.  
Особенно:
  - apply из GRP confirm dialog,
  - пересчёт legacy из canonical,
  - массовые/автоматические переприсвоения адресов
8. **Проверь, что** `AdminExecutors.tsx` **— действительно точка редактирования, а не только список.**  
Если форма редактирования живёт в другом компоненте/dialog, в плане надо указать именно фактический файл формы, а не страницу-обертку.
9. **Добавь DoD по каждой форме.**  
Не общий DoD, а по форме:
  - `LegalEntity`: lookup → diff → apply → save structured + legacy
  - `Entrepreneur`: lookup → diff → apply → save structured + legacy
  - `Individual`: Google autocomplete → save structured + recompute legacy
  - `Executors`: lookup/apply/save без поломки текущей админ-логики
10. **Явно зафиксируй scope: нет новых таблиц, только compatibility rollout поверх Phase 2.**  
Это соответствует стратегии `legacy → compatibility layer → canonical architecture` без поломки production.  
То есть:

- без новой `addresses` table,
- без backfill в этом этапе,
- без удаления старых полей,
- только rollout existing forms + read/write compatibility.

11. **Добавь проверку на дублирование перед реализацией.**  
По правилам перед новым кодом надо проверить таблицы, RPC, edge functions и UI-компоненты и переиспользовать существующие решения.  
Для этого в DRY RUN добавь отдельный блок:

- reuse existing `StructuredAddressBlock`
- reuse existing `useGrpLookup`
- reuse Phase 2 adapters/services
- не создавать второй lookup/dialog/input, если уже есть подходящий компонент

В остальном направление правильное: сначала rollout в 4 формы, потом уже отдельным этапом read-path cleanup/backfill/удаление legacy.

&nbsp;

План: Phase 3 — Rollout интеграций в существующие формы

## Обзор

Внедрить Google Maps автоподсказки и автозаполнение по УНП (МНС) во все 4 формы платформы, где вводятся адреса и/или УНП. УНП ставится первым полем для ЮЛ/ИП с пометкой, что остальные поля заполняются автоматически.

## Формы для изменения


| #   | Форма       | Файл                          | УНП       | Адрес                     | Что делаем                                               |
| --- | ----------- | ----------------------------- | --------- | ------------------------- | -------------------------------------------------------- |
| 1   | Юрлицо      | `LegalEntityDetailsForm.tsx`  | `leg_unp` | `leg_address` (строка)    | УНП первым + GRP автозаполнение + StructuredAddressBlock |
| 2   | ИП          | `EntrepreneurDetailsForm.tsx` | `ent_unp` | `ent_address` (строка)    | УНП первым + GRP автозаполнение + StructuredAddressBlock |
| 3   | Физлицо     | `IndividualDetailsForm.tsx`   | нет       | `ind_address_*` (7 полей) | Заменить 7 полей на StructuredAddressBlock               |
| 4   | Исполнитель | `AdminExecutors.tsx`          | `unp`     | `legal_address` (строка)  | УНП первым + GRP автозаполнение + StructuredAddressBlock |


## Что конкретно делаем

### 1. Юрлицо и ИП: УНП первым полем + GRP автозаполнение

- Переместить поле УНП **в самый верх** секции (перед названием)
- Добавить подпись: `УНП` с `FormDescription`: "Введите УНП — остальные данные заполнятся автоматически"
- При вводе 9 цифр — автоматический вызов `useGrpLookup`
- Показать **diff-preview**: какие поля будут заполнены (название, адрес, и т.д.)
- Кнопка «Заполнить» — только после подтверждения пользователем
- Без подтверждения данные в форму не вносятся (confirm-flow, silent overwrite запрещен)
- Заполняемые поля помечаются тегом "(автозаполнение)" пока данные получены из GRP

### 2. Адреса: замена Input на StructuredAddressBlock

- **Юрлицо/ИП/Исполнитель**: заменить одиночный `Input` адреса на `StructuredAddressBlock` (уже готовый компонент с Google autocomplete)
- **Физлицо**: заменить 7 отдельных полей `ind_address_*` на `StructuredAddressBlock`
- Google подсказки работают динамически при вводе >= 3 символов (без кнопки)

### 3. Сохранение: canonical JSONB + legacy compatibility

При сохранении формы:

- Писать structured данные в JSONB shadow-поле (`*_address_structured`)
- Одновременно пересчитывать legacy-строку: `formatFullAddress(structured) → legacy field`
- Сохранять `google_place_id`, `lat`, `lng`, `source` в JSONB для будущего использования

При загрузке формы:

- Если `*_address_structured` есть — читать из него
- Если нет — fallback на legacy поля/строку

### 4. Создать GRP Confirm Dialog

Новый компонент `GrpConfirmDialog` — показывает diff между текущими и найденными данными:

```text
┌─────────────────────────────────────────┐
│  Найдено в реестре МНС                  │
│                                         │
│  Название:  ООО "Тест" ← было пусто    │
│  Адрес:     г. Минск, ... ← было пусто │
│  Статус:    Действующий                 │
│                                         │
│  [Отмена]              [Заполнить]      │
└─────────────────────────────────────────┘
```

### 5. Создать адаптеры совместимости (Phase 3 adapters)


| Адаптер                      | Маппинг                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `IndividualAddressAdapter`   | `ind_address_*` (7 полей) ↔ `StructuredAddress` ↔ `ind_address_structured` JSONB  |
| `EntrepreneurAddressAdapter` | `ent_address` (строка) + `ent_address_structured` JSONB ↔ `StructuredAddress`     |
| `LegalEntityAddressAdapter`  | `leg_address` (строка) + `leg_address_structured` JSONB ↔ `StructuredAddress`     |
| `ExecutorAddressAdapter`     | `legal_address` (строка) + `legal_address_structured` JSONB ↔ `StructuredAddress` |


## Файлы


| Файл                                                       | Действие                                                |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| `src/lib/address/adapters/IndividualAddressAdapter.ts`     | Создать                                                 |
| `src/lib/address/adapters/EntrepreneurAddressAdapter.ts`   | Создать                                                 |
| `src/lib/address/adapters/LegalEntityAddressAdapter.ts`    | Создать                                                 |
| `src/lib/address/adapters/ExecutorAddressAdapter.ts`       | Создать                                                 |
| `src/components/legal-details/GrpConfirmDialog.tsx`        | Создать                                                 |
| `src/components/legal-details/LegalEntityDetailsForm.tsx`  | Переработать: УНП первым + GRP + StructuredAddressBlock |
| `src/components/legal-details/EntrepreneurDetailsForm.tsx` | Переработать: УНП первым + GRP + StructuredAddressBlock |
| `src/components/legal-details/IndividualDetailsForm.tsx`   | Переработать: StructuredAddressBlock вместо 7 полей     |
| `src/pages/admin/AdminExecutors.tsx`                       | Переработать: УНП первым + GRP + StructuredAddressBlock |


## Правила

- Canonical source of truth = `*_address_structured` JSONB
- Legacy поля пересчитываются из canonical через адаптер при каждом сохранении
- Silent overwrite запрещен — всегда confirm-flow с diff-preview
- `google_place_id` сохраняется в JSONB для будущего использования
- При ручной правке после Google/GRP: `source → 'manual'`, `last_verified_at → null`