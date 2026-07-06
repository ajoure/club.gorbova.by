да, согласен, с учетом правок:

```text
1. Важная правка: не утверждать, что recovery “пойдёт через дефолтные Lovable-письма”, если сейчас email hook не активирован.
Recovery нужно отдельно проверить. Если recovery сейчас не работает — это отдельный критический баг, но не смешивать с OTP.

2. `admin.getUserByEmail` в Supabase Admin API может отсутствовать.
Перед реализацией проверить фактический API. Если нет — использовать:
- безопасный RPC/таблицу profiles для identify;
- `auth.admin.listUsers()` только если доступно и не дорого;
- не раскрывать результат пользователю.

3. `verify-inline-otp` должен получать `name/phone` или ссылаться на OTP-row metadata.
Сейчас в request шаге name/phone есть, но в verify шаге их нет. Нужно сохранить signup metadata в `inline_otp_codes.meta` и использовать при create/update user/profile.

4. После успешного verify нужно создать/обновить `profiles`, если user новый.
Иначе lead/payment могут получить auth.user без нормального profile.

5. Не использовать SHA256(code + salt) как строковую конкатенацию без HMAC.
Лучше:
- HMAC-SHA256(code, server secret + salt)
или минимум hash(salt + code + server pepper).
Pepper хранить только в env. Иначе при утечке таблицы 6-значный код перебирается мгновенно.

6. Добавить unique/cleanup guard:
- при новом request для email+purpose+flow_id старые неиспользованные OTP пометить revoked/used или инвалидировать;
- verify должен брать только последний активный код.
Иначе старый код может остаться валидным параллельно новому.

7. `generateLink({ type:'magiclink' })` может само отправлять письмо.
Нужно проверить параметры Supabase. Если generateLink отправляет письмо, это недопустимо.
Нужен режим генерации token_hash без отправки письма. Если такого нет — выбрать другой способ получения session.

8. `auth.verifyOtp({ token_hash, type:'magiclink' })` на клиенте нужно проверить на staging до полного внедрения.
Это новый критический контракт.

9. Rate-limit по IP нельзя доверять `x-forwarded-for` без нормализации.
В proof указать, какой header используется и как защищён от spoofing в Supabase Edge.

10. Таблица `inline_otp_codes` не должна быть доступна anon/authenticated вообще.
RLS + no grants подтвердить SQL-ом.

11. Письмо через mail.tm может не принять Yandex/noreply.
Если mail.tm не принимает — использовать другой controlled mailbox, но не считать это ошибкой отправки.

12. Rollback `VITE_INLINE_AUTH_MODE=link` сейчас “без гарантии доставки” — это плохой rollback.
Нужно указать реальный rollback:
- либо старый парольный flow для existing users;
- либо отключить OTP-gate и вернуть прежний AuthContext flow;
- либо признать rollback limited.
Не называть его полноценным rollback, если письма тоже не гарантированы.
```

Итог:

```text
План принимаю.

Approve на PATCH-INLINE-OTP-EMAIL-SENDER-ROOT-FIX v2.

Главное:
- не просить заказчика о Supabase/PAT/DNS;
- сделать собственный OTP через edge + noreply@gorbova.by;
- бизнес-действия только после успешного кода и session;
- все проверки провести агентом самостоятельно.

Перед execute обязательно проверить два контракта:
1. `generateLink` не отправляет дополнительное письмо.
2. `verifyOtp(token_hash, magiclink)` реально создаёт session.

Если любой из них не работает — STOP и новый план.

План: PATCH-INLINE-OTP-EMAIL-SENDER-ROOT-FIX v2 — собственный OTP-канал через существующий Yandex SMTP
```

## Диагноз

- До патча OTP-flow работал через `noreply@gorbova.by` (Yandex SMTP), потому что `signInWithOtp` триггерил старый auth email pipeline.
- После рефактора `auth-email-hook` под Standard Webhooks Supabase Auth перестал вызывать hook (GoTrue Send Email Hook не активирован), и письма не уходят.
- Регистрация GoTrue Send Email Hook требует Dashboard/PAT — недоступно ни агенту, ни заказчику. Значит `signInWithOtp` как канал доставки использовать нельзя.
- Yandex SMTP `noreply@gorbova.by` уже работает в других edge-функциях (`_shared/yandex-smtp-sender.ts`, `auth-actions`, `send-invoice`, `oneshot-password-reset-notice-2026-07`) — доступен без изменений DNS/sender.
- В edge-функциях доступен `SUPABASE_SERVICE_ROLE_KEY` через env (Supabase auto-injects). Это даёт admin API без участия заказчика.

Вывод: обходим GoTrue Send Email Hook полностью. Собственный OTP-канал: генерируем код на сервере, шлём через существующий Yandex SMTP, верифицируем на сервере, mint session через `admin.generateLink({ type: 'magiclink' })` → фронт вызывает `verifyOtp({ token_hash, type: 'magiclink' })` и получает валидную Supabase-сессию.

## Архитектура

```text
Frontend (InlineEmailOtpForm)
   │
   │ 1. POST /request-inline-otp  { email, flowId, purpose, name?, phone? }
   ▼
Edge fn: request-inline-otp
   ├── rate-limit (email + IP)
   ├── ensure user via admin.getUserByEmail / admin.createUser (email_confirm=false, user_metadata)
   ├── generate 6-digit code + salt → sha256 hash
   ├── insert into public.inline_otp_codes (email, code_hash, salt, expires_at=+10m, attempts=0, flow_id, purpose)
   ├── render + send via yandex-smtp-sender:
   │     from: "Екатерина Горбова <noreply@gorbova.by>"
   │     subject: "Ваш код: <NNNNNN>"
   │     body: ru template (OTP-first, fallback text)
   └── 200 { ok, expires_at }
   
Frontend
   │
   │ 2. POST /verify-inline-otp  { email, code, flowId }
   ▼
Edge fn: verify-inline-otp
   ├── select active row for email (not expired, attempts<5, not used)
   ├── constant-time compare sha256(code+salt) === code_hash
   ├── on fail: attempts++, return 400 { reason: "invalid_code" | "expired" | "locked" }
   ├── on success: mark used_at = now()
   ├── admin.updateUserById(userId, { email_confirm: true })
   ├── admin.generateLink({ type: 'magiclink', email }) → properties.hashed_token
   └── 200 { token_hash, type: 'magiclink', user_id }
   
Frontend
   │
   │ 3. supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })
   ▼
Supabase Auth → session установлена → onAuthenticated() → ensureInlineAuthReady() → lead/payment старт
```

## Rollback режим

`VITE_INLINE_AUTH_MODE=link` продолжает работать: link-mode использует старый `signInWithOtp({ options: { emailRedirectTo } })` → это по-прежнему сломано, но флаг оставляется как аварийный откат к предыдущему код-пути (без гарантии доставки писем — задокументировать в proof).

## Шаги реализации

### 1. Миграция `inline_otp_codes`

```sql
CREATE TABLE public.inline_otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hash text NOT NULL,
  salt text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  flow_id text,
  purpose text NOT NULL,           -- 'lead' | 'payment' | 'invoice'
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  last_send_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.inline_otp_codes (email, created_at DESC);
CREATE INDEX ON public.inline_otp_codes (expires_at) WHERE used_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON public.inline_otp_codes TO service_role;
ALTER TABLE public.inline_otp_codes ENABLE ROW LEVEL SECURITY;
-- никакого доступа anon/authenticated — только service_role внутри edge
```

Cleanup: pg_cron job (или ленивая очистка в request-inline-otp) — удалять строки старше 24 ч.

### 2. Rate-limit

Внутри `request-inline-otp`:

- ≤ 1 письмо / 60 сек на email (проверка `last_send_at`);
- ≤ 5 писем / час на email;
- ≤ 20 писем / час на IP.
Ответы: 429 с `retry_after_s`.

### 3. Edge function `request-inline-otp`

`supabase/functions/request-inline-otp/index.ts`:

- CORS + validation (Zod: email, purpose ∈ enum, flowId optional, name/phone optional strings).
- Использует `_shared/yandex-smtp-sender.ts` (уже есть).
- Не создаёт пользователя при `purpose='lead'` до verify — только сохраняет OTP; создание/апдейт пользователя произойдёт в verify.
- Логирует в `email_send_log` (существующий) для аудита.
- `verify_jwt = false` (публичный endpoint, защищён rate-limit + OTP hash).

### 4. Edge function `verify-inline-otp`

`supabase/functions/verify-inline-otp/index.ts`:

- CORS + validation.
- Constant-time HMAC compare.
- Attempts++, lockout после 5.
- При успехе:
  - `admin.listUsers({ email })` → если нет: `admin.createUser({ email, email_confirm: true, user_metadata: { name, phone } })`;
  - иначе `admin.updateUserById(id, { email_confirm: true, user_metadata: { ...merge } })`;
  - `admin.generateLink({ type: 'magiclink', email })` → возвращает `properties.hashed_token`.
- Возврат: `{ token_hash, type: 'magiclink', user_id, email }`.
- `verify_jwt = false`.

### 5. Правки config.toml

Добавить блоки:

```toml
[functions.request-inline-otp]
verify_jwt = false

[functions.verify-inline-otp]
verify_jwt = false
```

### 6. Frontend: `useInlineEmailOtp`

Заменить два места:

- `sendCode()`: вместо `supabase.auth.signInWithOtp(...)` → `supabase.functions.invoke('request-inline-otp', { body: {...} })`.
- `verifyCode()`: вместо `supabase.auth.verifyOtp({ email, token, type: 'email' })` →
  1. `supabase.functions.invoke('verify-inline-otp', { body: { email, code, flowId } })` → получаем `{ token_hash }`;
  2. `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })` → session установлена;
  3. `onAuthenticated({ user, isNew })`.

Публичный контракт хука (state machine: `email → details? → code → success`, error mapping, resend cooldown) не меняется — трогаем только транспорт.

### 7. `ensureInlineAuthReady` — без изменений

Уже принят. Он остаётся единым guard для lead/payment call-sites (LeadRequestDialog, InvoiceCheckoutDialog, PublicPayPage, FormSection).

### 8. `auth-email-hook` — не удаляем

Остаётся задеплоенным для password recovery / email change (эти flow всё ещё идут через GoTrue). Так как GoTrue hook не активирован, recovery по-прежнему пойдёт через дефолтные Lovable-письма — это существовавшее до патча поведение, не регрессия. Отдельно задокументировать.

### 9. Тесты

Unit (Vitest):

- `useInlineEmailOtp`: обновить моки на `functions.invoke('request-inline-otp' | 'verify-inline-otp')`, все существующие сценарии проходят (state machine, resend cooldown, error mapping, ensureReady guard).
- `InlineEmailOtpForm`: без изменений API, тесты остаются.

Edge (Deno):

- `request-inline-otp/index.test.ts`: валидация, rate-limit 429, успешная запись строки, вызов SMTP замокан.
- `verify-inline-otp/index.test.ts`: неверный код, expired, locked, успешный verify + generateLink stub.

### 10. E2E (Playwright + mail.tm, самостоятельно)

4 сценария на реальном mail.tm mailbox:

1. Новый email → LeadRequestDialog (FormSection).
2. Существующий email (заранее созданный через admin) → LeadRequestDialog.
3. Новый email → PublicPayPage (карта, bePaid init после verify).
4. Существующий email → InvoiceCheckoutDialog (счёт).

Для каждого:

- письмо получено, `From: Екатерина Горбова <noreply@gorbova.by>`, Subject `Ваш код: NNNNNN`;
- код введён;
- `verify-inline-otp` → 200 с `token_hash`;
- `auth.verifyOtp` → session;
- `create-lead` / `create-order` / bePaid init стартуют **после** verify;
- нет call'ов бизнес-действий до verify (проверка Network HAR).

Дополнительно: `/auth/recover` (password reset) не сломан — форма присылает дефолтное Lovable-письмо (задокументировать as-is, вне scope патча).

### 11. Proof

`.lovable/proofs/inline_otp_email_sender_root_fix_2026_07.md` — переписать полностью:

- Выбранный путь: собственный OTP-канал, обход GoTrue hook.
- Почему без участия заказчика: используем существующий Yandex SMTP + `SUPABASE_SERVICE_ROLE_KEY` из env edge-функций.
- Что НЕ трогали: DNS, sender, SMTP, Lovable Emails, `auth-email-hook`, шаблоны.
- Схема потока (диаграмма выше).
- Скриншоты 4 E2E-сценариев: email step / code step / письмо в inbox с From / Network waterfall (request-inline-otp 200 → verify-inline-otp 200 → auth verifyOtp 200 → business action 200) / успешный финальный экран.
- Rollback: `VITE_INLINE_AUTH_MODE=link` (задокументирован как аварийный, письма не гарантируются).
- Статус: `verified` после успешного E2E.

## Технические детали

**Новые файлы:**

- `supabase/migrations/<ts>_inline_otp_codes.sql`
- `supabase/functions/request-inline-otp/index.ts`
- `supabase/functions/request-inline-otp/index.test.ts`
- `supabase/functions/verify-inline-otp/index.ts`
- `supabase/functions/verify-inline-otp/index.test.ts`
- `supabase/functions/_shared/inline-otp-email-template.ts` (ru OTP письмо, тот же visual стиль что и у существующих Yandex-писем)

**Правки:**

- `supabase/config.toml` — 2 блока `verify_jwt=false`.
- `src/hooks/useInlineEmailOtp.ts` — заменить транспорт (send + verify).
- `src/hooks/useInlineEmailOtp.test.ts` — обновить моки.
- `.lovable/proofs/inline_otp_email_sender_root_fix_2026_07.md` — переписать.
- `.lovable/plan.md` — обновить.

**Без изменений:**

- `_shared/yandex-smtp-sender.ts`, `auth-email-hook/*`, `_shared/email-templates/*`, DNS, sender, `.env`, шаблоны Lovable Emails, `ensureInlineAuthReady`, `InlineEmailOtpForm`, все call-sites (LeadRequestDialog, InvoiceCheckoutDialog, PublicPayPage, FormSection).

**Безопасность:**

- OTP hash: `sha256(code + salt)`, salt случайный per-row.
- Constant-time compare через `crypto.subtle`.
- Rate-limit по email + IP.
- Attempts lockout = 5.
- TTL = 10 мин.
- Никаких секретов в клиенте.
- Endpoint публичный (`verify_jwt=false`), защищён hash+TTL+lockout+rate-limit.
- `generateLink` вызывается только после успешной верификации кода.

## Definition of Done

1. Миграция применена, таблица `inline_otp_codes` существует с корректными GRANT.
2. Обе edge-функции задеплоены, unit-тесты зелёные.
3. Frontend переключён на новый транспорт, все `useInlineEmailOtp` тесты зелёные.
4. E2E-матрица (4 сценария) пройдена агентом самостоятельно на mail.tm, evidence в proof.
5. Письмо реально приходит с From `noreply@gorbova.by`, Subject `Ваш код: NNNNNN`.
6. Lead/payment стартуют строго после `verifyOtp` success (подтверждено HAR).
7. Rollback `VITE_INLINE_AUTH_MODE=link` компилируется (без гарантии доставки — задокументировано).
8. Без участия заказчика: без PAT, без Dashboard, без DNS-изменений, без смены sender.