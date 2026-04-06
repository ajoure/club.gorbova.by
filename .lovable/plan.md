## да, согласен, с учетом правок:

&nbsp;

1. **Не делай search_deal_rows как SETOF jsonb.**
  Лучше вернуть **табличную структуру с явными колонками**, чтобы не терять типизацию, сортировку и предсказуемость на клиенте.
  Иначе получите:
  &nbsp;
  - слабую типизацию
  - лишний парсинг
  - более хрупкий контракт между SQL и UI
  &nbsp;
2. **Нужно зафиксировать стабильную сортировку и в RPC поиска.**
  Не только в обычном query, но и в search_deal_rows:
  &nbsp;
  - ORDER BY deal_date DESC NULLS LAST, id DESC
  - LIMIT/OFFSET применять после этого
    Иначе в поиске и при Показать ещё строки могут прыгать.
  &nbsp;
3. **Counts RPC и rows RPC должны использовать один и тот же WHERE-блок буквально.**
  Не “похожую логику”, а один и тот же search/filter contract:
  &nbsp;
  - p_search
  - p_product_id
  - p_date_from
  - p_date_to
  - p_preset
    Иначе снова будет рассинхрон между counters и rows.
  &nbsp;
4. **В get_deal_tab_counts добавь тот же preset/filter contract, что и в rows.**
  Сейчас ты пишешь про общую семантику, но нужно явно зафиксировать:
  &nbsp;
  - counts считаются по той же отфильтрованной базе
  - tabs не должны показывать значения из другой логики поиска/фильтрации
  &nbsp;
5. **Нужен guard по производительности для поиска по ФИО.**
  Поиск через JOIN с profiles ок, но в плане нужно добавить:
  &nbsp;
  - тянуть только минимально нужные поля
  - не раздувать payload при поиске
  - payments_v2 не тащить “полным массивом”, если это можно безопасно сократить до минимально нужных полей/последнего платежа
  &nbsp;
6. **Показать ещё в режиме поиска нужно описать точнее.**
  Добавь:
  &nbsp;
  - при активном p_search вторая страница продолжает тот же result set
  - не сбрасывает search context
  - не смешивает результаты обычного списка и search-режима
  &nbsp;
7. **Нужен explicit anti-regression guard: без client-side fallback search.**
  Прямо запиши:
  &nbsp;
  - не возвращать buildSearchIndex
  - не искать по уже загруженным rows в браузере
  - поиск только server-side
  &nbsp;
8. **Добавь proof по имени и фамилии отдельно.**
  Не только “по ФИО работает”, а:
  &nbsp;
  - поиск по email
  - поиск по фамилии
  - поиск по имени
  - поиск по записи вне первых 100
    Это важный DoD.
  &nbsp;
9. **Добавь proof согласованности counts и rows.**
  Например:
  &nbsp;
  - один и тот же search term
  - count в табе
  - фактическая rows-выдача по этому же term
    Нужно показать, что после hotfix нет рассинхрона.
  &nbsp;
10. **Если search RPC вводится, то в AdminDeals.tsx надо явно сохранить два режима без лишнего дублирования логики.**
  Укажи:

&nbsp;

&nbsp;

&nbsp;

- без поиска — обычный lightweight paginated query
- с поиском — RPC search query
- общий UI/pagination contract один и тот же
  Иначе подрядчик может сделать две расходящиеся реализации.

&nbsp;

&nbsp;

В остальном план правильный и уже достаточно точный для исполнения.

&nbsp;

План: HOTFIX-DEALS-COUNTS-AND-NAME-SEARCH

### Контекст

Два подтвержденных бага:

1. `get_deal_tab_counts` RPC падает с 400 — невалидное значение enum `'cancelled'`
2. Поиск в Сделках не находит по ФИО — текущий `.or()` ищет только по `order_number`, `customer_email`, `customer_phone`, но не по `profiles.full_name` (PostgREST не поддерживает фильтрацию по related table fields внутри `.or()`)

### Root cause

**Fix 1**: Строка 44 в `get_deal_tab_counts` содержит `'cancelled'` — это не валидное значение enum `order_status` (допустимо только `'canceled'`).

**Fix 2**: PostgREST `.or()` на строке 197-199 в `AdminDeals.tsx` не может фильтровать по `profiles.full_name`, т.к. это поле из связанной таблицы. Supabase PostgREST не поддерживает `relation.column` внутри `.or()`. Поэтому поиск по ФИО полностью отсутствует в rows query. При этом в RPC `get_deal_tab_counts` поиск по `p.full_name` уже есть (строка 34), что создает рассинхрон между counts и rows.

### Решение

#### Fix 1 — SQL миграция

Пересоздать `get_deal_tab_counts` с исправлением строки 44:

```sql
WHERE status IN ('canceled', 'refunded')
```

#### Fix 2 — Поиск по ФИО: server-side RPC для rows

Поскольку PostgREST `.or()` не может работать с relation fields, нужно вынести поисковый запрос rows на SQL-сторону. Создать новую RPC `search_deal_rows`:

```text
search_deal_rows(
  p_search text,
  p_product_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_preset text,        -- 'all' | 'trial' | 'canceled' | 'imported'
  p_limit int,
  p_offset int
) RETURNS SETOF jsonb
```

Эта RPC:

- делает JOIN с profiles
- ищет по `order_number`, `customer_email`, `customer_phone`, `profiles.full_name`, `profiles.email` (ILIKE, case-insensitive)
- применяет те же фильтры preset/product/date что и клиентский код сейчас
- возвращает paginated результат с теми же JOIN-данными (products_v2, tariffs, profiles, payments_v2)
- использует **ту же search/filter семантику**, что и `get_deal_tab_counts`

В клиентском коде `AdminDeals.tsx`:

- когда `debouncedSearch` задан: использовать RPC `search_deal_rows` вместо прямого PostgREST запроса
- когда поиска нет: оставить текущий прямой PostgREST запрос (он работает корректно без name search)
- `useInfiniteQuery` адаптировать для обоих режимов: queryFn выбирает между RPC и прямым запросом

### Синхронизация search semantics

Обе RPC (`get_deal_tab_counts` и `search_deal_rows`) будут использовать одинаковый WHERE-блок:

```sql
(p_search IS NULL
 OR o.order_number ILIKE '%' || p_search || '%'
 OR o.customer_email ILIKE '%' || p_search || '%'
 OR o.customer_phone ILIKE '%' || p_search || '%'
 OR p.full_name ILIKE '%' || p_search || '%'
 OR p.email ILIKE '%' || p_search || '%')
```

### Изменяемые файлы


| Файл                             | Что меняется                                                            |
| -------------------------------- | ----------------------------------------------------------------------- |
| Новая SQL миграция               | Исправить enum в `get_deal_tab_counts` + создать `search_deal_rows` RPC |
| `src/pages/admin/AdminDeals.tsx` | В `buildDealsQuery` при наличии search использовать RPC вместо `.or()`  |


### STOP-guards

- Не менять auth, RLS, edge functions
- Не менять Phase A auth-fix
- Не ломать пагинацию / "Показать ещё" без search
- Не создавать client-side search workaround
- Не менять структуру таблиц

### DoD

1. `get_deal_tab_counts` возвращает 200 без ошибки enum
2. Tab counts отображаются в UI
3. Поиск по email работает
4. Поиск по фамилии работает (по всей БД)
5. Поиск по имени работает
6. Counts и rows согласованы при активном поиске по ФИО
7. "Показать ещё" работает в режиме поиска

### Обязательный proof

1. Поиск по email — строка найдена
2. Поиск по фамилии из первых 100 — найдена
3. Поиск по фамилии, которой нет в первых 100, но есть в БД — найдена
4. Network: `get_deal_tab_counts` возвращает 200
5. Network: counts и rows соответствуют одному search term