# План в целом корректный. Есть две правки, которые рекомендую внести до выполнения.

### 1. Не выполнять blind UPDATE по `offer_type='invoice'`

Вместо:

```sql
UPDATE public.tariff_offers
SET payment_method='bank_transfer'
WHERE offer_type='invoice'
...

```

лучше использовать guarded UPDATE по трём конкретным UUID и ожидаемому текущему состоянию:

```sql
WHERE id IN (...)
  AND offer_type='invoice'
  AND payment_method='full_payment'

```

и затем проверить, что обновлены **ровно 3 строки**. Если обновлено 0–2 или больше 3 — остановить релиз.

---

### 2. Production E2E дополнить проверкой network

Помимо открытия `InvoiceCheckoutDialog`, проверить, что:

- запрос уходит именно в `invoice-checkout-issue`;
- **не происходит** обращений к:
  - `bepaid-create-token`;
  - `payment-dialog-create-bridge-link`;
  - `direct-charge`;
  - другим card-flow endpoint'ам.

Это подтвердит, что routing действительно переключился на invoice-flow, а не только изменился UI.

---

Кроме этого, план выглядит согласованным с архитектурой.

Итог:

- ✅ исправление `payment_method='bank_transfer'`;
- ✅ единый backend contract `offer_type_invoice_not_chargeable`;
- ✅ publish **до** data-fix;
- ✅ guarded UPDATE только трёх офферов;
- ✅ production E2E;
- ✅ документация по CHECK constraint и rollback.

После выполнения такого плана спринт можно считать закрытым при условии успешного прохождения всех проверок.

&nbsp;

План: закрытие DoD спринта `offer_type='invoice'`

## Статус проблем (подтверждено)

- В БД **3 оффера** с `offer_type='invoice'` имеют `payment_method='full_payment'` — противоречит канону.
- В `AdminProductDetailV2.tsx` на строках **345, 508, 538, 777–781, 914, 2051** дефолт/normalization всегда пишут `full_payment`, включая ветку `offer_type='invoice'` (стр. 2051).
- Guards в edge-функциях реализованы только для `bepaid-create-token` и `direct-charge`. Не покрыты: `admin-create-public-link`, `payment-dialog-create-bridge-link`, `public-create-installment-link`, `public-rr-installment-initiate`, `bepaid-auto-process`.
- Frontend не опубликован — рассинхрон с БД (data-fix уже применён).

## Порядок релиза (без нарушений)

```
1. code fixes (frontend + edge)         [до publish]
2. edge deploy                          [автоматически]
3. tsgo verify                          [gate]
4. frontend publish + live commit       [gate]
5. guarded data-fix для 3 офферов       [payment_method]
6. production E2E + backend smoke       [DoD]
7. финальный отчёт                      [DoD]
```

Data-fix уже применён по `offer_type`, но `payment_method` ещё не исправлен → выполняем шаг 5 как **UPDATE только `payment_method**` ПОСЛЕ publish (иначе противоречивое состояние сохраняется).

## Шаг 1. Frontend: канон `payment_method='bank_transfer'` для invoice

Файл `src/pages/admin/AdminProductDetailV2.tsx`:

- **Строка 2051** (переключение типа на `invoice`): `payment_method: "bank_transfer"` вместо `"full_payment"`.
- **Save-normalization (строки 777–781)**: добавить ветку — если `offer_type === "invoice"` → форсим `payment_method = "bank_transfer"` (перед `pay_now`-веткой).
- **Load-defaults (строки 508, 538, 914)**: если у загружаемого оффера `offer_type='invoice'` и `payment_method !== 'bank_transfer'` — приводить к `bank_transfer` в состоянии формы (без автосохранения; корректная нормализация при следующем сохранении).
- Postflight assertion в admin UI (dev-warning в консоли, необязательно): `offer_type==='invoice' && payment_method!=='bank_transfer'` → `console.warn`.

## Шаг 2. Backend guards: единый контракт ошибки

Во все перечисленные функции добавить проверку сразу после загрузки оффера из БД:

```ts
if (offer?.offer_type === "invoice") {
  return new Response(
    JSON.stringify({ error: "offer_type_invoice_not_chargeable" }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
```

Файлы:

1. `supabase/functions/admin-create-public-link/index.ts`
2. `supabase/functions/payment-dialog-create-bridge-link/index.ts`
3. `supabase/functions/public-create-installment-link/index.ts`
4. `supabase/functions/public-rr-installment-initiate/index.ts`
5. `supabase/functions/bepaid-auto-process/index.ts` — только если функция получает `offer_id` до charge (проверить при реализации; если оффер не читается — записать в отчёт как N/A с обоснованием).

Существующие guards в `bepaid-create-token` и `direct-charge` — оставить.

## Шаг 3. Проверки перед publish

- `tsgo` на весь проект (гейт).
- Edge deploy — автоматом после push edge-функций.
- Curl-smoke каждой из 6 функций с фиктивным `offer_id` invoice-оффера → ожидаем `400 offer_type_invoice_not_chargeable`.

## Шаг 4. Frontend publish + live commit

- Публикация через `preview_ui--publish`.
- Зафиксировать точный commit hash и live URL в отчёте.

## Шаг 5. Guarded data-fix `payment_method`

Выполняется **после** подтверждённого publish. SQL:

```sql
UPDATE public.tariff_offers
SET payment_method = 'bank_transfer'
WHERE offer_type = 'invoice'
  AND payment_method <> 'bank_transfer'
  AND id IN (
    'b6476800-cc42-4332-836d-5e63ccc83c47',
    'd749583b-86ba-44cc-9d9c-bd0e38a70137',
    '4c6d6110-5c9b-419c-82ef-524dfe44ecc1'
  );
```

Verify: `SELECT id, offer_type, payment_method FROM tariff_offers WHERE offer_type='invoice'` → все три с `bank_transfer`.

## Шаг 6. Production E2E (Playwright на live URL)

На `https://gorbova.by/cb` для трёх тарифов (Бухгалтер, Гл. бухгалтер, Бизнес-леди):

1. Кнопка «Оплатить от юрлица/ЮЛ» → открывается `InvoiceCheckoutDialog`, не `PaymentDialog`.
2. В network — запрос на `invoice-checkout-issue` с корректным `offer_id` (сверка с БД).
3. Кнопки «Оплатить обучение» и «Рассрочка» → открывают `PaymentDialog` (регрессия card-flow и installment-flow).
4. Curl-smoke: POST в `admin-create-public-link`, `payment-dialog-create-bridge-link`, `public-create-installment-link`, `public-rr-installment-initiate`, `bepaid-create-token`, `direct-charge` с invoice `offer_id` → все возвращают `400 offer_type_invoice_not_chargeable`.
5. Admin `/admin/products-v2/3e43fb28-…?tab=offers` — три оффера показываются как «Сформировать счёт», вкладки «Оплата»/«Автопродление» скрыты.

## Шаг 7. Отчёт DoD (обязательные артефакты)

Отчёт по форме:

```
CODE IMPLEMENTATION      : PASS  (файлы: …)
TSGO                     : PASS  (0 errors)
EDGE DEPLOY              : PASS  (список функций + timestamp)
FRONTEND PUBLISH         : PASS  (live URL, commit hash)
DATA FIX                 : PASS  (3 rows updated, verify query result)
PRODUCTION E2E           : PASS  (3 invoice buttons, screenshots)
CARD-FLOW REGRESSION     : PASS  (Оплатить обучение)
INSTALLMENT REGRESSION   : PASS  (Рассрочка)
ADMIN UI                 : PASS  (screenshots)
BACKEND SMOKE            : PASS  (6 endpoints × 400 response)
CHECK CONSTRAINT         : имя, новое определение, rollback SQL
SPRINT STATUS            : PASS
```

## Шаг 8. CHECK constraint — документация

Приложить в отчёт (уже есть миграция `20260717071715_…sql`):

- имя constraint (`tariff_offers_offer_type_check`);
- новое определение (список допустимых значений включая `invoice`);
- подтверждение сохранности `pay_now`, `trial`, `preregistration`, `lead`, `bank_installment`;
- rollback SQL (DROP + ADD старого определения).

## Технические детали

- Все изменения обратно совместимы: старые офферы без `offer_type='invoice'` не затрагиваются.
- `document_scenarios.payment_channels=['bank_transfer']` теперь согласован с `payment_method='bank_transfer'`.
- Между шагами 4 и 5 существует временное окно, где frontend уже понимает `invoice`, а `payment_method` ещё `full_payment` — это безопасно, так как guards в edge-функциях уже отсекают charge-попытки по `offer_type`, а `InvoiceCheckoutDialog` использует `payment_method` только для отображения (не для роутинга).

## Открытые вопросы (не блокируют — использую дефолты)

1. `bepaid-auto-process` — если функция читает оффер: добавляем guard. Если работает исключительно с уже подготовленным charge — фиксируем N/A с обоснованием. Проверю при реализации.
2. Локальный несовпадающий `tariff.code` (`trf_…` вместо `buh/gl_buh/biz-l`) — отдельный follow-up тикет в `.lovable/backlog/`, вне текущего DoD.