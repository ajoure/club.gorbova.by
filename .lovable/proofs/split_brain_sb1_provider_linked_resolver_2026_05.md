# PATCH SB1 — Provider-Linked Subscription Resolver (2026-05-20)

## Контекст

После того как 2026-05-20 06:06 Ирина Белько самостоятельно оплатила публичную ссылку на BUSINESS-тариф Gorbova Club, в системе образовался **split-brain**:

- реальный bePaid `sbs_96311287f13c6391` (active, recurring) → `provider_subscriptions` → subv2 `46194979` (past_due, access_end_at=NULL);
- `grant-access-for-order` параллельно создал subv2 `81ba18e6` (active, до 2026-06-20, auto_renew=true) — без provider linkage.

`bepaid.subscription.processed` пишет в `46194979`, ЛК клиента и админ-кабинет видят `81ba18e6`. Следующий charge sbs_96311287 продлит past_due строку — отображаемая active subv2 истечёт через цикл, доступ слетит у платящего клиента.

Это инверсия SBS-mismatch guard: там foreign sbs против active sub блокируется; здесь own sbs против локального past_due pre-create не блокировался, потому что extend-резолвер искал только `status='active'`.

## Изменения

### Новый shared resolver

`supabase/functions/grant-access-for-order/provider_linked_subscription_resolver.ts`

Контракт:

1. Ищет `provider_subscriptions` для текущего order:
   - `order_id = orderId` OR
   - `meta->>'tracking_id'` оканчивается на `:order:{orderId}`
   - и `provider='bepaid'`, `state IN ('active','pending')`.
2. Строгий парс `tracking_id` (`^subv2:{uuid}:order:{uuid}$`), сверка `parsed_subv2_id == ps.subscription_v2_id` и `parsed_order_id == orderId`.
3. Подгружает referenced subv2 и валидирует `user_id`, `product_id`, `tariff_id`, не-терминальный `status`.
4. Возвращает один из трёх исходов:

| Outcome | Что делает `grant-access-for-order` |
| ------- | ----------------------------------- |
| `no_provider_linked` | fall-through к legacy active-sub lookup (без изменений). |
| `extend` | использует найденную subv2 как `existingProductSub`, идёт в extend-ветку (status→active, access_end_at=calculated). |
| `manual_review_provider_linkage_conflict` | audit `grant-access-for-order.manual_review_provider_linkage_conflict`, merge `orders_v2.meta.manual_review=true`, HTTP 200 skipped, НИ ОДНОГО INSERT в `subscriptions_v2`/`entitlements`/`access_rules`. |

Причины manual_review (исчерпывающе): `tracking_id_parse_failed`, `tracking_id_subv2_mismatch`, `tracking_id_order_mismatch`, `subv2_not_found`, `user_mismatch`, `product_mismatch`, `tariff_mismatch`, `subv2_terminal_status`.

### Изменения в `index.ts`

- Импорт `resolveProviderLinkedSubscription` на верху.
- Вставлен новый блок перед существующей extend-логикой. Старый `if (extendFromCurrent)` теперь работает только когда `!existingProductSub` (т. е. провайдер-связь не нашлась).
- Резолвер запускается ДО SBS-mismatch guard и ДО active-sub lookup → не нарушает существующие проверки: при `extend` мы заводим pre-created subv2 в стандартную extend-ветку (которая уже идёт через snapshot resolver, dedupe и т.д.).

### Тесты (`provider_linked_subscription_resolver_test.ts`)

7 unit-тестов:

1. `parseTrackingId` strict format (positive + 5 negative).
2. **Белько-fixture**: pre-created past_due + active provider_subscriptions → `extend` (`tracking_id_strict_match`).
3. Пустые provider_subscriptions → `no_provider_linked`.
4. `tariff_mismatch` → manual_review.
5. Garbage tracking_id → manual_review (`tracking_id_parse_failed`).
6. Subv2 в superseded → manual_review (`subv2_terminal_status`).
7. provider_subscriptions в `expired` state → не попадает в кандидаты, `no_provider_linked`.

Регрессия: 49/49 тестов (`grant-access-for-order` всего) — green.

```
ok | 49 passed | 0 failed (458ms)
```

Deploy: `supabase--deploy_edge_functions(["grant-access-for-order"])` → success.

## Что НЕ сделано в SB1

- Repair Белько → отдельный PATCH-SB2 (sweep ниже), требует отдельного approve.
- Sweep execute → запрещён до отдельного approve.
- `gc_sync_failed` (GetCourse) → backlog.
- Зомби `794661f3`, `1d9700de` → отдельная INV-22 задача.

## Глобальный sweep SB1 — split-brain candidates (60 дней, READ-ONLY)

Условие: subv2 active+auto_renew без provider-linkage; существует sibling subv2 того же user/product/tariff с active/pending provider_subscriptions.

**Результат**: 5 пар, 5 уникальных юзеров, все на продукте `11c9f1b8…` (Gorbova Club).

| Orphan subv2 (display active) | Sibling subv2 (provider-linked) | Sibling status | sbs | Order on ps | Создан |
| --- | --- | --- | --- | --- | --- |
| `81ba18e6` (Белько) | `46194979` | past_due | `sbs_96311287…` | `59c6eb7d` | 2026-05-20 |
| `6c958e24` | `eb3c44a4` | expired | `sbs_ab176c1d…` | — | 2026-05-19 |
| `baa4baf9` | `cc56afbe` | expired | `sbs_8ef1ed6a…` | — | 2026-05-17 |
| `52884e7d` | `f99611fc` | **active** | `sbs_a6ad6a20…` | — | 2026-05-16 |
| `28d7775b` | `ca4f901f` | past_due | `sbs_216c18c5…` | `1a5dc67a` | 2026-05-15 |

Особо опасный: `52884e7d` ↔ `f99611fc` — обе active с одним sbs (dual-active, риск двойного charge видимости).

## DoD SB1

- [x] Resolver добавлен с строгим parse и hard guard.
- [x] index.ts вызывает резолвер ДО legacy active-sub lookup.
- [x] При conflict — early return HTTP 200, никаких INSERT.
- [x] При extend — audit `grant-access-for-order.provider_linked_extend` с tracking_id + match_reason.
- [x] Tests: 7 новых + 49 общих passed.
- [x] Deploy: grant-access-for-order успешно задеплоен.
- [x] Read-only sweep: 5 split-brain пар идентифицированы.

## DoD SB2 (отдельный approve)

- [ ] Белько: provider_subscriptions `4e201ec8` перенесён на `81ba18e6`.
- [ ] `46194979` → status=`superseded`, auto_renew=false, meta.superseded_by, meta.superseded_reason.
- [ ] `81ba18e6.meta` дополнен bepaid_subscription_id, repaired_from_subv2_id, repair_batch.
- [ ] Audit `subscription.split_brain_repaired` с before/after snapshot.
- [ ] Rollback SQL приложен.
- [ ] Аналогично — для остальных 4 пар (отдельно по каждой).
