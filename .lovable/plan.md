да, согласен, с учетом правок:

План правильный. Stage E должен быть минимальным wiring существующего CRM-routing, а Stage F — доказательством универсальности на другом продукте.

## 1. Исторические RR-заказы backfill только с negative snapshot

Для `ORD-26-00296/297/298/300/303/304` на момент создания `meta.crm_routing` отсутствовал. Поэтому их snapshot должен отражать исторический факт:

```text
enabled=false
reason=routing_disabled_or_missing
pipeline_id=NULL
pipeline_stage_id=NULL

```

Не пересчитывать исторический snapshot из будущих настроек оффера. Даже если менеджер позже включит routing, старые заказы не должны задним числом получить другую маршрутизацию.

Stage-переходы для этих шести заказов не выполнять.

## 2. E.1 реализовать через существующий TypeScript helper

Не переносить логику `_shared/crm-routing.ts` вручную в SQL: это создаст вторую реализацию правил fallback и валидации.

Предпочтительный путь:

```text
public-rr-installment-initiate
→ resolveOfferRoutingWithFallback(offer_id, tariff_id)
→ передать server-calculated snapshot в rr_get_or_create_pending_order
→ записать snapshot только при INSERT нового заказа

```

Условия:

- snapshot вычисляется backend-side, не принимается из публичного request body;
- positive snapshot заполняет `pipeline_id` и pending stage;
- negative snapshot также обязательно сохраняется;
- reuse существующего заказа не изменяет snapshot;
- остальные вызовы RPC после изменения сигнатуры не ломаются.

Если параметр RPC публично доступен, он не должен позволять клиенту самостоятельно выбрать pipeline или stage.

## 3. Отказные статусы не определять новым списком вручную

Не считать любой статус, отличный от `authorized`, неуспешным.

Использовать только статусы, которые существующий RR-контур уже классифицирует как terminal и передаёт в:

- `rr_finalize_order_rejected`;
- `rr_finalize_order_not_created`;
- существующую ветку canceled, если она реально есть.

Для них вызывать:

```text
applyCrmStageOnTerminal(order_id, 'failed', canonical_trigger)

```

Статусы вроде:

```text
outcome_unknown
operator_required
partial
processing

```

не переводить в failed — они остаются pending/manual согласно существующему lifecycle.

Отдельного согласования списка не требуется: сначала взять его из фактического status classifier в `rr-webhook`/`rr-notification`, затем подключить CRM-вызов в уже существующие terminal-ветки.

## 4. Настройка routing

Три действующих RR-оффера автоматически не изменять. Настройка их реальных pipeline/stages остаётся решением менеджера продукта.

Но для Stage F **тестовый non-CB offer обязательно настроить с positive** `meta.crm_routing`, иначе будет проверен только negative snapshot, но не фактический переход:

```text
pending stage
→ RR paid
→ success stage

```

Использовать test-safe pipeline/stages либо существующий pipeline, где тестовый заказ не помешает работе менеджеров.

## 5. Исправить проверку срока в Stage F

В плане указано:

> `expires_at = paid_at + access_days`

Это не соответствует уже внедрённому canonical resolver.

Проверять нужно:

```text
entitlement_source.starts_at = значение canonical resolveAccessWindow
entitlement_source.expires_at = starts_at + tariffs.access_days

```

Для текущей реализации `starts_at` обычно соответствует `order.created_at`. Не вводить отдельное RR-правило от `paid_at`.

Также фактическая таблица:

```text
entitlements

```

а не `entitlements_v2`.

## 6. Stage F должен проверить зарегистрированного владельца

Для универсального smoke использовать test-safe зарегистрированный профиль, чтобы подтвердить не только payment, но и access:

- новый non-CB product;
- новый tariff;
- `access_days`, например 30;
- BYN price;
- `bank_installment` offer;
- positive CRM routing;
- зарегистрированный `user_id/profile_id`.

После webhook проверить:

- отдельный `entitlement_source` именно нового заказа;
- агрегированный entitlement нового продукта;
- email/Telegram либо явный допустимый `skipped`;
- CRM success stage.

Анонимный заказ с `no_user_id` не будет полным доказательством Stage F.

## 7. Test-product не должен требовать специальной страницы или backend-кода

Использовать существующий универсальный route/component для продуктов и офферов.

Не создавать:

- отдельную RR-страницу;
- специальную кнопку;
- условие по product code;
- временный hardcode UUID.

После теста:

- деактивировать offer;
- деактивировать тестовый product;
- сохранить заказ, payment и access-source как audit-историю;
- не удалять связанные финансовые записи.

## 8. Проверки Stage E

Для нового заказа с positive routing:

1. При создании:
  - snapshot сохранён;
  - `pipeline_id` заполнен;
  - `pipeline_stage_id = stage_on_pending`.
2. После authorized:
  - stage изменён на `stage_on_success`;
  - snapshot не изменён;
  - повторный webhook не создаёт нового перехода.
3. Manual override:
  - оператор меняет stage после создания заказа;
  - webhook не перезаписывает ручное изменение, если canonical guard именно это предусматривает;
  - после теста вернуть test-order в ожидаемое состояние только если это безопасно.
4. Failed status:
  - проверить минимум одну безопасную terminal failed-ветку test-order;
  - stage → `stage_on_failed`;
  - повторное событие — no-op.

## 9. Итоговый порядок

```text
E.1 server-side CRM snapshot при создании RR-order
→ E.2 success/failed terminal hooks
→ E.3 negative historical backfill шести заказов
→ runtime positive CRM test
→ runtime failed CRM test
→ Stage F non-CB product smoke
→ deactivate test offer/product
→ компактный отчёт

```

## Статус после выполнения

При полном PASS:

```text
Sprint C2 Stage E: VERIFIED, PASS
Sprint C2 Stage F: VERIFIED, PASS
Sprint C2 overall: VERIFIED, PASS

```

Останавливаться по двум открытым вопросам не требуется:

- failed statuses взять из уже существующей terminal-классификации RR;
- реальные три оффера не настраивать автоматически, positive routing проверить на отдельном test-offer.
- &nbsp;
- План: Sprint C2 Stage E (Discovery + Wiring) и Stage F (universal button smoke)

## 1. Discovery существующего универсального контура — результат

Найдён один канонический CRM-pipeline модуль `supabase/functions/_shared/crm-routing.ts`. Он уже используется Stripe и bePaid:

- `resolveOfferRoutingWithFallback(offer_id, tariff_id)` — читает `tariff_offers.meta.crm_routing`, валидирует `pipeline_id + stage_on_pending/success/failed`, возвращает positive/negative `CrmRoutingSnapshot`.
- `buildNegativeSnapshot(...)` + `auditNegativeSnapshot(...)` — B.0 инвариант: snapshot всегда присутствует в `orders_v2.meta.crm_routing_snapshot`.
- `applyCrmStageOnTerminal(order_id, 'success'|'failed', trigger)` — идемпотентный перевод стадии с manual-override guard; SOT — только `meta.crm_routing_snapshot`, без fallback на текущий offer.

Точки интеграции у существующих провайдеров:

- `stripe-webhook/index.ts`: `applyCrmStageOnTerminal(order_id, 'success')` — на `checkout.session.completed` и `payment_intent.succeeded`; `'failed'` — на `payment_intent.payment_failed`. Строки 432, 557, 615.
- `bepaid-webhook/index.ts`: `applyCrmStageOnTerminal(...)` — на первичной оплате (success/failed), link-order paid/failed, rebill сохраняет `pipeline_stage_id` родительского заказа. Строки 2520, 4032, 4252, 4722, 5194.

Контакт/сделка:

- Внутренний CRM — универсально через `orders_v2.pipeline_id + pipeline_stage_id + meta.crm_routing_snapshot`. Отдельной сущности «deal» нет: SOT — сам `orders_v2`, привязанный к product/tariff/offer/user и содержащий сумму, комиссию, статус.
- Внешний AmoCRM (bePaid, строки 390/453) — отдельный, необязательный, non-blocking слой; вне scope этой задачи.

Комиссия — уже в `payments_v2.commission_minor + meta.commission` (D.2, verified). Универсально.

## 2. Что уже переиспользуется в RR полностью

- Universal button `startBankInstallment` + `public-rr-installment-initiate` — без hardcode продукта/UUID. Инициируется из UniversalPricingSection, TariffCard, ProductLanding, SitePageBySlug, LeadRequestDialog.
- `rr_get_or_create_pending_order` — создаёт `orders_v2` через тот же путь, что Stripe/bePaid (offer_id → tariff_id → product_id, currency, amount).
- `rr-webhook` промоушен → `payments_v2` (D.1 provider_payment_id=NULL, D.2 commission enrichment, D.3 idempotent, C runtime bridge → entitlement_sources).

## 3. Реальный gap для универсальности (проверено данными)

Все 6 RR-заказов (ORD-26-00296/297/298/300/303/304) имеют:

```
pipeline_id            = NULL
pipeline_stage_id      = NULL
meta.crm_routing_snapshot = отсутствует
```

Все 3 активных `bank_installment` оффера имеют `meta.crm_routing = NULL`.

Итог: RR полностью проходит мимо универсального CRM pipeline. `_shared/crm-routing.ts` ни разу не вызывается ни в `rr_get_or_create_pending_order`, ни в `rr-webhook`, ни в `public-rr-installment-initiate`.

Именно здесь Stripe/bePaid и RR расходятся по логике. Никаких других расхождений discovery не выявил.

## 4. Минимальный add-only patch (Stage E)

Строго повторить то, что уже делают Stripe/bePaid. Ничего RR-специфичного не создавать.

E.1 — Snapshot при создании заказа (`rr_get_or_create_pending_order` RPC):

- В момент INSERT в `orders_v2` (только на новом заказе — reuse-ветки не трогаем) вызвать эквивалент `resolveOfferRoutingWithFallback(offer_id, tariff_id)` и записать в:
  - `orders_v2.pipeline_id` = snapshot.pipeline_id (positive) / NULL (negative);
  - `orders_v2.pipeline_stage_id` = snapshot.stage_on_pending / NULL;
  - `orders_v2.meta.crm_routing_snapshot` = positive или negative snapshot (B.0 инвариант — всегда есть).
- Реализация — SQL-порт `resolveOfferRoutingWithFallback` внутри RPC (без обращения к edge-функции), либо тонкая обёртка в `public-rr-installment-initiate` перед вызовом RPC, если проще прокинуть уже готовый snapshot параметром.
- Reuse-ветки (`initiation_status='pending'/'created'` в окне) — snapshot не переписываем, оставляем как есть (идемпотентность).

E.2 — Terminal stage в `rr-webhook`:

- После успешной промоции (paid) — `applyCrmStageOnTerminal(supabase, order_id, 'success', 'rr.webhook.paid')`. Non-blocking try/catch, ровно как в Stripe/bePaid.
- На финальных отказных статусах RR (rejected/canceled — уточнить точный список статусов провайдера) — `applyCrmStageOnTerminal(..., 'failed', 'rr.webhook.<status>')`.
- Idempotency guard внутри `applyCrmStageOnTerminal` уже реализован (SOT snapshot, manual-override guard) — повторные webhook не двигают стадию.

E.3 — Backfill snapshot для 6 существующих RR-заказов:

- Только если оффер получит `meta.crm_routing`. Если менеджер ещё не настроил routing на bank_installment офферах — записать negative snapshot с `reason='routing_disabled_or_missing'` (тот же путь, что и в новом заказе). Никаких stage-переводов на исторических заказах.

Ничего нового не создаём: ни таблиц, ни функций, ни RPC, ни enum. Только вызов существующих `_shared/crm-routing.ts` из RR-пути.

## 5. Stage F — universal button smoke (параллельно)

Discovery подтверждает отсутствие hardcode CB / конкретных UUID в UI-пути RR-кнопки. Проверяем это runtime-тестом:

F.1 — Setup test-product (add-only, seed через insert-tool):

- `products_v2`: тестовый продукт (не CB).
- `tariffs`: 1 тариф с `access_days` (например, 30).
- `tariff_prices`: BYN-цена.
- `tariff_offers`: `offer_type='bank_installment'`, `is_active=true`.

F.2 — Runtime probe:

- Открыть публичную страницу продукта → нажать RR-кнопку → пройти `public-rr-installment-initiate` → получить `orders_v2` (pending).
- `rr-admin-deliver-test-webhook` → paid.

F.3 — Verify (по чеклисту пользователя):

- `orders_v2`: определён правильный product/tariff/offer; amount = цена оффера; currency BYN.
- `payments_v2`: создан 1 платёж, provider_payment_id=NULL, `meta.rr.external_reference` = order_id (D.1/D.2).
- `entitlements_v2`/`entitlement_sources`: создан источник, `expires_at = paid_at + access_days` (C runtime bridge).
- CRM: если на тест-оффере включить `meta.crm_routing` — `orders_v2.pipeline_stage_id` перешёл в success через `applyCrmStageOnTerminal`. Если не включать — snapshot negative, `pipeline_id/stage_id=NULL`, но структурные поля продукта/тарифа/цены/срока корректны.
- Повторный webhook — идемпотентен, дублей нет.

F.4 — Teardown: soft-deactivate test-product (`is_active=false`) после проверки.

## 6. Порядок выполнения

1. Discovery — сделан выше (этот план).
2. E.1 add-only: snapshot в RPC / initiate.
3. E.2 add-only: `applyCrmStageOnTerminal` в `rr-webhook` (success + failed hooks).
4. E.3 backfill snapshot для 6 существующих RR-заказов (negative или positive в зависимости от того, включит ли менеджер `crm_routing` на офферах — по умолчанию negative).
5. F.1–F.4 — параллельно с E, после E.1/E.2, но без изменений backend после setup.
6. Компактный отчёт: order ID, payment ID, entitlement, snapshot, stage, повтор webhook — no dup.

## 7. DoD

- `rr-webhook`, `public-rr-installment-initiate`, `rr_get_or_create_pending_order` не содержат новых RR-специфичных CRM-функций — только вызовы `_shared/crm-routing.ts`.
- Новые RR-заказы имеют `meta.crm_routing_snapshot` (positive или negative) — B.0 инвариант.
- Повторный webhook не двигает стадию (idempotency).
- Manual stage change оператора не перезаписывается webhook'ом (уже гарантировано `applyCrmStageOnTerminal`).
- Stage F: RR работает на не-CB продукте без изменений backend.

## Открытые вопросы (до Execute)

1. Список финальных отказных статусов RR-провайдера для маппинга в `applyCrmStageOnTerminal('failed', ...)` — подтвердить по коду `rr-webhook`/`rr-notification`. Если единственная success-ветка и всё остальное остаётся `pending` до ручной отмены — можно ограничиться только `'success'` вызовом на первом шаге и добавить failed позже.
2. Настроить ли `meta.crm_routing` на трёх активных bank_installment офферах в рамках этой задачи, или оставить менеджеру (тогда все RR-заказы будут иметь negative snapshot, что тоже валидно и соответствует B.0). По умолчанию — оставить менеджеру, negative snapshot допустим.

Остановиться и уточнить только эти два пункта; в остальном — минимальный add-only patch без риска для Stripe/bePaid путей.