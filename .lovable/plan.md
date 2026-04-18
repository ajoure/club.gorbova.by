да, согласен, с учетом правок:

1. В Discovery по пункту 1 добавь ещё один обязательный read-only блок по самой payment_links записи:
  - user_id
  - status
  - current_uses
  - max_uses
  - expires_at
  - offer_id
  - payment_type
2. Это нужно, чтобы сразу зафиксировать, почему ссылка №1 относится к bound-сценарию, а ссылка №2 — к guest-сценарию.
3. В Discovery по live proof ссылки №1 добавь отдельную сверку:
  - какой именно order_id был создан из этой ссылки,
  - совпадает ли orders_v2.offer_id со ссылкой,
  - совпадает ли pipeline_stage_id со snapshot.stage_on_success,
  - есть ли запись в audit_logs именно от bepaid-webhook, а не от runtime-equivalent пути.
4. Это нужно, чтобы B.0 закрывался именно живым webhook proof, а не косвенно.
5. В пункте B по useInlineAuth добавь требование не ломать текущие step-сценарии:
  - email
  - login
  - signup
  - authenticated
  - email_confirm
6. Новый password_reset_sent должен быть add-only и не менять существующие переходы между шагами.
7. В requestPasswordReset(email) зафиксируй поведение для пустого email:
  - не вызывать Supabase,
  - показать локальную понятную ошибку в форме.
8. Иначе получится скрытая техническая ошибка вместо нормального UX.
9. В пункте C добавь явный критерий выбора общего компонента:
  - если общий компонент уже есть — переиспользуем его без изменения API;
  - если нет — извлекаем новый InlineAuthForm из существующей реализации FormSection как source-of-truth, а не собираем заново “по мотивам”.
10. Это важно для антидублирования.
11. В пункте C добавь, что InlineAuthForm должен принимать callback вида:
  - onAuthenticated(email, user?)
  - initialEmail?
  - mode/context
12. Чтобы его можно было одинаково использовать в:  

  - PublicPayPage
  - PaymentDialog
  - FormSection  
  без форков логики.
13. В пункте D для PublicPayPage добавь отдельный guard:
  - если requires_identity_input === false, никакой InlineAuthForm вообще не рендерится;
  - если requires_identity_input === true и есть [auth.user.email](http://auth.user.email), email подставляется автоматически и ручной ввод не обязателен.
14. Это нужно, чтобы не сломать already-bound ссылки.
15. В пункте D уточни post-auth поведение:
  - после успешного login/signup не делать redirect на другую страницу;
  - не терять :token;
  - повторный POST должен идти в рамках того же открытого /pay/:token.
16. Это надо зафиксировать как обязательный flow, а не как пожелание.
17. В пункте D добавь сценарий email_confirm:
  - если signup требует подтверждения email, в карточке должно быть понятное сообщение;
  - ссылка остаётся валидной;
  - после подтверждения пользователь возвращается на тот же /pay/:token, а не ищет ссылку заново.
18. В пункте E по PaymentDialog уточни:

&nbsp;

- если там уже есть тот же inline-auth flow, patch может ограничиться только подключением ссылки «Забыл пароль?» через обновлённый useInlineAuth;
- не делать лишний рефакторинг PaymentDialog, если общий компонент там пока не нужен технически.

Это снизит риск побочек.

11. В Anti-duplication guards добавь ещё один:

- не дублировать тексты ошибок edge function на клиенте как финальное состояние;
- серверная ошибка про email должна быть либо устранена серверно, либо отображаться внутри того же InlineAuthForm, а не отдельным тупиковым alert-блоком.

12. В DoD по ссылке №2 уточни три под-сценария:

- существующий пользователь с паролем;
- новый пользователь через signup;
- существующий пользователь, который нажал «Забыл пароль?» и получил success-state.

Без этого можно закрыть только один happy path.

13. В DoD по пункту 3 добавь, что «Забыл пароль?» должен появиться:

- в PublicPayPage,
- в FormSection,
- в PaymentDialog  
если в них есть login-step. Не только на новой странице оплаты.

14. В DoD по пункту 4 уточни формулировку:  
вместо “Текстов … больше нет” лучше зафиксировать так:

- тупикового состояния без формы больше нет;
- если нужен email, рядом сразу есть поле/email-auth UI;
- пользователь не остаётся на пустой ошибке без следующего шага.

15. В финальной цели добавь, что после live proof по ссылке №1 надо отдельно обновить текущий B.0 отчёт:

- closed (live) для webhook proof,
- убрать ограничение “terminal webhook proof не закрыт live”, если оно действительно будет снято фактами.

В остальном план собран правильно: сначала read-only подтверждение уже прошедшей оплаты по bound-ссылке, потом узкий add-only патч общего inline-auth и forgot-password без создания второго guest-flow, затем live proof по guest-ссылке и финальное закрытие B.0.

&nbsp;

## Discovery (read-only)

1. Проверить факт оплаты по ссылке #1 (`d1b0bound1byn00000000000000a004`):
  - `payment_links.current_uses`
  - `orders_v2.status`, `pipeline_stage_id`, `meta`
  - `audit_logs` от `bepaid-webhook`
  - наличие `entitlements` для admin user
2. Прочитать `src/pages/PublicPayPage.tsx` — текущий guest-flow, почему нет email-поля.
3. Найти в site-renderer FormSection (`auth_mode`) каноничный inline-auth UI, который уже использует `useInlineAuth`. Кандидаты:
  - `src/components/site-renderer/sections/FormSection*.tsx`
  - поиск по `useInlineAuth` в `src/`
4. Проверить, есть ли в найденном компоненте ветка «Забыл пароль» / `resetPasswordForEmail`. Если нет — спроектировать минимальное добавление в общий `useInlineAuth` (новый метод `requestPasswordReset`), чтобы переиспользовалось и в PaymentDialog, и в PublicPayPage, и в FormSection.

## Проблемы и причины (ожидаемые)

- **#1 — оплата прошла.** Нужен read-only proof из БД (live webhook proof для B.0).
- **#2 — гостю показывает «Укажите email», но поля нет.** Текущий PublicPayPage в guest-ветке, видимо, не рендерит inline-auth UI или рендерит только сообщение об ошибке. Нужно подключить тот же UI-компонент, что используется в FormSection `auth_mode` — без дублирования.
- **«Забыл пароль» отсутствует** в inline-auth (PaymentDialog / FormSection / PublicPayPage). Текущий `useInlineAuth` не имеет `requestPasswordReset`.

## Канонический контракт inline-auth (после патча)

`useInlineAuth` — единственный источник для всех guest/identity-форм:

- PaymentDialog
- site-renderer FormSection (`auth_mode`)
- PublicPayPage (guest-ветка)

Шаги: `email` → (`login` | `signup`) → `authenticated`.
На шаге `login` обязательна ссылка **«Забыл пароль?»** → новый метод `requestPasswordReset(email)` → `supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' })` → шаг `password_reset_sent` (тост + сообщение в карточке).

## PATCH (scope, anti-duplication)

### A. Live webhook proof по ссылке #1 (только чтение)

SELECT по `payment_links`, `orders_v2`, `audit_logs`, `entitlements` → отчёт без правок.

### B. `src/hooks/useInlineAuth.ts` — расширение, не дублирование

- Добавить шаг `password_reset_sent` в `InlineAuthStep`.
- Добавить метод `requestPasswordReset(email): Promise<boolean>` (обёртка над `supabase.auth.resetPasswordForEmail` с `redirectTo: window.location.origin + '/reset-password'`).
- Никаких изменений существующих методов / контрактов / текстов ошибок.

### C. Найти/выделить общий inline-auth UI-компонент

- Если в site-renderer FormSection уже есть отдельный компонент (например, `InlineAuthForm.tsx`) — переиспользовать его 1:1.
- Если его нет (логика встроена в FormSection) — **извлечь** в `src/components/auth/InlineAuthForm.tsx` с теми же шагами/текстами, и заменить inline-блок в FormSection на этот компонент. Без изменения UX.
- Добавить в компонент кнопку «Забыл пароль?» на шаге `login` → вызывает `requestPasswordReset`, показывает success-state.

### D. `src/pages/PublicPayPage.tsx`

- В guest-ветке (`requires_identity_input === true && !user`) рендерить `<InlineAuthForm />` вместо текущего сообщения об ошибке.
- После `step === 'authenticated'` — автоматически вызывать тот же POST `/public-checkout` с `email` от завершившейся авторизации.
- При `step === 'email_confirm'` — показать сообщение «Подтвердите email и вернитесь на эту страницу», ссылка остаётся валидной (тот же `:token`).
- Никаких изменений в трёх других UI-состояниях (target_user / authenticated).

### E. PaymentDialog

- Заменить inline-блок (если он там встроен) на тот же `<InlineAuthForm />`. Только если patch C извлекает компонент. Если PaymentDialog уже использует общий компонент — не трогаем.

### F. Anti-duplication guards

- НЕ создавать второй inline-auth flow.
- НЕ менять `_shared/create-payment-checkout.ts`, `bepaid-webhook`, `public-checkout` (они уже корректны после прошлого патча).
- НЕ менять контракт `useInlineAuth` существующих методов.
- `/reset-password` страница уже должна существовать (стандарт Lovable). Если её нет — discovery покажет, и я добавлю минимальную страницу в этот же патч.

## Memory update

- `mem://commercial-logic/payments/public-checkout-architecture` — добавить: «Guest-ветка `/pay/:token` рендерит общий `InlineAuthForm` (тот же, что в site-renderer FormSection и PaymentDialog). Никаких отдельных guest-форм».
- Новый файл `mem://ui/auth/inline-auth-form-standard.md` — «`InlineAuthForm` + `useInlineAuth` — единый источник identity/login/signup/forgot-password для всех публичных форм. Дублирование запрещено».
- `mem://index.md` Core: добавить one-liner про InlineAuthForm как единый компонент.

## DoD

1. **Ссылка #1 (bound)**: подтверждённый live proof — `orders_v2.status='paid'`, `pipeline_stage_id=stage_on_success`, audit от `bepaid-webhook`, `current_uses=1`, entitlement создан. Финальное закрытие B.0.
2. **Ссылка #2 (guest)**: открытие без логина → видна форма email → существующий email → форма пароля + ссылка «Забыл пароль?» → новый email → форма signup. Все варианты ведут к успешной оплате того же `:token` без редиректа на `/auth`.
3. **Forgot password**: на любом шаге `login` (PaymentDialog, FormSection, PublicPayPage) есть «Забыл пароль?» → отправка письма → success-state в той же карточке.
4. **Anti-duplication**: только один компонент `InlineAuthForm`, только один хук `useInlineAuth`. Текстов «Укажите email для оформления оплаты» как тупиковой ошибки больше нет — это состояние всегда сопровождается формой ввода.
5. **Existing UX intact**: PaymentDialog, FormSection (`auth_mode`) визуально и по шагам не меняются (кроме появления «Забыл пароль?»).

## Финальная цель

`/pay/:token` для guest-ссылок работает по тому же inline-auth UX, что и формы конструктора сайтов и PaymentDialog. «Забыл пароль?» доступен везде, где есть login-шаг. B.0 закрыт live proof по ссылке #1.