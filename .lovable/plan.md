# да, согласен, с учетом правок:

## **1. Часть A — можно выполнить отдельно и сразу**

Часть A корректная. Это только правка `.lovable/plan.md`.

Обязательный заголовок:

```txt
Отчет о выполненной работе: закрытие runtime-проверок Ресурс Развития без поддержки
```

`rr-test-simulate-webhook` оставить только как **admin debug tool**, не production-flow.

---

## **2. Часть B нельзя делать одним большим спринтом вместе с ручными платежами**

План слишком широкий. Нужно разделить:

```txt
B1–B4: Product wiring РР
B5–B6: Ручные платежи / manual payments
```

Ручные платежи — это отдельный глобальный payment epic, не часть первичного wiring РР. Иначе есть риск сломать `payments_v2`, `orders_v2`, выдачу доступов и статистику.

---



## **3. Production webhook не должен называться**

`rr-notification`

Сейчас `rr-notification` уже используется как test-only endpoint.

Для production создать отдельную функцию:

```txt
rr-webhook
```

А `rr-notification` / `rr-test-*` оставить только для test/debug.  
Нельзя смешивать test-ledger и production webhook в одном endpoint.

---



## **4. Нельзя напрямую ставить**

`orders_v2.status='paid'`

В плане написано:

```txt
orders_v2.status='paid'
```

Это риск. Нужно через существующий payment/order service и domain event.

Правильно:

```txt
rr-webhook
→ provider_events
→ PaymentService / OrderService
→ payment_succeeded domain event
→ existing access-grant pipeline
→ entitlements / access / CRM / notifications
```

Webhook не должен сам раздавать доступы и напрямую менять домены.

---





## **5.**

`installment-initiate` **должен быть thin edge function**

Добавить строго:

```txt
installment-initiate не содержит бизнес-логики.
Он только валидирует вход, вызывает сервис/adapter и пишет event.
Вся логика создания order/payment/provider_event должна быть в service layer.
```

---

## **6. Сначала Discovery текущих кнопок продукта**

Перед B1 нужно добавить обязательный discovery:

```txt
Найти фактические таблицы/компоненты кнопок продукта:
- где хранится тип кнопки;
- где хранится цена;
- где валюта;
- где настройки CRM-воронки;
- как сейчас работает кнопка "Рассрочка";
- где реализован "Оставить заявку на рассрочку";
- какие enum/check уже есть.
```

Без этого нельзя безопасно добавлять `installment_provider`.

---

## **7. Не скрывать старую кнопку сразу**

Пункт:

```txt
Убрать/скрыть старую кнопку «Оставить заявку на рассрочку»
```

перенести в отдельный cleanup после proof.

Правильно:

```txt
Старую кнопку не удалять и не скрывать в первом wiring sprint.
Сначала добавить новый путь add-only.
После runtime proof сделать отдельный migration/cleanup plan.
```

---

## **8. Валюта и сумма должны идти из кнопки/тарифа**

Зафиксировать:

```txt
amount_minor и currency берутся из настройки продукта/тарифа/кнопки.
Никаких hardcoded 1000 BYN или 9900 RUB в production-flow.
```

Для v1 можно ограничить РР только BYN, если это бизнес-решение, но это должно быть настройкой/guard-ом, а не хардкодом в adapter.

---





## **9.**

`commission_policy` **пока не внедрять в первый sprint**

`commission_policy` — сложная бизнес-логика. В v1 лучше:

```txt
Комиссия РР записывается как provider_fee/commission из webhook/getOrderStatus.
Цена клиента не пересчитывается.
commission_policy не влияет на amount_minor в v1.
```

Если нужен `include_in_price/on_top/absorb`, это отдельный финансовый план.

---

## **10. Manual payments вынести в отдельный план**

B5–B6 убрать из текущего плана и оформить позже как:

```txt
План: ручные платежи и ручное проведение оплат от юрлиц
```

Там отдельно проверить:

- provider enum;
- `is_manual`;
- audit logs;
- attachments storage;
- idempotency по UID платежки;
- кто имеет право создавать ручной платеж;
- как не создать двойной доступ;
- как отменять/исправлять ручной платеж.

---

## **11. Runtime proof не делать на “живой копеечной заявке”, если РР имеет минимальный порог**

Фразу:

```txt
1 живой заказ РР на минимальную сумму
```

заменить на:

```txt
1 test/prod-safe заказ РР на минимально допустимую сумму по РР и согласованному продукту.
Боевой тест — только после отдельного разрешения пользователя.
```

---

## **12. Исправленный следующий порядок**

```txt
Sprint 0: правка отчета .lovable/plan.md.

Sprint 1: discovery текущих product buttons / installment flow.

Sprint 2: add-only поля для кнопки "Рассрочка банка" + UI редактора, без public flow.

Sprint 3: installment-initiate → createOrder → redirect на РР, без выдачи доступов.

Sprint 4: rr-webhook production → provider_events → Payment/Order service → existing access pipeline.

Sprint 5: admin payments UI: бейдж/фильтр provider rr/комиссия.

Отдельный эпик: manual payments.
```

## **Итог**

Часть A — выполнять.  
Часть B — выполнять только после разбиения и правок выше.  
Ручные платежи из этого плана убрать в отдельный спринт.

&nbsp;

План: правка отчета + wiring РР к продуктам и ручные платежи

## Часть A. Правка отчета `.lovable/plan.md` (только оформление)

1. Заменить заголовок раздела на: **«Отчет о выполненной работе: закрытие runtime-проверок Ресурс Развития без поддержки»**.
2. В блоке про `rr-test-simulate-webhook` явно прописать guard-контур:
  - admin/superadmin only (через `has_role`);
  - test mode only (`mode='test'`);
  - принимает только `external_id LIKE 'rr_test_%'`;
  - production-flow не использует эту функцию ни при каких условиях;
  - секреты (RR merchant key, MD5 salt) не возвращаются в ответе и не логируются;
  - боевые таблицы (`payments_v2`, `orders_v2`, `provider_events`, `domain_events`, `entitlements`, `subscriptions_v2`, `access_grant_ledger`) не затрагиваются — запись только в `rr_test_ledger` + `integration_sync_logs`.
3. Код `rr-test-simulate-webhook/index.ts` не трогаем — правка только текстовая в отчете.

DoD части A: заголовок обновлен, шесть guard-пунктов добавлены дословно, никаких изменений в коде edge functions.

---

## Часть B. Полный план wiring РР к продуктам (следующий этап)

### B0. Границы

Ничего из существующего не переименовываем и не удаляем до Definition of Done. Стартовая точка — продукт «Ценный бухгалтер. 1 ступень», кнопка типа **Рассрочка**.

### B1. Модель данных кнопки

1. В таблице кнопок продукта (та, которая рендерит модалку «Редактировать кнопку» → «Тип кнопки»):
  - переименовать в UI пункт `Рассрочка` → **«Рассрочка банка»** (значение enum в БД оставить `installment`, чтобы не ломать существующие записи; поменять только `label`).
  - добавить в схему кнопки поля:
    - `installment_provider` (`rr` | `bepaid` | `null`) — по умолчанию `rr` для новых кнопок «Рассрочка банка»;
    - `rr_product_code` (optional, справочник товара в РР, если РР требует);
    - `commission_policy` (`include_in_price` | `on_top` | `absorb`) — как считать комиссию РР относительно цены кнопки;
    - `crm_funnel_id`, `stage_new`, `stage_success`, `stage_failed` — переиспользовать уже существующие поля секции «Дополнительно» (не плодить дубли).
2. Убрать/скрыть старую кнопку **«Оставить заявку на рассрочку»** после миграции: она становится частным случаем «Рассрочка банка» с `installment_provider='rr'`.

### B2. Публичный поток (клиент нажал «Рассрочка банка»)

Единая edge function `installment-initiate` (новая, тонкая; НЕ трогает существующие `payment-*`):

1. Вход: `button_id`, `product_id`, `tariff_id`, `contact` (email/phone/имя).
2. Проверка/создание аккаунта: если пользователь не залогинен — переиспользовать существующий passwordless/registration flow (тот же, что для эквайринга), НЕ дублировать.
3. Создание `orders_v2` со статусом `pending_installment` и `provider='rr'`, `amount_minor = button.price_minor`, `currency='BYN'`.
4. Вызов shared `createOrder` из `_shared/rr/rr-adapter.ts` (уже готов): получить `payment_url`.
5. Записать в `provider_events`: `rr.create_order.requested/succeeded`.
6. Переместить сделку CRM в `stage_new` из настроек кнопки.
7. Ответ клиенту: `{ payment_url }` → редирект на анкету РР.

### B3. Webhook production `rr-notification` (новая функция, боевая)

Отдельная от `rr-test-*`. Идентичный контур проверок:

1. Проверка MD5-подписи (shared `verifySignature`).
2. Идемпотентность: unique `(provider='rr', external_event_id)` в `provider_events`.
3. Маппинг статусов (shared `mapStatus`):
  - `authorized` / `authorized_all` → `orders_v2.status='paid'`;
  - `authorized_partially` → `pending` (доступы не выдаем);
  - `rejected` → `failed` → CRM `stage_failed`;
  - прочие — no-op с логом.
4. При `paid`:
  - создать `payments_v2` запись (`provider='rr'`, `amount_minor`, `commission_minor` из webhook, `net_minor = amount - commission`, `payment_method='installment_rr'`);
  - вызвать существующий shared access-grant pipeline (тот же, что для bepaid) — доступы, сделка, entitlements, письма;
  - CRM в `stage_success`.
5. При `failed` — только CRM `stage_failed` + `domain_events`.

**Никаких новых access-путей**: используем существующий `grant_access_after_payment` (или как он называется в проекте) — иначе получим второй источник правды.

### B4. Отражение в разделе «Платежи» (`/admin/payments`)

1. Провайдер `rr` уже поддержан списком (см. фильтры «bePaid без сделки» — добавить аналогичный чип «РР»). Никаких новых таблиц.
2. Иконка/бейдж провайдера `rr` в колонке «Пр.» (компонент бейджа уже есть — расширить mapping).
3. Комиссия: колонка «Комиссия» уже считает из `payments_v2.commission_minor` — работает автоматически.

### B5. Ручное проведение платежа «от юрлица» (счет на РС)

Отдельная кнопка **«+ Добавить платеж вручную»** на `/admin/payments`:

1. Модалка `ManualPaymentDialog` с полями:
  - Дата платежа, UID (номер платежки), Провайдер (`bank_transfer` | `rr_manual` | `cash`), Тип (`Оплата`/`Возврат`), Статус (`Успешно`/`В обработке`), Сумма, Валюта, Плательщик (юрлицо — свободный текст + УНП/ИНН), Контакт (autocomplete из `contacts`), Продукт+Кнопка (autocomplete → подтянет цену и комиссию), Комментарий, прикрепление файла (скан платежки).
2. При сабмите:
  - создать `payments_v2` с `provider='manual_bank'` (новый enum value) или `provider='rr'` + `payment_method='manual'` для ручной проводки рассрочки;
  - создать `orders_v2` если не выбран существующий;
  - переиспользовать тот же access-grant pipeline из B3 → доступы, сделка, entitlements, письма — единая точка;
  - отметка `is_manual=true` на `payments_v2` для аудита.
3. Обратный сценарий «привязать к существующей сделке» — уже есть в проекте (быстрый чип «Без сделки»), переиспользуем.

### B6. Ручная проводка пришедшего платежа РР из выписки

Тот же `ManualPaymentDialog`, но пресет: `provider='rr'`, `payment_method='installment_rr_manual'`. Комиссию вводим руками (поле «Комиссия, BYN»). Дальше — тот же pipeline B3.

### B7. Порядок реализации

1. **Sprint 1 (миграция + UI кнопки)**: rename label «Рассрочка» → «Рассрочка банка», добавить поля `installment_provider`, `commission_policy` в схему кнопки; UI редактора; RLS; grants.
2. **Sprint 2 (public flow)**: `installment-initiate` edge function; интеграция с существующим registration/login; e2e: клик → `payment_url` → редирект.
3. **Sprint 3 (production webhook)**: `rr-notification` production; переиспользование access-grant pipeline; runtime proof с одной живой копеечной заявкой.
4. **Sprint 4 (админка платежей)**: бейдж провайдера, фильтр РР, колонка комиссии — проверка.
5. **Sprint 5 (ручные платежи)**: `ManualPaymentDialog` + provider `manual_bank` + пресет `rr_manual` + прикрепление файла.
6. **Sprint 6 (миграция старых кнопок)**: скрыть «Оставить заявку на рассрочку», перевести существующие записи в `installment_provider='rr'`.

### B8. Definition of Done (общий)

- Один источник правды для выдачи доступов (shared pipeline), никакой параллельной ветки для РР.
- `provider_events` пишется на каждый шаг (`requested/succeeded/failed`).
- Идемпотентность webhook и manual-платежа (unique по `(provider, external_id)` и `(provider, uid, date)` соответственно).
- Нет hardcoded комиссий — только из webhook или из ручного ввода.
- Нет новых RLS-дыр: все новые таблицы/колонки — с политикой + grants в той же миграции.
- Runtime proof: 1 живой заказ РР на минимальную сумму + 1 ручной платеж «от юрлица» доведены до `paid` с выданными доступами и созданной сделкой CRM.

### B9. Явно НЕ входит в этот план

- Автоматическое сопоставление банковской выписки (OCR / API банка) — отдельный эпик.
- Возвраты по РР — отдельный план (нужен отдельный webhook-путь и UI).
- Поддержка мульти-валют для РР — сейчас только BYN.

---

# Отчет о выполненной работе: закрытие runtime-проверок Ресурс Развития без поддержки

Все runtime-проверки интеграции РР закрыты самостоятельно, без обращения в поддержку. Работа велась только в изолированном контуре (`rr_test_ledger`, `integration_sync_logs`, edge functions `rr-test-*`). Боевые таблицы (`payments_v2`, `orders_v2`, `provider_events`, `domain_events`, `entitlements`, `subscriptions_v2`, `access_grant_ledger`), `PublicPayPage`, `OfferAcquiringSettings`, продукты, тарифы и статистика — не затронуты.

## Закрытые пункты

1. **createOrder** — работает, `payment_url` возвращается корректно.
2. **BYN** — подтверждено.
3. **Реальные webhook от РР** — проходят проверку MD5-подписи и корректно применяются.
4. **Статусы и комиссия** — подтверждены на всех 4 сценариях:
   - `authorized` / `authorized_all` → `paid` (комиссия 9%).
   - `authorized_partially` → `pending` (доступы не выдаются; РР сам `authorized_all` не досылает — правило v1 зафиксировано).
   - `rejected` → `failed`.
   - «Ошибка оплаты» — runtime behavior test-mode (webhook не приходит, `status_raw` остаётся `new`); не блокер, сценарий `failed` покрыт кнопкой «Отклонить рассрочку».
5. **Идемпотентность webhook** — повторная отправка того же payload возвращает `HTTP 200` с маркером `duplicate:true`, `rr_test_ledger` не меняется.
6. **Bad signature** — запрос с повреждённой MD5 отклоняется `HTTP 401 { error: "invalid_signature" }`; секрет остаётся на backend.
7. **Повторный `createOrder` с тем же `external_id`** — РР возвращает 400 «id заказа должен быть уникальным». **Retry policy v1**: на дубликат не ретраить, читать `getOrderStatus`.
8. **Snapshot before/after**: 0 новых/изменённых строк в `payments_v2`, `orders_v2`, `provider_events`, `domain_events`, `entitlements`, `subscriptions_v2`, `access_grant_ledger`. В `rr_test_ledger` +1 тест-заявка.

## Guard-контур `rr-test-simulate-webhook` (admin debug tool)

Функция создана исключительно как runtime-инструмент для admin-тестов и **не участвует в production-flow**. Явные ограничения:

- **admin/superadmin only** — доступ через `has_role(auth.uid(), 'admin' | 'superadmin')`; любой другой вызывающий получает 403.
- **test mode only** — принимает запросы только при `mode='test'`.
- **только `rr_test_` external_id** — payload с `external_id`, не начинающимся на `rr_test_`, отклоняется без записи.
- **production-flow не использует** эту функцию ни при каких условиях — production webhook пойдёт через отдельный endpoint (`rr-webhook`, план Part B, Sprint 4).
- **секреты не возвращаются** — RR merchant key и MD5 salt остаются на backend; в ответе и в логах — только computed hash / redacted proof.
- **боевые таблицы не трогает** — запись только в `rr_test_ledger` + `integration_sync_logs`; `payments_v2`, `orders_v2`, `provider_events`, `domain_events`, `entitlements`, `subscriptions_v2`, `access_grant_ledger` не затрагиваются.

## Изменённые файлы

- `supabase/functions/_shared/rr/rr-adapter.ts` — фиксировка `blueimp-md5`, shared `createOrder` / `verifySignature` / `mapStatus`.
- `supabase/functions/rr-test-create-order/index.ts` — admin-only `external_id_override` + дедуп ledger.
- `supabase/functions/rr-test-simulate-webhook/index.ts` — admin-only debug tool с guard-контуром выше.
- `.lovable/plan.md` — данный отчёт.

## Итог

Письмо в поддержку РР не отправляется. Все технические вопросы закрыты runtime-путём.
