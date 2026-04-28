## да, согласен, с учетом правок:

1. Для auth-писем сначала **проверить реальный контракт hook**: какие поля приходят (`token_hash`, `redirect_to`, `email_action_type`, `confirmation_url`) и не вставлять `confirmation_url` напрямую, если он содержит `supabase.co`.
2. `auth/callback` должен принимать:
  - `token_hash`
  - `type`
  - `next`
  - fallback для старых ссылок
3. В DoD добавить grep:

```bash
rg "hdjgkjceownmmnrqqtuz|supabase\.co|lovable\.app|lovable\.dev" src index.html supabase/functions
```

4. Исключения должны быть явно закомментированы `admin-only` / `server-to-server`, иначе не засчитывать.
5. `supabase.functions.invoke` скрывает URL из исходника, но в Network он всё равно пойдёт на Supabase endpoint. Это нормально; цель — убрать из публичного HTML/текстов/коммуникаций.

Можно выполнять.

&nbsp;

Цель

В клиентских коммуникациях (письма, Telegram, публичный UI, HTML главной страницы) НИГДЕ не должен светиться `https://hdjgkjceownmmnrqqtuz.supabase.co`. Все ссылки — на `https://gorbova.by` (или его поддомены).

Скриншот клиента (письмо «Сброс пароля») подтверждает главный источник проблемы: дефолтные auth-письма Supabase с ссылкой `*.supabase.co/auth/v1/verify?...`.

## Диагностика (выполнена через rg)

Источники утечки:

**A. Auth-письма (КРИТИЧНО, сценарий со скриншота)**

- `supabase/functions/auth-email-hook/` отсутствует.
- GoTrue шлёт дефолтные шаблоны со ссылкой на `*.supabase.co/auth/v1/...`.

**B. Edge functions — fallback-домены**

- `supabase/functions/telegram-mass-broadcast/index.ts:555,606` — fallback `gorbova.lovable.app`, склейка из `SUPABASE_URL.replace('.supabase.co','')`.
- `supabase/functions/telegram-admin-chat/index.ts:1829` — fallback `gorbova.lovable.app`.

**C. Frontend хардкоды `${projectId}.supabase.co/functions/v1/...**` (видны в исходнике страницы и в DevTools/Network):

- `index.html` — `<link rel="preconnect">` и `<link rel="preload" href="...supabase.co/functions/v1/public-product?domain=club.gorbova.by">`.
- `src/components/payment/PaymentDialog.tsx:611`
- `src/pages/PublicPayPage.tsx:92-93`
- `src/components/site-renderer/blocks/FormSection.tsx:176`
- `src/pages/admin/AdminAmoCRM.tsx` (4 fetch + 2 текстовых вывода webhook URL)
- `src/components/admin/lesson-editor/blocks/uploadToTrainingAssets.ts:269`
- `src/components/admin/forms/FormsDetailOpener.tsx:134`
- `src/archive/pages/AdminPayments.tsx:321` (архив)

Платёжные `return_url`/`success_url`/`fail_url` в edge-функциях уже идут через `gorbova.by` (`CANONICAL_PUBLIC_HOST` или `effectiveOrigin`). Серверный `notification_url = ${SUPABASE_URL}/functions/v1/bepaid-webhook` остаётся — это server-to-server, клиент его не видит.

## Что делаем

### Шаг 1. Auth-письма (решает скриншот)

1. Проверить статус email-домена; если sender-домен (например `notify.gorbova.by`) ещё не настроен — показать диалог настройки.
2. Scaffold `auth-email-hook` + 6 React-Email шаблонов (signup, recovery, magic-link, invite, email-change, reauthentication).
3. Стилизовать шаблоны под бренд: цвета из `src/index.css`, белый body, лого, русский язык. Все ссылки строятся через `confirmationUrl` из site_url. В HTML писем НИКОГДА нет `*.supabase.co`.
4. Deploy `auth-email-hook`.
5. Проверить frontend `/auth/callback`: корректная обработка `token_hash` + `type` через `supabase.auth.verifyOtp` для recovery/signup/email_change. Если страницы нет — создать.
6. Сообщить пользователю: после верификации DNS sender-домена в Cloud → Emails письма пойдут с `gorbova.by`. **Дополнительно** попросить пользователя в Lovable Cloud → Auth убедиться, что `Site URL = https://gorbova.by` и в Redirect URLs нет `*.supabase.co` / `*.lovable.app` (эта настройка управляется через Cloud UI).

### Шаг 2. Frontend — заменить хардкоды URL функций на `supabase.functions.invoke`

Все вызовы `fetch(\`https://${projectId}.supabase.co/functions/v1/...)`→`supabase.functions.invoke('&nbsp;', { body, headers })`. Поведение сохраняется, исходник перестаёт раскрывать ref проекта.

Файлы:

- `PaymentDialog.tsx` (`public-charge-saved-card`)
- `PublicPayPage.tsx` (`public-checkout`, `public-charge-saved-card`)
- `FormSection.tsx` (`site-form-upload`)
- `AdminAmoCRM.tsx` — 4 fetch на `amocrm-sync`. Текстовые webhook-URL для копирования в внешние панели amoCRM/bePaid (admin-only) **оставить** с пометкой `// admin-only display`.
- `uploadToTrainingAssets.ts` (`training-assets-delete`)
- `FormsDetailOpener.tsx` (`training-assets-download`) — если используется как `<a href>`, перевести на invoke с blob или signed-URL из storage.
- `archive/pages/AdminPayments.tsx` — оставить в архиве с пометкой или удалить отображаемый URL.

### Шаг 3. `index.html`

- Удалить `<link rel="preload" href="https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/public-product?...">`.
- Удалить `<link rel="preconnect" href="https://hdjgkjceownmmnrqqtuz.supabase.co">`.
- Перформанс-выигрыш мизерный по сравнению с раскрытием ref в любом исходнике страницы.

### Шаг 4. Edge functions — fallback-домены

- `telegram-mass-broadcast/index.ts:555,606` — fallback `gorbova.lovable.app` → `https://gorbova.by`. Убрать сборку из `SUPABASE_URL.replace('.supabase.co','')`.
- `telegram-admin-chat/index.ts:1829` — fallback `gorbova.lovable.app` → `https://gorbova.by`.

### Шаг 5. Memory + правило

Создать `mem://security/communications/no-supabase-url-leakage`:

> Клиентские коммуникации (email, Telegram, SMS, публичный UI, HTML главной страницы) НИКОГДА не содержат `*.supabase.co` и `*.lovable.app`. Канон: `https://gorbova.by`. `SUPABASE_URL` используется только для серверных вызовов (включая bePaid `notification_url`). Frontend дёргает edge functions через `supabase.functions.invoke`, не строит URL руками. Auth emails идут через кастомный `auth-email-hook` со ссылками на `gorbova.by/auth/callback`. Исключения с пометкой: admin-only displayed webhook URLs (для копирования в внешние панели), `system-health-full-check` (диагностика).

Добавить Core-строку.

## DoD

- `rg "supabase\.co" supabase/functions/ src/ index.html` возвращает только: серверные `${SUPABASE_URL}/functions/v1/bepaid-webhook` (notification_url), `system-health-full-check` (админ-диагностика), admin-only displayed webhook URL в `AdminAmoCRM` (с пометкой). НИЧЕГО клиентского.
- `rg "lovable\.app" supabase/functions/` пусто.
- `supabase/functions/auth-email-hook/` существует и задеплоен; шаблоны со ссылками `gorbova.by`.
- Тестовое письмо «Сброс пароля» приходит со ссылкой на `gorbova.by` и корректно завершает recovery-flow.
- `index.html` без preload/preconnect на supabase.co.
- Memory обновлена; добавлена Core-строка.

## Технические детали

```text
client → fetch hardcode  → https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/X
                            (виден в исходнике страницы и в Network)

         ↓ заменяем на

client → supabase.functions.invoke('X', {body})
                            (URL не присутствует в коде, JS-клиент строит его внутри)
```

```text
GoTrue (default) → email link: https://hdjgkjceownmmnrqqtuz.supabase.co/auth/v1/verify?token=...

         ↓ через auth-email-hook + scaffolded templates

GoTrue → auth-email-hook → React Email template:
                            link: https://gorbova.by/auth/callback?token_hash=...&type=recovery
```

## Что НЕ трогаем

- Серверный `notification_url` для bePaid (внутренний webhook, клиент не видит).
- `supabase/functions/system-health-full-check/` (админ-диагностика).
- Custom API domain (`api.gorbova.by` → Supabase) — отдельная задача, пока не требуется (по решению пользователя).
- Admin-only displayed webhook URLs в `AdminAmoCRM` для копирования в внешние панели.
- Уже отправленные письма — их не переписать; фикс применяется к будущим коммуникациям.