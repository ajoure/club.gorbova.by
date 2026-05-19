да, согласен, с учетом правок:

1. **Не считать channel-fix достаточным для B-97.**  
Исправление `admin_test → card` закрывает только автоподтягивание сценария кнопки. Пустые FLD-реквизиты B-97 нужно проверять отдельным proof в том же full-flow, но не смешивать root cause:
  - root cause №1: `payment_channel=other` → scenario не матчится;
  - root cause №2: если после scenario-match реквизиты всё ещё пустые → проблема B-97 resolver / FLD lookup / SOT.
2. **Уточнить правило для** `admin_test` **строго ограниченно.**  
Не писать просто `provider='admin_test' → card`. Нужно так:
  &nbsp;
  ```ts
  if (
    (provider === 'admin_test' || provider === 'admin_test_direct') &&
    (meta.test_payment === true || meta.is_test === true || meta.source === 'test_payment') &&
    !explicitPaymentMethod
  ) {
    return 'card';
  }
  ```
  Если в `meta.payment_method` явно указан `erip`, `bank_transfer`, `apple_pay`, `google_pay` — он должен иметь приоритет.
3. **Добавить единый shared-helper для payment channel.**  
Чтобы снова не было расхождения UI/backend:
  - frontend mirror: `src/utils/derivePaymentChannel.ts`;
  - backend mirror: `_shared/.../payment-channel.ts`;
  - в обоих файлах комментарий: `Keep in sync with ...`.
4. **В** `test-payment-complete` **/** `test-payment-direct` **писать не только** `payment_method`**, но и явный marker.**
  &nbsp;
  ```json
  {
    "payment_method": "credit_card",
    "test_payment": true,
    "payment_channel": "card"
  }
  ```
  Это нужно, чтобы будущая диагностика не угадывала тип платежа по `provider`.
5. **Repair старой сделки** `ORD-TEST-MPCXYLNP` **— только после новой успешной сделки.**  
Сначала доказать fix на новой оплате. Потом, если нужно, отдельным блоком:
  - dry-run по одному `order_id`;
  - пересборка только `orders_v2.meta.document_data`;
  - без UPDATE `payments_v2`;
  - без ручной подстановки `template_id/executor_id`.
6. **В Verify добавить SQL-proof по новой оплате.**
  &nbsp;
  Обязательно показать:
  ```sql
  SELECT order_number,
         offer_id,
         meta->>'offer_id' AS meta_offer_id,
         meta->'document_data'->'_provenance'->'scenario' AS scenario,
         meta->'document_data'->'_provenance'->'template_resolution' AS template_resolution,
         meta->'document_data'->'_provenance'->'executor_resolution' AS executor_resolution
  FROM orders_v2
  WHERE order_number = '<new_order>';
  ```
  Ожидание:
  - `scenario.source = scenario`;
  - `payment_channel = card`;
  - `template_resolution.source = scenario`;
  - `executor_resolution.source = scenario`.
7. **В UI-proof добавить отрицательное подтверждение.**  
В новой сделке не должно быть:
  - `Источник не задан`;
  - `Автоматически (не задан в кнопке)`;
  - `не выбран шаблон`;
  - `не выбран исполнитель`.
8. **В PDF-proof добавить проверку именно FLD из твоего шаблона.**  
Не общая фраза «B-97 не пустые», а таблица:
9. **Если после channel-fix PDF всё ещё пустой — не закрывать задачу.**  
Тогда сразу фиксировать второй root cause: `B-97 resolver/FLD lookup`, без отчёта «всё хорошо».
10. **Финальный отчёт должен прямо признать прошлую ошибку.**  
В отчёте добавить раздел:

```text
Почему прошлый отчёт был неполным:
- UI fix по offer_id был проверен не на том полном сценарии / не покрыл admin_test payment_channel.
- PDF proof показал, что scenario-match и FLD-resolution — разные уровни.
- Теперь проверен полный путь: payment → order → scenario → snapshot → document → PDF.
```

С этими правками план можно запускать.

&nbsp;

План:

1. **Проблема**
  - В новой тестовой сделке `ORD-TEST-MPCXYLNP` карточка «Документы / плательщик» не подставляет шаблон из кнопки автоматически.
  - По данным заказа оффер найден: `offer_id = 6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e` лежит в `orders_v2.meta.offer_id`.
  - В кнопке есть сценарий для `payer_type=individual` и каналов `[card, erip, apple_pay, google_pay]` с шаблоном `21594005-ebdf-4d0f-8091-d00049f31e8c` и исполнителем `d0c7fe75-1192-40a9-bbae-b652b69e6882`.
  - Но тестовая оплата создаёт запись `payments_v2` как `provider='admin_test'` без `meta.payment_method`; текущий `derivePaymentChannel` классифицирует это как `other`.
  - Из-за `payment_channel=other` сценарий кнопки не матчится, snapshot пишет `source=defaults`, `template_id=null`, а UI показывает «Автоматически (не задан в кнопке)».
2. **Диагностика**
  - `orders_v2.offer_id` у тестовых заказов `NULL`, но `orders_v2.meta.offer_id` заполнен — frontend уже читает fallback, backend snapshot тоже читает fallback.
  - Root cause не в `offer_id`, а в канале оплаты тестовой симуляции.
  - Реальная кнопка настроена корректно: сценарий ФЛ существует и указывает на активный шаблон `Шаблон. Счёт-акт на услуги ФЛ - Исполнитель`.
  - `document_data.snapshot_created` для `ORD-TEST-MPCXYLNP` зафиксировал `payment_channel: other`, `scenario.source: defaults`, `template_resolution.source: none`.
3. **Предлагаемое решение**
  - Исправить классификацию тестовой оплаты как карточной, чтобы симуляция совпадала с реальным card-checkout flow:
    - backend `derivePaymentChannel`: `provider='admin_test'` / `admin_test_direct` с `meta.test_payment=true` считать `card`, если нет явного `erip/bank_transfer/...`.
    - frontend `derivePaymentChannel`: тот же mirror-алгоритм, чтобы UI сразу показывал «Карта» и матч сценария кнопки.
  - Исправить запись новых тестовых платежей:
    - `test-payment-complete` должен писать в `payments_v2.meta.payment_method='credit_card'` для тестовой оплаты через сайт.
    - `test-payment-direct` — аналогично, если используется этим путём.
  - Для уже созданной проблемной сделки выполнить безопасный repair только `orders_v2.meta.document_data` после dry-run:
    - не трогать `payments_v2`;
    - не трогать `orders_v2` schema;
    - пересобрать только document snapshot / либо минимально обновить document_data template/scenario, если snapshot repair подтвердит ровно 1 целевой заказ.
4. **Изменяемые компоненты**
  - `src/utils/derivePaymentChannel.ts` — UI mirror.
  - `supabase/functions/_shared/document-resolver-v2/payment-channel.ts` — backend mirror для snapshot.
  - `supabase/functions/test-payment-complete/index.ts` — метаданные тестового платежа.
  - `supabase/functions/test-payment-direct/index.ts` — метаданные direct-тестового платежа.
  - Деплой edge functions после правки:
    - `test-payment-complete`
    - `test-payment-direct`
    - `canonical-document-payment-hook` (подхватывает shared backend resolver)
5. **Что не будет изменено**
  - `payments_v2` схема и существующие платежные записи — без UPDATE.
  - `orders_v2` схема — без изменений.
  - `allocate_document_number` — не трогать.
  - document scenarios в кнопке — не менять, они уже корректные.
  - Contact Center / CRM routing — не менять.
  - B-97 морфология и FLD registry — не менять.
  - Шаблоны документов — не менять.
6. **Dry-run**
  - SQL-проверка перед repair:
    - подтвердить, что целевой заказ один: `ORD-TEST-MPCXYLNP`;
    - подтвердить `meta.offer_id = 6f306cbc-...`;
    - подтвердить наличие active scenario для `individual + card`;
    - подтвердить active template `21594005-...`;
    - подтвердить executor `d0c7fe75-...` active.
  - Edge dry-run:
    - вызвать `canonical-document-payment-hook` / preview-путь только после правки и убедиться, что новый snapshot для новой сделки получает `scenario.source='scenario'`, `payment_channel='card'`, `template_id=21594005-...`.
7. **Execute**
  - Внести четыре точечные правки в код.
  - Задеплоить только затронутые edge functions.
  - Создать новую тестовую оплату на `7500084@gmail.com` по тарифу «Чат» через тот же UI/API путь.
  - Проверить новую сделку до генерации:
    - «Способ оплаты: Карта»;
    - «Шаблон документа: По сценарию кнопки · Шаблон. Счёт-акт на услуги ФЛ - Исполнитель»;
    - «Исполнитель: По сценарию кнопки · ЗАО "АЖУР ИНКАМ"»;
    - кнопка «Создать документ» активна.
  - Сгенерировать документ и проверить preview/generate response:
    - нет `template_not_found`;
    - нет пустого шаблона;
    - B-97 FLD реквизитов не пустые.
8. **STOP-guards**
  - Остановиться, если dry-run показывает больше одного целевого заказа для repair.
  - Остановиться, если сценарий кнопки отсутствует или template inactive/deleted.
  - Остановиться, если новый платеж получает не `admin_test`, а реальный `bepaid` — не менять логику реальных платежей.
  - Остановиться, если изменение требует UPDATE/DELETE в `payments_v2`.
  - Остановиться, если нужно менять document scenarios или шаблон — это отдельная задача.
9. **DoD**
  - Новая тестовая сделка по `7500084@gmail.com` автоматически получает шаблон и исполнителя из кнопки.
  - UI больше не показывает «Автоматически (не задан в кнопке)» при настроенном сценарии.
  - `orders_v2.meta.document_data._provenance.scenario.source = 'scenario'` для новой сделки.
  - `payment_channel = 'card'` для тестовой оплаты через сайт.
  - PDF генерируется без `template_not_found` и без пустых реквизитов B-97.
  - В отчёте будут указаны: root cause, изменённые файлы, proof новой сделки, proof PDF, token/source trace, STOP-guards.
10. **Риски и зависимости**
  - Уже созданные старые сделки могут иметь старый snapshot с `payment_channel=other`; для них нужен отдельный безопасный repair по конкретному `order_id`.
  - UI на published-домене увидит frontend-правку только после публикации.
  - Edge functions нужно redeploy после изменения shared resolver.
11. **Требуется дополнительная информация**
  - Не требуется. Данных достаточно: root cause подтверждён live SQL и audit proof.