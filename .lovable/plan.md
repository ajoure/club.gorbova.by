&nbsp;

да, согласен, с учетом правок:

1. В Discovery добавь явную проверку по тестовой ссылке a1be127182b0595f567cb4c7fa40241f:  

  - есть ли у неё payment_links.user_id
  - какой status
  - current_uses, max_uses, expires_at  
  Чтобы сразу понимать, идём по ветке has_target_user=true или нет, и не чинить вслепую.
2. На сервере в public-checkout зафиксируй порядок target user resolution:
  - если link.user_id есть → **всегда** использовать его;
  - если link.user_id нет и передан email → искать пользователя по email;
  - если link.user_id нет и email не передан → только тогда ошибка.  
  Это нужно оформить именно как канонический resolution flow, а не просто как частичный фикс guard.
3. В GET ответ public-checkout кроме has_target_user добавь ещё безопасный флаг, который поможет UI:
  - например requires_identity_input = !link.user_id  
  Без раскрытия email и без user_id наружу. Тогда фронт не будет дублировать логику догадками.
4. В клиентском плане явно раздели 3 экрана/состояния:
  - has_target_user=true → только карточка + кнопка оплаты;
  - has_target_user=false && auth.user → кнопка оплаты с уже определённым email;
  - has_target_user=false && guest → inline auth/email.  
  Это должно быть отражено и в UI, и в тестах как отдельные состояния.
5. Для гостя без user_id не ограничивайся формулировкой «inline email → login/signup».  
Прямо добавь:
  - после успешного inline auth/email link-context не теряется;
  - пользователь остаётся на том же /pay/:token;
  - повторный GET/POST использует тот же token без ручного возврата.
6. В DoD добавь отдельный кейс ошибки:
  - ссылка без user_id, гость нажал оплатить без email → понятная inline-ошибка в карточке, без редиректа и без технического текста edge function.  
  Нужно, чтобы UX был законченным, а не только happy path.
7. В серверном PATCH не просто «удалить текст из codebase», а заменить его на более точную развилку:
  - если link.user_id уже есть — этой ошибки вообще быть не должно;
  - если link.user_id нет — ошибка должна быть про необходимость указать email, а не «войти в аккаунт».  
  То есть полностью убрать требование логина как обязательное условие оплаты.
8. В Anti-duplication / scope guards добавь ещё один guard:
  - если discovery покажет, что PublicCheckoutPage уже частично использует другой auth-flow, не писать второй параллельный inline-auth, а переиспользовать существующий источник состояния 1:1.  
  Это важно, чтобы не получить два разных поведения public page.
9. В финальной цели допиши более точно:  
после патча должен стать возможен не просто pending/materialize, а именно **финальный live proof по текущей тестовой ссылке**:
  - открыть ссылку без логина;
  - создать order;
  - оплатить;
  - получить status=paid;
  - получить pipeline_stage_id=stage_on_success;
  - увидеть audit от webhook.  
  Это сразу держит фокус на завершении B.0, а не только на UI-фиксе.

&nbsp;

В остальном план правильный: scope узкий, новый payment-path не создаётся, смысл payment_links.user_id описан верно, и именно этот патч нужен, чтобы добить финальный публичный платёжный сценарий.

## Discovery (что прочитаю до правок)

1. `src/pages/PublicCheckoutPage.tsx` — где источник текста «Для оплаты необходимо войти…», как сейчас работает CTA, как используется `user`/email, где вызывается `public-checkout`.
2. `supabase/functions/public-checkout/index.ts` — уже видел: на POST guard `if (!userId) return errorResponse('Для оплаты необходимо войти в аккаунт или указать email', 400);`. `userId = link.user_id ?? findByEmail(email)`. Это и есть источник серверной ошибки.
3. `src/hooks/useInlineAuth.ts` — переиспользую как есть для случая «ссылка без user_id и гость».
4. `supabase/functions/_shared/create-payment-checkout.ts` — убедиться, что target user передаётся явно и не зависит от JWT.
5. Проверю, что `admin-create-public-link` корректно проставляет `user_id` (для текущей тестовой ссылки `a1be1271…` — посмотрю в БД: есть ли там user_id).

## Канонический смысл `payment_links.user_id` (фиксируется в коде и в memory)

`payment_links.user_id` — это **получатель результата оплаты** (target user для `orders_v2`, доступов, CRM-сделки).
Это **НЕ**:

- ограничение плательщика,
- auth-guard,
- проверка «тот ли пользователь открыл ссылку»,
- требование логина.

Публичную ссылку может открыть и оплатить **кто угодно**, с любого устройства, без логина — если `user_id` задан в ссылке.

## Матрица состояний `/pay/:token`


| `link.user_id` | auth-user    | поведение                                                                                                    |
| -------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| есть           | — (не важно) | сразу активная кнопка «Оплатить», логин не требуется, никакого email-поля; результат уходит в `link.user_id` |
| нет            | авторизован  | email берётся из `auth.user.email`, кнопка активна, оплата сразу                                             |
| нет            | гость        | inline email → login/signup через `useInlineAuth`, без редиректа на `/auth`                                  |


Полностью запрещены состояния: «ссылка для другого аккаунта», «войдите в нужный аккаунт», блок оплаты из-за mismatch auth-user vs `link.user_id`.

## PATCH (scope)

### Server: `supabase/functions/public-checkout/index.ts`

- POST: target user = `link.user_id` если задан → используется напрямую, **без** проверки JWT и без сравнения с текущим пользователем.
- Если `link.user_id` пуст и пришёл `email` → как сейчас (find by email; если нет — создать гостя? — оставляю текущий fallback: возвращаем 400 «Укажите email», но **только** в этой ветке).
- Никогда не блокировать запрос «нужен логин», если `link.user_id` есть.
- GET: добавить в ответ флаг `has_target_user: !!link.user_id` (без раскрытия email — только bool), чтобы UI мог решать, показывать ли email-форму.

### Client: `src/pages/PublicCheckoutPage.tsx`

- Убрать любой guard «нужно войти», когда `has_target_user === true`.
- Если `has_target_user`: показать карточку продукта + одна кнопка «Оплатить», POST `{ url_token }` без email.
- Если `!has_target_user` и `auth.user`: автоматически использовать `user.email`, кнопка «Оплатить» активна, POST `{ url_token, email: user.email }`.
- Если `!has_target_user` и гость: встроенный `useInlineAuth` (email → login/signup) внутри карточки. После успешной авторизации — POST `{ url_token, email }`. Никакого редиректа на `/auth`.
- Все ошибки edge-функции — через `normalizeEdgeFunctionError` (canonical).

### Anti-duplication / scope guards

- Не трогаю `_shared/create-payment-checkout.ts`, `bepaid-webhook`, `grant-access-for-order`, `applyCrmStageOnTerminal`, `admin-create-public-link`. Patch — только UI + 1 серверная ветка target-user в `public-checkout`.
- Не создаю новый payment-path. Materialize и terminal остаются прежними.

## Memory update

- `mem://commercial-logic/payments/public-checkout-architecture` — добавить раздел «Семантика `payment_links.user_id` = target user, не auth-guard. Третье лицо может оплатить.»
- В `index.md` Core добавить one-liner: «Public link `user_id` = получатель оплаты, не плательщик. Логин не требуется, если `user_id` задан.»

## DoD

1. Открыть `/pay/a1be1271…` без логина (ссылка с `user_id`) → сразу активная кнопка, оплата проходит, никакого «войдите в аккаунт».
2. Открыть ту же ссылку с другого устройства / другим человеком → оплата проходит, заказ уходит в `link.user_id`.
3. Открыть ссылку **без** `user_id` гостем → inline email → login/signup, без редиректа на `/auth`.
4. Открыть ссылку **без** `user_id` авторизованным пользователем → email подставлен из `auth.user`, кнопка активна.
5. Нет ни одного сценария «ссылка для другого аккаунта».
6. После оплаты: `current_uses` инкрементируется, `orders_v2` materialized, ready для финального webhook proof.
7. Текст «Для оплаты необходимо войти в аккаунт или указать email» удалён из codebase.

## Финальная цель

После патча `/pay/:token` работает как обычная платёжная ссылка: кто угодно открывает и платит; если аккаунт в ссылке задан — логин не нужен; если нет — мягкий inline email/auth. Это разблокирует финальный live webhook proof B.0 (order → paid → stage_on_success → audit) на уже созданной тестовой ссылке `a1be127182b0595f567cb4c7fa40241f`.