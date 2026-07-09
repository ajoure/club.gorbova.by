да, согласен, с учетом правок:

## **Добавить в Sprint 2.1 входные данные**

```txt
Для runtime proof использовать продукт:
«Ценный бухгалтер. Первая ступень 2.0».

На продукте должно быть 3 тарифа, и на каждом должна быть legacy-кнопка «Рассрочка от банка» / offer_type='bank_installment'.

Тестировать публичный flow сначала на первом тарифе.
```

## **Уточнить порядок проверки**

```txt
1. Найти продукт «Ценный бухгалтер. Первая ступень 2.0».
2. Найти все тарифы этого продукта.
3. Проверить, что у всех 3 тарифов есть bank_installment offer.
4. Зафиксировать в proof-отчете:
   - tariff_id;
   - tariff name;
   - tariff price / offer amount;
   - bank_installment offer_id;
   - external_link;
   - meta.bank_installment.
5. Начать runtime proof с первого тарифа.
```

## **Важная проверка по суммам**

Добавить отдельный пункт в SQL/admin proof:

```txt
Для всех 3 тарифов продукта «Ценный бухгалтер. Первая ступень 2.0» сверить:
- стоимость тарифа;
- сумму на кнопке «Рассрочка от банка»;
- amount в tariff_offers;
- публично отображаемую сумму на кнопке/карточке.

Ожидаемо: по каждому тарифу стоимость должна совпадать со своей настройкой, без подстановки общей/чужой суммы.
```

## **Runtime public proof**

```txt
Публичный runtime proof выполнить на первом тарифе:
- кнопка «Рассрочка от банка» отображается рядом с правильной стоимостью;
- клик открывает meta.bank_installment.external_link;
- нет запросов к installment-initiate / rr-*;
- публичный flow остается legacy external_link.
```

## **Остальные 2 тарифа**

По двум остальным тарифам в Sprint 2.1 достаточно read-only проверки:

```txt
- кнопка bank_installment существует;
- сумма соответствует тарифу;
- external_link/meta не повреждены;
- UI админки открывает «Рассрочка банка».
```

Кликать публичный flow по всем трем тарифам необязательно, если первый тариф доказал legacy-поведение, а остальные два проверены по данным и UI.

## **Что ответить подрядчику**

```txt
План Sprint 2.1 согласован с уточнением.

Для теста использовать продукт «Ценный бухгалтер. Первая ступень 2.0». Там должно быть 3 тарифа, и на каждом должна быть кнопка «Рассрочка от банка».

Нужно:
1. Найти этот продукт и все 3 тарифа.
2. По каждому тарифу зафиксировать tariff_id, название, стоимость, bank_installment offer_id, amount, external_link, meta.bank_installment.
3. Проверить, что сумма кнопки рассрочки соответствует именно своему тарифу.
4. Полный public runtime proof выполнить на первом тарифе:
   - клик по кнопке открывает legacy external_link;
   - нет запросов к installment-initiate / rr-*;
   - публичный flow не изменился.
5. По двум остальным тарифам достаточно read-only proof: кнопка есть, сумма правильная, meta/external_link не повреждены.
6. Ничего не сохранять и не менять, кроме удаления inactive тестовой кнопки, если она была создана ранее.

После этого Sprint 2.1 можно закрывать и переходить к плану Sprint 3.

План: Sprint 2.1 — runtime proof UI/meta кнопки «Рассрочка банка»
```

## Контекст

Sprint 2 по коду закрыт. Осталось доказать, что:

1. UI редактора корректно отображает «Рассрочка банка» и её info-card для существующей legacy-кнопки (2 записи в БД).
2. Публичный flow legacy `bank_installment` кнопки не сломан — по-прежнему открывает `meta.bank_installment.external_link` и не дёргает никаких РР-функций.
3. Никаких изменений данных в БД не произошло между «до» и «после» проверки.

Sprint 2.1 — **read-only proof**. Ни строчки кода не меняем.

## Шаги

### 1. SQL snapshot BEFORE

Через psql зафиксировать счётчики (в одном UNION ALL, чтобы совпадали до/после):

- `tariff_offers` total и WHERE `offer_type='bank_installment'`
- `orders_v2` total
- `payments_v2` total
- `provider_events` total и WHERE `provider='rr'`
- `domain_events` total
- `entitlements` total
- `access_grant_ledger` total

Плюс отдельно — dump `meta->'bank_installment'` для двух существующих `bank_installment`-офферов (id + external_link + installment_provider + rr_mode + currency), чтобы сравнить один к одному.

### 2. Admin UI proof (Playwright, /admin/products-v2/...)

Открыть страницу продукта, содержащего одну из двух `bank_installment` записей. Скриншоты:

- селект «Тип кнопки» показывает «Рассрочка банка»;
- Info-Card виден с badges «Провайдер: Ресурс Развития / Валюта: BYN / Режим: внешний payment_url»;
- поле `fallback_url` содержит существующий `external_link`;
- amber-alert про disabled runtime отображается.

Ничего не сохранять, форму закрыть без submit — proof только на чтение.

### 3. Public flow proof (Playwright, публичная страница тарифа)

Определить публичный URL для продукта с legacy `bank_installment` кнопкой (через `site_pages` / `site_domain_bindings` или ссылка от пользователя). Playwright headless:

- открыть публичную страницу;
- дождаться рендера pricing-секции;
- инспектировать DOM кнопки: `href` / `onClick` должен вести на `meta.bank_installment.external_link`;
- открыть DevTools Network (page.on('request')) → **отфильтровать по URL substring**: не должно быть ни одного запроса к `installment-initiate`, `rr-webhook`, `rr-test-*`, `rr-notification`, `rr-create-checkout`, `rr-*`;
- кликнуть по кнопке, проверить, что открывается именно `external_link` (target `_blank` или navigation);
- скриншот кнопки + скриншот перехода на внешний URL (или зафиксировать `page.on('popup')` URL).

### 4. SQL snapshot AFTER

Повторить те же запросы из шага 1. Diff должен быть **0** по всем счётчикам (никаких новых `orders_v2`, `payments_v2`, `provider_events`, `domain_events`, `entitlements`, `access_grant_ledger`, `tariff_offers`). `meta->'bank_installment'` для двух записей — byte-to-byte идентично снапшоту до.

### 5. Тестовая кнопка (если создавалась)

Проверить в БД, есть ли `tariff_offers` с `is_active=false` и `installment_provider='rr'` / `rr_mode='payment_url'`, созданные в рамках Sprint 2 discovery. Если есть — оставить `is_active=false` и УДАЛИТЬ через `supabase--insert` DELETE, зафиксировать before/after count.

### 6. Отчёт

Сохранить `.lovable/proofs/2026-07-09-rr-sprint-2.1-runtime-proof.md`:

- SQL snapshots before/after;
- скрины admin UI (пути);
- скрины/логи Network из Playwright с подтверждением отсутствия РР-вызовов;
- вывод: Sprint 2.1 закрыт → готовы к Sprint 3.

## Что НЕ делаем в Sprint 2.1

- Не пишем `installment-initiate`, `rr-webhook`, resolver, admin payments UI — это Sprint 3–5.
- Не меняем БД (кроме удаления одной тестовой inactive-кнопки, если она есть).
- Не трогаем `_shared/rr/*`, тестовый контур `rr_test_ledger` / `rr-test-*` / `rr-notification`.
- Не переименовываем `bank_installment`, не удаляем legacy `external_link` из meta.
- Не включаем `rr_mode='runtime'` ни на одной кнопке.
- Не трогаем `bepaid-webhook`, `bepaid-polling`, Stripe pipeline.
- Не задеваем master-sprint bePaid orphan recovery (он в бэклоге).

## Требуемые входные данные от пользователя

Прежде чем гонять Playwright по публичной странице, мне нужен адрес одной из двух легаси-кнопок `bank_installment` — какой продукт/тариф использовать для теста (или разрешение выбрать любой из двух по своему усмотрению — по `tariff_offers` найду сам).

## DoD

1. `.lovable/proofs/2026-07-09-rr-sprint-2.1-runtime-proof.md` создан со всеми артефактами.
2. Snapshot before === after по 7 счётчикам.
3. Network public flow не содержит запросов к `installment-initiate` / `rr-*`.
4. Legacy `external_link` в двух `bank_installment` записях не изменён.
5. Если была тестовая inactive-кнопка — удалена, count `tariff_offers` вернулся к discovery-снапшоту.
6. Отчёт зафиксирован → пользователь даёт добро на Sprint 3.