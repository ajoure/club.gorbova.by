## да, согласен, с учетом правок:

1. В Stage 6.B исправить запрос по тестовым заказам:
  ```sql
  SELECT count(*), max(created_at)
  FROM public.orders_v2
  WHERE order_number LIKE 'ORD-TEST-%';

  ```
  `orders_v2.id` — UUID, поэтому `id LIKE 'ORD-TEST-%'` некорректен.
2. Для runtime-proof зафиксировать не только общие счётчики, но и отсутствие изменений у переданного dummy/существующего order:
  - `status`;
  - `paid_amount`;
  - `updated_at`;
  - `meta`;
  - количество связанных `payments_v2`.
  Вызов tombstone не должен менять конкретный заказ, даже если параллельно происходят другие операции.
3. В Stage 6.F нельзя автоматически ставить `PASS`, если найдено расхождение:
  - если все три инварианта подтверждены — `PASS`;
  - если найден дефект, но исправление отложено — `DEFERRED` с точным описанием риска;
  - `SPRINT: CLOSED` допустим только как осознанное закрытие с deferred backlog, без ложного `PASS`.
4. Проверка выручки должна быть семантической:
  - исключать `admin_grant` по `source/origin/meta.source`;
  - не использовать общий фильтр `provider <> 'admin'`, поскольку он одновременно исключит исторические `admin_from_payment`;
  - отдельно показать суммы и количество строк для обеих групп.
5. Перед применением Stage 6.G выполнить финальный preflight:
  - получить все текущие distinct `provider`;
  - проверить активные INSERT/UPDATE writer’ы;
  - подтвердить, что новые легитимные записи используют только `bepaid|stripe|rr|bank`.
  Исторические значения не блокируют миграцию, но активный неизвестный writer блокирует её применение.
6. Исправить UPDATE-ветку trigger-функции. Текущий код пропустит изменение provider на `NULL`, потому что SQL-выражение `NOT (NULL = ANY(...))` возвращает `NULL`:
  ```sql
  IF NEW.provider IS DISTINCT FROM OLD.provider THEN
    IF NEW.provider IS NULL OR NOT (NEW.provider = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'stage6g_provider_update_not_allowed: %→%',
        OLD.provider, NEW.provider
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  ```
7. Добавить тест:
  ```text
  T9: UPDATE provider с bepaid/admin_test → NULL → EXCEPTION

  ```
8. В тесте T5 использовать гарантированно существующее поле, например:
  ```sql
  UPDATE payments_v2
  SET meta = coalesce(meta, '{}'::jsonb) || '{"stage6g_test":true}'::jsonb

  ```
  Не использовать `notes`, пока наличие этой колонки не подтверждено.
9. Тестовые INSERT должны использовать полный валидный fixture с учётом фактических `NOT NULL`, FK и trigger-инвариантов `payments_v2`, а не минимальный набор предполагаемых колонок.
10. Усилить функцию trigger:
  ```sql
  CREATE OR REPLACE FUNCTION public.tg_payments_v2_provider_whitelist()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$

  ```
  Все обращения к объектам оставлять schema-qualified.
11. Финальный closeout должен отражать фактический результат:
  ```text
  STAGE 6.B RUNTIME : PASS
  STAGE 6.C PREVIEW : PASS / DML DEFERRED
  STAGE 6.F         : PASS либо DEFERRED
  STAGE 6.G         : PASS
  STAGE 6           : CLOSED
  SPRINT            : CLOSED

  ```
  Исторический DML, документы, subscriptions, entitlements и ledger не выполнять.
12. &nbsp;
13. План: Финальное закрытие Stage 6 и спринта

Все исторические DML отложены в backlog. Задача — доказательства (proofs) + один защитный триггер на будущее.

---

### Шаг 1. Stage 6.B Runtime Proof (10 минут)

**Цель:** доказать, что опубликованный tombstone `test-payment-complete` возвращает 410 и не создаёт побочных эффектов.

**Действия:**

1. Снимок счётчиков до вызова:
  - `SELECT count(*), max(created_at) FROM payments_v2 WHERE provider='admin_test'`
  - `SELECT count(*) FROM orders_v2 WHERE id LIKE 'ORD-TEST-%'`
2. Вызов `supabase--curl_edge_functions` → POST `/test-payment-complete` с dummy body и явным Authorization super_admin.
3. Ожидаем HTTP 410, `body.reason='stage6_b_disabled'`.
4. Повторный снимок тех же счётчиков — должен совпасть.
5. Артефакт: `.lovable/discovery/stage6b_runtime_proof.md` с request/response и before/after снимками.

**DoD:** статус 410, reason совпадает, дельта по `payments_v2`/`orders_v2` = 0.

---

### Шаг 2. Stage 6.F Proof без DML (15 минут)

**Цель:** подтвердить, что текущий runtime уже корректно классифицирует legacy-строки, изменения не требуются.

**Проверки (read-only через `supabase--read_query`):**

1. **Финансовая выручка не включает admin_grant:**
  - Найти канонические функции/вьюхи выручки (`rg -n "revenue|financial|gross" supabase/migrations` + inventory `pg_proc`).
  - Прогон агрегата на боевых данных с разбивкой по provider — убедиться, что admin_grant (201 строка) исключён (либо через фильтр `provider NOT IN`, либо через `is_deleted`, либо через `meta.source`).
2. **Исторические admin_from_payment учитываются:**
  - Тот же агрегат: 113 строк с `origin='admin_from_payment'` и non-null `queue_payment_id` попадают в выручку (или явно относятся к соответствующему каналу).
3. **UI-фильтр провайдеров:**
  - `rg -n "provider" src/pages/admin src/components/payment` для селектов провайдеров в админ-фильтрах.
  - Убедиться, что список опций = `bepaid|stripe|rr|bank` (без `admin`, `admin_test`, `admin_grant`, `admin_from_payment`).

**Если расхождений нет:** артефакт `.lovable/discovery/stage6f_proof.md` со ссылками на код и SQL-выборки. Никакого кода не менять.

**Если расхождение найдено:** зафиксировать в отчёте и вынести в backlog отдельным пунктом — в рамках этого спринта не чинить.

**DoD:** три пункта задокументированы с доказательствами; изменений в коде нет.

---

### Шаг 3. Stage 6.G — Guard-триггер на `payments_v2.provider` (30 минут)

**Цель:** запретить появление новых admin/admin_test/admin_grant/admin_from_payment строк, не ломая работу с историей.

**Миграция** (schema-only, без DML):

```sql
-- BEFORE INSERT OR UPDATE OF provider ON public.payments_v2
CREATE OR REPLACE FUNCTION public.tg_payments_v2_provider_whitelist()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_allowed constant text[] := ARRAY['bepaid','stripe','rr','bank'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.provider IS NULL OR NOT (NEW.provider = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'stage6g_provider_not_allowed: provider=% (allowed: %)',
        NEW.provider, v_allowed
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: разрешаем менять любые поля legacy-строк,
  -- но provider можно менять ТОЛЬКО в whitelist.
  IF NEW.provider IS DISTINCT FROM OLD.provider THEN
    IF NOT (NEW.provider = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'stage6g_provider_update_not_allowed: %→%',
        OLD.provider, NEW.provider
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payments_v2_provider_whitelist ON public.payments_v2;
CREATE TRIGGER trg_payments_v2_provider_whitelist
  BEFORE INSERT OR UPDATE OF provider ON public.payments_v2
  FOR EACH ROW EXECUTE FUNCTION public.tg_payments_v2_provider_whitelist();
```

Триггер срабатывает на UPDATE **только когда меняется колонка `provider**` (WHEN OF provider) → UPDATE любых других полей legacy admin/admin_test строк остаётся разрешённым.

**Тесты** (`supabase/tests/stage6g_provider_whitelist.sql`, ROLLBACK-обёртка):

- T1: INSERT `provider='bepaid'` → OK.
- T2: INSERT `provider='admin'` → EXCEPTION `stage6g_provider_not_allowed`.
- T3: INSERT `provider='admin_test'` → EXCEPTION.
- T4: INSERT `provider='admin_grant'` → EXCEPTION.
- T5: UPDATE legacy строки `provider='admin_test'` — поле `meta` / `notes` — OK.
- T6: UPDATE `provider` legacy строки с `admin_test` → `admin_test` (не меняется) — OK (WHEN OF срабатывает, но `IS DISTINCT FROM` = false).
- T7: UPDATE `provider` legacy строки с `admin_test` → `bank` — OK (миграция валидных данных в будущем возможна).
- T8: UPDATE `provider` с `bepaid` → `admin` → EXCEPTION.

**DoD:** миграция применена, все 8 тестов проходят, никакой существующей строки не изменено.

---

### Шаг 4. Финальный отчёт

Файл `.lovable/discovery/stage6_sprint_closeout.md` со сводкой:

```
STAGE 6.B RUNTIME : PASS   (ссылка на stage6b_runtime_proof.md)
STAGE 6.C PREVIEW : PASS / DEFERRED DML  (ссылка на stage6c_admin_test_preview.md)
STAGE 6.F         : PASS   (ссылка на stage6f_proof.md)
STAGE 6.G         : PASS   (миграция + тесты)
STAGE 6           : CLOSED
SPRINT            : CLOSED
```

Плюс раздел **Backlog** с перечислением 6 отложенных пунктов из сообщения пользователя.

---

### Явные не-действия (границы спринта)

- Не трогаем 8 `admin_test`, 113 `admin_from_payment`, 201 `admin_grant`.
- Не трогаем документы СА-26-00025 / СА-26-00026.
- Не трогаем `subscriptions_v2`, `entitlements`, `access_grant_ledger`.
- Не удаляем физически edge-функцию `test-payment-complete` (остаётся tombstone).
- Не меняем UI, кроме уже сделанного в Stage 6.B.

Все отчёты и коммуникация — на русском.