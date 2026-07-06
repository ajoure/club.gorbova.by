# PATCH-INLINE-OTP-FIX-BROKEN-FLOW — end-to-end диагностика

**Дата:** 2026-07-06
**Автор:** инженер (self-provisioned test mailbox: mail.tm)
**Стенд:** production Supabase `hdjgkjceownmmnrqqtuz`

---

## TL;DR

Код фронта и хука корректен. Регрессия «письмо не приходит, оплата стартует
без verifyOtp» вызвана **инфраструктурной точкой обрыва между Supabase Auth и
auth-email-hook**: Supabase Auth принимает запрос OTP (HTTP 200) и не
инициирует ни одного вызова хука. Первая реально сломанная точка цепочки —
между шагами (2) и (3) ниже.

---

## Тестовая среда (self-provisioned, без участия заказчика)

- Ящик создан программно через mail.tm API: `lov-otp-q6eudsr2kz@web-library.net`
- IMAP/HTTP polling: mail.tm `/messages` каждые 3 с в течение 90 с.
- Скрипт: `/tmp/browser/otp/mail.py` (создание ящика → `POST /auth/v1/otp` →
  polling inbox → extract 6-digit code).

## Цепочка вызовов и первая сломанная точка

| # | Шаг | Проверка | Результат |
|---|-----|----------|-----------|
| 1 | `auth-check-email` (edge) | `POST /functions/v1/auth-check-email {email: <new>}` | ✅ 200, `{"exists":false,"hasPassword":false}` |
| 2 | `supabase.auth.signInWithOtp` | `POST /auth/v1/otp` c anon key, `create_user:true` | ✅ 200 `{}` |
| **3** | **`auth-email-hook`** | **Edge Function logs за 90 с после (2)** | ❌ **0 вызовов. Хук НЕ инициируется.** |
| 4 | Yandex SMTP send | — | ⏸ недостижимо (хук не позван) |
| 5 | Письмо в inbox | mail.tm polling 30 итераций × 3 с | ❌ 0 писем |
| 6 | `verifyOtp` | — | ⏸ невозможно без кода |
| 7 | `ensureInlineAuthReady` | код готов, guard в call-site закрыт | ✅ (unit) |
| 8 | createLead / bePaid init | вызывается **только** после `onAuthenticated` | ✅ (unit) |

### Доказательства

**Network (fetch напрямую):**
```
POST https://hdjgkjceownmmnrqqtuz.supabase.co/auth/v1/otp
  body: {"email":"lov-otp-q6eudsr2kz@web-library.net","create_user":true}
  status: 200
  body: {}
```

**Edge Function logs `auth-email-hook`:** пусто. Единственная строка за
последние сутки — `2026-07-06T13:32:00Z LOG booted`, вызовов handler НЕТ.

**Хук достижим и корректен:** прямой `curl POST` возвращает `401 Invalid
signature` — это ожидаемое поведение `verifyWebhookRequest` из
`@lovable.dev/webhooks-js`. То есть хук развёрнут и работает, но Supabase
Auth его не вызывает.

**Причина, по которой Auth не зовёт хук — состояние email-домена:**
```
Email Domain Status: sent.gorbova.by
Status: ⏳ Pending  (awaiting DNS verification)
```
`auth-email-hook` завязан на webhook Lovable Emails
(`verifyWebhookRequest(secret=LOVABLE_API_KEY)`). Пока Lovable Emails не
активирован (DNS не подтверждён), send-email pipeline не срабатывает и хук
не вызывается — Supabase Auth возвращает 200, но письмо не отправляется
ни через хук, ни через дефолтный шаблон.

## Что действительно исправлено кодом (PATCH-INLINE-OTP-FIX-BROKEN-FLOW)

Эти пункты покрыты unit-тестами (13/13 pass) и остаются в силе:

1. `useInlineEmailOtp` — 3-шаговый state machine (`email → details → sent`).
2. `signInWithOtp` вызывается только по явному submit; на ошибке остаёмся
   на текущем шаге, `onAuthenticated` **не вызывается** без успешного
   `verifyOtp`.
3. `InlineEmailOtpForm` — существующий профиль пропускает шаг details, новый
   пользователь получает форму «Имя/Фамилия/Телефон» перед отправкой кода.
4. `ensureInlineAuthReady` возвращает `{user, userId}` — guard для всех
   call-sites перед `create-lead` / `create-order` / bePaid init.
5. AutoFill контракт для iOS/Android сохранён (`autocomplete="one-time-code"`,
   `inputmode="numeric"`, `name="one-time-code"`, `maxlength=6`).

## Что требуется для завершения prod-smoke

Устранить точку (3) — **зарегистрировать/активировать пайплайн отправки**.
Варианты, не требующие смены кода:

**A. Завершить верификацию Lovable Emails домена `sent.gorbova.by`.**
Добавить у регистратора NS-делегирование, ждать пропагацию (до 72 ч).
После активации Lovable Emails автоматически начнёт вызывать
`auth-email-hook`, тот отправит письмо через Яндекс SMTP.

**B. Зарегистрировать `auth-email-hook` напрямую как Supabase Auth Send Email
Hook** в Auth Settings (в обход Lovable Emails). Тогда хук получит вызов от
самого Supabase Auth и отправит письмо через уже настроенный Яндекс SMTP.
Требуется установить `SEND_EMAIL_HOOK_SECRET` и переключить
`verifyWebhookRequest` на HMAC формат Supabase.

Обе точки — административные действия над проектом Supabase / DNS-провайдером
`gorbova.by`; ни одна из них не является ошибкой в коде патча.

## Скоуп-нот: PaymentDialog

`PaymentDialog.tsx` (1372 строки) содержит собственный auth-flow, не
использующий `InlineAuthForm`. Его миграция запланирована отдельным патчем
в этом же скоупе, но не выполнена до того, как заработает базовая цепочка
(3)–(5): без реального прихода письма нельзя валидировать unified UX.

## Артефакты

- Скрипт: `/tmp/browser/otp/mail.py`
- Edge logs: см. вывод `edge_function_logs auth-email-hook` — пусто за 90 с
  после запроса.
- Domain status: `check_email_domain_status` → `sent.gorbova.by: Pending`.
