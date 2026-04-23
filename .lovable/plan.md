# да, согласен, с учетом правок:

1. Добавить в plan явное правило для **writer-уровня**: `payment_type` — source of truth не только для admin/manual/reminder, но и для **любого CTA source**, который передаёт сценарий создания ссылки. Это нужно зафиксировать в audit-схеме:
  &nbsp;
  &nbsp;
  - `requested_payment_type`
  - `resolved_offer_id`
  - `resolved_mode: canonical | override`
  - `cta_source: admin_manual | reminder | contact_card | telegram_combined`  
  И в отчёте показать 3–5 реальных записей после фикса.
2. Усилить F2 backend validation: при override нельзя ограничиваться только `product/tariff/offer/amount`.  
Нужен ещё явный guard:
  - `offer` должен быть **active pay_now**;
  - нельзя использовать archived/inactive offer как источник параметров;
  - если у тарифа вообще нет ни одного active pay_now offer, override запрещён и writer возвращает controlled error.  
  Это важно, чтобы не получить one_time ссылку, созданную на основе мёртвого offer.
3. В `AdminPaymentLinkDialog` добавить отдельный **UI audit для режимов**:
  - на экране явно показывать бейдж/строку:
    - `Режим: Точное совпадение`
    - `Режим: Override`
  - рядом короткое объяснение, из какого offer берутся параметры.  
  Иначе support/admin потом не поймут, почему ссылка one_time создана по тарифу с recurring-offer.
4. В grep-checklist добавить ещё 4 обязательных точки:
  - `resolveCanonicalOffer(`
  - `generateRenewalCTAs(`
  - `payment_link.created`
  - `payment_link.type_mismatch_blocked` / любые старые mismatch guards  
  Нужно явно убедиться, что старые блокирующие проверки нигде не остались.
5. В entrypoints verification table добавить отдельную строку:
  - **Reminder CTA one_time через override**  
  потому что это отдельный критичный сценарий, и именно он раньше ломался при привязке к кнопкам.  
  Сейчас он не должен сливаться с обычным admin manual one_time.
6. По reminders уточнить дедуп-ключ в плане не только для SQL post-check, но и для runtime-логики.  
Нужно явно написать, что dedup выполняется по:
  - `user_id`
  - `product_id`
  - `tariff_id`
  - `payment_type`
  - `reminder_window` (1d / 3d / 7d)
  - `calendar_date`  
  Иначе можно случайно убрать нужную разницу между окнами 7/3/1 или между one_time/subscription CTA.
7. Добавить **контрольный endpoint / validation step** не как новый endpoint, а как обязательный backend proof:
  - после create writer должен вернуть пользователю/admin не только link id, но и в логах/ответе должно быть видно:
    &nbsp;
    - `payment_type`
    - `mode`
    - `offer_id`
    - `tariff_id`  
    Чтобы можно было мгновенно проверить, что link создан именно как one_time, а не silently switched.  
    Новый endpoint не создавать, но proof contract в existing response/audit нужен.
  &nbsp;
8. В Verify matrix добавить отдельную проверку **Telegram combined flow** именно в override-сценарии:
  - one_time ссылка, созданная через combined flow на тарифе без one_time offer;
  - payment_links.payment_type = one_time;
  - combined flow downstream не сломан.  
  Сейчас у вас regression по combined Telegram-flow упомянут, но не выделен в override-критичном кейсе.
9. Для кейса Марины добавить acceptance не только на `payment_links.payment_type='one_time'`, но и на **checkout copy/UI**:
  - bePaid checkout page не должна отображать subscription language / recurring hints;
  - сумма и тип соответствуют разовому платежу.  
  Иначе можно создать one_time link, но checkout всё ещё визуально вести как subscription.
10. Для кейса Елены уточнить acceptance:

&nbsp;

- если обе ссылки доходят до bePaid checkout, но провайдер отказывает одну из них, это не блокирует закрытие именно этого патча **при условии**, что:
  &nbsp;
  - type switch отсутствует;
  - canonical writer корректный;
  - `last_provider_error` заполнен;
  - причина отказа уже outside this patch.  
  Иначе вы привяжете закрытие патча к внешнему банку/антифроду.

&nbsp;

11. В STOP-guards разнести зоны явно:

- **UI guards**
- **writer guards**
- **reminder guards**
- **provider-failure guards**  
Сейчас они смешаны, а вы просили это разнести. Это упростит проверку выполнения.

12. Добавить в DoD явный пункт:

- `overrideMode` используется только как прозрачный способ создания one_time/subscription ссылки при отсутствии exact offer, но не меняет downstream и не создаёт новый checkout path.  
Это защитит от скрытого появления второй бизнес-логики.

13. По блоку «Версионирование контрактов CTA» — не делать сейчас отдельное полноценное versioning.  
Лучше зафиксировать минимально:

- `cta_contract_version: 1`
- писать его в audit/meta для новых reminder/admin links  
Это достаточно для трассировки и не раздувает scope.

14. По пункту «Автогенерация Reminder CTA» уточнить формулировку:

- не “автогенерация” в смысле новых сущностей,
- а **гарантированная генерация двух canonical links** через уже существующий writer.  
Иначе исполнитель снова может начать строить отдельный path для reminder links.

В остальном план уже правильный: он сохраняет старый согласованный контракт системы, убирает silent type switch и не ломает сценарий двух ссылок в reminders.

&nbsp;

План v2: фикс «one-time → subscription» с поддержкой admin/manual override

## Корневая причина (исправленная формулировка)

Проблема НЕ в том, что у тарифа нет one-time offer'а. Проблема в том, что **UI и writer молча подменяют выбор админа** на тип, навязанный найденным offer'ом:

1. `resolveCanonicalOffer(allOffers, 'one_time')` при отсутствии exact-match возвращает primary subscription-offer с `mismatchedType: true`.
2. `effectivePaymentType` (`AdminPaymentLinkDialog.tsx:214-219`) берёт тип **из offer'а**, а не из выбора админа.
3. В `admin-create-public-link` уходит `payment_type='subscription'`, и в `payment_links` создаётся subscription-ссылка — хотя админ выбрал «Разовый».

Контракт системы (старый, согласованный):

- `payment_type` ссылки = **выбор админа / источника CTA** (source of truth);
- `offer` = **источник параметров** тарифа (цена, описание, product linkage), а не ограничитель типа ссылки;
- допустимо создать `one_time` ссылку поверх тарифа, у которого есть только subscription-offer (controlled override с явным предупреждением).

## Что чиним

### F1. UI: выбор админа — source of truth, controlled override вместо silent fallback

В `src/components/admin/AdminPaymentLinkDialog.tsx`:

- `effectivePaymentType` всегда равен `paymentType` (выбор ToggleGroup). Никаких derive из `offer.meta.recurring`.
- `resolveCanonicalOffer(allOffers, desiredType)`:
  - Если есть exact-match (offer нужного типа) → **Режим A (canonical match)**, возвращаем его.
  - Если exact-match нет, но есть любой active pay_now offer → **Режим B (admin override)**, возвращаем его как **источник параметров** + флаг `overrideMode: true` + понятное сообщение для UI.
  - Если нет вообще никакого active pay_now offer / тариф неактивен / нет цены → `ok:false` (только тогда блокируем).
- UI:
  - В Режиме A — без предупреждений.
  - В Режиме B — `Alert` (не destructive, а warning): «У тарифа нет отдельной кнопки разовой оплаты. Будет создана разовая ссылка на основе текущего тарифа (цена, продукт, описание)». Кнопки **активны**.
  - Disabled — только при `ok:false` (нет цены / тариф неактивен / product invalid).
- Override через ручной выбор `selectedOfferId` другого типа: оставляем `paymentType` как выбрал админ, offer используем как источник параметров.

### F2. Backend: писатели сохраняют выбор админа, валидируют согласованность, но НЕ блокируют по recurring-flag

В `supabase/functions/admin-create-public-link/index.ts` и `admin-create-payment-link/index.ts`:

- УБРАТЬ guard «`payment_type` must match `offer.meta.recurring`» (его в текущем виде вводить нельзя).
- Валидация, которую добавляем:
  - product активен;
  - tariff активен и принадлежит product;
  - offer (если передан) принадлежит tariff;
  - `payment_type ∈ {'one_time','subscription'}`;
  - сумма резолвится корректно (из offer или tariff fallback).
- `payment_links.payment_type` записывается **строго равным** `payment_type` из тела запроса (= выбору админа / reminder CTA).
- Audit `payment_link.created` с полями `requested_type`, `offer_is_recurring`, `mode: 'canonical' | 'override'` — для трассировки, без блокировки.

### F3. Reminder CTA contract (восстановление)

В `supabase/functions/subscription-renewal-reminders/index.ts` / `generateRenewalCTAs`:

- Для одного и того же тарифа функция обязана уметь сгенерировать **обе** ссылки:
  - `payment_type='one_time'`;
  - `payment_type='subscription'`;
- Через тот же canonical writer (`admin-create-public-link`).
- Не требовать наличия двух разных offer-type записей в тарифе.
- Если у тарифа нет one-time offer — используется Режим B (override): one-time ссылка на основе тарифа.
- Дедупликация ссылок по ключу `(user_id, product_id, tariff_id, payment_type, date)` — переиспользовать ранее созданную ссылку, если она ещё валидна.

### F4. Operational case — Марина Колейчик / Елена

- Марина: пересоздать ссылку через исправленный flow с `payment_type='one_time'` → ожидание: ссылка ведёт на разовый платёж 150 BYN на тариф FULL.
- Елена (контрольный кейс P0):
  - сгенерировать обе ссылки (one_time + subscription) через canonical writer;
  - обе должны корректно дойти минимум до bePaid checkout без silent type switch;
  - при отказе провайдера — `orders_v2.meta.last_provider_error` содержит причину;
  - **P0 не закрывать**, пока на её кейсе не подтверждены оба сценария.

## Файлы

- `src/components/admin/AdminPaymentLinkDialog.tsx` — `resolveCanonicalOffer` (Режим A/B), `effectivePaymentType`, Alert вместо block, override-логика.
- `supabase/functions/admin-create-public-link/index.ts` — убрать recurring-guard, добавить валидацию product/tariff/offer/amount, audit.
- `supabase/functions/admin-create-payment-link/index.ts` — то же самое.
- `supabase/functions/subscription-renewal-reminders/index.ts` — `generateRenewalCTAs` гарантированно возвращает 2 ссылки (one_time + subscription) через canonical writer; дедуп по ключу.

DB-миграции: не нужны.

## Grep-checklist (deliverable в отчёте)

Для каждого entrypoint — таблица `keep / fix / reroute / verify`:

- `admin-create-public-link`
- `admin-create-payment-link`
- `generateRenewalCTAs`
- `subscription-renewal-reminders`
- `payment_links` (writes)
- `payment_type` (все присваивания)
- `resolveCanonicalOffer`
- `effectivePaymentType`
- `/pay/:token`
- `public-checkout`
- `PaymentDialog`
- `bepaid-create-token`

## Entrypoints verification table (deliverable в отчёте)


| Entrypoint                         | Writer                    | payment_links.payment_type | Создаёт orders_v2 | Downstream                    | Статус после фикса |
| ---------------------------------- | ------------------------- | -------------------------- | ----------------- | ----------------------------- | ------------------ |
| Ручная ссылка из карточки контакта | admin-create-payment-link | = выбор админа             | да                | bepaid-webhook → grant-access | fix                |
| Ручная публичная ссылка            | admin-create-public-link  | = выбор админа             | да                | то же                         | fix                |
| Reminder CTA one_time              | admin-create-public-link  | one_time                   | да                | то же                         | restore            |
| Reminder CTA subscription          | admin-create-public-link  | subscription               | да                | то же                         | restore            |
| Сайтовая кнопка тарифа             | canonical checkout        | = тип кнопки               | да                | то же                         | keep               |
| /pay/:token                        | public-checkout           | (read)                     | да                | то же                         | keep               |


## Verify matrix

**Платежи / canonical flow**

1. Тариф FULL (только subscription-offer) + админ выбирает «Разовый» → warning Alert + кнопки активны → создаётся `payment_links.payment_type='one_time'`. Ссылка ведёт на разовый платёж.
2. Тот же тариф + «Подписка» → Режим A, без warning, subscription-ссылка.
3. Тариф с one-time offer + «Разовый» → Режим A, без warning, one-time ссылка.
4. Принудительный POST в writer с произвольной комбинацией `payment_type` и `offer_id` (один тариф) → не блокируется по recurring-flag, `payment_links.payment_type` = из тела запроса.

**Reminders с двумя CTA**
5. Пользователь `auto_renew=false` с истекающим доступом → reminder приходит, в сообщении 2 CTA. Первая ссылка реально one_time, вторая реально subscription. Обе ведут в рабочий checkout.
6. Пользователь `auto_renew=true` + активная SBS → reminder без paylink (старая логика сохранена).

**Дедуп reminders (SQL before/after)**
7. SQL: `SELECT user_id, date(created_at), count(*) FROM audit_logs WHERE event_type LIKE '%reminder%' GROUP BY 1,2 HAVING count(*)>1` → ожидание: 0.
8. SQL: `SELECT user_id, product_id, tariff_id, payment_type, date(created_at), count(*) FROM payment_links WHERE source='reminder' GROUP BY 1,2,3,4,5 HAVING count(*)>1` → ожидание: 0.

**Контрольный кейс Елены**
9. Сгенерированы обе ссылки (one_time + subscription) через canonical writer; обе доходят до bePaid checkout без silent type switch; при отказе провайдера в `orders_v2.meta.last_provider_error` есть причина.

**Regression**
10. `/pay/:token` для уже существующих ссылок не сломан.
11. Combined Telegram-flow (writer admin-create-payment-link) не сломан.
12. Public-mode без user_id не сломан.

## STOP-guards

**Payments**

- Запрещено привязывать возможность создания one-time ссылки к обязательному существованию отдельного one-time offer.
- Запрещён silent override типа ссылки. Разрешён только explicit override с прозрачным warning и корректным `payment_type` на выходе.
- Запрещено возвращать 400 в writer'ах только из-за `payment_type ≠ offer.recurring`.
- Не закрывать P0 без runtime-proof обеих ссылок (one_time + subscription) на кейсе Елены.

**Reminders**

- Запрещено ломать reminder-flow с двумя ссылками: обе должны генерироваться даже если у тарифа нет one-time offer.
- Не выкатывать execute remaining users, если SQL-проверки 7/8 показали дубли.
- CTA не отправляются, если writer не смог создать ссылку (нет цены / тариф неактивен).

**Workaround / Elena**

- Public-link workaround не считается инженерным закрытием P0.
- Если public-link работает, а сайтовая кнопка нет — задача остаётся открытой.
- При отказе провайдера — фиксируем provider-error, не закрываем общим fallback.

## DoD

- `payment_links.payment_type` всегда равен выбору сценария (admin / manual / reminder CTA), **никогда не derived from `offer.meta.recurring**`.
- В UI для тарифа без one-time offer админ может создать one_time ссылку через Режим B (warning + active button).
- Backend writer'ы не блокируют создание по причине несовпадения `payment_type` с recurring-flag offer'а.
- `generateRenewalCTAs` возвращает 2 валидные ссылки для любого тарифа с активным pay_now offer.
- Кейс Марины Колейчик: новая ссылка с «Разовый» → `payment_links.payment_type='one_time'`, ведёт на разовый платёж.
- Кейс Елены: обе ссылки (one_time + subscription) корректны, доходят до bePaid без подмены типа.
- Дедуп-SQL 7 и 8 → 0 строк.
- Legacy `orders` не участвует в рабочем checkout path; все writer'ы пишут в `orders_v2`.

## Порядок execute

1. Зафиксировать canonical owner map (таблица entrypoints) и grep-checklist в отчёте — **до** правок.
2. Backend: убрать ошибочный recurring-guard из `admin-create-public-link` и `admin-create-payment-link`, добавить корректную валидацию product/tariff/offer/amount + audit.
3. UI: `AdminPaymentLinkDialog` — Режим A/B, `effectivePaymentType` = выбор админа, warning Alert вместо block.
4. Reminders: `generateRenewalCTAs` — 2 ссылки гарантированно, дедуп по ключу.
5. Operational: пересоздать ссылку для Марины Колейчик, сгенерировать 2 ссылки для Елены.
6. Verify по матрице 1–12 + before/after SQL дедупов.
7. Финальный отчёт: before/after summary, grep-table, entrypoints-table, кейсы Марины и Елены.