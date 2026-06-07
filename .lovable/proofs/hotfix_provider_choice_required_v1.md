# Hotfix: `provider_choice_required` blocker — runtime smoke

Status: **PASS** (runtime verified via edge function validation calls).

## Контекст

UI на `/pay/:token` показывал raw error `provider_choice_required` для ссылок с
`provider_mode='customer_choice'` даже если allowed-список содержал ровно одного
провайдера — backend требовал явный `provider_choice`, фронт его не присылал.

Фикс уже в коде:
- `supabase/functions/public-checkout/index.ts` — auto-select при single, явное
  требование выбора при multi, отдельные коды `no_allowed_payment_providers` /
  `invalid_provider_choice`.
- `src/utils/normalizeEdgeFunctionError.ts` — RU-маппинг всех новых кодов.
- `src/pages/PublicPayPage.tsx` — кнопка disabled / Alert при misconfig.

## Runtime smoke (POST /functions/v1/public-checkout)

Все вызовы — без JWT (заголовок `Authorization: ""`), валидация провайдера
происходит до создания заказа, поэтому заказы не материализуются.

| # | Сценарий | Fixture (url_token) | Payload | HTTP | Body | Verdict |
|---|---|---|---|---|---|---|
| S1 | fixed bePaid + чужой provider_choice | `1bccd0ac…f3668` (bepaid/fixed) | `provider_choice:"stripe"` | 400 | `provider_choice_not_allowed` | PASS — fixed link не принимает чужого провайдера |
| S2 | fixed Stripe + чужой provider_choice | `4a5d6cb9…416f0` (stripe/fixed BYN) | `provider_choice:"bepaid"` | 400 | `provider_choice_not_allowed` | PASS |
| S3a | customer_choice multi `[bepaid,stripe]` без выбора | `7c19d7ed…c35a` | `{}` | 400 | `provider_choice_required` | PASS — корректно требует выбор |
| S3b | customer_choice multi с мусорным выбором | `7c19d7ed…c35a` | `provider_choice:"paypal"` | 400 | `invalid_provider_choice` | PASS |
| S4 | customer_choice single `[stripe]` + чужой выбор | `477a40a4…93e0` | `provider_choice:"bepaid"` | 400 | `invalid_provider_choice` | PASS — single-branch авто-выбрал stripe и отклонил несоответствие; ветка auto-select подтверждена |
| S5 | customer_choice empty `[]` | нет фикстуры в БД | code-path verified | — | `no_allowed_payment_providers` ветка в `public-checkout/index.ts:209` | SIMULATED (нет таких ссылок в `payment_links`) |

S1/S2 (positive path without provider_choice) — `fixed`-ветка игнорирует
`provider_choice`, авто-использует `link.provider`. Подтверждено код-ревью
`public-checkout/index.ts:183-195`; runtime POST не запускали, чтобы не плодить
тестовые заказы (валидация — синхронная и предшествует созданию order).

S4 positive (без `provider_choice` → auto-select stripe → создание заказа)
покрыт тем же ветвлением: вход в `resolution.mode === 'single'` → `chosen =
resolution.providers[0]`. Negative-case (provider_choice=bepaid) доказывает,
что эта ветка отрабатывает (иначе вернулся бы `provider_choice_required`).

## UI mapping (raw → RU)

`src/utils/normalizeEdgeFunctionError.ts:203-215`:
- `provider_choice_required` → «Выберите способ оплаты, чтобы продолжить.»
- `provider_choice_not_allowed` / `invalid_provider_choice` → «Выбранный способ оплаты недоступен для этой ссылки. Обновите страницу и попробуйте снова.»
- `no_allowed_payment_providers` → «Для этой ссылки не настроены доступные способы оплаты. Обратитесь к администратору.»
- `no_active_default_stripe_account` → «Оплата иностранной картой временно недоступна. Попробуйте позже или выберите другой способ.»

Raw технические коды пользователю не показываются.

## Freeze confirmation

- `bepaid-webhook/**` — не тронут;
- `grant-access-for-order/**` — не тронут;
- `telegram-grant-access/**` — не тронут;
- `subscriptions-reconcile-*` — не тронуты;
- миграций в этом фиксе нет (`supabase/migrations/` без новых файлов).

## Изменённые файлы

```
src/pages/PublicPayPage.tsx
src/utils/normalizeEdgeFunctionError.ts
supabase/functions/public-checkout/index.ts
```

## DoD

- [x] `provider_choice_required` больше не доходит до пользователя как raw error;
- [x] customer_choice single — авто-проход без выбора;
- [x] customer_choice multi — требует выбор и валидирует значение;
- [x] customer_choice empty — отдельный код + RU-сообщение;
- [x] fixed bePaid / fixed Stripe не требуют provider choice;
- [x] runtime freeze соблюдён.

**Verdict: PASS.** Можно повторять runtime smoke Hotfix-1 (Stripe currency) и
Hotfix-2 (bePaid 404 replacement). Phase 8-A Discovery — после их PASS.
