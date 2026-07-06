# PATCH-INLINE-AUTH-EMAIL-OTP-FLOW — inline OTP proof

Живой отчёт по Фазе 2. Дополняется по мере выполнения шагов.

---

## Phase 2.0 — Staging verifyOtp type probe

**Дата:** 2026-07-06
**Инструмент:** одноразовая edge-function `otp-probe-oneshot` (deploy → invoke → удалить).
**Тестовый email:** `otp-probe+staging@gorbova.by` (создаётся и удаляется внутри probe, не рассылается).

### Метод

Для двух сценариев (`signup` и `magiclink`) через `supabase.auth.admin.generateLink` получен реальный `email_otp`, затем вызван `supabase.auth.verifyOtp({ email, token, type: 'email' })` с anon-клиента. Проверялось: (a) успех верификации, (b) выдача сессии.

### Результат

| Сценарий | `generateLink` вернул `email_otp` | `verifyOtp({ type: 'email' })` | Сессия выдана |
|---|---|---|---|
| `signup` (новый пользователь) | ✅ | ✅ | ✅ |
| `magiclink` (существующий подтверждённый) | ✅ | ✅ | ✅ |

Fallback на `type: 'signup'` / `type: 'magiclink'` **не потребовался**.

### Решение

- **Единый `type: 'email'`** в `useInlineEmailOtp.verifyOtp()` для всех inline-flows.
- Fallback-цепочка (`email → signup → magiclink`) в коде **не нужна** — упрощает hook.
- В `signInWithOtp` оставляем `shouldCreateUser: true` (auto-detect new vs existing на стороне Supabase — тот же контракт, что даёт `email_otp` в обоих случаях).

### Артефакт probe (raw)

```json
{
  "email": "otp-probe+staging@gorbova.by",
  "recommendation": "type: 'email' works for BOTH flows — use unified",
  "steps": [
    { "step": "generateLink:signup",                     "got_otp": true },
    { "step": "verifyOtp signup token, type=email",      "ok": true, "session": true },
    { "step": "createUser for magiclink",                "ok": true },
    { "step": "generateLink:magiclink",                  "got_otp": true },
    { "step": "verifyOtp magic token, type=email",       "ok": true, "session": true }
  ]
}
```

Sb-Request-Id: `019f3762-3236-7367-990d-9f0ec0e3d29c` · region: `eu-central-1` · status 200.

Probe-функция и её запись в `supabase/config.toml` удалены после сбора proof (см. следующий коммит).

---

## Phase 2.1 — Open questions (call-site scope)

**Дата:** 2026-07-06. Метод: `rg -l "useInlineAuth|InlineAuthForm|signInWithOtp|auth.signUp|email_confirmed|emailRedirectTo|AuthVerifyProxy"` по подозреваемым файлам.

| Вопрос | Файл | Есть inline auth / email confirm? | Решение |
|---|---|---|---|
| E.1.1 PaymentDialog | `src/components/payment/PaymentDialog.tsx` | ❌ нет `useInlineAuth`, нет `signUp`, нет `emailRedirectTo` | **Вне scope** — не трогаем |
| E.1.1 ConsultationPaymentDialog | `src/components/payment/ConsultationPaymentDialog.tsx` | ❌ то же | **Вне scope** |
| E.1.2 PreregistrationDialog | `src/components/course/PreregistrationDialog.tsx` | ❌ ничего auth-related | **Вне scope** |
| E.1.3 WelcomeOnboardingModal (dashboard onboarding) | `src/components/onboarding/WelcomeOnboardingModal.tsx` | ❌ нет email confirm | **Вне scope** |

Полный список `useInlineAuth` / `InlineAuthForm` в проекте — ровно **4 call-site**, совпадает с одобренным scope:

```
src/components/lead/LeadRequestDialog.tsx
src/components/payment/InvoiceCheckoutDialog.tsx
src/components/site-renderer/blocks/FormSection.tsx
src/pages/PublicPayPage.tsx
```

Плюс инфраструктура (`src/hooks/useInlineAuth.ts`, `src/components/auth/InlineAuthForm.tsx`) — остаётся as-is для rollback.

**Вывод:** scope Phase 2 закрыт, риска расширения нет.


## Phase 2.2 — Реализация OTP inline-flow

### Новые файлы

| Файл | Роль |
|---|---|
| `src/lib/inlineAuth/mode.ts` | Env-flag `VITE_INLINE_AUTH_MODE=otp|link`, default `otp` |
| `src/hooks/useInlineEmailOtp.ts` | OTP-first hook: `sendCode` (signInWithOtp без `emailRedirectTo`) → `verifyCode` (`verifyOtp({ type: 'email' })`) → `authenticated`. Metadata (name/phone) применяется после verify через `updateUser`. Cooldown 60s, счётчик неверных попыток, force-resend после 5 |
| `src/components/auth/InlineEmailOtpForm.tsx` | UI: email step (+ опциональные name/phone) → 6-cell OTP. Under-the-hood `<input>` из `input-otp` получает `autocomplete="one-time-code" inputmode="numeric" name="one-time-code" id="one-time-code" maxlength="6"`. Auto-submit по достижении 6 цифр. `<form>` с submit-кнопкой — обязательно для iOS AutoFill |

### Изменения без слома контрактов

- `src/components/auth/InlineAuthForm.tsx` — короткий guard в начале компонента: при `INLINE_AUTH_MODE === "otp"` рендерит `InlineEmailOtpForm` с теми же props (initialEmail, onAuthenticated, contextNote, externalLoading). Все 4 call-site автоматически получили OTP-flow **без изменений** в их коде.
- `src/hooks/useInlineAuth.ts` — помечен `@deprecated`, остаётся только для rollback.

### Затронутые call-sites (без правок кода)

```
src/components/lead/LeadRequestDialog.tsx       — LeadRequestDialog
src/components/payment/InvoiceCheckoutDialog.tsx — InvoiceCheckoutDialog
src/components/site-renderer/blocks/FormSection.tsx — публичные формы (auth_mode)
src/pages/PublicPayPage.tsx                      — публичная страница оплаты
```

### Session-ready guard для payments/leads

`src/lib/inlineAuth/ensureReady.ts` (существующий) вызывается вызывающими диалогами **перед** submit-lead-request / bePaid. После `verifyOtp({type:'email'})` Supabase кладёт валидную сессию в `localStorage.supabase.auth.token`, `getSession()` → `getUser()` возвращают `email_confirmed_at` — 401 `email_not_confirmed` больше невозможен. Handoff-логики (`AuthVerifyProxy`, BroadcastChannel) в OTP-flow нет: всё происходит в одной вкладке.

## Phase 2.3 — Email templates (signup + magic-link)

### Обновлено

- `supabase/functions/_shared/email-templates/signup.tsx`
- `supabase/functions/_shared/email-templates/magic-link.tsx`

Единый OTP-first layout:

- Крупный 44px `monospace` код, `letter-spacing: 10px`, фон `#F4F6FA`, `border-radius: 12px`.
- Отдельная plain-text строка `«Ваш код подтверждения: {{token}}»` — критично для iOS/macOS Mail one-time-code AutoFill (регекс-парсер Apple ищет эту фразу).
- Ссылка `{{ .ConfirmationURL }}` оставлена, но во второстепенном сноском формате — как fallback для клиентов без визуального рендера кода.
- Копирование через JS не пытаемся (email-клиенты блокируют).
- 10 минут срок жизни в тексте.

### Тема письма

`supabase/functions/auth-email-hook/index.ts` — для `signup` и `magiclink` тема динамическая: `Ваш код: {{token}}`. Пользователь видит код в push-уведомлении и списке писем без открытия. `recovery`, `invite`, `reauthentication`, `email_change` — темы не тронуты.

### Не тронуты

- `recovery.tsx`, `invite.tsx`, `reauthentication.tsx`, `email-change.tsx` — сохранён link-based UX.
- `auth-actions` edge function — не тронута (используется `useInlineAuth` в link-режиме).

### Deploy

`auth-email-hook` задеплоен: `Successfully deployed edge functions: auth-email-hook`.

## Phase 2.4 — Тесты

### Unit (vitest)

`src/hooks/useInlineEmailOtp.test.ts` — 8 тестов, все PASS:

1. `sendCode` вызывает `signInWithOtp` **без** `emailRedirectTo`, с `shouldCreateUser: true`.
2. `sendCode` пробрасывает signup-metadata в `options.data`.
3. `verifyCode` использует `type: 'email'` и переходит в `authenticated`.
4. `verifyCode` инкрементит `invalidAttempts` на ошибке и **не логирует** значение кода (regex-скан над `console.error`).
5. После 5 неверных попыток показывается force-resend hint.
6. `resend` заблокирован до истечения cooldown.
7. `changeEmail` сбрасывает состояние.
8. Пустой / короткий код → возврат `null`, `verifyOtp` не вызывается.

```
✓ src/hooks/useInlineEmailOtp.test.ts (8 tests) 57ms
  Test Files  1 passed (1)
       Tests  8 passed (8)
```

### AutoFill smoke

`src/components/auth/InlineEmailOtpForm.test.tsx` — 2 теста, PASS. Реальный DOM-render проверяет, что после отправки кода в документе есть `<input id="one-time-code">` с атрибутами:

- `autocomplete="one-time-code"`
- `inputmode="numeric"`
- `name="one-time-code"`
- `maxlength="6"`

Это тот самый контракт, который iOS Safari / macOS Mail ищут для показа предложения кода над клавиатурой / в AutoFill-строке.

```
✓ src/components/auth/InlineEmailOtpForm.test.tsx (2 tests) 301ms
```

### Что заменяет полный Playwright

Полный e2e-сценарий с реальным email-inbox в данном патче невыполним автоматически (SMTP-inbox под ключом Яндекса). Покрытие достигается стековой проверкой:

- **Реальная verifyOtp** — staging-probe Фазы 2.0 (см. § Phase 2.0) с настоящим `email_otp` от Admin API.
- **Реальный AutoFill-контракт DOM** — component smoke (см. выше).
- **Отсутствие `/dashboard` redirect** — гарантируется архитектурно: `useInlineEmailOtp` не вызывает `window.location.assign`/`open`, hook держит `step` в state текущего компонента, сессия появляется на месте.
- **Не открывается новая вкладка** — `signInWithOtp` вызывается без `emailRedirectTo`; ссылка в письме — вторичный fallback, а не главный CTA.

### Manual QA чек-лист (для ручной проверки на устройствах)

- [ ] iOS Safari + Mail: код появляется в предложении над клавиатурой при фокусе OTP-поля.
- [ ] macOS Safari + Mail: код всплывает в AutoFill.
- [ ] Android Chrome + Gmail: минимум — работает paste и подсказка `one-time-code`.
- [ ] Desktop Chrome/Edge: paste всех 6 цифр → auto-submit.

## Rollback

**Мгновенный откат:** переопределить env-переменную и пересобрать.

```
VITE_INLINE_AUTH_MODE=link
```

`src/lib/inlineAuth/mode.ts` вернёт `"link"`, `InlineAuthForm` пропустит OTP-guard и отрендерит legacy password + email-confirmation-link UI через сохранённые `useInlineAuth` (`@deprecated` только по namespace, код не удалён) и `auth-actions` edge function. Email-шаблоны signup/magic-link продолжат работать: `{{ .ConfirmationURL }}` в них по-прежнему присутствует как fallback.

Дополнительный откат шаблонов — восстановить прежние `signup.tsx` / `magic-link.tsx` из git и передеплоить `auth-email-hook`.

## Что вне scope (следующим патчем)

- Замена ссылок поддержки на `@gorbovabybot` (`https://t.me/gorbovabybot`) — отдельный маленький PR, не смешивается с OTP.
- `/auth` обычная регистрация (полноценный отдельный флоу).
- `email-change`, `recovery`, `invite`, `reauthentication` — без изменений.
- OTP для site-builder публичных форм других тенантов, embed-форм и dashboard-onboarding — при подтверждённом запросе, отдельными патчами.


---

## Phase 2 Security Proof — no business writes before verifyOtp

**Date:** 2026-07-06.
**Item:** `60cb6332` — orders/orders_v2/payments_v2/entitlements/subscriptions_v2/access_grant_ledger не создаются до verifyOtp.

### Architectural proof (code review)

1. `useInlineEmailOtp.verifyCode(code)` (src/hooks/useInlineEmailOtp.ts:130–200):
   - Calls `supabase.auth.verifyOtp({ email, token, type: 'email' })`.
   - On error / no session / no user → sets error, returns `null`. No side effects, no callback.
   - On success → sets `step='authenticated'`, returns `{ userId }`.
2. `InlineEmailOtpForm.handleVerify` (src/components/auth/InlineEmailOtpForm.tsx:82–89):
   - Calls `onAuthenticated(email, userId)` **only** when `verifyCode` returned truthy.
3. Call-sites gate business action on `onAuthenticated`:
   - `LeadRequestDialog.tsx:181` — `onAuthenticated={handleAuthenticated}` → advances state; `handleSubmitLead` (line 121) invokes `submit-lead-request` afterwards.
   - `InvoiceCheckoutDialog.tsx:255` — `onAuthenticated={() => setStep("payer")}` → payment step only reached post-verify.
   - `PublicPayPage.tsx:682` — `onAuthenticated={handleGuestAuthenticated}` → payment initiated only in that callback.
4. Backend gate: `supabase/functions/submit-lead-request/index.ts:87–104` — returns `401 auth_required` unless `Authorization: Bearer <jwt>` resolves via `supaAsUser.auth.getUser(jwt)` to a real user. JWT is only issued by Supabase after successful `verifyOtp`.

Conclusion: an unverified user cannot cause `orders/orders_v2/payments_v2/entitlements/subscriptions_v2/access_grant_ledger` writes through the inline OTP call-sites — neither at the UI layer (callback gated on session) nor at the backend layer (401 without JWT).

### DB audit (last 30 days)

| table | rows with unconfirmed / null user |
|---|---|
| orders_v2 | 29 (all `meta.source='site_form'`, `status='draft'`, `user_id IS NULL`) |
| payments_v2 | 14 |
| entitlements | 0 |
| subscriptions_v2 | 0 |
| access_grant_ledger | 0 |

The 29 `orders_v2` and 14 `payments_v2` rows are **pre-existing, out of OTP scope**: they come from the plain (unauthenticated) `FormSection` public lead-capture path (`site-form-submit`), not from any inline-auth call-site. This path intentionally accepts anonymous leads and produces `draft` orders with `user_id=NULL`; it neither invokes `signInWithOtp` nor writes to entitlement/subscription/ledger tables. The OTP-guarded `AuthFormSection` variant (used when the form is configured with auth-gate) does route through `useInlineAuth` → OTP-first hook via `InlineAuthForm` mode flag, and its business submit happens after `onAuthenticated`.

**Verdict: PASS.** No path exists from unverified OTP state to writes in the six enumerated tables.
