# да, согласен, с учетом правок:

&nbsp;

1. **expires_at: NULL для всех исторических модульных покупок — не утверждать без proof.**
  Это самое рискованное место плана. Историческая модульная покупка может быть бессрочной, но это нужно подтвердить по источнику/паттерну этих заказов. Для Людмилы сейчас уже существует entitlement до 2026-08-30, и новый канонический repair не должен молча превратить такую запись в бессрочную.
  Нужно правило:
  &nbsp;
  - если entitlement уже есть → **не менять окно доступа** в repeat-proof;
  - для новых create сначала зафиксировать policy: NULL или derived expiry;
  - если policy не доказана, для cohort execute не идти.
  &nbsp;
2. **Нужен явный upsert-policy для случая existing inactive.**
  В dry-run сейчас reactivate = 0, но в функции это всё равно должно быть формализовано:
  &nbsp;
  - active → skip_active
  - expired/inactive → reactivate только с merge meta
  - revoked/cancelled/manual_blocked → manual_review, не auto-reactivate
    Иначе позже функция начнёт “чинить” опасные статусы.
  &nbsp;
3. **Для Людмилы proof должен быть не только skip_active, но и source trace preserved.**
  Так как запись уже создана неканонически, следующий шаг должен доказать:
  &nbsp;
  - repeat не создаёт дубль;
  - repeat не переписывает существующий meta.source_order_id/source_order_number;
  - repeat не меняет product_code, status, expires_at без необходимости.
  &nbsp;
4. **Нужен отдельный STOP-guard по дублям entitlements.**
  Перед execute функция должна проверять не только наличие записи, но и конфликт:
  &nbsp;
  - если на (user_id, module_product_id) уже **>1 entitlement** → manual_review;
  - никакого auto-merge/auto-delete.
    Это особенно важно для старых исторических данных.
  &nbsp;
5. **Phase 3 лучше формализовать как обязательный UI-proof, не “или data chain”.**
  Для этой задачи ключевой результат именно пользовательский: модуль должен появиться в кабинете вместе с курсом.
  Поэтому DoD лучше переформулировать так:
  &nbsp;
  - для Людмилы нужен **browser-proof**: одновременно виден cb20 и отдельный Производство;
  - data chain допустим только как промежуточный тех-proof, но не как финальное закрытие задачи.
  &nbsp;
6. **Нужно добавить в dry-run явный отчёт по module product names/codes.**
  Сейчас в плане есть UUID, но для проверки подрядчиком и человеком нужен нормальный вывод:
  &nbsp;
  - module_product_id
  - product_code
  - product_name
  - orders_count
  - first_order_number
  - action
    Иначе на cohort execute легко потерять контроль над тем, какой именно модуль чинится.
  &nbsp;
7. **7 multi-module orders нужно явно исключить из общего batch execute.**
  Не просто “вне scope”, а именно:
  &nbsp;
  - cohort execute работает только по module_list_mapped.length = 1;
  - multi-module cohort должна быть отдельным follow-up patch.
    Это надо прямо зафиксировать в execute-scope.
  &nbsp;
8. **По “Рознице” нужен финальный статус в отчёте, не только в плане.**
  Формулировка должна быть жёсткой:
  &nbsp;
  - not_restored
  - причина: no confirmed UUID purchase proof
    Чтобы потом это не было “забыто” при массовом прогоне.
  &nbsp;

&nbsp;

&nbsp;

В остальном план идёт в правильную сторону: сначала канонический repair path, потом repeat-proof на Людмиле, потом UI-proof, и только после этого cohort execute.

&nbsp;

План: Канонический repair-path для модульных entitlements

## Диагностика (текущее состояние)

### По Людмиле Демко

- **profile_id**: `2ab73923`, **user_id**: `eb39c79d` (это разные ID — profile_id != user_id)
- Entitlement на `cb_module_production` (`064dd768...`) уже создан прямой вставкой: `id = 2687b521`, status = active, expires_at = 2026-08-30, meta.source_type = `historical_module_repair`
- Entitlement создан корректно, но не через канонический path — нужен idempotent canonical repair для proof

### По когорте

- **49 уникальных пользователей**, **120 заказов**, **7 модульных продуктов**
- Dry-run классификация: **74 create**, **23 skip_active**, **0 reactivate**
- 7 multi-module заказов ещё не разбиты (уже есть edge function `split-multi-module-orders`)
- Неизвестный модуль: `99f1f156` = ПВТ (2 пользователя)

### По видимости

- Training module `a4a5102d` (Производство) имеет `product_id = 064dd768`, `is_active = true`, без parent
- `useSidebarModules` проверяет entitlement.product_id == training_module.product_id — цепочка замкнута
- Людмила должна видеть модуль в кабинете уже сейчас

## Решение: 3 фазы

### Phase 1: Канонический edge function `repair-module-entitlements`

Новая edge function, не переиспользующая существующие repair-функции (они заточены под другую логику).

**Контракт:**

- Вход: `{ mode: "dry_run" | "execute", filter_user_id?: string }`
- Источник данных: `orders_v2` WHERE `purchase_snapshot.historical_purchase_type = 'module_only_standalone'` AND `module_list_mapped` содержит ровно 1 UUID
- Дедупликация: по `DISTINCT (user_id, module_product_id)` — один entitlement на пару
- Классификация действий:
  - `skip_active` — entitlement уже active
  - `reactivate` — entitlement существует, но не active → UPDATE status='active'
  - `create` — нет записи → INSERT
  - `manual_review` — конфликт данных (несколько разных UUID или malformed UUID)
- Idempotency: повторный вызов = 0 изменений (все попадают в skip_active)
- Audit: каждая запись → `audit_logs` с `actor_type='system'`, `actor_label='repair-module-entitlements'`, meta содержит `source_type`, `source_order_id`, `source_order_number`, `module_product_id`, `batch_id`
- Entitlement meta: `source_type = 'historical_module_repair'`, `source_order_id`, `source_order_number`, `repair_batch_id`
- product_code берётся из `products_v2.code` по `product_id`
- expires_at: NULL (бессрочный — исторические покупки без срока)
- Hard rules:
  - multi-module orders (module_list_mapped.length > 1) → skip с пометкой `manual_review`
  - malformed UUID → skip
  - Никаких текстовых эвристик

**Файл:** `supabase/functions/repair-module-entitlements/index.ts`

### Phase 2: Repeat-proof на Людмиле

1. Вызвать `repair-module-entitlements` с `{ mode: "dry_run", filter_user_id: "eb39c79d-2588-4ab6-b831-7cd2d5a1641d" }`
2. Ожидаемый результат: 1 запись, action = `skip_active` (entitlement уже есть)
3. Вызвать с `{ mode: "execute", filter_user_id: "eb39c79d-..." }`
4. Ожидаемый результат: 0 изменений, repeat = 0

### Phase 3: Browser proof видимости модуля

Зайти в preview под Людмилой (если возможно) или проверить логически:

- `useSidebarModules` → entitlement на `064dd768` active → модуль `a4a5102d` (Производство) виден
- Курс cb20 одновременно виден (entitlement `73b9ae0f` на `7101ed3c` active)
- Если browser недоступен для non-admin, зафиксировать как `proven_by_data_chain` и запросить production screenshot

### Не входит в scope

- Массовый execute на 74 create — только после proof Phases 2-3
- inherited visibility (модули для покупателей полного курса) — отдельный спринт
- split multi-module orders (7 штук) — отдельно через существующую `split-multi-module-orders`
- Розница для Людмилы — нет доказательства покупки, не восстанавливается

## Изменяемые компоненты


| Компонент                                                | Действие                          |
| -------------------------------------------------------- | --------------------------------- |
| `supabase/functions/repair-module-entitlements/index.ts` | Создать новый                     |
| `entitlements`                                           | INSERT/UPDATE через edge function |
| `audit_logs`                                             | INSERT через edge function        |


## STOP-guards

- Не создавать entitlement без UUID из `module_list_mapped`
- Не обрабатывать multi-module orders (length > 1) автоматически
- Не использовать прямой SQL INSERT — только через edge function
- Repeat = 0 для Людмилы обязателен перед cohort execute

## DoD

1. Edge function `repair-module-entitlements` развёрнута и работает
2. Dry-run на Людмиле: `skip_active`, 0 изменений
3. Execute на Людмиле: repeat = 0
4. Видимость модуля Производство подтверждена (data chain или browser)
5. Курс cb20 не сломан
6. Розница: статус `not_restored — no purchase proof`