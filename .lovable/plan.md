дополни план следующей информацией:

1. **Сначала доказать источник покупки по UUID.**  
Перед любым execute по Ерастовой показать SQL-proof:
  - `orders_v2.status='paid'`;
  - `purchase_snapshot.module_list_mapped` содержит product_id модуля;
  - без string/name/slug matching.
2. **Для** `prior_purchase` **расширить SOT аккуратно:**
  - direct `orders_v2.product_id`;
  - mapped module UUID из `orders_v2.meta.purchase_snapshot.module_list_mapped`;
  - только `status='paid'`;
  - `excludeOrderId` сохраняется.
3. **Нельзя автоматически давать полный CB20 parent за покупку одного модуля.**  
Если найден только module-only purchase — выдаётся только соответствующий module target, с `scope_resolution_mode='module_scope_only'`.
4. **Meta обязательна для UI-read path:**
  - `scope_resolution_mode`;
  - `prior_purchase_match_type`;
  - `prior_purchase_order_id`;
  - `historical_module_product_ids`;
  - `source_rule_id`.
5. **Execute по Ерастовой — отдельно от BUSINESS.**  
Сначала targeted dry-run по пользователю. Если `failed=0/conflicts=0` и planned writes ожидаемые — только тогда targeted execute.
6. **Full BUSINESS execute не запускать автоматически.**  
После изменения prior_purchase логики сделать full dry-run. Если planned writes > 25 — отдельный approval.
7. **Training_content rule не менять до proof.**  
Сначала доказать, что entitlement есть, meta корректная, но read-path всё равно не показывает модуль. Только после этого править existing `training_content` rule.

Можно продолжать после этих правок.

&nbsp;

План:

## 1. Проблема

На примере Антонины/Ксении Ерастовой видно, что после BUSINESS доступы в админской вкладке «Доступы» выглядят частично корректно, но в личном кабинете отображается не всё. Конкретно по «Ценный бухгалтер 1 ступень 2.0» и модулю «Маркетплейсы» доступ должен соответствовать BUSINESS и прошлой покупке, но сейчас видимость и сроки расходятся.

## 2. Диагностика

Фактические находки:

1. У пользователя `antoninaerastova2020@gmail.com` есть активная подписка Gorbova Club BUSINESS:
  - product_id `11c9f1b8-0355-4753-bd74-40b42aa53616`
  - tariff_id `7c748940-dcad-4c7c-a92e-76a2344622d3`
  - access_end_at сейчас `2026-05-03 20:59:59+00`.
2. По `product_access` правилу BUSINESS для CB20 есть target list из полного продукта и модульных продуктов. При этом `prior_purchase` обязан проверяться только по фактическим paid orders.
3. Для «Маркетплейсы» есть исторический paid order, но он записан как:
  - `orders_v2.product_id = 7101ed3c...` (родительский продукт CB20)
  - `purchase_snapshot.module_list_mapped = [d7effaf4...]` (модуль «Маркетплейсы»)
   Поэтому прежний batch-cache, который смотрит только `orders_v2.product_id`, не видит эту покупку как prior_purchase для target module product_id.
4. Ранее существующий `check-prior-purchase.ts` уже умеет такой fallback через `purchase_snapshot.module_list_mapped`, но последний batch-cache был сделан слишком узким и потерял этот кейс. Это нарушило паритет single webhook-flow и batch/nightly-flow.
5. Второй баг: новые helper-записи product_access кладут meta без `scope_resolution_mode`, `historical_purchase_type`, `historical_module_product_ids`, `prior_purchase_order_id`. Runtime-хук `useTrainingContentRules` трактует такие legacy bonus entitlements как `no_scope`, из-за чего админка показывает entitlement, но личный кабинет может отфильтровать контент.
6. Третий баг конфигурации/видимости: у продукта-модуля «Маркетплейсы» training_content rule сейчас неактивен, а активный training module есть (`4c97d21c...`). Поэтому даже при наличии entitlement read-path может не получить корректную scope-инструкцию для личного кабинета.
7. Дополнительная проблема наблюдаемости: `access-rules-nightly-reconcile` сейчас не возвращает детальные `condition_not_met` по target product/user в полном отчёте, поэтому админке кажется «нет ошибок», хотя часть target-доступов пропущена по prior_purchase или no_scope.

## 3. Предлагаемое решение

### PATCH A — восстановить parity prior_purchase для batch/nightly

В `_shared/product-access-grants.ts` расширить batch prior-purchase cache без второго SOT:

- основной источник остаётся фактическая покупка: `orders_v2.status='paid'`;
- direct match: `orders_v2.product_id IN required_product_ids`;
- module fallback: `purchase_snapshot.historical_purchase_type='module_only_standalone'` + `purchase_snapshot.module_list_mapped` содержит target product_id;
- исключать `excludeOrderId`, если передан;
- сформировать `Map<user_id, Map<product_id, priorPurchaseInfo>>`, а не только `Set`, чтобы helper мог записать enriched meta.

Single webhook-flow сохранить быстрым:

- если `priorPurchaseCache` не передан, helper использует текущий `checkPriorPurchase`;
- если cache передан, N+1 нет, только cache.

### PATCH B — enriched meta для product_access entitlement

В `syncSecondaryProductAccessForUser` добавить в meta при prior_purchase:

- `historical_purchase_type`;
- `historical_tariff_id`;
- `historical_module_product_ids`;
- `scope_resolution_mode`:
  - full product/tariff purchase → `full_tariff_scope`;
  - module-only standalone → `module_scope_only`;
  - ambiguous/no mapping → `manual_review` или `no_scope`;
- `prior_purchase_match_type`;
- `prior_purchase_order_id`.

Это устранит рассинхрон «в админке доступ есть, а в личном кабинете контент скрыт».

### PATCH C — repair/reconcile для текущих BUSINESS-доступов

После кода выполнить dry-run по BUSINESS:

- `tariff_ids = ['7c748940-dcad-4c7c-a92e-76a2344622d3']`;
- отдельно по пользователю Ерастовой;
- проверить buckets: `condition_met`, `condition_not_met_prior_purchase`, `missing`, `needs_extension`, `reactivation_candidates`, `conflicts`, `failed`, плюс sample по target products.

Execute только после dry-run без timeout и при guards:

- `failed = 0`;
- `conflicts = 0`;
- planned writes для targeted user ожидаемо малые;
- для полного BUSINESS — остановка, если planned writes неожиданно > 25 без отдельного подтверждения.

Для Ерастовой ожидаем восстановить/обновить:

- CB20 parent;
- «Маркетплейсы» как module_only_standalone, если prior_purchase найден через `module_list_mapped`;
- другие модули только если есть фактический paid order/direct or mapped prior purchase.

### PATCH D — training_content visibility для standalone module products

Проверить и исправить существующие access_rules, не создавая параллельную архитектуру:

- для продукта «Ценный бухгалтер | Модуль: Маркетплейсы» активировать/восстановить корректное `training_content` правило на training module `4c97d21c...`, если dry-run подтвердит, что именно это блокирует видимость;
- не выдавать полный CB20 при покупке одного модуля;
- оставить rule-based visibility как SOT.

### PATCH E — наблюдаемость

Расширить response/audit `access-rules-nightly-reconcile`:

- добавлять sample skipped actions с `condition_not_met` по target product;
- отдельно показывать `prior_purchase_match_type`;
- в audit summary фиксировать `module_list_mapped_matches`.

## 4. Изменяемые компоненты

Edge/shared:

- `supabase/functions/_shared/product-access-grants.ts`
- при необходимости `supabase/functions/_shared/check-prior-purchase.ts` только для переиспользуемого типа/контракта
- `supabase/functions/access-rules-nightly-reconcile/index.ts`
- `supabase/functions/grant-access-for-order/index.ts` только если потребуется передать новый тип cache/metadata без изменения write-path

Database/config data:

- существующая таблица `access_rules` — только точечная правка/активация existing training_content rule для Маркетплейсов, если dry-run подтвердит;
- существующая таблица `entitlements` — controlled reconcile через helper, не ручные UPDATE без dry-run;
- `audit_logs` и `access_grant_ledger` — доказательства выполнения.

UI/read-path:

- `src/hooks/useTrainingContentRules.ts` — только если после meta-fix останется необходимость корректнее различать rule-engine bonus meta; без нового SOT.

## 5. Что не будет изменено

- Не будет hardcode по именам «Маркетплейсы», «Бизнес», email или slug.
- Не будет второго источника доступа.
- Не будет ручного массового UPDATE entitlements в обход helper/write-path.
- Не будет изменения цен, тарифов, order/payment логики.
- Не будет автоматического сокращения срока, пока `allowReduceAccess=false`.

## 6. Dry-run

Перед execute выполнить:

1. Dry-run helper/reconcile только по Ерастовой.
2. Dry-run по всему BUSINESS tariff.
3. SQL-проверка:
  - paid orders direct;
  - paid orders через `purchase_snapshot.module_list_mapped`;
  - active subscriptions;
  - entitlements meta;
  - training_content rules по target products.
4. Проверить личный кабинет read-path логически: entitlement + scope meta + training_content rule должны давать видимость.

## 7. Execute

После успешного dry-run:

1. Деплой изменённых edge functions.
2. Controlled execute по Ерастовой.
3. При необходимости controlled execute по BUSINESS с лимитом и STOP-guards.
4. Точечная активация/исправление existing training_content rule для Маркетплейсов, если подтверждено dry-run.
5. Повторный full dry-run.
6. Проверка `access_grant_ledger` и `audit_logs`.

## 8. STOP-guards

Остановиться и не выполнять write, если:

- `failed > 0`;
- `conflict_manual/conflict_multiple/conflict_other_rule > 0`;
- dry-run показывает неожиданный planned write-count;
- найдено, что target product не имеет training module или имеет несколько неоднозначных root modules;
- prior_purchase найден только по тексту/name/slug, а не по UUID/product_id/module_list_mapped;
- full BUSINESS dry-run уходит в timeout.

## 9. DoD

Задача считается выполненной, когда:

1. Для Ерастовой `access-rules-nightly-reconcile dry_run` показывает expected condition_met для реально купленных продуктов/модулей.
2. «Маркетплейсы» имеет active entitlement до срока BUSINESS и meta со `scope_resolution_mode=module_scope_only` и `historical_module_product_ids=[d7effaf4...]`.
3. Личный кабинет получает видимость модуля «Маркетплейсы» через rule-based read-path.
4. Full BUSINESS dry-run без timeout, `failed=0`, `conflicts=0`.
5. Webhook-flow и nightly-flow дают одинаковую prior_purchase классификацию.
6. `access_grant_ledger` содержит корректные записи, `audit_logs` содержит summary.
7. Cron 03:00 Minsk остаётся включён и будет контролировать drift.

## 10. Риски и зависимости

- Исторические GetCourse orders могут иметь module mapping только в `purchase_snapshot`; это надо считать допустимым фактом покупки, но только через UUID `module_list_mapped`, не через названия.
- Для старых entitlements потребуется безопасное обновление meta, иначе UI продолжит скрывать контент.
- Если у какого-то модуля нет активного training_content rule, нужно исправлять именно существующее правило/привязку, а не обходить фильтр в UI.