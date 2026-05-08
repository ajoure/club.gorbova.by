Да, согласен, с учетом правок:

```text
Дополни и скорректируй план Sprint 10.

Общее направление подтверждаю:

- сделать discovery плейсхолдеров;
- подключить общий placeholder picker из контакт-центра;
- добавить context `documents:act`;
- заполнить полный document registry;
- добавить вкладку “Плейсхолдеры”;
- сохранять `document_data` в сделке.

Но текущий план нужно изменить по продуктам/тарифам/кнопкам и сделке.

---

# Ключевые правки к плану

## 1. В продукте НЕ создавать новую вкладку “Документы” отдельным компонентом

В редакторе продукта уже есть вкладка:

“Доп. поля”

Её нужно переиспользовать и переименовать в:

“Документы”

Именно в этой вкладке должны быть поля, которые используются для документов.

То есть:

Было:
- Доп. поля

Должно стать:
- Документы

Внутри этой вкладки:
- список полей для документов;
- возможность добавить поле;
- возможность редактировать поле;
- возможность удалить поле;
- возможность скопировать плейсхолдер;
- отображение token_key / field_id только в техническом режиме;
- человекочитаемое название поля как основной UI.

Не создавать параллельную систему “document fields”, если уже есть custom fields / fields_registry.

---

## 2. Логику “Данные для акта” делать НЕ в тарифе, а в кнопке оплаты / offer

Предыдущий план предлагал:

“В редакторе тарифа — секция Данные для акта”

Это неправильно.

Основные условия сделки зависят не от тарифа, а от конкретной кнопки оплаты / offer, потому что именно в кнопке есть:

- конкретная сумма;
- тип оплаты;
- полная оплата / рассрочка / trial;
- цена;
- повторное вступление;
- условия оплаты;
- срок оплаты;
- override услуги.

Поэтому:

### В тарифе

Хранить только базовые настройки:

- название тарифа;
- срок доступа;
- базовая цена;
- валюта;
- базовое описание, если уже есть;
- default значения, если они нужны.

Но НЕ делать тариф главным источником данных для акта.

### В кнопке оплаты / offer

Добавить секцию:

“Данные для документов”

Именно здесь заполняются:

- формировать акт: да/нет;
- шаблон акта;
- наименование услуги;
- описание услуги;
- единица измерения;
- количество;
- цена за единицу;
- сумма акта;
- валюта;
- срок оплаты;
- срок оказания услуги;
- период оказания услуг;
- количество месяцев;
- предоплата, %;
- предоплата, сумма;
- скидка, сумма;
- первый платеж;
- цена для банковского кредита / рассрочки;
- окончательный расчет;
- исполнитель;
- комментарий для документа.

Именно эти данные затем должны попадать в сделку / заказ как `document_data`.

---

## 3. Добавить копирование кнопки оплаты

Чтобы не заполнять каждый раз поля заново, в разделе кнопок оплаты нужно добавить действие:

“Копировать кнопку”

Логика:

1. Админ нажимает “Копировать”.
2. Создается новая кнопка оплаты на основе существующей.
3. Копируются:
   - название;
   - тип кнопки;
   - цена;
   - валюта;
   - настройки оплаты;
   - настройки автопродления;
   - document_data / данные для документов;
   - template_id;
   - service_name;
   - service_description;
   - payment_due_days;
   - execution_days;
   - unit;
   - quantity;
   - все override-поля для акта.
4. Новая кнопка создается выключенной / inactive по умолчанию.
5. Админ редактирует нужные поля и включает её вручную.

STOP-guard:
- не копировать payment link provider id как активную ссылку, если это может создать конфликт;
- новая кнопка должна иметь новый public_id/code;
- audit `offer.copied`;
- старая кнопка не изменяется.

---

## 4. Сделка: вкладка “Документы”

В карточке сделки / заказа добавить вкладку:

“Документы”

Внутри неё сделать две подвкладки:

1. “Поля”
2. “Документы”

---

# Подвкладка сделки: “Поля”

Показывает все document_data, которые были перенесены из продукта / кнопки оплаты в сделку.

Там должны быть:

## Договор

- номер договора;
- дата договора;
- валюта сделки;
- курс USD/BYN;
- дата оплаты / дата ведения.

## Услуга

- наименование услуги;
- описание услуги;
- единица измерения;
- цена за единицу;
- количество;
- сумма акта;
- сумма прописью;
- валюта целая часть;
- валюта дробная часть.

## Сроки

- срок оплаты;
- срок оказания услуг;
- период с;
- период по;
- количество месяцев.

## Расчеты

- предоплата, %;
- предоплата, сумма;
- скидка, сумма;
- первый платеж;
- цена для банковского кредита / рассрочки;
- окончательный расчет.

## Шаблоны и исполнитель

- шаблон акта;
- исполнитель;
- реквизиты клиента;
- подписант клиента.

Поля можно редактировать вручную в сделке.

Важно:
если поле пришло из кнопки оплаты, показывать источник:

“Заполнено из кнопки оплаты CHAT”

Если админ изменил поле вручную, показывать:

“Изменено вручную”

---

# Подвкладка сделки: “Документы”

Показывает документы, сгенерированные по этой сделке:

- акт выполненных работ;
- дата генерации;
- статус;
- шаблон;
- версия шаблона;
- скачать DOCX;
- открыть предпросмотр;
- посмотреть слепок данных;
- перегенерировать.

Действия:

- “Предпросмотр акта”
- “Сформировать акт”
- “Перегенерировать”
- “Открыть историю”

Пока ожидается один основной документ:

“Акт выполненных работ”

Но архитектура должна позволять потом добавить:
- договор;
- счет;
- приложение;
- протокол;
- письмо.

---

## 5. Snapshot document_data

При создании заказа / сделки document_data должен собираться в таком порядке:

1. Данные кнопки оплаты / offer — главный источник.
2. Если в кнопке поля нет — fallback на тариф.
3. Если в тарифе поля нет — fallback на продукт.
4. Если нет нигде — поле пустое + warning.

Сохранять в:

`orders_v2.meta.document_data`

или если discovery покажет, что по архитектуре лучше отдельная таблица, предложить:

`order_document_data`

Но по умолчанию использовать safe jsonb:

`orders_v2.meta.document_data`

Snapshot не должен автоматически перезаписываться после изменения кнопки оплаты или продукта.

Если нужно обновить — только вручную через кнопку:

“Обновить поля из кнопки оплаты”

С подтверждением:

“Это перезапишет данные для документов в этой сделке. Старые сгенерированные документы не изменятся.”

---

## 6. Resolver документов

При генерации акта resolver должен брать данные в таком порядке:

1. `orders_v2.meta.document_data`
2. overrides из формы генерации
3. fallback live offer/tariff/product
4. computed fields

Если используется fallback, писать warning:

`document_data_missing_using_live_fallback`

---

## 7. Плейсхолдеры

Плейсхолдеры должны использовать existing placeholder picker из контакт-центра / рассылок.

Не создавать второй независимый picker.

Нужно:

- расширить существующий `TokenizedRichInput` / token registry;
- добавить context `documents:act`;
- показывать полный каталог;
- использовать человекочитаемые названия;
- технические token_key/field_id показывать только в техрежиме;
- добавить вкладку `/admin/ai → Документы → Плейсхолдеры`.

---

## 8. Исправить текущую вкладку “Доступные плейсхолдеры”

Сейчас там 5 полей. Это неправильно.

Нужно заменить на полный каталог из `document_token_registry` + existing placeholder registry.

Там должны быть группы:

- Контакт / профиль
- Реквизиты клиента
- Подписант клиента
- Исполнитель
- Сделка / заказ
- Продукт
- Тариф
- Кнопка оплаты
- Документ / акт
- Системные поля
- Пользовательские поля

---

## 9. Нормализованный набор полей акта из amoCRM/GetDoc

На основе старого шаблона акта и полей amoCRM добавить базовые document fields:

### Договор

- contract_number — Номер договора
- contract_date — Дата договора
- deal_currency — Валюта сделки
- usd_byn_rate — Курс USD/BYN
- payment_date — Дата оплаты / дата ведения

### Услуга

- service_name — Наименование услуги
- service_description — Описание услуги
- service_unit — Единица измерения
- service_price — Цена за единицу
- service_quantity — Количество
- service_amount — Сумма акта
- service_amount_words — Сумма прописью
- currency_major — Валюта, целая часть
- currency_minor — Валюта, дробная часть

### Сроки

- payment_due_days — Срок оплаты
- execution_days — Срок оказания услуг
- service_period_from — Период с
- service_period_to — Период по
- months_count — Количество месяцев

### Расчеты

- prepayment_percent — Предоплата, %
- prepayment_amount — Предоплата, сумма
- discount_amount — Скидка, сумма
- first_payment — Первый платеж
- bank_credit_price — Цена для банковского кредита / рассрочки
- final_payment_amount — Окончательный расчет

### Шаблон / исполнитель

- act_template_id — Шаблон акта
- executor_id — Исполнитель
- customer_legal_details_id — Реквизиты клиента
- customer_signer_id — Подписант клиента

Все эти поля должны быть:
- в registry;
- доступны как плейсхолдеры;
- видны в product/offer document settings;
- копироваться в сделку;
- редактироваться в сделке;
- участвовать в генерации акта.

---

## 10. Обновленный DoD Sprint 10

Sprint 10 считается выполненным, если:

1. Сделан discovery существующего placeholder picker из контакт-центра.
2. Добавлен context `documents:act`.
3. `document_token_registry` заполнен полным набором токенов.
4. Вкладка “Плейсхолдеры” показывает полный каталог, а не 5 полей.
5. В продукте вкладка “Доп. поля” переименована в “Документы”.
6. В карточке кнопки оплаты добавлена секция “Данные для документов”.
7. Добавлена функция “Копировать кнопку оплаты”.
8. При создании заказа/сделки данные кнопки оплаты копируются в `orders_v2.meta.document_data`.
9. В сделке появилась вкладка “Документы” с двумя подвкладками:
   - “Поля”
   - “Документы”
10. Подвкладка “Поля” показывает document_data и позволяет редактировать.
11. Подвкладка “Документы” показывает документы по сделке и позволяет сформировать акт.
12. Resolver акта берет данные из `orders_v2.meta.document_data`.
13. Legacy не сломан.
14. Email/Telegram/auto-send не включались.

---

## 11. Что НЕ делать

- Не создавать новую вкладку продукта параллельно существующей “Доп. поля”.
- Не делать тариф главным источником данных для акта.
- Не включать auto-generation.
- Не отправлять email/Telegram.
- Не делать массовую генерацию.
- Не удалять старые flows.
- Не перезаписывать document_data в старых сделках автоматически.

---

## 12. Финальный отчет

Отчет должен начинаться:

Отчет о выполненной работе: Sprint 10 — модель данных, плейсхолдеры и document_data сделки

В отчете указать:

1. Что найдено по existing placeholder picker.
2. Как переиспользован picker.
3. Сколько токенов теперь в registry.
4. Какие группы плейсхолдеров созданы.
5. Что изменено в продукте.
6. Что изменено в кнопке оплаты.
7. Как работает копирование кнопки.
8. Как document_data попадает в сделку.
9. Как устроена вкладка “Документы” в сделке.
10. Как resolver использует document_data.
11. Что НЕ делалось: email, Telegram, auto-send, production auto-generation.
```

Главное изменение: **центр данных для акта — не тариф, а кнопка оплаты / offer**, потому что именно она определяет конкретные условия покупки.

&nbsp;

План: Sprint 10 — модель данных и плейсхолдеров для документов

Главная идея: не создавать второй picker для документов. Расширить уже существующую систему `TokenizedRichInput` + `src/lib/tokens/tokenRegistry.ts` (та же квадратная скобка → выпадающий список → чип с человеческим названием → внутри `{{token}}`), и подвесить на неё нормальную модель document_data в продукте/тарифе/offer/сделке.

Email/Telegram/auto-send/batch/production auto-generation в Sprint 10 НЕ трогаем.

---

## 0. Что уже есть (discovery, факт)

- `src/lib/tokens/tokenRegistry.ts` — единый registry с группами: contact, datetime, product, legal_details, person, entity_person, entity, document, meeting, package_*, agenda, decision. API: `loadTokensForContext("messages" | "documents" | ...)`, `getTokenGroupsForContext(...)`.
- `src/components/admin/TokenizedRichInput.tsx` — TipTap-редактор с `[`-триггером, поиском, группировкой, чипами, `tokenStringToLabel`. Используется в:
  - `BroadcastTemplateDialog`, `BroadcastsTabContent`, `CommunicationSettingsTabContent` (контакт-центр / рассылки),
  - `MassBroadcastDialog` (Telegram),
  - `AdminEmail`,
  - `AiDocumentTemplatesManager` (уже!).
- Таблица `fields_registry` — 47 legal_details, 12 person, 6 entity, 6 entity_person, 15 meeting, 3 document, 3 product, 8 package, 1 agenda, 1 decision.
- Таблица `document_token_registry` (отдельная, уже есть): 9 customer, 10 executor, 8 deal, 47 legal_details, 3 document, 2 system. То есть параллельный реестр под акт уже существует, но он не подключён к picker'у.
- Канонические форматы токенов:
  - Class A: `{{cf.<entity>.<PUBLIC_ID>}}` (legal_details FLD-…),
  - Class B: `{{canonical.key}}` (contact, datetime, document.*, meeting.*, и т.д.).

Вывод: новый picker не нужен. Нужно (а) подключить документный контекст к существующему picker'у с полным набором групп, (б) докрутить registry, (в) добавить snapshot document_data в сделке.

---

## 1. Discovery-отчёт (доставляется как первый артефакт)

Файл `.lovable/proofs/document_generation_sprint10_placeholder_discovery.md`:

- Inventory компонентов (TokenizedRichInput + потребители).
- Inventory таблиц (fields_registry по entity_type, document_token_registry по category).
- Маппинг «человеческое название → token string → resolver» по слоям.
- Решение: документный picker = `TokenizedRichInput` + новый `tokenContext = "documents:act"`.
- Что уже есть, что недокручено, что отсутствует.

## 2. Расширение существующего picker'а под документы (без второго picker'а)

В `src/lib/tokens/tokenRegistry.ts`:

- Добавить `TokenContext = "documents:act"`.
- В `loadTokensForContext("documents:act")` догружать новые группы:
  - `executor.*` (читаем из `document_token_registry` category=executor, и/или `fields_registry` entity_type='executor', если её нет — заводим в registry без БД-таблицы как Class B computed),
  - `customer.*` и `customer.signer.*` (резолвится через legal_details + entity_person_links, токены человекочитаемые),
  - `order.*`, `product.*`, `tariff.*`, `offer.*`, `document.*` (включая `amount_words`, `currency_major/minor`, `service_*`, `payment_due_days`, `execution_days`, `service_period_*`, `prepayment_*`, `discount_amount`, `final_payment_amount`),
  - `system.*` (today_ru, year, month, now).
- `getTokenGroupsForContext("documents:act")` → 11 групп ровно как в ТЗ пункта 2.

В `AiDocumentTemplatesManager` и `CanonicalActGenerator` поменять контекст с `"documents"` на `"documents:act"` (бэк-совместимо: старый `"documents"` остаётся как есть для уже работающих шаблонов).

## 3. Backfill `document_token_registry`

Миграция, идемпотентная по `token_key`:

- ON CONFLICT (token_key) DO NOTHING.
- Заливаем полный базовый набор из ТЗ пункта 4 (contact, customer, customer.signer, executor, order, product, tariff, offer, document, system).
- Для полей, у которых есть запись в `fields_registry`, заполняем `field_id`. Для computed — `field_id = null`, ставим `resolver_key`.
- Заполняем `ui_label`, `category`, `source_type`, `data_type`, `is_required`, `example_value`, `display_order`.
- Никаких удалений; уже существующие 79 строк не трогаем.

## 4. Вкладка «Плейсхолдеры» в /admin/ai → Документы

Новый компонент `src/components/ai-documents/PlaceholdersCatalogTab.tsx`:

- Источник = `document_token_registry` + резолв `ui_label/data_type` через registry.
- Группировка по category (11 групп).
- На каждую строку: человеческое название, badge типа, источник, обязательность, пример, кнопки «Скопировать токен» и «Использовать в шаблоне» (последняя пока only-copy + toast «Вставьте в открытый шаблон»).
- Поиск по названию/группе.
- Полный список, не 5 штук.

## 5. document_data на продукте / тарифе / offer (safe-модель, без новых таблиц)

Без новых таблиц на этом этапе — храним в существующих jsonb-meta:

- `products_v2.meta.document_defaults` — нужно ли формировать акт, дефолтный template_id, base service_name/description, unit, payment_due_days, execution_days, currency, executor_id.
- `tariffs.meta.document_defaults` — service_name/description, unit, quantity, price, currency, access_days, execution_days, service_period_*, template_id override.
- `tariff_offers.meta.document_defaults` — amount, payment_type, override service_name/description/payment_due_days/quantity/unit/template_id.

UI:

- В редакторе продукта добавить вкладку «Документы» (новый компонент `ProductDocumentsTab.tsx`), не «Доп. поля».
- В редакторе тарифа — секция «Данные для акта».
- В редакторе offer'а — секция «Override для акта».
- Все поля — те же, что станут плейсхолдерами (ui-метки совпадают с picker'ом).

Никаких миграций структуры не нужно (jsonb уже есть). Только UI + чтение/запись в meta.

## 6. Snapshot document_data в сделке

В `orders_v2.meta.document_data` (не новая колонка, не новая таблица — соответствует «Subscriptions V2 Schema Contract» / «meta-only»):

- При создании заказа edge function `grant-access-for-order` (или существующий хук создания заказа, если он отдельный) собирает snapshot:
  - читает `tariff_offers.meta.document_defaults` → `tariffs.meta.document_defaults` → `products_v2.meta.document_defaults` (override-цепочка),
  - вычисляет `amount`, `currency_major`, `currency_minor`, `amount_words`, `service_period_from/to` от paid_at,
  - сохраняет в `orders_v2.meta.document_data` с `snapshot_version` и `snapshotted_at`.
- Идемпотентно: если snapshot уже есть — не перезаписывать (ручное «Обновить из продукта/тарифа» в UI сделки делает write с подтверждением).
- Resolver документа сначала читает `orders_v2.meta.document_data`. Если поля нет — fallback на live tariff/offer + warning в `warnings_snapshot`.
- Auto-generation остаётся выключенной флагами; snapshot пишется при создании заказа независимо от флагов (это просто сбор данных, документ не генерируется).

## 7. Вкладка «Документы» в сделке

Новая вкладка в drawer/странице сделки:

- Шапка: выбранный template_id, исполнитель, базовые дата/номер договора и акта.
- Поля snapshot'а: реквизиты клиента, услуга, цена, кол-во, сумма, сумма прописью, валюта, срок оплаты/оказания, период.
- История документов из `ai_generated_documents` по `context_id = order.id`.
- Действия: Предпросмотр, Сформировать (через уже существующий `canonical-document-generate` за флагом), Перегенерировать (через `canonical-document-regenerate`), История, «Обновить data из продукта/тарифа/offer» с подтверждением.

## 8. Разметка DOCX (MVP без редактора)

Описание flow на странице «Плейсхолдеры»: открыть каталог → скопировать → вставить в Word → загрузить новую версию шаблона → автоматическая валидация через уже существующий `canonical-template-validate`. Если в шаблоне 0 токенов — показывать «Шаблон ещё не размечен», не ошибку.

## 9. AI-подсказки

Только UI-заглушка в каталоге плейсхолдеров: кнопка «Предложить плейсхолдеры (скоро)», disabled, с пояснением. Никаких автозамен в DOCX.

## 10. Что НЕ делаем

- Не делаем второй placeholder picker.
- Не включаем `documents_canonical_generation_enabled`, `documents_service_act_auto_generation_enabled`.
- Не трогаем legacy `generated_documents` и `document-auto-generate`.
- Не отправляем email/Telegram, нет batch и нет массовой регенерации старых документов.
- Не добавляем новые таблицы (только jsonb meta + backfill в существующий `document_token_registry`).

## 11. DoD

1. Discovery-отчёт по существующему picker'у создан.
2. `documents:act` контекст добавлен в `tokenRegistry`, `TokenizedRichInput` им пользуется.
3. `document_token_registry` дозаполнен полным базовым набором (≥120 токенов, 11 групп).
4. Вкладка «Плейсхолдеры» с полным каталогом и копированием.
5. Вкладка «Документы» в продукте + секции document_defaults в тарифе и offer.
6. Snapshot `orders_v2.meta.document_data` пишется при создании заказа, идемпотентно.
7. Вкладка «Документы» в сделке отображает snapshot + историю + ручные действия.
8. Resolver приоритезирует snapshot; fallback пишет warning, но не падает.
9. Legacy потоки (рассылки, существующие шаблоны, `generated_documents`) не сломаны.
10. Все feature flags автогенерации остаются `false`.

## 12. Финальный отчёт

Файл `.lovable/proofs/document_generation_sprint10_placeholder_model.md` со структурой ровно как в ТЗ пункта 12.

---

## Технические детали (для не обязательного чтения)

- Файлы, которые правим:
  - `src/lib/tokens/tokenRegistry.ts` — `TokenContext`, новые loaders для executor/order/product/tariff/offer/document.act/customer.
  - `src/components/admin/TokenizedRichInput.tsx` — без правок, просто получает новые группы через context.
  - `src/components/ai-documents/AiDocumentTemplatesManager.tsx`, `CanonicalActGenerator.tsx` — context = `"documents:act"`.
  - Новый: `src/components/ai-documents/PlaceholdersCatalogTab.tsx`.
  - Новый: `src/components/products/ProductDocumentsTab.tsx`.
  - Правка: редактор тарифа и offer'а — секции document_defaults.
  - Правка: drawer сделки — вкладка «Документы».
  - Edge: `grant-access-for-order` (или хук создания заказа) — сбор snapshot в `meta.document_data`. Idempotency by presence.
  - Resolver `_shared/document-render.ts` — приоритет `order.meta.document_data` > live.
- Миграция: только `INSERT ... ON CONFLICT DO NOTHING` в `document_token_registry`. Никаких ALTER TABLE, никаких новых колонок.
- Соответствует mem://architecture/data-layer/subscriptions-v2-schema-contract — meta-only хранение.
- Соответствует mem://architecture/standard/id-first-contract — UUID/public_id внутри, человеческие лейблы снаружи.

После одобрения плана начну с пункта 1 (discovery-отчёт) и пункта 2 (расширение `tokenRegistry`).