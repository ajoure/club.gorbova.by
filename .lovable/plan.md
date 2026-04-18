да, согласен, с учетом правок:

1. Перед UPDATE payment_links SET current_uses = 0 по bound-ссылке сначала **обязательно** зафиксируй read-only факт:  

  - был ли уже создан orders_v2 по этой ссылке;
  - какой у него status;
  - есть ли audit от bepaid-webhook;
  - какой сейчас current_uses/max_uses.  
  И только после этого решай, делать ли reset. Иначе можно потерять доказательство уже прошедшей оплаты.
2. В Discovery по пункту 3 добавь не только связь через meta->>'payment_link_id', но и проверку:
  - сколько orders_v2 уже создано на один и тот же payment_link_id;
  - есть ли среди них paid, pending, failed;
  - не было ли уже двойного materialize по одной ссылке.  
  Это важно для идемпотентности счётчика.
3. В PATCH A зафиксируй, **где именно** будет сохраняться payment_link_id:
  - если *shared/create-payment-checkout.ts уже принимает meta*extra или аналогичный механизм — использовать его;
  - если нет — add-only расширить helper, а не делать post-insert костыль в нескольких местах.  
  Нужен один канонический способ прокинуть payment_link_id в orders_v2.meta.
4. В PATCH B не ограничивайся только order.meta.payment_link_counted. Добавь жёсткий порядок:
  - проверить payment_link_id в order.meta;
  - проверить payment_link_counted !== true;
  - только потом попытка инкремента;
  - после успешного инкремента — записать payment_link_counted=true;
  - затем audit public_[checkout.link](http://checkout.link)_consumed.  
  Это нужно прямо прописать как канонический sequence.
5. Для PATCH B добавь защиту от повторного webhook не только на уровне order.meta.payment_link_counted, но и через **условный update**:
  - инкремент делать только если current_uses < max_uses OR max_uses IS NULL;
  - если update не затронул строку, логировать отдельный audit, а не молча проходить.  
  Иначе будет трудно разбирать пограничные случаи на лимите.
6. Добавь отдельный audit event для отказа в инкременте на лимите, например:
  - public_[checkout.link](http://checkout.link)_consume_skipped_limit_reached
7. Это полезно для диагностики, если webhook пришёл успешно, а счётчик уже упёрся в max_uses.
8. В PATCH B уточни, что счётчик должен инкрементироваться **только для terminal success**, а не для failed, canceled, refunded.  
Это очевидно из плана, но лучше зафиксировать явно.
9. В Discovery по bepaid-webhook добавь отдельную проверку:
  - во **всех** success-ветках, где order может прийти из public-link, есть ли доступ к order.meta.payment_link_id;
  - нет ли параллельных success-веток, где этот инкремент можно пропустить.  
  Это важно, чтобы не закрыть только один happy path.
10. В пункте D про reset current_uses добавь STOP-guard:
  - если по ссылке уже есть paid order и webhook proof нужен как артефакт, reset делать только **после** фиксации proof в отчёте;
  - reset должен быть явно помечен как тестовый/manual maintenance step, не как часть бизнес-логики.
11. В DoD пункт 1 уточни:

&nbsp;

- “вернуться назад → снова открыть → снова можно нажать оплатить”  
должно проверяться **без создания нового paid order**, то есть только как отсутствие преждевременного сгорания ссылки от попытки checkout.  
Иначе можно случайно смешать UX-проверку и реальную повторную оплату.

11. В DoD пункт 2 добавь ещё одно условие:

- после успешной оплаты current_uses увеличивается ровно на 1 **на одну успешную оплату**, даже если webhook был повторён.  
Это ключевой идемпотентный инвариант.

12. В DoD пункт 4 по guest-ссылке добавь before/after:

- before: current_uses=0
- after success: current_uses=1
- order.meta.payment_link_counted=true
- audit public_[checkout.link](http://checkout.link)_consumed присутствует  
Тогда proof будет завершённым.

13. В финальной цели уточни формулировку:  
не просто “счётчик использования = счётчик успешных оплат”, а  
**“счётчик использования больше не зависит от создания checkout-сессии и зависит только от подтверждённого terminal success”**.

В остальном план правильный: сначала read-only discovery по уже использованным ссылкам и order-цепочке, потом перенос инкремента из public-checkout в bepaid-webhook, затем аккуратный reset только для тестовой повторной проверки и финальный live proof по guest-flow.

&nbsp;

## Диагноз

На скрине ошибка `Payment link usage limit reached`. Это значит: `payment_links.current_uses >= max_uses`. Смотрю на ссылку #1 (bound, `h5f4bound3byn00000000000000a006`):

Скорее всего она была создана с `max_uses = 1`, а инкремент `current_uses` происходит **в момент создания checkout-сессии** в `public-checkout` POST (а не по факту успешной оплаты webhook'ом). Поэтому:

- Первый клик на «Оплатить» → создан bePaid checkout → `current_uses = 1` → достигнут лимит.
- Пользователь вернулся назад / страница перерендерилась → повторный POST → 410 «usage limit reached».
- Даже если первая попытка дошла до bePaid и оплата прошла — повторно открыть ссылку нельзя.

Это плохая UX-логика. По бизнес-смыслу `max_uses` должен считаться по **успешным оплатам** (webhook `paid`), а не по созданным checkout-сессиям. Иначе любая «вернулся назад» / «перезагрузил страницу» / «дважды нажал» сжигает ссылку.

## Discovery (read-only)

1. Прочитать `public-checkout` POST — где именно инкрементируется `current_uses`. Подтвердить, что это происходит ДО подтверждения оплаты.
2. Прочитать `bepaid-webhook` — есть ли там логика инкремента `payment_links.current_uses` при `status=paid` (через `orders_v2.meta.payment_link_id` или аналог).
3. SELECT по обеим тестовым ссылкам: `current_uses`, `max_uses`, связанные `orders_v2` (через `meta->>payment_link_id`), их `status`.
4. Проверить, передаётся ли `payment_link_id` в `orders_v2.meta` через `_shared/create-payment-checkout.ts` (нужно для post-payment инкремента).

## Корневая причина

`current_uses` считается «по попыткам», а должен считаться «по успехам». Это нарушает базовую UX — ссылка не должна сгорать от того, что пользователь вернулся назад.

## PATCH (узкий)

### A. Server: `supabase/functions/public-checkout/index.ts`

- **Убрать** инкремент `current_uses` в POST.
- Оставить guard `current_uses >= max_uses` на чтение (защита от явного превышения по факту), но не двигать счётчик здесь.
- В `orders_v2.meta` обязательно класть `payment_link_id: link.id` (если ещё не кладётся — добавить через `_shared/create-payment-checkout.ts` параметром `meta_extra` или через прямую вставку после возврата из helper'а).

### B. Server: `supabase/functions/bepaid-webhook/index.ts`

- При успешном переходе ордера в `status='paid'` (внутри уже существующего grant-flow): если `order.meta.payment_link_id` задан — атомарно `UPDATE payment_links SET current_uses = current_uses + 1 WHERE id = ? AND current_uses < COALESCE(max_uses, 2147483647)`.
- Идемпотентность: инкрементировать только если этот `order.id` ещё не помечен в `meta.payment_link_counted` (или проверять через `audit_logs` на наличие `public_checkout.link_consumed` для этого order_id). Минимально — добавить в `orders_v2.meta` флаг `payment_link_counted: true` после успешного инкремента, и проверять его перед инкрементом.
- Audit: `public_checkout.link_consumed` с `payment_link_id`, `order_id`.

### C. Anti-duplication / scope

- НЕ менять `useInlineAuth`, `InlineAuthForm`, `PublicPayPage` UI.
- НЕ менять `grant-access-for-order`, `_shared/create-payment-checkout.ts` контракт (только при необходимости — добавление `meta.payment_link_id` через существующий механизм).
- НЕ создавать новых таблиц / RPC.
- НЕ трогать `admin-create-public-link`.

### D. Восстановление текущей сломанной ссылки

- Разовый UPDATE: `UPDATE payment_links SET current_uses = 0 WHERE url_token = 'h5f4bound3byn00000000000000a006'` — чтобы пользователь мог дотестить bound-ссылку. (Если первая попытка уже прошла оплату — отдельно зафиксирую live proof перед этим UPDATE, чтобы не потерять факт.)
- Аналогично проверить `i6g5free3byn00000000000000d009` — судя по словам пользователя, по ней оплата прошла, поэтому её ресетить не нужно, только зафиксировать live proof для guest-flow.

## Memory update

- `mem://commercial-logic/payments/public-checkout-architecture.md` — добавить раздел «`payment_links.current_uses` инкрементируется ТОЛЬКО webhook'ом по факту `orders_v2.status='paid'`, через `order.meta.payment_link_id`. Идемпотентно через `meta.payment_link_counted`. Создание checkout-сессии счётчик не трогает».

## DoD

1. **Bound-ссылка** (после ресета): открыть → нажать «Оплатить» → вернуться назад → снова открыть → снова можно нажать «Оплатить». Ссылка не сгорает от навигации.
2. **После успешной оплаты**: `payment_links.current_uses` инкрементируется ровно на 1 (webhook), повторный webhook на тот же `order.id` счётчик не двигает.
3. **При достижении `max_uses**` по факту успешных оплат — ссылка корректно показывает «недействительна».
4. **Live proof по guest-ссылке `i6g5free3byn00000000000000d009**`: order → paid → `pipeline_stage_id=stage_on_success` → audit от `bepaid-webhook` → `payment_links.current_uses=1`. Закрытие B.0 по guest-flow.
5. **Bound-ссылка `h5f4bound3byn00000000000000a006**`: проверить, прошла ли первая оплата live; если да — зафиксировать proof, потом ресет; если нет — просто ресет и дать пользователю переоткрыть.

## Финальная цель

Public payment links больше не сгорают от навигации/перезагрузки. Счётчик использования = счётчик успешных оплат. Bound-ссылка снова рабочая для дотеста; B.0 закрыт live proof по guest-flow.