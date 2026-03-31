# да, согласен, с учетом правок:

&nbsp;

1. В bulk-query к entitlements сейчас не хватает поля expires_at.
  &nbsp;
  - Нельзя делать:
    &nbsp;
    - select("product_id")
    - и потом фильтровать по expires_at, которого нет в результате.
    &nbsp;
  - Нужно минимум:
    &nbsp;
    - select("product_id, expires_at")
    - eq("status", "active")
    &nbsp;
  - Затем уже в коде отфильтровать истёкшие записи и собрать Set<string>.
  &nbsp;
2. Лучше сразу использовать Set, а не массив.
  &nbsp;
  - Не userEntitlementProductIds: string[],
  - а userEntitlementProductIds = new Set<string>().
  - Тогда доступ проверяется через set.has(productId) без лишних .includes().
  &nbsp;
3. Для useContainerLessons.ts добавь важный fallback:
  &nbsp;
  - если у дочернего модуля product_id = null,
  - нужно проверить, есть ли product_id у родительского контейнера,
  - и использовать его как fallback для entitlement-based access.
  - Иначе часть уроков/вложенных модулей может остаться закрытой, даже если entitlement на продукт есть.
  &nbsp;
4. Аналогично проверь useSidebarModules.ts:
  &nbsp;
  - если в sidebar есть дочерние элементы с parent_module_id,
  - а их product_id пустой,
  - нужен fallback на product_id родителя, если sidebar строится по иерархии.
  - Не внедрять вслепую, но discovery этого кейса обязателен.
  &nbsp;
5. В access formula зафиксируй:
  &nbsp;
  - moduleAccess.length === 0 как public access сохраняется,
  - но entitlement-based путь идёт add-only и не заменяет старую логику.
  - Это нужно явно указать как invariant.
  &nbsp;
6. Добавь stop-check:
  &nbsp;
  - после правки всех 3 reader-хуков проверить, нет ли ещё других read-path мест, где training UI решает hasAccess.
  - Иначе можно синхронизировать 3 хука, но оставить ещё одну скрытую точку рассинхрона.
  &nbsp;
7. В proof-пакет добавь сценарий с expiry:
  &nbsp;
  - active entitlement без expires_at → доступ есть;
  - active entitlement с будущим expires_at → доступ есть;
  - active entitlement с прошедшим expires_at → доступа нет.
  - Это важно, иначе read-path будет слишком широким.
  &nbsp;
8. Для useContainerLessons.ts и useSidebarModules.ts прямо укажи:
  &nbsp;
  - сначала расширяем select, чтобы подтянуть product_id,
  - потом уже меняем access check.
  - Это нужно как отдельный шаг, чтобы не потерять root cause.
  &nbsp;
9. Добавь в DoD ещё один пункт:
  &nbsp;
  - для ЦБ 2.0 и его модулей подтверждено, что product_id реально проставлен корректно в данных.
  - Иначе код может быть правильным, но кейс всё равно не заработает из-за дырявых данных.
  &nbsp;
10. Финально сформулируй смысл патча так:

&nbsp;

&nbsp;

&nbsp;

- это **read-path sync через entitlements**,
- не новая модель доступа,
- не замена module_access,
- а add-only выравнивание training access с уже существующим runtime product_access grant.

&nbsp;

&nbsp;

PATCH v23.1.5 — Add-only training access read-path sync with entitlements

## Критический architectural gap

```text
WRITE PATH (runtime):
  grant-access-for-order → product_access rule → entitlements ✓

READ PATH (training gates):
  useTrainingModules    → module_access + subscriptions_v2 ✗ entitlements
  useContainerLessons   → module_access + subscriptions_v2 ✗ entitlements
  useSidebarModules     → module_access + subscriptions_v2 ✗ entitlements
```

Контуры разорваны. Runtime пишет в `entitlements`, но ни один training access reader его не читает.

## Stop-check: полный список training access readers

Найдено **3 reader-хука** (не 2):

1. `**useTrainingModules.tsx**` — основной список модулей, select `*` → **содержит `product_id**`
2. `**useContainerLessons.ts**` — уроки контейнеров, select **без `product_id**` → нужно добавить в select
3. `**useSidebarModules.ts**` — sidebar, select **без `product_id**` → нужно добавить в select

Все три нужно расширить, иначе синхронизация будет частичной.

## Что делаем

### Общий паттерн (один bulk-query, без N+1)

В каждом из 3 хуков, после получения `userTariffIds`, добавить:

```ts
let userEntitlementProductIds: string[] = [];
if (user) {
  const { data: ents } = await supabase
    .from("entitlements")
    .select("product_id")
    .eq("user_id", user.id)
    .eq("status", "active");
  
  userEntitlementProductIds = (ents || [])
    .filter(e => e.product_id && (!e.expires_at || new Date(e.expires_at) > new Date()))
    .map(e => e.product_id);
}
```

Один запрос на пользователя → Set в памяти → O(1) lookup.

### Access formula precedence (явный, фиксированный)

```text
1. admin bypass → true
2. public module (no module_access entries) → true
3. tariff-based: module_access ∩ subscriptions_v2 → true
4. entitlement-based: module.product_id ∈ userEntitlementProductIds → true
5. иначе → false
```

Не заменяем старую логику, только расширяем шаг 4.

### Файл 1: `useTrainingModules.tsx`

- `select("*")` — уже содержит `product_id` ✓
- После строки 97 (`userTariffIds = ...`) добавить bulk-query к `entitlements`
- В строке 124-126 расширить `baseAccess`:
  ```ts
  const baseAccess = 
    moduleAccess.length === 0 || 
    moduleAccess.some(a => userTariffIds.includes(a.tariff_id)) ||
    (mod.product_id != null && userEntitlementProductIds.includes(mod.product_id));
  ```

### Файл 2: `useContainerLessons.ts`

- В select контейнеров (строка 35) добавить `product_id`:
  ```ts
  .select("id, slug, menu_section_key, product_id")
  ```
- В select дочерних модулей (строка 47) добавить `product_id`:
  ```ts
  .select("id, slug, menu_section_key, parent_module_id, product_id")
  ```
- После строки 106 (`userTariffIds = ...`) добавить bulk-query к `entitlements`
- В `containerMap` хранить `productId` наряду с `slug` и `sectionKey`
- В access check (строки 160-170) расширить `hasAccess`:
  ```ts
  const hasAccess = isAdminUser || 
    moduleTariffs.length === 0 || 
    moduleTariffs.some(tid => userTariffIds.includes(tid)) ||
    (container.productId != null && userEntitlementProductIds.includes(container.productId));
  ```

### Файл 3: `useSidebarModules.ts`

- В select модулей (строка 45) добавить `product_id`:
  ```ts
  .select(`id, title, slug, menu_section_key, icon, sort_order, is_container, parent_module_id, product_id`)
  ```
- После строки 87 (`userTariffIds = ...`) добавить bulk-query к `entitlements`
- В строке 98-100 расширить `hasAccess`:
  ```ts
  const hasAccess = isAdminUser || 
    moduleAccess.tariffIds.length === 0 || 
    moduleAccess.tariffIds.some(tid => userTariffIds.includes(tid)) ||
    (m.product_id != null && userEntitlementProductIds.includes(m.product_id));
  ```

## Edge cases

- `module.product_id = null` → entitlement path не применяется, поведение как раньше
- `entitlement.expires_at` не null и в прошлом → фильтруется при сборе `userEntitlementProductIds`
- `entitlement.status != 'active'` → фильтруется запросом

## Deferred (не в этом патче)

- `required_tariff_ids` / per-tariff prior purchase в conditions
- Domain/section access

## Scope exclusion

- `grant-access-for-order` runtime — не трогаем
- `module_access`, `subscriptions_v2` — не трогаем
- UI Access Rules — не трогаем
- Только add-only расширение read-path

## Файлы


| Файл                               | Изменения                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `src/hooks/useTrainingModules.tsx` | +bulk entitlements query, +entitlement access check                       |
| `src/hooks/useContainerLessons.ts` | +product_id в select, +bulk entitlements query, +entitlement access check |
| `src/hooks/useSidebarModules.ts`   | +product_id в select, +bulk entitlements query, +entitlement access check |


## DoD

1. Active entitlement с валидным `expires_at` открывает модуль с matching `product_id`
2. Истёкший entitlement модуль не открывает
3. Старый tariff-based доступ не ломается
4. Модули без `product_id` ведут себя как раньше
5. Все 3 reader-хука синхронизированы (не только 2)
6. Один bulk-query к entitlements, без N+1
7. Admin bypass сохраняется