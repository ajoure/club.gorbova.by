да, согласен, с учетом правок:

1. В UI не писать «тестовые ключи». Формулировка:
  - **ключи тестового режима Stripe**
  - **ключи боевого режима Stripe**
2. В конце заменить:
  - «ввод тестовых ключей»
  на:
  - «ввод ключей тестового режима Stripe».
3. В подсказках не писать, что аккаунт тестовый. Правильно:
  - «Stripe-аккаунт реальный. В тестовом режиме Stripe платежи проверяются без реального списания денег».
4. `PUBLIC_APP_HOST = https://gorbova.by` — ок, но добавить правило:
  - если позже будет установлен production app domain в env/config, использовать его вместо хардкода.
5. `CANONICAL_PUBLIC_HOST = https://club.gorbova.by` для `/pay/:token` не трогать.

После этих правок план можно запускать.

&nbsp;

План: PATCH Stripe Phase 2 — Settings UX + domain-safe redirect URLs

Скоуп: UI/config only. Файл `StripeConnectionDialog.tsx` + лёгкий guard в `acquiring-save-connection` (валидация режим↔префикс ключа и запрет lovable-доменов в success/cancel). bePaid pipeline, `create-payment-checkout.ts`, Stripe webhook/checkout edge-функции — НЕ трогаем (кроме чтения существующего `success_url`/`cancel_url`, контракт не меняется).

## 1. Изменяемые файлы

1. `src/components/admin/integrations/StripeConnectionDialog.tsx` — полная русификация, режим Stripe (test/live, live disabled), domain-safe дефолты URL.
2. `supabase/functions/acquiring-save-connection/index.ts` — server-side guard:
  - если `test_mode=true` и `secret_key` задан → должен начинаться с `sk_test_`; `publishable_key` → `pk_test_`;
  - если `test_mode=false` (live) → `sk_live_`/`pk_live_`; в Фазе 2 live запрещён (возврат `code: live_mode_disabled`);
  - `success_url`/`cancel_url` не должны содержать `lovable.app|lovable.dev|lovableproject.com|localhost|127.0.0.1` и не должны указывать на `*.supabase.co/functions/v1/*` (используем существующий helper `isForbiddenPublicHost` через копию constants на сервере — без импорта из `src/`).
3. `.lovable/proofs/stripe_phase_2_settings_ux_domain_patch.md` — proof.

## 2. UI: русские подписи и подсказки (StripeConnectionDialog)

Заменить:

- «Publishable key (pk_test_...)» → **«Публичный ключ Stripe»** + подсказка: «Используется для публичных клиентских сценариев Stripe. Не является секретом.»
- «Secret key (sk_test_...)» → **«Секретный ключ Stripe»** + подсказка: «Используется сервером для создания платежей. В браузер не возвращается.»
- «Webhook signing secret (whsec_...)» → **«Секрет подписи webhook»** + подсказка: «Нужен для проверки, что уведомления действительно пришли от Stripe.»
- «Success URL» → **«URL после успешной оплаты»** + подсказка: «Куда клиент вернётся после оплаты. Не указывайте Supabase или preview-домен.»
- «Cancel URL» → **«URL после отмены оплаты»** + подсказка: «Куда клиент вернётся, если отменит оплату.»
- «Account code» → **«Внутренний код подключения»**.
- «Locale» → **«Язык писем/чеков»**.
- Title diaog: «Настройки Stripe» (как сейчас).

Все toast/error: русские формулировки.

Удалить «технические» placeholder `pk_test_...`, `sk_test_...`, `whsec_...` как самостоятельные подписи — оставить только в `placeholder` поля с поясняющей подписью рядом.

## 3. Режим Stripe (test/live)

Заменить нынешний alert «Фаза 2: только test mode…» на блок **«Режим Stripe»** с двумя радио-опциями (`RadioGroup`):

- ● **Тестовый режим** — для проверки без реального списания денег. Ключи: `pk_test_…`, `sk_test_…`.
- ○ **Боевой режим** *(disabled)* — для реальных платежей. Ключи: `pk_live_…`, `sk_live_…`. Подсказка: «Live-режим будет включён отдельным согласованием после sandbox-проверки.»

Под группой текст: «Stripe-аккаунт реальный. В Stripe есть два режима ключей: sandbox (test) и live. Тестовый режим использует отдельные sandbox-ключи и позволяет проверить оплату без реального списания денег.»

В Фазе 2 `testMode` остаётся `true` и не редактируется. Запретить отправку live в edge-функции (см. §6).

## 4. Domain-safe success/cancel URL (UI default)

Логика дефолта при создании подключения:

```text
1. canonicalHost = "https://gorbova.by"            (новая константа PUBLIC_APP_HOST)
2. success default = `${canonicalHost}/admin/integrations/payments?stripe_result=success`
3. cancel  default = `${canonicalHost}/admin/integrations/payments?stripe_result=cancel`
```

(admin redirect для sandbox-проверки оставляем на admin-странице, но base — production domain, НЕ `window.location.origin`, НЕ `*.lovableproject.com`.)

Для будущих клиентских платежей в подсказке указать рекомендуемые значения:

- `https://gorbova.by/dashboard?payment=success`
- `https://gorbova.by/pricing?payment=cancel`

Если текущий `window.location.hostname` подпадает под `isForbiddenPublicHost` (lovable preview) — показать жёлтое предупреждение:

> «Сейчас открыт preview-домен. Для реальных платежей будут использоваться URL основного сайта (gorbova.by).»

Существующий `CANONICAL_PUBLIC_HOST` (`https://club.gorbova.by`) — для `/pay/:token`. Для admin-возврата используем `https://gorbova.by`. Введём отдельную константу `PUBLIC_APP_HOST` в новый файл-helper `src/utils/publicAppHost.ts` (или дополним `buildPublicPaymentUrl.ts`), переиспользуя `isForbiddenPublicHost`.

UI-валидация на blur: если введённый URL содержит lovable-домен / supabase function URL → красная подсказка «Этот домен нельзя использовать для возврата клиента».

## 5. Webhook URL

В диалоге добавить read-only блок **«URL для webhook в Stripe Dashboard»** с значением:

```
https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/stripe-webhook
```

- кнопка «Скопировать» + подсказка: «Это server-to-server endpoint, клиент его не видит. Вставьте его в Stripe Dashboard → Developers → Webhooks. Полученный `whsec_…` вставьте в поле "Секрет подписи webhook" выше.»

Webhook URL остаётся Supabase Edge Function — это допустимо.

## 6. Server-side guard (`acquiring-save-connection`)

Минимальные дополнения, без изменения контракта:

- `test_mode=true`:
  - `publishable_key`, если задан, must match `^pk_test_`;
  - `secret_key`, если задан, must match `^sk_test_`;
  - mismatch → 200 `{ ok:false, code:"key_mode_mismatch", message:"Ключ не соответствует режиму Stripe" }`.
- `test_mode=false` → 200 `{ ok:false, code:"live_mode_disabled", message:"Live-режим отключён в Фазе 2" }`.
- `success_url`/`cancel_url`:
  - regex `^https://`;
  - не содержит `lovable.app|lovable.dev|lovableproject.com|localhost|127\.0\.0\.1`;
  - не содержит `supabase.co/functions/v1/`;
  - нарушение → 200 `{ ok:false, code:"forbidden_redirect_host", message:"URL возврата не должен указывать на preview/Supabase-домен" }`.

UI отображает эти коды русскими сообщениями через `normalizeEdgeFunctionError`.

## 7. Freeze-зоны (диффы пустые)

- `supabase/functions/bepaid-*`
- `supabase/functions/create-payment-checkout.ts`
- `supabase/functions/stripe-create-checkout/index.ts` (контракт `success_url`/`cancel_url` уже читает из БД)
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/_shared/acquiring/vault.ts`, `stripe-adapter.ts`, `stripe-client.ts`
- Миграции — не создаём.
- `integration_instances` — не трогаем.

## 8. DoD

1. Все подписи/подсказки/тосты/ошибки `StripeConnectionDialog` — на русском.
2. Нет голых placeholder вида `pk_test_...` без сопровождающего русского описания.
3. Поле «Режим Stripe» с двумя опциями; «Боевой режим» disabled с подсказкой.
4. Secret key и webhook secret не возвращаются в браузер (как сейчас).
5. Дефолтные success/cancel URL построены от `https://gorbova.by`, не от `lovableproject.com`.
6. Customer-facing URL не могут содержать `*.supabase.co/functions/v1/*` (UI + server guard).
7. Webhook URL отображается в UI с возможностью скопировать; это Supabase Edge Function — допустимо.
8. bePaid UI и pipeline визуально и функционально неизменны.
9. `git diff` по `bepaid-*` и `create-payment-checkout.ts` пуст.
10. Build green.
11. Proof: `.lovable/proofs/stripe_phase_2_settings_ux_domain_patch.md` с чек-листом DoD и списком неизменённых файлов.

После merge — продолжаем Фазу 2: ввод тестовых ключей через UI, test connection, sandbox checkout, webhook, idempotency, refund.