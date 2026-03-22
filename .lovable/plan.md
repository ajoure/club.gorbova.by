# да, согласен, с учетом правок:

&nbsp;

1. Validation trigger для role_type ↔ role_catalog_id нужен, это правильное исправление gap. Но лучше оформить это как **отдельную add-only догоняющую миграцию PATCH 2.x**, а не переписывать уже примененную миграцию задним числом.
2. В trigger-функции не делать два одинаковых SELECT подряд в RAISE.
  Сделать безопаснее:
  &nbsp;
  - сначала SELECT role_type INTO v_catalog_role_type ...
  - потом сравнение NEW.role_type <> v_catalog_role_type
  - если v_catalog_role_type IS NULL, выбрасывать отдельную ошибку
    Так функция будет чище и без повторных запросов.
  &nbsp;
3. В trigger обязательно оставить:
  &nbsp;
  - SECURITY INVOKER
  - SET search_path = public
    Это правильно и должно быть зафиксировано в миграции.
  &nbsp;
4. В docs/PATCH_2_DDL_[REPORT.md](http://REPORT.md) нужно добавить не просто описание trigger, а явный proof:
  &nbsp;
  - имя функции
  - имя trigger
  - на какие события навешан (BEFORE INSERT OR UPDATE)
  - на какую таблицу
  - зачем нужен
  - какой именно класс рассинхрона он запрещает
  &nbsp;
5. В proof-пакет PATCH 2 обязательно добавить:
  &nbsp;
  - список seed записей в legal_details_roles_catalog
  - список seed записей в legal_details_positions_catalog
  - список policy по всем 5 новым таблицам
  - список 6 CHECK constraints
  - список 4 partial unique indexes
    Иначе PATCH 2 останется “логически доказан”, но не полностью документирован.
  &nbsp;
6. После применения trigger-миграции отдельно зафиксировать, что:
  &nbsp;
  - существующие данные не конфликтуют с новым trigger
  - INSERT/UPDATE с корректным role_type проходят
  - INSERT/UPDATE с несовпадающим role_type падают ожидаемо
    Это нужно включить в DoD как proof-check.
  &nbsp;

&nbsp;

&nbsp;

После этих правок PATCH 2 можно будет считать закрытым полностью.

&nbsp;

PATCH 2 — Финальный proof-check + исправление gap

## Proof по каждому пункту

### 1. Schema proof — ПОДТВЕРЖДЁН

Миграция содержит все заявленные объекты. Фактический SQL верифицирован.

### 2. address_structured — ПОДТВЕРЖДЁН

`legal_details_persons` содержит только `address_structured JSONB`, без legacy `address_*` колонок. Отчёт фиксирует: "StructuredAddressBlock работает с JSONB напрямую". Это согласуется с canonical address persistence model (CanonicalAddressPayload).

### 3. CHECK constraints на links — ПОДТВЕРЖДЕНЫ (6 штук)

Из SQL миграции:

- `chk_share_percent_founder_only`: share_percent IS NULL OR role_type = 'founder'
- `chk_position_catalog_position_only`: position_catalog_id IS NULL OR role_type = 'position'
- `chk_custom_position_position_only`: custom_position_text IS NULL OR role_type = 'position'
- `chk_custom_role_other_only`: custom_role_text IS NULL OR role_type = 'other'
- `chk_position_exclusive`: position XOR custom (при role_type = 'position')
- `chk_other_has_text`: role_type = 'other' → custom_role_text NOT NULL

### 4. purpose/status CHECK — ПОДТВЕРЖДЕНЫ

- `chk_client_legal_details_purpose`: purpose IN ('billing', 'document')
- `chk_client_legal_details_status`: status IN ('active', 'archived')

### 5. Partial unique indexes — ПОДТВЕРЖДЕНЫ (4 штуки)

Все используют денормализованный `role_type` в WHERE predicate, без subquery, без UUID.

### 6. RLS — ПОДТВЕРЖДЁН для всех 5 таблиц

- persons: 5 policies (4 owner + 1 admin)
- roles_catalog: 2 (authenticated read + admin)
- positions_catalog: 2 (authenticated read + admin)
- links: 5 (4 owner + 1 admin)
- ai_chat_messages: 3 (2 owner + 1 admin)

### 7. Scope boundary — ПОДТВЕРЖДЁН

Отчёт явно фиксирует: hooks, UI, edge functions, setDefault, старые policy/indexes — не менялись.

---

## КРИТИЧЕСКИЙ GAP: role_type ↔ role_catalog_id синхронизация

**Проблема**: в миграции нет trigger или FK-constraint, гарантирующего что `role_type` в строке links совпадает с `role_type` в referenced `legal_details_roles_catalog` записи. Возможен рассинхрон:

- `role_catalog_id` → запись с role_type='position'
- `role_type` в строке links = 'founder'

Это делает все CHECK constraints и partial indexes логически хрупкими.

**Решение**: добавить validation trigger на INSERT/UPDATE в `legal_details_entity_person_links`, который проверяет `NEW.role_type = (SELECT role_type FROM legal_details_roles_catalog WHERE id = NEW.role_catalog_id)`.

---

## План действий

### Шаг 1: Миграция — добавить validation trigger

```sql
CREATE OR REPLACE FUNCTION public.validate_link_role_type()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.role_type != (SELECT role_type FROM public.legal_details_roles_catalog WHERE id = NEW.role_catalog_id) THEN
    RAISE EXCEPTION 'role_type mismatch: link.role_type=% but catalog.role_type=%',
      NEW.role_type, (SELECT role_type FROM public.legal_details_roles_catalog WHERE id = NEW.role_catalog_id);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_link_role_type
  BEFORE INSERT OR UPDATE ON public.legal_details_entity_person_links
  FOR EACH ROW EXECUTE FUNCTION public.validate_link_role_type();
```

### Шаг 2: Обновить docs/PATCH_2_DDL_REPORT.md

Добавить:

- Полный перечень CHECK constraints (6 шт) с точным SQL
- Полный перечень RLS policies по таблицам
- Секция "role_type consistency" — описание trigger
- Секция "address model decision" — обоснование JSONB-only
- Seed data перечень

### Файлы

- 1 новая миграция (validation trigger)
- `docs/PATCH_2_DDL_REPORT.md` — дополнение proof-секций

### DoD

- Trigger `trg_validate_link_role_type` создан
- Рассинхрон role_type ↔ role_catalog_id невозможен на уровне БД
- Отчёт содержит полный proof-пакет
- PATCH 2 закрыт