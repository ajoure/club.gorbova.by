## да, согласен, с учетом правок:

План точный и узкий. Backend, данные и боевой режим не трогаем.

## 1. Состав изменений

Изменить четыре production-файла, указанные в плане:

1. `src/hooks/useUnifiedPayments.tsx`
2. `src/components/admin/payments/PaymentsFilters.tsx`
3. `src/components/admin/payments/PaymentsTable.tsx`
4. `src/utils/paymentDocumentUi.ts`

Текущее скрытие действительно находится в query: загружаются только `bepaid` и `stripe`, а допустимые origin не включают `rr_installment`.

Дополнительно обновить существующий `.lovable/plan.md` отчётом. Поэтому DoD сформулировать так:

```text
4 production-файла + .lovable/plan.md
Других source/backend/migration файлов не изменено

```

## 2. Origin

Использовать точное фактическое значение:

```text
rr_installment

```

Добавить его в обе ветки:

```ts
includeImport === true
includeImport === false

```

Не вводить новый origin `rr`.

## 3. Провайдер

Фильтр сейчас действительно содержит только `all`, `bepaid`, `stripe`. Добавление `rr` необходимо.

Значения:

```text
value = "rr"
label = "Ресурс Развития"

```

В таблице добавить явный badge. Сейчас неизвестные провайдеры отображаются generic fallback, поэтому данные технически могли бы показаться как `rr`, но без нормального названия.

## 4. Статистика

Проверку статистики сформулировать точнее:

```text
Провайдер = Ресурс Развития
→ карточки показывают только показатели RR

Провайдер = Все
→ карточки показывают bePaid + Stripe + RR

Провайдер = bePaid или Stripe
→ RR не входит в карточки

```

Не проверять формулировкой «суммы увеличиваются при включении фильтра RR»: при выборе только RR сумма может быть меньше общей. Карточки считают данные из переданного массива и не имеют собственного ограничения по провайдеру.

## 5. Runtime reconciliation

При периоде, покрывающем все существующие RR-платежи, зафиксировать:

```text
DB payments_v2 provider=rr origin=rr_installment: 12
UI filter provider=rr: 12
уникальных payment.id в UI: 12
дублей после объединения queue + payments_v2: 0

```

Также сверить суммы по валютам:

```sql
SELECT currency, count(*), sum(amount)
FROM payments_v2
WHERE provider = 'rr'
  AND origin = 'rr_installment'
  AND paid_at BETWEEN ...
GROUP BY currency;

```

Результат должен совпасть с карточкой «Успешные» при фильтре RR с учётом статусов платежей.

## 6. Конкретный audit proof

Найти в UI платёж заказа:

```text
33119dd5-8a92-4533-ab20-fe0f9163ab8b

```

И зафиксировать:

- полный `payment_id`;
- provider=`rr`;
- origin=`rr_installment`;
- статус;
- сумму и валюту;
- номер сделки;
- продукт и тариф;
- контакт.

Это даст связь с уже проверенным canonical RR-order.

## 7. CSV

Перед изменениями подтвердить, что текущий export:

- экспортирует `filteredPayments`;
- содержит колонку provider.

Если оба условия уже выполняются — код экспорта не менять.

Если provider в CSV отсутствует либо export берёт другой массив, не расширять scope молча. Вернуть короткий blocker-report, поскольку тогда потребуется пятый production-файл.

## 8. Документы

В `paymentDocumentUi.ts` добавить только label:

```ts
rr: "Ресурс Развития"

```

Не добавлять генерацию чека, receipt URL или отдельную логику документов РР.

## Финальный статус после проверки

```text
PATCH-RR-PAYMENTS-VISIBILITY-V1: VERIFIED, PASS
RR payments in DB: 12
RR payments visible in /admin/payments: 12
Provider filter: VERIFIED
Stats parity: VERIFIED
CSV visibility: VERIFIED
RR battle mode: UNCHANGED, TEST
Backend/RPC/migrations: UNCHANGED


PATCH-RR-PAYMENTS-VISIBILITY-V1
```

Сделать записи Ресурса Развития видимыми в `/admin/payments`. Никакой другой логики, никакого включения боевого режима, никакой миграции данных.

### Diagnose (подтверждено чтением кода/БД)

- Данные в БД уже есть: `payments_v2` содержит 12 строк с `provider='rr'`, `origin='rr_installment'`.
- Скрытие происходит в двух местах:
  1. `src/hooks/useUnifiedPayments.tsx:234` — `.in("provider", ["bepaid", "stripe"])` исключает `rr`.
  2. Там же строки 240 и 244 — фильтр `origin` не содержит `rr_installment`, поэтому даже при расширении provider записи не пройдут.
- UI-фильтр «Провайдер» (`src/components/admin/payments/PaymentsFilters.tsx:17-27`) содержит только `all|bepaid|stripe`.
- Рендер бейджа в таблице (`src/components/admin/payments/PaymentsTable.tsx:661-679`) уже имеет fallback ветку и корректно отдаст `rr`, но без стилизации. Добавим явную ветку с меткой «Ресурс Развития».
- Утилита `providerLabel` (`src/utils/paymentDocumentUi.ts:96-103`) — used в PaymentDocumentsDrawer/Card. Добавим `rr → "Ресурс Развития"` для консистентности.

Верхние карточки статистики (`PaymentsTabContent`) считаются из уже загруженного массива и провайдер-агностичны — правки не требуют.

### План (backend не трогаем)

1. `**src/hooks/useUnifiedPayments.tsx**`
  - Строка 234: `.in("provider", ["bepaid", "stripe", "rr"])`.
  - Строка 240 (ветка `includeImport`): добавить `"rr_installment"` в список.
  - Строка 244 (основная ветка): добавить `origin.eq.rr_installment` в OR-цепочку.
  - Комментарии PATCH-LIVE-2 обновить одной строкой-примечанием «PATCH-RR-PAYMENTS-VISIBILITY-V1: added rr».
2. `**src/components/admin/payments/PaymentsFilters.tsx**`
  - Добавить `<SelectItem value="rr">Ресурс Развития</SelectItem>` в селект «Провайдер».
3. `**src/components/admin/payments/PaymentsTable.tsx**` (case `provider`, ~строки 661-679)
  - Добавить ветку `prov === 'rr'` с бейджем «Ресурс Развития» (нейтральный outline, например `border-amber-500 text-amber-600 dark:border-amber-400 dark:text-amber-300`, чтобы визуально отличать от bePaid/Stripe).
4. `**src/utils/paymentDocumentUi.ts**`
  - В `PROVIDER_LABEL_RU` добавить `rr: "Ресурс Развития"`.

### Что НЕ делаем

- Не трогаем backend, RPC, edge functions, миграции.
- Не меняем `mode`, credentials, webhook, healthcheck.
- Не переключаем боевой режим — это отдельный этап go-live, не входит в этот патч.
- Не создаём новых тестовых заявок.

### Verify

- Открыть `/admin/payments`, период должен покрывать даты существующих 12 RR-записей.
- В таблице появляются строки с бейджем «Ресурс Развития», статус, сумма, валюта, контакт, сделка, продукт/тариф отображаются штатно.
- Фильтр «Провайдер» → «Ресурс Развития» оставляет только эти строки; «bePaid» и «Stripe» их не показывают; «Все» показывает все три провайдера.
- Верхние карточки статистики учитывают RR-строки (проверить, что суммы увеличиваются при включении RR через смену провайдер-фильтра).
- Экспорт CSV содержит RR-строки с провайдером `rr`.

### DoD

- 4 файла изменены, никаких других правок.
- Build/типы проходят.
- В UI виден существующий audit-платёж РР без создания новой заявки.
- Боевой режим по-прежнему выключен; включение — отдельная задача после подтверждения credentials и webhook.