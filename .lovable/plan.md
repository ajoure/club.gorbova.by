## GO EXECUTE

План в целом корректен. Выполнять можно, но с обязательными уточнениями ниже.

```text
DIAGNOSE                 : PASS
DB MIGRATION             : GO
ATOMIC REORDER RPC       : GO
ADMIN DND                : GO
SLOT/COLOR UI            : GO
LEGACY ROLE MIGRATION    : GO
CHECKOUT/WEBHOOK/RLS     : HOLD / НЕ ТРОГАТЬ

```

## Обязательные условия реализации

### 1. RPC должна отклонять дублированные ID

Одного сравнения длины массива и количества строк недостаточно. Массив вида:

```text
[id1, id1, id3]

```

может иметь правильную длину, но не соответствовать множеству офферов.

В RPC проверить одновременно:

```sql
cardinality(p_ordered_ids) = offer_count
count(DISTINCT id из p_ordered_ids) = offer_count
все переданные id принадлежат p_tariff_id
все офферы p_tariff_id присутствуют в массиве

```

Пустой тариф обрабатывать через `cardinality()`, а не `array_length()`, который возвращает `NULL` для пустого массива.

### 2. Блокировка должна быть детерминированной

При `FOR UPDATE` блокировать строки в стабильном порядке, например по `id`, чтобы снизить риск взаимных блокировок при параллельных reorder:

```sql
SELECT id
FROM public.tariff_offers
WHERE tariff_id = p_tariff_id
ORDER BY id
FOR UPDATE;

```

Вся проверка и перенумерация — в одном вызове и одной транзакции функции.

### 3. `SECURITY INVOKER` оставить

Это правильный выбор. RLS текущего пользователя должна продолжать действовать.

Но до применения подтвердить runtime:

```text
admin с правом редактирования продукта → RPC success
обычный authenticated               → denied
anonymous                            → function unavailable/denied

```

Не переводить RPC на `SECURITY DEFINER`.

### 4. Обновить Supabase TypeScript types

После добавления RPC обновить тип функции в generated database types, иначе вызов:

```ts
supabase.rpc("reorder_tariff_offers", ...)

```

может не пройти typecheck.

В scope добавить соответствующий generated-файл, вероятно:

```text
src/integrations/supabase/types.ts

```

Не обходить типизацию через `as any`.

### 5. Миграция `slot_role` должна быть транзакционно проверяемой

Использовать:

```sql
jsonb_set(
  COALESCE(meta, '{}'::jsonb),
  '{slot_role}',
  to_jsonb('button_N'::text),
  true
)

```

После UPDATE внутри той же миграции выполнить assertions:

```text
legacy slot_role count = 0
duplicate non-null slot_role per tariff = 0
активные dynamic-slot офферы проходят trigger contract

```

Если assertion не проходит — миграция должна завершиться ошибкой, а не частично примениться.

### 6. «Не размещать автоматически» — ключ должен отсутствовать

Не сохранять:

```json
{"slot_role": null}

```

и не сохранять:

```json
{"slot_role": ""}

```

При выборе этого пункта удалять ключ из `meta`:

```ts
const { slot_role: _removed, ...nextMeta } = currentMeta;

```

Либо использовать эквивалентную безопасную операцию.

Это важно для unique index, trigger и manifest logic.

### 7. Конфигурация sensors должна использовать API dnd-kit

Точная форма:

```ts
useSensor(MouseSensor, {
  activationConstraint: { distance: 5 },
});

useSensor(TouchSensor, {
  activationConstraint: {
    delay: 250,
    tolerance: 6,
  },
});

useSensor(KeyboardSensor, {
  coordinateGetter: sortableKeyboardCoordinates,
});

```

На drag handle передать и `attributes`, и `listeners`.

### 8. Optimistic rollback должен охватывать оба кэша

До optimistic update:

```text
cancelQueries product_offers
cancelQueries tariffs-with-offers
snapshot обоих кэшей

```

При ошибке RPC:

```text
restore product_offers snapshot
restore tariffs-with-offers snapshot
toast.error

```

Не восстанавливать только один источник, иначе UI может остаться в рассинхронизированном состоянии.

При нескольких быстрых drop не допустить, чтобы поздний rollback старой мутации перетёр более новый успешный порядок. Допустимые решения:

- блокировать повторный drag на время mutation;
- сериализовать reorder по `tariff_id`;
- использовать mutation context/version guard.

Предпочтительно блокировать новый reorder конкретного тарифа до завершения RPC.

### 9. Invalidate preview queries без псевдо-wildcard

React Query не понимает строковый wildcard вида:

```text
site-page-*

```

Использовать реальный prefix query key либо predicate:

```ts
queryClient.invalidateQueries({
  predicate: query =>
    Array.isArray(query.queryKey) &&
    String(query.queryKey[0]).startsWith("site-page"),
});

```

Точные действующие query keys сначала взять из кода.

### 10. Сортировка должна иметь стабильный fallback

Во всех местах:

```ts
sort_order ASC
id ASC

```

`NULL sort_order` перед DnD нормализовать предсказуемо. После первого reorder БД должна хранить строго:

```text
0, 1, 2, ... N-1

```

### 11. Удаление invoice-autoset

Удалить оба автоматических присваивания, но не потерять существующий `meta` при редактировании.

Проверить матрицу:

```text
смена offer_type       → slot_role не меняется
смена offer_type       → site_button_variant не меняется
смена slot_role        → offer_type/payment_method не меняются
смена цвета            → offer_type/payment_method не меняются
редактирование суммы   → slot/color сохраняются

```

## Runtime DoD

Кроме указанного плана, отчёт должен содержать реальные ID одного тарифа и его офферов:

```text
BEFORE:
offer A sort_order = ...
offer B sort_order = ...
offer C sort_order = ...

AFTER DND:
offer C sort_order = 0
offer A sort_order = 1
offer B sort_order = 2

```

Проверить:

1. Desktop mouse DnD.
2. Mobile long-press.
3. Keyboard reorder.
4. Reload админки — порядок сохранён.
5. Новый запрос публичной страницы — порядок новый.
6. Ошибка RPC — UI откатился.
7. Drag между тарифами не меняет данные.
8. `slot_role` после миграции содержит только `button_1…button_5` среди ранее размеченных строк.
9. Новый оффер создаётся без `slot_role`, с `primary`.
10. «Не размещать автоматически» реально удаляет JSON-ключ.
11. Typecheck и production build проходят.
12. Миграция применена ровно один раз.
13. Frontend не публиковать до отдельного отчёта.

## Команда исполнителю

```text
GO EXECUTE.

Выполнить Phase 1–5 по представленному плану с обязательными поправками:

- RPC проверяет cardinality, distinct IDs и полное совпадение множества;
- deterministic FOR UPDATE;
- SECURITY INVOKER;
- обновить generated Supabase RPC types, без as any;
- миграция с транзакционными assertions;
- «Не размещать» удаляет slot_role key;
- dnd-kit activationConstraint;
- rollback обоих query caches;
- исключить stale rollback при быстрых reorder;
- invalidate реальных preview query keys, без wildcard-строки;
- стабильная сортировка sort_order ASC, id ASC;
- invoice autoset удалить в обоих местах без потери meta.

После выполнения предоставить:
commit, migration name, SQL proof, typecheck/build,
desktop/mobile/keyboard DnD proof, rollback proof,
public fresh-fetch proof и список реально изменённых файлов.

FRONTEND PUBLISH: HOLD.

```

```text
PLAN VERDICT     : PASS WITH REQUIRED AMENDMENTS
EXECUTION        : GO
FRONTEND PUBLISH : HOLD


Diagnose checkpoint — результаты
```

**1. Фактические значения `meta.slot_role**` (`tariff_offers`, все строки):

```
NULL/''            63   (49 активных)
payment_card        3   (3 активных)
payment_invoice     3   (3 активных)
installment_bank    3   (3 активных)
installment_2       2   (2 активных)
installment_3       1   (1 активный)
```

Legacy-имён `installment_variant_1/2`, `bank_installment_variant_1`, `lead`, `other` в БД нет. Маппинг сокращается до 5 живых значений.

**2. Коллизии после маппинга.** Запрос по target-роли внутри `tariff_id` — 0 конфликтов.

**3. Тарифы с > 5 офферов.** Один тариф `a18df7a7-…` содержит 6 офферов → допустимый диапазон слотов расширяем до **button_1…button_10** (regex `^[a-z0-9_]{2,64}$` уже покрывает).

**4. Constraints и trigger:**

- `tariff_offers_meta_slot_role_format`: regex `^[a-z0-9_]{2,64}$` — новые имена проходят.
- `tariff_offers_meta_site_button_variant_allowlist`: `primary|outline|installment|legal_entity|lead` — не меняем.
- `tariff_offers_slot_role_per_tariff_uidx`: unique `(tariff_id, meta->>'slot_role')` where slot_role IS NOT NULL — сохраняем.
- `enforce_tariff_offer_slot_role` (trigger): для активного оффера slot_role обязателен **только если продукт уже opt-in в dynamic-slots** (хотя бы один сосед несёт slot_role). Для остальных продуктов «Не размещать автоматически» валиден.

**5. Tilda-маркеры в `site_pages.blocks`:**

- Всего блоков с `data-lovable-slot*`: **1** (страница slug=`cb`).
- Этот блок использует только `data-lovable-slot-group="tariff:buh"` (grouping-контейнер по tariff.code).
- Отдельных offer-level маркеров `data-lovable-slot="tariff:...|offer:<role>"` в DB **нет вообще** (0 совпадений).

**Вывод:** миграция `slot_role` для `tariff_offers` **не ломает** ни одну HTML-разметку в `site_pages`. Внешняя Tilda-разметка вне DB — под ответственностью пользователя; фиксируем это в отчёте, но блокером не считаем.

---

## Исправленный план

### Phase 1 — DB migration (одна миграция)

**1.1. RPC атомарной сортировки.**

```
CREATE OR REPLACE FUNCTION public.reorder_tariff_offers(
  p_tariff_id       uuid,
  p_ordered_ids     uuid[]
) RETURNS SETOF public.tariff_offers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
```

Логика: `SELECT … FOR UPDATE` всех офферов тарифа; проверка что `array_length(p_ordered_ids) = count(offers)` и что множества совпадают (никаких переносов между тарифами, никаких лишних id); запись `sort_order = ord - 1` через `UPDATE … FROM unnest() WITH ORDINALITY`; `RETURN QUERY SELECT * FROM tariff_offers WHERE tariff_id = p_tariff_id ORDER BY sort_order`.

`GRANT EXECUTE ON FUNCTION public.reorder_tariff_offers(uuid, uuid[]) TO authenticated;`

**1.2. Data-migration `slot_role**` (в той же миграции, идемпотентно):

```
payment_card     → button_1
payment_invoice  → button_2
installment_2    → button_3
installment_3    → button_4
installment_bank → button_5
```

Update-обходит все строки (active + inactive), сохраняет остальные ключи `meta`, `jsonb_set` + фильтр по текущему значению. После — assertion: `SELECT COUNT(*)` по легаси-именам должен быть 0.

**1.3. Trigger — не меняем.** Существующий контракт (slot_role обязателен только для dynamic-slot продуктов на активных офферах) полностью совместим с новыми `button_N`.

### Phase 2 — UI сортировки DnD

Файл `src/pages/admin/AdminProductDetailV2.tsx`:

- Убрать SortPill «Сумма / Тип» из секции офферов тарифа (сортировка тарифов и другие вкладки не затрагиваются).
- Список офферов внутри каждого тарифа — отдельный `DndContext + SortableContext` с sensors:
  - `MouseSensor { distance: 5 }`
  - `TouchSensor { delay: 250, tolerance: 6 }`
  - `KeyboardSensor { coordinateGetter: sortableKeyboardCoordinates }`
- `SortableContext` получает офферы отсортированные строго `sort_order ASC, id ASC`.
- `onDragEnd`: guard `active.data.current.tariffId === over.data.current.tariffId`; `arrayMove`; optimistic update кэшей `["product_offers", productId]` и `["tariffs-with-offers", productId]`; RPC `reorder_tariff_offers`; при ошибке — snapshot rollback + toast; при success — инвалидировать `product_offers`, `tariffs-with-offers`, `public-product`, `public-product-by-slug`, а также query-ключ preview-manifest (`site-page-*`).

Новый хук `useReorderTariffOffers` в `src/hooks/useTariffOffers.tsx`.

### Phase 3 — `OfferRowCompact`

- Новые props: `position: number`, `slotLabel?: string`, `dragHandleProps`, `isDragging?: boolean`.
- Слева — drag-handle `GripVertical` с `touch-action: none`, `stopPropagation`, `aria-label="Изменить порядок кнопки"`.
- В строке рядом с бейджем типа выводить два независимых индикатора:
  - `#1` — порядковый номер в списке (только визуальный).
  - `Слот: Кнопка 3` — если задан `meta.slot_role = button_N`.
  - `Не размещается на сайте` — если slot_role пустой.
- Никаких утверждений «#N всегда = Кнопка N».

### Phase 4 — Селекты диалога редактирования оффера

`AdminProductDetailV2.tsx`, диалог offer:

**«Слот на сайте»** (управляет `meta.slot_role`):

```
Не размещать автоматически  → ключ отсутствует
Кнопка 1                    → button_1
Кнопка 2                    → button_2
Кнопка 3                    → button_3
Кнопка 4                    → button_4
Кнопка 5                    → button_5
Кнопка 6                    → button_6
Кнопка 7                    → button_7
Кнопка 8                    → button_8
Кнопка 9                    → button_9
Кнопка 10                   → button_10
```

Удалить: custom-ввод роли, «Другое назначение», legacy-технические значения из UI.

**«Цвет кнопки»** (управляет `meta.site_button_variant`):

```
primary       → «Синяя (основная)»
outline       → «С контуром»
installment   → «Оранжевая (рассрочка)»
legal_entity  → «Зелёная (юрлицо)»
lead          → «Серая (заявка)»
```

Подпись: «Цвет кнопки не влияет на способ оплаты — только на внешний вид на публичной странице».

Дефолты нового оффера: `slot_role` отсутствует, `site_button_variant = 'primary'`.

Расширить `OfferMetaConfig` типами `slot_role?: string; site_button_variant?: SlotVariant` — убрать `as any`.

### Phase 5 — Убрать автоподстановки

В `AdminProductDetailV2.tsx` удалить оба места (строки ~791–792 и ~2134–2135), где для `offer_type='invoice'` принудительно проставляются `site_button_variant = 'legal_entity'` и `slot_role = 'payment_invoice'`. Смена `offer_type` не должна менять slot/color; смена slot/color не должна менять `offer_type` или `payment_method`.

### Что НЕ трогаем

- `siteSlotManifest.ts` — алгоритм не меняем; правим только docstring (примеры значений).
- `usePublicProduct`, `useTariffOffers` (публичные хуки) — уже читают `sort_order`.
- `bepaid-webhook`, checkout, RLS, edge functions, Telegram-уведомления.
- Realtime — в этот спринт не добавляем.

### DoD

```
DESKTOP DND                    : PASS (mouse)
MOBILE LONG-PRESS DND          : PASS (touch, 250ms)
KEYBOARD DND                   : PASS
CROSS-TARIFF DRAG BLOCKED      : PASS (guard)
ONE ATOMIC RPC                 : reorder_tariff_offers
OPTIMISTIC UPDATE + ROLLBACK   : PASS
DB sort_order                  : 0..N-1 после каждого drop
ADMIN PREVIEW REFRESH          : PASS (invalidate manifest queries)
PUBLIC FRESH FETCH ORDER       : PASS (уже включено через sort_order)
LEGACY slot_role VALUES        : 0 после миграции
TILDA HTML MARKERS             : 0 в site_pages — миграция HTML не требуется
                                 (внешняя Tilda вне DB — вне scope)
SLOT/COLOR AUTOSET             : удалены
CHECKOUT/WEBHOOK/RLS           : UNCHANGED
```

Формулировка обновления: admin-preview в текущей сессии — без ручной перезагрузки; новая загрузка публичной страницы — сразу новый порядок; уже открытая страница у другого пользователя без Realtime не обновится.

---

## Требуется подтверждение

Diagnose закрыт: коллизий нет, HTML-маркеров в `site_pages` нет, диапазон слотов расширен до `button_10` под тариф с 6 офферами. Подтвердите **GO EXECUTE** — тогда переключусь в build mode и выполню миграцию, RPC и UI-правки одним циклом.