да, согласен, с учетом правок:

```text
1. План правильный: sender не менять, DNS не трогать, `noreply@gorbova.by` оставить каноническим отправителем.

2. Важная правка по Supabase hook secret:
не угадывать формат `SEND_EMAIL_HOOK_SECRET`.

Перед реализацией проверить точный формат, который ожидает Supabase Auth Send Email Hook и библиотека `standardwebhooks`.
Если нужен `whsec_...` — использовать его.
Если нужен plain secret — использовать plain secret.
Не писать “v1,whsec_...” без проверки документации/текущего API.

3. Management API:
перед изменением GoTrue config обязательно снять current auth config snapshot:
- какие hooks уже включены;
- какие URI;
- какие secrets masked;
- email config;
- SMTP config;
- external providers.
Сохранить snapshot в proof.

4. Не ломать другие email action types:
hook должен корректно обработать минимум:
- signup;
- magiclink / otp;
- recovery;
- email_change;
- invite;
- reauthentication.
Даже если часть шаблонов не меняем, mapping payload должен не сломать их.

5. Recovery:
ссылка должна остаться primary.
После перевода hook на Supabase Standard Webhooks проверить recovery email отдельно, чтобы password reset не сломался.

6. Signature verifier:
лучше поддержать временно оба формата:
- Supabase Standard Webhooks;
- старый Lovable signature.
Это даст безопасный rollback/переходный период.
Если невозможно — явно доказать, что старый Lovable pipeline больше не используется.

7. `verify_jwt=false`:
ок, но только если signature verification обязательна для всех production send-events.
Preview/test endpoint должен быть отдельно защищён, чтобы нельзя было отправлять письма без подписи.

8. Payload mapping:
не строить `confirmationUrl` наугад.
Для recovery/email_change/invite нужно сохранить корректную ссылку.
Если `email_data.redirect_to`/`token_hash` отличаются от прежнего формата — зафиксировать в proof.

9. Real E2E:
mail.tm может заблокировать/не принять корпоративную почту.
Если mail.tm не получает письмо, использовать альтернативный mailbox.
Не делать вывод “письмо не отправилось” только по одному disposable inbox.

10. Proof:
обязательно приложить:
- current auth config before;
- auth config after;
- masked hook secret id/value shape;
- edge logs hook invoked;
- Yandex SMTP send success;
- письмо From = noreply@gorbova.by;
- recovery email still works;
- OTP verify success.
```

Итоговая команда:

```text
План принимаю.

Approve на PATCH-INLINE-OTP-EMAIL-SENDER-ROOT-FIX.

Главный принцип:
НЕ менять sender/DNS.
Канонический отправитель: noreply@gorbova.by через Yandex SMTP.

Что разрешено:
- перевести auth-email-hook на прямой Supabase Auth Send Email Hook;
- поменять только signature verifier + payload mapping;
- добавить verify_jwt=false;
- зарегистрировать hook в GoTrue config;
- deploy auth-email-hook;
- провести E2E.

Что запрещено:
- sent.gorbova.by;
- Lovable Emails DNS/domain;
- смена sender;
- смена SMTP;
- изменения `_shared/yandex-smtp-sender.ts`;
- изменения frontend OTP без отдельной причины;
- ломать recovery/password reset.

Дополнительный обязательный verify:
- OTP signup/magiclink работает;
- recovery/password reset работает;
- lead/payment стартуют только после verifyOtp;
- письма идут от noreply@gorbova.by.

План: PATCH-INLINE-OTP-EMAIL-SENDER-ROOT-FIX
```

## Отчёт о discovery (уже проведён по коду)

Канонический sender проекта — `noreply@gorbova.by` через Yandex SMTP:

- `supabase/functions/_shared/yandex-smtp-sender.ts` — рабочий отправитель, использующий корпоративный ящик `noreply@gorbova.by`, минуя инфраструктуру Lovable.
- `supabase/functions/auth-actions/index.ts` — `FROM_EMAIL = "noreply@gorbova.by"`.
- `supabase/functions/send-invoice/index.ts` — `from: "БУКВА ЗАКОНА <noreply@gorbova.by>"`.
- `supabase/functions/oneshot-password-reset-notice-2026-07/index.ts` — тот же sender.
- `supabase/functions/auth-email-hook/index.ts` (стр. 46, 262–275) — уже отправляет через `sendViaYandexSmtp` с `FROM_EMAIL = 'noreply@gorbova.by'`.

То есть **сам код `auth-email-hook` уже соответствует канону**: OTP-тема `Ваш код: <code>` (стр. 246–250), From = `noreply@gorbova.by`, Yandex SMTP, пароль берётся из `integration_instances`/`email_accounts`/`YANDEX_SMTP_PASSWORD`. Никаких изменений sender/domain/SMTP не требуется.

## Root cause регрессии

Supabase Auth не вызывает `auth-email-hook`. Причина не в коде хука и не в sender, а в том, что **Send Email Hook в Supabase Auth не зарегистрирован на нашу edge function**. Ранее его пыталась поднять Lovable Emails pipeline через `sent.gorbova.by` — этот путь заблокирован (DNS менять нельзя) и был выбран ошибочно. Как только Auth сам не отправляет событие в hook, `signInWithOtp` возвращает 200, но письмо не уходит.

Дополнительно: сейчас `auth-email-hook` верифицирует подпись через `@lovable.dev/webhooks-js` (стр. 163) — это Lovable-специфичный формат. Прямой Supabase Auth Send Email Hook подписывает запрос Standard Webhooks (`webhook-id`/`webhook-timestamp`/`webhook-signature`). Значит для перевода на прямую регистрацию нужно поменять только слой верификации подписи.

## Что делаем (без изменения DNS и sender)

1. **Не трогаем**: DNS, `sent.gorbova.by`, `noreply@gorbova.by`, Yandex SMTP, `supabase/config.toml` в части email sender, integration_instances email, шаблоны, `EMAIL_SUBJECTS`, OTP-first логику, `_shared/yandex-smtp-sender.ts`.
2. `**supabase/functions/auth-email-hook/index.ts**` — поменять только верификацию подписи:
  - Убрать импорты `@lovable.dev/webhooks-js` и `@lovable.dev/email-js`.
  - Добавить `standardwebhooks` (`npm:standardwebhooks@1`) — стандарт, который использует Supabase Auth.
  - Верифицировать заголовки `webhook-id`, `webhook-timestamp`, `webhook-signature` секретом из env `SEND_EMAIL_HOOK_SECRET`.
  - Читать payload формата Supabase Auth Send Email Hook: `{ user: { email, ... }, email_data: { token, token_hash, redirect_to, email_action_type, site_url, new_email } }`. Смапить в текущие переменные (`emailType = email_data.email_action_type`, `recipient = user.email`, `token = email_data.token`, `confirmationUrl` строим из `token_hash` + `email_action_type` + `redirect_to`, как раньше через SPA-proxy `/auth-verify`).
  - Оставить всё остальное как есть: рендер React Email шаблонов, OTP-first subject, Yandex SMTP, лог `email_send_log` + `email_logs`, preview endpoint.
  - `LOVABLE_API_KEY` больше не нужен для webhook; оставить только для preview endpoint (там он уже используется отдельно).
3. `**supabase/config.toml**` — добавить только запись, что `auth-email-hook` доступен без JWT (для вызова из GoTrue):
  ```toml
   [functions.auth-email-hook]
   verify_jwt = false
  ```
   Никаких email sender / SMTP / templates полей не трогаем.
4. **Секрет `SEND_EMAIL_HOOK_SECRET**` — сгенерировать (`generate_secret`, 48+ символов, формат `v1,whsec_<base64>` требуется GoTrue).
5. **Регистрация Send Email Hook в Supabase Auth** — через Supabase Management API (тем же путём, что мы правим auth-config, без DNS): выставить
  - `HOOK_SEND_EMAIL_ENABLED = true`
  - `HOOK_SEND_EMAIL_URI = https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/auth-email-hook`
  - `HOOK_SEND_EMAIL_SECRETS = <SEND_EMAIL_HOOK_SECRET>`
   Это единственная настройка на стороне Auth; sender/DNS/домен не меняются.
6. **Lovable Emails managed pipeline** — оставить в текущем состоянии (не пересобирать, не перепривязывать к `sent.gorbova.by`, не переключать). Регистрация hook напрямую в GoTrue перекрывает эту цепочку без изменения DNS.
7. **Deploy**: `supabase--deploy_edge_functions ["auth-email-hook"]`.

## Verify (реальный E2E, без участия пользователя)

Подрядчик сам поднимает mailbox через `mail.tm` API и прогоняет:

- новый email → `email` → `details` → `sent` → письмо приходит, `From: noreply@gorbova.by`, `Subject: Ваш код: <code>`, `verifyOtp` → 200 → lead/payment стартует;
- существующий email → `email` → `sent` → письмо приходит → `verifyOtp` → 200 → lead/payment стартует;
- по одному прогону на каждый сценарий: `LeadRequestDialog`, `InvoiceCheckoutDialog`, `PublicPayPage`, `FormSection` (все 4 call-site);
- проверить, что до `verifyOtp` **ни один** запрос `create-lead`/`create-order`/`bePaid init` не уходит (Network tab);
- resend cooldown, invalid code, force-resend после 5 попыток — регресс-проверка.

## Proof

`.lovable/proofs/inline_otp_email_sender_root_fix_2026_07.md`:

- discovery: старый путь (Lovable Emails → sent.gorbova.by, не активирован из-за DNS) vs новый (прямая регистрация Send Email Hook → auth-email-hook → Yandex SMTP → [noreply@gorbova.by](mailto:noreply@gorbova.by));
- явное подтверждение: DNS не менялся, `sent.gorbova.by` не делегировался, sender остался `noreply@gorbova.by`;
- скрин письма (`From`, `Subject`, тело с кодом);
- Network HAR `/auth/v1/otp` → 200;
- edge logs `auth-email-hook` с записью о входящем запросе от GoTrue и успешной отправке через Yandex SMTP;
- скрин `verifyOtp` success + скрин старта payment/lead после verify;
- диф по коду (только signature verifier + payload mapping + config.toml verify_jwt).

## Технические детали

- Файлы под редактирование: `supabase/functions/auth-email-hook/index.ts`, `supabase/config.toml` (только `[functions.auth-email-hook] verify_jwt=false`).
- Новый секрет: `SEND_EMAIL_HOOK_SECRET` (генерируется, формат `v1,whsec_...`).
- Auth Management API вызов: обновление GoTrue-конфига проекта (`hook_send_email_*`). DNS/email domain записи не задействованы.
- Никаких изменений в: `_shared/yandex-smtp-sender.ts`, `_shared/email-templates/*`, `integration_instances`, `email_accounts`, `.env`, `client.ts`, `types.ts`, frontend OTP-код (`useInlineEmailOtp`, `InlineEmailOtpForm`, `ensureReady.ts` уже готовы).
- Rollback: вернуть старую верификацию подписи и снять `HOOK_SEND_EMAIL_ENABLED`.

## DoD

- `auth-email-hook` вызывается напрямую GoTrue при `signInWithOtp`;
- письмо приходит с `From: noreply@gorbova.by`, Subject содержит код;
- все 4 call-site: lead/payment стартует **только** после успешного `verifyOtp`;
- edge logs подтверждают путь `GoTrue → auth-email-hook → yandex-smtp-sender`;
- DNS / sender / Lovable Emails domain — не изменялись;
- proof-файл со всеми артефактами приложен.