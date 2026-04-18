да, согласен, с учетом правок:

1. В discovery по пункту 1 сразу зафиксируй **точный источник ошибки**:
  - какой именно HTTP status и body возвращает public-checkout POST;
  - на каком шаге это происходит: до createPaymentCheckout или уже внутри него.
2. Это нужно, чтобы не перепутать bug в identity-resolution с багом materialize.
3. В пункте 2 по PublicPayPage.tsx добавь отдельную проверку:
  - что именно происходит после onAuthenticated(email, userId);
  - сохраняется ли auth.step='authenticated';
  - не очищается ли email/session до POST;
  - не вызывается ли POST дважды.
4. Иначе можно починить Bearer-заголовок, а проблема окажется в повторном рендере или race-condition.
5. В discovery по GET /public-checkout для двух токенов добавь сравнение **сырого ответа**:
  - has_target_user
  - requires_identity_input
  - payment_type
  - status
6. Это поможет сразу понять, это bug сервера GET или bug фронтового рендера.
7. В пункте 4 по БД добавь ещё:
  - offer_id
  - description
  - created_by
8. Чтобы потом при live proof было проще связать конкретную ссылку с конкретным сценарием и админом.
9. В корневой причине Bug A уточни, что серверный порядок resolution должен быть именно таким:  

  - link.user_id
  - Authorization / auth.uid
  - email lookup
  - ошибка  
  И это нужно зафиксировать как **канонический contract resolution**, а не просто разовый фикс текущего бага.
10. В PATCH A добавь важный guard:
  - если есть и Authorization, и email, и они указывают на разных пользователей, а link.user_id пустой — приоритет всё равно у JWT, а email игнорируется.
11. Иначе можно получить неоднозначную привязку target user.
12. В PATCH A отдельно пропиши:
  - для bound-ссылки (link.user_id есть) сервер **не должен** использовать email и **не должен** смотреть на JWT для выбора target user;
  - JWT/email в этом случае могут существовать, но только как контекст плательщика, не получателя.
13. Это критично для соответствия вашей бизнес-логике “оплатить может кто угодно”.
14. В PATCH B добавь, что PublicPayPage должен брать access token не разово при монтировании, а **непосредственно перед POST**, через актуальную сессию.  
Иначе после inline login токен может ещё не попасть в первый рендер, и проблема останется.
15. В PATCH B по ошибкам раздели два типа:
  - **ошибка identity-resolution** → вернуть пользователя в inline auth flow;
  - **другая серверная ошибка оплаты** → обычный alert/notification.
16. Иначе можно все ошибки свалить в форму, хотя не все они про логин/email.
17. В PATCH B добавь явное правило для bound-ссылки:

&nbsp;

- если has_target_user === true, requires_identity_input === false, то UI вообще не должен монтировать InlineAuthForm ни при каких условиях.

Это должен быть жёсткий guard, а не просто “не показывать обычно”.

11. В пункте про normalizeEdgeFunctionError уточни:

- серверный текст “Пользователь с таким email не найден” не должен показываться как финальное тупиковое сообщение;
- он должен превращаться в понятную inline-подсказку внутри auth-формы.

Это и есть устранение текущего UX-багa.

12. В DoD добавь ещё один обязательный кейс:

- **guest-ссылка, существующий email, успешный login, но первый POST не удался** → форма остаётся в рабочем состоянии, можно повторить без перезагрузки страницы и без потери token-контекста.

Это защитит от тупика, который у тебя сейчас и наблюдается.

13. В DoD по bound-ссылке уточни финал:

- не только “InlineAuthForm не показывается”,
- но и “POST /public-checkout уходит без email и без login requirement”.

Это важно как серверный контракт.

14. В финальной цели добавь, что после этого патча нужно делать **новый** live proof на свежей guest-ссылке, а не опираться на уже сломанную попытку, чтобы не смешивать старое поведение и новый код.

В остальном план правильный: discovery узкий и по делу, бизнес-логика payment_links.user_id понята верно, scope не расползается, и именно этот патч нужен, чтобы добить корректный guest-flow без принудительного входа в “нужный” аккаунт.

&nbsp;

## Диагноз

На скрине видно ошибку «Пользователь с таким email не найден. Завершите регистрацию и повторите оплату» — но кнопка «Оплатить» при этом активна, а на самом деле сервер возвращает ошибку при POST. То есть UX-логика гостевой ветки сейчас неправильная:

1. **Existing user стучится по guest-ссылке** → `useInlineAuth.checkEmail` корректно отправляет на шаг `login` → пользователь вводит пароль → `supabase.auth.signInWithPassword` успешно → `onAuthenticated(email, userId)` в `PublicPayPage` вызывает POST `/public-checkout` с **email** (не с user_id из сессии).
2. На сервере `public-checkout` POST для guest-ссылки делает `findByEmail(email)` через `auth-find-user-by-email` (или аналогичный lookup). Если lookup идёт через **service-role admin API по `email**`, он работает. Но если он смотрит на `profiles`/`auth.users` и не находит — возвращает «Пользователь с таким email не найден». То есть сейчас сервер не доверяет факту, что пользователь только что залогинился.
3. На фронте показывается красный alert поверх формы, форма уже свёрнута (auth.step === 'authenticated'), и пользователь видит тупик.

Дополнительно: пользователь говорит, что **по ссылке #1 (которая была bound к админу) его всё равно просили логин/пароль**. Это означает, что `has_target_user` либо не пробрасывается с GET, либо UI его не уважает и всё равно показывает InlineAuthForm. Нужно проверить.

## Discovery (read-only, до правок)

1. **Прочитать `supabase/functions/public-checkout/index.ts**` — точная ветка POST для guest. Где именно бросается «Пользователь с таким email не найден». Использует ли она `auth.admin.listUsers({ email })` или JWT-подтверждённый user из заголовка.
2. **Прочитать `src/pages/PublicPayPage.tsx**` — что именно передаётся в POST после `onAuthenticated`. Передаётся ли `userId` или только `email`. Уважается ли `has_target_user` в рендере.
3. **Прочитать GET-ответ `public-checkout**` для обоих токенов через `supabase--curl_edge_functions`:
  - `f3d2bound2byn00000000000000a006` → должно быть `has_target_user: true, requires_identity_input: false`
  - `g4e3free2byn0000000000000000b007` → должно быть `has_target_user: false, requires_identity_input: true`
4. **Проверить в БД `payment_links**` для обоих токенов: `user_id`, `status`, `current_uses`, `max_uses`. Подтвердить, что bound-ссылка действительно имеет `user_id`.
5. **Проверить, есть ли в проекте edge-функция `auth-find-user-by-email` / `auth-check-email**` и что она возвращает для существующего email.

## Корневые причины (ожидаемые)

- **Bug A (критичный)**: `public-checkout` POST для guest-ветки не доверяет JWT/сессии после inline login. Он повторно ищет пользователя «по email» через ненадёжный путь и падает. Правильно: после login браузер уже имеет access_token; PublicPayPage должен передавать его как `Authorization: Bearer <token>`, а сервер — извлекать `auth.uid()` и использовать его как target user.
- **Bug B (UI)**: Bound-ссылка показывает форму логина. Скорее всего `PublicPayPage` рендерит InlineAuthForm безусловно, не глядя на `has_target_user`, либо GET не возвращает этот флаг.
- **Bug C (UX)**: Серверная ошибка показывается красным alert-блоком поверх свёрнутой формы вместо того, чтобы вернуть пользователя на нужный шаг inline-формы. Нарушает «Anti-duplication: тупикового состояния без формы быть не должно».

## PATCH (узкий, add-only где можно)

### A. Server: `supabase/functions/public-checkout/index.ts` — POST

Канонический resolution target user для POST:

1. Если `link.user_id` — использовать его (bound-ссылка).
2. Иначе — извлечь `Authorization: Bearer <token>` из заголовка, вызвать `supabase.auth.getUser(token)`. Если получен валидный `user.id` — использовать его как target user (это покрывает «inline login прямо на странице» и «уже авторизованный пользователь»).
3. Иначе — если передан `email`, искать через `supabase.auth.admin.listUsers` (service role) → если найден, использовать его id; если не найден — 400 «Укажите email и завершите вход/регистрацию».
4. Никаких ситуаций «пользователь только что залогинился, но сервер его не видит».

### B. Client: `src/pages/PublicPayPage.tsx`

- Перед POST `/public-checkout` всегда подставлять текущий access_token из `supabase.auth.getSession()` в `Authorization`-заголовок (если сессия есть). Так сервер увидит свежезалогиненного пользователя.
- При `has_target_user === true` — **никогда** не рендерить InlineAuthForm. Только карточка + кнопка «Оплатить». Жёсткий guard.
- При серверной ошибке — НЕ показывать тупиковый красный alert поверх свернутой формы. Вместо этого:
  - если ошибка про identity и `requires_identity_input` — оставить InlineAuthForm развёрнутым на нужном шаге;
  - текст ошибки нормализовать через `normalizeEdgeFunctionError` и поставить внутрь самой формы (как `auth.error`), а не отдельным блоком над кнопкой.

### C. Anti-duplication / scope guards

- НЕ трогаю `bepaid-webhook`, `_shared/create-payment-checkout.ts`, `grant-access-for-order`, `admin-create-public-link`.
- НЕ создаю второй inline-auth flow — InlineAuthForm + useInlineAuth остаются единственным источником.
- НЕ меняю контракт `useInlineAuth`.
- НЕ дублирую серверные тексты ошибок на клиенте как финальное состояние.

## Memory update

- Обновить `mem://commercial-logic/payments/public-checkout-architecture` — добавить раздел «POST resolution: link.user_id → JWT (auth.uid) → email lookup. Inline-login пользователь = доверенный target user через Authorization-заголовок».
- Уточнить `mem://ui/auth/inline-auth-form-standard.md` — «после `authenticated` callback должен дернуть последующее действие с Bearer-токеном; тупиковый красный alert поверх свёрнутой формы запрещён».

## DoD

1. **Bound-ссылка** (`f3d2bound2byn00000000000000a006`): открытие без логина → InlineAuthForm НЕ показывается → одна кнопка «Оплатить» → оплата уходит в `link.user_id` (admin).
2. **Guest-ссылка, существующий email с правильным паролем**: email → login → пароль → автоматический POST `/public-checkout` с Bearer-токеном → редирект в bePaid → оплата проходит. Никакой ошибки «Пользователь не найден».
3. **Guest-ссылка, существующий email + «Забыл пароль?»**: success-state в той же карточке.
4. **Guest-ссылка, новый email**: signup → (опц. email_confirm) → автоматический POST с Bearer → bePaid.
5. **Guest-ссылка, существующий email с неправильным паролем**: ошибка показывается ВНУТРИ login-формы (`auth.error`), форма остаётся открытой на шаге `login`. Никаких alert-блоков поверх свернутой формы.
6. **Live proof по guest-сценарию**: order → paid → `pipeline_stage_id=stage_on_success` → audit от `bepaid-webhook`. Закрывает повторный B.0 уже по guest-flow.

## Финальная цель

Public payment link работает одинаково ровно во всех трёх состояниях. Existing-пользователь, который заходит по guest-ссылке, может залогиниться прямо тут и оплатить без редиректа и без ошибки «не найден». Bound-ссылка не требует логина вообще. После патча создаём свежие тестовые ссылки и закрываем guest-flow live proof.