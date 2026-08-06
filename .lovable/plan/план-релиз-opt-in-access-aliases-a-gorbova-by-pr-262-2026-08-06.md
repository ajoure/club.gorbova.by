# План: релиз opt-in access aliases `a.*.gorbova.by` (PR #262)

Режим текущего ответа: PLAN-ONLY / READ-ONLY. Ничего не изменено, не синхронизировано, не развёрнуто и не опубликовано.

## 1. Текущее состояние (PASS)

- Managed/saved SHA рабочего дерева: `9e607413562d6db690b3906203427beb76be9814` — совпадает с указанным origin/main.
- Рабочее дерево чистое (`git status --porcelain` пусто), новых коммитов после #262 нет.
- Последний опубликованный SHA: `85f0f72ce2361e6bb0d4228f29ab4967502bf9d9`.
- Единственный неопубликованный diff = ровно коммит `9e607413` («feat: add alternate VPS access aliases (#262)»), 33 файла, +542/−51. Sync на exact SHA ничего не откатывает: `85f0f72c` — прямой родитель.

## 2. Проверка diff (PASS, соответствует заявленному scope)

- Frontend: `src/utils/accessAlias.ts` (+ тест), `src/main.tsx` (инициализация guard/noindex), `DomainRouter.tsx` (canonical hostname для lookup), внутренние ссылки/`window.open` в `PaymentDialog`, `ConsultationPaymentDialog`, `PublicPayPage`, `LibraryLesson`, `LibraryModule`, `PaymentMethods`, `StripePortalButton`, `LeadRequestDialog`, `FormSection`, `LiveEventRoomBlocks`, `SitePageBySlug`, `usePublicProduct`.
- Edge: новый `_shared/access-alias-origin.ts`; `create-payment-checkout.ts` — `effectiveOrigin = resolvePublicReturnOrigin(origin)`; `create-stripe-checkout.ts` — передача `request_origin`; `public-app-host.ts` — приоритетный источник `access_alias` для Stripe success/cancel; `auth-email-hook` — сохранение alias-хоста в подписанных ссылках; строгий CORS расширяется в `rr-fulfill-order`, `submit-lead-request`, `company-sync-admin`.
- Ops/docs: `ops/caddy/gorbova-access-aliases.Caddyfile`, `docs/release/2026-08-04-russia-access-aliases.md`.
- Новых файлов и правок сверх PR не предлагается.

## 3. Migrations (PASS — NONE)

В коммите нет ни одного файла `supabase/migrations/**` и ни одного `.sql`. Managed migrations на этот релиз: **NONE**. Любая появившаяся migration/schema write = STOP.

## 4. Lovable issues (5 pending, ни одна не блокирует)

| Finding | Класс | Комментарий |
| --- | --- | --- |
| `canonical-document-send` → `tariffs.public_title` не существует | actionable, вне scope | отдельная задача, к aliases отношения нет |
| `getcourse-webhook` → `no_instance_id` | expected/owner-config | URL вебхука в GetCourse без `instance_id` |
| `telegram-check-expired` → `telegram-revoke-access` non-2xx | observation-only | свежих подтверждений нет, наблюдение |
| `amocrm-webhook` → `secret_not_configured` | excluded | интеграция не используется |
| QA: отмена не-bePaid recurring | expected | подтверждённое product-решение (Stripe отменяется через портал) |

Новых critical, конфликтов SHA и schema/dependency mismatch нет. Ничего не исправляем в этом релизе.

## 5. EXECUTE-шаги (выполнять только после отдельного одобрения)

1. **Sync exact SHA** `9e607413562d6db690b3906203427beb76be9814`. Никакой регенерации кода.
2. **Deploy Edge Functions** — ровно import-graph изменённых хелперов (см. ниже).
3. **Supabase Auth redirect allow-list** — добавить 7 exact записей (см. ниже).
4. **Read-only / synthetic smokes** (см. ниже). Любой FAIL → STOP, без Publish.
5. **Publish UI** с того же SHA — только после полного PASS.
6. DNS и Caddy **не трогаем**: их выполняет Codex после успешного Publish.

## 6. Deploy list (подтверждён по import graph, 15 функций)

Прямые импортёры `_shared/access-alias-origin.ts` (9):
`auth-email-hook`, `bepaid-create-subscription-checkout`, `bepaid-create-token`, `company-sync-admin`, `direct-charge`, `public-charge-saved-card`, `public-checkout`, `rr-fulfill-order`, `submit-lead-request`.

Через `_shared/create-payment-checkout.ts` (3):
`admin-create-payment-link`, `subscription-renewal-reminders`, `telegram-send-reminders` (последние два — через `_shared/generate-renewal-ctas.ts`).

Через `_shared/public-app-host.ts` (3):
`stripe-admin-sandbox-checkout`, `stripe-create-checkout`, `stripe-create-subscription-checkout`.

Список кандидатов пользователя подтверждён полностью — сокращать и дополнять нечего. Прочие косвенные упоминания (`bepaid-webhook`, `admin-create-public-link`, `public-create-installment-link`) — совпадения по неизменённым модулям (`charge-notification-policy`, комментарии), они в deploy scope **не входят**.

## 7. Supabase Auth redirect allow-list (7 exact записей, без wildcard host)

```text
https://a.gorbova.by/**
https://a.club.gorbova.by/**
https://a.cb.gorbova.by/**
https://a.cons.gorbova.by/**
https://a.consultation.gorbova.by/**
https://a.zg.gorbova.by/**
https://a.calendar.club.gorbova.by/**
```

Существующие canonical-записи не удаляются и не изменяются.

## 8. Смоуки после deploy и до Publish (без побочных эффектов)

- **Unit/contract тесты локально:** `accessAlias.test.ts`, `accessAliasEdgeContract.test.ts`, `accessAliasPaymentReturnContract.test.ts` — должны быть зелёными.
- **Alias-логика (чистые функции):** canonical↔alias маппинг для 7 хостов, отказ для `pdf.`/`access.`, отсутствие двойного `a.a.`.
- **Stripe URL resolver (read-only):** `resolveStripeCheckoutUrls` с `request_origin=https://a.club.gorbova.by` возвращает `source='access_alias'`; без alias — прежний источник. Проверяется тестом, без обращения к Stripe.
- **Edge health:** для каждой из 15 функций — только boot/health-ответ или заведомо безопасный отказ валидации (например `link_not_found`), без создания заказов, платежей, пользователей, OTP, писем и Telegram-сообщений.
- **CORS:** OPTIONS-preflight с `Origin: https://a.club.gorbova.by` на `rr-fulfill-order`, `submit-lead-request`, `company-sync-admin` — origin допускается; чужой origin — отклоняется.
- **UI preview:** canonical routing, отсутствие regress на `gorbova.by`/`club.gorbova.by`, desktop + mobile скриншоты.

Реальный платёж, отмена подписки, регистрация, отправка OTP/письма/Telegram и любые записи в БД — запрещены.

## 9. STOP-условия

- Managed SHA после sync ≠ `9e607413562d6db690b3906203427beb76be9814`.
- Появился новый коммит в origin/main или нежданный локальный diff.
- В scope обнаружена любая migration / schema write / Auth-изменение сверх 7 redirect-записей.
- Новый critical finding, dependency или schema mismatch.
- Любой FAIL в тестах, deploy или смоуках — Publish не выполняется.
- Любая попытка правки DNS/Caddy на стороне Lovable.
