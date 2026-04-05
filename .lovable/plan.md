## да, согласен, с учетом правок:

&nbsp;

1. Не ограничивайся простой инверсией snapshot → product в 7 местах. Добавь **единый helper** для отображаемого названия сделки, чтобы не размножать одинаковую логику и не получить расхождение между экранами.
  Пример:
  &nbsp;
  - src/lib/deals/getDealDisplayName.ts
  - логика:
    &nbsp;
    1. products_[v2.name](http://v2.name) / deal.products_v2?.name
    2. fallback: purchase_snapshot.display_purchase_name
    3. fallback: "—"
    &nbsp;
  &nbsp;
2. Во всех 7 местах использовать **только этот helper**, а не локальные if/else.
  Это обязательный add-only, без переписывания остальной логики строк/карточек.
3. В helper добавить **защиту от битого snapshot**:
  &nbsp;
  - purchase_snapshot может быть null, строкой, объектом, кривым JSON
  - если parse неудачен, молча fallback на [product.name](http://product.name)
  - не допускать падения UI из-за snapshot
  &nbsp;
4. Для экранов, где есть и product, и deal.products_v2, явно зафиксируй приоритет:
  &nbsp;
  - сначала FK join текущей записи (deal.products_v2?.name)
  - затем альтернативное поле product?.name
  - затем snapshot
    Нужен единый порядок, одинаковый во всех местах.
  &nbsp;
5. product-names.ts менять **только если после grep реально есть места**, где названия сделок или purchase labels ещё строятся через этот маппинг.
  Если этот файл не участвует в рендере сделок на указанных 7 экранах — не трогать его ради “на всякий случай”.
6. Добавь proof-проверку:
  &nbsp;
  - grep всех usage display_purchase_name в UI
  - before/after screenshots минимум для:
    &nbsp;
    - таблицы сделок
    - карточки контакта
    - детали сделки
    &nbsp;
  - показать кейсы:
    &nbsp;
    - с product_id + устаревшим snapshot → отображается products_[v2.name](http://v2.name)
    - без product_id → отображается snapshot fallback
    &nbsp;
  &nbsp;
7. Отдельно зафиксируй STOP-guard:
  &nbsp;
  - БД не меняем
  - purchase_snapshot не мигрируем
  - create/update order flow не трогаем
  - меняется **только read/display layer**
  &nbsp;
8. В DoD добавь ещё 2 пункта:
  &nbsp;
  - нет ни одного admin-экрана, где при наличии product_id показывается старое snapshot-имя вместо products_[v2.name](http://v2.name)
  - сделки без product_id и без snapshot по-прежнему безопасно показывают "—" без ошибок рендера
  &nbsp;

&nbsp;

&nbsp;

Копируемый блок для вставки:

```
Добавь к плану следующие правки:

1. Не делать 7 независимых локальных инверсий логики. Создать единый helper:
   `src/lib/deals/getDealDisplayName.ts`

2. Логика helper строго такая:
   - сначала `deal.products_v2?.name`
   - затем `product?.name`
   - затем `purchase_snapshot.display_purchase_name`
   - затем `"—"`

3. Helper обязан безопасно обрабатывать `purchase_snapshot`:
   - null / undefined
   - object
   - string
   - битый JSON
   Никаких падений UI.

4. Все 7 экранов должны использовать только этот helper:
   - `src/pages/admin/AdminDeals.tsx`
   - `src/components/admin/ContactDetailSheet.tsx`
   - `src/components/admin/DealDetailSheet.tsx`
   - `src/components/admin/bepaid/ContactDealsDialog.tsx`
   - `src/components/admin/payments/LinkDealDialog.tsx`
   - `src/components/admin/payments/LinkSubscriptionDealDialog.tsx`
   - `src/components/admin/ContactPaymentsTab.tsx`

5. `product-names.ts` менять только если после grep будет доказано, что он реально участвует в рендере названий сделок в этих сценариях. Без доказательства — не трогать.

6. STOP-guard:
   - не менять БД
   - не менять `purchase_snapshot`
   - не менять create/update order flow
   - только display layer

7. Proof:
   - grep всех usage `display_purchase_name`
   - before/after screenshots:
     - таблица сделок
     - карточка контакта
     - детали сделки
   - кейс 1: есть `product_id` + старый snapshot → UI показывает `products_v2.name`
   - кейс 2: нет `product_id` → UI показывает snapshot fallback

8. DoD:
   - при наличии `product_id` везде показывается актуальное `products_v2.name`
   - тариф остаётся отдельной строкой
   - fallback на snapshot работает только если `product_id/name` отсутствует
   - без `product_id` и без snapshot UI показывает `"—"` без ошибок

План: Исправить отображение названий сделок — приоритет продукту, а не snapshot
```

### Проблема

Сейчас в UI (таблица сделок, карточка контакта, детали сделки) название берётся из `purchase_snapshot.display_purchase_name` — это исторический снимок, сохранённый при создании заказа. В нём используются устаревшие сокращения:


| snapshot (отображается сейчас) | актуальное название продукта                            |
| ------------------------------ | ------------------------------------------------------- |
| ЦБ 2.0 — Бухгалтер             | Ценный бухгалтер | 1 ступень 2.0 |                      |
| ЦБ 2.0 — Бизнес-леди           | Ценный бухгалтер | 1 ступень 2.0 |                      |
| ЦБ 2.0 — Главный бухгалтер     | Ценный бухгалтер | 1 ступень 2.0 |                      |
| ЦБ 2.0: Маркетплейсы           | Ценный бухгалтер | 1 ступень 2.0 | Модуль: Маркетплейсы |


Затронуто **466 сделок** с snapshot-именем и **2246 сделок** без snapshot (они уже корректно показывают FK-имя продукта).

### Решение

**Изменить приоритет отображения**: вместо `snapshot → product` сделать `product → snapshot (fallback)`.

Логика: если у сделки есть `product_id` и FK-join даёт `products_v2.name` — показывать его. Snapshot оставить только как fallback для сделок без product_id.

Тариф уже показывается отдельной строкой — дублировать его в названии продукта не нужно.

### Что меняется

**7 мест** с одинаковым паттерном (инвертировать приоритет):

```text
// БЫЛО:
if (snapshot?.display_purchase_name) return snapshot.display_purchase_name;
return product?.name || "—";

// СТАНЕТ:
const productName = product?.name || (deal.products_v2 as any)?.name;
if (productName) return productName;
return snapshot?.display_purchase_name || "—";
```

Файлы:

1. `src/pages/admin/AdminDeals.tsx` — таблица сделок (строка 413) + карточка (строка 962)
2. `src/components/admin/ContactDetailSheet.tsx` — карточка сделки в контакте (строка 3027)
3. `src/components/admin/DealDetailSheet.tsx` — детали сделки (строка 555)
4. `src/components/admin/bepaid/ContactDealsDialog.tsx` — диалог сделок (строка 104)
5. `src/components/admin/payments/LinkDealDialog.tsx` — привязка сделки (строка 106)
6. `src/components/admin/payments/LinkSubscriptionDealDialog.tsx` — привязка к подписке (строка 87)
7. `src/components/admin/ContactPaymentsTab.tsx` — вкладка платежей (строка 196)

### Дополнительно: обновить `product-names.ts`

Обновить маппинг `PRODUCT_NAMES` для актуальных кодов, чтобы вспомогательные места (если есть) тоже использовали правильные имена:

```ts
cb20: "Ценный бухгалтер | 1 ступень 2.0 |",
```

### Что НЕ меняется

- Данные в БД (`purchase_snapshot`) — не трогаем, это исторический снимок
- Логика создания заказов — snapshot по-прежнему сохраняется при оформлении
- Predicate, execute-flow, access rules — без изменений

### DoD

- Во всех экранах admin (таблица сделок, карточка контакта, детали сделки) название сделки = актуальное название продукта из `products_v2.name`
- Тариф отображается отдельной строкой (не дублируется в названии)
- Для сделок без `product_id` по-прежнему показывается snapshot как fallback