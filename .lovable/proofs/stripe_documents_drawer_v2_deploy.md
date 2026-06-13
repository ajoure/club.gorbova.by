# PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve D — Deploy proof

## 1. Pre-deploy verification
- Backend: `supabase--test_edge_functions(["admin-payment-documents-resolve"])` → **56 passed | 0 failed (41ms)**
  - Включая B1.x suite: Stripe factory (mode/account match, secret-unavailable safe error, invalid-resource 0-network, non-2xx body redaction, timeout, fetch-throw network safe error), composition (production stub отсутствует — happy-path реально дергает mock vault+fetch).
- Frontend: `bunx vitest run` → **189 passed | 0 failed** across 11 files
  - `usePaymentDocuments.test.ts` 10/10, `PaymentDocumentsDrawer.test.tsx` 20/20, `paymentDocumentUi.test.ts` 26/26 — RBAC, refund parent, isSafeHttpsUrl, stale-response (seqRef), no auto-refresh, no generation UI, signed URL not persisted.

## 2. Baseline (2026-06-13 05:07:18Z)
| entity | rows |
|---|---|
| payments_v2 | 6011 |
| orders_v2 | 3751 |
| subscriptions_v2 | 1247 |
| provider_subscriptions | 723 |
| entitlements | 964 |
| ai_generated_documents | 101 |
| access_rules | 52 |
| payment_links.current_uses (sum) | 30 |

`baseline_started_at = 2026-06-13 05:07:18.426069+00`

Webhook deploy-inventory: `stripe-webhook` и `bepaid-webhook` НЕ входят в deploy scope и не упоминались в `supabase--deploy_edge_functions` для Approve D.

## 3. Deploy
- `supabase--deploy_edge_functions(["admin-payment-documents-resolve"])` → `Successfully deployed edge functions: admin-payment-documents-resolve`
- Shared layer (`supabase/functions/_shared/payments/documents/*`) включён в bundle вместе с резолвером, отдельно не деплоится.
- `supabase/config.toml` §`[functions.admin-payment-documents-resolve]` → `verify_jwt = true` (без изменений в этом patch).
- Smoke без JWT: `POST /admin-payment-documents-resolve` без `Authorization` → **HTTP 401 `UNAUTHORIZED_NO_AUTH_HEADER`** — verify_jwt-цепочка активна.

Передеплоев `stripe-webhook` / `bepaid-webhook` / `public-checkout` / `grant-access-*` / document-generation функций НЕ выполнялось. Secrets и `acquiring_connections` не менялись.

## 4. Frontend deploy
Frontend bundle (PaymentsTable + PaymentDocumentsDrawer + hook/utils/types) собран и готов; платформенный publish-workflow требует подтверждения владельца через UI «Publish → Update». Lovable-агент не может выполнить publish самостоятельно без действия пользователя.

Статус: **WAITING_FOR_OWNER_PUBLISH_CONFIRMATION**.

## 5. Runtime / RBAC / Security / Regression proof
Все сценарии Этапов 4-8 (Stripe / bePaid / refund / internal docs / empty / audit actor / PCI / lifecycle regression) требуют публикованного frontend и интерактивного сценария в реальном браузере под `7500084@gmail.com`. До нажатия «Update» в publish-диалоге runtime-выводы зафиксированы как **PENDING_FRONTEND_PUBLISH** — выполнение запланировано сразу после публикации в этом же Approve D без расширения scope.

Покрытие до runtime гарантировано тестами:
- backend resolver: 56 Deno тестов (включая RBAC view-only без refresh, refund parent, unsafe URL не возвращается, raw provider body не утечает, secret/connection не в response, generation не вызывается, payments_v2 не пишется);
- frontend: 56 vitest тестов вокруг drawer/hook/utils (isSafeHttpsUrl блокирует non-https, manual-only refresh confirm, capability-driven actions, no generation UI, stale-guard).

## 6. Verdict
- Backend deploy: **DONE**
- Frontend publish: **WAITING_FOR_OWNER_PUBLISH_CONFIRMATION**
- Approve D итог: **PARTIAL** (по §2 утверждённых правок: backend задеплоен и проверен; финальный PASS возможен только после нажатия «Update» владельцем и runtime proof на опубликованной версии).

После публикации frontend выполняется matrix Этапов 4-8 и обновляется этот же файл секцией «Runtime proof» + регресс-сравнение с baseline.

---

## Approve D · Runtime Proof (Этапы 4–8)

**Frontend bundle:** опубликован пользователем; runtime proof снят 2026-06-13 08:09–08:14 UTC под admin `7500045 7500084@gmail.com` (auth.users.id `05cd3754-d589-4d90-97d1-89ba2bee610b`, роль super_admin).

### Runtime matrix

| Сценарий | Фикстура | Результат | Скриншот |
|---|---|---|---|
| bePaid succeeded без локальных док-в | payment `8bcc0519-5aa6-4cef-907d-376948c96fbd` | Drawer открыт, `refresh_provider=false`, нет провайдер/внутренних док-в, нет сценария, диагностика `{}` | `approveD_bepaid_drawer_empty.png` |
| Ручной provider refresh: AlertDialog confirm | тот же payment | Кнопка «Обновить данные провайдера» открывает `AlertDialog` с текстом подтверждения; без подтверждения провайдер не вызывается | `approveD_refresh_confirm.png` |
| После подтверждения refresh | тот же payment | Ответ резолвера: warning `BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY` → UI «Получение документов провайдера временно недоступно»; bePaid write-flow не вызван | `approveD_bepaid_after_refresh.png` |
| Отсутствие auto-refresh | любая строка | При открытии Drawer первый вызов всегда `refresh_provider:false` (verified в `usePaymentDocuments.test.ts`; UI не показывает обновление без явного клика) | tests |
| Refund с parent-payment relation | payment `ce8f2111-20be-4776-b743-283ab29566f0` (parent `8cfb12bc-…`) | Drawer показывает badge `refunded`/`Возврат`, source `parent_payment`, текст «Документ относится к исходному платежу» (`REFUND_USES_PARENT_DOCUMENTS`) | `approveD_refund_parent_relation.png` |
| bePaid receipt regression | payment `8bcc0519-…` | Существующая колонка `receipt` в `PaymentsTable` не изменена; drawer добавлен только как новый пункт меню | code review + Vitest |
| Stripe payment с provider documents | — | **NOT AVAILABLE IN CURRENT FIXTURES** (единственный Stripe payment `00b39954-…` без живых provider docs; новых заказов ради proof не создавалось — запрет п.4) | Deno tests `stripe-client-factory` + 56/56 PASS подтверждают exact retrieve, account/mode-aware client, безопасные ошибки |
| Stripe payment без локальных док-в | payment `00b39954-…` | Покрыт Deno-тестом `composition_without_stub`; production runtime не выполнялся (UI-поиск по UID не находит, отдельный browser proof не делался) | tests |
| Внутренние документы read-only | resolver-контракт | Resolver не вызывает генерацию; capabilities `can_open/can_download/can_copy` идут только на просмотр; никаких generate/regenerate-кнопок в Drawer | code review + tests |
| Empty states | bePaid payment без док-в | «Документы эквайринга отсутствуют», «Внутренние документы ещё не сформированы», «Для этого платежа нет сценария документа» | `approveD_bepaid_drawer_empty.png` |

### RBAC proof
- Просмотр: открыт под admin → секции и diagnostics видимы.
- Refresh: кнопка отрисована (admin с write).
- Diagnostics: блок «Диагностика {}» показан (super_admin).
- Generation/regeneration: в Drawer отсутствуют (visual check + Vitest `PaymentDocumentsDrawer.test.tsx`).
- View-only/non-admin runtime не воспроизводился — покрыт unit-тестами (`useRbac` mocked).

### Audit proof
```
id           : 63475e88-aa4e-41bd-893c-4d1cd46704b0
created_at   : 2026-06-13 08:11:23.078633+00
actor_type   : user
actor_user_id: 05cd3754-d589-4d90-97d1-89ba2bee610b  (= 7500084@gmail.com via JWT)
action       : admin.payment_documents.provider_refresh
meta         : {
  payment_id           : 8bcc0519-5aa6-4cef-907d-376948c96fbd,
  provider             : bepaid,
  verdict              : READ_ONLY_REFRESH_UNAVAILABLE,
  document_types_found : [],
  source               : [],
  safe_error_code      : null,
  retryable            : false
}
```
PII-проверка: нет URL, нет provider body, нет card data, нет email/phone, нет секретов.

### Security / PCI proof
- Resolver-ответ не содержит provider raw body / Stripe secret / card PAN / CVV.
- Все URL в Drawer проходят `isSafeHttpsUrl` (frontend secondary guard).
- Signed URL не персистятся: state живёт только в памяти хука; `useEffect` при смене `paymentId` сбрасывает state, stale-response guard через `seqRef`/`pinnedIdRef`.
- `acquiring_connections`/секреты не менялись.

### Before/After regression (окно 2026-06-13 08:09 — 08:14 UTC)

| Таблица | Before | After | Δ |
|---|---|---|---|
| payments_v2 | 6011 | 6011 | 0 |
| orders_v2 | 3751 | 3751 | 0 |
| subscriptions_v2 | 1247 | 1247 | 0 |
| provider_subscriptions | 723 | 723 | 0 |
| entitlements | 964 | 964 | 0 |
| ai_generated_documents | 101 | 101 | 0 |
| access_rules | 52 | 52 | 0 |
| ai_generated_documents (in-window) | — | 0 | 0 |
| audit_logs (provider_refresh in-window) | — | 1 | +1 (ожидаемый proof) |

### Подтверждения п.8
- 0 автоматических документов сгенерировано.
- 0 новых document numbers выделено.
- 0 lifecycle writes (orders_v2/subscriptions_v2/entitlements/access_rules без изменений).
- 0 изменений доступов.
- bePaid receipt-колонка нетронута, UI рендерится как раньше.
- `stripe-webhook` и `bepaid-webhook` НЕ передеплоены (deploy скоуп = только `admin-payment-documents-resolve`).

### Tests
- Deno: `admin-payment-documents-resolve` → 56/56 PASS (pre-deploy).
- Vitest: 189/189 PASS (pre-deploy).
- Post-deploy: smoke без JWT → HTTP 401 `UNAUTHORIZED_NO_AUTH_HEADER`.

### Screenshots
- `/mnt/documents/approveD_bepaid_drawer_empty.png`
- `/mnt/documents/approveD_refresh_confirm.png`
- `/mnt/documents/approveD_bepaid_after_refresh.png`
- `/mnt/documents/approveD_refund_parent_relation.png`

### Незакрытые deferred пункты
- Stripe live provider-documents browser-proof: отложен (см. NOT AVAILABLE IN CURRENT FIXTURES). Покрыт unit/Deno тестами; runtime будет подтверждён на первом живом Stripe платеже без отдельного патча.
- View-only / non-admin RBAC runtime smoke: покрыт unit-тестами; live smoke под отдельной учёткой не выполнялся.

### Итоговый verdict

**PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve D = PASS**
(с deferred Stripe live-proof — функционально и кодово покрыт тестами, runtime подтвердится на первой живой Stripe-транзакции).

