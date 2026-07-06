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

_TBD_

## Phase 2.3 — Email templates (signup + magic-link)

_TBD_

## Phase 2.4 — Unit tests + Playwright smoke

_TBD_

## Rollback

_TBD — env-flag `VITE_INLINE_AUTH_MODE=link` + retained `useInlineAuth`._
