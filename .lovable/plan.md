да, согласен, с учетом правок:

1. **В анализ добавить главный decision-point: поддерживать legacy path или отключать.**  
Если D1–D5 покажут, что legacy one-time path почти не используется, нужно рассмотреть не только writer-extension, но и вариант:

legacy path → manual_review / no access write / admin recovery

То есть не строить большой bridge, если поток уже фактически мёртвый.

2. **Legacy-order bridge — только как будущий отдельный write-path.**  
В H2.1c analysis зафиксировать, что создание orders_v2-двойника — это будущий DML и требует отдельного dry-run/approve.  
В текущем analysis никаких orders_v2 не создавать.
3. **В H2.1c-i не смешивать bridge и grant, если это усложняет writer.**  
В proof сравнить 2 варианта:

Вариант A: webhook/bridge сначала создает/находит orders_v2, потом вызывает grant-access-for-order(orderId)

&nbsp;

Вариант B: grant-access-for-order сам принимает legacy_order_id и внутри делает bridge

Рекомендация: предпочтительнее **A**, потому что grant-access-for-order должен работать с canonical orders_v2, а не становиться универсальным legacy-migrator.

4. **Для tariff_code → tariff_id добавить collision-check.**  
В D-запросы добавить:

legacy tariff_code maps to 0 / 1 / many tariffs

Если many — manual_review, не авто-резолв.

5. **Для product_v1 → product_v2 добавить mapping confidence.**  
Не только product_v2_id IS NULL, но и:

mapped_by_explicit_id

mapped_by_code

mapped_by_name

unmapped

ambiguous

Любой fuzzy/name match — только manual_review.

6. **По legacy v1 subscriptions не планировать удаление в рамках H2.1c.**  
Формулировку “депрекейтить или удалить” оставить только как long-term backlog. Сейчас задача — убрать access writes из webhook, не ломать старую совместимость.
7. **G8 false-recurring — сделать обязательным blocker-output.**  
В proof должна быть таблица:

legacy order | tariff | offer recurring? | created subscription auto_renew | expected auto_renew | gap

Если есть false-recurring — это blocker для любого автоматического переноса.

8. **Для Telegram multi-club проверить текущий canonical writer.**  
Если writer сейчас поддерживает только один telegram_club_id, а legacy path раздаёт несколько access_rules club — это отдельный gap:

telegram_multi_target_writer_gap

Не чинить в analysis, только зафиксировать.

9. **DoD анализа дополнить go/no-go выводом.**

В конце proof должен быть один из выводов:

A. legacy path больше не используется → можно отключить/перевести в manual_review

B. legacy path используется и полностью маппится на orders_v2/products_v2/tariffs → можно делать H2.1c-i

C. legacy path используется, но есть unmapped/ambiguous продукты/тарифы → сначала mapping cleanup

D. legacy path критичный и содержит false-recurring/telegram gaps → нужен отдельный design-план

10. **.lovable/[plan.md](http://plan.md) обновлять только статусом.**

H2.1c = analysis_complete

H2.1c-i = pending

H2.1c-ii = pending

H3/H4/PATCH G = unchanged

После этих правок план можно запускать как read-only/code-discovery. Код, данные, миграции и secrets не трогать.

&nbsp;

План: PATCH H2.1c — legacy one-time path canonical writer analysis (read-only)

## Цель

Полностью разобрать legacy/one-time ветки `bepaid-webhook`, где ещё остаются прямые записи в `subscriptions_v2` / `entitlements` / `subscriptions(v1)` и прямые вызовы `telegram-grant-access`. Подготовить безопасный план замены на `grant-access-for-order` (canonical writer). Без изменений кода, без DML, без миграций, без переключения `BEPAID_REBILL_MATERIALIZATION`.

## Запреты (зафиксировано)

- production DML = 0;
- миграций = 0;
- secrets не меняем;
- `BEPAID_REBILL_MATERIALIZATION` остаётся `dry_run`;
- `mode=on` не включать;
- Рабчевская и другие data-repair — не трогать;
- writer-код не менять (только проектируем расширение).

## Scope (что разбираем)

В `supabase/functions/bepaid-webhook/index.ts` две legacy-зоны:

1. `**[WEBHOOK-LEGACY]` materialization-only** — строки ≈5015–5269 (PATCH P-LEGACY-BEPAID.1):
  - триггер: `!orderId && !subscriptionId && status='successful' && transactionUid`;
  - матчинг профиля по `card.stamp` / `card_last4+brand` / email;
  - записывает только `payments_v2` + amoCRM, **НЕ пишет access**;
  - подтвердить read-only при ревью.
2. **Legacy flow (orders table)** — строки ≈5274–6285 — главный кандидат на замену. Содержит прямые access-writes (см. ниже).

## Что делает legacy flow (zone 2)

### Когда срабатывает

- В payload есть `tracking_id` без префиксов `subv2:` / `link:` / `link:order:` → `orderId` ссылается на legacy `public.orders.id`;
- ИЛИ есть только `subscriptionId` без tracking → fallback по `orders.meta->>bepaid_subscription_id`;
- статус транзакции = `successful`.

### Где создаёт/находит order

- `orders.select * .eq(id, orderId)` (≈5290);
- fallback: `orders.select * .eq(meta->>bepaid_subscription_id, subscriptionId)` (≈5301);
- **orphan-create**: если order не найден ни в `orders`, ни в `orders_v2` — создаёт orphan-запись в `orders` (≈4188–4246, общий пред-блок).

### Где пишет subscriptions_v2 (прямые writes)

- ≈5546 — `select id, access_end_at, status` по (user_id, product_id, status∈active/trial);
- ≈5561 — `UPDATE` существующей подписки: `access_end_at`, `is_trial`, `status`, `trial_end_at`, `payment_token`, `order_id` (логика «продлить от current_end или now + access_days»);
- ≈5576 — `INSERT` новой подписки: `access_start_at`, `access_end_at`, `status`, `auto_renew=true`, `trial_end_at`, `next_charge_at`, `payment_token`, `meta.bepaid_subscription_id/legacy_order_id`.

### Где пишет entitlements

- ≈5696 — `upsert` в `entitlements` с `expires_at`, `onConflict: user_id,product_code` (старый `product_code`-ключ, противоречит `id-first` каноне).

### Где трогает legacy v1 `subscriptions`

- ≈5721 — `UPDATE public.subscriptions SET tier, is_active, starts_at, expires_at WHERE user_id=...` (legacy v1 — кандидат на удаление, не на замену).

### Где вызывает Telegram

- ≈5614 — `functions.invoke('telegram-grant-access')` для products_v2 при `productV2.telegram_club_id`;
- ≈5755 — `functions.invoke('telegram-grant-access')` в цикле по `access_rules.grant_target_type='club'` для products_v1;
- оба нарушают канон «Telegram Auto-Grant Single Path» (auto-grant DM только через `grant-access-for-order → telegram-grant-access`).

## Может ли `grant-access-for-order` заменить ветку сейчас

**Частично.** Прямой `fetch(grant-access-for-order, { order_id })` не сработает «как есть» по причинам ниже.

## Gap-анализ


| #   | Gap                                                  | Описание                                                                                                                                                                                                                                 | Блокирующий?                  |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| G1  | **Legacy `orders` vs `orders_v2**`                   | Writer читает `orders_v2` по UUID; legacy ветка работает с `public.orders` (часто без `orders_v2`-пары). Нужен либо bridge-create `orders_v2` перед вызовом writer'а, либо writer context `legacy_one_time` с приёмом `legacy_order_id`. | Да                            |
| G2  | `**tariff_id` отсутствует**                          | Legacy `orders.meta` содержит `tariff_code` (string), а не `tariff_id` (UUID). Нарушает `ID-First Logic`. Нужен резолв `tariff_code + product_v2_id → tariff_id` перед writer'ом.                                                        | Да                            |
| G3  | **products_v1 без `product_v2_id**`                  | Часть legacy orders ссылаются только на `products` (v1) без `product_v2_id`. Writer работает только с `products_v2`. Нужен аудит: остались ли активные продукты без v2-зеркала.                                                          | Да (требует discovery-запрос) |
| G4  | `**entitlements.product_code` legacy upsert**        | Legacy ветка пишет entitlements по строковому `product_code`. Writer пишет `id-first` (`product_id`). Конфликт onConflict-ключей — рассинхрон.                                                                                           | Средний                       |
| G5  | **legacy v1 `subscriptions` (tier/is_active)**       | Эту таблицу writer не трогает. Решение: после миграции — оставить, депрекейтить или удалить отдельным шагом (не часть H2.1c).                                                                                                            | Низкий (decoupled)            |
| G6  | **Telegram по `access_rules` цикл**                  | Writer уже умеет `telegram-grant-access` через `invokeTelegram` (см. H2.1b-ii). Множественные клубы в одном продукте — нужно проверить, поддерживает ли writer цикл по всем `grant_target_type='club'` rules или только основной club.   | Средний                       |
| G7  | **orphan-order стадия (≈4188–4246)**                 | Создаётся через legacy `orders.insert`, не через `orders_v2`. После H2.1c — переключить orphan-create на `orders_v2` для совместимости с writer'ом.                                                                                      | Средний                       |
| G8  | `**subscription_charge_count` / recurring snapshot** | Legacy ветка ставит `auto_renew=true` всегда; writer определяет recurring по `tariff_offers.meta.recurring.is_recurring` (Product Type SOT). Возможно появление false-recurring подписок на one-time products.                           | Высокий (риск регрессии)      |


## Нужен ли writer extension

**Да, минимум 3 расширения** (для отдельного PATCH H2.1c-i, после approve анализа):

1. `**context='legacy_one_time'**` с приёмом `{ legacy_order_id, tracking_id, transaction_uid, customer_anchors }`;
2. **Legacy-order bridge**: внутри writer'а — `resolveLegacyOrder(legacy_order_id)` → создать/найти `orders_v2`-двойник по детерминированному mapping, чтобы канонический grant-flow работал на UUID;
3. `**resolveTariffByCode(product_id, tariff_code)**` — id-first резолвер для legacy orders без `tariff_id`.

Race-guard, ensurePrimaryEntitlement, Telegram-invoke уже реализованы в `three_ds_writer.ts` (H2.1b-ii) и переиспользуются.

## Какие тесты потребуются (для H2.1c-i, не сейчас)

- `legacy_one_time_writer_test.ts`:
  1. legacy order с `product_v2_id + tariff_code` → bootstrap_created;
  2. legacy order с существующей подпиской (same tariff) → extended;
  3. legacy order с tariff mismatch → новая подписка от даты оплаты (по `Extend ↔ Tariff Match`);
  4. legacy order без `tariff_code` → `manual_review_no_tariff`;
  5. legacy order без `product_v2_id` (v1-only) → `manual_review_v1_only`;
  6. recurring snapshot: one-time tariff → `auto_renew=false` (анти-регрессия G8);
  7. Telegram multi-club (несколько `access_rules` `grant_target_type='club'`) → writer вызывает grant per club;
  8. orphan-order путь: order создан через `orders_v2`, writer успешно отрабатывает;
  9. static check: legacy zone в `bepaid-webhook` после рефакторинга = 0 direct access writes, 0 direct telegram invokes.

## Discovery-задачи (read-only, для proof)

Все — через `supabase--read_query`, без записи:

- **D1**: количество legacy `orders` за последние 90 дней, попавших в зону 2 (paid, без orders_v2-пары) — оценка трафика;
- **D2**: распределение `meta.product_v2_id IS NULL` vs `NOT NULL` в этих orders — приоритет G3;
- **D3**: список distinct `product_code` без `products_v2`-зеркала среди продаваемых за 90д — список v1-only продуктов на депрекейт;
- **D4**: за 30 дней — webhook вызовы `[WEBHOOK-LEGACY]` (zone 1, materialization-only) — частота и unmatched-доля;
- **D5**: примеры (5–10) legacy orders → проверить наличие `auto_renew=true` подписок на one-time tariff (G8 evidence).

## DoD анализа H2.1c

- proof-файл создан: `.lovable/proofs/patch_h2_1c_legacy_one_time_analysis_2026_05.md`;
- внутри — выжимка из этого плана + результаты D1–D5;
- список gap'ов с приоритетами;
- proposed writer-extension contract (TypeScript-сигнатуры, без реализации);
- риски G8 (false-recurring) с примерами из БД;
- `.lovable/plan.md` обновлён: H2.1c = analysis_complete (по аналогии с H2.1b);
- production DML = 0, миграций = 0, secrets без изменений;
- `mode=on` не включался.

## Что НЕ делаем в этом патче

- никаких изменений в `bepaid-webhook`;
- никаких изменений в `grant-access-for-order` / `three_ds_writer`;
- никаких миграций таблиц `orders` / `orders_v2` / `entitlements`;
- никакого data-repair (Рабчевская и др.);
- H2.1b-ii (3DS finalize) — закрыт, не трогаем;
- H2b atomic RPC — backlog, не входит.

## Следующие шаги (после approve анализа)

1. **H2.1c-i** — writer extension (`context='legacy_one_time'` + legacy-order bridge + tariff resolver) + тесты, без касания webhook;
2. **H2.1c-ii** — замена legacy зоны 2 в `bepaid-webhook` на delegate в writer + static check;
3. **H2.1c-iii** (опционально) — депрекейшен legacy v1 `subscriptions` updates (G5) и orphan-create через `orders_v2` (G7).

До закрытия всего H2.1c (i+ii) — `BEPAID_REBILL_MATERIALIZATION=on` запрещён.