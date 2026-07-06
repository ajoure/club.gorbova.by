## да, согласен, с учетом правок:

```text
1. Диагностику не ограничивать Playwright.
Нужно сначала вручную/через preview воспроизвести конкретно тот баг со скринов:
- новый email;
- появляется details;
- письмо не отправляется;
- оплата стартует без кода.
Это главный regression.

2. Existing email:
не просто `exists/hasProfile`.
Нужно различать:
- user exists + confirmed;
- user exists + unconfirmed;
- profile exists;
- profile has full_name/phone.
Для confirmed existing user можно:
- либо OTP-код как passwordless login;
- либо password-login rollback, если `VITE_INLINE_AUTH_MODE=link`.
Но в OTP-mode не просить ФИО/телефон повторно, если профиль уже заполнен.

3. Identify не должен раскрывать существование email пользователю.
В UI текст должен быть одинаковый:
- “Продолжить”
- “Мы отправим код на email”
Но внутри можно решить, показывать details или нет.
Ошибки не должны говорить “такой email существует/не существует”.

4. Details для нового пользователя:
после ввода имени/телефона обязательно вызвать `signInWithOtp`.
Сейчас, похоже, именно этот вызов не происходит.
Добавить тест:
`details submit -> signInWithOtp called exactly once`.

5. Business action guard:
должен быть не только в parent call-sites, но и в общем уровне:
- `createPayment` / `createLead` нельзя вызвать, если `ensureInlineAuthReady()` вернул false.
Иначе следующий refactor снова сломает.

6. Если `signInWithOtp` вернул ошибку:
- не переходить к оплате;
- не переходить к code-step;
- не создавать user-facing “не удалось продолжить оплату”;
- показывать “Не удалось отправить код. Попробуйте ещё раз.”

7. Real mailbox:
если у агента нет реального inbox, он не имеет права закрывать задачу.
Допустимо использовать:
- Mailtrap;
- test inbox Supabase/Lovable;
- доменный тестовый alias;
- любой mailbox, где можно увидеть код.
Но proof должен показать письмо с кодом.

8. `auth-email-hook` не трогать только если proof показывает:
- webhook вызван;
- письмо ушло;
- код в письме есть.
Если письма нет — diagnose обязан проверить edge logs и шаблон.

9. Rollback smoke:
не достаточно “собрать с link”.
Нужно пройти один реальный flow в link-mode:
- existing email;
- password/login или old flow;
- business action starts after auth.

10. Не закрывать task как blocked/wont_do.
Это live regression и должно оставаться active до PASS.
```

Итоговая команда:

```text
План принимаю.

Approve на PATCH-INLINE-OTP-FIX-BROKEN-FLOW.

Главная цель:
починить регрессию, где оплата/заявка стартует без отправки OTP и без verifyOtp.

Запрещено:
- откатывать OTP целиком;
- закрывать задачу как blocked/wont_do;
- создавать lead/payment до verifyOtp;
- показывать existing/new email различающими сообщениями;
- трогать unrelated auth flows.

Обязательный PASS:
- новый email получает письмо с кодом;
- details submit вызывает signInWithOtp;
- code step появляется;
- verifyOtp создаёт session;
- только потом стартует lead/payment;
- existing email не просит ФИО/телефон повторно, если профиль заполнен;
- no business rows before verify;
- rollback link-mode работает.

План: PATCH-INLINE-OTP-FIX-BROKEN-FLOW
```

Задача — не откатывать OTP, а починить регрессию, из-за которой оплата/заявка стартует без подтверждённой сессии, письмо не уходит, а существующие пользователи снова видят форму «Имя/Фамилия/Телефон».

### Diagnose (обязательно до правок)

1. Пройти реальные сценарии на `gorbova.by/ideologicheskaya-rabota` через Playwright из sandbox с тестовым mailbox (доступный агенту), для 4 flow: LeadRequestDialog, InvoiceCheckoutDialog «По счёту», InvoiceCheckoutDialog «Картой», PublicPayPage.
2. Для каждого — новый email и существующий email. Снять Network:
  - вызовы `POST /auth/v1/otp` (`signInWithOtp`) и их ответ;
  - вызовы `POST /auth/v1/verify` (`verifyOtp`);
  - вызовы `payments-*` / `leads-*` — не должны стартовать до успешного verify.
3. Логи `auth-email-hook`: пришёл ли webhook, отправилось ли письмо, ошибки шаблона.
4. Env: подтвердить `VITE_INLINE_AUTH_MODE=otp` в build; убедиться, что `INLINE_AUTH_MODE` в client резолвится в `otp`.
5. Зафиксировать в отчёте, где именно ломается цепочка (шаг → ожидаемое → фактическое).

### Fix

Все правки — только во frontend inline-auth и его call-sites (без изменения бизнес-логики оплаты/лидов, кроме гварда старта).

1. `useInlineEmailOtp` — добавить шаг `identify` перед `sent`:
  - `identifyEmail(email)` → серверная проверка «есть ли аккаунт» через существующий безопасный путь (RPC/edge, уже используемый в `useInlineAuth.checkEmail`; переиспользовать, не дублировать).
  - Возвращает `{ exists: boolean, hasProfile: boolean }`.
  - Только после identify решаем, показывать ли meta-поля.
2. `InlineEmailOtpForm` — три экрана вместо двух:
  - `email` — только email + CTA «Продолжить»;
  - `details` (условно) — Имя/Фамилия/Телефон, показывается **только если `!exists || !hasProfile**`; CTA «Получить код»;
  - `sent` — как сейчас, ввод OTP;
  - для existing user из шага `email` сразу `signInWithOtp` → `sent`, без meta-полей.
  - Кнопка `sendCode` вызывается **только после явного submit** соответствующего шага. Никогда не автоматически на `onAuthenticated` родителя.
3. Жёсткий guard в call-sites (`LeadRequestDialog`, `InvoiceCheckoutDialog`, `PublicPayPage`, `FormSection`):
  - `onAuthenticated` вызывается **только** из `verifyCode` при успехе (это уже так в `InlineEmailOtpForm`, подтвердить и покрыть тестом).
  - Родитель проверяет `supabase.auth.getUser()` перед `bePaid init` / `create-lead` / `create-order`; если нет user — не стартовать, вернуть UI на шаг `sent` с ошибкой.
  - Добавить общий helper `ensureInlineAuthReady()` (переиспользовать существующий, если есть; иначе тонкий wrapper) и вызывать из всех 4 call-sites одинаково.
4. Ошибка отправки письма:
  - Если `signInWithOtp` вернул ошибку — оставаться на текущем шаге, показывать текст ошибки, **не переключаться** на `sent`, **не** вызывать onAuthenticated, **не** создавать lead/order.
  - Отдельно ловить «email rate limit» и «invalid email» с понятным текстом (уже частично сделано — довести до всех кодов ошибок Supabase).
5. Rollback `VITE_INLINE_AUTH_MODE=link` не трогать — только убедиться smoke-прогоном, что старый password-flow по-прежнему открывается.

### Verify (реальный прогон, не unit-only)

Playwright из sandbox против preview URL, с реальным тестовым mailbox (IMAP или Mailtrap — уточнить, какой доступен; если нет — использовать доменный alias на управляемом ящике):

- новый email → dialog LeadRequest: email → details → «Получить код» → письмо приходит → ввод кода → лид создаётся; без кода лид НЕ создаётся.
- новый email → InvoiceCheckoutDialog (обе кнопки) → тот же путь; bePaid init стартует только после verify.
- новый email → PublicPayPage → аналогично.
- существующий email (тестовый аккаунт с профилем) → email → сразу шаг `sent` без details → verify → продолжение.
- существующий email без письма (симулировать 429) → показывается ошибка, оплата не стартует.
- rollback smoke: собрать с `VITE_INLINE_AUTH_MODE=link`, пройти login существующим паролем в одном из 4 flow.
- unit: `useInlineEmailOtp.identify → sent` routing; `InlineEmailOtpForm` не показывает details для existing; guard в call-sites (моки).

### Proof

`.lovable/proofs/inline_otp_broken_flow_fix_2026_07.md` со скринами: email step, details step (только новый), письмо в inbox, code step, success/payment, Network HAR/скрины до и после для каждого из 4 flow + rollback.

Задача остаётся `in_progress` до полного PASS; не закрывать как `wont_do`/`blocked`.

### Технические детали

- Файлы: `src/hooks/useInlineEmailOtp.ts`, `src/components/auth/InlineEmailOtpForm.tsx`, `src/components/auth/InlineAuthForm.tsx` (проброс `collectSignupMeta` заменить на новую логику через identify), `src/components/lead/LeadRequestDialog.tsx`, `src/components/payment/InvoiceCheckoutDialog.tsx`, `src/pages/PublicPayPage.tsx`, `src/components/site-renderer/blocks/FormSection.tsx`.
- Переиспользовать существующий `useInlineAuth.checkEmail` для identify — не создавать новую RPC.
- Не трогать `auth-email-hook`, если diagnose не показал в нём проблему.
- Никакой work в `supabase/config.toml`, `client.ts`, `types.ts`, `.env`.
- Roadmap: снять `wont_do` с 7 E2E-задач и объединить их под этот PATCH, либо оставить как sub-verify пункты внутри одной активной задачи.