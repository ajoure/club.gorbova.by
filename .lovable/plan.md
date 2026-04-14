да, согласен, с учетом правок:

&nbsp;

1. В P0 явно добавь отдельный decision gate по **saved-card one-time path**:
  после forensic нужно выбрать **ровно один** из двух вариантов и зафиксировать его как canonical:
  &nbsp;
  - либо one-time оплата сохранённой картой **реально поддерживается** и тогда чинится backend/payload до рабочего состояния;
  - либо для one-time продуктов она **не поддерживается**, и тогда UI с сохранённой картой на консультации нужно **не показывать**, а сразу вести в обычный checkout.
    Нельзя оставлять текущую ложную кнопку “Оплатить сохранённой картой”, если path фактически не реализован.
  &nbsp;
2. В dry-run добавь обязательную проверку:
  **почему на консультации вообще показывается saved-card UI**.
  Нужно доказать:
  &nbsp;
  - откуда берётся savedCard;
  - по какому правилу этот блок разрешён для one-time продукта;
  - не является ли это регрессией после унификации checkout.
  &nbsp;
3. В execute добавь отдельный пункт:
  после root-cause fix обязательно синхронизировать **UI capability guard** с backend reality.
  То есть:
  &nbsp;
  - если backend умеет saved-card one-time → UI оставляем;
  - если backend не умеет → UI скрываем для таких офферов.
    Сейчас это ключевой риск повторной поломки.
  &nbsp;
4. В P2 добавь использование существующего нормализатора ошибок, а не ручной текст в одном месте:
  нужно явно указать применение src/utils/normalizeEdgeFunctionError.ts в payment flow, чтобы не плодить новые ad-hoc сообщения.
5. В P0 forensic добавь обязательный capture не только failing path, но и **успешного one-time обычного checkout** для консультации, если он существует.
  Нужна таблица:
  &nbsp;
  - consultation + saved card;
  - consultation + новая карта;
  - club + saved/subscription path.
    Без этого нельзя доказать, что фикс не сломал смежные сценарии.
  &nbsp;
6. В F2 добавь отдельную проверку **кто именно закрывает модалку**:
  &nbsp;
  - внутренний setOpen(false) в PaymentDialog;
  - родительский setPaymentOpen(false);
  - remount из-за смены selectedOffer;
  - rerender/unmount после auth state change.
    Сейчас в плане это есть общо, но нужен прямой owner trace, иначе снова получится “частично поправили”.
  &nbsp;
7. В DoD по P0 добавь ещё один пункт:
  **после успешного логина внутри модалки консультации пользователь остаётся в том же modal session и может сразу завершить оплату**.
  Иначе P0 и F2 слишком разъезжаются, а для клиента это один сквозной сценарий покупки.
8. В STOP-guards добавь:
  если выяснится, что ConsultationPaymentDialog.tsx всё же где-то живой и участвует в runtime, сначала зафиксировать owner map и только потом чинить.
  Сейчас план считает его orphan/legacy, но это должно быть подтверждено runtime/grep proof.
9. В “изменяемые компоненты” добавь, что UniversalPricingSection / ProductLanding / TariffPricing трогаются не только “если forensic подтвердит”, а ещё и **если потребуется capability guard для saved-card UI**. Иначе можно пропустить точку, где показывается неверный CTA.
10. Финальный отчёт потребуй в двух независимых блоках:

&nbsp;

&nbsp;

&nbsp;

- **P0 consultation payment hotfix** — root cause, logs, fix, proof;
- **F2 modal resume** — why still not closed / what fixed / browser-proof.
  Не смешивать эти результаты в один общий “checkout fixed”.

&nbsp;

&nbsp;

Если коротко: план правильный, но в нём нужно жёстко зафиксировать главный выбор — **saved-card one-time либо поддерживаем честно, либо скрываем честно**. Это сейчас центральная точка всей проблемы.

&nbsp;

План:

## Статус PATCHей


| PATCH                                 | Новый статус         |
| ------------------------------------- | -------------------- |
| F2 — resume payment after inline auth | PARTIAL / NOT CLOSED |
| P0 — hotfix оплаты консультации       | NEW                  |
| P2 — клиентские ошибки оплаты         | NEW                  |


## Проблема

Нельзя закрывать F2 как выполненный без runtime-proof: по факту после входа через окно оплаты модалка всё ещё закрывается.

Отдельно есть более срочная P0-проблема: клиент не может оплатить консультацию, особенно в сценарии с найденным пользователем и сохранённой картой.

## Диагностика

- Файл `docs/ENGINEERING_RULES.md` подтверждает обязательный порядок: Diagnose → Plan → Dry run → Execute → Verify.
- Страница консультации `/consultation` сейчас рендерит `UniversalPricingSection` (`src/pages/Consultation.tsx`), а не `ConsultationPaymentDialog`.
- Значит, консультация уже идёт через канонический публичный flow: `UniversalPricingSection` → `PaymentDialog`.
- `ConsultationPaymentDialog.tsx` существует, но по коду выглядит orphan/legacy: он передаёт `isOneTime: true` в `bepaid-create-token`, но в найденных entrypoints не используется.
- В `PaymentDialog.tsx` на шаге ready показывается сохранённая карта, но сам `handlePayment()` не отправляет `payment_method_id/saved_card_id` и прямо комментирует, что client UI не вызывает `direct-charge`.
- Для non-subscription path `PaymentDialog` вызывает `bepaid-create-token`.
- В `supabase/functions/bepaid-create-token/index.ts` есть отдельная ветка one-time checkout только при `isOneTime === true`, а в конце есть hard guard, который блокирует legacy subscription path с non-2xx/403.
- Сильная гипотеза по коду: консультация после унификации перестала попадать в one-time ветку и уходит в blocked branch `bepaid-create-token`, что даёт именно “Edge Function returned a non-2xx status code”.
- Это пока гипотеза, а не доказанный факт. До edge logs / network proof её нельзя объявлять root cause окончательно.
- F2 тоже не доказан как закрытый: хотя в `PaymentDialog` есть `authInProgressRef`, runtime-proof, что окно не закрывается и checkout context не теряется, сейчас нет.
- `PaymentDialog` до сих пор показывает raw `error.message` через `toast.error(...)`; `src/utils/normalizeEdgeFunctionError.ts` существует, но здесь не используется.

## Предлагаемое решение

### P0 — срочный hotfix консультации (первым блоком)

1. Провести forensic discovery именно на consultation flow:
  - какая Edge Function падает;
  - точный status code;
  - response body;
  - request payload без персональных данных;
  - связанные `order_id / product_id / tariff_id / offer_id / user_id`;
  - логи до и после фикса.
2. Проверить сценарий с сохранённой картой отдельно:
  - существует ли `payment_methods` запись;
  - активна ли она;
  - принадлежит ли текущему пользователю;
  - соответствует ли payload консультации one-time логике;
  - не сломан ли маршрут из-за унификации checkout.
3. Сравнить поток консультации 1:1 с рабочим клубным flow:
  - какой UI-компонент стартует оплату;
  - какой handler вызывается;
  - какая Edge Function вызывается;
  - какой payload уходит;
  - где начинается первое расхождение.
4. После discovery внести минимальный hotfix в канонический owner-flow:
  - не оживлять `ConsultationPaymentDialog` как второй поток;
  - не делать special-case только для клуба или только для консультации;
  - исправить canonical one-time path внутри `PaymentDialog`/общего checkout flow так, чтобы консультация шла по корректной one-time ветке.
5. Добавить fallback на клиенте:
  - если функция вернула non-2xx;
  - показать понятную ошибку;
  - предложить обычную оплату через checkout / новую карту;
  - не оставлять клиента в тупике.

### P1 — F2 follow-up bugfix (не закрыт)

1. Снять статус F2 с CLOSED на PARTIAL / NOT CLOSED.
2. Проверить не только `PaymentDialog.tsx`, а весь контур закрытия модалки:
  - `Dialog onOpenChange`;
  - родительский `paymentOpen`;
  - mount/unmount по `selectedOffer`;
  - реакцию `AuthContext` на `signInWithPassword`;
  - возможный reset после смены `user/session`.
3. Зафиксировать и сохранить весь checkout context после auth:
  - `selectedOffer`;
  - `productId`;
  - `tariffCode`;
  - `offerId`;
  - `existingUserId`;
  - `formData.email`;
  - телефон;
  - consent state;
  - `savedCard`;
  - текущий `step`.
4. Только после browser-proof вернуть F2 в CLOSED.

### P2 — улучшение сообщений об ошибках

- Заменить raw сообщение `"Edge Function returned a non-2xx status code"` на понятный текст:
  - «Не удалось провести оплату сохранённой картой»
  - «Попробуйте оплатить новой картой или повторите позже»
- Техническую причину оставить в системных/edge logs.

## Изменяемые компоненты

Основной scope:

- `src/components/payment/PaymentDialog.tsx`
- `supabase/functions/bepaid-create-token/index.ts`
- `.lovable/plan.md`

Только если forensic discovery это подтвердит:

- `src/components/landing/UniversalPricingSection.tsx`
- `src/components/landing/ProductLanding.tsx`
- `src/pages/TariffPricing.tsx`

## Что не будет изменено

- Никаких новых таблиц, edge functions, auth flows, onboarding flows.
- Не трогаем профиль, кабинет, подписки, entitlements, Telegram и unrelated auth flows.
- Не возвращаем redirect workaround на `/auth`.
- Не делаем отдельный временный consultation-only checkout flow.

## Dry-run

1. Воспроизвести consultation payment с сохранённой картой.
2. Снять network proof failing request.
3. Снять edge logs по точной функции.
4. Прочитать связанные записи в БД:
  - `payment_methods`
  - `tariffs`
  - `tariff_offers`
  - `orders/orders_v2`
5. Сравнить с успешной оплатой клуба.
6. Отдельно воспроизвести F2-баг: login внутри окна → проверить, кто именно закрывает модалку.

## Execute

1. Исправить P0 через канонический checkout owner, без параллельного потока.
2. Добавить fallback и нормализованное сообщение об ошибке.
3. Перепроверить consultation:
  - saved-card path;
  - обычный checkout path.
4. Затем отдельно закрывать F2-баг закрытия модалки после auth.
5. Обновить `.lovable/plan.md` с честным статусом PATCHей.

## STOP-guards

- Если forensic покажет, что падает не `bepaid-create-token`, остановиться и перепривязать план к реальной функции.
- Если консультация всё же использует другой live-entrypoint кроме `PaymentDialog`, сначала зафиксировать owner map.
- Если для фикса требуется новая архитектура, новые таблицы или новый flow — остановиться, это вне scope.
- Не закрывать F2 без browser-proof.
- Не подменять root cause “косметическим” текстовым фиксом.

## Route / owner map

### Текущий consultation runtime path

`/consultation`  
→ `UniversalPricingSection`  
→ `TariffCard.onSelectOffer`  
→ `PaymentDialog`  
→ `auth-check-email` / `signInWithPassword`  
→ `bepaid-create-token`

### Club path

public pricing CTA  
→ `UniversalPricingSection` / `ProductLanding` / `TariffPricing`  
→ `PaymentDialog`  
→ для подписок `bepaid-create-subscription-checkout`

### F2 broken area

offer click  
→ `PaymentDialog open=true`  
→ email step  
→ auth check  
→ login/register submit  
→ auth state update in `AuthContext`  
→ нужно доказать, где именно происходит close/reset/unmount

## DoD

### P0 — консультация

- Клиент с сохранённой картой успешно оплачивает консультацию.
- Клиент без сохранённой карты тоже успешно оплачивает консультацию.
- После ошибки есть fallback на обычный checkout / новую карту.
- В логах видно, какая функция падала и почему.
- Есть before/after logs.
- Клубная оплата после фикса не сломана.

### P1 — follow-up по модалке

- Логин внутри окна не закрывает окно.
- Не теряется выбранный тариф / offer / product.
- Не нужно повторно нажимать «Оплатить».
- Переход идёт сразу к следующему payment step внутри того же modal session.

### P2 — ошибки

- Пользователь больше не видит raw non-2xx текст.
- Клиентское сообщение понятное, техническая причина уходит в логи.

## Риски и зависимости

- Текущая гипотеза по one-time path сильная, но пока не подтверждена runtime-данными.
- UI “сохранённая карта” может вводить в заблуждение, если фактически direct saved-card charge не выполняется.
- Без network/edge proof есть риск сделать blind fix, что запрещено правилами.

## Требуется дополнительная информация

Для закрытия P0 и F2 обязательны:

- runtime network proof;
- edge function logs;
- browser-proof для сценария login внутри модалки;
- before/after подтверждение по consultation и club.