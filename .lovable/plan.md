да, согласен, с учетом правок:

1. **Stage 2 execute по одному кандидату можно запускать только после добавления проверки bonus/secondary fulfillment.**  
Потому что сейчас план проверяет только основной продукт, но не проверяет вторичные/бонусные доступы, которые должны выдаваться вместе с тарифом.
2. **Добавить в этот execute read-only проверку fulfillment-состава продукта/тарифа.**  
Перед вызовом `grant-access-for-order` по Дарье Насимовой нужно проверить:

```text
product_id
tariff_id
access_rules
product_fulfillment
bonus products/modules
included products
historical module access
secondary entitlements
telegram/channel rules
```

3. **Добавить PATCH G — Discovery bonus / secondary access fulfillment.**

Готовый блок для вставки в план:

```text
## PATCH G — Discovery secondary / bonus product fulfillment

### Проблема

Сейчас проверяется только основной доступ по оплаченной сделке. Но по ряду тарифов один платеж должен выдавать не только основной продукт, но и связанные второстепенные/бонусные доступы.

Пример:
- покупка тарифа BUSINESS / Gorbova Club может должна выдавать:
  - основной доступ к клубу;
  - связанные Telegram-доступы;
  - бонусные продукты;
  - исторические сделки/модули;
  - доступы к «Ценный бухгалтер 1 ступень» и его модулям, если это предусмотрено тарифом/правилами.

Нужно проверить, не теряются ли эти вторичные доступы при canonical grant.

### Цель

Провести read-only discovery того, какие secondary / bonus / included access должны выдаваться по каждому продукту/тарифу, и проверить, реально ли `grant-access-for-order` их создает.

### Что проверить read-only

1. Где в системе описаны связанные доступы:
   - `access_rules`;
   - `product_fulfillment`;
   - product/tariff metadata;
   - bonus product mappings;
   - historical module mappings;
   - legacy mappings;
   - hardcoded logic в `grant-access-for-order`.

2. Для каждого релевантного продукта/тарифа определить expected access bundle:
   - primary product;
   - subscriptions_v2;
   - entitlements;
   - secondary/bonus products;
   - module access;
   - Telegram club/channel access;
   - historical access.

3. Проверить на примерах:
   - Gorbova Club / BUSINESS;
   - Ценный бухгалтер 1 ступень 2.0;
   - модули ЦБ-1;
   - текущий order Дарьи Насимовой `2da906f1...`;
   - кейс Матук Вероники;
   - 2–3 пользователя с корректно выданным доступом как эталон.

4. Проверить, что `grant-access-for-order(orderId)`:
   - создает primary entitlement/subscription;
   - создает все обязательные secondary entitlements;
   - корректно ставит даты secondary-доступов;
   - не выдает лишние продукты;
   - не пропускает Telegram fulfillment;
   - пишет audit по каждому важному действию.

5. Сформировать matrix:

product | tariff | expected primary access | expected secondary access | expected Telegram | actual writer behavior | gap

### Candidate groups

Собрать read-only группы:

- Group H — paid orders where primary access exists but secondary/bonus access missing.
- Group I — users with club access but missing included historical/module access.
- Group J — users with secondary access but missing primary access.
- Group K — access_rules/product_fulfillment mismatch.
- Group L — hardcoded bonus logic found outside canonical writer.

### Proof file

Добавить или создать:

`.lovable/proofs/secondary_bonus_access_fulfillment_discovery_2026_05.md`

Разделы:
1. Где описаны bonus/secondary rules.
2. Expected bundle by product/tariff.
3. Actual `grant-access-for-order` behavior.
4. Gap matrix.
5. Candidate groups H–L.
6. Отдельная строка по Дарье Насимовой.
7. Отдельная строка по Матук Веронике.
8. Вывод: code-fix нужен / repair нужен / всё корректно.

### STOP-guards

- На этом этапе discovery не выполнять repair.
- Не добавлять secondary entitlements вручную.
- Не менять `access_rules` без отдельного плана.
- Не менять `product_fulfillment` без отдельного плана.
- Не трогать Telegram напрямую.
- Если secondary access missing найден — подготовить отдельный PATCH:
  `Secondary Bonus Access Canonical Writer Fix`.

### DoD PATCH G

PATCH G считается выполненным, когда:
- найден источник истины по bonus/secondary access;
- по каждому релевантному тарифу есть expected access bundle;
- доказано, создает ли `grant-access-for-order` эти доступы;
- есть список расхождений;
- есть отдельный план исправления, если secondary access не создается.
```

4. **Для текущего execute по Дарье Насимовой добавить минимальную проверку до/после.**

В `Snapshot контракт` добавить:

```text
Secondary / bonus access check:
- expected secondary products/modules по product_id + tariff_id;
- current secondary entitlements before;
- secondary entitlements after;
- если expected secondary access есть, но после grant не создан — статус `partial_grant_needs_patch_g`, без ручной починки.
```

5. **В DoD Execute добавить:**

```text
- Проверено, должен ли тариф выдавать secondary/bonus access.
- Если должен — proof показывает, создан ли secondary/bonus access через canonical writer.
- Если не создан — это не чинится вручную в PATCH E, а уходит в PATCH G / Secondary Bonus Access Canonical Writer Fix.
```

6. **В текущем Stage 2 не расширять execute на бонусные доступы вручную.**  
Сейчас разрешён только один вызов:

```text
grant-access-for-order(orderId='2da906f1-7957-4461-a7a1-8b977f30bf09')
```

Если writer не создаст вторичные доступы — это важный найденный дефект, но чинить его нужно отдельным code-patch, а не ручными INSERT.

7. **Постоянное правило про человекочитаемые имена можно принять.**  
В proof’ах первая колонка — имя/email, UUID только в технических колонках. Memory можно создать после успешного отчета, если хочешь закрепить это для всех следующих отчетов.

Итог: execute по одному order можно делать, но обязательно добавить read-only проверку expected/actual secondary access. Если вторичные доступы не выдаются — не чинить вручную, а оформить отдельный PATCH G.

&nbsp;

План: PATCH E Stage 2 — Execute GO-batch A (1 кандидат)

## 1. Скоуп

**Ровно 1 order_id:**


| order_id                             | order_number     | покупатель                                              | продукт                                             | тариф               | paid_at    | окно до    |
| ------------------------------------ | ---------------- | ------------------------------------------------------- | --------------------------------------------------- | ------------------- | ---------- | ---------- |
| 2da906f1-7957-4461-a7a1-8b977f30bf09 | GIFT-26-MOCVYPNO | **Дарья Насимова** (`7743826@mail.ru`, TG: `Da_ry_nas`) | Ценный бухгалтер 1 ступень 2.0 / Модуль: Предзапись | Стандартный (30 дн) | 2026-04-24 | 2026-05-24 |


Остальные 8 — НЕ трогаем. GO-batch B (5 no-op), manual_review (3a748fd9 Катерина Горбова + bddd5a41 [latysh_dashka@mail.ru](mailto:latysh_dashka@mail.ru)), d0a995aa, 85a99b74 (Юлия Рабчевская / INV-22) — вне этого execute.

## 2. Действие

Один сериальный вызов canonical writer:

```ts
supabase.functions.invoke('grant-access-for-order', {
  body: {
    orderId: '2da906f1-7957-4461-a7a1-8b977f30bf09',
    source: 'inv_group_a_canonical_regrant_2026_05'
  }
})
```

Параметры:

- никаких `customAccessDays/customAccessStartAt/customAccessEndAt` — writer считает окно сам;
- `extendFromCurrent: true` по умолчанию;
- `grantTelegram: true` (по умолчанию; у продукта `telegram_club_id IS NULL` → writer сам решит `none`);
- таймаут 30s, без ретраев на 4xx, 1 ретрай через 5s на 5xx.

## 3. Что разрешено / запрещено

Разрешено:

- ровно один вызов `grant-access-for-order`;
- read-only SELECT'ы для before/after снимков.

Запрещено:

- прямые `INSERT/UPDATE/DELETE` в `entitlements`, `subscriptions_v2`, `telegram_access_queue`, `telegram_*`;
- ручная запись в `audit_logs` (audit пишет сам writer);
- любые вызовы по остальным 8 order_id;
- любые попытки «починить» manual_review/error результат вручную;
- изменения `BEPAID_REBILL_MATERIALIZATION`, schema, RLS, миграций.

## 4. Snapshot контракт

**Before** (до вызова):

- `orders_v2` по этому order_id (status, user_id, product_id, tariff_id, paid_at);
- `entitlements` по (user_id=84b60f85, product_id=11309c6a): id, status, expires_at, order_id, meta.tariff_id (ожидается пусто);
- `subscriptions_v2` по тому же ключу: ожидается пусто;
- audit `grant%` по order_id (ожидается пусто).

**After** (сразу после ответа writer'а):

- те же выборки повторно;
- audit `grant-access-for-order%` за окно execute с фильтром по order_id;
- ответ writer'а (success/skip/error, ids).

## 5. Per-response ветвление


| ответ writer'а                                                                                        | действие                                                            |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `success: true` + `entitlement_id` + `subscription_id`                                                | зафиксировать в proof, статус `done`                                |
| `skip_already_fulfilled`                                                                              | зафиксировать (неожиданно — но легитимно), статус `idempotent_skip` |
| `order_id_collision_foreign_user` / `sbs_mismatch` / `manual_review` / `primary_entitlement_*_failed` | НЕ чинить, зафиксировать в `manual_review` раздел                   |
| HTTP 4xx                                                                                              | статус `precheck_failed`, зафиксировать                             |
| HTTP 5xx после 1 ретрая                                                                               | статус `dispatcher_error`, зафиксировать                            |


## 6. Ожидаемый результат (по dry-run)

- `planned_action = create_primary_entitlement_and_subscription`;
- `entitlements`: 1 новая запись, `expires_at ≈ 2026-05-24`, `order_id = 2da906f1...`, `meta.tariff_id = 4248dadf...`;
- `subscriptions_v2`: 1 новая, `access_start_at ≈ 2026-04-24`, `access_end_at ≈ 2026-05-24`, `tariff_id = 4248dadf...`, `status = active`;
- Telegram action: `none` (`telegram_club_id IS NULL`);
- audit: 1+ запись `grant-access-for-order.*` с `meta.order_id = 2da906f1...`.

## 7. Proof файл

`.lovable/proofs/inv_group_a_canonical_regrant_execute_2026_05.md`

Структура:

1. Шапка с именем покупателя (Дарья Насимова), email, TG, продуктом и тарифом — **без голых UUID в основном тексте**, UUID только в техническом приложении.
2. Before/After таблица (ent, sub, audit).
3. Ответ writer'а (success/error код).
4. Telegram action итог.
5. Подтверждение: 0 DML вне canonical писателя, 0 вызовов по остальным 8 order'ам, `BEPAID_REBILL_MATERIALIZATION` не трогался.
6. Статус в админке/кабинете — если доступно через read-only view (`unified_access_truth_v` или эквивалент), сделать одну выборку и приложить.
7. DoD-чеклист.

## 8. Соглашение по именам в отчётах (постоянное)

В шапках и сводных таблицах proof-файлов и отчётов **первой колонкой указываем человекочитаемое имя** покупателя (Имя Фамилия / email если имя пусто). UUID допускаются только в техническом приложении или в технических колонках, помеченных как ID. Применяется со следующего отчёта и далее.

Намеренно скоупно: это правило применяю к новым proof'ам PATCH E и последующим планам/отчётам по этому потоку. Если нужно — после approve вынесу в memory как Core-правило отдельным шагом.

## 9. DoD Execute

- Вызван ровно 1 canonical writer по `2da906f1...`.
- Прямых DML в entitlements/subscriptions_v2/telegram_* нет.
- Остальные 8 order_id не трогались.
- Proof собран с before/after и именем покупателя в шапке.
- manual_review/error (если будут) — зафиксированы без ручной починки.
- `BEPAID_REBILL_MATERIALIZATION=on` не включался.

## 10. Что НЕ делаем в этом execute

- GO-batch B (5 no-op canonization): skip до отдельного approve.
- manual_review (3a748fd9 Катерина Горбова дубль-подарок, bddd5a41 [latysh_dashka@mail.ru](mailto:latysh_dashka@mail.ru) дубль CHAT): только ручной разбор, отдельный план.
- `d0a995aa` (Платная консультация, окно истекло без выдачи): ждём продуктового решения.
- `85a99b74` (Юлия Рабчевская, BUSINESS, 2 past_due subs auto_renew=true): отдельный план INV-22.
- Group D (51) — отдельным планом «Subscription/Entitlement Date Alignment — read-only first».