# да, согласен, с учетом правок:

```text
1. План можно запускать, но сначала только Discovery.
Код/шаблоны/интеграции — после discovery-отчёта.

2. Важно проверить Supabase OTP contract до массового перехода:
- точно ли `verifyOtp({ type: 'email' })` работает и для новых пользователей, и для существующих;
- не нужен ли `type: 'signup'` или `type: 'magiclink'` в вашей версии supabase-js;
- какие типы реально приходят в `auth-email-hook`.

Не угадывать тип `verifyOtp`.

3. По `/auth` регистрации:
не ломать password-flow.
Если пользователь вводит пароль при регистрации, после OTP нужно безопасно установить пароль через `updateUser({ password })`.
Если это нестабильно — `/auth` переводить вторым этапом, а первым перевести только inline-flow.

4. По email-шаблонам:
согласен, код должен быть крупный и удобный.
Но ссылка должна остаться вторичным fallback внизу письма, чтобы старые/нестандартные клиенты не блокировали регистрацию.

5. AutoFill:
добавить в proof, что это best-effort.
Нельзя обещать, что iPhone/Android всегда предложит код из email.
Но обязательны атрибуты:
- `autocomplete="one-time-code"`
- `inputmode="numeric"`
- `name="one-time-code"`
- `<form>` + submit
- paste-friendly.

6. `FormSection` и site-builder forms:
переводить только если discovery подтвердит, что там реально есть signup/auth_mode.
Если это другой тип формы без регистрации — не трогать.

7. Recovery, invite, reauthentication:
не переводить в этом патче.
Recovery остаётся link-primary.
Invite оставить link.
Reauthentication не трогать.

8. Обязательно добавить feature rollback:
если OTP-flow в проде даст сбой, нужно иметь возможность быстро вернуть link-based inline auth.
Минимум:
- сохранить старый `useInlineAuth`;
- не удалять старые call-sites без возможности отката;
- отметить в proof, как откатить.

9. Не логировать код:
проверить не только `console.log`, но и edge logs, email hook logs, Playwright artifacts.
В proof не вставлять реальные коды от production-пользователей, только test token/masked.

10. Playwright:
если реальную почту сложно тестировать, допустим mock/inbucket/test hook, но должен быть хотя бы один smoke с реальным письмом на тестовый email и скрином письма.
```

Итог:

```text
План принимаю.

Approve на Discovery PATCH-INLINE-AUTH-EMAIL-OTP-FLOW.

После discovery можно переходить к реализации, если подтвердится:
- Supabase OTP работает с вашим auth-email-hook;
- verifyOtp type выбран правильно;
- password-login не ломается;
- список call-sites точный.

Цель правильная:
единый OTP-код по всей платформе, без потери контекста и без перехода по ссылкам.

PATCH-INLINE-AUTH-EMAIL-OTP-FLOW (единый стандарт + OTP AutoFill)
```

STOP P3/P4 handoff-flow. Новая стратегия: **OTP-код — единый стандарт подтверждения email по всей платформе**. Email-ссылки больше не primary UX, остаются только как fallback для recovery / уже отправленных писем.

## Целевое правило

- Ни один registration / inline-flow не требует перехода по email-ссылке.
- Везде — 6-значный код в том же интерфейсе, где начали действие.
- OTP-поле поддерживает system AutoFill (Apple SMS-style) там, где браузер/OS это умеют.
- `AuthVerifyProxy` остаётся только для recovery и переходного периода старых писем.
- `/dashboard` не открывается до завершения текущего inline-действия.

## Discovery

Оформить в `.lovable/discovery/inline_auth_email_otp.md`.

### A. Supabase Auth OTP surface

1. `signInWithOtp({ email, options: { shouldCreateUser: true, data: {...meta} } })` — БЕЗ `emailRedirectTo`.
2. `verifyOtp({ email, token, type: 'email' })` → `session`.
3. Password-less signup совместим с последующим `updateUser({ password })` / recovery.
4. Rate-limits Supabase (~4/час/email, ~30/час/IP).
5. Экспирация OTP: Supabase default 60 мин, UI-таймер 10 мин.

### B. Карта всех email-flows (закрыть все 13 строк)


| #   | Flow                         | Файл                               | Сейчас | Целевое                                       |
| --- | ---------------------------- | ---------------------------------- | ------ | --------------------------------------------- |
| 1   | `/auth` регистрация          | `Auth.tsx` + `AuthContext.signUp`  | link   | OTP                                           |
| 2   | LeadRequestDialog            | `LeadRequestDialog.tsx`            | link   | OTP                                           |
| 3   | PaymentDialog                | `PaymentDialog.tsx`                | link   | OTP                                           |
| 4   | InvoiceCheckoutDialog        | `InvoiceCheckoutDialog.tsx`        | link   | OTP                                           |
| 5   | PublicPayPage                | `PublicPayPage.tsx`                | link   | OTP                                           |
| 6   | Preregistration Dialog       | найти                              | ?      | OTP если есть                                 |
| 7   | FormSection auth_mode        | `FormSection.tsx`                  | link   | OTP                                           |
| 8   | site-builder public forms    | `public/embed/form.js` + sitePages | ?      | OTP если есть signup                          |
| 9   | Все поддомены `*.gorbova.by` | те же компоненты                   | link   | OTP (проблема исчезает)                       |
| 10  | Личный кабинет / onboarding  | `dashboard/*`, `onboarding/*`      | ?      | OTP если есть email confirm                   |
| 11  | Password recovery            | `/reset-password`                  | link   | **link остаётся**                             |
| 12  | Email change                 | `updateUser({email})`              | link   | OTP через `type='email_change'` если возможно |
| 13  | Invite                       | если используется                  | link   | оставить link                                 |


DoD discovery: все 13 строк закрыты, файлы и решения зафиксированы.

## Target UX

```text
Step 1 — email
  [email input, autocomplete="email"]
  [Получить код]  (внутри <form onSubmit>)

Step 2 — code
  «Мы отправили код на you@x.com. Введите его ниже.»
  [ 6 ячеек — визуально ]  ← autoFocus, paste-friendly
  [Подтвердить]           ← submit кнопка (важно для autofill)
  [Отправить снова] (disabled 60 сек)
  [Изменить email]

Step 3 — authenticated
  Автопродолжение оригинального сценария.
```

Generic-ошибки: invalid_code / expired / rate_limited / network. Не показываем «email существует / не существует».

## OTP AutoFill (Apple SMS-style)

Цель: iOS/macOS/Android должны предложить код из письма над клавиатурой, как для SMS.

### UI-требования (обязательные)

1. **Основной input** — один `<input>` с полным набором атрибутов, даже если визуально показываем 6 ячеек:
  ```html
   <input
     id="one-time-code"
     name="one-time-code"
     autocomplete="one-time-code"
     inputmode="numeric"
     pattern="[0-9]*"
     maxlength="6"
     autoFocus
   />
  ```
2. **Не** ставить `autocomplete="off"` ни на форму, ни на input.
3. Input обязан быть внутри `<form onSubmit>` c кнопкой submit — это критично для autofill-подсказки iOS.
4. Визуальные 6 ячеек:
  - Реализация — либо shadcn `InputOTP` (input-otp lib) с проверкой, что он рендерит один real `<input>` с нужными атрибутами (проверить в discovery); либо самописный оверлей поверх одного нативного input.
  - При не-подходящем `InputOTP` — сделать overlay: один hidden-но-focusable `<input autocomplete="one-time-code">` полностью растянут поверх 6 визуальных ячеек, ячейки — `pointer-events: none`, `aria-hidden`; ввод/paste идёт в реальный input, ячейки отображают его value по индексу.
5. Paste «123456» раскладывает по 6 ячейкам.
6. Autosubmit при полной длине 6 (но submit-кнопка тоже видна, для autofill-flow).
7. Мобильный viewport: код-input autoFocus при монтировании step=code.

### Email-требования (обязательные)

1. **Subject**: `«Ваш код: {{ .Token }}»` (Supabase-переменная).
2. **Preview text** (первая строка HTML): `Ваш код: {{ .Token }}`.
3. **HTML тело**:
  - Крупный код `{{ .Token }}` — 40–48px, monospace (`'SF Mono', Menlo, Consolas, monospace`), letter-spacing 8–12px, чёрный на `#F4F6FA`, padding 24px, radius 12px, по центру.
  - Заголовок: «Ваш код подтверждения».
  - Подтекст: «Введите этот код на странице, где вы начали регистрацию. Код действует 10 минут.»
  - Отдельная строка для копирования (monospace, БЕЗ пробелов): `Код для копирования: {{ .Token }}`.
  - **Никакого JS/copy-button** — email-клиенты блокируют.
  - Ссылка `{{ .ConfirmationURL }}` — вторичный fallback мелким шрифтом, «Если не удалось ввести код — откройте эту ссылку».
4. **Plain-text версия** (обязательна для autofill Apple):
  ```
   Ваш код подтверждения: 123456

   Введите этот код на странице, где вы начали регистрацию.
   Код действует 10 минут.
  ```
   Одна отдельная строка с меткой «код» и числом — Apple/iOS парсит именно этот паттерн.

### Проверка платформ (в proof)

- **iOS Safari + Mail** — «Из сообщений [Mail]: 123456» над клавиатурой при фокусе на OTP-input.
- **macOS Safari + Mail** — AutoFill code подсказка.
- **Android Chrome + Gmail** — где поддерживается, всплывает подсказка.
- **Desktop Chrome/Edge/Firefox** — минимум работает paste и browser autofill.
- Явное disclaimer в proof: гарантия autofill из email — только best-effort, зависит от OS/клиента. SMS-уровня гарантии нет.

## Email-шаблоны

Файлы:

- `signup.tsx` — переработать (OTP-first, все требования выше).
- `magic-link.tsx` — переработать аналогично.
- `email-change.tsx` — если discovery решит на OTP, тоже.
- `recovery.tsx` — оставить (link primary).
- `invite.tsx`, `reauthentication.tsx` — не трогать.

В `auth-email-hook`:

- Проверить, что `payload.data.token` не логгируется (сейчас логгируется только `emailType`, `recipient`, `run_id` — ok).
- Убедиться, что plain-text рендер (`renderAsync(..., { plainText: true })`) корректно выдаёт строку «Ваш код подтверждения: 123456».
- `Subject` для `signup`/`magiclink` → `«Ваш код: <token>»` (сейчас статический «Подтверждение почты»; добавить динамику).

Deploy: `supabase--deploy_edge_functions(['auth-email-hook'])`.

## Implementation

### 1. Hook `src/hooks/useInlineEmailOtp.ts`

```ts
export type OtpStep = 'email' | 'code' | 'verifying' | 'authenticated' | 'error';

export function useInlineEmailOtp(opts?: {
  meta?: { firstName?: string; lastName?: string; phone?: string };
  onAuthenticated?: (userId: string) => void;
}): {
  step; email; error; cooldownSec; attemptsLeft;
  requestCode(email); verifyCode(code); resend(); changeEmail(); reset();
};
```

Внутри:

- `requestCode` → `signInWithOtp({ email, options: { shouldCreateUser: true, data: meta } })`.
- `verifyCode` → `verifyOtp({ email, token, type: 'email' })` → `ensureInlineAuthReadyWithRetry` (P2) → `onAuthenticated`.
- `resend` — cooldown 60 сек, timer в state.
- 5 подряд invalid → force-resend hint.
- Ошибки → generic-тексты; сырое — в `console.warn` (без token).

### 2. UI `src/components/auth/InlineEmailOtpForm.tsx`

- `<form onSubmit>` вокруг email-step и code-step.
- Code-step:
  - Проверить `input-otp` API — если поддерживает `autoComplete="one-time-code"` + `inputMode="numeric"` на root input, используем как есть.
  - Иначе — оверлей: один нативный input с всеми atributos + 6 визуальных ячеек.
- Autosubmit при 6 цифр.
- autoFocus на mount code-step.
- Props: `defaultEmail?`, `meta?`, `onAuthenticated`, `onCancel?`, `variant?: 'dialog' | 'page'`.

### 3. Интеграция

Заменить `useInlineAuth` (link-based) на `useInlineEmailOtp` внутри:

- `LeadRequestDialog`, `PaymentDialog`, `InvoiceCheckoutDialog`, `PublicPayPage`, `FormSection` (auth_mode), Preregistration Dialog (если есть), site-builder форм (если есть signup).

После `onAuthenticated` — оригинальный action продолжается в том же mount.

### 4. `/auth` регистрация

- Заменить `supabase.auth.signUp({...emailRedirectTo})` на `signInWithOtp({...shouldCreateUser:true, data:{...meta}})`.
- Показать `InlineEmailOtpForm` (variant='page') после ввода email+password+name+phone.
- Password записываем через `updateUser({password})` после `verifyOtp` success.
- После success → редирект на `next` param или `/dashboard`.
- `signInWithPassword` для существующих users — без изменений.

### 5. AuthVerifyProxy — не трогаем

Fallback для recovery + старых писем.

### 6. Cleanup

- `useInlineAuth` link-based → `@deprecated`, удалить call-sites, файл оставить на 1 релиз.
- `emailRedirectTo` — grep: остаётся только в `resetPasswordForEmail`.

## Security

- Rate-limit — встроенный Supabase.
- Локальный cooldown 60 сек — UX.
- Generic errors, нет утечки существования email.
- Не создаём orders/leads/completion до `verifyOtp` success + `ensureInlineAuthReadyWithRetry ok`.
- zod-валидация email до `signInWithOtp`.
- Логи: нет `token`/`code` (frontend + edge).

## Verify

### Unit (vitest) — `useInlineEmailOtp`

1. `requestCode` → `step='code'`, `cooldownSec=60`.
2. `verifyCode` success → `step='authenticated'`, `onAuthenticated` вызван.
3. `verifyCode` invalid → `error='invalid_code'`, `step='code'`.
4. `resend` заблокирован при `cooldownSec>0`.
5. `changeEmail` → `step='email'`, cooldown сброшен.
6. 5 invalid → force-resend hint.
7. `expired` → error.

### Unit (vitest) — email templates

8. `signup.tsx` HTML содержит `{{ .Token }}` крупно, monospace, letter-spacing.
9. Plain-text содержит строку `Ваш код подтверждения: <TOKEN>` (проверить через `renderAsync({plainText:true})` c sample token).
10. Subject-функция возвращает `«Ваш код: <TOKEN>»`.
11. Нет `<script>` тегов, нет `onclick`.

### Playwright (`e2e/otp/*.spec.ts`)

12. `/auth` регистрация: email → код → редирект в кабинет.
13. Lead flow: код → заявка ушла.
14. PaymentDialog: код → bePaid стартует.
15. InvoiceCheckoutDialog: код → bePaid стартует.
16. PublicPayPage: код → bePaid стартует.
17. FormSection: код → форма submit.
18. Неверный код → generic error.
19. Resend → новый код (мок) работает.
20. Assertion: `location.pathname !== '/dashboard'` до завершения.
21. Assertion в DOM: OTP-input имеет `autocomplete="one-time-code"`, `inputmode="numeric"`, `name="one-time-code"`, находится внутри `<form>` с submit-кнопкой.
22. Paste `123456` в OTP → раскладывается по ячейкам → autosubmit.
23. Мобильный viewport (375×667): код-input autoFocus, submit виден.

### Ручная проверка платформ (в proof)

24. iOS Safari + Mail: подсказка `From Messages/Mail: 123456`.
25. macOS Safari + Mail: AutoFill code.
26. Android Chrome + Gmail: если появляется — фиксируем.
27. Desktop Chrome/Edge/Firefox: paste + browser autofill.

Все скрины: `.lovable/proofs/inline_otp/*.png` + отчёт `.lovable/proofs/inline_otp_flow.md` с disclaimer «autofill из email — best-effort, не гарантия».

## DoD

1. Discovery — 13 flow-строк закрыты.
2. Email-шаблон OTP-first: крупный код monospace, plain-text строка `Ваш код подтверждения: N`, Subject `«Ваш код: N»`, ссылка вторична, без JS.
3. `useInlineEmailOtp` + `InlineEmailOtpForm` — есть, unit-тесты 7/7 зелёные.
4. OTP-input имеет полный набор autofill-атрибутов, находится в `<form>` с submit — assertion в Playwright.
5. Все inline call-sites на OTP-flow.
6. `/auth` регистрация на OTP-flow.
7. Email-ссылки как primary CTA не используются нигде, кроме recovery (grep-подтверждено).
8. AuthVerifyProxy — fallback для recovery + старых писем.
9. Password-login существующих users не сломан.
10. `/dashboard` не открывается до завершения flow (Playwright assertion).
11. submit-lead / bePaid / signup стартуют только после `verifyOtp ok` + `ensureInlineAuthReadyWithRetry ok`.
12. Playwright proof + ручные скрины iOS/macOS/Android с disclaimer.
13. `.lovable/plan.md` обновлён: P3/P4/P5 сняты, зафиксирована новая стратегия.

## Порядок работы

1. Discovery (13 строк + проверка `input-otp` API на autofill-атрибуты).
2. Email-шаблоны (`signup.tsx`, `magic-link.tsx`, при необходимости `email-change.tsx`) + subject/plain-text + deploy `auth-email-hook`.
3. Hook + UI-компонент + unit-тесты.
4. Интеграция во все inline call-sites.
5. `/auth` регистрация → OTP.
6. Playwright proof (12+ автотестов) + ручные скрины платформ.
7. Cleanup + обновление `.lovable/plan.md`.

После аппрува — приступаю в этом порядке.