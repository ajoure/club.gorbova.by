# Discovery: возврат контекста после подтверждения email

Дата: 2026-07-06. Статус: **read-only, code-changes НЕ выполнялись.**
Формат — по approved plan (`.lovable/plan.md`). Всё, что ниже, — факты из кодовой базы, без предположений.

---

## 1. Все точки регистрации / inline-auth

### 1.1 `supabase.auth.signUp` (2 места)

| # | Файл : строка | `emailRedirectTo` | Что делает после возврата |
|---|---|---|---|
| 1 | `src/contexts/AuthContext.tsx:157` | `${window.location.origin}/` | Пользователь возвращается на `/`. Дальше срабатывает эффект в `src/pages/Auth.tsx:202-244`: `redirectTo` из URL → `getLastRoute()` → **fallback `/dashboard`**. Контекст lead/payment не восстанавливается. |
| 2 | `src/hooks/useInlineAuth.ts:190` | `window.location.href` | В теории должен вернуть на исходную страницу с query. **Проблема:** ссылка из письма открывается в **новой вкладке** большинства почтовых клиентов. В новой вкладке загружается product page, но исходная вкладка не знает о подтверждении. Плюс, `emailRedirectTo` НЕ обрабатывается `AuthVerifyProxy` — там жёстко зашит `${VITE_SUPABASE_URL}/auth/v1/verify${search}` (см. `src/pages/AuthVerifyProxy.tsx:26-32`). Supabase после verify сам делает 302 на `redirect_to` из query письма. |

### 1.2 Потребители `useInlineAuth` / `InlineAuthForm`

| Файл | Как ждёт email confirmation |
|---|---|
| `src/components/lead/LeadRequestDialog.tsx:179` | **Никак.** `useAuth().user` фиксируется на mount; нет `onAuthStateChange`, нет polling. Если пользователь подтвердит в новой вкладке, диалог висит на шаге `auth` навсегда. |
| `src/components/payment/InvoiceCheckoutDialog.tsx:253` | Аналогично LeadRequestDialog — только через `useAuth()`. |
| `src/pages/PublicPayPage.tsx:682` | Аналогично. |
| `src/components/auth/InlineAuthForm.tsx:245-253` | Показывает статический текст «вернитесь на эту страницу — она остаётся активной». **Не активна.** |
| `src/components/site-renderer/blocks/FormSection.tsx:717-727` | Единственное место, где есть listener: `supabase.auth.onAuthStateChange` на `SIGNED_IN`. Работает только когда сессия обновляется в **этой же вкладке** через `storage`-event Supabase-клиента (см. §3). |

**Вывод:** три из четырёх inline-flow не имеют вообще никакого механизма ожидания. FormSection имеет частичный.

---

## 2. Точки редиректа в `/dashboard`, ломающие возврат

Ключевые (участвуют в post-confirm flow):

- `src/pages/Auth.tsx:173` — `redirectTo = searchParams.get("redirectTo") || "/dashboard"`.
- `src/pages/Auth.tsx:211-244` — эффект `useEffect([user, mode, ...])` при появлении `user`: `redirectTo` из URL → `lastRoute` → `/dashboard`. **Именно этот эффект уносит пользователя из lead/payment flow, если verify сделал redirect на `/`.**
- `src/hooks/useLastRoute.ts` — саму запись `lastRoute` в разрезе inline-flow контролировать сложно; путь до диалога — не тот же URL, что нужен для восстановления.

Ручные `navigate('/dashboard')` в хедерах (`LandingHeader`, `ProductLandingHeader`, `CourseHeader`, `ConsultationHeader`, `Help.tsx`, `Purchases.tsx`, `useIOSAdminGuard`) — **вне flow**, не трогаем.

---

## 3. Как Supabase-клиент видит новую сессию в исходной вкладке

Клиент создан в `src/integrations/supabase/client.ts` с `persistSession: true, storage: localStorage, autoRefreshToken: true`. Supabase JS сам слушает `storage`-event и вызывает `onAuthStateChange('SIGNED_IN')` в других вкладках того же origin, когда verify-tab пишет `sb-<ref>-auth-token`.

**Ограничения (реально бьют по нам):**
1. Cross-origin. Продовые лендинги: `gorbova.by`, `zg.gorbova.by`, `consultation.gorbova.by`, `cb.gorbova.by`, `cons.gorbova.by`, `club.gorbova.by`, `calendar.club.gorbova.by`. `localStorage` разделён по origin. Если исходная вкладка — `zg.gorbova.by`, а верификация ушла на `club.gorbova.by` (или что настроит Supabase site_url) — event не долетит.
2. Некоторые браузеры (iOS Safari private, кросс-профильные вкладки) не всегда доставляют `storage`-event надёжно.
3. Даже когда `SIGNED_IN` пришёл, `session.access_token` может быть кэшированный старый до `refreshSession()`. Нужно **обязательно** `refreshSession()` → `getSession()` → `getUser()` перед подачей `submit-lead-request` (иначе 401 на server-verified endpoint).

Итог: `onAuthStateChange` — **не может быть основным каналом**. BroadcastChannel (same-origin, но instant) + storage-fallback + refreshSession-before-getUser — правильная схема из плана.

---

## 4. Bot mentions (полный список)

Все точки, где имя бота встречается в коде:

| Файл : строка | Что содержит | Тип |
|---|---|---|
| `src/components/onboarding/WelcomeOnboardingModal.tsx:217` | `href="https://t.me/Gorbova_club_bot"` | **Хардкод — заменить.** |
| `src/components/onboarding/WelcomeOnboardingModal.tsx:222` | `@Gorbova_club_bot` (visible text) | **Хардкод — заменить.** |
| `supabase/functions/course-prereg-notify/index.ts:48` | Комментарий `Get the support bot (gorbovabybot)` | Комментарий — обновить для консистентности. |
| `src/components/site-renderer/blocks/FormSection.tsx:875` | `https://t.me/preview_bot?start=demo` | Preview-заглушка (не касается прод) — не трогаем. |

Все остальные `t.me/` ссылки — **динамические**, берутся из БД (`bots.bot_username`) через `supabase/functions/telegram-link-manage/index.ts:157`, `src/components/telegram/TelegramLinkButton.tsx:29`, `src/pages/admin/TelegramInvites.tsx:204`, `PreregistrationDetailSheet`, `ContactDetailSheet`. Кода менять не нужно — **достаточно обновить строку в таблице `bots`.**

**Требуется отдельная задача P8:** `UPDATE public.bots SET bot_username = 'gorbovabybot' WHERE ...` (после того, как убедимся в текущем значении и есть ровно один активный support-бот). Плюс замена двух хардкодов в WelcomeOnboardingModal и комментария в edge-функции.

### Официальный username (подтверждено пользователем)
- `@gorbovabybot`
- `https://t.me/gorbovabybot`

Все встречавшиеся варианты (`@Gorbova_club_bot`, `@Gorbovo_buy_bot`, `@Gorbova_buy_bot`) — заменить.

---

## 5. Как поведёт себя каждый сайт СЕЙЧАС

Общий сценарий для всех: пользователь нажимает CTA → `LeadRequestDialog` / `PaymentDialog` / FormSection → email → signup → приходит письмо → открывает ссылку в новой вкладке → interstitial `AuthVerifyProxy` → жмёт «Продолжить» → Supabase verify → 302 на `emailRedirectTo`.

| Сайт / поток | Текущий результат |
|---|---|
| `gorbova.by` product page → PaymentDialog | Новая вкладка приходит на product URL (из `window.location.href`). Auth-редирект в `Auth.tsx` не срабатывает (мы не на `/auth`), но user залогинен. Новая вкладка **не знает** об открытом PaymentDialog, показывает лендинг. Исходная вкладка висит с текстом «подтвердите email». Оплата **не продолжается**. |
| `gorbova.by` product page → LeadRequestDialog | То же самое, диалог висит. Заявка не отправляется. |
| Любой site-page с FormSection (`auth_mode`) | Новая вкладка попадает туда же (по `emailRedirectTo = href`), там сработает `onAuthStateChange` в новой вкладке — но она пустая. Исходная — **если тот же origin** — тоже поймает `SIGNED_IN` через storage-event и продвинет `email_confirm_wait → next`. Работает **только на том же origin**, и только если пользователь ничего не закрыл. |
| `Auth.tsx` (регистрация в личный кабинет) | Новая вкладка попадает на `/` → эффект в Auth.tsx → навигация в `/dashboard`. Работает как «дошёл до ЛК», но не помогает публичным flow. |
| Любые subdomain'ы (`zg`, `cb`, `cons`, `club`, `consultation`, `calendar.club`) | Если `redirect_to` идёт на другой subdomain — исходная вкладка вообще не получает событий. Полный провал. |

---

## 6. Дополнительные проверки (по правкам пользователя)

### 6.1 Обязательно ли `refreshSession()` перед `getUser()` в polling?
Да. При кросс-табной синхронизации через storage-event Supabase кладёт свежий JSON в localStorage, но локальный in-memory кэш клиента может держать старый access_token до следующего сетевого обращения. `getSession()` вернёт localStorage-версию (это дешёвая операция), но чтобы гарантировать server-validated `getUser()` не поймал `403 email_not_confirmed` или `401 expired`, порядок должен быть: `refreshSession()` (мягкий — если токен валиден, ничего не сломает) → `getSession()` (проверить, что access_token обновлён, email_confirmed_at заполнен) → `getUser()` (server-side валидация).

### 6.2 Сценарий: пользователь уже зарегистрирован, но email не подтверждён; открывает lead/payment повторно
Сегодня: `useInlineAuth.checkEmail()` вернёт `{exists: true, has_password: true}` → переход на login step. Пользователь введёт пароль → `signInWithPassword` вернёт `email_not_confirmed`. Показывается ошибка «Email не подтверждён. Проверьте почту…». Тупик — пользователь застрял.

Нужное поведение: если `login()` вернул `email_not_confirmed` — автоматически перевести на `email_confirm` step (тот же waiter, что после signup); повторно инициировать письмо через `auth-actions confirm_signup`; **не создавать нового auth.users** (мы не вызываем signUp, просто ждём подтверждения существующего). Условие «дубль не создаётся» — выполняется автоматически, потому что новый `signUp` в этом сценарии не вызывается.

Добавляется в план (P2/P7): reusable-хук должен принимать `initialState: 'awaiting_confirmation'` и переводить login-flow с `email_not_confirmed` в этот же waiter.

---

## 7. Definition of Done для discovery

- [x] Все `signUp` перечислены (2 шт., указаны emailRedirectTo).
- [x] Все `useInlineAuth`/`InlineAuthForm` потребители перечислены (5 шт.) с их текущим wait-механизмом.
- [x] Все `/dashboard` редиректы, участвующие в flow, идентифицированы (Auth.tsx:202-244 — единственный критичный).
- [x] Механика cross-tab session Supabase-клиента описана; ограничения по origin/refresh задокументированы.
- [x] Все bot-упоминания перечислены; официальный username подтверждён; изменения сведены к 2 хардкодам + 1 UPDATE в БД + 1 комментарию.
- [x] Сценарий «уже зарегистрирован, не подтверждён» разобран; поведение хука уточнено.

---

## 8. Ready для P2–P8

Всё готово к реализации. Следующий шаг — по approved-плану:
- P2: `src/hooks/useAwaitInlineAuthReady.ts`
- P3: `src/lib/inlineAuthFlow.ts`
- P4: `AuthVerifyProxy.tsx` — success screen
- P5: `AuthContext`/Auth.tsx — guard от `/dashboard` при активном flow
- P6: `useInlineAuth` — `emailRedirectTo = ${origin}/auth-verify`, регистрация flow
- P7: PaymentDialog/LeadRequestDialog/InvoiceCheckoutDialog/PublicPayPage/FormSection — общий хук
- P8: WelcomeOnboardingModal + миграция `bots.bot_username = 'gorbovabybot'` (+ комментарий в edge)
