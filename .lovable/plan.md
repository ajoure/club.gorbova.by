
План:

## Проблема
Нужно не делать новый blind-fix, а финально подтвердить фактическое состояние public payment links и закрыть спринт без лишних правок.

## Диагностика
Факты по текущему состоянию уже подтверждены read-only:

- `public-checkout` сейчас **не** инкрементирует `payment_links.current_uses` при создании checkout.
- `bepaid-webhook` вызывает shared helper `consumePaymentLinkForOrder` только в success-ветках.
- `PublicPayPage` уже использует hard guard для bound-ссылки и Bearer-токен для guest-flow.

### Bound-ссылка
`h5f4bound3byn00000000000000c008`
- `payment_links`: `status=active`, `current_uses=0`, `max_uses=1`, `user_id` заполнен.
- На published URL страница сейчас открывается нормально и показывает кнопку оплаты.
- По этой ссылке есть **один pending order** `ORD-26-00013`, но:
  - `paid_amount=0`
  - webhook-proof paid отсутствует
  - `link_consumed` audit отсутствует

Вывод: эта bound-ссылка **не оплачена и не consumed**. Симптом “недействительна” сейчас read-only не воспроизводится.

### Guest-ссылка
`i6g5free3byn00000000000000d009`
- `payment_links`: `status=active`, `current_uses=2`, `max_uses=5`, `user_id=NULL`.
- Есть:
  - `ORD-26-00014` → `paid`, `payment_link_counted=true`
  - `ORD-26-00016` → `paid`, `payment_link_counted=true`
  - `ORD-26-00015` → stale `pending`
- В audit есть:
  - 3 события `public_checkout.created`
  - 2 события `public_checkout.link_consumed`
- Это согласовано с `current_uses=2`.

Вывод: guest-ссылка сейчас **работает корректно** и действительно допускает несколько оплат в пределах `max_uses=5`.

## Предлагаемое решение
Узкий путь к закрытию спринта:

1. **Не менять код** `public-checkout`, `bepaid-webhook`, `consume-payment-link`, `PublicPayPage`.
2. **Не использовать старую bound-ссылку `c008` как финальный proof-артефакт**, потому что по ней уже есть старый orphan pending order и противоречивые пользовательские наблюдения.
3. Через существующий canonical writer создать **новую чистую bound-ссылку** для финального proof.
4. По новой bound-ссылке сделать один финальный live proof:
   - открыть ссылку
   - убедиться, что auth-form не показывается
   - оплатить
   - подтвердить `orders_v2.status='paid'`
   - подтвердить `audit public_checkout.link_consumed`
   - подтвердить `current_uses=1`
   - после этого ссылка при `max_uses=1` может стать недействительной **уже по дизайну**, и это будет считаться нормой, а не багом.
5. Guest-flow считать подтвержденным и закрытым по уже имеющемуся proof (`current_uses=2`, два paid order, два consume audit).

## Изменяемые компоненты
Если план будет выполнен:
- данные через существующую edge-функцию `admin-create-public-link` — только создание новой bound-ссылки
- read-only verify по:
  - `payment_links`
  - `orders_v2`
  - `audit_logs`

## Что не будет изменено
- `supabase/functions/public-checkout/index.ts`
- `supabase/functions/bepaid-webhook/index.ts`
- `supabase/functions/_shared/consume-payment-link.ts`
- `supabase/functions/_shared/create-payment-checkout.ts`
- `src/pages/PublicPayPage.tsx`
- `InlineAuthForm` / `useInlineAuth`

## Dry-run
Перед любым execute:
1. создать только **одну** новую bound-ссылку через существующий writer;
2. сразу read-only проверить у неё:
   - `user_id`
   - `status`
   - `current_uses`
   - `max_uses`
   - GET-state: `has_target_user=true`, `requires_identity_input=false`.

## Execute
1. Выпустить новую bound test-link.
2. Передать её пользователю для одного финального платежа.
3. После оплаты снять backend-proof:
   - `orders_v2`
   - `audit_logs`
   - `payment_links.current_uses`
4. Зафиксировать sprint-close report.

## STOP-guards
Остановиться и не закрывать спринт, если:
- новая bound-ссылка вдруг показывает auth-form;
- `current_uses` изменится до `paid`;
- на один финальный тест появится более одного нового order;
- webhook не выставит `payment_link_counted=true`;
- новая bound-ссылка окажется invalid до первой успешной оплаты.

## DoD
1. Guest-ссылка `i6g5free3byn00000000000000d009` подтверждена как рабочая:
   - `current_uses=2`
   - два `paid` order
   - два `public_checkout.link_consumed`
2. Новая bound-ссылка проходит полный цикл без логина.
3. После успешной bound-оплаты:
   - order = `paid`
   - есть webhook/audit proof
   - `current_uses` увеличен ровно на 1
4. Спринт закрывается без новых кодовых патчей, если новая bound-проверка успешна.

## Риски и зависимости
- Старую bound-ссылку `c008` не стоит использовать как финальный эталон: по ней уже есть исторический `pending` order.
- Если бизнес-смысл bound-ссылки — одноразовая оплата, то её недействительность **после успешной оплаты** при `max_uses=1` является ожидаемым поведением.
- Для чистого закрытия нужен именно новый bound proof, а не повторные попытки на старом артефакте.

## Требуется дополнительная информация
Не требуется. Для следующего шага достаточно выполнить создание новой bound-ссылки и финальную live-проверку.
