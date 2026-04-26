да, согласен

Можно выполнять **PAY-AUDIT** строго как read-only.

**Контрольный scope**

READ-ONLY ONLY

**Разрешено**

- читать файлы;

- читать .lovable/[plan.md](http://plan.md);

- читать memory/docs;

- SELECT из БД;

- читать edge function logs;

- rg/grep/git show/git diff;

- составить таблицу покрытия;

- дать прямые ответы на 7 вопросов.

**Запрещено**

- менять UI;

- менять backend;

- менять edge functions;

- делать deploy;

- делать миграции;

- писать в БД;

- обновлять memory;

- “по-быстрому фиксить” найденные баги.

**Ключевой ожидаемый вывод**

Нужен честный факт:

Где реально работает saved-card charge:

- /pay/:token one_time?

- PaymentDialog one_time?

- purchases?

- subscription?

И отдельно:

Почему в предыдущих отчётах звучало “реализовано”, если фактически это могло быть реализовано только для /pay/:token.

**Обязательная таблица**

| Entry point | UI file | Edge function(s) | Saved card visible | Saved card selectable | Saved card charge works | one_time | subscription | status |

Покрыть минимум:

- /pay/:token one_time

- /pay/:token subscription

- PaymentDialog one_time

- PaymentDialog subscription

- PaymentDialog trial

- Purchases / SubscriptionDetailSheet

**В конце отчёта**

Нужны прямые ответы:

1. Да/нет: реализована ли saved-card оплата из PaymentDialog.

2. Где именно реализована saved-card оплата.

3. Почему PaymentDialog остался disabled/info-only.

4. Какие патчи реально что меняли.

5. Подходит ли public-charge-saved-card для PaymentDialog без link_token.

6. Какие ограничения у public-charge-saved-card.

7. Какие варианты унификации есть без второго workflow.

**DoD**

- git diff --name-only → пустой

- ни одной записи в БД не изменено

- ни одной edge function не задеплоено

- отчет содержит таблицу покрытия и 7 прямых ответов

После PAY-AUDIT уже принимать решение по следующему патчу.

&nbsp;

План:

# PAY-AUDIT — Read-only инвентаризация saved-card flow

## 1. Проблема

Ранее было заявлено требование: «выбор и оплата сохранённой картой везде». По факту тестов в PaymentDialog на сайте сохранённые карты только отображаются disabled и не используются для оплаты. Нужно остановить execute и провести честный read-only аудит фактического покрытия и предыдущих PAY-патчей.

## 2. Scope

**STOP — никаких правок.** Только чтение кода, БД, edge function logs и git diff. На выходе — отчёт с таблицей и прямыми ответами.

Запрещено в рамках этого аудита:

- менять UI;
- менять backend / edge functions;
- менять webhook;
- менять БД, RLS, миграции;
- ставить новые «исправляющие» PAY-патчи;
- предлагать новый код до того, как отчёт принят.

## 3. Что аудитим

### A. `/pay/:token`

- `src/pages/PublicPayPage.tsx`
  - есть ли selector сохранённых карт;
  - какие карты грузятся (поля, фильтры);
  - какой backend вызывается при выбранной карте;
  - что происходит для one_time vs subscription;
  - что происходит для guest vs auth user;
  - где включается disabled-режим карт.

### B. PaymentDialog на сайте

- `src/components/payment/PaymentDialog.tsx`
  - все entry points (`rg "<PaymentDialog"`): `Landing`, `ProductLanding`, `UniversalPricingSection`, `TariffPricing`, `Pay`, `BusinessTraining`, `BusinessTrainingContent`, `LiveEventProductCta`, `AdminProductDetailV2`;
  - какие props приходят, особенно `isSubscription`, `isTrial`, `offerId`, `tariffCode`;
  - какие edge functions вызывает (`bepaid-create-token`, `bepaid-create-subscription-checkout`, `test-payment-complete`);
  - есть ли вообще ветка вызова `public-charge-saved-card` или иного saved-card backend;
  - в каком состоянии блок «Сохранённые карты»: visible / selectable / disabled;
  - что говорит текущий текст пользователю.

### C. Личный кабинет / Мои покупки

- `src/pages/Purchases.tsx`
- `src/components/purchases/SubscriptionListItem.tsx`
- `src/components/purchases/OrderListItem.tsx`
- `src/components/purchases/SubscriptionDetailSheet.tsx`
- наличие/отсутствие действий «оплатить сохранённой картой», «повторить оплату»;
- что показывается из `payment_methods` (только инфо или selector).

### D. Edge functions inventory

Для каждой собрать единым списком: вызыватели, сценарии, поддержка saved card, требование `payment_link`, что создаёт, tracking_id, через какой webhook закрывается:

- `public-charge-saved-card`
- `public-checkout`
- `bepaid-create-token`
- `bepaid-create-subscription-checkout`
- `direct-charge` (известно: отключён 410)
- `admin-manual-charge`
- `_shared/create-payment-checkout.ts` (helper, не entry point, но критичен)
- `bepaid-webhook` (как closer)

Источники истины для проверки:

- код `supabase/functions/<name>/index.ts`;
- `supabase/functions.registry.txt`;
- `supabase--edge_function_logs` для подтверждения реальных вызовов;
- `payments_v2` / `orders_v2` через `supabase--read_query`: фактические `meta.source`, `tracking_id`, последние записи.

### E. История PAY-патчей

По текущему коду + `.lovable/plan.md` собрать таблицу патчей: PAY-C, PAY-D, PAY-E-LITE, PAY-G, PAY-H, PAY-I. Для каждого:

- что было заявлено;
- какие файлы реально затронуты сейчас;
- какие ограничения зафиксированы;
- что осталось disabled / отложено;
- где именно остался разрыв «сайт vs ссылка».

Дополнительные источники:

- `mem://ui/payments/saved-card-client-policy`;
- `mem://architecture/payments/one-time-checkout-unification`;
- `mem://commercial-logic/payments/public-checkout-architecture.md`;
- `docs/PAYMENT_LINKS_AUDIT.md`.

## 4. Обязательный артефакт — таблица покрытия

Отчёт обязан содержать таблицу следующего формата (одна строка = один реальный entry point):


| Entry point | UI file | Edge function(s) | Saved card visible | Saved card selectable | Saved card charge works | one_time | subscription | status |
| ----------- | ------- | ---------------- | ------------------ | --------------------- | ----------------------- | -------- | ------------ | ------ |


Покрыть минимум:

- `/pay/:token` one_time;
- `/pay/:token` subscription;
- PaymentDialog one_time (consultation, разовый продукт);
- PaymentDialog subscription;
- PaymentDialog trial;
- Purchases / SubscriptionDetailSheet (renew / repay).

## 5. Обязательные прямые ответы

В конце отчёта — без размытых формулировок:

1. Реализована ли уже оплата сохранённой картой из PaymentDialog (да / нет, со ссылкой на код)?
2. Если нет — почему в предыдущих отчётах звучало, что «оплата привязанной картой реализована»? Какой именно патч это утверждал и какие файлы он реально менял?
3. Где сейчас фактически работает saved-card charge (entry point + edge function + последний реальный лог/запись из БД)?
4. Что минимально нужно доделать, чтобы PaymentDialog one_time тоже использовал сохранённую карту?
5. Нужно ли для этого менять backend, или существующий `public-charge-saved-card` уже подходит?
6. Если `public-charge-saved-card` требует `url_token`, почему он не подходит для PaymentDialog без payment link, и какие у него ещё ограничения (scope guard, ownership, idempotency)?
7. Какой самый безопасный единый путь, чтобы не плодить второй payment workflow (расширение существующей function vs тонкий wrapper над `_shared/create-payment-checkout.ts` + отдельный saved-card path vs новый endpoint)? Указать риски каждого варианта, без выбора решения.

## 6. Изменяемые компоненты

Никакие. Аудит read-only.

## 7. Что НЕ будет изменено

Ничего. Ни UI, ни edge functions, ни webhook, ни БД, ни RLS, ни memory.

## 8. Dry-run

Сам аудит и есть dry-run. Никаких фактических операций, кроме SELECT и чтения файлов.

## 9. Execute

1. Прочитать перечисленные UI файлы и зафиксировать поведение по каждому entry point.
2. Прочитать перечисленные edge functions, выписать их контракты.
3. Прогнать `rg` по `provider_token`, `public-charge-saved-card`, `direct-charge`, `useMitTokenization`, `paymentFlowType` — зафиксировать, где они встречаются.
4. Через `supabase--read_query` посмотреть свежие записи в `payments_v2` / `orders_v2` с `meta->>source = 'saved_card_public_pay'` и без — подтвердить, какие entry points реально доходили до БД.
5. Через `supabase--edge_function_logs` подтвердить реальные вызовы `public-charge-saved-card`, `bepaid-create-token`, `public-checkout`.
6. Сложить всё в таблицу покрытия.
7. Дать прямые ответы на 7 вопросов.
8. Никаких правок.

## 10. STOP-guards

- STOP, если в ходе аудита возникает соблазн «по-быстрому пофиксить» — фиксить запрещено.
- STOP, если данные в коде и в логах противоречат друг другу — это и есть результат аудита, фиксируем расхождение, не «дорисовываем» интерпретацию.
- STOP, если нужны дополнительные права/доступы для проверки — указать это в отчёте, не обходить.
- STOP, если очередной PAY-патч обнаружится частично откатанным — зафиксировать факт, не «восстанавливать».

## 11. DoD

- Аудит-отчёт содержит:
  - заполненную таблицу покрытия по всем entry points;
  - прямые ответы на 7 вопросов;
  - явный вывод: «оплата сохранённой картой реализована только в /pay/:token one_time» (или иной фактический вывод, подтверждённый кодом и логами);
  - перечень ограничений `public-charge-saved-card` (auth, scope=one_time, ownership NULL-or-equal, idempotency) с цитатами строк;
  - раздел «варианты унификации без второго workflow» с рисками, без выбора решения;
- ни один файл проекта не изменён;
- ни одна edge function не задеплоена;
- ни одна запись в БД не изменена;
- `git diff --name-only` пустой.

## 12. Риски и зависимости

- Часть данных требует чтения логов edge functions и SELECT по `payments_v2` — если доступ ограничен, явно отметить это в отчёте.
- Если в PaymentDialog обнаружатся скрытые ветки, которые я не учёл, — внести их в таблицу как отдельные entry points, а не «склеивать».

## 13. Требуется дополнительная информация

Дополнительная информация не требуется. Требуется approval на выполнение PAY-AUDIT именно как read-only аудита, без правок.