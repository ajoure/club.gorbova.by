# PATCH-INLINE-OTP-FIX-BROKEN-FLOW — proof

**Дата:** 2026-07-06
**Тип:** Production regression fix (в дополнение к Phase 2).
**Item:** `79d2d8f6-a08a-4e94-9e25-a9a69d730402`

---

## Что было сломано (по репорту + скриншотам)

1. Модалка `InlineAuthForm` (OTP-режим) показывала email + Имя/Фамилия/Телефон **сразу**, до какой-либо проверки — существующие пользователи получали ненужный вопрос.
2. `signInWithOtp` в некоторых случаях не приводил к переходу на шаг ввода кода; при этом родитель начинал бизнес-действие (оплата/лид) — сессии ещё нет → 500-я «не удалось продолжить оплату».
3. `collectSignupMeta` был захардкожен в `InlineAuthForm` → форма всегда собирала ФИО, даже когда профиль уже заполнен.

## Что исправлено (Diagnose → Fix)

### Diagnose (код)
- В `useInlineEmailOtp` (старая версия): `sendCode` не различал new/existing user, всегда предлагал ФИО извне, полагался на `signInWithOtp(shouldCreateUser:true)` без предварительной идентификации → мелкие ошибки шаблона на стороне auth-email-hook могли молча провалить отправку без блокировки родителя.
- В `InlineEmailOtpForm`: `onAuthenticated` вызывается только из `verifyCode`, **но** родители (`LeadRequestDialog`, `InvoiceCheckoutDialog`, `PublicPayPage`) не имели повторного guard'а на случай, если refactor подменит эту гарантию.

### Fix — код

1. `src/hooks/useInlineEmailOtp.ts` — переписан, новая state-machine:
   - `email` → **silent** `auth-check-email` (identify) → routing:
     - existing user с заполненным `profile_name` → сразу `signInWithOtp` → `sent`;
     - иначе → step `details` (`signInWithOtp` **не** вызывается);
   - `details` → сбор ФИО/телефона → `signInWithOtp` c `options.data` → `sent`;
   - `sent` → `verifyOtp({ type: 'email' })` → `authenticated`.
   - При любой ошибке `signInWithOtp` шаг НЕ меняется, показывается message, `onAuthenticated` не зовётся.
   - Identify **никогда** не раскрывает пользователю existence: одинаковый UI/тексты.

2. `src/components/auth/InlineEmailOtpForm.tsx` — три экрана (email / details / sent), реальный `<input>` под input-otp с `autocomplete="one-time-code"`, `inputmode="numeric"`, `maxlength=6` сохранён.

3. `src/lib/inlineAuth/ensureReady.ts` — расширен, теперь возвращает полноценный `user` (обратная совместимость с `useAwaitInlineAuthReady`) для доп. guard'а перед bePaid init/create-lead в родителях.

4. `InlineAuthForm` — оставлен как обёртка; в OTP-режиме передаёт props в `InlineEmailOtpForm`. Prop `collectSignupMeta` больше игнорируется (routing решает identify).

### Fix — тесты (unit)

- `src/hooks/useInlineEmailOtp.test.ts` — 10 сценариев, ключевые:
  - `submitEmail` для НОВОГО email → `details`, `signInWithOtp` **не** вызван;
  - `submitEmail` для EXISTING профиля → сразу `sent`, `signInWithOtp` вызван 1 раз;
  - `submitDetails(meta)` → `signInWithOtp` с payload `{ full_name, first_name, last_name, phone }` → `sent`;
  - ошибка `signInWithOtp` → шаг остаётся `email`/`details`, message виден, `onAuthenticated` не зовётся;
  - `verifyCode` использует `type: 'email'`; force-resend после 5 неверных попыток;
  - код никогда не попадает в `console.*`.
- `src/components/auth/InlineEmailOtpForm.test.tsx` — рендер-контракт:
  - existing profile → сразу шаг `sent`, AutoFill-контракт (`one-time-code`) на реальном `<input>`;
  - new user → шаг `details`, `signInWithOtp` **не** вызван до нажатия «Получить код».

### Rollback (link-mode)

`VITE_INLINE_AUTH_MODE=link` без изменений — рендерит старый `useInlineAuth` (email → login/signup/reset). Никаких правок в этой ветке.

---

## Что ЕЩЁ требует пройти прежде чем закрывать

Эта часть честно не выполнена в текущей сессии и остаётся в `in_progress`. Ниже — что именно и почему.

### 1. Реальный E2E с настоящим mailbox (BLOCKED — нужен вход)

Требуется в Fix-плане: агент должен провести полный сценарий на живом `gorbova.by/ideologicheskaya-rabota` с получением реального письма. В sandbox я могу поднять Playwright и открыть preview, **но** нет доступного тестового ящика (Mailtrap/IMAP/service-alias), чтобы забрать код без вмешательства пользователя.

**Нужно от пользователя (одно из):**
- креды Mailtrap inbox (host/api-token) → положу в Lovable Secrets, дальше сам;
- SMTP-alias на `@gorbova.by`, чей IMAP доступен из sandbox;
- разрешение пользоваться уже настроенным test-ящиком, если такой существует, — сообщите адрес и способ доступа.

Без этого шага я не буду выставлять задачу `done`.

### 2. Конверсия `PaymentDialog` (1715 строк) на OTP-first (SCOPED OUT)

`PaymentDialog` (кнопки «Оплатить картой» / «По счёту» на pricing-карточках → скриншот 2) имеет **собственный** password/signup-flow (`handleEmailSubmit`, `handleLoginSubmit`, `case "email"/"login"/"additional_info"`), полностью независимый от `InlineAuthForm`. Он всё ещё использует пароль + email-confirmation-link, а не OTP. Это отдельный крупный refactor высокого риска (платёжная логика в том же файле).

**Предлагаю:** отдельный item `PATCH-PAYMENTDIALOG-OTP-MIGRATION` внутри этого же PATCH или сразу после — не смешивать с текущим hotfix `InlineEmailOtpForm`. Готов начать сразу, если подтвердите.

### 3. Diagnose auth-email-hook (не начато)

План требует проверить `edge-function logs` для `auth-email-hook`, шаблон/subject/token. Не выполнено — сначала нужен reproduce на реальном ящике (см. п.1), чтобы отличить bug в hook от bug в UI (текущий фикс закрывает UI-часть).

---

## Файлы этого патча

- `src/hooks/useInlineEmailOtp.ts` — переписан
- `src/hooks/useInlineEmailOtp.test.ts` — переписаны тесты
- `src/components/auth/InlineEmailOtpForm.tsx` — переписан (три шага)
- `src/components/auth/InlineEmailOtpForm.test.tsx` — переписаны тесты
- `src/lib/inlineAuth/ensureReady.ts` — extended (сохранил `user`)
- `src/components/auth/InlineAuthForm.tsx` — без изменений (обёртка)

## Rollback

```
# .env
VITE_INLINE_AUTH_MODE=link
```

Пересобрать. `InlineAuthForm` вернётся к password/email-link flow.

---

# Предыдущий отчёт (Phase 2 verifyOtp probe) — сохранён ниже

## Phase 2.0 — Staging verifyOtp type probe

**Дата:** 2026-07-06

Через одноразовую edge-function `otp-probe-oneshot` подтверждено: `verifyOtp({ type: 'email' })` работает и для `signup`, и для `magiclink` → единый `type: 'email'` в `useInlineEmailOtp`.

| Сценарий | `verifyOtp({ type: 'email' })` | Сессия |
|---|---|---|
| signup (new) | ✅ | ✅ |
| magiclink (existing confirmed) | ✅ | ✅ |
