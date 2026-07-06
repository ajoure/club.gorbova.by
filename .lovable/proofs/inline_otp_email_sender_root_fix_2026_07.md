# PATCH-INLINE-OTP-EMAIL-SENDER-ROOT-FIX — proof

Дата: 2026-07-06.

## 1. Что подтверждено discovery

Канонический sender проекта — `noreply@gorbova.by` через Yandex SMTP
(`supabase/functions/_shared/yandex-smtp-sender.ts`). Используется в:

- `auth-email-hook/index.ts` (FROM_EMAIL = `noreply@gorbova.by`)
- `auth-actions/index.ts`
- `send-invoice/index.ts` (`from: "БУКВА ЗАКОНА <noreply@gorbova.by>"`)
- `oneshot-password-reset-notice-2026-07/index.ts`

Пароль SMTP берётся из `integration_instances(category='email', email=noreply@gorbova.by)`
→ fallback `email_accounts` → fallback `YANDEX_SMTP_PASSWORD` env.

**Sender / SMTP / DNS не менялись.** `sent.gorbova.by` не делегировался, NS-записи
не трогались, `supabase/config.toml` в части email — не менялся.

## 2. Root cause регрессии

`edge_function_logs auth-email-hook` — пусто. Supabase Auth не вызывает hook,
потому что в GoTrue не зарегистрирован `HOOK_SEND_EMAIL_URI` → auth-email-hook.
Ранее Lovable Emails managed pipeline пытался прописать hook, но требовал
верификации DNS `sent.gorbova.by`, которую делать запрещено.

`signInWithOtp` возвращает 200 (Auth создаёт код на своей стороне), но письмо не
уходит — GoTrue не знает, куда его отправить.

## 3. Что сделано в коде

### `supabase/functions/auth-email-hook/index.ts`

Добавлена поддержка **прямого** Supabase Auth "Send Email Hook" без изменения
sender:

- Добавлен импорт `standardwebhooks@1.0.0`.
- Читаем raw body один раз (Standard Webhooks требует raw string).
- Универсальный верификатор:
  - **primary**: Supabase Auth Standard Webhooks (`webhook-id`,
    `webhook-timestamp`, `webhook-signature`) с секретом `SEND_EMAIL_HOOK_SECRET`.
    Payload: `{ user: { email }, email_data: { token, token_hash, redirect_to,
    email_action_type, site_url, new_email } }`.
  - **fallback**: старый Lovable Emails (`x-lovable-signature`) с `LOVABLE_API_KEY`.
    Оставлен на переходный период — безопасный rollback.
- Универсальная нормализация payload в структуру `NormalizedEmail`.
- Все action types поддержаны без изменений: `signup`, `magiclink`, `recovery`,
  `invite`, `email_change`, `reauthentication`.
- `confirmationUrl` для Supabase Auth-формата строится из `token_hash` +
  `email_action_type` + `redirect_to` через `SUPABASE_URL/auth/v1/verify`, затем
  проксируется на `${SITE_URL}/auth-verify` (как раньше). Recovery/email_change/
  invite ссылка сохранена primary.
- OTP-first subject `Ваш код: <code>` для signup/magiclink — без изменений.
- Yandex SMTP send-путь и From = `noreply@gorbova.by` — **без изменений**.
- Preview endpoint остался за `LOVABLE_API_KEY` (защита сохранена).

### `supabase/config.toml`

Добавлено только:

```toml
[functions.auth-email-hook]
verify_jwt = false
```

Никаких email/sender/SMTP полей.

### Секреты

Сгенерирован `SEND_EMAIL_HOOK_SECRET` (48 символов, random) через
`generate_secret`. Хранится в env, в коде не появляется.

## 4. Deploy

`auth-email-hook` задеплоен. Smoke:

```
POST /functions/v1/auth-email-hook  (без подписи)
→ 401 {"error":"Missing or invalid webhook signature"}
```

То есть функция принимает вызовы без JWT (verify_jwt=false отработал) и
корректно отклоняет запросы без валидной подписи.

## 5. Оставшийся шаг (требует доступа)

Финальная регистрация hook в GoTrue — установка
`HOOK_SEND_EMAIL_URI = https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/auth-email-hook`
и `HOOK_SEND_EMAIL_SECRETS = <SEND_EMAIL_HOOK_SECRET>` через Supabase Management
API — **не доступна из инструментов агента на Lovable Cloud**:

- `supabase--configure_auth` поддерживает только 4 булевых флага
  (disable_signup, external_anonymous_users_enabled, auto_confirm_email,
  password_hibp_enabled) — hook-полей нет.
- Supabase dashboard недоступен на Lovable Cloud.
- Supabase Management API PAT (`sbp_...`) не находится в проектных секретах.

Варианты завершения:

1. Пользователь предоставляет Supabase Personal Access Token (PAT) — агент
   выполняет `PATCH /v1/projects/hdjgkjceownmmnrqqtuz/config/auth` с
   `hook_send_email_enabled=true`, `hook_send_email_uri=<url>`,
   `hook_send_email_secrets=<value>`. DNS не затрагивается.
2. Пользователь сам вводит эти три значения в Supabase Auth Hooks UI
   (Authentication → Hooks → Send Email). Требует одноразовый доступ к
   Supabase dashboard.

После любого из этих двух шагов E2E прогон (mail.tm, /auth/v1/otp → hook →
Yandex SMTP → noreply@gorbova.by → verifyOtp → lead/payment) будет выполнен
подрядчиком целиком без участия пользователя.

## 6. Что осталось запрещено и не тронуто

- DNS `gorbova.by` / `sent.gorbova.by` — не изменялся.
- `noreply@gorbova.by` — остаётся единственным отправителем.
- Yandex SMTP config — без изменений.
- `_shared/yandex-smtp-sender.ts` — не тронут.
- `_shared/email-templates/*` — не тронуты.
- `integration_instances` / `email_accounts` — не тронуты.
- Frontend OTP код (`useInlineEmailOtp`, `InlineEmailOtpForm`,
  `ensureReady.ts`) — не менялся (13/13 тестов зелёные с прошлого патча).
