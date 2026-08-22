# План: отложенный доступ к докупаемым модулям продукта PRD-000039

Продукт: **«Ценный бухгалтер. Первая ступень. 20 поток»**, `PRD-000039`,
id `3e43fb28-8322-41bc-bfee-714731bdc630`. Тарифы `T-000076`, `T-000077`, `T-000078`.
Целевая дата открытия докупаемых модулей: **2026-10-01 00:00 Europe/Minsk = 2026-09-30T21:00:00Z**,
хранится только в БД на конкретной связи `offer_addons.access_opens_at`, без хардкода в коде.

## Вердикт preflight: PASS с одним конфигурационным дефектом

Изменений на этом шаге не вносил: 0 code edits, 0 commits, 0 migrations, 0 data writes, 0 deploy, 0 Publish.

### 1. HEAD и дерево
- managed HEAD = `origin/main` = `fb38de60f98eb17ce7efe4bb102b7967e6457af7`; `git status --porcelain` пусто.
- Это же SHA — текущий production effective SHA (последний Publish). Mismatch нет.

### 2. Существующий UI настройки кнопок — новое поле НЕ требуется
- `src/components/products/OfferAddonsEditor.tsx` уже умеет всё нужное:
  - режимы `immediate | fixed_date | manual` (строка 17, `accessModeLabel` 27-31);
  - поле даты и запись `access_opens_at` при добавлении связи (строки 96-115);
  - массовое применение режима/даты ко всем модулям одной кнопки (строки 138-152);
  - редактирование существующей связи (строки 327-345).
- Таблица `public.offer_addons` уже содержит `access_delivery_mode`, `access_opens_at`, `access_duration_days` на уровне «родительская кнопка (`parent_offer_id`) + модуль (`addon_product_id`/`addon_offer_id`)», то есть настройка индивидуальна для продукт+тариф/кнопка+модуль. Схему менять не нужно.
- Минимальное UI-дополнение (по желанию, не обязательное для цели): валидация «fixed_date без даты» уже есть; добавим только отображение даты в списке правил и подпись таймзоны Europe/Minsk.

### 3. Фактическая конфигурация PRD-000039 (read-back)
| метрика | значение |
|---|---|
| активных `offer_addons` | **108** |
| родительских кнопок | 12 |
| уникальных модулей | 9 |
| `access_delivery_mode='manual'` | **108** |
| `access_delivery_mode='fixed_date'` | 0 |
| `access_opens_at IS NOT NULL` | **0** |

Модули: PRD-000005, 011, 012, 015, 016, 017, 018, 022, 043.

### 4. Purchase flows и фактическое состояние покупок
- **Composable (order_group)**: `supabase/functions/_shared/finalize-composable-purchase.ts`.
  Оплаченных addon-позиций с lineage к PRD-000039 — **4**, для всех создан `scheduled_product_access` (`status='scheduled'`), активных entitlements по ним — **0**. Всего строк в `scheduled_product_access` — 4, все `scheduled`.
- **Standalone module order**: модуль покупается как `role='primary'` собственной кнопкой. В `finalize-composable-purchase.ts:188` primary всегда получает доступ немедленно — это законное поведение standalone-продажи, по канону не меняем.
- Классификация активных module-entitlements с 2026-07-15: 22 — `standalone_other_offer` (собственные офферы модулей, не addon-связи PRD-000039), 4 — `ent_without_order` (ручные выдачи). **Ни одной строки с доказанным lineage к addon-кнопкам PRD-000039.** Два таких entitlement существуют, но уже `revoked` (rollback 2026-08-02).

### 5. Root cause (точный)
1. **Конфигурация**: все 108 активных `offer_addons` PRD-000039 стоят в `manual` с `access_opens_at = NULL`. Открытие зависит от ручного действия администратора — детерминированной даты нет.
2. **Fail-open в коде**: `supabase/functions/_shared/finalize-composable-purchase.ts:182`
   `const configuredMode = String(snapshot.access_delivery_mode ?? "immediate");`
   При отсутствии ключа в `item_snapshot` покупка трактуется как немедленная. В `order_group_items` реально встречаются строки с `item_snapshot->>'access_delivery_mode' = NULL` (подтверждено выборкой) — то есть дефект достижим, а не теоретический.
3. **Активатор узкий**: `supabase/functions/activate-scheduled-product-access/index.ts:72` выбирает только `access_delivery_mode='fixed_date'`; `manual`-строки не откроются никогда автоматически, даже после наступления даты.
4. Снимок `resolve-composable-checkout.ts:112-115,152-155` тоже подставляет `"immediate"` по умолчанию — вторая точка fail-open.

## Что делаем

### Этап A — код (GitHub-first, ветка `codex/addon-access-guard`)
1. `finalize-composable-purchase.ts`: убрать дефолт `"immediate"`. Если в `item_snapshot` режима нет — **перечитать** связь `offer_addons` по `parent_offer_id + addon_offer_id/addon_product_id` этой позиции; если связь найдена — использовать её `access_delivery_mode`/`access_opens_at`/`access_duration_days`; если связь не найдена — **не выдавать доступ**, создать `scheduled_product_access` со статусом `scheduled` и `access_delivery_mode='manual'` (fail-closed), без расширения на другие продукты.
2. Единый guard-хелпер `_shared/resolve-effective-access-opening.ts`: одна функция «выдавать сейчас или планировать», подключается во всех fulfilment/replay/reconcile путях (`finalize-composable-purchase`, `activate-scheduled-product-access`, `payments-reconcile`, `bepaid-auto-process`, `grant-access-for-order` для addon-заказов). Правило: active entitlement создаётся только при `now >= access_opens_at`; иначе idempotent upsert `scheduled_product_access` по `order_group_item_id`.
3. `activate-scheduled-product-access`: активировать любые строки с `opens_at IS NOT NULL AND opens_at <= now()` независимо от `access_delivery_mode`; `manual` без даты остаётся ручным.
4. `resolve-composable-checkout.ts`: снимок обязан содержать режим/дату явно; отсутствие правила — ошибка резолва, а не `immediate`.
5. Frontend: `src/pages/Purchases.tsx` (блок «Куплен», строки 520-555) уже показывает покупку без доступа; добавляем показ даты открытия и для строк, у которых `opens_at` задан при `manual`. Учебный контент продолжает использовать только effective entitlement — новых путей открытия не вводим.
6. Тесты (vitest + SQL-контракт): immediate / fixed_date до даты / fixed_date после даты / manual / NULL snapshot → fail-closed / replay-идемпотентность / standalone primary остаётся immediate / старый законный доступ не трогается / граница ровно 2026-09-30T21:00:00Z (00:00 Europe/Minsk).
7. CI зелёный → PR → merge → фиксируем merge SHA.

### Этап B — миграция конфигурации (только после отдельного подтверждения)
Одна миграция, строго ограниченная:
```sql
UPDATE public.offer_addons oa
SET access_delivery_mode = 'fixed_date',
    access_opens_at = timestamptz '2026-09-30T21:00:00Z',
    updated_at = now()
FROM public.tariff_offers o
JOIN public.tariffs t ON t.id = o.tariff_id
WHERE oa.parent_offer_id = o.id
  AND t.product_id = '3e43fb28-8322-41bc-bfee-714731bdc630'
  AND oa.is_active;
```
Ожидаемо: **ровно 108 строк**, 12 кнопок, 9 модулей, 3 тарифа. Ни одна строка другого продукта (включая 21 поток) не затрагивается — read-back проверяет `count = 108` и `count(*) FROM offer_addons WHERE access_opens_at = ... AND parent_offer_id NOT IN (...) = 0`.

### Этап C — remediation (dry-run сначала, без PII)
Критерий lineage: entitlement → `orders_v2.id` → `order_group_items(role<>'primary')` → `order_groups` с primary-позицией на тарифе PRD-000039 → соответствующая `offer_addons`-связь.
Ожидаемые счётчики по текущим данным:
- entitlements к revoke/convert: **0** (единственные 2 строки с lineage уже `revoked`);
- существующие законные доступы (22 standalone + 4 ручных): **delta = 0**, не трогаем;
- `scheduled_product_access`: 4 существующие строки с lineage к PRD-000039 обновляются с `manual` на `fixed_date` + `opens_at = 2026-09-30T21:00:00Z` (ожидаемо ровно 4 строки);
- новые scheduled-строки: 0 (все оплаченные addon-позиции уже имеют строку).
Любая строка без доказанного lineage — STOP, никаких массовых действий по `product_id`.

### Этап D — production
Отдельным подтверждением: применить миграцию Этапа B → deploy ровно перечисленных Edge Functions → live read-back (108/12/9, 4 scheduled с датой, 0 изменённых entitlements) → Publish frontend → проверка страницы «Покупки»: покупка видна, содержимое закрыто, дата открытия отображается.
Rollback: обратный `UPDATE` возвращает `manual`/`NULL` для тех же 108 строк; функции откатываются деплоем предыдущего SHA; entitlements не трогаются, поэтому откат безопасен.

## Execute gates
- HEAD == утверждённый merge SHA, чистое дерево;
- typecheck + новые тесты + production build PASS;
- dry-run миграции даёт ровно 108 строк и 0 посторонних;
- 0 записей в orders/payments/contacts/messages;
- любой mismatch или новый critical finding — STOP.
