да, согласен, с учетом правок:

1. **Разделить** `payment.amount` **и** `payment.amount_formatted` **строго**

Сейчас в плане есть риск сломать уже понятное отображение суммы. Нужно зафиксировать:

```text
payment.amount = 100,00
payment.currency = BYN
payment.amount_formatted = 100,00 BYN
payment.amount_words = 100 (сто) рублей, 00 копеек
```

То есть лучше не просто менять `FLD-000264`, а проверить, что означает его label в registry. Если label сейчас «Сумма платежа», сделать `100,00`. Если нужен вариант с валютой — отдельный плейсхолдер `payment.amount_formatted`.

2. **Добавить не один, а два новых токена, если их нет**

Чтобы не потерять оба варианта:

```text
payment.amount_formatted → 100,00 BYN
payment.amount_words → 100 (сто) рублей, 00 копеек
```

Если `payment.amount_formatted` уже есть — не создавать дубль, только использовать существующий.

3. **Не использовать** `format=words` **на** `payment.amount`

Зафиксировать как deprecated-поведение:

```text
{{field:FLD-000264|format=words}} не является правильным способом получить сумму прописью.
Правильный плейсхолдер: payment.amount_words / FLD-000370.
```

Если renderer сейчас всё равно поддерживает `format=words`, он должен вернуть тот же новый формат, но в UI/picker нужно рекомендовать отдельный плейсхолдер.

4. **Перед добавлением** `FLD-000370` **обязательно перечитать max public_id**

Не хардкодить `FLD-000370`, а сделать так:

```text
current max FLD = ...
new FLD = max + 1
```

Если `FLD-000370` уже занят — использовать следующий свободный ID и указать его в отчёте.

5. `bepaid-webhook` **stale-meta fix должен быть точечным**

Не переписывать весь webhook. Исправить только места, где делается что-то вроде:

```ts
meta: { ...orderV2.meta, ...newMeta }
```

после того, как другие функции уже могли изменить `orders_v2.meta`.

Правильный паттерн:

```text
перед UPDATE заново SELECT актуальный orders_v2.meta
merge поверх свежего meta
не удалять document_data / crm_routing_snapshot / documents
```

6. **Repair Любови Пилецкой — только snapshot rebuild**

Не делать ручных вставок в `meta.document_data`. Нужно вызвать существующий путь:

```text
snapshotOrderDocumentData(orderId, { mode: 'rebuild' })
```

И доказать, что:

- `document_data` восстановился;
- template/executor/provenance появились;
- блокировка осталась только по отсутствующим реквизитам ФЛ.

7. **Добавить проверку, что у Любови нет реквизитов именно в активной карточке ФЛ**

Не просто «нет реквизитов», а proof:

```sql
profile_id
client_legal_details WHERE client_type='individual'
individual_requisites
```

И вывод:

```text
template/executor OK
payer_type=individual OK
customer individual requisites missing → блокировка корректна
```

8. **Не менять активный шаблон автоматически**

Согласен с планом. Но в Verify добавить отдельный пункт:

```text
Текущий шаблон всё ещё содержит старый {{field:FLD-000264|format=words}}.
После патча будет доступен новый FLD для amount_words.
Замена в DOCX — отдельный template-version patch после approve.
```

9. **DoD по Сергею разделить на две сделки**

Для `ORD-TEST-MPF8NM2B`:

```text
UI карточки: template/executor подтянулись.
```

Для `ORD-TEST-MPF8PW9G`:

```text
payment.amount / amount_words исправлены в snapshot/preview/PDF.
```

Не смешивать эти проверки.

10. **Добавить anti-regression по реальному bePaid платежу**

План уже упоминает stale meta и admin_test. Нужно проверить ещё один реальный `provider='bepaid'`:

- `payment.amount` без валюты;
- `payment.currency`;
- `payment.amount_formatted`;
- `payment.amount_words`;
- webhook не затирает `document_data`.

11. **В отчёте обязательно указать, что прошлый вывод “документ сформировался” был неполным**

Потому что PDF мог создаться, но бизнес-содержание было неправильным. Добавить раздел:

```text
Почему прошлый статус был неполным:
PDF generation success ≠ корректное заполнение реквизитов и сумм.
Теперь проверяем не только факт PDF, но и значения FLD.
```

12. **Финальный proof должен включать token_manifest_snapshot по новым денежным полям**

Минимум:

```text
payment.amount
payment.currency
payment.amount_formatted
payment.amount_words
document.amount_words
deal.amount_words
```

С этими правками план можно запускать.

&nbsp;

Добавь в план вот эту правку:

```text
13. Уточнение по payment amount tokens — НЕ создавать объединяющий amount_formatted

Не создавать отдельный токен `payment.amount_formatted`.

Причина:
- уже есть отдельный токен суммы платежа: `payment.amount`;
- уже есть отдельный токен валюты платежа: `payment.currency`;
- пользователь может вставить их рядом в шаблоне:
  `{{payment.amount}} {{payment.currency}}`
  или через FLD:
  `{{field:FLD-payment.amount}} {{field:FLD-payment.currency}}`.

Нужно создать / добавить только один новый токен:

`payment.amount_words`

Назначение:
- сумма платежа прописью с учётом валюты платежа.

Формат:
- `100 (сто) рублей, 00 копеек`
- `100 (сто) долларов, 00 центов`
- `100 (сто) евро, 00 центов`

Правило:
- числовая целая часть;
- в скобках целая часть прописью;
- валюта в правильной форме;
- дробная часть двумя цифрами;
- дробная валюта в правильной форме.

Примеры:
- `100.56 BYN` → `100 (сто) рублей, 56 копеек`
- `100.56 RUB` → `100 (сто) рублей, 56 копеек`
- `100.56 USD` → `100 (сто) долларов, 56 центов`
- `100.56 EUR` → `100 (сто) евро, 56 центов`
- `1.01 BYN` → `1 (один) рубль, 01 копейка`
- `2.04 BYN` → `2 (два) рубля, 04 копейки`
- `5.00 BYN` → `5 (пять) рублей, 00 копеек`
- `21.15 USD` → `21 (двадцать один) доллар, 15 центов`

Что исправить в текущем плане:
- Убрать пункт про создание `payment.amount_formatted`.
- `payment.amount` должен быть только суммой без валюты: `100,00`.
- `payment.currency` должен быть отдельным токеном: `BYN`.
- `payment.amount_words` — единственный новый payment-токен.
- Если `payment.amount_formatted` уже существует в registry — не использовать и не продвигать его в UI как основной путь.
- В picker / каталоге плейсхолдеров рекомендовать:
  - сумма: `payment.amount`;
  - валюта: `payment.currency`;
  - сумма прописью: `payment.amount_words`.

Formatter:
- использовать currency из `payment.currency`;
- если currency отсутствует — fallback на `BYN` и warning `payment_amount_words_currency_missing`;
- если currency неизвестна — fallback:
  `100 (сто) <CURRENCY>, 56`
  + warning `payment_amount_words_unknown_currency:<currency>`.

DoD:
- Новый токен `payment.amount_words` доступен в каталоге.
- `payment.amount` не содержит валюту.
- `payment.currency` содержит только валюту.
- `payment.amount_words` корректно работает для BYN/RUB/USD/EUR.
- Не создан лишний новый токен `payment.amount_formatted`.
- В отчёте указать, что объединение суммы и валюты делается в DOCX вручную двумя плейсхолдерами, а не отдельным токеном.
```

Итоговая логика должна быть такой:

```text
Сумма: {{payment.amount}} {{payment.currency}}
Сумма прописью: {{payment.amount_words}}
```

То есть лишний объединяющий токен не нужен.

&nbsp;

План:

1. **Проблема**
  - По последним сделкам документы ведут себя нестабильно:
    - `ORD-TEST-MPF8NM2B` — Сергей Федорчук, тариф FULL: на скрине шаблон/исполнитель не подставились.
    - `SUB-LINK-MPF8O42U` — Любовь Пилецкая, тариф CHAT: шаблон/исполнитель видны, но документ блокируется из-за отсутствующих реквизитов физлица.
    - `ORD-TEST-MPF8PW9G` — Сергей Федорчук, тариф CHAT: документ сформировался, но в суммовых плейсхолдерах есть дефекты: `payment.amount` отдаёт `100,00 BYN`, а нужен только числовой amount; сумма прописью должна идти отдельным понятным плейсхолдером.
2. **Диагностика**
  - Сергей Федорчук / FULL / `ORD-TEST-MPF8NM2B`:
    - `orders_v2.offer_id = NULL`, но `orders_v2.meta.offer_id = c5781abf-…`.
    - Backend snapshot уже создал `document_data` и правильно нашёл сценарий кнопки FULL:
      - `template_id = 7caee05d-…`
      - `executor_id = d0c7fe75-…`
      - `scenario.source = scenario`
    - Это подтверждает, что корневая причина первого скрина была UI/offer_id fallback; текущий backend по этой сделке уже заполнен.
  - Любовь Пилецкая / CHAT / `SUB-LINK-MPF8O42U`:
    - `document_data.snapshot_created` был создан в 08:39:06 и нашёл scenario/template/executor.
    - Затем `bepaid-webhook` сделал update `orders_v2.meta` для GetCourse sync из устаревшего объекта `orderV2.meta` и фактически затёр `meta.document_data`.
    - У Любови Пилецкой нет реквизитов физлица ни в `client_legal_details`, ни в `individual_requisites`; поэтому даже после восстановления snapshot документ должен честно блокироваться по реквизитам, пока карточка физлица не заполнена.
  - Сергей Федорчук / CHAT / `ORD-TEST-MPF8PW9G`:
    - Документ `2105/1` создан.
    - Snapshot содержит:
      - `payment.amount = "100,00 BYN"` в `FLD-000264` — это ошибка для числового плейсхолдера платежа.
      - `payment.currency = "BYN"` отдельно уже есть в `FLD-000265`.
      - `document.amount_words = "100 (сто) рублей, 00 копеек"` в `FLD-000192` — формат суммы прописью правильный, но в шаблоне сейчас использован `{{field:FLD-000264|format=words}}`, что смешивает сумму платежа и сумму прописью.
3. **Предлагаемое решение**
  - Исправить stale-meta overwrite в `bepaid-webhook`: перед любым post-grant update `orders_v2.meta` перечитывать актуальный `meta` из БД или выполнять безопасный merge, чтобы не терять `document_data`, `crm_routing_snapshot` и другие поля, созданные downstream-функциями.
  - Восстановить `document_data` для одной текущей сделки Любови Пилецкой `SUB-LINK-MPF8O42U` через существующий canonical snapshot path, без изменения доступов, подписок, платежей и bePaid.
  - Исправить `payment.amount`:
    - `FLD-000264 / payment.amount` должен быть числом без валюты: `100` или `100,00` по принятому формату, но без `BYN`.
    - `FLD-000265 / payment.currency` остаётся отдельной валютой.
  - Добавить отдельный плейсхолдер для суммы платежа прописью:
    - новый `payment.amount_words`, например `FLD-000370`, label: `Сумма платежа прописью`.
    - значение: `100 (сто) рублей, 00 копеек` по уже существующему canonical formatter `formatAmountWithWordsByRublesAndKopecks`.
  - В генераторе/снапшоте заполнять новый `payment.amount_words` из `payments_v2.amount + payments_v2.currency`.
  - Не менять шаблон автоматически без отдельного approve: после появления нового плейсхолдера можно будет заменить в DOCX `{{field:FLD-000264|format=words}}` на `{{field:FLD-000370}}` через отдельный контролируемый template patch, если подтвердите.
4. **Изменяемые компоненты**
  - Edge functions:
    - `supabase/functions/bepaid-webhook/index.ts` — защита от stale meta overwrite.
  - Shared document resolver:
    - `supabase/functions/_shared/standard-fields.ts` — `payment.amount` без валюты + новый `payment.amount_words`.
    - при необходимости `supabase/functions/_shared/document-data-snapshot.ts` — добавить `payment.amount_words` в snapshot block.
  - Database catalog:
    - `fields_registry` — добавить один новый FLD для `payment.amount_words`.
    - `document_token_registry` — добавить UI-токен для выбора в редакторе плейсхолдеров.
  - Proof:
    - `.lovable/proofs/patch_document_generation_current_errors_2026_05.md`.
5. **Что не будет изменено**
  - Не трогаю доступы, entitlements, subscriptions, Telegram, bePaid API.
  - Не создаю новые платежи, заказы или документы задним числом.
  - Не меняю финансовые суммы заказов/платежей.
  - Не меняю шаблон DOCX автоматически без отдельного подтверждения, потому что это контент активной версии шаблона.
  - Не создаю альтернативный workflow документов.
6. **Dry-run**
  - Проверить текущие последние сделки:
    - Сергей Федорчук `ORD-TEST-MPF8NM2B`, `ORD-TEST-MPF8PW9G`.
    - Любовь Пилецкая `SUB-LINK-MPF8O42U`.
  - Проверить, что у Любови Пилецкой отсутствуют реквизиты физлица и поэтому генерация должна блокироваться именно по реквизитам, а не по template/executor.
  - Проверить, какие именно post-grant meta updates в `bepaid-webhook` могут перетирать `document_data`.
  - Перед DB-catalog изменением проверить `max(public_id)=FLD-000369`, затем подготовить insert только для `FLD-000370` с guard `not exists`.
  - Preview для `canonical-document-generate-strict` по `ORD-TEST-MPF8PW9G` должен показать:
    - `payment.amount` без `BYN`;
    - новый `payment.amount_words` со строкой `100 (сто) рублей, 00 копеек`.
7. **Execute**
  - Внести кодовый patch stale-meta merge в webhook.
  - Внести кодовый patch amount/payment.amount_words в document snapshot/standard fields.
  - Добавить новый FLD/token через миграцию с idempotent guards.
  - Выполнить controlled repair только для `SUB-LINK-MPF8O42U`: восстановить `orders_v2.meta.document_data` существующим snapshot rebuild path.
  - Задеплоить затронутые backend functions.
8. **STOP-guards**
  - Остановиться, если `FLD-000370` уже занят другим токеном.
  - Остановиться, если у Любови Пилецкой найден не тот order/profile/email.
  - Остановиться, если repair затрагивает больше одного order.
  - Остановиться, если snapshot rebuild пытается изменить платежи, подписки, доступы или provider fields.
  - Остановиться, если preview показывает `required_fields_empty` не из-за отсутствующих реквизитов, а из-за потери template/executor.
9. **DoD**
  - `SUB-LINK-MPF8O42U` снова имеет `meta.document_data.template_id/executor_id` и provenance по scenario.
  - По Любови Пилецкой UI показывает корректную единственную блокировку: не заполнены реквизиты физлица.
  - `payment.amount` больше не содержит `BYN`.
  - Новый `payment.amount_words` доступен в registry/token picker и отдаёт формат `100 (сто) рублей, 00 копеек`.
  - `bepaid-webhook` больше не затирает `orders_v2.meta.document_data` после snapshot/grant.
  - Proof содержит SQL/log verification по Сергею Федорчуку и Любови Пилецкой с ФИО.
10. **Риски и зависимости**
  - Активный DOCX-шаблон сейчас использует `{{field:FLD-000264|format=words}}`; после добавления нового плейсхолдера правильная замена в шаблоне потребует отдельного approve на template-version patch.
  - У Любови Пилецкой документ не должен начать генерироваться до заполнения реквизитов физлица — это корректная бизнес-блокировка, не баг.