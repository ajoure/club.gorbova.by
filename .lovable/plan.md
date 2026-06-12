План: PATCH-STRIPE-DOCUMENTS-DRAWER-V2 (v2, с правками 1–17, add-only)

Все ранее утверждённые пункты сохраняются. Ниже только дополнения и точечные mapping'и старых пунктов.

## 0. Правила (без изменений)

DIAGNOSE → PLAN → DRY-RUN → EXECUTE → VERIFY. Add-only / no-loss. UUID-only связи. Не менять lifecycle/webhooks/scenarios/templates/secrets. Каждый approve — STOP + отчёт.

## 1. Mapping старых deploy-gates → новые (правка №1)

- Старо: «Approve B — resolver задеплоен» → Ново: **Approve B = backend code + tests, deploy НЕ выполняется**.
- Старо: «Approve D — deploy resolver + frontend» → Ново: **Approve D = один совместный точечный deploy backend resolver + frontend + runtime/security/regression proof**.
- Approve A = read-only discovery. Approve C = frontend code + tests, без deploy.

Это исключает промежуточное prod-состояние «resolver есть, UI нет».

## 2. Approve A — Read-only discovery (APPROVED)

Артефакт: `.lovable/discovery/stripe_documents_drawer_v2.md` (read-only к коду/БД, но сам discovery-md создаётся в режиме build после переключения; код/config/DB не менять).

A1. **Exact file map** — таблица /admin/payments, существующий drawer/modal payment details, кнопки «Чек / Документ / Сформировать / Скачать / Открыть», все readers (`receipt_url`, `invoice_url`, `hosted_invoice_url`, `invoice_pdf`, `document_url`, `ai_generated_documents`, signed-URL helpers). Точные пути.

A2. **Existing resolver/drawer inventory (правка №2)** — полный поиск перед предложением новой функции:
- `payment documents`, `payment details drawer`, `receipt resolver`, `document resolver`, `canonical-document-*`, `ai_generated_documents readers`, `signed URL helpers`, provider receipt adapters.
- Если канонический resolver можно расширить без нарушения контракта — **расширяем**, новую функцию не создаём.
- При двух действующих resolver-path → `STOP ARCHITECTURE_CONFLICT` + mapping `текущий reader/action → canonical` + способ сохранения обратной совместимости.

A3. **DB relationship map** — `payments_v2` ↔ `orders_v2` ↔ `ai_generated_documents` ↔ `provider_subscriptions` ↔ refund relations. Только UUID-связи.

A4. **Stripe/bePaid document-source matrix** — какие документы лежат локально (`meta.stripe.*`, `meta.bepaid.*`, `receipt_url`, `provider_response`), какие требуют provider retrieve.

A5. **Refund parent mapping (правка №6)** — фактический канонический источник связи refund row → parent positive. Допустимо: local parent UUID, точный provider parent object ID, существующая canonical refund relation. Запрещены: amount/date/email/last4/order title/nearest payment. Если не найден — `source = unavailable`, warning `REFUND_PARENT_NOT_RESOLVED`. Никакого наследования чужого receipt.

A6. **Technical payment marker (правка №7)** — какой canonical marker помечает техническую Stripe-оплату 2 USD (`meta.test_payment` / fixture marker / test order marker). Запрещено определять по сумме. Если marker отсутствует — `STOP` для generation-action этой строки + backlog отдельным PATCH'ем; не хардкодить сумму/UUID.

A7. **RBAC mapping (правка №10)** — сопоставить логические capability с действующими permissions:
- просмотр платежей → просмотр документов;
- edit/admin → provider refresh;
- существующий document-generation permission → generate;
- существующий regeneration permission → regenerate;
- super_admin → diagnostics.
- Новые DB permissions / role tables / migrations в этом патче **запрещены**. При отсутствии granular permission — использовать существующий более строгий guard.

A8. **URL/domain inventory (правка №11)** — фактический allowlist доменов provider URL (Stripe billing/files, bePaid receipt), какие bucket'ы используются для внутренних PDF, поведение signed URL helper'ов.

A9. **Inventory с terminal verdict (правка №14)** — для каждой Stripe row и 5 контрольных bePaid:
`payment_id, provider, positive/refund, parent_payment_resolution, account_code, mode, payment_intent_id, charge_id, invoice_id, refund_id, credit_note_id, local provider documents, refreshable provider documents, internal document relation, internal documents count, scenario source, can_generate, blocked_reason, technical/test marker, final verdict`.
Verdict ∈ { `READY_LOCAL_ONLY`, `READY_PROVIDER_REFRESH`, `READY_INTERNAL_DOCUMENTS`, `READY_GENERATION`, `NO_PROVIDER_DOCUMENTS`, `NO_INTERNAL_DOCUMENTS`, `REFUND_PARENT_RESOLVED`, `REFUND_PARENT_NOT_RESOLVED`, `TEST_PAYMENT_GENERATION_BLOCKED`, `ARCHITECTURE_CONFLICT` }.

A10. **Canonical recommendation + proposed exact scope Approve B** — расширять существующий resolver vs создать `admin-payment-documents-resolve`, список файлов adapters, точный response contract, перечень тестов.

A11. **Conflicts / STOP conditions** — собрать всё найденное.

DoD Approve A: один consolidated отчёт `Отчёт о выполнении: PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve A` со всеми пунктами A1–A11. Код/config/DB не изменены.

## 3. Approve B — Backend code + tests, БЕЗ deploy (NOT APPROVED)

Артефакт: `.lovable/proofs/stripe_documents_drawer_v2_resolver.md`.

B1. Resolver (расширение существующего или новый `admin-payment-documents-resolve` — по итогам A2). При создании новой функции — добавить блок `[functions.admin-payment-documents-resolve] verify_jwt = true`.

B2. **Read-only contract (правка №9, №3)**: resolver НЕ генерирует/перегенерирует документ, НЕ выделяет номер, НЕ сохраняет signed URL, НЕ меняет payment/order, НЕ меняет document scenario. `refresh_provider=true` разрешает только server-side retrieve и возврат whitelisted документов в текущем response. Запрещено обновлять `payments_v2.meta`, менять provider IDs / status / amount / currency, создавать order/payment/document, сохранять полный provider response, кэшировать URL в БД. Разрешено только `audit_logs: admin.payment_documents.provider_refresh`. `last_provider_refresh` — timestamp текущего запроса или из audit, без записи в payment row. Постоянное кэширование — отдельный PATCH.

B3. **Stripe adapter — account-aware и mode-aware (правка №4)**: client выбирается ТОЛЬКО через существующий canonical resolver по `account_code` + `mode/test-live` платежа. Запрещены глобальный default, live fallback, поиск аккаунта по валюте/названию. При неоднозначности — `status=error, blocked_reason=STRIPE_ACCOUNT_NOT_RESOLVED`, provider API не вызывать.

B4. **Только exact retrieve (правка №5)**: разрешённые ID — `pi_*, ch_*, in_*, re_*, cn_*, sub_*`. Запрещены search/list invoice по customer, поиск по email/сумме/дате, перечисление всех invoices/credit notes. `credit_note` — только при точном CN ID или доказанной связи через точный invoice ID; не обещать credit note для обычного refund.

B5. Whitelisted Stripe-поля: `charge.receipt_url, invoice.hosted_invoice_url, invoice.invoice_pdf, invoice.id, credit_note.pdf, refund.id/status`. Не сохранять PAN/CVC/expiry/fingerprint, full charge/invoice, billing_details, payment_method_details, customer, full webhook payload. Provider API failure → `status=error + retryable`, drawer не ломается.

B6. bePaid adapter — тонкая обёртка над существующим receipt workflow в общий response contract. Не переписывать.

B7. Refund — по канонической связи из A5. Provider receipt parent_payment'а отображается как `source: parent_payment` + refund metadata. Без фиктивных receipt'ов.

B8. **Provider document contract без дублей (правка №13)**: canonical identity = `provider + type + external_id` для provider docs, `document UUID` для internal. Если ссылка найдена и локально, и через provider API — одна карточка; приоритет `provider_api > local_meta` только при совпадении exact external ID; источник может быть `local_meta+provider_api`. Две одинаковые карточки запрещены.

B9. Internal documents — lookup `payment_id → order_id → ai_generated_documents` (UUID-only). По итогам A — определить: как отличаются версии, какой документ актуален, показывать ли историю, как исключаются дубли одного файла, какой status = `generated|pending|failed`. Frontend дедупликацию по названию/номеру НЕ делает.

B10. **Generation status — стабильные machine codes (правка №12)**: `NO_DOCUMENT_SCENARIO, MISSING_REQUIRED_REQUISITES, TEST_PAYMENT_DOCUMENT_BLOCKED, DOCUMENT_ALREADY_GENERATED, GENERATION_IN_PROGRESS, GENERATION_FAILED, PAYMENT_NOT_LINKED_TO_ORDER, REFUND_USES_PARENT_DOCUMENTS`. Никакого raw SQL/Stripe/error text в `blocked_reason`. Frontend только локализует.

B11. **URL security contract (правка №11)** в response: `{ url, url_kind: "external_provider"|"signed_storage", can_open, can_download, can_copy, expires_at }`. Только `https:`; `javascript:/data:/file:` и неизвестные схемы отклоняются; provider URL проверяется по allowlist из A8; внутренний файл — short-lived signed URL, не сохраняется в БД/audit; storage path / service-role URL / private bucket URL напрямую не выдаются; чувствительные query parameters не логируются. «Скачать» не показывать, если external URL поддерживает только открытие.

B12. **Test matrix (правка №16, минимум 20 кейсов)** — 10 из исходного G1 + 10 security/edge:
1. Stripe receipt; 2. Stripe invoice; 3. Stripe без provider docs; 4. Stripe refund; 5. Stripe consultation `can_generate=true`; 6. bePaid с receipt; 7. bePaid без receipt; 8. Payment без order; 9. Payment с сформированным internal; 10. Payment без сценария;
11. Stripe account не определён; 12. Unsafe URL scheme; 13. Refund parent не найден; 14. Дубликат local/provider document; 15. Technical payment generation blocked; 16. View-only refresh denied; 17. Provider API timeout/error не ломает internal; 18. Signed URL не сохраняется; 19. Resolver не создаёт document/audit generation action; 20. bePaid adapter выдаёт прежний receipt без изменения workflow.

DoD B: код написан, tests PASS локально, **deploy не выполнен**.

## 4. Approve C — Frontend code + tests, БЕЗ deploy (NOT APPROVED)

Действие «Документы» в /admin/payments. Drawer:
- Header: provider badge, amount/currency, status, date, masked payment ID, linked order.
- Секция 1 «Документы эквайринга»: Stripe receipt / hosted invoice / invoice PDF, bePaid receipt. Actions: Открыть / Скачать (если `can_download`) / Скопировать (если `can_copy`) / Обновить данные provider (super_admin, отдельный confirm, не авто).
- Секция 2 «Внутренние документы»: счёт-акт / акт / счёт / договор. Actions: Открыть / Скачать / Сформировать / Перегенерировать — только через **существующие canonical endpoints** с их текущим RBAC и audit. Новых generation flow нет.
- Секция 3 «Диагностика» (super_admin): masked provider object IDs, scenario source, masked template/executor ID, `can_generate`, `blocked_reason`, last provider refresh.
- Empty states точно по ТЗ. Никаких undefined/null/сломанных ссылок.
- Локализация machine codes из B10 — единственная работа frontend по статусам.

Frontend tests: рендер каждого state (Stripe/bePaid/refund/empty/view-only/super_admin diagnostics).

DoD C: UI готов, tests PASS, deploy не выполнен.

## 5. Approve D — Совместный deploy + runtime proof (NOT APPROVED)

Артефакты: `.lovable/proofs/stripe_documents_drawer_v2_ui.md`, `.lovable/proofs/stripe_documents_drawer_v2_security.md`.

D1. Точечный deploy: только новый/изменённый admin resolver + frontend. stripe-webhook / bepaid-webhook НЕ трогаем.

D2. Runtime UI proof под `7500084@gmail.com`: screenshots Stripe (с документами и без) / bePaid / refund (parent reference) / internal / empty.

D3. **View-only runtime proof (правка №15)**: если есть готовый безопасный view-only fixture — browser proof. Если нет — НЕ создаём новую роль/миграцию ради теста; достаточно: frontend component test + server invocation пользователем без write permission → 403 + подтверждение отсутствия write actions в rendered state. Это не блокирует PASS.

D4. Security proof: RBAC matrix (соответствие capability → существующим permissions из A7); URL safety per B11; audit safe meta; PCI scan = 0 forbidden keys.

D5. Regression: SQL diff before/after — 0 изменений payments_v2 / orders_v2 / subscriptions_v2 / entitlements / access_rules / payment_links.current_uses / document numbers; 0 авто-генераций при открытии drawer; 0 redeploy webhooks; bePaid receipt по 5 контрольным rows работает идентично прежнему.

## 6. Stop-conditions (расширены, правка №17)

К исходным добавлены немедленные STOP:
- refresh пишет Stripe URL / provider response в `payments_v2`;
- Stripe account выбран не по `account_code/mode`;
- Stripe `list/search` вместо exact retrieve;
- refund parent определён эвристически;
- technical 2 USD получил production document number;
- signed URL сохранён в БД/audit;
- resolver зовёт generation при открытии drawer;
- новый RBAC permission требует migration;
- один документ показан дважды из разных источников.

## 7. DoD финальный

PASS — все 16 пунктов исходного §12 + соответствие правкам 1–17 (mapping deploy-gates, отсутствие нового resolver при наличии канонического, read-through refresh, account/mode-aware Stripe, exact retrieve, canonical refund parent, technical marker, internal dedup-правила, read-only resolver, RBAC без миграций, URL contract, machine codes, no-duplicate карточки, terminal verdict в inventory, view-only proof, расширенный test matrix, расширенные stop-conditions).

## 8. Артефакты

- `.lovable/discovery/stripe_documents_drawer_v2.md` (Approve A)
- `.lovable/proofs/stripe_documents_drawer_v2_resolver.md` (Approve B)
- `.lovable/proofs/stripe_documents_drawer_v2_ui.md` (Approve C/D)
- `.lovable/proofs/stripe_documents_drawer_v2_security.md` (Approve D)
- Обновить `.lovable/plan.md`.

## 9. Gate status

- Approve A = APPROVED → выполняем сейчас.
- Approve B / C / D = NOT APPROVED.

## 10. Действие сейчас

Выполнить read-only discovery (rg по кодовой базе, SELECT-only к БД, inventory matrix) и собрать один consolidated отчёт `Отчёт о выполнении: PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve A` со всеми пунктами A1–A11 + terminal verdict таблица + canonical recommendation + proposed exact scope Approve B. Код / config / DB не изменять. Файл discovery-md создаётся в build-режиме (это сам артефакт отчёта, не правка прод-кода).

Жду переключения в build mode для исполнения Approve A.

---

## Approve A — выполнен (read-only discovery)

См. отчёт: `.lovable/discovery/stripe_documents_drawer_v2.md`

Verdict: **Approve A = PASS**

- 3 Stripe rows + 5 bePaid sampled, ARCHITECTURE_CONFLICT не найден.
- Canonical resolver «документы платежа» отсутствует → рекомендация создать новую `admin-payment-documents-resolve` (read-only orchestrator).
- Refund parent mapping каноничен через `meta.parent_payment_id` (UUID).
- Technical payment marker отсутствует → отдельный backlog-PATCH, drawer не блокируется.
- RBAC — без миграций, используем существующие role-checks (admin/super_admin/accountant + `requireSuperAdmin` для diagnostics).
- Private bucket `documents` → drawer отдаёт ТОЛЬКО short-lived signed URL on-the-fly.

Approve B / C / D — NOT APPROVED. Жду подтверждения Approve B.
