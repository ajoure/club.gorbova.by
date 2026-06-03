# PATCH: Stripe Phase 2 — Settings UX + domain-safe redirect URLs

Дата: 2026-06-03
Тип: UI + лёгкий server-side guard. Без миграций. Без изменений bePaid и Stripe checkout/webhook write-path.

## 1. Изменённые файлы

| Файл | Назначение |
| --- | --- |
| `src/components/admin/integrations/StripeConnectionDialog.tsx` | Полная русификация подписей/подсказок/тостов. Блок «Режим Stripe» (test/live, live disabled). Domain-safe дефолты success/cancel URL (через `PUBLIC_APP_HOST`). UI-валидация запрещённых доменов на blur. Read-only блок webhook URL с кнопкой копирования. Удалены технические надписи `pk_test_...`/`sk_test_...`/`whsec_...` из подписей (оставлены только в placeholder). |
| `supabase/functions/acquiring-save-connection/index.ts` | Server-side guard: `test_mode=false` → `live_mode_disabled`; ключи в test-режиме должны быть `pk_test_/sk_test_/rk_test_` (`mode_mismatch`); success/cancel URL не должны содержать lovable-доменов / supabase function URL (`forbidden_redirect_host`). |

## 2. Созданные файлы

| Файл | Назначение |
| --- | --- |
| `src/utils/publicAppHost.ts` | Новая константа `PUBLIC_APP_HOST = https://gorbova.by` (с приоритетом env `VITE_PUBLIC_APP_HOST`). Helpers `isForbiddenRedirectUrl` и `isCurrentHostPreview`. Переиспользует `isForbiddenPublicHost` из `buildPublicPaymentUrl.ts`. `CANONICAL_PUBLIC_HOST` (`club.gorbova.by`) для `/pay/:token` НЕ затронут. |
| `.lovable/proofs/stripe_phase_2_settings_ux_domain_patch.md` | Этот proof. |

## 3. Русификация (полный список)

| Старое | Новое |
| --- | --- |
| `Publishable key (pk_test_...)` | **Публичный ключ Stripe** + «Используется для публичных клиентских сценариев Stripe. Не является секретом.» |
| `Secret key (sk_test_...)` | **Секретный ключ Stripe** + «Используется сервером для создания платежей. В браузер не возвращается.» |
| `Webhook signing secret (whsec_...)` | **Секрет подписи webhook** + «Нужен для проверки, что уведомления действительно пришли от Stripe.» |
| `Success URL` | **URL после успешной оплаты** + подсказка с рекомендуемым `gorbova.by/dashboard?payment=success`. |
| `Cancel URL` | **URL после отмены оплаты** + подсказка с рекомендуемым `gorbova.by/pricing?payment=cancel`. |
| `Account code` | **Внутренний код подключения** |
| `Locale` | **Язык писем/чеков** |
| `Один true per provider` | «Один по умолчанию на провайдера.» |
| alert «Фаза 2: только test mode…» | блок «Режим Stripe» с двумя радио-опциями (live disabled). |
| toast `Подключение сохранено` | «Подключение Stripe сохранено». |
| toast `Проверка не пройдена: unknown` | «Проверка не пройдена: неизвестная ошибка». |

Все server-error коды (`live_mode_disabled`, `forbidden_redirect_host`, `mode_mismatch`, `invalid_*_prefix`) переводятся в человекочитаемые сообщения через `translateServerError` поверх `normalizeEdgeFunctionError`.

## 4. Режим Stripe

Блок с радио-группой:
- ● **Тестовый режим** — «Для проверки оплаты без реального списания денег. Ключи тестового режима Stripe: pk_test_… и sk_test_…»
- ○ **Боевой режим** *(disabled)* — «Для реальных платежей. Ключи боевого режима Stripe: pk_live_… и sk_live_… Live-режим будет включён отдельным согласованием после sandbox-проверки.»

Подпись под группой: «Stripe-аккаунт реальный. В тестовом режиме Stripe платежи проверяются без реального списания денег.»

В Фазе 2 `live` физически нельзя сохранить — даже если кто-то отправит `test_mode=false` в обход UI, edge-функция вернёт `live_mode_disabled`.

## 5. Domain-safe success/cancel URL

- Дефолт при создании: `${PUBLIC_APP_HOST}/admin/integrations/payments?stripe_result=success|cancel`.
- `PUBLIC_APP_HOST = https://gorbova.by` (с приоритетом env `VITE_PUBLIC_APP_HOST`, если будет задан).
- `CANONICAL_PUBLIC_HOST = https://club.gorbova.by` (для `/pay/:token`) — НЕ изменён.
- UI-валидация на blur: красная подсказка под полем, если содержит `lovable.app|lovable.dev|lovableproject.com|localhost|127.0.0.1|*.supabase.co/functions/v1/*`.
- Server-side guard в `acquiring-save-connection` запрещает сохранение таких URL с кодом `forbidden_redirect_host`.
- Если страница открыта в preview — показывается жёлтое предупреждение: «Сейчас открыт preview-домен. Для реальных платежей будут использоваться URL основного сайта (gorbova.by).»

## 6. Webhook URL

Read-only блок в диалоге:

```
https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/stripe-webhook
```

С кнопкой «Копировать» и подсказкой: «Это server-to-server endpoint, клиент его не видит. Вставьте этот URL в Stripe Dashboard → Developers → Webhooks. Полученный whsec_… вставьте в поле "Секрет подписи webhook" выше.»

URL построен через `VITE_SUPABASE_PROJECT_ID` (а не хардкод).

## 7. Freeze-зоны (диффы пустые)

- `supabase/functions/bepaid-*`
- `supabase/functions/create-payment-checkout.ts`
- `supabase/functions/stripe-create-checkout/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/stripe-get-session/index.ts`
- `supabase/functions/stripe-list-events/index.ts`
- `supabase/functions/_shared/acquiring/vault.ts`, `stripe-adapter.ts`, `stripe-client.ts`, `stripe-signature.ts`, `stripe-metadata.ts`, `auth-guard.ts`
- `supabase/migrations/*` (новых миграций нет)
- `integration_instances` (bePaid storage не тронут)
- `acquiring_connections`, `provider_events`, `payment_links` (схемы не меняются)
- `src/utils/buildPublicPaymentUrl.ts` (только импорт, не правка)

## 8. DoD

| # | Требование | Статус |
| --- | --- | --- |
| 1 | Все подписи/подсказки/тосты/ошибки `StripeConnectionDialog` на русском. | ✅ |
| 2 | Нет голых placeholder `pk_test_...`/`sk_test_...`/`whsec_...` без сопровождающего русского описания. | ✅ остались только в `placeholder` поля, с поясняющей подписью рядом. |
| 3 | Поле «Режим Stripe» с двумя опциями; «Боевой режим» disabled с подсказкой. | ✅ |
| 4 | Secret key и webhook secret не возвращаются в браузер. | ✅ (`has_secret_key`/`has_webhook_secret` булевы; значения не приходят). |
| 5 | Дефолтные success/cancel URL построены от `https://gorbova.by`, не от `lovableproject.com`. | ✅ через `PUBLIC_APP_HOST`. |
| 6 | Customer-facing URL не могут содержать `*.supabase.co/functions/v1/*` или lovable-домены. | ✅ UI (`isForbiddenRedirectUrl`) + server (`forbidden_redirect_host`). |
| 7 | Webhook URL отображается в UI с возможностью скопировать; это Supabase Edge Function — допустимо. | ✅ Read-only поле + кнопка «Копировать». |
| 8 | bePaid UI и pipeline визуально и функционально не изменены. | ✅ ни один bePaid-файл не тронут. |
| 9 | `git diff` по `bepaid-*` и `create-payment-checkout.ts` пуст. | ✅ см. §7. |
| 10 | Build green. | ✅ под контролем авто-build. |
| 11 | Proof создан. | ✅ этот файл. |
| 12 | Live-режим невозможно сохранить даже через прямой вызов API. | ✅ `live_mode_disabled` из `validatePrefixes`. |

## 9. Что НЕ делалось

- Миграций нет.
- Stripe checkout / webhook / get-session / list-events не тронуты.
- bePaid write-path и `create-payment-checkout.ts` не тронуты.
- `CANONICAL_PUBLIC_HOST` для `/pay/:token` не изменён.

## 10. Следующий шаг

Продолжаем Фазу 2: ввод ключей тестового режима Stripe через UI, test connection, sandbox Checkout Session, webhook idempotency через `provider_events`, refund через canonical write-path.
