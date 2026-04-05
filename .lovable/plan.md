## да, согласен, с учетом правок:

&nbsp;

1. Не перезаписывать 06_сверка_ui_с_csv.csv. Сделать add-only:
  &nbsp;
  - либо 06_сверка_ui_с_csv_filled.csv
  - либо 08_proof_ui_vs_csv.csv
    Исходный файл-заглушку оставить как артефакт discovery.
  &nbsp;
2. В шаге 1 считать отдельно 3 proof-метрики, а не одну общую:
  &nbsp;
  - ContactDetailSheet
  - UserSubscriptions
  - BulkExtendPreview
    Для каждого источника нужны колонки:
  - ожидалось_по_predicate
  - фактически_в_ui
  - расхождение
  - статус
  &nbsp;
3. Для BulkExtendPreview нельзя подставлять глобальный count валидных подписок. Там база — выбранные сделки. Нужен отдельный proof на фиксированном тестовом наборе сделок:
  &nbsp;
  - сколько применить
  - сколько заблокировано
  - сколько пропустить
  &nbsp;
4. В шаге 2 по расхождению 304 → 10 добавить отдельный proof-файл, например:
  &nbsp;
  - 09_proof_304_vs_10.csv
    С явной раскладкой:
  - 304 = сделки orders_v2, где есть entitlement, но нет subscription
  - 10 = записи subscriptions_v2 со статусом active/trial, не проходящие strict predicate
    И отдельной строкой: это разные сущности, числа напрямую не сравниваются.
  &nbsp;
5. В шаге 3 для runtime-proof нужны 3 сценария, а не 2:
  &nbsp;
  - валидная сделка → применить
  - продукт без active rule → заблокировано
  - историческая/истекшая покупка → заблокировано
    Это разные guards, оба должны быть доказаны.
  &nbsp;
6. В runtime-proof execute подтвердить не только лог вызова edge function, но и результат в данных:
  &nbsp;
  - срок до execute
  - срок после execute
  - orderId
  - что изменение прошло через grant-access-for-order
  &nbsp;
7. Добавить отдельный grep/proof-файл по коду:
  &nbsp;
  - в BulkExtendAccessDialog.tsx отсутствует .from("subscriptions_v2").update(
  - отсутствуют прямые update/insert в subscriptions_v2 и entitlements
    Это должен быть отдельный артефакт, не просто текстовое утверждение.
  &nbsp;
8. В proof по Фазе В отдельно зафиксировать, что predicate реально проверяет все 5 условий:
  &nbsp;
  - status in ('active','trial')
  - срок не истек
  - есть active rule по product_id
  - products_[v2.is](http://v2.is)_active != false
  - [tariffs.is](http://tariffs.is)_active != false
  &nbsp;
9. В финальном отчете разделить доказательства на 3 блока:
  &nbsp;
  - доказано кодом
  - доказано SQL/CSV
  - доказано runtime/UI
    И отдельно блок:
  - остается заблокированным / только discovery
  &nbsp;
10. Фазы В и Г считать закрытыми только после 4 proof-пакетов:

&nbsp;

&nbsp;

&nbsp;

- proof_query_joins
- proof_no_direct_update
- proof_ui_counts_match
- proof_runtime_preview_execute

&nbsp;

&nbsp;

&nbsp;

11. В разделе “Файлы для изменения” указать add-only набор:

&nbsp;

&nbsp;

&nbsp;

- новый proof CSV для UI-сверки
- новый proof CSV по 304 vs 10
- новые proof-файлы по runtime/grep
  Код без изменений, если в ходе proof не найдено отклонений.

&nbsp;

&nbsp;

&nbsp;

12. Фаза Б без изменений остается заблокированной. В этом пакете не делать никаких data-fix, даже точечных.

&nbsp;

&nbsp;

План: Закрытие proof-пакета по Фазам В и Г

### Контекст и статус

**Что подтверждено кодом и данными:**

1. **Единый predicate** (`useAccessValidation.ts`) подключён в 3 местах:
  - `ContactDetailSheet.tsx` (строки 12, 1408-1413) — `isCurrentValidAccess` / `isHistoricalAccess`
  - `UserSubscriptions.tsx` (строки 17, 105-110) — аналогично
  - `BulkExtendAccessDialog.tsx` (строки 4, 120-125) — `checkExtendEligibility` → внутри вызывает `isCurrentValidAccess`
2. **Query joins** подтверждены в коде:
  - `ContactDetailSheet.tsx:463-464`: `products_v2(id, name, code, telegram_club_id, is_active), tariffs(id, name, code, ..., is_active)`
  - `UserSubscriptions.tsx:32-34`: `products_v2(id, name, code, is_active), tariffs(id, name, code, is_active)`
  - `BulkExtendAccessDialog.tsx:82`: `products_v2(id, name, is_active), tariffs(id, name, is_active)`
3. **Прямой update `subscriptions_v2` убран** из `BulkExtendAccessDialog` — вместо этого строки 162-168 вызывают `supabase.functions.invoke("grant-access-for-order", ...)`
4. **Edge function `grant-access-for-order**` существует и используется по всей системе (bepaid-webhook, admin-manual-charge, test-payment-direct)
5. **Расхождение 304 → 10 объяснимо:**
  - Batch v2 (`_9c682588`) считал по **сделкам** (orders_v2): 304 сделки, у которых есть entitlement, но нет подписки
  - Batch v3 (`_4e1f607b`) считает по **подпискам** (subscriptions_v2): 10 подписок со статусом active/trial, но без правила доступа
  - Подтверждено SQL: 9 подписок на продукт «Подоходный налог ИП» (нет active rule) + 1 trial с истёкшим сроком = 10
6. `**06_сверка_ui_с_csv.csv**` — заглушка (все поля `фактически_в_ui = "—"`, `статус = ожидает_проверки`)

---

### Что нужно сделать

#### Шаг 1. Заполнить `06_сверка_ui_с_csv.csv` реальными числами

Пересчитать через SQL, используя **ту же логику**, что и predicate в коде:

```sql
-- Текущие валидные доступы (должны показываться в UI)
SELECT count(*) FROM subscriptions_v2 s
WHERE s.status IN ('active','trial')
AND (s.access_end_at IS NULL OR s.access_end_at > now())
AND s.product_id IN (SELECT product_id FROM access_rules WHERE is_active = true AND product_id IS NOT NULL)
AND NOT EXISTS (SELECT 1 FROM products_v2 p WHERE p.id = s.product_id AND p.is_active = false)
AND NOT EXISTS (SELECT 1 FROM tariffs t WHERE t.id = s.tariff_id AND t.is_active = false);
```

Результат записать в CSV для 3 источников: ContactDetailSheet, UserSubscriptions, BulkExtendPreview.

**DoD:** расхождение = 0 по всем 3 строкам.

#### Шаг 2. Добавить proof-запись по расхождению 304 → 10

В отчёт добавить отдельный блок:

- v2 batch считал **сделки** (orders_v2) с entitlements без подписок → 304
- v3 batch считает **подписки** (subscriptions_v2) без active rule → 10
- Это разные базовые сущности, поэтому числа не сопоставимы напрямую
- SQL proof: 9 записей «Подоходный налог ИП» (product_id `de36a695...`, нет active rule) + 1 expired trial

#### Шаг 3. Runtime-proof по Фазе Г

Выполнить 3 теста через `curl_edge_functions` или preview в UI:

1. **Preview валидной сделки** — сделка с `status=paid`, user с активной подпиской, продукт с active rule → ожидается `действие: применить`
2. **Preview заблокированной сделки** — сделка по продукту «Подоходный налог ИП» (нет active rule) → ожидается `действие: заблокировано, причина: нет_правила_доступа_в_системе`
3. **Execute одной валидной сделки** → подтвердить вызов `grant-access-for-order` через edge function logs

**DoD Фазы Г:**

- Proof по коду: `update subscriptions_v2` отсутствует в `BulkExtendAccessDialog.tsx` (подтверждено — строки 162-168 вызывают edge function)
- Proof по runtime: вызов `grant-access-for-order` зафиксирован в логах
- Preview корректно блокирует невалидные кейсы

#### Шаг 4. Финальный отчёт в 2 частях

**Часть 1 — Выполнено и доказано:**

- Фаза А v3: batch `20260405_160530_4e1f607b`, 7 CSV, counts подтверждены SQL
- Фаза В: predicate подключён в 3 компонентах, query с нужными joins, сверка counts
- Фаза Г: прямой update убран, вызов через edge function, preview + execute proof

**Часть 2 — Заблокировано:**

- Фаза Б: все подпатчи по данным заблокированы до dry-run

---

### Последовательность выполнения

```text
1. SQL-запрос для подсчёта текущих валидных доступов
2. Перезапись 06_сверка_ui_с_csv.csv с реальными числами
3. Runtime-тест BulkExtendAccessDialog (preview + execute)
4. Проверка edge function logs
5. Финальный отчёт
```

### Файлы для изменения

- `/mnt/documents/audit_v3_.../06_сверка_ui_с_csv.csv` — перезаписать реальными числами
- Код не меняется — всё уже корректно