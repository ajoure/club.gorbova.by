# да, согласен, с учетом правок:

&nbsp;

1. **PATCH 3 сделать единым shared-resolver и подключить в оба runtime-path сразу.**
  Не оставлять две независимые реализации. Один helper для prior_purchase, дальше только его вызовы в:
  &nbsp;
  - access-resolver.ts
  - grant-access-for-order/index.ts
  &nbsp;
2. **Для fallback по snapshot жёстко зафиксировать match только по одному UUID.**
  Условие:
  &nbsp;
  - historical_purchase_type = 'module_only_standalone'
  - module_list_mapped.length = 1
  - UUID совпадает с target module product_id
    Всё остальное — manual_review.
  &nbsp;
3. **Phase 3 по Людмиле оформить как отдельный PATCH “restore canonical historical order”.**
  Не просто “создать заказ”, а:
  &nbsp;
  - создать историческую запись с audit,
  - явно пометить источник как manual historical restore from owner proof,
  - не смешивать это с repair доступа.
    Это два разных действия: восстановление факта покупки и выдача доступа по правилу.
  &nbsp;
4. **Не править created_at у исторических заказов.**
  Если нужно восстановить дату покупки — использовать каноническое поле бизнес-даты (deal_date / paid_at / отдельное source date поле), но не системный created_at.
  Иначе сломаете техническую хронологию импорта.
5. **Для Людмилы сначала восстановить отсутствующую Розницу в orders_v2, потом только dry-run rules.**
  Иначе dry-run снова будет неполный и даст ложный вывод.
6. **Repair-entitlement не удалять до полного browser-proof replacement-path.**
  Порядок должен быть такой:
  &nbsp;
  - fix resolver,
  - restore missing Retail order,
  - dry-run,
  - canonical entitlements появились,
  - UI proof,
  - только потом выключать historical_module_repair.
  &nbsp;
7. **Canonical entitlements должны иметь явный trace, что они выданы rule-engine, а не repair-path.**
  В DoD добавить обязательные поля:
  &nbsp;
  - access_rule_id
  - source_subscription_id / источник BUSINESS
  - source_window_rule = align_with_source
  - срок = дата BUSINESS
    Без этого план не закрывать.
  &nbsp;
8. **Display fix распространить не только на админские сделки, но и на все contact/payment dialogs.**
  И в DoD добавить grep-proof, что все места используют один helper getDealDisplayName.
9. **Жёстко запретить в новом патче любые новые runtime-сравнения по cb20 / legacy code.**
  Добавить отдельный DoD:
  &nbsp;
  - grep-proof по изменённым файлам,
  - новая логика только на UUID/PRD/T/public IDs и snapshot UUID.
  &nbsp;
10. **Отдельно зафиксировать, что product_code и cb20 сейчас legacy-only.**
  Не удалять их в этом PATCH, но:

&nbsp;

&nbsp;

&nbsp;

- не использовать как основание для поиска,
- не использовать в rule resolution,
- не использовать в новых отчётах как первичный идентификатор.
  В отчёте первым всегда писать product_id и PRD-..., а legacy code только в скобках при необходимости.

&nbsp;

&nbsp;

&nbsp;

11. **Cohort execute не запускать в этом же патче.**
  Сначала:

&nbsp;

&nbsp;

&nbsp;

- Людмила proof-case,
- consolidated dry-run по всей когорте,
- отдельный final plan на mass execute.
  Это важно, чтобы снова не получить неверный массовый repair.

&nbsp;

&nbsp;

&nbsp;

12. **Финальный DoD по Людмиле дополнить:**

&nbsp;

&nbsp;

&nbsp;

- в админке сделки названы модулем,
- в доступах одновременно видны курс + Производство + Розница,
- сроки у модулей равны BUSINESS,
- repair-entitlement отключён,
- повторный прогон ничего не меняет.

&nbsp;

&nbsp;

Если подрядчик внесёт эти правки, можно продолжать именно по этому плану.

&nbsp;

План: Исправление prior_purchase resolver + display layer + данные Людмилы

## Диагностика

### Корневая проблема prior_purchase

Два места в коде проверяют prior_purchase:

1. `supabase/functions/_shared/access-resolver.ts` (строки 301-309) — `.eq('product_id', productToCheck)`
2. `supabase/functions/grant-access-for-order/index.ts` (строки 1030-1038) — `.eq('product_id', productToCheck)`

Оба ищут **только прямой match** `orders_v2.product_id = module_uuid`. Но у 120 из 127 исторических модульных заказов `product_id` указывает на родительский продукт (`7101ed3c`), а UUID модуля лежит только в `purchase_snapshot.module_list_mapped`.

**Результат**: правило `1b497fba` (BUSINESS → prior_purchase → модули) никогда не находит модульную покупку → доступ не выдаётся.

### По данным Людмилы Демко

Пользователь подтверждает 2 покупки:

- **2025-03-14**: Розничная торговля, 550 BYN → модуль `abee24cd` (Retail)
- **2025-05-19**: Производство, 350 BYN → модуль `064dd768` (Production)

В БД:

- Производство: 3 заказа (GC-3822722, GC-3823669, GC-3824629) — все с `module_list_mapped = [064dd768]`. Все три имеют одинаковый `created_at` (импорт).
- **Розница: 0 заказов** — нет ни одной записи с `module_list_mapped` содержащим `abee24cd`. Данные потеряны при импорте.

Текущие entitlements Людмилы:

- `club` (BUSINESS) → active до 05.05
- `cb20` (родительский курс) → active до 05.05
- `course_close_year` → active до 01.05
- `cb_module_production` (`064dd768`) → active до 30.08 (**repair-path, source_type = historical_module_repair** — некорректный срок)
- ещё 2 других продукта

### Терминология (жёсткое разделение)

- `product_id` = UUID (`064dd768-de8b-40db-89bc-f8d4a7e442ba`)
- `public_id` = PRD-000XXX (для отображения в UI)
- `display_name` = человекочитаемое имя из `products_v2.name` или `purchase_snapshot.display_purchase_name`
- `product_code` = legacy read-only field, **не используется в логике**

---

## Phase 1: Единый canonical prior_purchase resolver

### Задача

Вынести проверку prior_purchase в shared utility, который используют **все** runtime paths.

### Файл

`supabase/functions/_shared/check-prior-purchase.ts` — новый shared helper.

### Логика

```text
checkPriorPurchase(supabase, userId, targetProductId, excludeOrderId):
  1. Прямой match: orders_v2 WHERE user_id AND product_id = targetProductId AND status = 'paid'
  2. Если не найден — fallback:
     orders_v2 WHERE user_id AND status = 'paid'
       AND purchase_snapshot->>'historical_purchase_type' = 'module_only_standalone'
       AND (purchase_snapshot->'module_list_mapped')::jsonb @> '"targetProductId"'
  3. Возвращает: { found: boolean, order_id, match_type: 'direct' | 'module_list_mapped' | null }
```

### Потребители (заменить inline-код на вызов helper):

1. `access-resolver.ts` (строки 301-309)
2. `grant-access-for-order/index.ts` (строки 1030-1038)

### STOP-guards:

- Fallback только для `historical_purchase_type = module_only_standalone`
- Только UUID из `module_list_mapped`, никаких текстовых эвристик
- Если найден и прямой match, и module_list_mapped match — приоритет прямому
- `orders_v2.product_id` в исторических заказах **не менять**

---

## Phase 2: Display layer — полное покрытие

### Задача

Убедиться, что `getDealDisplayName` (уже исправлен для `module_only_standalone`) реально используется **во всех** экранах.

### Потребители (проверить/исправить каждый):


| Файл                                                           | Статус                                  |
| -------------------------------------------------------------- | --------------------------------------- |
| `src/pages/admin/AdminDeals.tsx`                               | передаёт `purchaseSnapshot` — OK        |
| `src/components/admin/ContactDetailSheet.tsx`                  | передаёт `purchaseSnapshot` — OK        |
| `src/components/admin/DealDetailSheet.tsx`                     | передаёт `purchaseSnapshot` — проверить |
| `src/components/admin/ContactPaymentsTab.tsx`                  | проверить                               |
| `src/components/admin/bepaid/ContactDealsDialog.tsx`           | проверить                               |
| `src/components/admin/payments/LinkDealDialog.tsx`             | использует helper — OK                  |
| `src/components/admin/payments/LinkSubscriptionDealDialog.tsx` | использует helper — OK                  |


### DoD: grep-proof — ни одного прямого обращения к `products_v2.name` для отображения имени сделки, минуя `getDealDisplayName`.

---

## Phase 3: Данные Людмилы — восстановление заказа на Розницу

### Проблема

Покупка Розницы (2025-03-14, 550 BYN) отсутствует в `orders_v2`. Потеряна при импорте.

### Действие

Создать 1 заказ в `orders_v2` для Людмилы:

- `user_id` = `eb39c79d-2588-4ab6-b831-7cd2d5a1641d`
- `profile_id` = `2ab73923-5923-4e6a-8077-d699fc0381f4`
- `product_id` = `7101ed3c` (родительский, как у остальных модульных)
- `status` = `paid`
- `deal_date` = `2025-03-14 10:51:40`
- `purchase_snapshot`:
  - `historical_purchase_type` = `module_only_standalone`
  - `display_purchase_name` = `ЦБ 2.0: Розничная торговля`
  - `module_list_mapped` = `["abee24cd-5c8b-4111-a6cb-7dee7acf168c"]`
  - `price` = 550, `currency` = `BYN`
- `order_number` = формат `MANUAL-RESTORE-{seq}`

### STOP-guard

- Только 1 заказ на Розницу, по подтверждённым данным от владельца
- Не менять существующие 3 заказа на Производство
- Audit log обязателен

### Также: исправить даты у 3 существующих заказов Производства

Сейчас все имеют `created_at = 2026-03-28` (дата импорта). Оригинальная дата: `2025-05-19 15:17:58`. Записать в `deal_date`.

---

## Phase 4: Dry-run canonical rule path

### Задача

После Phase 1 (resolver fix) прогнать dry-run и доказать, что rule engine **сам** выдаёт доступ к модулям при активном BUSINESS.

### Для Людмилы

- Правило `1b497fba` (BUSINESS/tariff `7c748940` → prior_purchase → модули)
- `target_product_ids` включает `064dd768` (Производство) и `abee24cd` (Розница)
- После Phase 1+3: resolver находит модульные покупки через `module_list_mapped`
- Ожидаемый результат: 2 entitlements (Производство + Розница), оба с `expires_at` = дата BUSINESS (`2026-05-05`)

### Для когорты

Consolidated dry-run отчёт:

- total `module_only_standalone` orders: 127 (120 single + 7 multi)
- по прямому `product_id` match: ~22
- через `module_list_mapped` fallback: ~98
- ambiguous/multi-module: 7 → `manual_review`
- malformed UUID: проверить
- already have active entitlement via rule: count
- будет реально выдано: count

---

## Phase 5: Перевод Людмилы с repair-path на canonical

### Порядок (безопасный)

1. НЕ удалять repair-entitlement (`2687b521`) до proof
2. Прогнать RetroApply / grant-access через rule engine → ожидать создание 2 canonical entitlements (Производство + Розница) с `access_rule_id = 1b497fba`, `expires_at = 2026-05-05`
3. Убедиться, что canonical entitlements active
4. Только после proof → деактивировать repair-entitlement `2687b521`

### DoD по Людмиле (по шагам)

1. Исторические сделки названы как модуль (display_purchase_name из snapshot)
2. Repair-entitlement больше не единственный источник доступа
3. Entitlement на Производство выдан через rule engine с `access_rule_id`
4. Entitlement на Розницу выдан через rule engine (после Phase 3)
5. `expires_at` обоих = дата BUSINESS (05.05.2026)
6. Курс и модули одновременно видны в кабинете
7. Повторный прогон идемпотентен
8. Repeat = 0 изменений

---

## Phase 6: Browser-proof видимости

Обязательный UI-proof (не data chain):

- Кабинет: одновременно виден родительский продукт и модули Производство / Розница
- Админка: сделки показывают имена модулей, не родительского курса
- Доступ к курсу не сломан

---

## STOP-guards (общие)

1. Не менять `orders_v2.product_id` в исторических заказах
2. Не строить логику на `product_code` / slug — только UUID
3. Не удалять repair-entitlement до доказанного replacement
4. Не обрабатывать multi-module orders (7 шт.) автоматически
5. Не создавать entitlement без `access_rule_id`
6. Если `module_list_mapped` содержит >1 UUID или конфликтует с `display_purchase_name` → `manual_review`
7. RetroApply использует тот же canonical resolver, что и новые покупки — один path

## Follow-up backlog (не блокирует текущую задачу)

1. **ID-first cleanup**: inventory всех мест, где `product_code`/`tariff_code`/slug используется в runtime-логике, поэтапный отказ
2. **Multi-module orders** (7 шт.): обработка через `split-multi-module-orders` + повторный прогон
3. **Inherited visibility**: показывать модульные карточки покупателям полного курса (отдельный спринт)

## Изменяемые компоненты


| Фаза | Файл                                                 | Действие                                                  |
| ---- | ---------------------------------------------------- | --------------------------------------------------------- |
| 1    | `supabase/functions/_shared/check-prior-purchase.ts` | Создать                                                   |
| 1    | `supabase/functions/_shared/access-resolver.ts`      | Заменить inline prior_purchase на helper                  |
| 1    | `supabase/functions/grant-access-for-order/index.ts` | Заменить inline prior_purchase на helper                  |
| 2    | UI-компоненты (6 файлов)                             | Проверить / исправить usage `getDealDisplayName`          |
| 3    | `orders_v2` (данные)                                 | INSERT 1 заказ Розница, UPDATE deal_date для Производства |
| 4    | Dry-run отчёт                                        | Вызов resolver через RetroApply preview                   |
| 5    | `entitlements` (данные)                              | Деактивация repair-entitlement после proof                |


## DoD (финальный, по когорте)

1. Для всех подтверждённых `module_only_standalone` prior_purchase определяется корректно через canonical resolver
2. Новые продления BUSINESS автоматически работают без repair
3. Исторические модульные покупки отображаются именем модуля, не родительского продукта
4. Ни один клиент не теряет текущий доступ
5. Consolidated dry-run отчёт по всей когорте предоставлен до execute
6. Розница для Людмилы: восстановлена по подтверждённым данным от владельца
7. Grep-proof: в новом патче нет сравнений по product_code в runtime-логике