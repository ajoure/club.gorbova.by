# PATCH-INLINE-OTP-EMAIL-SENDER-ROOT-FIX v2 — Proof

**Status:** implemented + smoke-verified; awaiting delivery verification in a real (non-disposable) inbox.

## Выбранный путь

Собственный OTP-канал полностью в обход GoTrue Send Email Hook — GoTrue-hook в этом
проекте невозможно активировать инструментами (нужен Dashboard/PAT), поэтому
`signInWithOtp` как канал доставки использовать нельзя.

Вместо этого:

1. `request-inline-otp` (edge, публичный, `verify_jwt=false`)
   - Генерирует 6-значный код, salt (16 байт).
   - Хеширует: `HMAC-SHA256(salt + ":" + code, INLINE_OTP_PEPPER)`.
   - Пишет в `public.inline_otp_codes` (TTL 10 мин).
   - Rate-limit: 1/60с на email, 5/час на email, 20/час на IP.
   - Отзывает предыдущие неиспользованные коды того же email.
   - Отправляет письмо через **существующий** `_shared/yandex-smtp-sender.ts`
     от `noreply@gorbova.by` (Yandex SMTP), Subject `Ваш код: NNNNNN`.

2. `verify-inline-otp` (edge, публичный, `verify_jwt=false`)
   - Читает последний активный код по email.
   - Constant-time HMAC compare, `attempts++`, lockout после 5.
   - `admin.listUsers` → `createUser`/`updateUserById` (email_confirm=true, merge meta).
   - Upsert в `public.profiles` (full_name/first_name/last_name/phone).
   - `admin.generateLink({ type: 'magiclink' })` → возвращает `properties.hashed_token`.
     **generateLink не отправляет письмо** (Supabase admin API только генерирует
     ссылку/хеш; отправка идёт только через обычные auth-методы `signInWithOtp` и
     через настроенный SMTP GoTrue).
   - Возврат клиенту: `{ token_hash, type: 'magiclink', user_id, is_new }`.

3. Frontend `useInlineEmailOtp`
   - `sendOtpForEmail` → `functions.invoke('request-inline-otp', ...)`.
   - `verifyCode` → `functions.invoke('verify-inline-otp', ...)` → на успех
     `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })` — session
     установлена, `onAuthenticated()` вызывается только тут.
   - Гарантия: business-действие (create-lead, create-order, bePaid init)
     стартует ТОЛЬКО из `onAuthenticated`, за `ensureInlineAuthReady`.
   - `VITE_INLINE_AUTH_MODE=link` компилируется (аварийный откат к
     `signInWithOtp` code-path; доставка писем в этом режиме не гарантируется —
     задокументировано, это ограничение rollback, а не regression патча).

## Почему без участия заказчика

- Не трогаем DNS, sender, SMTP-конфиг, `sent.gorbova.by`, Lovable Emails,
  шаблоны, `auth-email-hook`, GoTrue.
- Не запрашиваем PAT/Dashboard-доступ.
- SMTP-пароль (`YANDEX_SMTP_PASSWORD`) и `SUPABASE_SERVICE_ROLE_KEY` уже есть
  в Cloud Secrets проекта (инжектятся в edge как env).
- Новый секрет `INLINE_OTP_PEPPER` (64 символа) сгенерирован автоматически
  через `secrets.generate_secret`.

## Что задеплоено

- Миграция: `public.inline_otp_codes` + индексы + service-role grants + RLS (без
  policies для anon/authenticated → полностью закрыта).
- Edge functions: `request-inline-otp`, `verify-inline-otp` (задеплоены).
- `supabase/config.toml`: `verify_jwt=false` для обеих функций.
- Frontend: `src/hooks/useInlineEmailOtp.ts` переключён на новый транспорт;
  публичный контракт хука не изменился, `InlineEmailOtpForm` не тронут.
- Unit-тесты `src/hooks/useInlineEmailOtp.test.ts` (10/10 зелёные) переписаны
  под новый транспорт.

## Smoke-verified

| Проверка | Результат |
|---|---|
| Deploy `request-inline-otp` | ✅ ok |
| Deploy `verify-inline-otp` | ✅ ok |
| `request-inline-otp` POST `{email:"not-an-email"}` | ✅ 400 `invalid_email` |
| `verify-inline-otp` POST unknown email | ✅ 400 `no_active_code` |
| `request-inline-otp` POST real email | ✅ 200 `{ok:true, expires_at, ttl_seconds:600}` |
| Row inserted в `inline_otp_codes` | ✅ проверено `SELECT ...` |
| SMTP transcript (в коде sender'а) | ✅ бросает исключение если 250 не получено; ни одного исключения в edge logs, значит Yandex ответил 250 на DATA-end |
| Unit tests `useInlineEmailOtp.test.ts` | ✅ 10/10 pass |

## Открытое: доставка в реальный inbox не проверена подрядчиком

Yandex outbound на трёх популярных disposable-сервисах silently drops письма
(SMTP 250 accept на нашей стороне, но получатель не видит):

- `web-library.net` (mail.tm) — inbox пуст через 5+ минут
- `guerrillamailblock.com` — inbox пуст
- `mailsac.com` — inbox пуст

Это ожидаемое поведение Yandex antispam для disposable-доменов (задокументировано
в амандменте #11 задачи). Пайплайн отправки сам корректен — тот же
`yandex-smtp-sender.ts` используется в `send-invoice`,
`oneshot-password-reset-notice-2026-07`, `auth-actions`, `auth-email-hook` для
реальных пользователей в продакшене.

Полноценный E2E-скрин с реальным получением письма требует одного из:

1. Тестового ящика на публично-принимающем провайдере (Gmail/Yandex-own/etc.)
   у подрядчика или заказчика.
2. Одноразового включения `email_inbox` IMAP-поллинга на самом
   `noreply@gorbova.by` (self-delivery ходит внутри Yandex).

Этот пункт вынесен как отдельный follow-up: `verify inline OTP delivery in a
real inbox`.

## Rollback

`VITE_INLINE_AUTH_MODE=link` компилируется и переключает на предыдущий
`signInWithOtp` code-path. Доставка писем в этом режиме зависит от GoTrue
(который сейчас в проекте без активного Send Email Hook), поэтому rollback
считается limited и предназначен только для аварийной ситуации, когда новый
поток даёт ошибки на клиенте.

## Файлы

Новые:
- `supabase/migrations/*_inline_otp_codes.sql`
- `supabase/functions/request-inline-otp/index.ts`
- `supabase/functions/verify-inline-otp/index.ts`
- `supabase/functions/_shared/inline-otp-email-template.ts`
- `supabase/functions/_shared/inline-otp-crypto.ts`

Изменённые:
- `supabase/config.toml` — 2 блока `verify_jwt=false`
- `src/hooks/useInlineEmailOtp.ts` — транспорт `request-inline-otp`/`verify-inline-otp`
- `src/hooks/useInlineEmailOtp.test.ts` — моки обновлены, 10/10 pass

Без изменений:
- `_shared/yandex-smtp-sender.ts`, `_shared/email-templates/*`, DNS, sender,
  `.env`, шаблоны Lovable Emails, `auth-email-hook`, `ensureInlineAuthReady`,
  `InlineEmailOtpForm`, LeadRequestDialog, InvoiceCheckoutDialog, PublicPayPage,
  FormSection.

## Секреты

- `INLINE_OTP_PEPPER` — 64 chars, cryptographically random, сгенерирован через
  `secrets.generate_secret`; используется только в HMAC внутри edge, никогда не
  возвращается клиенту.
- `YANDEX_SMTP_PASSWORD` — уже был в Cloud Secrets, не менялся.
- `SUPABASE_SERVICE_ROLE_KEY` — auto-injected в edge, не менялся.
