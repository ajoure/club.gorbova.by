# да, согласен, с учетом правок:

&nbsp;

1. В **PATCH 3A** дополни patch3_flow_dry_run.txt отдельным proof-блоком по alias Перевозки:
  &nbsp;
  - source_order_id
  - source_user_id
  - email
  - module_topics raw
  - mapped child_product_id = 64d9f812-617c-41a8-b3dc-bb113156d6f3
  - public_id = PRD-000022
  - итог: affected rows = 2
  &nbsp;
2. В **PATCH 3A** уточни execute-логику по потокам:
  &nbsp;
  - **17/18/19** — базовый пакет flow records
  - **16 поток** — создаётся **условно**, только после отдельного утверждения dry-run результата и решения пользователя по кандидатам на 16 поток
    Сейчас в тексте INSERT 4 flow records звучит как автоматическое создание всех четырёх.
  &nbsp;
3. В **PATCH 3B** для блока с **99 no_flow_base_purchase** добавь итоговую рекомендацию по каждой подгруппе:
  &nbsp;
  - recommended_flow = 16
  - или recommended_flow = 17
  - или recommended_flow = 18
  - или recommended_flow = 19
  - или recommended_flow = null
  - или manual_review
    Иначе proof есть, но нет готового предложения для принятия решения.
  &nbsp;
4. В **PATCH 3B** для **7 строк пустой тариф без модулей** добавь поле:
  &nbsp;
  - source_order_number
    Сейчас оно отсутствует, а потом понадобится для сопоставления с импортом.
  &nbsp;
5. Итоговый статус уточни так:
  &nbsp;
  - **PATCH 3A — ready for dry-run now, execute only after approval дат потоков и отдельного решения по 16 потоку**
  - **PATCH 3B — ready to present proof and collect decisions on 108 строк**
    Это точнее фиксирует зависимость именно по 16 потоку.
  &nbsp;

&nbsp;

&nbsp;

План: PATCH 3 — Pre-execute подготовка к импорту ЦБ 2.0

Язык: русский. Разделён на две независимые части.

---

## PATCH 3A — Создание flow records + alias mapping

### Проблема

Таблица `flows` пуста (0 записей). CSV содержит потоки 16/17/18/19. Без flow records невозможно маппить 388 base_tariff_purchase строк. 2 строки с модулем `Перевозки` не маппятся.

### Диагностика

- `flows` count: **0 записей**
- `product_id` для ЦБ 2.0: `7101ed3c-7839-4a74-ad95-aa0660369b22`
- CSV потоки: `16 поток`, `17 поток`, `18 поток`, `19 поток` + пустые
- 271 строка `no_flow_base_purchase`, из них 172 до 2024-07-25 → кандидаты на 16 поток

### Решение

#### 3A.1 — Dry-run: вычисление дат потоков

Python-скрипт по CSV:

- MIN/MAX `created_at` для 17, 18, 19
- Диапазон кандидатов для 16 потока
- Точные будущие значения `start_date` / `end_date` для всех 4 flow records

**Артефакт dry-run (до execute):**

- `/mnt/documents/patch3_flow_dry_run.txt` — вычисленные даты, диапазоны, будущие значения полей
- Пользователь утверждает даты **до** записи в БД

#### 3A.2 — Контракт полей flow records

```text
product_id  = 7101ed3c-7839-4a74-ad95-aa0660369b22
code        = potok-16 / potok-17 / potok-18 / potok-19
name        = 16 поток / 17 поток / 18 поток / 19 поток
start_date  = из dry-run
end_date    = из dry-run
is_active   = false
is_default  = false
meta        = { "source": "patch3_historical_import_setup" }
```

#### 3A.3 — Alias mapping

```text
CSV module name:    "Перевозки"
Canonical name:     "Грузо- и пассажироперевозки"
child_product_id:   64d9f812-617c-41a8-b3dc-bb113156d6f3
public_id:          PRD-000022
Affected rows:      ровно 2 строки
```

### Execute

1. INSERT 4 flow records с утверждёнными датами
2. Сохранить `/mnt/documents/patch3_flow_records.txt` — полный proof:
  - `id` (UUID)
  - `product_id`
  - `code`
  - `name`
  - `start_date`
  - `end_date`
  - `is_active`
  - `is_default`
  - `meta`

### STOP-guards

- Если `flows` table не пуста → STOP
- Если `product_id` не найден → STOP
- Если MIN/MAX даты невалидны или пересекаются аномально → STOP

### DoD

1. Dry-run артефакт с датами потоков создан и утверждён пользователем
2. 4 flow records в `flows` с полным proof
3. Alias `Перевозки` → `Грузо- и пассажироперевозки` зафиксирован (2 строки)

### Артефакты

- `/mnt/documents/patch3_flow_dry_run.txt` (до execute)
- `/mnt/documents/patch3_flow_records.txt` (после execute)

---

## PATCH 3B — Resolution по manual_review (read-only)

### Проблема

108 строк не классифицированы: 99 + 2 + 7.

### Решение

#### 3B.1 — Breakdown 99 no_flow_base_purchase после 2024-07-25

Группировки:

- по датам (месяц/квартал)
- по тарифам (тариф 1/2/3)
- по уникальным email / source_user_id
- по близости к потокам 17/18/19 (дельта дней: 0-7 / 8-30 / 31+)
- **по `created_at` относительно границ потоков:**
  - до начала 17 потока
  - внутри диапазона 17
  - между 17 и 18
  - внутри 18
  - между 18 и 19
  - внутри 19

#### 3B.2 — Proof: 2 строки `Бизнес-леди Сотрудник`

Поля для каждой строки:

- `source_order_id`
- `source_order_number`
- `source_user_id`
- `email`
- `customer_name`
- `phone`
- `created_at`
- `flow`
- `amount`
- `offer_type`
- `tariff raw`
- `product raw`

#### 3B.3 — Proof: 7 строк пустой тариф без модулей

Поля для каждой строки:

- `source_order_id`
- `source_user_id`
- `email`
- `customer_name`
- `phone`
- `created_at`
- `amount`
- `flow`
- `offer_type`

Плюс **grouped summary по клиентам**:

```text
клиент (email / source_user_id) │ строк │ диапазон дат │ сумма amount
────────────────────────────────┼───────┼──────────────┼─────────────
irena2714@yandex.ru / 287394699 │ 5     │ ...—...      │ ...
...                             │ ...   │ ...          │ ...
```

### STOP-guards

- Если количество строк в manual_review изменилось (не **108**) → STOP
- Если CSV файл отличается от batch_id `PATCH2-DRY-20260328T212119Z` → STOP

### DoD

1. Артефакт `/mnt/documents/patch3_manual_review_groups.txt` с тремя секциями и полными proof-блоками
2. Breakdown 99 строк по датам, тарифам, email, близости к потокам и положению относительно границ потоков — вычислен
3. Proof по 2 строкам `Бизнес-леди Сотрудник` — подготовлен
4. Proof по 7 строкам пустой тариф — подготовлен с grouped summary
5. Proof по 3 группам подготовлен и вынесен на решение пользователя

### Артефакты

- `/mnt/documents/patch3_manual_review_groups.txt`

---

## Итоговый статус PATCH 3

```text
PATCH 3A — ready to execute after dry-run approval дат потоков
PATCH 3B — ready to present proof and collect user decisions
```

PATCH 3A не зависит от PATCH 3B — можно выполнять параллельно.