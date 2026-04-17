## да, согласен, с учетом правок:

&nbsp;

1. Сначала в discovery отдельно подтверди, что **reuse existing open order** не ломает downstream-контракт:
  &nbsp;
  - grant-access-for-order
  - bepaid-webhook
  - payment_created
  - subscription_created
  - telegram_access_granted
  - purchase success modal
    Нужно явно показать, что повторный checkout по тому же order_id не создаёт побочных дублей/конфликтов.
  &nbsp;
2. В reuse-логике не ограничивайся только status IN (pending, failed, canceled). Источником истины для “открытости” должна быть **именно стадия CRM**:
  &nbsp;
  - candidate допустим только если текущий crm_pipeline_stages.stage_type = 'open'
  - статус заказа использовать как дополнительный фильтр, но не как основной критерий
    Это важно, потому что бизнес-правило у нас про открытую/закрытую сделку, а не только про статус платежа.
  &nbsp;
3. В discovery покажи полный mapping, **какие именно payment_flow существуют в этой зоне**, и какие из них реально могут попадать в сценарий бага:
  &nbsp;
  - admin link
  - site checkout
  - public link
  - guest checkout
    Нужно не предполагать renewal_one_time/guest_one_time, а подтвердить фактами по коду и/или БД.
  &nbsp;
4. В описании reuse-key добавь ещё один guard:
  &nbsp;
  - если у найденного open candidate **другой offer_id**, это нужно отдельно описать как допустимый reuse или STOP-case
    Иначе можно случайно слить в одну сделку разные бизнес-кнопки одного тарифа.
    Предлагаю правило:
  - если offer_id совпадает — reuse ok
  - если offer_id разный, но discovery подтверждает, что это один и тот же сценарий “ссылка → сайт” и это ожидаемо, тогда reuse ok с audit
  - если нельзя доказать безопасно — STOP/create new + audit
  &nbsp;
5. Для кейса “ссылка создана на 800, потом сайт оплатил на 800” и “ссылка создана на 800, потом сайт оплатил на 500/750” нужно в плане явно зафиксировать, **что именно обновляется в reused order**:
  &nbsp;
  - final_price
  - base_price
  - meta.last_checkout_source
  - meta.payment_attempts[]
  - meta.bepaid_checkout_token
  - возможно description/comment
    И отдельно указать, что не должно затираться:
  - crm_routing_snapshot
  - offer_id
  - история предыдущих попыток
  &nbsp;
6. Важное уточнение: при reuse existing order не надо просто “вернуть старый token” и не надо оставлять старый checkout-token как есть. Нужно явно прописать:
  &nbsp;
  - старый token считается устаревшим
  - новый checkout-token выпускается и записывается как текущий
  - в meta.payment_attempts[] или meta.checkout_tokens_history[] сохраняется история токенов/попыток
    Иначе потом будет трудно разбирать, какая попытка к какому webhook относилась.
  &nbsp;
7. Нужен отдельный guard на webhook/idempotency:
  &nbsp;
  - если по reused order приходят callbacks от старой и новой попытки, какой checkout считается актуальным?
  - как исключается применение terminal update от неактуального/старого токена?
    Это критичный момент. Если сейчас webhook не различает старый и новый checkout одной сделки, сначала покажи discovery и только потом меняй reuse.
    Без этого можно поймать race-condition.
  &nbsp;
8. В audit добавь ещё два события:
  &nbsp;
  - crm_deal_reuse_candidate_found
  - crm_deal_reuse_applied
    И отдельно:
  - crm_deal_reuse_skipped_offer_mismatch
  - crm_deal_reuse_skipped_closed
  - crm_deal_reuse_skipped_ambiguous
    Чтобы было видно не только финальный success, но и само решение reuse/create-new.
  &nbsp;
9. В test matrix добавь обязательный кейс race/idempotency:
  &nbsp;
  - первая попытка создана
  - выпущен второй checkout на тот же reused order
  - приходит callback от старой попытки
  - потом от новой
    Нужно доказать, что сделка не уходит в неверное состояние из-за старого callback.
  &nbsp;
10. В DoD добавь явную проверку:
  &nbsp;
  - crm_routing_snapshot при reuse **не меняется**
  - offer_id при reuse **не меняется**, если reuse признан допустимым
  - access/entitlement/telegram не дублируются при второй успешной попытке того же order
  &nbsp;
11. В отчёте обязательно отдельно покажи:
  &nbsp;
  - почему выбран reuse именно на уровне orders_v2, а не поверх отдельной CRM-сущности
  - почему это не ломает уже существующий контракт “order = deal”
  - почему вопрос access действительно безопасно вынесен в отдельный спринт
  &nbsp;
12. Если discovery покажет, что webhook не умеет безопасно отличать старую попытку checkout от новой по одному reused order_id, тогда не идти в reuse-token strategy сразу. В этом случае сначала дополни план информацией:
  &nbsp;
  - какой текущий идентификатор попытки является SoT
  - можно ли безопасно reuse order без риска неверного terminal callback
    Это критический STOP-guard.
  &nbsp;

&nbsp;

&nbsp;

В остальном план правильный: фикс действительно должен быть в одном каноническом месте — _shared/create-payment-checkout.ts, а вопрос доступов сейчас лучше не смешивать с этим патчем.

&nbsp;

План: PATCH — устранить дубль CRM-сделки при повторной оплате (с учётом всех guard'ов)

### Этап 1 — Discovery (read-only, до любых правок)

**1.1 Downstream-контракт reuse'а existing order_id**

Подтвердить фактами по коду, что повторный checkout на тот же `order_id` не ломает:


| Контракт                                           | Что проверить                                                                                                                                            | Где                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `grant-access-for-order`                           | идемпотентность по `order_id` (уже подтверждено `mem://architecture/fulfillment/grant-access-idempotency`) — повторный вызов не выдаёт дубль entitlement | `supabase/functions/grant-access-for-order/index.ts`    |
| `bepaid-webhook`                                   | как ищет order: по `tracking_id=link:order:{id}` или по `bepaid_uid`; что делает с уже `paid` order                                                      | `supabase/functions/bepaid-webhook/index.ts`            |
| `applyCrmStageOnTerminal`                          | защита от повторного применения success-stage                                                                                                            | `supabase/functions/_shared/applyCrmStageOnTerminal.ts` |
| `payment_created` / `subscription_created` события | эмитятся ли повторно при reuse                                                                                                                           | `supabase/functions/_shared/domain-events.ts`           |
| `telegram_access_granted`                          | дубль приглашения                                                                                                                                        | grant-access-for-order ветка telegram                   |
| Purchase success modal                             | как находит свой order, не покажет ли «оплачено дважды»                                                                                                  | `src/components/PaymentDialog.tsx`, `useOrderStatus`    |


**1.2 Mapping реальных `payment_flow` в зоне бага**

Вместо предположений — вытащить из БД distinct значения `meta->>payment_flow` за последние 30 дней по one-time orders + grep по коду всех мест, где этот ключ присваивается. Подтвердить точный список (admin link / site checkout / public link / guest), какие из них встречаются в сценарии «открытая ссылка → оплата на сайте».

**1.3 Webhook idempotency / token-lineage discovery (КРИТИЧЕСКИЙ STOP-guard)**

Прежде чем разрешать reuse с выпуском нового token'а, ответить:

- Какой идентификатор попытки является SoT для webhook? (`tracking_id`, `bepaid_uid`, `meta.bepaid_checkout_token`?)
- Если по reused `order_id` существуют 2 checkout'а (старый + новый), как webhook поймёт, какой callback актуален?
- Есть ли guard от применения terminal update от устаревшего токена?

**Если discovery покажет, что webhook не различает старый/новый checkout по одному `order_id` — STOP. План не идёт в reuse-token strategy без фикса этого guard'а.** В таком случае фикс будет двухступенчатый: сначала ввести явный `meta.active_checkout_token` + проверку в webhook, и только потом включать reuse.

**1.4 Карта write-path orders_v2** (уже частично собрана в прошлом плане, дополнить mapping всех `INSERT orders_v2`).

### Этап 2 — Reuse-key и правила (после discovery)

**Источник истины для «открытости» — стадия CRM, не статус заказа:**

```
candidate допустим ⇔
  candidate.user_id = current.user_id
  AND candidate.product_id = current.product_id
  AND candidate.tariff_id = current.tariff_id
  AND candidate.pipeline_stage_id IN (
    SELECT id FROM crm_pipeline_stages WHERE stage_type = 'open'
  )
  AND candidate.created_at >= now() - interval '3 days'
```

Статус заказа (`pending`/`failed`/`canceled`) — только дополнительный фильтр для логирования, не критерий.

**Offer-mismatch guard:**

- `candidate.offer_id == current.offer_id` → reuse OK.
- `candidate.offer_id != current.offer_id`, но оба относятся к одному `tariff_id` → audit `crm_deal_reuse_offer_changed`, reuse OK с пометкой; `**offer_id` в reused order НЕ меняется** (источник истины — первоначальный offer, по которому создана сделка). Новая попытка фиксируется как «оплата по тому же тарифу через другую кнопку».
- `candidate.offer_id` IS NULL и `current.offer_id` IS NOT NULL → разрешённый upgrade: записать `offer_id` в reused order, audit `crm_deal_offer_attached_on_reuse`.
- Если несколько open-кандидатов → STOP, audit `crm_deal_reuse_skipped_ambiguous`, создать новый.
- Если кандидат в `closed_won`/`closed_lost` стейдже → не reuse, audit `crm_deal_reuse_skipped_closed`, создать новый.

### Этап 3 — Что обновляется / что НЕ затирается при reuse


| Обновляется                                                    | Не затирается                                   |
| -------------------------------------------------------------- | ----------------------------------------------- |
| `final_price` (новая сумма)                                    | `crm_routing_snapshot`                          |
| `base_price` (если изменилась)                                 | `offer_id` (по правилам выше)                   |
| `meta.bepaid_checkout_token` (новый)                           | `pipeline_id`                                   |
| `meta.active_checkout_token` (новый — для webhook guard)       | `pipeline_stage_id` (остаётся stage_on_pending) |
| `meta.last_checkout_source`                                    | первоначальные `meta.payment_attempts[0..n-1]`  |
| `meta.payment_attempts[]` (append)                             | `meta.checkout_tokens_history[]` старые записи  |
| `meta.checkout_tokens_history[]` (append с timestamp + status) | `created_at`                                    |
| `description` (только если был пустой)                         | `id`, `tracking_id`                             |
| `updated_at`                                                   | &nbsp;                                          |


### Этап 4 — Webhook idempotency guard (если discovery 1.3 покажет проблему)

Ввести в `bepaid-webhook`:

- При получении callback извлекать `bepaid_uid` → находить order → сверять с `meta.active_checkout_token`.
- Если callback'овый token != active_token → audit `webhook_stale_token_ignored`, **не применять terminal update** (не двигать стадию, не grant access). Старый callback логируется, но игнорируется как устаревший.
- Это закрывает race: старая попытка → expire → новая попытка → success → старый callback приходит позже → игнорируется.

### Этап 5 — Изменяемые файлы (минимально)

1. `**supabase/functions/_shared/create-payment-checkout.ts**` — расширить дедуп-блок (one_time L129–203 и subscription L488–578) под новый reuse-алгоритм с stage-based матчингом и audit'ами.
2. `**supabase/functions/bepaid-webhook/index.ts**` — добавить stale-token guard (только если discovery 1.3 это потребует).

Не трогаем: `grant-access-for-order`, `applyCrmStageOnTerminal`, `admin-create-payment-link`, `public-checkout`, UI.

### Этап 6 — Audit события (полный набор)


| Action                                  | Когда                                       |
| --------------------------------------- | ------------------------------------------- |
| `crm_deal_reuse_candidate_found`        | найден open-кандидат (до решения)           |
| `crm_deal_reuse_applied`                | reuse применён (включая token re-issue)     |
| `crm_deal_reuse_offer_changed`          | reuse с другим offer_id того же тарифа      |
| `crm_deal_offer_attached_on_reuse`      | offer_id впервые проставлен на reused order |
| `crm_deal_reuse_skipped_closed`         | кандидат в closed-стейдже                   |
| `crm_deal_reuse_skipped_ambiguous`      | >1 open-кандидата                           |
| `crm_deal_reuse_skipped_offer_mismatch` | offer_id разный И не один тариф             |
| `reused_open_deal_on_success`           | webhook success на reused order             |
| `webhook_stale_token_ignored`           | callback от устаревшего токена              |


### Этап 7 — Test matrix (на `7500084@gmail.com` через `test-payment-complete`)


| #   | Сценарий                                                                        | Ожидание                                                              |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Admin link (pending) → site checkout same tariff → success                      | 1 order, reuse_applied + reused_on_success, stage→success             |
| 2   | Link 800 → site pay 800                                                         | reuse, final_price=800, attempts=2                                    |
| 3   | Link 800 → site pay 750 (override)                                              | reuse, final_price=750, offer_id не меняется, snapshot не меняется    |
| 4   | Link offer A → site checkout offer B того же тарифа                             | reuse + offer_changed audit, offer_id остаётся A                      |
| 5   | По closed_won сделке — новая оплата                                             | новая сделка, audit reuse_skipped_closed                              |
| 6   | По closed_lost сделке — новая оплата                                            | новая сделка, старая не двигается                                     |
| 7   | Repeated failed на тот же кейс                                                  | дубля нет, attempts++, stage остаётся в pending                       |
| 8   | **RACE**: link → новый checkout → старый callback приходит ПОСЛЕ нового success | старый callback игнорируется (stale_token), сделка остаётся в success |
| 9   | Чистый сценарий без existing                                                    | новый order создаётся, регрессии нет                                  |
| 10  | Два разных тарифа одного продукта параллельно                                   | две раздельные сделки, не сливаются                                   |


### Этап 8 — DoD (расширенный)

- Discovery 1.1–1.4 задокументирован отдельным блоком в отчёте с прямыми ссылками на код.
- В сценарии «link → site pay» в БД ровно **один** `orders_v2` со `status=paid`.
- `crm_routing_snapshot` при reuse не изменён (proof: diff snapshot до/после).
- `offer_id` при reuse не изменён, если reuse признан допустимым (proof: SQL).
- `entitlements` / `telegram_invites` не дублируются при второй success на reused order (proof: count по order_id).
- Race-test #8 проходит: старый callback не двигает стадию.
- Audit logs содержат полный набор событий из этапа 6.
- Не модифицированы: `grant-access-for-order`, `applyCrmStageOnTerminal`, UI.
- В отчёте отдельные блоки: «Почему reuse на уровне orders_v2, а не отдельной CRM-сущности», «Почему это не ломает контракт order=deal», «Почему access вынесен в отдельный спринт».
- Прогон test matrix #1–#10 на учётке пользователя.

### Scope

- **1–2 файла** правится: `_shared/create-payment-checkout.ts` (обязательно) + `bepaid-webhook/index.ts` (если discovery потребует stale-token guard).
- **0 миграций**, **0 новых edge functions**, **0 UI-изменений**.
- Access policy / сроки доступа / «30 дней» — **не трогаем**, отдельный backlog spring.

### STOP-условия

1. Если discovery 1.3 покажет, что webhook не может безопасно различать checkout-попытки по одному `order_id`, и stale-token guard окажется нетривиальным — вернуться с обновлённым планом, **не идти в reuse**.
2. Если discovery 1.2 покажет неожиданные `payment_flow` значения, влияющие на ключ — обновить reuse-key и согласовать.
3. Если найдётся write-path orders_v2 вне `createPaymentCheckout`, попадающий в этот сценарий — расширить scope патча или согласовать.