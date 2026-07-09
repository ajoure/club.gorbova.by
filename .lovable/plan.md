# да, согласен, с учетом правок:

## **1. Sprint 2 можно выполнять, но только как UI/meta sprint**

Scope корректный:

```txt
AdminProductDetailV2.tsx only
без edge functions
без миграций
без orders_v2/payments_v2/provider_events/domain_events
без public production flow
без rr-webhook/installment-initiate
```

## **2. Runtime proof через новую кнопку — только inactive**

Пункт с созданием новой кнопки нужно уточнить. Нельзя создавать активную тестовую кнопку на публичном продукте, даже временно.

Заменить:

```txt
создать новую кнопку с типом «Рассрочка банка», сохранить
```

на:

```txt
создать новую тестовую кнопку с типом «Рассрочка банка» только в is_active=false, сохранить, проверить БД, затем удалить.
```

Если UI не позволяет создать inactive сразу — не создавать тестовую кнопку на публичном тарифе. Тогда proof делать через существующую `bank_installment`-запись без изменения публичного поведения.

## **3. Snapshot должен быть before/after после cleanup**

Так как тестовая кнопка создаётся и удаляется, итоговый snapshot должен быть именно после удаления.

Добавить:

```txt
Снять snapshot:
1. до теста;
2. после создания тестовой кнопки;
3. после удаления тестовой кнопки.

Итоговый after-cleanup должен совпадать с before по count tariff_offers.
```

Боевые таблицы проверить не только count, но и отсутствие новых строк за окно теста:

```sql
SELECT 'orders_v2' AS t, count(*), max(created_at), max(updated_at) FROM orders_v2
UNION ALL SELECT 'payments_v2', count(*), max(created_at), max(updated_at) FROM payments_v2
UNION ALL SELECT 'provider_events', count(*), max(created_at), max(updated_at) FROM provider_events
UNION ALL SELECT 'domain_events', count(*), max(created_at), max(updated_at) FROM domain_events;
```



## **4. Не затирать существующий**

`meta.bank_installment`

В `onValueChange` и save обязательно сохранить все старые поля:

```txt
external_link
link_label
message_html
installment.max_months
lead_form
acquiring
recurring
любые неизвестные ключи meta
```

Нельзя пересобрать `meta` только из новых полей.





## **5.**

`payment_method` **для legacy-записей не менять**

Для новых `bank_installment` допустимо `payment_method='full_payment'`, но для существующих записей нельзя автоматически менять старое значение.

Добавить правило:

```txt
Если открыта существующая bank_installment-запись и у нее payment_method='bank_installment', сохранить это значение как есть, если пользователь явно не менял другие поля.
```





## **6. Read-only**

`currency=BYN` **допустимо только для Sprint 2**

Зафиксировать:

```txt
В Sprint 2 currency='BYN' только meta-настройка для будущего РР-flow.
Production amount/currency пока не используются для createOrder.
```

## **7. Public visual check — только legacy external_link**

Публичная страница не должна начать вызывать новый РР-runtime. Проверять нужно именно это:

```txt
Публичная кнопка bank_installment по-прежнему открывает meta.bank_installment.external_link / legacy fallback.
Никаких вызовов installment-initiate, rr-webhook, rr-test-* нет.
```

## **8. Формат отчета после выполнения**

```txt
Отчет о выполненной работе: Sprint 2 — add-only UI и meta-поля для кнопки «Рассрочка банка»
```

## **Итог**

План можно выполнять после этих уточнений. Главное: **не активировать новую кнопку на публичном продукте**, не затирать legacy `meta`, не менять production-flow и не создавать edge/backend wiring в этом спринте.

&nbsp;

План: Sprint 2 — add-only UI и meta-поля для кнопки «Рассрочка банка»

## Цель

Дать возможность через UI редактора кнопки (`AdminProductDetailV2.tsx`) создавать/редактировать оффер типа `bank_installment` и хранить в `meta` add-only настройки будущего РР-flow (`installment_provider`, `installment_currency`, `rr_mode`). Никаких боевых edge-функций, orders_v2/payments_v2 и production-flow не трогаем.

## Файлы, которые будут изменены (только фронт)

1. `src/pages/admin/AdminProductDetailV2.tsx` — единственный редактируемый файл.

Никакие другие файлы (шаблоны кнопок на публичных страницах, edge functions, миграции) не меняются.

## Изменения в `AdminProductDetailV2.tsx` (add-only)

### 2.1. Расширить тип `offerForm.offer_type`

Строка 331 сейчас:

```ts
offer_type: "pay_now" as "pay_now" | "trial" | "preregistration" | "lead",
```

Расширить объединение до:

```ts
offer_type: "pay_now" as "pay_now" | "trial" | "preregistration" | "lead" | "bank_installment",
```

Плюс аналогично в другом месте (открытие диалога — `openOfferDialog`, ~ строки 495, 525). Существующая запись `bank_installment` в БД теперь корректно грузится в форму (сейчас грузится, но TS-тип неточен — легально add-only).

### 2.2. Добавить пункт селекта «Тип кнопки»

Строки 1907–1911 сейчас:

```tsx
<SelectItem value="pay_now">Оплата (полная стоимость)</SelectItem>
<SelectItem value="trial">Trial (пробный период)</SelectItem>
<SelectItem value="preregistration">Предзапись (привязка карты)</SelectItem>
<SelectItem value="installment">Рассрочка</SelectItem>
<SelectItem value="lead">Заявка (без оплаты)</SelectItem>
```

После `lead` добавить:

```tsx
<SelectItem value="bank_installment">Рассрочка банка</SelectItem>
```

Значение селекта (строки 1848–1852) уже возвращает `offerForm.offer_type` для нестандартных случаев, поэтому `bank_installment` будет корректно подсвечиваться.

### 2.3. Ветка обработки выбора `bank_installment`

В `onValueChange` селекта (строки 1853–1900) добавить `else if (v === "bank_installment") { ... }`:

- `offer_type: "bank_installment"`
- `payment_method: "full_payment"` (не путать с легаси-значением `payment_method='bank_installment'` — оно старое, оставляем как есть если уже стоит; для новых записей ставим `full_payment`, чтобы не пересекаться с bepaid installment).
- `button_label`: если пусто или дефолтное — «Оплатить в рассрочку от банка». Иначе не переопределяем.
- `requires_card_tokenization: false`
- `installment_count / interval / delay: null`
- `meta`: merge без удаления существующих ключей, добавить:
  ```ts
  bank_installment: {
    ...(prev.meta?.bank_installment || {}),
    installment_provider: prev.meta?.bank_installment?.installment_provider ?? 'rr',
    currency: prev.meta?.bank_installment?.currency ?? 'BYN',
    rr_mode: prev.meta?.bank_installment?.rr_mode ?? 'payment_url',
    // external_link НЕ трогаем — это старый fallback
  }
  ```

### 2.4. Секция настроек «Рассрочка банка» на вкладке (не обязательная UI-панель, минимальный вариант)

Добавить один Card, показываемый только при `offerForm.offer_type === 'bank_installment'`, размещённый рядом с блоком настроек рассрочки (после строки 2003). Содержит только чтение/редактирование add-only полей:

- Read-only badge: «Провайдер: Ресурс Развития» (значение зашито `installment_provider='rr'`, поле не редактируемое в Sprint 2).
- Read-only badge: «Валюта: BYN».
- Read-only badge: «Режим: внешний payment_url».
- Info-alert: «Runtime-контур РР ещё не включён. Кнопка сейчас работает по старой ссылке `meta.bank_installment.external_link` (fallback).»
- Input «Fallback URL (external_link)» — редактирование существующего `meta.bank_installment.external_link` (это уже используется старым flow — не ломаем).

Никаких кнопок «Тестировать РР», «Создать заказ», «Отправить webhook» на этой панели быть НЕ должно.

### 2.5. Ветка сохранения (submit)

В функции сохранения оффера (строки ~662–685) поле `payment_method` для `bank_installment` не форсировать — писать то, что в форме (`payment_method: offerForm.payment_method || 'full_payment'`). Условие `offer_type === "pay_now" ? offerForm.payment_method : "full_payment"` (строка 682) — добавить исключение для `bank_installment`, чтобы не затирать существующее значение.

## Что НЕ меняется

- `tariff_offers.offer_type` в БД — переименования нет, миграции нет.
- Публичный рендер `bank_installment` (`SitePageBySlug`, `TariffPricing`, `UniversalPricingSection`, `TariffCard`, `ProductLanding`, `LeadRequestDialog`, `LiveEventProductCta`) — не трогается.
- `src/lib/bankInstallment.ts` — не трогается; старый external_link продолжает работать как есть.
- Существующие 2 записи `bank_installment` в БД — не мигрируются, не скрываются, не редактируются автоматически.
- Никаких edge functions (`rr-webhook`, `rr-create-checkout`, `installment-initiate` и т.п.) не создаётся.
- `orders_v2 / payments_v2 / provider_events / entitlements` не пишутся.

## Порядок работы (Diagnose → Plan → Dry run → Execute → Verify)

1. Diagnose: закрыто в Sprint 1 discovery.
2. Plan: этот документ.
3. Dry run: перечисленные изменения выше — только TS-типы и JSX-элементы, миграций нет; риск = визуальный.
4. Execute: 3 точечных `line_replace` в `AdminProductDetailV2.tsx`.
5. Verify: перечислено ниже.

## Verify (runtime proof)

Runtime proof выполняем только на **одной выбранной кнопке одного тарифа** (тарифы для проверки — существующие `543940b1-99da-47f3-accc-671ad5b11afe` или `9bc81736-e7e5-48db-9925-b866427a98e1`; **работаем только с ОДНИМ**).

Snapshot до/после (обязательно, чтобы подтвердить no-op на боевых таблицах):

```sql
SELECT 'tariff_offers' AS t, count(*) FROM tariff_offers
UNION ALL SELECT 'orders_v2', count(*) FROM orders_v2
UNION ALL SELECT 'payments_v2', count(*) FROM payments_v2
UNION ALL SELECT 'provider_events', count(*) FROM provider_events
UNION ALL SELECT 'domain_events', count(*) FROM domain_events;
```

Ожидается: `orders_v2 / payments_v2 / provider_events / domain_events` — без изменений. `tariff_offers` — только UPDATE meta одной строки, count не меняется.

Шаги proof:

1. Открыть `/admin/products/<slug>` → выбрать тариф → «Редактировать кнопку» на существующей `bank_installment`-записи.
2. Убедиться, что селект показывает «Рассрочка банка» (значение подставлено корректно из БД).
3. В новом окне создать новую кнопку с типом «Рассрочка банка», сохранить.
4. Проверить в БД: `SELECT id, offer_type, payment_method, meta->'bank_installment' FROM tariff_offers WHERE id=<новый id>` — должно быть `offer_type='bank_installment'`, `meta.bank_installment.installment_provider='rr'`, `currency='BYN'`, `rr_mode='payment_url'`.
5. Открыть публичный URL продукта — убедиться, что старая ссылка на РР (`external_link`) по-прежнему работает (visual check).
6. **Затем удалить тестовую кнопку**, чтобы не оставлять мусор в prod. Существующие 2 записи не трогаем.

## Риски

- TS-компиляция: расширение union `offer_type` может задеть другие места. Найдено: типы объявлены локально в форме, глобальных типов offer_type в клиенте нет — только `usePublicProduct.tsx`, `TariffCard.tsx` (публичный рендер не трогаем).
- Устаревшая RadioGroup `bank_installment` в разделе «Способ оплаты» (строки 1993–1999) — оставляем как есть, помечена opacity-70; отдельный cleanup вне scope.

## Definition of Done Sprint 2

- В UI редактора кнопки появляется пункт «Рассрочка банка», выбор корректно записывает `offer_type='bank_installment'` + meta.bank_installment.{installment_provider='rr', currency='BYN', rr_mode='payment_url'}.
- Открытие существующей `bank_installment`-записи корректно подставляет значение в селект.
- Snapshot счётчиков `orders_v2 / payments_v2 / provider_events / domain_events` — без изменений.
- Существующий публичный flow по external_link не сломан (visual check на публичной странице).
- Runtime proof выполнен на одной тестовой кнопке, тестовая кнопка удалена.
- Ни одна edge function не создана и не изменена.