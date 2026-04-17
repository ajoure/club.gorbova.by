да, согласен, с учетом правок:

1. В Этап 0 добавь отдельный discovery по **всем местам, где уже меняется orders_v2.pipeline_id / pipeline_stage_id**, а не только insert/update orders_v2 в целом. Нужно исключить скрытые конкурирующие апдейты, которые потом будут перетирать routing.
2. В таблице каналов добавь отдельную колонку:
  - **offer_id guaranteed?**
  - **order created before redirect or after webhook?**
3. И по каждому каналу зафиксируй это фактами. Сейчас это важно для STOP-guard, но в таблице явно не отражено.
4. В Этап 1 уточни, что snapshot пишется **только если routing валиден серверно**. Если конфиг невалиден, не надо сохранять “битый snapshot” в orders_v2.meta.
5. В Этап 2 добавь guard на UI:
  - если enabled=false, все 4 поля routing должны очищаться из формы или явно игнорироваться при сохранении;
  - если enabled=true, без pipeline и 3 стадий сохранить нельзя.
6. В Этап 2 добавь требование:
  - при смене pipeline **не просто сбрасывать** стадии, а пересчитывать их дефолтно по semantic type;
  - если у новой воронки нет нужной semantic-стадии, поле показывать пустым + ошибку, а не молча подставлять что-то неподходящее.
7. В Этап 3A зафиксируй, что pending-stage ставится **в единственной реальной точке materialize заказа**. Сейчас формулировка хорошая, но добавь явный критерий: если discovery найдёт несколько insert-flow, сначала унификация, потом routing.
8. В bepaid-create-token добавь в план, что snapshot должен включать:
  - stage_type_pending
  - stage_type_success
  - stage_type_failed
9. Это упростит диагностику и позволит быстрее отлавливать битые конфиги в webhook.
10. В Этап 3B manual override guard нужно чуть усилить. Сейчас у тебя:
  - если order.pipeline_id != snapshot.pipeline_id → skip
  - если order.pipeline_stage_id != snapshot.stage_on_pending → skip
11. Добавь отдельно:
  - если order.pipeline_stage_id IS NULL, но pipeline_id уже стоит и отличается ожидаемый flow — это тоже skip/manual anomaly;
  - если stage уже terminal и совпадает с целевым — не писать лишний update, а логировать idempotent skip.
12. В helper applyCrmStageOnTerminal добавь явный порядок:
  - прочитать order;
  - определить routing source;
  - провалидировать pipeline/stages;
  - проверить manual override;
  - только потом делать update.
13. И в плане прямо укажи, что **все ветки webhook обязаны вызывать один и тот же helper после определения terminal status**.
14. По failed-bucket добавь, что discovery должен собрать не только фактические значения orders_v2.status, но и **все provider statuses/events**, которые маппятся в terminal failure. Иначе можно покрыть не все ветки.
15. В Audit proof добавь ещё один обязательный кейс:

- webhook пришёл по заказу **без routing** → запись crm_stage_apply_skipped_invalid_config реально создана.

12. В Coverage proof расширь минимум до:

- guest checkout success
- guest checkout failed
- public /pay/:token success
- public /pay/:token failed

То есть не “2 канала, по одному сценарию”, а оба статуса на обоих каналах.

13. В DB proof добавь отдельную проверку на snapshot fallback:

- создать заказ, потом изменить routing в оффере, потом завершить оплату;
- стадия должна примениться **по snapshot заказа**, а не по новому состоянию оффера.

14. В STOP-guards добавь ещё один:

- если часть terminal-веток webhook обновляет статус заказа без доступа к offer_id/snapshot, STOP и сначала довести эти ветки до общего контракта.

15. В “Что не делаю” уточни:

- не меняешь существующую ручную работу менеджера в Kanban;
- не добавляешь авто-перемещение по промежуточным статусам кроме pending/success/failed.

16. В финальный DoD добавь явный пункт:

- **изменение/удаление оффера после создания заказа не влияет на маршрут уже созданного заказа** — доказано фактическим тестом и SELECT по orders_v2.meta.crm_routing_snapshot.

В остальном план хороший и уже собран правильно.

&nbsp;

## План v2: связка кнопки оплаты ↔ воронка продаж (с правками)

### Этап 0: Discovery (read-only, ОБЯЗАТЕЛЬНО до execute)

Перед любыми изменениями проведу dry-run и зафиксирую факты:

1. **Все точки insert/update `orders_v2**` — grep по проекту (`bepaid-create-token`, `bepaid-webhook`, `site-form-submit`, `payment-link-create`, `grant-access-for-order`, recurring/rebill ветки).
2. **Все реальные значения `orders_v2.status**` — `SELECT DISTINCT status FROM orders_v2` + grep всех `.update({ status: ... })` в edge functions.
3. **Стабильность `offer_id` в orders_v2** — проверить, во всех ли сценариях создания заказа проставляется `offer_id`. Если нет — **STOP-guard**: сначала add-only patch на нормализацию linkage, потом CRM routing.
4. **Точки материализации заказа** — подтвердить, единственная ли точка создания `orders_v2` или их несколько (в т.ч. webhook materialize).
5. **Канал → где берём routing → кто создаёт order** — таблица:


| Канал создания                 | Точка создания orders_v2     | Источник routing                 |
| ------------------------------ | ---------------------------- | -------------------------------- |
| Guest checkout (PaymentDialog) | bepaid-create-token          | offer.meta.crm_routing           |
| Лендинг + кнопка               | bepaid-create-token          | offer.meta.crm_routing           |
| Виджет/админка                 | bepaid-create-token          | offer.meta.crm_routing           |
| Публичная ссылка `/pay/:token` | bepaid-create-token          | offer.meta.crm_routing           |
| Recurring / rebill             | bepaid-webhook (materialize) | snapshot из родительского заказа |
| skipRedirect                   | bepaid-create-token          | offer.meta.crm_routing           |


Все — единая точка создания. Если discovery покажет расхождение → STOP, привожу к одной точке отдельным патчем.

### Этап 1: Хранение routing

**В оффере** (`tariff_offers.meta`):

```json
{ "crm_routing": { "enabled": true, "pipeline_id": "<uuid>",
  "stage_on_pending": "<uuid>", "stage_on_success": "<uuid>", "stage_on_failed": "<uuid>" } }
```

**Снапшот в заказе** (`orders_v2.meta.crm_routing_snapshot`) — пишется в момент создания:

```json
{ "pipeline_id": "<uuid>", "stage_on_pending": "<uuid>",
  "stage_on_success": "<uuid>", "stage_on_failed": "<uuid>",
  "offer_id": "<uuid>", "offer_updated_at": "<iso>",
  "pipeline_name": "<text>", "stage_names": {...}, "offer_title": "<text>" }
```

Snapshot — это SOT для webhook. Изменение/удаление оффера на исторические сделки не влияет.

### Этап 2: UI оффера (`AdminProductDetailV2.tsx`)

Секция «🎯 Привязка к воронке (CRM)» в Offer Dialog:

- Switch enabled
- Select pipeline → 3 Select stage с **автоподстановкой дефолтов** при выборе воронки:
  - `stage_on_pending` = первая `open`
  - `stage_on_success` = `closed_won`
  - `stage_on_failed` = `closed_lost`
- **Блокировка сохранения** + понятная ошибка, если в воронке нет одной из обязательных semantic-стадий.
- Показ UUID каждой выбранной стадии (отладка).

**Валидация (UI + сервер):**

- 3 stage_id различны
- все принадлежат выбранному pipeline
- `stage_on_pending.stage_type = 'open'`
- `stage_on_success.stage_type = 'closed_won'`
- `stage_on_failed.stage_type = 'closed_lost'`

### Этап 3: Backend — единая точка применения

**A. Создание заказа** (`bepaid-create-token`, единая функция):

- Читаем `offer.meta.crm_routing`
- Валидируем (тот же набор проверок, что в UI)
- Если ок — записываем `orders_v2.pipeline_id`, `pipeline_stage_id = stage_on_pending`, и полный snapshot в `orders_v2.meta.crm_routing_snapshot`
- Audit: `crm_stage_applied_pending`
- Если конфиг невалиден — `crm_stage_apply_skipped_invalid_config`, заказ создаётся без routing

**B. Webhook** (`bepaid-webhook`) — единый helper:

```ts
async function applyCrmStageOnTerminal(orderId, terminalKind: 'success'|'failed') {
  // 1. SOT: snapshot from order.meta.crm_routing_snapshot
  // 2. Fallback: tariff_offers.meta.crm_routing (по order.offer_id)
  // 3. Если ни там ни там — exit, лог crm_stage_apply_skipped_invalid_config
  // 4. Manual override guard:
  //    - если order.pipeline_id != snapshot.pipeline_id → skip (manual)
  //    - если order.pipeline_stage_id != snapshot.stage_on_pending → skip (manual)
  // 5. UPDATE pipeline_stage_id = snapshot[stage_on_<kind>]
  // 6. Audit: crm_stage_applied_<kind> | crm_stage_apply_skipped_manual_override
}
```

Вызывается из **всех веток**, где webhook ставит terminal status:

- one-time paid / failed / canceled / expired
- link_payment paid / failed
- recurring / rebill paid / failed
- skipRedirect / guest checkout
- materialize/reconcile

**Полный список terminal-статусов** уточняется в Discovery; helper маппит:

- success-bucket: `paid`
- failed-bucket: `failed`, `canceled`, `expired` (+ всё, что найдёт discovery)

### Этап 4: Audit logs

Отдельные `action`:

- `crm_stage_applied_pending` — при создании заказа
- `crm_stage_applied_success` — webhook успех
- `crm_stage_applied_failed` — webhook неуспех
- `crm_stage_apply_skipped_manual_override` — менеджер уже двигал
- `crm_stage_apply_skipped_invalid_config` — нет snapshot и нет fallback

В meta каждой записи: `order_id`, `pipeline_id`, `from_stage_id`, `to_stage_id`, **+ человекочитаемые** `pipeline_name`, `stage_name_from`, `stage_name_to`, `offer_title`, `trigger_status`, `creds_source` где применимо.

### Файлы


| #   | Файл                                              | Изменение                                                       |
| --- | ------------------------------------------------- | --------------------------------------------------------------- |
| 1   | `src/hooks/useTariffOffers.tsx`                   | Тип `crm_routing` в `OfferMetaConfig`                           |
| 2   | `src/pages/admin/AdminProductDetailV2.tsx`        | UI секция CRM + валидация semantic stage_type + auto-defaults   |
| 3   | `supabase/functions/bepaid-create-token/index.ts` | Snapshot + pending-stage в единой точке создания order          |
| 4   | `supabase/functions/bepaid-webhook/index.ts`      | helper `applyCrmStageOnTerminal` + вызов из всех terminal-веток |


Без новых таблиц, без новых RPC, без изменений RLS.

### DoD (расширенный)

**UI proof:**

1. Открыт оффер, секция CRM видна, дефолты подставились автоматически.
2. Попытка сохранить без `closed_won` в воронке → блокировка с понятной ошибкой.

**DB proof (через SELECT):**
3. После checkout: `orders_v2.pipeline_id` + `pipeline_stage_id` заполнены = `stage_on_pending`.
4. `orders_v2.meta->'crm_routing_snapshot'` содержит полный снапшот с `offer_id`, `offer_updated_at`, человекочитаемыми именами.
5. После успешной оплаты: `pipeline_stage_id` = `stage_on_success`.
6. После failed/canceled/expired: `pipeline_stage_id` = `stage_on_failed`.
7. Сценарий manual override: вручную переношу сделку в другую open-stage → webhook завершает оплату → стадия НЕ перезаписана.
8. Изменяю/удаляю оффер после создания заказа → webhook всё равно применяет правильный stage из snapshot.

**Audit proof:**
9. `audit_logs` содержит `crm_stage_applied_pending`, `crm_stage_applied_success` (или `_failed`), `crm_stage_apply_skipped_manual_override` (для случая 7), `crm_stage_apply_skipped_invalid_config` (для оффера без routing).

**Coverage proof:**
10. Тест прогнан минимум на 2 каналах: guest checkout + публичная ссылка `/pay/:token`. Один заказ — success, один — failed.

### STOP-guards перед execute

- Если discovery найдёт заказы без `offer_id` → STOP, отдельный add-only patch на linkage.
- Если discovery найдёт >1 точки создания `orders_v2` → STOP, привести к единой точке.
- Если в активных воронках нет `closed_won` / `closed_lost` стадий → предупреждение пользователю до сохранения.

### Что НЕ делаю

- Не создаю новые таблицы / RPC / RLS.
- Не дублирую логику apply-stage (один helper).
- Не использую name/code в логике (только в audit для читабельности).
- Не меняю Kanban / pipelines / stages.