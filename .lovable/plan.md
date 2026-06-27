# да, согласен, с учетом правок:

1. **В заголовке оставить строго один формат**

Сейчас заголовок ок:

```text
План: PATCH-DISABLE-MANDATORY-INTERNAL-MIT — финальная зачистка и proof
```

Можно выполнять как финальную зачистку, без расширения scope.

2. **Не делать повторную нормализацию БД, если она уже PASS**

Раз БД уже подтверждена:

```text
requires_card_tokenization=true → 0
auto_charge_after_trial=true → 0
DEFAULT false
trigger установлен
audit есть
```

то в этом патче не нужно повторно менять БД, кроме trigger-test. Основной scope — **UI cleanup + proof**.

3. **Осторожно с** `auto_charge_after_trial`

Если уже подтверждено, что `auto_charge_after_trial` относится к внутренней MIT/autopay логике, можно оставлять `false`.

Но в отчёте обязательно написать:

```text
auto_charge_after_trial не используется как канон provider-side recurring bePaid/Stripe. Канон рекуррента — tariff_offers.meta.recurring.is_recurring.
```

4. **Admin UI: не просто disabled checkbox, лучше убрать возможность выбора**

Лучше не оставлять активный чекбокс даже disabled, если он путает администратора.

Предпочтительный вариант:

```text
Чекбокс «Обязательная привязка карты» удалён из формы и заменён read-only info-блоком.
```

Если удалить сложно — тогда disabled + always false допустимо, но хуже UX.

5. **Формулировка info-плашки**

Использовать такой текст:

```text
Обязательная внутренняя привязка карты отключена на уровне платформы. Покупка и подписки проходят через стандартный checkout bePaid/Stripe. Если у оффера есть рекуррент, дальнейшие списания выполняет платёжный провайдер, а не внутренняя MIT-токенизация платформы.
```

Не писать, что «автосписания отключены» — это неверно. Отключена только **внутренняя обязательная MIT-привязка**.

6. `OfferRowCompact.tsx` **— не удалять типы**

Правильно:

- убрать бейдж/иконку `auto_charge_after_trial`;
- тип поля оставить;
- не менять модель данных;
- не удалять колонку.

7. **PaymentDialog не трогать, только проверить**

Согласен: не открывать новый scope по `PaymentDialog`, если копи уже приведены к канону.

В proof достаточно:

- trial показывает «Демо-доступ» / «Карта не требуется»;
- recurring показывает блок подписки по `meta.recurring.is_recurring`;
- `requires_card_tokenization` не участвует как классификатор.

8. **Trigger-test выполнять безопасно**

Для UPDATE-теста лучше использовать тестовый оффер или временно созданный оффер, а не боевой, если это возможно.

Если используете боевой оффер, то:

```text
UPDATE true → trigger immediately stores false
```

и обязательно подтвердить, что остальные поля не изменились.

9. **bePaid/Stripe recurring proof**

Не нужно проводить реальную оплату. Достаточно smoke до provider redirect:

```text
recurring offer → PaymentDialog → provider checkout redirect created/opened без ошибки
```

Не создавать тестовую подписку без необходимости.

10. **Финальный статус**

В отчёте в конце добавить:

```text
PATCH-DISABLE-MANDATORY-INTERNAL-MIT: PASS
```

только если все строки proof действительно закрыты.

## **Итог**

План можно выполнять. Scope правильный: **финальная зачистка UI + runtime proof**, без переписывания платежей и без затрагивания bePaid/Stripe recurring.

&nbsp;

План: PATCH-DISABLE-MANDATORY-INTERNAL-MIT — финальная зачистка и proof

## Текущий статус (по фактической discovery)

Уже сделано в БД и подтверждено runtime-запросом:

- `tariff_offers.requires_card_tokenization=true` → 0 строк.
- `tariff_offers.auto_charge_after_trial=true` → 0 строк.
- DEFAULT обоих полей → `false`.
- Триггер `trg_tariff_offers_force_disable_mandatory_internal_mit` установлен (BEFORE INSERT OR UPDATE) — любое INSERT/UPDATE с `true` принудительно перезаписывается на `false`.
- Миграция: `supabase/migrations/20260626135746_*.sql`, audit запись `PATCH-DISABLE-MANDATORY-INTERNAL-MIT-V1` присутствует.

Остатки в Admin UI, которые ещё противоречат канону (не блокируют БД, но вводят пользователя в заблуждение):

- `src/pages/admin/AdminProductDetailV2.tsx`:
  - L1870: при выборе «Рассрочка» форсит `requires_card_tokenization: true`.
  - L1883: при выборе `trial` / `preregistration` форсит `requires_card_tokenization: true`.
  - L2570: условный блок «Списания после trial» рендерится по `offerForm.requires_card_tokenization`.
  - L2804: ветка `selectedOfferForPayment.offer.requires_card_tokenization` в превью.
  - L335/529/499: дефолты `auto_charge_after_trial: true` в init-форме (триггер их обнулит, но UI продолжает показывать «включено»).

PaymentDialog копи и SITE-000018 trial CTA уже приведены к новому канону (зафиксировано в предыдущем отчёте); план только верифицирует их runtime.

## Scope правок

### 1. `src/pages/admin/AdminProductDetailV2.tsx`

- L1870, L1883: убрать форс `requires_card_tokenization: true`; всегда выставлять `false`.
- L335, L529, L499: дефолты `auto_charge_after_trial: false`, `requires_card_tokenization: false`.
- L675-680: оставить как есть (уже корректно жёстко пишет `false` при сохранении).
- L2570: заменить условный блок «Списания после trial / привязка карты» на read-only info-плашку:
  > «Обязательная внутренняя привязка карты отключена на уровне платформы. Покупка и подписки проходят через стандартный checkout bePaid/Stripe. Если у оффера есть рекуррент, дальнейшие списания выполняет платёжный провайдер.»
- Чекбокс `requires_card_tokenization` (если ещё активен) — `disabled`, значение всегда `false`, подпись «Управляется платформой (всегда выкл.)».
- L2804: убрать ветку, отображающую блок MIT в превью (или сделать её всегда `false`).

### 2. `src/components/admin/product/OfferRowCompact.tsx`

- L159 (`offer.auto_charge_after_trial && …`): убрать бейдж/иконку, т.к. поле всегда `false`. Тип `auto_charge_after_trial: boolean` оставить (используется в типах).

### 3. PaymentDialog / TariffCard / public офферы

- Не трогаем: текущее поведение уже опирается на `meta.recurring.is_recurring` и trial 0 BYN; копи «Демо-доступ» применена.

### 4. STOP-list (не трогать)

`meta.recurring.is_recurring`, Recurring Snapshot Resolver, bePaid/Stripe checkout/subscriptions, `orders_v2`, `payments_v2`, `subscriptions_v2`, `grant-access-for-order`, webhooks, installment finite-subscription, активные подписки.

## Runtime proof

Запросы (`supabase--read_query`):

1. `SELECT COUNT(*) FROM tariff_offers WHERE requires_card_tokenization=true OR auto_charge_after_trial=true;` → ожидаем `0`.
2. `SELECT 1 FROM pg_trigger WHERE tgname='trg_tariff_offers_force_disable_mandatory_internal_mit';` → ожидаем `1`.
3. Trigger test (через временный INSERT/UPDATE в `supabase--insert`): UPDATE одного оффера с `requires_card_tokenization=true` → SELECT возвращает `false`.

UI / runtime:

4. Admin → продукт → редактирование оффера: чекбокс MIT недоступен / отсутствует, info-плашка видна.
5. SITE-000018 trial CTA («Активировать демо-доступ») открывает PaymentDialog с текстом «Карта не требуется», без блока «Списания после trial».
6. Реальный recurring-оффер bePaid/Stripe (по `meta.recurring.is_recurring=true`): PaymentDialog показывает блок «Ежемесячная подписка», CTA уходит в provider checkout (визуально подтверждаем переход без ошибок).

## Финальный отчёт (формат)

```
Отчет о выполненной работе: PATCH-DISABLE-MANDATORY-INTERNAL-MIT

DB normalization: PASS
DB trigger guard: PASS
Admin UI mandatory MIT disabled: PASS
PaymentDialog copy: PASS
SITE-000018 trial without card: PASS
bePaid/Stripe recurring unaffected: PASS
PATCH-DISABLE-MANDATORY-INTERNAL-MIT: PASS
```

## Что НЕ в этом плане

- PATCH-PREORDER-DEAL-FLOW (T-000074) — отдельной задачей после закрытия этого патча, начнётся с read-only discovery.
- Никаких новых правок HTML SITE-000018, новых CTA, скана RPC, переписывания PaymentDialog, удаления MIT-кода физически.