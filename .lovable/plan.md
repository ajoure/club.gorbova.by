## Проверка: **патч public PaymentDialog ещё не выполнен в `main**`

Последний commit в репозитории по-прежнему:

```text
53079793f5d489977a7a930201727efd1e2c2ff8
Исправил блокеры B8/B9

```

Нового commit после него нет.

Текущий `PaymentDialog.tsx` всё ещё содержит старую реализацию:

- в props есть только `installmentCount`;
- нет `installmentMaxMonths`;
- нет `installmentIntervalDays`;
- нет `installmentTotalAmountKopecks`;
- нет state `selectedInstallmentMonths`;
- нет публичного Select `2..max`;
- frontend по-прежнему передаёт максимум как выбранное значение:

```ts
selected_installment_months: installmentCount ?? null

```

Summary также остался старым:

```text
Рассрочка на {installmentCount} платежа
интервал 30 дней

```

То есть сейчас:

```text
B8 PUBLIC SELECTED N : FAIL

```

Передай ему следующее.

---

# Продолжай выполнение. Не останавливай спринт на новом планировании

План public PaymentDialog утверждён. Теперь его нужно **реализовать, зафиксировать commit и сразу вернуться к основному спринту**.

## 1. Закрыть узкий public PaymentDialog corrective

Обязательные изменения:

```text
src/components/payment/PaymentDialog.tsx

```

Добавить:

```ts
installmentMaxMonths?: number | null;
installmentIntervalDays?: number | null;
installmentTotalAmountKopecks?: number | null;

```

Legacy:

```ts
installmentCount?: number | null;

```

оставить только как fallback:

```ts
const maxMonths =
  installmentMaxMonths ??
  installmentCount ??
  null;

```

Добавить:

```ts
const [selectedInstallmentMonths, setSelectedInstallmentMonths] =
  useState<number | null>(null);

```

Поведение:

```text
max=2
→ N=2 автоматически;
→ Select можно скрыть;

max>2
→ N=null при открытии;
→ показать Select 2..max;
→ кнопка оплаты disabled до выбора;
→ текст «Выберите количество платежей».

```

Не передавать maximum как выбранный срок.

В backend request:

```ts
selected_installment_months: selectedInstallmentMonths

```

Перед вызовом:

```ts
if (!selectedInstallmentMonths) return;

```

## 2. Summary и расчёт

Использовать клиентский:

```text
src/lib/calculateInstallmentPlan.ts

```

Не создавать ещё один `Math.ceil`-calculator внутри компонента.

Показывать:

```text
Количество платежей: N
Один платёж: X BYN
Итоговая сумма рассрочки: Y BYN
Разница из-за округления: +Z BYN
Первый платёж сегодня, далее каждые D дней

```

При `delta=0` строку разницы скрывать.

Расчёт:

```text
100 / 3  → 34 × 3 = 102, delta +2
1000 / 12 → 84 × 12 = 1008, delta +8
1650 / 2 → 825 × 2 = 1650, delta 0

```

## 3. Прокинуть props из реальных call sites

Обновить все места, где вызывается публичный `PaymentDialog`.

Минимально проверить:

```text
ProductLanding
UniversalPricingSection
SitePageBySlug
AdminProductDetailV2 preview

```

Передавать фактические данные оффера:

```tsx
installmentMaxMonths={
  offer.meta?.installment?.max_months ??
  offer.installment_count
}
installmentIntervalDays={
  offer.installment_interval_days ??
  offer.meta?.installment?.interval_days ??
  30
}
installmentTotalAmountKopecks={
  Math.round(Number(offer.amount) * 100)
}

```

Не использовать несуществующее `amount_minor`, если его нет в фактическом типе данных.

## 4. Backend SoT

В двух writer’ах:

```text
admin-create-public-link
public-create-installment-link

```

писать:

```ts
rounding_mode: plan.rounding_mode

```

а не повторять литерал.

Логику диапазона public writer не менять:

```text
max=2, N отсутствует → N=2
max>2, N отсутствует → installment_months_required
N вне 2..max → installment_months_out_of_range

```

## 5. Проверки до отчёта

```text
max=2
→ auto N=2
→ Select скрыт
→ кнопка доступна

max=6
→ N не выбран
→ кнопка disabled

max=6, N=4
→ 4 платежа
→ правильный preview
→ billing_cycles=4

max=12, N=3
→ billing_cycles=3

max=12, N=12
→ billing_cycles=12

```

API snapshot:

```text
selected_installment_months
billing_cycles
requested_total_byn
per_payment_byn
effective_total_byn
rounding_delta_byn
rounding_mode=ceil_to_whole_byn
payment_links.amount

```

Обязательно предоставить:

```text
commit SHA
diff по файлам
typecheck
deno check двух writer’ов
edge deploy version/time
frontend publish = HOLD

```

---

# После этого не останавливаться и не просить нового решения

Сразу продолжить основной маршрут:

```text
1. B4–B6 fixture runtime matrix
2. B7 failure/retry-exhausted из bepaid-webhook
3. B8/B9 полная admin + public runtime matrix
4. B10 provider smoke
5. Stage C:
   - exact offer picker;
   - payment;
   - subscription;
   - internal installment;
   - invoice;
   - RR links;
   - PublicPay link_kind;
   - atomic consume/idempotency
6. Trial Discovery — document only
7. Финальный consolidated E2E

```

Отсутствие безопасного Telegram/email тестового пользователя **не должно останавливать спринт**:

```text
REAL TG/EMAIL DELIVERY : PENDING SAFE TEST CONTACT

```

Остальные сценарии выполнять через изолированные fixtures, dry-run и cleanup.

## Следующий отчёт должен быть не планом, а результатом

```text
PUBLIC PAYMENTDIALOG COMMIT       : <SHA>
PUBLIC MAX=2 AUTO                 : PASS/FAIL
PUBLIC MAX>2 EXPLICIT SELECT      : PASS/FAIL
PUBLIC BUTTON BLOCK WITHOUT N     : PASS/FAIL
PUBLIC SELECTED N SNAPSHOT        : PASS/FAIL
ROUNDING SNAPSHOT                 : PASS/FAIL

B4–B6 FIXTURE RUNTIME             : PASS/FAIL
B7 IMPLEMENTATION                 : PASS/FAIL
B10 STATUS                        : PASS/IN PROGRESS
STAGE C STATUS                    : IN PROGRESS/NOT STARTED
FRONTEND PUBLISH                  : HOLD

```

Текущий общий статус:

```text
P0                              : PASS
OUTBOX RPC                      : PASS
B8 ADMIN 2..12                  : PASS — CODE
B9 WHOLE-BYN CEIL               : PASS — CODE
B8 PUBLIC EXPLICIT N            : FAIL — NOT COMMITTED
B4–B6 RUNTIME                   : NOT CLOSED
B7                              : NOT STARTED
B10                             : NOT STARTED
STAGE C                         : NOT STARTED
MASTER SPRINT                   : IN PROGRESS
FRONTEND PUBLISH                : HOLD


План: узкий corrective для публичного PaymentDialog (B8 PUBLIC SELECTED N)
```

## Контекст

`installment_count` в оффере хранит **максимум** платежей (2..12). Сейчас `src/components/payment/PaymentDialog.tsx` передаёт `selected_installment_months: installmentCount ?? null`, т.е. всегда максимум. Guard `max>2 && N отсутствует → installment_months_required` не срабатывает. Админ уже правильно выбирает N в `AdminPaymentLinkDialog.tsx` и может менять сумму (это остаётся без изменений).

## Скоуп (только public flow)

### 1. `src/components/payment/PaymentDialog.tsx`

Props расширить:

- `installmentMaxMonths?: number | null` — фактический max (переименование смысла `installmentCount`, оставим `installmentCount` как alias для обратной совместимости; внутренне используем `maxMonths = installmentMaxMonths ?? installmentCount ?? null`).
- `installmentIntervalDays?: number | null` — интервал (fallback 30).
- `installmentTotalAmountKopecks?: number | null` — total из оффера в копейках (для точного расчёта; если не задан — парсим `price`).

State:

- `selectedInstallmentMonths: number | null`.

Поведение:

- `maxMonths === 2` → авто N=2 (устанавливаем в useEffect при открытии).
- `maxMonths > 2` → рендерим Select со значениями 2..maxMonths. Пока `selectedInstallmentMonths === null` — кнопка «Оплатить» disabled с подсказкой «Выберите количество платежей».
- В опциях Select для каждого N показываем `N платежей × per_payment BYN`, где `per_payment = ceil(total_byn / N)` через клиентский `calculateInstallmentPlan`.

Summary-блок `isInstallmentOffer` (около строки 1303) переписать: показываем выбранное N, один платёж, итоговую сумму (`effective_total`), разницу из-за округления (`rounding_delta`) с пометкой «из-за округления вверх до целых BYN», интервал `installmentIntervalDays ?? 30` дней. Убрать хардкод «раз в 30 дней» и «на {installmentCount} платежа».

`handleInstallmentPayment`:

- Передавать `selected_installment_months: selectedInstallmentMonths` (не installmentCount).
- Если `null` — не отправлять запрос (кнопка disabled на UI-уровне).

Плюрализация «платёж/платежа/платежей» — использовать существующий подход из `AdminPaymentLinkDialog.tsx`.

### 2. Прокидывание props из вызывающих мест

`src/components/landing/ProductLanding.tsx`, `src/components/landing/UniversalPricingSection.tsx`, `src/pages/SitePageBySlug.tsx`:

- Заменить/дополнить `installmentCount={offer.installment_count}` на:
  - `installmentMaxMonths={offer.installment_count}` (canonical max),
  - `installmentIntervalDays={offer.installment_interval_days}`,
  - `installmentTotalAmountKopecks={offer.amount_minor ?? Math.round(Number(offer.amount) * 100)}` (в зависимости от того, что уже доступно; при отсутствии — парсим price внутри диалога).

Админский вызов `AdminProductDetailV2.tsx:3321` — оставить как есть (использует AdminPaymentLinkDialog отдельно, публичный PaymentDialog там для превью). Прокинуть те же новые props чтобы preview совпадал.

### 3. SoT rounding_mode

`supabase/functions/admin-create-public-link` и `supabase/functions/public-create-installment-link`: заменить литерал `rounding_mode: 'ceil_to_whole_byn'` на `rounding_mode: plan.rounding_mode` (значение уже возвращает shared helper). Это исключает будущий drift.

### 4. Матрица проверки (B8/B9 PUBLIC)

Локально проверить UX-состояния:

- `max=2` → auto N=2, Select скрыт, кнопка активна.
- `max=6` без выбора → кнопка disabled, подсказка.
- `max=6`, выбор N=4 → summary показывает 4 × ceil(total/4), delta, interval.
- `max=12`, выбор N=3 → аналогично.
- `max=12`, выбор N=12 → аналогично.

По API-контракту:

- Ссылка на рассрочку сохраняет `billing_cycles = selected N`, `per_payment_byn`, `effective_total_byn`, `rounding_delta_byn`, `rounding_mode = 'ceil_to_whole_byn'` в `payment_links.meta.installment`.

Примеры: 100/3 → 34×3=102 delta+2; 1000/12 → 84×12=1008 delta+8; 1650/2 → 825×2=1650 delta 0.

### 5. Что НЕ меняется

- Настройки самой кнопки в продукте (публично клиент по-прежнему ограничен диапазоном 2..max, как задано админом).
- Возможность администратора вручную создавать ссылки с другим N и другой суммой через `AdminPaymentLinkDialog` — работает как есть.
- Backend writer `public-create-installment-link` уже принимает `selected_installment_months` и валидирует диапазон — правок логики не требуется.
- Никаких изменений в БД/миграциях.

### 6. Deploy

После правок — деплой `admin-create-public-link` и `public-create-installment-link` (изменение только строки `rounding_mode`).

## Definition of Done

- Public PaymentDialog: при `max>2` клиент обязан явно выбрать N; кнопка «Оплатить» блокируется до выбора.
- Summary отражает выбранное N, per_payment, effective_total, rounding_delta, реальный интервал оффера.
- В обоих backend writer’ах `rounding_mode` берётся из результата shared helper.
- Матрица max=2 / max=6 / max=12 проходит визуально в preview и создаёт корректные `payment_links.meta.installment`.
- Ничего не публикуем (FRONTEND PUBLISH: HOLD), продолжаем B4–B6 fixture runtime отдельно.