# План: PATCH 3 — Pre-execute подготовка к импорту ЦБ 2.0

Язык: русский. Разделён на две независимые части.

---

## PATCH 3A — Создание flow records + alias mapping

### Проблема

Таблица `flows` пуста (0 записей). CSV содержит потоки 16/18/19 (17 поток отсутствует в CSV). Без flow records невозможно маппить base_tariff_purchase строк. 2 строки с модулем `Перевозки` не маппятся.

### Диагностика

- `flows` count: **0 записей**
- `product_id` для ЦБ 2.0: `7101ed3c-7839-4a74-ad95-aa0660369b22`
- CSV потоки: `18 поток` (110 строк), `19 поток` (9 строк)
- **17 поток: NOT FOUND IN CSV** — ни одной строки
- 271 строка `no_flow_base_purchase`, из них 172 до 2024-07-25 → кандидаты на 16 поток

### Решение

#### 3A.1 — Dry-run: вычисление дат потоков

Результат dry-run (артефакт: `/mnt/documents/patch3_flow_dry_run.txt`):

```text
18 поток: 2024-07-25 .. 2025-03-25 (110 rows) → READY FOR INSERT
19 поток: 2025-06-13 .. 2025-07-21 (9 rows)   → READY FOR INSERT
17 поток: NOT FOUND IN CSV                     → REQUIRES USER DECISION
16 поток: 2024-05-14 .. 2024-07-24 (172 cand.) → PENDING USER APPROVAL
```

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

#### 3A.3 — Execute-логика по потокам

- **18 + 19** — базовый пакет flow records (INSERT сразу после approval дат)
- **16 поток** — создаётся УСЛОВНО, только после отдельного утверждения dry-run и решения пользователя по 172 кандидатам
- **17 поток** — отсутствует в CSV. Требуется решение пользователя: создавать ли пустой flow record или пропустить

#### 3A.4 — Alias mapping

```text
CSV module name:    "Перевозки"
Canonical name:     "Грузо- и пассажироперевозки"
child_product_id:   64d9f812-617c-41a8-b3dc-bb113156d6f3
public_id:          PRD-000022
Affected rows:      ровно 2 строки (proof в patch3_flow_dry_run.txt, Section 4)
```

### STOP-guards

- Если `flows` table не пуста → STOP
- Если `product_id` не найден → STOP
- Если MIN/MAX даты невалидны или пересекаются аномально → STOP

### DoD

1. Dry-run артефакт с датами потоков создан и утверждён пользователем
2. Flow records для 18 + 19 в `flows` с полным proof (id, product_id, code, name, start_date, end_date, is_active, is_default, meta)
3. Решение по 16 и 17 потокам принято и задокументировано
4. Alias `Перевозки` → `Грузо- и пассажироперевозки` зафиксирован (2 строки, proof в dry-run)

### Артефакты

- `/mnt/documents/patch3_flow_dry_run.txt` ✅ (создан)
- `/mnt/documents/patch3_flow_records.txt` (после execute)

---

## PATCH 3B — Resolution по manual_review (read-only)

### Проблема

108 строк не классифицированы: 99 + 2 + 7.

### Решение

#### 3B.1 — Breakdown 99 no_flow_base_purchase после 2024-07-25

Результат анализа (артефакт: `/mnt/documents/patch3_manual_review_groups.txt`, Секция 1):

По положению относительно границ потоков:
- внутри 18: **53 строки** → recommended_flow = 18
- после 19 потока: **46 строк** → 32 строки recommended_flow = 19 (delta ≤ 30d), 14 строк recommended_flow = null (too far)

#### 3B.2 — Proof: 2 строки `Бизнес-леди Сотрудник`

Полный proof в артефакте (Секция 2):
- Оба email: @ajoure.by (корпоративный домен)
- amount = 0.0, offer_type = free_access
- created_at: 2025-03-25 (обе)
- Вероятно: служебные/сотрудничные выдачи

#### 3B.3 — Proof: 7 строк пустой тариф без модулей

Полный proof в артефакте (Секция 3):
- 3 уникальных клиента
- 5/7 строк — Ирина Лапикова (irena2714@yandex.ru), по 307 BYN, ежемесячно с 2025-09 по 2026-01
- Паттерн: регулярные ежемесячные платежи → вероятно рассрочка/подписка

### STOP-guards

- Если количество строк в manual_review изменилось (не **108**) → STOP ✓
- Если CSV файл отличается от batch_id `PATCH2-DRY-20260328T212119Z` → STOP ✓

### DoD

1. Артефакт `/mnt/documents/patch3_manual_review_groups.txt` с тремя секциями и полными proof-блоками
2. Breakdown 99 строк вычислен с рекомендациями по подгруппам
3. Proof по 2 строкам `Бизнес-леди Сотрудник` — подготовлен с customer_name, phone, product raw
4. Proof по 7 строкам пустой тариф — подготовлен с grouped summary и source_order_number
5. Proof по 3 группам подготовлен и вынесен на решение пользователя

### Артефакты

- `/mnt/documents/patch3_manual_review_groups.txt` ✅ (создан)

---

## Итоговый статус PATCH 3

```text
PATCH 3A — ready for dry-run now, execute only after approval дат потоков и отдельного решения по 16 и 17 потокам
PATCH 3B — ready to present proof and collect decisions on 108 строк
```

PATCH 3A не зависит от PATCH 3B — можно выполнять параллельно.

### Открытые вопросы (требуют решения пользователя)

**PATCH 3A:**
1. Утвердить даты 18 поток (2024-07-25 .. 2025-03-25) и 19 поток (2025-06-13 .. 2025-07-21)?
2. Создавать ли 16 поток (2024-05-14 .. 2024-07-24) для 172 кандидатов?
3. 17 поток отсутствует в CSV — создавать пустой flow record или пропустить?

**PATCH 3B:**
4. 53 строки внутри 18 потока → recommended_flow = 18. Согласны?
5. 32 строки после 19 потока (delta ≤ 30d) → recommended_flow = 19. Согласны?
6. 14 строк далеко от потоков → flow = null. Согласны?
7. 2 строки Бизнес-леди Сотрудник (@ajoure.by, amount=0) — skip или импорт?
8. 7 строк пустой тариф (5 от Лапиковой — ежемесячные 307 BYN) — skip или manual mapping?
