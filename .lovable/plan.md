## да, согласен, с учетом правок:

&nbsp;

1. В Phase 4 убери жёсткую формулировку
  **«успешный rebill → создать новую сделку сразу в stage_on_success»**
  и замени на более правильную:
  **успешный rebill создаёт новую сделку в той стадии, которая указана в routing для success у выбранного offer**.
  Не надо заранее предполагать, что это всегда closed/stage успеха, потому что по новой логике пользователь может выбрать любую стадию.
2. Аналогично в Phase 5 не надо жёстко зашивать, что failed renewal должен идти в какую-то отдельную специальную open-стадию через stage_on_pending.
  Правильнее так:
  &nbsp;
  - при failed renewal используется **routing failed-stage выбранного offer**;
  - если уже есть **открытая** renewal-problem сделка по этому subscription-chain, обновляется она;
  - если нет — создаётся новая сделка в **stage_on_failed**;
  - а уже сама stage_on_failed может быть open или closed — это решает настройка routing.
  &nbsp;
3. Прямо зафиксируй важный инвариант:
  &nbsp;
  - **routing управляет стадиями и для success, и для failed, и для pending;**
  - система не должна поверх routing придумывать свои специальные стадии, кроме случаев, когда это явно выделено как отдельная бизнес-настройка.
  &nbsp;
4. В Phase 5 уточни критерий renewal-problem:
  &nbsp;
  - renewal-problem — это не просто “любой failed по подписке”, а **сделка, созданная/обновляемая автоматикой именно для цепочки неуспешных списаний одной подписки**;
  - это нужно явно обозначить в [meta.deal](http://meta.deal)_kind и [meta.deal](http://meta.deal)_source, чтобы потом не было смешения с первичными оплатами и разовыми ссылками.
  &nbsp;
5. В discovery обязательно добавь отдельный блок:
  &nbsp;
  - **откуда брать offer_id для recurring/rebill**;
  - проверить, есть ли он гарантированно в subscriptions_v2,
  - или его нужно наследовать из исходного orders_v2,
  - или есть ещё один промежуточный источник истины.
    Без этого recurring-routing нельзя делать надёжно.
  &nbsp;
6. Добавь STOP-guard:
  &nbsp;
  - если для части recurring-платежей нельзя гарантированно восстановить offer_id, product_id, tariff_id и subscription-chain, то recurring-routing не внедрять “частично на глаз”, а сначала сделать отдельный add-only patch на нормализацию источника этих связей.
  &nbsp;
7. В Phase 2 по payment link dialog зафиксируй ещё одно правило:
  &nbsp;
  - выбранный **offer** становится главным источником:
    &nbsp;
    - CRM routing,
    - offer snapshot,
    - offer title,
    - базовой суммы по умолчанию;
    &nbsp;
  - а radio разовая / подписка остаётся пользовательским фильтром списка offer, но не вторым источником routing.
  &nbsp;
8. Добавь явное правило для override суммы:
  &nbsp;
  - override суммы не должен ломать связку с выбранным offer;
  - сделка и snapshot должны помнить, **какой offer выбран**, даже если amount изменён вручную;
  - это особенно важно для webhook и audit.
  &nbsp;
9. В Phase 4/5 добавь важное правило по закрытым стадиям ещё раз уже в recurring-части:
  &nbsp;
  - если по этой же подписке уже есть сделка в Успешно или Отказ, она не может быть кандидатом ни на update, ни на recovery, ни на reuse;
  - система ищет кандидата только среди open-сделок.
  &nbsp;
10. В DoD добавь два отдельных теста:

&nbsp;

&nbsp;

&nbsp;

- **успешный recurring payment** по подписке с уже существующей закрытой успешной сделкой создаёт новую сделку;
- **failed recurring payment** при наличии уже закрытой failed-сделки тоже создаёт новую, а не трогает старую.

&nbsp;

&nbsp;

&nbsp;

11. Добавь audit-проверки для recurring:

&nbsp;

&nbsp;

&nbsp;

- создание новой сделки по rebill;
- update открытой renewal-problem сделки;
- skip из-за closed immutable;
- skip из-за missing recurring linkage / missing offer_id, если такое встретится.

&nbsp;

&nbsp;

&nbsp;

12. В блок “Что не делаю” уточни:

&nbsp;

&nbsp;

&nbsp;

- не делаю скрытую специальную логику стадий поверх routing;
- не переиспользую closed сделки;
- не внедряю recurring-routing, пока discovery не докажет стабильный источник offer_id и subscription-chain.

&nbsp;

&nbsp;

&nbsp;

13. В самое начало плана лучше зафиксировать итоговую формулу уже в окончательном виде:

&nbsp;

&nbsp;

**Каждый новый платёж создаёт новую сделку.**

**Повторный failed по той же подписке может обновлять только открытую renewal-problem сделку.**

**Closed сделки автоматикой не изменяются и не переиспользуются.**

**Конечная стадия всегда определяется routing выбранного offer.**

&nbsp;

В остальном план уже собран правильно.

&nbsp;

План: CRM routing v2 — закрытые сделки immutable, каждая оплата = новая сделка, UI на русском

### Ключевая формула (в самом начале)

1. **Каждый новый платёж = новая сделка.** Разовая оплата, первая подписочная, N-ая подписочная, оплата по ссылке — все создают отдельную сделку в стадии согласно routing кнопки/offer.
2. **Повторный неуспех по той же подписке** — единственное исключение: может обновить уже существующую **открытую** renewal-problem сделку.
3. **Закрытая сделка автоматикой не изменяется и не переиспользуется** — ни по stage, ни по reuse. Closed_won и closed_lost — исторический факт.

### Инвариант closed deal immutable by automation

Автоматизация НЕ имеет права:

- менять `pipeline_stage_id` у сделки в `closed_won` / `closed_lost`;
- дописывать новый платёж в закрытую сделку как основание для смены бизнес-смысла;
- использовать закрытую сделку как renewal-case;
- привязывать к закрытой сделке новую первичную оплату или отдельный платёж.

Единственное исключение — ручное действие администратора в Kanban/карточке.

### Правило UI: только русский язык

Все надписи, статусы, labels, tooltips, helper-тексты, ошибки, названия секций и кнопок — **только русский**. Касается: CRM routing UI, payment link dialog, карточка сделки, renewal/recovery блоки, бейджи типа сделки, история платежей, системные уведомления.

---

### Phase 0 — Discovery (обязательный, до любых миграций)

Собрать и приложить отчётом таблицу по зонам:


| Зона               | Что фиксируем                                                                           |
| ------------------ | --------------------------------------------------------------------------------------- |
| `orders_v2`        | все поля, связь с offer/subscription/pipeline, как сейчас пишется `pipeline_stage_id`   |
| `payments_v2`      | типы платежей, reference chains, rebill markers                                         |
| `subscriptions_v2` | lifecycle, provider_subscription_id, связь с orders_v2                                  |
| `tariff_offers`    | `meta.crm_routing`, `payment_method`, `offer_type`                                      |
| `payment_links`    | есть `offer_id` (уже подтверждено — да), `payment_type`, `product_id`, `tariff_id`      |
| edge-функции       | **все** места `insert/update orders_v2.pipeline_*` — исключить параллельные write-paths |
| webhook ветки      | success/failed/canceled + rebill + renewal + recovery                                   |
| audit_logs         | существующие `action` по CRM/routing — не плодить дубли                                 |
| ручные инструменты | admin-link-payment-to-order, ручное создание сделки в Kanban                            |


**STOP-guard 1**: если discovery покажет существующую логику матчинга recurring/renewal — описать mapping «переиспользуем / не трогаем». Запрет параллельной логики.
**STOP-guard 2**: если один платёж может создать сделку в >1 ветке — сначала устранить дублирование materialize-точки.

**Ожидаемый вывод discovery (уже видно из предварительного анализа):**

- `payment_links.offer_id` уже существует, но диалог его не заполняет.
- `payment_flow` enum: `renewal_one_time`, `renewal_subscription`, `admin_subscription`, `admin_one_time`, `provider_managed_checkout`, `bepaid_subscription_renewal`, `bepaid_subscription_charge`, `bepaid_link_payment`, `bepaid_one_time_payment`, `mit_tokenization`. Это SoT для классификации типа сделки.
- Нет существующего «renewal-problem deal matching» — греенфилд.

---

### Phase 1 — CRM Routing UI (OfferCrmRoutingSection)

1. **Снять хардкод семантики стадий** — все три селекта показывают **все** стадии воронки. Менеджер сам решает маппинг.
2. **Убрать серверную валидацию** `stage_on_*_not_closed_*` в `_shared/crm-routing.ts` (строки 113–115). Оставить только: все 3 стадии принадлежат выбранной воронке + различны + валидные UUID.
3. **Убрать вывод `ID: uuid**` под селектами.
4. **Дизайн**: убрать `bg-muted/30 border` у блока, привести к белому фону карточки оффера с тонким divider сверху.
5. **Live-обновление**: realtime-подписка на `crm_pipeline_stages` и `crm_pipelines` в хуках `usePipelineStages` / `usePipelines` + invalidateQueries. Миграция: `ALTER PUBLICATION supabase_realtime ADD TABLE ...` + `REPLICA IDENTITY FULL` (проверить, не добавлено ли).
6. **Все тексты — по-русски** (уже так, но проверить).

---

### Phase 2 — AdminPaymentLinkDialog: offer-first с сохранением радио

**Радио «Разовая / Подписка» остаётся** — это управляемый бизнес-переключатель.

Новый flow диалога:

1. Выбор Продукт.
2. Выбор Тариф.
3. **Радио «Тип оплаты»** (Разовая / Подписка) — остаётся.
4. **Новый селект «Кнопка оплаты»** — показывает `tariff_offers` этого тарифа, **отфильтрованные по выбранному типу оплаты**. По умолчанию автоматически подставляется основная (`is_primary=true`) кнопка нужного типа.
5. Сумма — предзаполняется из `offer.amount`, остаётся редактируемой.
6. При сохранении в `payment_links` пишется `offer_id` выбранной кнопки.

**Разрешение конфликта radio ↔ offer (предпочтительный вариант):**

- radio **фильтрует** список доступных offer (показываются только `payment_method=one_time` для Разовой и `payment_method=subscription` для Подписки);
- поэтому конфликт невозможен on-save: выбранный offer всегда совпадает с radio;
- если в тарифе нет offer нужного типа — показывается understandable ошибка на русском: «В тарифе нет кнопки для выбранного типа оплаты».

**Override суммы** — меняет только amount конкретного `payment_links`/заказа; не меняет routing snapshot, не меняет offer_id, не меняет тип оплаты.

**Тексты** — все на русском.

---

### Phase 3 — Публичный checkout `/pay/:token` → routing snapshot

В `public-checkout` / `_shared/create-payment-checkout.ts`:

- при создании `orders_v2` из `payment_links.offer_id` — вызвать `resolveOfferRouting(offer_id)`, сохранить `crm_routing_snapshot` в `orders_v2.meta`, проставить `pipeline_id` + `pipeline_stage_id = stage_on_pending`.
- Layer A webhook логика (success/failed) уже работает по snapshot — ничего не меняется.

---

### Phase 4 — Recurring: каждый успешный платёж = новая сделка

**Принципиальное изменение модели.**

В `bepaid-webhook` для веток `bepaid_subscription_renewal` / `bepaid_subscription_charge`:

1. **Успешный rebill** → не апдейтить старую сделку, а **создать новую** `orders_v2` с:
  - `offer_id` = унаследован от родительской подписки (через `subscriptions_v2.offer_id` или исходного order);
  - `crm_routing_snapshot` = resolve по этому offer_id;
  - `pipeline_id` + `pipeline_stage_id = stage_on_success` **сразу** (без pending), потому что платёж уже успешен;
  - `meta.deal_source = 'Продление подписки'`.
2. **Failed rebill** → отдельная логика renewal-problem (Phase 5).

Это приводит модель в соответствие с формулой «каждый новый платёж = новая сделка».

---

### Phase 5 — Renewal-problem и recovery

**Failed rebill:**

1. Искать **открытую** renewal-problem сделку среди `orders_v2` по ключу:
  - `user_id` (или contact) + `product_id` + `tariff_id` + `meta.subscription_id = provider_subscription_id` + `meta.deal_kind = 'renewal_problem'`
  - **жёсткий фильтр**: `pipeline_stage_id IN (SELECT id FROM crm_pipeline_stages WHERE stage_type = 'open')` — closed исключаются на уровне query.
2. Если найдена — обновить её (новая попытка добавлена в историю платежей, стадия остаётся открытой или переводится на подстадию open).
3. Если не найдена — создать новую сделку `meta.deal_kind='renewal_problem'` в `stage_on_failed`? **Нет** — в специальной open-стадии для проблем. Решение: использовать `stage_on_pending` routing-а + пометить `meta.deal_kind='renewal_problem'`. (Уточнить в Phase 0 discovery: нужна ли отдельная «Проблема автосписания» стадия в pipeline.)

**Recovery (успех после failed):**

1. Искать открытую renewal-problem сделку (тот же ключ + только open стадии).
2. Если найдена — перевести её в `stage_on_success`, записать recovery-платёж.
3. Если найдена, но **закрыта** — reuse запрещён, создать новую сделку типа «Продление подписки» в success.
4. Closed renewal case никогда не переоткрывается автоматически.

---

### Phase 6 — Метка типа сделки (русский)

В `orders_v2.meta.deal_source` (строка, отображается в UI):

- `Первичная оплата` — `admin_one_time`, `renewal_one_time` (guest/site checkout первый раз)
- `Продление подписки` — successful rebill
- `Проблема автосписания` — failed rebill
- `Ссылка на оплату` — создано из `payment_links` (админом)
- `Публичная ссылка` — `/pay/:token` guest
- `Форма сайта` — site-form-submit (вне scope Layer A, но метка нужна)

В карточке сделки и истории платежей — показывать эту метку как бейдж.

---

### Phase 7 — Guard: запрет автоматического изменения закрытых сделок

В коде везде, где автоматика делает `update orders_v2 set pipeline_stage_id`:

1. Pre-check: `SELECT stage_type FROM crm_pipeline_stages WHERE id = current.pipeline_stage_id`.
2. Если `stage_type IN ('closed_won','closed_lost')` → **skip + audit** `crm_stage_apply_skipped_closed_deal_immutable`.
3. Применить в helper `applyCrmStageOnTerminal` (дополнить) + везде в webhook, где возможен update.

На уровне БД — **не** добавлять CHECK-триггер (раз есть исключение «ручное»), но audit обязателен.

---

### Definition of Done

Обязательные кейсы в proof:

1. Закрытая `closed_won` сделка не переиспользуется при следующем платеже — создаётся новая.
2. Закрытая `closed_lost` сделка не переиспользуется при следующем платеже — создаётся новая.
3. Recovery допускается только в открытой renewal-problem сделке.
4. Похожая сделка закрыта → новая создаётся.
5. Первый успешный rebill по подписке → новая сделка в success.
6. Второй успешный rebill → ещё одна новая сделка в success.
7. Повторный failed renewal при наличии открытой renewal-problem → обновление, не дубль.
8. Recovery-success при открытой renewal-problem → переводит её в success.
9. Recovery-success при закрытой старой сделке → создаёт новую.
10. Payment link с `offer_id` → snapshot и stage routing работают.
11. Radio Разовая/Подписка сохранено, offer-список фильтруется, конфликт невозможен.
12. Все UI-надписи на русском.
13. Realtime обновление стадий в routing UI работает без перезагрузки.
14. Все 3 стадии в routing UI выбираются из полного списка воронки.
15. ID стадий в UI не показываются.

### Что НЕ делаю

- Не разрешаю автоматике менять закрытые сделки (hard guard + audit).
- Не убираю радио Разовая/Подписка.
- Не допускаю неявного конфликта radio↔offer — фильтрация offer по radio устраняет его явно.
- Не делаю новую параллельную логику materialize рядом со старой (discovery обязателен).
- Не ввожу параллельный SOT для recurring-chain — использую `subscriptions_v2` + `provider_subscription_id` + `offer_id`.
- Не ломаю существующие уведомления/recovery jobs.

### Статус после выполнения плана

Только: «код внесён; Layer A + v2 (recurring new-deal-per-payment, closed immutable) реализованы; proof-пакет в работе». Не «завершено» до live-proof.