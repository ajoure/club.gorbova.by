## да, согласен, с учетом правок:

&nbsp;

1. В плане явно зафиксируй, что **источником истины для типа оплаты становится выбранный/fallback offer**, а не отдельно radio.
  То есть radio — это UX-фильтр и предпочтение пользователя, но в момент submit нужно передавать **effective offer** и **effective payment type**, согласованные между собой. Иначе можно оставить старый конфликт: UI выбрал fallback-offer одного типа, а в payload ушёл другой payment_type.
2. Пункт 0 edge functions изменяется оставь **только если** discovery подтвердит, что серверу достаточно уже существующего payload и он не валидирует отдельно конфликт payment_type vs offer_id.
  Если такой конфликт есть, не создавать новый path, а сделать **минимальный add-only patch** в текущем admin-create-payment-link/createPaymentCheckout, чтобы сервер принимал effective тип из offer. Это не новый путь, а нормализация контракта.
3. В fallback-стратегии добавь ещё одно правило:
  если exact-match нет, но выбран fallback другого типа, UI не должен это делать скрытно. Нужно явное русское сообщение уровня:
  &nbsp;
  - «Для этого тарифа нет кнопки типа “Разовая оплата”. Будет использована основная кнопка типа “Подписка”».
    И только после этого разрешать создание ссылки.
  &nbsp;
4. В STOP-кейсе уточни два разных сценария:
  &nbsp;
  - **несколько active offers без primary** → блокируем;
  - **нет ни одного active offer** → блокируем с отдельной ошибкой.
    Это разные причины, их надо разводить и в UI, и в финальном отчёте.
  &nbsp;
5. Добавь в план обязательный UX-пункт по дизайну диалога:
  &nbsp;
  - вернуть крупные переключатели Разовая оплата / Подписка;
  - восстановить визуальные белые секции/карточки, как вы и хотели;
  - привести блок Кнопка оплаты, Сумма, Комментарий, preview-ссылки к единому стилю диалога, а не серому однотонному полотну.
  &nbsp;
6. В баге с суммой зафиксируй не только исправление /100, но и полный контроль единиц измерения по всей цепочке:
  &nbsp;
  - tariff_offers.amount в UI = BYN;
  - customAmount в UI = BYN;
  - в payload на сервер уходит Math.round(amount * 100);
  - на сервере amount/100 используется один раз.
    В отчёте нужен отдельный proof «150 → 150, не 1.5».
  &nbsp;
7. Для DoD усили пункт про offer_id:
  &nbsp;
  - не только каждый **order**, но и каждая созданная через этот диалог **ссылка/запрос** должны иметь детерминированный offer_id;
  - недопустим сценарий, где UI визуально выбрал fallback, а в БД/заказ ушёл offer_id = NULL.
  &nbsp;
8. В test matrix добавь отдельный кейс:
  &nbsp;
  - тариф с **одной** активной кнопкой и radio противоположного типа;
  - убедиться, что fallback берёт single active offer, тип синхронизируется, ссылка создаётся, snapshot создаётся.
  &nbsp;
9. В test matrix добавь ещё один обязательный кейс на цену:
  &nbsp;
  - offer.amount = 150;
  - UI показывает 150;
  - override на 200;
  - в orders_[v2.final](http://v2.final)_price = 200, но offer_id и snapshot остаются от выбранной кнопки.
  &nbsp;
10. В пункте про Telegram/уведомления уточни, что тестировать надо **только те сценарии, которые уже реально завязаны на этот admin-flow**.
  Не делать искусственный scope creep. Но обязательно проверить, что текущие существующие уведомления/доступы не сломались от fallback-offer.
11. Добавь в финальный отчёт обязательный mapping по каждому тесту:
  radio selection → resolved offer source (exact/primary/single) → effective payment type → offer_id → order_id → final_price → snapshot present/absent.
  Это снимет всю путаницу, где пользователь выбрал одно, а система отправила другое.
12. Отдельно зафиксируй запрет на “тихий выбор” неосновной кнопки при наличии primary.
  Приоритет должен быть строго:
  exact active → primary active → single active → STOP, без эвристик по имени, цене, created_at и т.п.

&nbsp;

&nbsp;

В остальном план собран правильно.

&nbsp;

План: финальная стабилизация Admin Payment Link

### Discovery (зафиксировано)

**Один canonical payment-path подтверждён.** Все ссылки админки идут через:
`AdminPaymentLinkDialog` → `admin-create-payment-link` → `_shared/createPaymentCheckout` → bePaid → `bepaid-webhook` → `grant-access-for-order` + CRM routing + уведомления + Telegram. Никакой параллельной ветки нет и создавать не будем.

**Источник `offer.amount`:** в `tariff_offers` хранится как **decimal в BYN** (например `200.00`, `150.00`). На сервере `createPaymentCheckout` ожидает `amount` **в копейках** (`amountByn = amount/100`). Клиент передаёт `Math.round(amount * 100)` — корректно.

### Найденные дефекты


| #   | Дефект                                           | Где                                    | Корень                                                                                                                                   |
| --- | ------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Цена ÷ 100 дважды**                            | `AdminPaymentLinkDialog.tsx:213`       | `setCustomAmount(String(Number(primary.amount) / 100))` — `offer.amount` уже в BYN, делить нельзя. Поэтому 150 BYN показывается как 1.5. |
| 2   | Мелкий radio для типа оплаты                     | строки 486–512                         | `RadioGroup` с маленькими dot'ами вместо крупных карточек.                                                                               |
| 3   | Блокировка создания при отсутствии exact-кнопки  | строки 344–350, 541–545                | `!selectedOfferId` блокирует submit; UI показывает "В тарифе нет такой кнопки" вместо fallback.                                          |
| 4   | Нет fallback-стратегии на canonical offer тарифа | `AdminPaymentLinkDialog` логика выбора | Если нет offer нужного типа — `offer_id` уходит пустым → `crm_routing_snapshot` не пишется → нарушается DoD прошлого спринта.            |


### Fallback-стратегия выбора offer (canonical, без нового path)

Приоритет резолва **на клиенте**, при выбранных `tariff_id` + `payment_type`:

1. **Exact match** — активный `pay_now` offer с совпадающим типом (`recurring.is_recurring === (paymentType==='subscription')`).
2. **Primary fallback** — `is_primary=true` среди активных offers тарифа (любого типа). Тип оплаты в этом случае берётся из самого offer (его `recurring.is_recurring`), а radio-переключатель **синхронизируется** с фактическим типом offer и блокируется с подсказкой "тариф настроен только на N".
3. **Single active fallback** — если активный offer ровно один — использовать его (с тем же sync paymentType).
4. **STOP** — если несколько активных без primary и без exact-match — показать чёткую ошибку "В тарифе несколько кнопок без основной — выберите вручную или назначьте основную в настройках тарифа". **Не угадывать.**

В ответе на каждый submit `offer_id` **гарантированно передан** → snapshot создаётся → CRM routing работает.

### Изменения в коде

**1. `src/components/admin/AdminPaymentLinkDialog.tsx**`

- Удалить `/100` при автоподстановке суммы (строка 213).
- Заменить мелкий `RadioGroup` на крупный сегментированный переключатель (две большие карточки-кнопки, как на сайте).
- Ввести функцию `resolveCanonicalOffer(allOffers, paymentType)` с приоритетами выше; вернуть `{offer, source: 'exact'|'primary'|'single', mismatchedType?}`.
- Если выбран canonical offer другого типа — синхронизировать `paymentType` с offer и показать info-баннер ("в тарифе доступна только разовая/подписочная — выбрана основная кнопка").
- Убрать `!selectedOfferId` из `isCreateDisabled` **только** в случае когда мы успешно выбрали fallback. STOP-кейс блокирует с понятной ошибкой.
- Сумма по умолчанию = `Number(canonical.amount)` (без деления).

**Никаких изменений в edge functions.** `admin-create-payment-link`, `_shared/create-payment-checkout.ts`, `bepaid-webhook`, `grant-access-for-order`, `applyCrmStageOnTerminal` остаются как есть.

### Discovery checklist (подтвердить, что fallback ничего не ломает)

- ✅ `createPaymentCheckout` принимает `offer_id` опционально, `resolveOfferRouting` корректно резолвит snapshot при наличии offer.
- ✅ `bepaid-webhook` читает snapshot из `orders_v2.meta.crm_routing_snapshot` (фикс прошлого спринта).
- ✅ `grant-access-for-order` идемпотентен и не зависит от типа offer.
- ✅ Telegram-уведомления и продление доступов триггерятся от `orders_v2.status='paid'` независимо от того, как выбран offer.
- ✅ `payment_links` таблица используется только в `public-checkout` (отдельный flow `/pay/:token`) — admin-flow её не трогает.

### Test matrix (с моей учётки `7500084@gmail.com` через `test-payment-complete`)

Для каждого сценария: создать ссылку → симулировать оплату → проверить order, snapshot, stage, audit, доступ, уведомление.


| #   | Сценарий                                              | Ожидание                                                                                         |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Тариф с exact one_time offer + radio one_time         | exact match, snapshot есть, stage→success                                                        |
| 2   | Тариф с exact subscription offer + radio subscription | exact match, snapshot есть, stage→success, sub создан                                            |
| 3   | Тариф только с подписочным offer + radio one_time     | fallback на primary subscription, paymentType пересинхронизирован, баннер показан, snapshot есть |
| 4   | Тариф только с разовым primary + radio subscription   | fallback на разовый primary, sync, snapshot есть                                                 |
| 5   | Тариф с несколькими offers без primary                | STOP, ошибка в UI, ссылка не создана                                                             |
| 6   | Override суммы (150 → 200) на exact offer             | order.final_price=200, offer_id сохранён, snapshot есть                                          |
| 7   | Отправка ссылки в Telegram клиенту                    | сообщение пришло с правильной суммой                                                             |


### DoD (расширенный)

- Цена в форме отображается без деления на 100 (150 BYN = 150).
- Radio заменён на крупные сегменты в стиле сайта.
- Каждый созданный order имеет `offer_id IS NOT NULL` и `meta.crm_routing_snapshot IS NOT NULL`.
- Fallback-цепочка `exact → primary → single → STOP` работает предсказуемо, STOP не создаёт ссылку.
- Не введён ни один новый edge function, ни одна новая таблица, ни одна новая ветка checkout.
- `admin-create-payment-link`, `_shared/create-payment-checkout.ts`, `bepaid-webhook` — не модифицированы.
- Прогон test matrix (#1–#7) на моей учётке с финальным mapping `сценарий → offer_id → order_id → webhook → stage → доступ → уведомление`.
- Финальный отчёт содержит отдельный блок: **"Решение не создало новый payment-path"** со ссылками на неизменённые файлы.

### Итоговый scope

- **1 файл** правится: `src/components/admin/AdminPaymentLinkDialog.tsx`.
- **0 edge functions** изменяется.
- **0 миграций** БД.
- **0 новых таблиц/RPC**.