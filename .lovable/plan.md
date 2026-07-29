# PLAN-ONLY ревизия — Payment regressions release, PR #213 (HEAD `9a81668bc645723046e1c7a008a385f490133078`)

## Managed baseline
- `origin/main` HEAD = `9a81668b…` — MATCH exact merged SHA.
- Последний production Publish фронтенда — `609a4b64…` (PR #211).
- Последний production deploy backend — PR #212 (`0558c6f8…`, `admin-create-manual-payment`).

## Diff scope PR #213 (10 файлов, 0 миграций)
- `supabase/config.toml` — `grant-access-for-order.verify_jwt = false` с комментарием, что auth owned by function (`caller_auth.ts`: точный service key ИЛИ user JWT + branch-policy matrix до чтений/записей).
- `supabase/functions.registry.txt` — добавлен `invoice-pdf-retry`.
- `supabase/functions/_shared/finalize-composable-purchase.ts` — вводит `GrantAccessInvokeError` c `status` (HTTP из `error.context`) и sanitized `code` (regex `^[a-zA-Z0-9_.:-]+$`, ≤160 симв). Хелпер `grantAccessForOrder()` выбрасывает эту ошибку. PII в error не попадают — читается только `error/warning/reason/code` из ответа, отброшены `message`/`detail`.
- `supabase/functions/admin-create-manual-payment/index.ts` — при `GrantAccessInvokeError` дописывает `downstream_step`, `grant_status`, `grant_code` в `audit_logs.metadata` и в `fulfillment` respond-объект. `detail` (raw message) остаётся только в audit_logs, не в ответе.
- `src/components/ui/popover.tsx` — `PopoverContent` принимает `container` prop и пробрасывает в `Portal`.
- `src/components/admin/AdminPaymentLinkDialog.tsx` — `container={selectPortalContainer}` для списка продуктов → wheel/touch scroll работает под Dialog scroll-lock.
- Тесты: `finalize-composable-purchase_test.ts`, `fulfillment_wiring_test.ts`, `caller_auth_config_test.ts`, `AdminPaymentLinkDialog.select-flow.test.tsx` — дополнены.
- Ранее merged frontend JWT-патч для `invoice-delivery-status/retry/pdf-retry` присутствует в SHA: `InvoiceDeliverySuccess.tsx` вызывает `invokeAuthenticatedFunction` (Bearer из `supabase.auth.getSession()`).

## Findings
- Blockers: **нет**.
- Critical: **нет**.
- Info: `verify_jwt=false` для `grant-access-for-order` намеренно; matrix authorization в `caller_auth.ts` подтверждён отдельным `caller_auth_config_test.ts` и existing `grantAccessForOrder.handlerOrder.test.ts`.
- Info: `safeGrantCode` жёстко ограничивает передаваемый downstream code — email/имя/токен не могут утечь через `grant_code`.

## Ожидаемый Execute-план (после EXECUTE-approval)
1. **Sync** `origin/main` → зафиксировать `9a81668b…`.
2. **Migrations**: нет.
3. **Config change**: `supabase/config.toml` (grant-access verify_jwt) применяется автоматически при следующем деплое соответствующей функции.
4. **Deploy set (минимальный, необходимый)**:
   - `grant-access-for-order` — обязательно, чтобы `verify_jwt=false` вступил в силу на платформе (иначе шлюз продолжит 401-ить сервисные ключи).
   - `admin-create-manual-payment` — обязательно, downstream-код и типизированный error path.
   - `_shared/finalize-composable-purchase.ts` — общий модуль, необходимо переразвернуть **все функции, которые его импортируют** (как минимум `admin-create-manual-payment`; `finalize-composable-purchase` компилируется в bundle каждой вызывающей функции). Рекомендую подтвердить полный список импортёров через `rg` и перезалить их одним batch.
   - `invoice-delivery-status`, `invoice-delivery-retry`, `invoice-pdf-retry` — **не нужно** передеплоивать (исходники функций в PR #213 не менялись); регистрация `invoice-pdf-retry` в registry затрагивает только CI-пайплайн следующих релизов.
5. **Frontend Publish**: обязателен — фронт-часть (`popover.tsx`, `AdminPaymentLinkDialog.tsx`) + впервые попадает в прод frontend JWT-патч для invoice-delivery poll/retry.
6. **Read-back / safe smoke** (без реальных платежей, счетов, писем, Telegram, контактов):
   - `supabase.config` эффективный `verify_jwt` для `grant-access-for-order` = false (через анонимный `POST` без Auth: должен вернуть 401 от **функции** с телом `{"error":"unauthorized"}`, не платформенный 401 без CORS).
   - Анонимный `POST` `admin-create-manual-payment` → 401.
   - `public.audit_logs` за окно после deploy: `action='admin_manual_payment_fulfillment_failed'` — новые записи должны содержать `metadata.downstream_step='grant-access-for-order'` и `grant_code` из белого списка (`already_used`, `unauthorized`, `unknown` и т.п.). Baseline может быть 0 — отметить null-baseline PASS.
   - Frontend Publish smoke: открыть `/admin` под dev-паролем `123456`, в `AdminPaymentLinkDialog` открыть popover списка продуктов на 375px viewport, подтвердить wheel/touch scroll (screenshot desktop+mobile — обязателен по проектному UI-правилу).
   - Managed status: `ACTIVE_HEALTHY`.

## PLAN-ONLY COMPLETE
Блокеров и critical findings нет. Можно приступать к **EXECUTE для exact merged SHA `9a81668bc645723046e1c7a008a385f490133078`** по вышеописанному плану.
