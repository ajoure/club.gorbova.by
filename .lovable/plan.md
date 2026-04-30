дополни план следующей информацией:

1. **Главный приоритет — мгновенный webhook-flow**  
Ночная проверка — только аварийный fallback. Основной результат должен быть:
  - оплата прошла;
  - webhook получил статус paid/success;
  - `grant-access-for-order` сразу выдал primary + secondary доступы;
  - клиент видит доступы в течение 1–3 секунд.
2. **SOT по правилам доступов**  
Единственный источник правил — UI «Доступы» продукта/тарифа → `access_rules`.  
Все grants должны идти только через:
  - `source_product_id`;
  - `source_tariff_id`;
  - `target_product_ids`;
  - UUID, без названий/slug/string-match.
3. **Shared helper обязателен**  
Вынести `product_access` выдачу в общий helper и использовать его минимум в:
  - `grant-access-for-order`;
  - `rules-retroapply`;
  - `access-rules-nightly-reconcile`.
4. **Early return фикс**  
`skip_already_fulfilled` не должен выходить до secondary sync. Даже если primary access уже есть, helper должен проверить и догрантить бонусные доступы.
5. **Webhook DoD**  
Добавить отдельный DoD:
  - тестовая оплата BUSINESS → все product_access entitlements созданы/продлены сразу;
  - повторный webhook не создаёт дубли;
  - audit chain содержит `payment → order_paid → grant_primary → grant_secondary_product_access`.
6. **Fallback DoD**  
Ночной reconcile должен после нормальной оплаты ничего не чинить:
  &nbsp;
  - `missing=0`;
  - `needs_extension=0`;
  - `reactivated=0`;  
  если webhook-flow отработал правильно.
7. **UI/настройки**  
Не добавлять правила доступов где-либо ещё. Вся настройка должна оставаться только в UI «Доступы» продукта/тарифа.

&nbsp;

можно выполнять после dry-run.

&nbsp;

План:

## 1. Проблема

Автоматическая выдача бонусных/дополнительных доступов по правилам из вкладки «Доступы» продукта работает нестабильно: после покупки/продления Gorbova Club BUSINESS часть продуктовых доступов не создаётся или не продлевается, а иногда доступы затем истекают/отзываются, поэтому приходится вручную запускать пересчёт через `rules-retroapply`.

Цель: найти и устранить причины, а также добавить ежедневную ночную самопроверку в 03:00 по Минску, которая безопасно восстанавливает/продлевает доступы по `access_rules` без ручного вмешательства.

## 2. Диагностика: факты, уже подтверждённые чтением кода и БД

### Текущая архитектура

- Конфигурация выдачи находится в `access_rules`.
- Покупка/продление должна идти через `grant-access-for-order`.
- Ручной пересчёт во вкладке продукта вызывает `rules-retroapply`.
- Фактическая видимость продукта завязана на `entitlements`.
- Источник периода для Gorbova Club BUSINESS — `subscriptions_v2.access_end_at`.
- Уже есть hourly job `expire-stale-entitlements-hourly`, который переводит `entitlements.status='active'` в `expired`, если `expires_at < now()`.
- Уже есть hourly job `subscriptions-reconcile-hourly`, который может отзывать downstream-доступы после окончания подписки.

### Что найдено по Gorbova Club BUSINESS

- Product: `Gorbova Club`, id `11c9f1b8-0355-4753-bd74-40b42aa53616`.
- Tariff BUSINESS: id `7c748940-dcad-4c7c-a92e-76a2344622d3`, `access_days=30`.
- Для BUSINESS есть несколько активных `product_access` rules, включая:
  - правило на 9 продуктов ЦБ 1 ступень / модули;
  - правило на «Деньги BY 1 тариф»;
  - правило на «Подоходный налог с физлиц».
- По read-only dry-run SQL на текущей базе для BUSINESS найдено минимум:
  - `eligible_pairs = 328`;
  - `missing_entitlement = 1`;
  - `non_active_entitlement = 3`;
  - `needs_extension_or_null = 9`;
  - `satisfied = 315`.

Это подтверждает, что проблема не только в интерфейсе: в базе уже есть пользователи, которым по активной BUSINESS-подписке и правилам должен быть выровнен/восстановлен доступ.

## 3. Предварительные причины дефекта

### Причина A. `grant-access-for-order` содержит ранний idempotency return

В `grant-access-for-order` есть guard `skip_already_fulfilled`: если основной entitlement и subscription по заказу уже существуют, функция сразу возвращает success и не доходит до блока `product_access` rules.

Это опасно для повторных/задержанных fulfillment-вызовов: основной доступ уже есть, но вторичные доступы могли не выдаться ранее из-за сбоя, таймаута, изменения правил или race condition. При повторном вызове функция уже не пытается догрантить бонусы.

Планируемое исправление: даже при `already_fulfilled` запускать идемпотентный lightweight sync вторичных `product_access` rules, либо вынести вторичные grants в общий helper и вызвать его до return.

### Причина B. `grant-access-for-order` и `rules-retroapply` дублируют разную логику

В `grant-access-for-order` есть собственный блок обработки `product_access` rules.
В `rules-retroapply` есть другой блок классификации/execute тех же правил.

Различия:

- разные условия выбора правил;
- разные правила reactivation expired entitlement;
- разные meta-поля;
- разные условия безопасного update;
- разные batch/timeout характеристики.

Это нарушает single source of truth: ручной пересчёт может чинить то, что автоматический путь пропустил.

Планируемое исправление: вынести общую серверную логику `product_access` secondary grants в shared helper и использовать её и в `grant-access-for-order`, и в ночном reconciliation. `rules-retroapply` оставить как UI/manual wrapper, но выровнять его execute через тот же helper по возможности.

### Причина C. `rules-retroapply` на полном BUSINESS scope может таймаутиться

Пробный вызов `rules-retroapply` preview по BUSINESS из edge curl завершился `context canceled`. В коде видно N+1-подобную обработку: на каждое правило/target идут батчи и проверки, плюс checkPriorPurchase на пользователя/продукт.

Это объясняет, почему ручная кнопка иногда работает нестабильно или требует повторного запуска.

Планируемое исправление: ночной процесс должен быть batch-based, с лимитами, offset/keyset-пагинацией, advisory lock, audit summary и возможностью повторного добора на следующем запуске, а не одним большим full-scan без контроля.

### Причина D. `expire_stale_entitlements` истекает бонусный доступ раньше, чем repair успевает продлить

Сейчас hourly SQL function просто истекает любой active entitlement с `expires_at < now()`. Если продление BUSINESS прошло, но вторичный entitlement не был продлён из-за причин A/B/C, он будет переведён в `expired`.

Планируемое исправление: не отключать expire job, а добавить ночной repair раньше/стабильно, который reactivates expired secondary entitlements, если они снова подтверждены активной BUSINESS-подпиской и `access_rules`.

### Причина E. Риск неправильного отзыва Telegram/club доступов из-за неполного scope resolver

В `_shared/accessValidation.ts` комментарии говорят о `product_club_mappings`, но фактически lookup идёт по `access_rules`. Нужно проверить, учитывает ли он `tariff_id` rules без `product_id`, потому что часть правил Gorbova Club BUSINESS тарифные. Если club/product mapping берётся только из `product_id`, тарифные правила могут быть пропущены при revoke-guard.

Планируемое исправление: отдельно проверить и поправить resolver club/product ids так, чтобы tariff-level rules тоже корректно резолвились через `tariffs.product_id`, без возврата к legacy mappings.

## 4. Предлагаемое решение

### PATCH 1. Shared engine для вторичных product_access grants

Создать/выделить общий backend helper, например:

```text
supabase/functions/_shared/product-access-grants.ts
```

Функции helper:

- resolveProductAccessRules(source_product_id, source_tariff_id): тарифные правила + продуктовые fallback без string matching;
- resolveTargetProductIds(rule): только UUID из `conditions.target_product_ids` / `target_ref`;
- checkPriorPurchase через существующий `_shared/check-prior-purchase.ts`;
- calculateTargetExpiresAt:
  - если `duration_days` задан — fixed duration;
  - иначе `align_with_source` = `subscriptions_v2.access_end_at` активной/past_due подписки источника;
- upsert/reactivate entitlement по `(user_id, product_id)` с GREATEST-логикой, чтобы срок не уменьшался;
- писать `access_grant_ledger` для grant/update/reactivate/skip/failed;
- писать audit summary в `audit_logs`.

Важно: helper должен быть идемпотентным. Повторный вызов не должен создавать дубли и не должен сокращать срок.

### PATCH 2. Исправить `grant-access-for-order`

- Заменить текущий inline-блок `product_access` на вызов shared helper.
- В `skip_already_fulfilled` не выходить до проверки вторичных доступов: выполнить secondary sync и вернуть результат в `results.product_access`.
- Сохранять текущие security/integrity guards:
  - primary entitlement hard guard;
  - tariff-match extend guard;
  - GREATEST по primary entitlement;
  - `grant-access-for-order` остаётся единственным write-path для paid order fulfillment.

### PATCH 3. Ночная функция reconciliation в 03:00 Minsk

Добавить backend function, например:

```text
supabase/functions/access-rules-nightly-reconcile/index.ts
```

Режимы:

- `mode: "dry_run"` — только считает кандидатов и категории;
- `mode: "execute"` — применяет безопасные изменения;
- `scope_product_id`, `scope_tariff_id`, `limit`, `cursor` — для безопасного батчинга;
- `allow_reduce_access` по умолчанию `false`.

Что делает execute:

- находит активные source subscriptions по `access_rules`;
- по каждому `product_access` rule проверяет eligibility;
- создаёт missing entitlements;
- reactivates expired entitlements, если entitlement был создан rule engine / retroapply / fulfillment lineage и текущая подписка снова подтверждает доступ;
- продлевает active entitlements до source subscription access_end_at;
- не сокращает сроки по умолчанию;
- конфликтные/manual-source случаи только логирует как `requires_manual_review` / `conflict_existing`.

Отдельно: первая версия ночного repair будет сконцентрирована на `grant_target_type='product_access'`, потому что жалоба именно про бонусные продукты по Gorbova Club BUSINESS. Club/Telegram grant/revoke не смешивать в этот PATCH, кроме проверки revoke guards.

### PATCH 4. Cron в 03:00 по Минску

В проекте cron schedules выглядят как UTC. Минск = UTC+3, значит 03:00 Minsk = 00:00 UTC.

Добавить cron job:

```text
access-rules-nightly-reconcile-minsk-0300
schedule: 0 0 * * *
body: { "mode": "execute", "source": "cron", "target_tz": "Europe/Minsk", "target_hour": 3 }
```

Если решим использовать hourly wrapper с timezone guard, можно сделать как в `nightly-system-health-hourly`, но предпочтительнее простой daily job на 00:00 UTC.

### PATCH 5. Проверить и поправить revoke guards

- Проверить `_shared/accessValidation.ts` и `_shared/resolve-effective-access.ts` на корректный учёт tariff-level access_rules.
- Если tariff-level club/product relation сейчас теряется, добавить join через `tariffs.product_id`.
- Убедиться, что при истечении одной подписки доступ не отзывается, если есть другой активный источник по тому же club/product scope.

### PATCH 6. Наблюдаемость и админский контроль

Минимально:

- audit action `access_rules_nightly_reconcile.completed` / `.failed`;
- summary: scanned rules, scanned users, created, reactivated, extended, skipped_conflict, skipped_condition, errors;
- ledger rows по фактическим изменениям;
- логи edge function без сырых секретов.

Опционально после основного фикса: добавить в UI вкладки «Доступы» блок последнего ночного запуска и кнопку dry-run по текущему продукту.

## 5. Изменяемые компоненты

### Edge/shared code

- `supabase/functions/_shared/product-access-grants.ts` — новый общий helper.
- `supabase/functions/grant-access-for-order/index.ts` — заменить inline secondary product_access и исправить early return.
- `supabase/functions/rules-retroapply/index.ts` — по возможности выровнять execute через общий helper или хотя бы устранить расхождения по reactivation/update.
- `supabase/functions/access-rules-nightly-reconcile/index.ts` — новая ночная функция.
- `supabase/functions/_shared/accessValidation.ts` — проверить/исправить tariff-level scope для revoke guards.
- `supabase/functions/_shared/resolve-effective-access.ts` — проверить/исправить tariff-level scope при необходимости.

### Database / cron

- Cron job для ежедневного запуска в 03:00 Minsk.
- Возможно индексы, если dry-run покажет медленные места, например по:
  - `subscriptions_v2(product_id, tariff_id, status, access_end_at)`;
  - `entitlements(user_id, product_id, status)`;
  - `orders_v2(user_id, product_id, status)`.

Индексы добавлять только после проверки существующих индексов.

### UI

- Основной PATCH backend-only.
- UI менять только если потребуется показать статус ночного repair или сделать ручной dry-run стабильнее.

## 6. Что не будет изменено

- Не менять логику тарифов, цен, оплат, bePaid и public checkout.
- Не менять source of truth: `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules` остаются каноническими.
- Не делать массовое сокращение сроков доступов в ночной функции по умолчанию.
- Не восстанавливать доступы без подтверждения активной source subscription + active access_rule + prior purchase condition.
- Не создавать параллельную таблицу прав доступа.
- Не переводить ручные/конфликтные доступы автоматически без явного safe lineage.

## 7. Dry-run перед Execute

Перед реальными изменениями выполнить read-only/preview проверки:

1. Инвентаризация rules:
  - сколько active `product_access` rules;
  - сколько tariff-level vs product-level;
  - сколько `duration_days is null`.
2. Инвентаризация Gorbova Club BUSINESS:
  - eligible pairs;
  - missing;
  - expired but repairable;
  - active but needs extension;
  - conflicts/manual sources;
  - no source window.
3. Проверка индексов и планов выборок.
4. Тестовый dry-run новой функции:
  - `mode=dry_run`, `scope_tariff_id=BUSINESS`, small limit;
  - затем full dry-run без мутаций.
5. Сравнить dry-run новой функции с текущим `rules-retroapply` по количествам, но не требовать точного совпадения там, где старая логика ошибалась.

## 8. Execute

После одобрения:

1. Реализовать shared helper.
2. Подключить helper в `grant-access-for-order`.
3. Добавить nightly reconcile function.
4. Добавить/обновить tests или smoke scripts для helper/fn.
5. Deploy изменённых edge functions.
6. Выполнить dry-run на BUSINESS.
7. Выполнить controlled execute для BUSINESS, если rowcount в пределах STOP-guards.
8. Включить cron на 03:00 Minsk.
9. Проверить audit/ledger и повторный dry-run должен показать `missing=0`, `repairable=0/минимум`, без сокращений.

## 9. STOP-guards

Остановить execute и не менять данные, если:

- dry-run показывает неожиданно большой объём, например `missing + reactivated + extended > 500` за один запуск без отдельного подтверждения;
- есть `target_product_ids` не UUID или несуществующие продукты;
- source subscription не найдена для align_with_source;
- planned expiry меньше текущего expiry, а `allow_reduce_access=false`;
- entitlement имеет manual/admin source и не содержит safe lineage (`rule_engine_product_access`, `retroapply`, `source_rule_id`, `business_subscription_id`);
- есть несколько active entitlements для одного `(user_id, product_id)`;
- ledger insert массово падает;
- edge function получает timeout на первом batch;
- cron уже существует с таким именем или есть дублирующий workflow.

## 10. DoD

Задача считается выполненной, когда:

1. Покупка/продление Gorbova Club BUSINESS автоматически создаёт/продлевает все положенные `product_access` entitlements.
2. Повторный вызов `grant-access-for-order` для уже fulfilled order всё равно проверяет и догранчивает вторичные доступы идемпотентно.
3. Ночной reconcile в 03:00 Minsk включён и пишет audit summary.
4. Dry-run после execute показывает отсутствие repairable missing/expired/needs_extension по BUSINESS в рамках подтверждённой выборки.
5. `expires_at` не уменьшается без явного allow-reduce.
6. Expired secondary entitlement может быть безопасно reactivated при активной source subscription и подтверждённом rule.
7. Конфликтные/manual-source случаи не меняются автоматически, а попадают в audit/manual review.
8. Ledger содержит записи по созданным/обновлённым/пропущенным secondary grants.
9. Проверены логи edge functions без 500/timeout на контрольном запуске.
10. Не создан второй source of truth и не нарушены текущие правила ID-first.

## 11. Риски и зависимости

- Есть риск больших объёмов данных, поэтому нужен batch execution.
- `rules-retroapply` сейчас может таймаутиться на полном scope — нельзя просто поставить его в cron как есть.
- Нужно аккуратно работать с expired entitlements: reactivation разрешать только для safe lineage.
- Cron SQL содержит project-specific URL/key, поэтому его нельзя оформлять как обычную переносимую миграцию без учёта текущих правил проекта.
- Нужно сохранить совместимость с `expire_stale_entitlements-hourly` и `subscriptions-reconcile-hourly`.

## 12. Дополнительная информация

Дополнительных вопросов к вам сейчас нет. После одобрения плана я перейду к реализации с обязательным dry-run перед массовым execute.