# Discovery: OTP как единый стандарт email-подтверждения

**Патч:** `PATCH-INLINE-AUTH-EMAIL-OTP-FLOW`
**Дата:** 2026-07-06
**Статус:** Discovery (Фаза 1). Реализация — только после аппрува этого отчёта.

Разделы: A) Supabase OTP contract, B) карта 13 flow, C) UI OTP-input capability, D) rollback-стратегия, E) риски и открытые вопросы.

---

## A. Supabase OTP contract

### A.1 Клиентская библиотека
- `@supabase/supabase-js@^2.108.2` (см. `package.json`).
- Метод `supabase.auth.signInWithOtp({ email, options })` — доступен.
- Метод `supabase.auth.verifyOtp({ email, token, type })` — доступен, `type` строго типизирован union'ом.

### A.2 Как отправлять код
```ts
await supabase.auth.signInWithOtp({
  email: normalizedEmail,
  options: {
    shouldCreateUser: true,           // создаёт пользователя, если email новый
    data: { first_name, last_name, phone, full_name },
    // emailRedirectTo НЕ указываем — код в письме важнее ссылки
  }
});
```
Supabase шлёт письмо шаблона `magiclink` (для существующих) или `signup` (для новых, если `shouldCreateUser: true` и user не существует) — в шаблоне доступны оба: `{{ .Token }}` (6 цифр) и `{{ .ConfirmationURL }}` (magic-link).

### A.3 Как валидировать код (⚠ критично)
В supabase-js `EmailOtpType` = `'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'`.

**`type: 'email'`** (обобщённый) — работает в новых версиях API, но исторически Supabase ожидает конкретный тип, соответствующий типу отправленного письма:

| Ситуация | Отправка | Валидация |
|---|---|---|
| Новый пользователь (`shouldCreateUser: true`, email не существует) | шаблон `signup`, код в `{{ .Token }}` | `verifyOtp({ email, token, type: 'signup' })` или `type: 'email'` |
| Существующий пользователь (уже подтверждён) | шаблон `magiclink` | `verifyOtp({ email, token, type: 'email' })` |
| Смена email | шаблон `email_change` | `verifyOtp({ email, token, type: 'email_change' })` |

**Стратегия:** используем **`type: 'email'`** как унифицированный (Supabase на бэкенде маршрутизирует по email+token). Если reject — падаем на `type: 'signup'` для новых и `type: 'magiclink'` для существующих. Это решение зафиксировано в hook `useInlineEmailOtp.verifyCode()` — с fallback-логикой + понятной generic-ошибкой.

**⚠ Действие перед merge:** подтвердить в staging реальным запросом на тестовый email из inbucket/локального Supabase; в отчёте proof приложить `curl`-эхо `verifyOtp` для обоих сценариев (новый / существующий).

### A.4 Что реально приходит в `auth-email-hook`
Судя по `supabase/functions/auth-email-hook/index.ts:199-200`:
```ts
const emailType: string = payload.data.action_type
```
Валидные значения `action_type` (из парсера `@lovable.dev/email-js`): `signup | invite | magiclink | recovery | email_change | reauthentication`.

`payload.data.token` — 6-значный код (используется в шаблоне через `templateProps.token`, строка 230). Уже прокидывается, но `signup.tsx` и `magic-link.tsx` **его не отображают** — надо добавить.

### A.5 Rate limits
- Supabase default: ~4 OTP/час/email + ~30/час/IP.
- Наша Yandex-SMTP отправка (в `auth-email-hook`) — свой лимит; не блокирует API. Клиентский cooldown 60 сек снижает риск.
- OTP TTL Supabase: 60 мин (default). Показываем в UI «10 мин» — консервативный лимит.

### A.6 Password установка после OTP-signup
Пользователь регистрируется без пароля (OTP-only). Чтобы задать пароль:
```ts
await supabase.auth.updateUser({ password: newPassword })
```
Требует активной сессии — вызываем **сразу после** `verifyOtp` success и `ensureInlineAuthReadyWithRetry ok`. Работает через RLS `auth.uid()`.

**⚠ Риск:** `/auth` регистрация сейчас требует пароль в единой форме. Если после `verifyOtp` `updateUser({password})` вернёт ошибку (weak password / rate limit), пользователь окажется authenticated без пароля. Стратегия — не блокировать flow: показываем предупреждение «пароль не установлен, задайте позже через восстановление», аккаунт уже создан.

**Компромисс:** в этом патче `/auth` оставляем **вторым этапом** (не блокировать релиз inline-flow). См. B, строка 1.

---

## B. Карта 13 email-flow

| # | Flow | Файл(ы) | Сейчас | Целевое | Комментарий |
|---|---|---|---|---|---|
| 1 | `/auth` регистрация | `src/pages/Auth.tsx` (нет `InlineAuthForm`), `src/contexts/AuthContext.tsx:signUp()` | `signUp({emailRedirectTo})` | **OTP — во 2-й фазе** | Требует `updateUser({password})` после `verifyOtp` — отложено, чтобы не ломать password-flow. Fallback: link-signup продолжает работать. |
| 2 | LeadRequestDialog | `src/components/lead/LeadRequestDialog.tsx:179` | `<InlineAuthForm>` (link-based) | OTP | Основной inline-flow. Первый в очереди на замену. |
| 3 | PaymentDialog | `src/components/payment/PaymentDialog.tsx` (нет `InlineAuthForm`!) | `signInWithPassword` напрямую (строка 365) | **OTP-flow для регистрации нового** + оставить password-login существующего | Нужно проверить: где именно в PaymentDialog происходит signup? Grep не нашёл — возможно, только login. Discovery-under-discovery: подтвердить перед реализацией. |
| 4 | InvoiceCheckoutDialog | `src/components/payment/InvoiceCheckoutDialog.tsx:253` | `<InlineAuthForm>` | OTP | Второй в очереди. |
| 5 | PublicPayPage | `src/pages/PublicPayPage.tsx:682` | `<InlineAuthForm>` | OTP | Третий в очереди. |
| 6 | Preregistration Dialog | `src/components/course/PreregistrationDialog.tsx` — **нет auth-кода** | ? | Уточнить | Grep не показал `signUp`/`InlineAuthForm`. Возможно, требует уже-authenticated user или использует другой путь. **Действие:** прочитать файл целиком в фазе 2 до принятия решения. |
| 7 | FormSection auth_mode | `src/components/site-renderer/blocks/FormSection.tsx:663` | `useInlineAuth()` | OTP | Site-builder форма с включённым auth_mode. |
| 8 | Site-builder public forms (embed) | `public/embed/form.js` (если есть) | ? | Уточнить в фазе 2 | Grep не показал самостоятельного JS-embed. Скорее всего покрывается FormSection (#7). |
| 9 | Все поддомены `*.gorbova.by` | Те же компоненты (#2-#7) | link (cross-subdomain blocker) | OTP (проблема исчезает) | OTP решает cross-subdomain автоматически — нет возврата с ссылки. |
| 10 | Личный кабинет / onboarding | `src/pages/dashboard/*`, `src/pages/onboarding/*` | Уточнить | Только если есть email confirm | Grep-задача в фазе 2. Скорее всего нет email confirm — пользователь уже authenticated. |
| 11 | Password recovery | `/reset-password`, `useInlineAuth.requestPasswordReset()` → `auth-actions` edge | link | **link остаётся** | Не трогаем. Recovery по ссылке — стандарт. |
| 12 | Email change | `updateUser({email})` вызовы | link (шаблон `email-change.tsx`) | link — не трогаем в этом патче | `type: 'email_change'` для OTP требует отдельного flow (подтверждение старого + нового email). Отложено. |
| 13 | Invite | `InviteEmail` шаблон, редко используется | link | **link остаётся** | Invite-flow с задачей приёма приглашения — link удобнее. |
| — | Reauthentication | `ReauthenticationEmail` шаблон | OTP уже | Уже OTP | Оставляем как есть. Используется для sensitive ops. |

**Итог по scope патча (после discovery):**
- **Обязательно:** #2, #4, #5, #7 (inline-flow) + шаблоны `signup.tsx` и `magic-link.tsx` (OTP-first, ссылка вторична) + hook `useInlineEmailOtp` + UI.
- **Под вопросом (уточнить в начале фазы 2):** #3 (PaymentDialog signup?), #6 (Preregistration auth?), #8 (embed forms?), #10 (dashboard email confirm?).
- **Отложено:** #1 (`/auth`), #12 (email_change).
- **Не трогаем:** #11 recovery, #13 invite.

---

## C. UI OTP-input capability

### C.1 `input-otp` библиотека
- Установлена: `"input-otp": "^1.4.2"` (см. `package.json`).
- Обёртка `src/components/ui/input-otp.tsx` — стандартная shadcn: `<OTPInput>` из `input-otp` рендерит **один настоящий `<input>`** под 6 визуальными слотами. Пропсы `autoComplete`, `inputMode`, `pattern`, `name`, `id`, `maxLength`, `autoFocus` пробрасываются в `<input>` напрямую через `{...props}`.
- Значит, **overlay-хак не нужен**. Достаточно передать все autofill-атрибуты как пропсы `<InputOTP>`:
  ```tsx
  <InputOTP
    maxLength={6}
    autoComplete="one-time-code"
    inputMode="numeric"
    pattern="[0-9]*"
    name="one-time-code"
    id="one-time-code"
    autoFocus
    value={code}
    onChange={setCode}
  >
    <InputOTPGroup>
      {[0,1,2,3,4,5].map(i => <InputOTPSlot key={i} index={i} />)}
    </InputOTPGroup>
  </InputOTP>
  ```
- `input-otp` **автоматически** обрабатывает paste `123456` → раскладывает по слотам.
- **Проверка через Playwright (фаза 2):** DOM-assert, что настоящий `<input>` имеет `autocomplete="one-time-code"`, `inputmode="numeric"`, `name="one-time-code"`.

### C.2 Форма и submit-кнопка
Обёртка `<form onSubmit>` — обязательна для iOS AutoFill hint. Кнопка `<button type="submit">Подтвердить</button>` — обязательна и должна быть видимой (не `sr-only`), иначе iOS не покажет клавиатурный chip.

### C.3 Autosubmit
Реализуем: при `code.length === 6` вызываем `verifyCode(code)` автоматически, кнопка остаётся для явного submit после autofill.

---

## D. Rollback-стратегия (обязательное требование пользователя)

### D.1 Что сохраняем
- Файл `src/hooks/useInlineAuth.ts` — **не удаляем**, помечаем `@deprecated` и оставляем работоспособным.
- Файл `src/components/auth/InlineAuthForm.tsx` — **не удаляем**, помечаем `@deprecated`.
- Edge функция `auth-actions` (используется в `resetPasswordForEmail` и legacy signup) — **не трогаем**.
- Шаблон `signup.tsx` — переработка **не удаляет** ссылку `{{ .ConfirmationURL }}`, только сдвигает её в вторичный fallback внизу письма. Значит, старый link-flow всё ещё работает — можно нажать на ссылку и подтвердить.

### D.2 Feature-flag (опционально)
Простой env-based флаг в `src/lib/inlineAuth/config.ts`:
```ts
export const INLINE_AUTH_MODE: 'otp' | 'link' =
  (import.meta.env.VITE_INLINE_AUTH_MODE as any) || 'otp';
```
Оборачиваем call-sites `#2/#4/#5/#7`:
```tsx
{INLINE_AUTH_MODE === 'otp'
  ? <InlineEmailOtpForm ... />
  : <InlineAuthForm ... />}
```
Откат — смена env var `VITE_INLINE_AUTH_MODE=link` + rebuild. Никаких миграций.

### D.3 Отдельно: шаблон письма
Даже без feature-flag на UI, **шаблон `signup.tsx` OTP-first содержит и код, и ссылку**. Если UI-код упал в проде, пользователь всё ещё видит ссылку в письме и может подтвердить старым путём через `AuthVerifyProxy`. Двойная страховка.

### D.4 Как откатить (документ в proof)
Пошаговый rollback playbook в `.lovable/proofs/inline_otp_flow.md`:
1. Изменить `VITE_INLINE_AUTH_MODE=link` в build config.
2. Rebuild + deploy.
3. Шаблон email оставить — работает для обоих flow.
4. `useInlineAuth` / `InlineAuthForm` живы — рендерятся сразу.
5. Время отката: ~5 мин (rebuild).

---

## E. Риски и открытые вопросы

### E.1 Открытые (уточнить перед началом фазы 2)
1. **PaymentDialog (#3):** есть ли там inline signup или только login? Прочитать файл целиком.
2. **PreregistrationDialog (#6):** есть ли auth вообще? Может, требует уже-authenticated user.
3. **Dashboard/onboarding (#10):** есть ли email confirm вообще?
4. **`type` для `verifyOtp`:** реально проверить на staging — `type: 'email'` vs `type: 'signup'` для нового пользователя.

### E.2 Известные ограничения
1. **AutoFill из email — best-effort.** iOS/macOS Mail парсит plain-text строку `Ваш код подтверждения: 123456` и предлагает над клавиатурой. Android/Gmail — реже. Desktop — только paste + browser autofill. **В proof — явный disclaimer.**
2. **Rate limits Supabase** могут блокировать повторные запросы `signInWithOtp` (~4/час/email). UI-сообщение generic.
3. **Логи:** `payload.data.token` уже НЕ логгируется в `auth-email-hook/index.ts:201` (логируется только `emailType`, `recipient`, `run_id`) — ✅. Дополнительно: в `useInlineEmailOtp` не логгировать `code` в `console.*`. Playwright — не сохранять артефакты с реальными кодами.

### E.3 Тестирование
- **Unit:** vitest с моком `supabase.auth`.
- **E2E:** Playwright c mock `signInWithOtp` (возвращаем фиксированный код `123456`, `verifyOtp` принимает его). Плюс **один smoke** с реальным письмом на тестовый Yandex-адрес — скрин письма для верификации UX.
- **Ручная проверка платформ** — iOS Safari + Mail, macOS Safari + Mail, Android Chrome + Gmail — скрины в `.lovable/proofs/inline_otp/`.

---

## Заключение

Discovery завершено. Готовность к фазе 2:

- ✅ Supabase OTP API совместим (supabase-js 2.108.2).
- ✅ `input-otp` библиотека поддерживает все autofill-атрибуты нативно.
- ✅ `auth-email-hook` уже прокидывает `token` в templateProps — только UI шаблона обновить.
- ✅ Rollback-стратегия зафиксирована (env flag + retention старого кода + двойная страховка в email).
- ⚠ 4 открытых вопроса (E.1) — уточнить в начале фазы 2 до массовых правок.
- ⚠ `type` для `verifyOtp` — проверить на staging реальным запросом.

**Рекомендация:** аппрувить discovery, начинать фазу 2 в порядке:
1. Прочитать PaymentDialog / PreregistrationDialog / dashboard / embed целиком → закрыть E.1.
2. Обновить `signup.tsx` + `magic-link.tsx` OTP-first, deploy `auth-email-hook`.
3. Написать `useInlineEmailOtp` + `InlineEmailOtpForm` + unit-тесты.
4. Заменить call-sites #2, #4, #5, #7 через feature-flag.
5. Playwright + ручные скрины.
6. Cleanup и обновление `.lovable/plan.md`.

`/auth` регистрация (#1) и email-change (#12) — отдельным патчем после стабилизации inline-flow.
