# да, согласен, с учетом правок:

&nbsp;

1. В D48 добавь точный приоритет определения origin badge, чтобы не было двусмысленности:  

  - reconcile_source = 'rule_engine' → Авто-выдача
  - reconcile_source = 'getcourse_historical' → Историческая покупка
  - reconcile_source = 'bepaid_archive_import' → Импорт bePaid
  - manual/admin order → Ручной заказ только по явному признаку в meta/source, а не просто по offer_id IS NULL
  - всё остальное → Базовый заказ  
  Иначе обычные заказы без reconcile_source можно перепутать с ручными.
2. &nbsp;
3. В D45 уточни, что CopyableIdChip для offer_id показывает сокращённый вид, но копирует полный UUID, а не truncated строку. Иначе диагностическая ценность теряется.

&nbsp;

&nbsp;

В остальном план уже можно принимать:

&nbsp;

- snapshot и UI доведены,
- карточка контакта включена в обязательный proof,
- legacy contract зафиксирован,
- tree base → child оформлен правильно,
- три pilot-сценария покрывают ключевые режимы.

  План: Финальные дополнения — IDs в snapshot, multi-access UI, legacy contract, origin badges, 3 pilot scenarios

---

## Дополнения к утверждённому плану

### D45: IDs и public_ids в snapshot и UI карточке

В `purchase_snapshot` minimum contract уже есть `product_id`, `tariff_id`, `offer_id`, `product_public_id`, `tariff_public_id`. Дополнение — в UI карточке заказа блок «Условия покупки» должен показывать:

- `product_public_id` (e.g. PRD-000012) — как CopyableIdChip
- `tariff_public_id` — как CopyableIdChip
- `offer_id` — как CopyableIdChip (truncated UUID)
- `reconcile_source` / тип заказа — как бейдж

Это позволяет из карточки сделки сразу скопировать точные ID для диагностики.

### D46: Множественные access-объекты в блоке «Фактический доступ»

Если у одного order несколько связанных subscriptions или entitlements (extend, reactivate, bonus), UI показывает **каждую строку отдельно**:

```text
▸ Фактический доступ
  Подписка #1: active, 01.03–31.03.2026
  Подписка #2: expired, 01.01–31.01.2026 (предыдущий период)
  Entitlement #1: active, expires 31.03.2026
  Entitlement #2: expired, was until 31.01.2026
```

Каждая строка — отдельный row с собственным статусом и датами. Нет агрегации. Запрос:

- `subscriptions_v2 WHERE order_id = :orderId ORDER BY access_start_at DESC`
- `entitlements WHERE order_id = :orderId ORDER BY created_at DESC`

### D47: Legacy UI contract

Два явных случая:

**1. Нет `purchase_snapshot`:**

- Бейдж **«Legacy»** (серый) в блоке «Условия покупки»
- Данные берутся из live join (fallback)
- Мелкий текст: *«Условия восстановлены из текущих данных продукта. Могут отличаться от условий на момент покупки.»*

**2. Нет linkage по `order_id` (subscriptions/entitlements без FK):**

- Блок «Фактический доступ» показывает: *«Связанные доступы недоступны для legacy-заказа»*
- Блок «Связанные объекты» показывает: *«Linkage недоступен для legacy-заказа»*
- Не пустой блок, а явное объяснение ограничения

### D48: Origin badges в linkage tree

Каждая ветка linkage tree получает обязательный бейдж источника:


| `reconcile_source` / meta                         | Бейдж                    | Цвет    |
| ------------------------------------------------- | ------------------------ | ------- |
| `null` (обычная покупка)                          | **Базовый заказ**        | default |
| `rule_engine`                                     | **Авто-выдача**          | blue    |
| `getcourse_historical`                            | **Историческая покупка** | gray    |
| admin-manual (нет offer_id, нет reconcile_source) | **Ручной заказ**         | amber   |
| `bepaid_archive_import`                           | **Импорт bePaid**        | gray    |


Бейдж показывается и в linkage tree, и в списке заказов (`OrderListItem`).

### D49: Три обязательных pilot UI сценария (PATCH 9)


| #   | Сценарий                               | Что проверяем                                                                                                                               |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Обычный реальный заказ**             | Три блока (snapshot / payment / actual access), IDs как CopyableIdChip, planned vs actual, бейдж «Базовый заказ»                            |
| 2   | **Historical imported order**          | Бейдж «Историческая покупка», snapshot с import fields, «Доступ завершён» если expired, original_access dates                               |
| 3   | **Base order с child synthetic grant** | Linkage tree: base → child, бейджи «Базовый заказ» + «Авто-выдача», child order snapshot с rule fields, обе ветки имеют свои access-объекты |


Дополнительно для legacy: найти старый order без snapshot → подтвердить бейдж «Legacy» + fallback + текст «Связанные доступы недоступны».

---

## Обновлённый PATCH plan (без изменений в последовательности)

```text
PATCH 0:   Нормализация offer_id в direct-charge
PATCH 0.5: Immutable purchase_snapshot — единый contract (все 8 write-paths)
PATCH 1:   Подтверждение product/tariff/offer IDs из БД
PATCH 2:   Dry run импорта GetCourse CSV
PATCH 3:   Импорт historical data + preflight + dedupe indexes
PATCH 4:   GC mapping → DB lookup
PATCH 5:   offer_grant_rules table + feature flag seed
PATCH 6:   grant_mode + rule engine (behind flag)
PATCH 7:   Admin UI
           - OrderDetailCard: три блока + IDs как CopyableIdChip (D45)
           - Блок «Фактический доступ»: все строки отдельно (D46)
           - Legacy contract: бейдж + fallback текст (D47)
           - OrderLinkageBlock: tree с origin badges (D48)
           - OrderListItem: snapshot-first + origin badges
           - ContactDetailSheet: интеграция
           - Rules preview
           - Analytics safety
PATCH 8:   Legacy fields SQL comments
PATCH 9:   Pilot — 3 обязательных UI сценария (D49)
           - Сценарий 1: реальный заказ
           - Сценарий 2: historical import
           - Сценарий 3: base + child synthetic
           - Дополнительно: legacy order без snapshot
           - flag OFF/ON, analytics
PATCH 10:  Rollout
```

---

## DoD (дополнения 52-56)

52. **IDs в UI**: snapshot-блок показывает product_public_id, tariff_public_id, offer_id как CopyableIdChip + reconcile_source как бейдж
53. **Multi-access**: блок «Фактический доступ» показывает все subscriptions и entitlements по order_id отдельными строками, не агрегированно
54. **Legacy UI**: orders без snapshot получают бейдж «Legacy» + fallback текст; orders без linkage показывают «Связанные доступы недоступны для legacy-заказа»
55. **Origin badges**: каждая ветка linkage tree имеет бейдж источника (Базовый заказ / Авто-выдача / Историческая покупка / Ручной заказ)
56. **Pilot 3 сценария**: обычный заказ + historical import + base с child synthetic — все три визуальных режима проверены в UI карточки контакта