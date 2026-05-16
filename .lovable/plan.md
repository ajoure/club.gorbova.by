# да, согласен, с учетом правок:

## **1. По PATCH G план в целом правильный**

Можно запускать **только read-only discovery** по secondary / bonus access fulfillment.

Но план нужно дополнить и закрыть обрезанный раздел `8. Backlog-предложения`, потому что сейчас он начинается и не содержит конкретных outputs.

Добавить:

```text
8. Backlog-предложения

По итогам discovery подготовить отдельные планы, если будут найдены gap-и:

A. Secondary Bonus Access Canonical Writer Fix
- если grant-access-for-order не читает bonus_products / included_products / historical_module_product_ids;
- добавить writer-ветку только через canonical path;
- без ручных INSERT в entitlements.

B. Access Rules / Tariff Offers Data Fix
- если expected bundle не описан в БД;
- сначала dry-run diff правил;
- потом отдельный approve на изменение access_rules / tariff_offers.

C. Historical Module Access Repair
- если у пользователей есть основной BUSINESS/Club доступ, но нет положенных исторических модулей;
- repair только через canonical writer или отдельный approved repair function.

D. Telegram Fulfillment Repair
- только если primary platform access активен;
- Telegram не является source of truth.

E. UI Access Resolver Patch
- если backend access есть, но admin/user UI показывают разные данные.
```

---

## **2. По сегодняшнему платежу — это отдельный срочный blocker**

Факт со скринов:

```text
Сегодняшний платеж снова привязался к мартовской сделке.
Доступы при этом выдались корректно.
```

Это означает:

```text
§A REBILL Materialization dry_run / wiring НЕ сработал на реальном сценарии автосписания.
```

Иначе сегодняшний платеж должен был хотя бы создать `bepaid.rebill.dry_run` audit-событие, а при будущем `on` — отдельную REBILL-сделку.

Сейчас видно, что старая проблема повторилась:

```text
новый платеж
→ попал в старую мартовскую сделку
→ доступ продлился
→ но финансовая история сделки снова испорчена
```

Это значит: **mode=on включать нельзя**.

---

## **3. Добавить срочный PATCH H перед любыми новыми включениями**

Вставь в план отдельный блок:

```text
## PATCH H — срочный blocker: сегодняшний bePaid payment снова привязался к мартовской сделке

### Проблема

После включения `BEPAID_REBILL_MATERIALIZATION=dry_run` реальный новый платеж bePaid снова привязался к старой мартовской сделке, а не к отдельной REBILL-сделке.

Доступы выдались корректно, но financial/order linkage снова неправильный.

Это означает, что §A REBILL dry_run dispatcher не сработал на реальном payment-flow или не классифицировал событие как rebill/autocharge.

### Цель

Read-only диагностировать сегодняшний платеж и понять:

1. Почему `bepaid.rebill.dry_run` не появился.
2. Почему payment был привязан к старому мартовскому order.
3. Какой именно code path обработал платеж.
4. Почему `grant-access-for-order` сработал, а REBILL materialization dispatcher — нет.
5. Как исправить classifier / dispatcher hook до любого `mode=on`.

### Read-only диагностика

По сегодняшнему платежу собрать:

- `payments_v2.id`
- `provider_payment_id`
- `paid_at`
- `created_at`
- `is_recurring`
- `order_id`
- `order_number`
- `order.created_at`
- `order.deal_date`
- `order.meta`
- `order.bepaid_subscription_id`
- `provider_subscriptions`
- `subscriptions_v2`
- `audit_logs` за окно платежа
- все action, связанные с:
  - bePaid webhook;
  - admin sync;
  - grant-access-for-order;
  - subscription extend;
  - entitlement extend;
  - telegram grant;
  - rebill dry_run.

### Ключевой вопрос

Определить точный source сегодняшнего платежа:

- пришёл через `bepaid-webhook`;
- пришёл через `admin-bepaid-sync`;
- пришёл через polling/sync;
- был создан UI/ручным действием;
- был повторно подтянут из bePaid выписки.

Если платеж пришёл не через `bepaid-webhook`, то §A materialization в webhook не может его поймать. Тогда нужно делать REBILL materialization также в том ingestion-path, который реально создаёт такие платежи.

### Проверить dry_run env

Подтвердить:

- `BEPAID_REBILL_MATERIALIZATION=dry_run` доступен именно в runtime той функции, которая должна была обработать этот платеж;
- если payment обработал не `bepaid-webhook`, указать, какой env/flag нужен для фактического ingestion path.

### STOP

- `BEPAID_REBILL_MATERIALIZATION=on` не включать.
- Не делать data-repair сегодняшнего платежа до отдельного dry-run.
- Не создавать REBILL вручную.
- Не перепривязывать payment вручную.
- Только read-only diagnosis.

### Proof

Создать:

`.lovable/proofs/rebill_dryrun_missed_real_payment_2026_05.md`

В proof указать:

1. платеж;
2. старая сделка, к которой он привязался;
3. почему это recurring/rebill;
4. какой кодовый путь его обработал;
5. почему `bepaid.rebill.dry_run` не появился;
6. что нужно исправить;
7. нужен ли новый PATCH для webhook или для admin sync/polling path.
```

---

## **4. PATCH G можно делать параллельно, но не мешать с PATCH H**

Правильный порядок:

```text
1. PATCH H — срочно понять, почему реальный платеж снова попал в мартовскую сделку.
2. PATCH G — read-only discovery бонусных/вторичных доступов.
3. Потом отдельный план исправления по результатам H.
4. Потом отдельный план исправления по результатам G.
```

---

## **5. Команда Lovable сейчас**

```text
План PATCH G принят с правками, но перед любым production-включением REBILL mode=on нужно срочно выполнить PATCH H.

Сначала выполни PATCH H read-only diagnosis по сегодняшнему платежу, который снова привязался к мартовской сделке.

Цель: определить, почему BEPAID_REBILL_MATERIALIZATION=dry_run не сработал на реальном платеже и какой ingestion-path фактически обработал платеж.

Никакого repair, никакого mode=on, никаких DML. Только read-only proof.
```

Главное: сегодняшний платеж — это доказательство, что REBILL-защита пока не закрыта. Доступы выдались правильно, но сделка снова сломалась по финансовой привязке.

&nbsp;

План: PATCH G — Full discovery secondary / bonus access fulfillment (read-only)

## Цель

Зафиксировать, **где** объявлен ожидаемый secondary/bonus access bundle для каждого продукта/тарифа и **что фактически делает** canonical writer `grant-access-for-order`. Найти gap-ы между «должно» и «факт» — без починки.

## Жёсткие границы (read-only)

- 0 INSERT/UPDATE/DELETE в: `entitlements`, `subscriptions_v2`, `access_rules`, `product_fulfillment`, `tariff_offers`, `telegram_access_queue`, `telegram_*`, `products_v2`, `tariffs`.
- 0 миграций, 0 правок RLS, 0 правок edge functions.
- `BEPAID_REBILL_MATERIALIZATION` НЕ включается.
- `grant-access-for-order` НЕ вызывается ни на одном order. Анализ строго по коду + текущему state БД + истории audit_logs.
- Никаких manual_review fix-ов, никаких ретро-grant-ов.

## Скоуп продуктов (контрольные)

1. **Gorbova Club** (`code='club'`)
2. **БУХГАЛТЕРИЯ КАК БИЗНЕС / BUSINESS** (`code='buh_business'`)
3. **Ценный бухгалтер 1 ступень 2.0** (CB-1, root `c9f7e9b8-e613-459a-91e3-38bbcfe424d8`)
4. **Standalone-модули ЦБ-1** (Маркетплейсы / Строительство / Производство / ПВТ / Розница / ИП / Грузоперевозки / Общепит) — отдельные `product_id`, отдельный training-root, бонус → full_access на CB-1.
5. **Платная консультация** (`code='consultation'`, тариф из кейса `d0a995aa`).
6. **Модуль Предзапись ЦБ-1 ступень 2.0** (`product_id=11309c6a-…`, тариф `4248dadf-…`, кейс Дарьи Насимовой).
7. **Платный подарок CHAT** (кейсы `3a748fd9`, `bddd5a41`).

Все остальные активные продукты — попадают в общий sweep (см. секцию 4), но без построчного разбора.

## Источники истины (SOT-цепочка для secondary)

Проверяем в строгом порядке:

1. `**tariff_offers.meta**` — `bonus_products[]`, `included_products[]`, `historical_module_product_ids[]`, `recurring`, `installment`, `subscription_offer`, `document_scenarios`.
2. `**access_rules**` — все правила со `scope IN ('product','tariff','section','telegram','training_content','live')` по каждому product_id/tariff_id из скоупа.
3. `**product_fulfillment**` (если таблица есть) — fulfillment-bundle.
4. `**products_v2.meta**` + `entitlement_mode` + `telegram_club_id`.
5. `**tariffs.meta**` + `access_days`.
6. **Hardcoded ветки в `supabase/functions/grant-access-for-order/index.ts**` — все `if (product.code === …)`, `if (tariff.id === …)`, `bonus*`, `historical*`, `module_scope_only`, `full_access`, partial-grant блоки, `product_access` секция, `telegram-grant-access` вызов.
7. `**access-resolver.ts` (`src/utils/access-resolver.ts`)** — как читается результат фулфилмента.
8. **Memory-канон**: `cabinet-visibility-entitlement-dependency`, `training-content-resolver-rules`, `phantom-parent-entitlement-guard`, `unified-access-rules-standard`, `entitlement-mode-standard-v2`, `canonical-telegram-grant-write-path`, `recurring-snapshot-resolver-sot`.

## Шаги (Diagnose → Discovery)

### Шаг 1. Каталог продуктов и тарифов в скоупе

SELECT-ы по `products_v2` + `tariffs` + `tariff_offers` для 7 контрольных продуктов. Зафиксировать: id, name, code, entitlement_mode, telegram_club_id, активные тарифы и их `access_days`/`meta`.

### Шаг 2. SOT-матрица «ожидаемый bundle»

Для каждой пары (product, tariff) собрать ожидаемое:

- primary entitlement (product_id, access_days);
- secondary entitlements (bonus_products / included_products / historical_module_product_ids);
- training_content scope (`full_access` / `module_scope_only` / `union_scope`);
- section_access (если есть);
- Telegram (club_id, режим chat/channel/both);
- live access.

Источник для каждой строки — явно подписан (`tariff_offers.meta.bonus_products`, `access_rules#row_id`, `hardcoded:grant-access-for-order:L###`, `products_v2.meta.X`).

### Шаг 3. Что фактически делает writer

Прочитать `supabase/functions/grant-access-for-order/index.ts` целиком и собрать карту:

- primary entitlement: ветка создания, источник `expires_at` (`extendFromCurrent`, `accessWindow.resolution`), запись `meta.tariff_id`.
- `product_access` блок: какие rules он раскрывает, при каких условиях `skipped: "no_rules"` / `legacy_skip`.
- `telegram` блок: когда зовёт `telegram-grant-access`, когда `null`, как защищается от legacy DM.
- bonus/historical: есть ли вообще ветка чтения `tariff_offers.meta.bonus_products` / `included_products` / `historical_module_product_ids`. Если нет — это **gap_class=writer_missing_branch**.
- partial-grant: какие пути приводят к `partial_grant_needs_patch_g`, `primary_entitlement_*_failed`, `sbs_mismatch`, `manual_review`.

### Шаг 4. Sweep по всем оплаченным заказам (агрегат)

Read-only агрегатный SELECT по `orders_v2 status='paid'` за последние 24 мес: на сколько orders фактически создан bundle, который ожидается из Шага 2.

Метрики на каждый (product_id, tariff_id):

- `orders_paid_total`
- `orders_with_primary_entitlement`
- `orders_with_expected_secondary_count` (по каждому ожидаемому secondary product_id отдельно)
- `orders_with_expected_telegram`
- `orders_with_audit_skip_legacy_skip` / `audit_skip_no_rules` / `partial_grant_needs_patch_g`
- `gap_count` = orders где ожидался secondary/Telegram, но фактической записи в `entitlements`/`telegram_messages` нет.

Никаких join-ов, которые могут что-то записать. Только агрегированные SELECT.

### Шаг 5. Контрольные строки (per-order trace)

Для следующих order_id собрать полный trace (orders_v2 → entitlements → subscriptions_v2 → telegram_messages → audit_logs `grant-access-for-order`):

- Матук Вероника (контрольный из PATCH F).
- Дарья Насимова (`2da906f1-…`) — proof из Stage 2.
- 2 чистых BUSINESS / Gorbova Club ордера с полностью корректным bundle (выбрать из top активных).
- 1 заказ CB-1 standalone-модуль, у пользователя которого ожидается full_access на CB-1 root.

Для каждого: ожидаемый bundle (Шаг 2) vs фактический state vs audit_logs writer-а.

## Итоговая matrix (формат)


| product | tariff | expected primary | expected secondary/bonus | expected Telegram | actual writer behavior | gap | candidates |
| ------- | ------ | ---------------- | ------------------------ | ----------------- | ---------------------- | --- | ---------- |


Плюс per-order таблица для контрольных строк:

| order | покупатель | expected bundle | actual entitlements | actual subscription | actual Telegram | audit | gap_class |

`gap_class ∈ { none, writer_missing_branch, rules_missing_in_db, legacy_skip_mode, mode_mismatch, telegram_not_called, secondary_not_materialized, partial_grant_needs_patch_g, manual_review_required, sbs_mismatch }`.

## Технические детали

- Все запросы — через `supabase--read_query`. Лимиты на batch ≤ 1000 (см. canon).
- Чтение кода — `code--view` по `supabase/functions/grant-access-for-order/index.ts`, `src/utils/access-resolver.ts`, `src/hooks/useSidebarModules.ts` (если нужно), `src/utils/resolveTrainingContentFilter*`.
- UUID-only в техническом приложении proof; в шапках таблиц — имена продуктов/покупателей (как договорились).
- Legacy product code/slug упоминаем только как `legacy_existing_debt` (memory: `no-product-code-in-new-artifacts`).

## Proof

`.lovable/proofs/secondary_bonus_access_fulfillment_discovery_2026_05.md`

Структура:

1. Скоуп и SOT-цепочка
2. Каталог продуктов/тарифов
3. Expected-bundle matrix (per product/tariff)
4. Writer behavior map (по коду grant-access-for-order)
5. Sweep-агрегаты по всем оплаченным orders
6. Per-order trace контрольных строк
7. Список gap-ов с классификацией и candidate count
8. Backlog-предложения (без выполнения): какие правила нужно создать в `access_rules`, какие ветки писателя дописать, какие продукты перевести с `legacy_skip` на канонический `entitlement_mode`.

## DoD

- 0 DML, 0 миграций, 0 правок кода/функций.
- Полная expected-bundle matrix по 7 контрольным продуктам.
- Карта поведения `grant-access-for-order` со ссылками на строки файла.
- Sweep-агрегат по всем активным продуктам с `gap_count`.
- Per-order trace для ≥5 контрольных покупателей (включая Матук, Насимову).
- Список gap-ов с классификацией и количеством кандидатов на каждый класс.
- Backlog отдельным разделом — без принятия решений о починке.
- BEPAID_REBILL_MATERIALIZATION не трогался.

## Что НЕ входит (отдельными планами)

- Group D (51 расхождение дат) — отдельный read-only план.
- INV-22 Юлия Рабчевская.
- Manual review дублей (Катерина Горбова, [latysh_dashka@mail.ru](mailto:latysh_dashka@mail.ru)).
- Решение по `d0a995aa` (истёкший без выдачи).
- Любая фактическая починка bonus/secondary access (будет PATCH G Stage 2 после согласования).