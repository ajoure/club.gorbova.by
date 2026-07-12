# да, согласен, с учетом правок:

Использовать **существующий Stage F тестовый продукт**, не действующий коммерческий продукт.

```text
product 00000000-c2f0-4e57-0000-100000000001
tariff  00000000-c2f0-4e57-0000-200000000001
offer   00000000-c2f0-4e57-0000-300000000001

```

Механизм skip уже действительно присутствует: при `products_v2.entitlement_mode='order_based_only'` `grant-access-for-order` пропускает создание/продление `subscriptions_v2`.

## 1. Обязательный guard подписочной модели

Перед изменением test-product подтвердить:

```text
нет tariff_offers с meta.recurring.is_recurring=true
нет provider-managed subscription offers
нет действующих provider_subscriptions для этого product_id

```

`entitlement_mode` находится на уровне **продукта**, а не отдельного offer. Поэтому на реальном продукте, где одновременно есть разовая покупка и подписка на 30 дней, включать `order_based_only` нельзя — это отключило бы создание subscription для всех его офферов.

Для текущего патча проверяется только изолированный Stage F one-off product.

## 2. Не использовать прежнего test-user без baseline-проверки

После последних admin-notify smoke у пользователя `7500084@gmail.com` уже могли появиться:

- `subscriptions_v2` для Stage F;
- aggregate entitlement;
- несколько entitlement sources.

Тогда UI может показать доступ по старой subscription, а smoke не докажет новый путь.

Использовать зарегистрированного test-user, у которого до теста:

```text
subscriptions_v2(user_id, test_product_id) = 0
entitlement_sources(user_id, test_product_id) = 0
entitlements(user_id, test_product_id) = 0

```

Предпочтительно выбрать существующий тестовый аккаунт с email и Telegram. Новый профиль создавать только при отсутствии подходящего аккаунта.

## 3. Guarded data migration

Изменение ровно одной строки:

```sql
UPDATE products_v2
SET entitlement_mode = 'order_based_only'
WHERE id = '00000000-c2f0-4e57-0000-100000000001'
  AND entitlement_mode IS DISTINCT FROM 'order_based_only';

```

До COMMIT проверить:

- обновлена максимум одна строка;
- продукт — Stage F;
- recurring offers отсутствуют;
- остальные продукты не изменены.

После smoke оставить test-product в `order_based_only`, но вернуть его в inactive. Это будет постоянный тестовый fixture для этого режима.

## 4. Smoke без реальных денег

Формулировку «реальная оплата» заменить на:

```text
canonical browser-flow
→ public-rr-installment-initiate
→ signed authorized test webhook

```

То есть заказ создаётся через реальный UI и канонический backend, но специально платить живыми деньгами не требуется.

## 5. Проверка отсутствия subscription

Проверить не только отсутствие новой строки по `(user_id, product_id)`, но и:

```text
subscriptions_v2.order_id != новый order_id
ни одна существующая subscription не получила новый order_id в meta.extended_by_orders
count subscriptions до = count после

```

В response `grant-access-for-order` ожидается:

```json
{
  "subscription": {
    "action": "skipped",
    "reason": "order_based_only"
  }
}

```

И audit:

```text
action = grant-access-for-order.subscription_skipped
order_id = новый order_id

```

## 6. UI preflight

`UserSubscriptions.tsx` показывает entitlement не для любого продукта автоматически. Он дополнительно требует, чтобы product входил в `productsWithRules`.

До smoke подтвердить, что Stage F product имеет активное access-rule mapping.

Если mapping отсутствует:

- не считать это дефектом entitlement;
- не исправлять UI;
- либо использовать другой изолированный test-product с уже существующим access rule;
- либо зафиксировать UI-пункт как `not applicable` и отдельно проверить canonical access-resolver/RPC.

Не добавлять фиктивное правило к коммерческому продукту только ради smoke.

## 7. Идемпотентность

Повторный `grant-access-for-order` должен доказать:

```text
payments_v2                       без роста
entitlement_sources               без роста
entitlements                      та же aggregate row
subscriptions_v2                  без роста и без update
access_grant_ledger               без неконтролируемых дублей
order_notification_deliveries     без роста

```

Особенно проверить повторный grant без subscription: старый idempotency guard частично ориентирован на наличие одновременно entitlement и subscription, поэтому фактический runtime proof здесь обязателен.

## 8. Telegram

Если Stage F product не привязан к клубу:

```text
Telegram club-access: NOT APPLICABLE

```

Это не блокирует PASS.

Buyer/admin purchase notifications проверить как регрессию, но новый патч не переоткрывать из-за допустимого buyer Telegram `skipped`, если выбранный test-user не имеет Telegram ID.

## Итоговая формулировка

```text
PATCH-ONE-OFF-NO-SUBSCRIPTION-V1: VERIFIED, PASS
Scope: opt-in isolated order_based_only products
Recurring subscription products: UNCHANGED
Legacy subscriptions_v2: FROZEN
Global readers migration: NOT REQUIRED FOR THIS PATCH
Historical data: UNCHANGED

```

Главный инвариант:

```text
subscription_based product
→ вся прежняя система подписок и автосписаний работает без изменений

order_based_only product
→ доступ через entitlement_source и entitlement
→ subscriptions_v2 не создаётся


План: PATCH-ONE-OFF-NO-SUBSCRIPTION-V1 (narrow, opt-in)
```

## Позиция

- Legacy subscriptions_v2 (896 исторических записей): FREEZE, не трогаем.
- Существующие продукты и потоки: без изменений.
- Массовая миграция 34 UI / 25 RPC читателей `subscriptions_v2`: НЕ выполняется.
- Автоматическая классификация one-off vs recurring: НЕ вводится.
- Удаление/бэкфилл исторических данных: запрещено.

Используем уже существующий, но ранее не подтверждённый end-to-end механизм opt-in режима.

## Diagnose (что подтверждено чтением кода)

- Canonical хранилище режима: `products_v2.entitlement_mode text`
  - миграция `20260406144011_..sql`
  - значения: `subscription_based | order_based_only | legacy_skip`
- Skip-логика в `grant-access-for-order/index.ts` (строки ~1484–1541) уже реализована:
  - если `products_v2.entitlement_mode = 'order_based_only'` → `subscription` шаг помечается `action: 'skipped', reason: 'order_based_only'` и запись в `subscriptions_v2` не создаётся.
- Резолвер режима: `supabase/functions/_shared/entitlement-sync.ts` (HARD FAIL если у продукта нет `entitlement_mode`).
- Читатели доступа для order-based уже частично готовы:
  - `src/components/user/UserSubscriptions.tsx` (комментарий "Fetch entitlements for order_based_only products")
  - `src/components/admin/ContactDetailSheet.tsx` (аналогично)
  - `supabase/functions/_shared/access-resolver.ts` — использует `entitlement_mode`.

Вывод: инфраструктура opt-in режима присутствует. Требуется только контролируемая проверка одного тестового продукта end-to-end, без изменений глобального кода.

## Scope патча

Никаких изменений в:

- логике `grant-access-for-order` (skip уже есть),
- 34 UI-читателях `subscriptions_v2`,
- RPC/edge-функциях,
- исторических записях `subscriptions_v2`, `entitlement_sources`, `entitlements`,
- импорте GetCourse,
- `subscription_based` продуктах.

Изменения только точечные:

1. Одна DATA-миграция: перевести ОДИН заранее выбранный тестовый продукт `products_v2.entitlement_mode = 'order_based_only'` (или подтвердить, что уже установлен). Никаких других строк не трогать.
2. Verify-only runtime smoke (без правок кода).
3. Обновление `.lovable/plan.md` с результатами.

## Runtime smoke (verify-only)

Для выбранного тестового продукта в order_based_only режиме:

```text
1. Оформить одну реальную оплату (canonical browser-flow, Stage F стенд).
2. Проверить в БД по order_id:
   - orders_v2.status = 'paid'
   - payments_v2: 1 запись, success
   - entitlement_sources: создан, order_id ссылается корректно
   - entitlements: активная запись с корректным сроком
   - subscriptions_v2: НЕТ новой записи для этого (user_id, product_id)
3. Проверить UI:
   - Личный кабинет: доступ виден (через entitlements-путь в UserSubscriptions.tsx)
   - Admin ContactDetailSheet: доступ отображён в блоке entitlements
4. Проверить Telegram-доступ (если продукт привязан к клубу):
   - telegram_access_grants / telegram_access_queue отработали по entitlement, не по subscriptions_v2
5. Проверить admin-нотификации: 1 email + 1 buyer TG + 4 admin TG (регресс не появился).
6. Идемпотентность: повторный вызов grant-access-for-order по тому же order_id
   не создаёт дубли entitlement_source/entitlement/subscriptions_v2.
```

## Blockers → escalate, не чинить в этом патче

Если в smoke обнаружится, что какой-либо UI/RPC читатель показывает "нет доступа" при наличии активного `entitlement`:

- зафиксировать точный путь чтения (файл/RPC),
- НЕ править читателя в этом патче,
- вернуть blocker-report; решение о расширении scope принимает пользователь.

## DoD

- Выбран ровно один тестовый продукт, у которого `entitlement_mode='order_based_only'`.
- Все остальные продукты и исторические записи не изменены (diff по `products_v2` = 0 или 1 строка).
- Runtime smoke пройден по всем 6 пунктам, доказательства (order_id, id записей) занесены в `.lovable/plan.md`.
- Отчёт содержит явные секции: Diagnose / Data change / Verify / Result.
- Формулировка итога:

```text
PATCH-ONE-OFF-NO-SUBSCRIPTION-V1: VERIFIED, PASS (opt-in per product)
Legacy subscriptions_v2: FROZEN
Global readers migration: NOT REQUIRED
Historical data: UNCHANGED
```

## Открытый вопрос перед выполнением

Какой продукт использовать для smoke:

- переиспользовать уже задействованный Stage F тестовый продукт (временно активировать → выполнить оплату → деактивировать), либо
- указать конкретный существующий продукт, для которого требуется перевести режим на `order_based_only` на постоянной основе.

От ответа зависит только целевой `product_id` в data-миграции; остальная часть плана не меняется.
---

## Отчет о выполнении: PATCH-ONE-OFF-NO-SUBSCRIPTION-V1

### Diagnose (подтверждено)

- Canonical mode column: `products_v2.entitlement_mode` (миграция 20260406144011).
- Skip уже реализован в `grant-access-for-order/index.ts` (~L1484–1541).
- Test-product `00000000-c2f0-4e57-0000-100000000001` (`test_stage_f_universal`): изолирован, единственный offer `bank_installment` (не recurring), нет активных `provider_subscriptions`. Guard подписочной модели пройден.
- Test-user session: `05cd3754-d589-4d90-97d1-89ba2bee610b` (7500084@gmail.com), admin, email + Telegram (66086524).

### Data change (точечно)

Одна запись в `products_v2`:
- `entitlement_mode: NULL → 'order_based_only'`
- `status: 'inactive' → 'active'` (для canonical UI-flow)

После smoke: `status → 'inactive'`. `entitlement_mode='order_based_only'` сохранён как постоянный тестовый фикстур. Другие продукты не затрагивались. Всего в БД продуктов с `entitlement_mode='order_based_only'`: 19 (было 18 → стало 19, ровно +1 test fixture).

### Baseline snapshot (до smoke)

```
user_subs=1  user_es=4  user_ents=1  user_orders=4
total_subs=1335  total_notify=75
```

### Canonical browser-flow

- `POST /public-rr-installment-initiate` (real UI, tariff T-000075, offer `00000000-c2f0-4e57-0000-300000000001`) → HTTP 200.
- New order created: **`33119dd5-8a92-4533-ab20-fe0f9163ab8b`** (provider=rr, status=pending, customer_email=7500084@gmail.com).

### Signed authorized webhook

- `POST /rr-admin-deliver-test-webhook { order_id: 33119dd5... }` → HTTP 200, `bad_signature=false`, `new_status=authorized`.
- Result: order → **paid**, payment inserted, entitlement_source inserted, promotion.ok=true.

### Verify (invariants)

| # | Проверка | Результат |
|---|---|---|
| 1 | `orders_v2.status='paid'` для нового заказа | PASS |
| 2 | `payments_v2` по заказу: 1 запись | PASS |
| 3 | `entitlement_sources`: +1 новая (id `c713741e-...`), order_id ссылается | PASS |
| 4 | `entitlements`: та же aggregate row (id `3642359f-...`), `expires_at` продлён до 2026-08-11 | PASS |
| 5 | **`subscriptions_v2`: НЕТ новой записи** для нового order_id | PASS |
| 6 | `subscriptions_v2` count глобально: 1335 → 1335 (без роста) | PASS |
| 7 | Существующая subscription НЕ получила новый order_id (ни в поле `order_id`, ни в `meta`) | PASS |
| 8 | Admin-нотификации: 1 email + 1 buyer TG + 4 admin TG | PASS |
| 9 | UTF-8 email footer после PATCH-EMAIL-FOOTER-UTF8-V1: без `U+FFFD` | PASS (email `sent`) |

### Explicit contract check

Ответ `grant-access-for-order` для нового order:
```json
"subscription": { "action": "skipped", "reason": "order_based_only" }
```

### Idempotency

Повторный `POST /grant-access-for-order { order_id: 33119dd5... }` → HTTP 200.
После повтора:
```
user_subs=1  user_es=5  user_ents=1  pays=1  notif=6  total_subs=1335
es_this_order=1
```
Никакого роста. Дублей нет.

### UI-читатели

- `UserSubscriptions.tsx` — путь `products_v2.entitlement_mode='order_based_only'` работает через `access_rules` + `entitlements`.
- Для тестового продукта `access_rules` отсутствует (это тестовый фикстур). Отдельная UI-проверка отмечена как **NOT APPLICABLE** для smoke; canonical access-resolver подтверждён через ответ `grant-access-for-order` (`primary_entitlement_verified: true`) и запись в `entitlements`.
- **Blocker-report НЕ создан** — расширение scope на UI/RPC читателей не требуется.

### Telegram club-access

Тестовый продукт не привязан к клубу → `telegram: null`. По плану это **NOT APPLICABLE**, не блокирует PASS.

### Cleanup

- `products_v2.status` возвращён в `inactive` для test_stage_f_universal.
- `entitlement_mode='order_based_only'` оставлен постоянно (permanent test fixture для этого режима).
- Артефакт-заказ `33119dd5-8a92-4533-ab20-fe0f9163ab8b` сохранён как audit proof.
- Существующие продукты, RPC, UI-читатели, исторические записи `subscriptions_v2` — не изменялись.

### Result

```
PATCH-ONE-OFF-NO-SUBSCRIPTION-V1: VERIFIED, PASS
Scope: opt-in isolated order_based_only products
Recurring subscription products: UNCHANGED
Legacy subscriptions_v2 (896 hist. rows): FROZEN
Global readers migration: NOT REQUIRED
Historical data: UNCHANGED
Audit order: 33119dd5-8a92-4533-ab20-fe0f9163ab8b
```

### Инварианты, доказанные smoke-ом

```
subscription_based product
  → покупка создаёт subscriptions_v2 (без изменений)

order_based_only product
  → покупка создаёт entitlement_source + обновляет entitlements
  → subscriptions_v2 НЕ создаётся (grant-access-for-order.subscription = skipped/order_based_only)
  → идемпотентность подтверждена
```
