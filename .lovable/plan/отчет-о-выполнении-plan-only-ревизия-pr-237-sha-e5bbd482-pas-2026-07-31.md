# Отчет о выполнении: PLAN-ONLY ревизия PR #237 (SHA e5bbd482) — PASS

## 1. Preflight
- Managed HEAD = `e5bbd482aaab7e9ff9baf4771f1505c71f0edb02` (Merge PR #237), дерево чистое (`git status --porcelain` пуст).
- Diff `8675bc3d0..e5bbd482a` ровно 8 файлов scope, ничего вне scope: `AutoRenewalsTabContent.tsx` (+196/-...), `NotificationStatusIndicators.tsx`, `autoRenewalInstallments.ts` + тест, `autoRenewalObservabilityDeliverySources.test.ts` (+51), `supabase/config.toml` (+6), `admin-auto-renewal-observability/index.ts` (+170), новая `admin-cancel-unpaid-subscription-drafts/index.ts` (+212).

## 2. admin-auto-renewal-observability
- `config.toml` → `verify_jwt = true` сохранён. В коде: Bearer обязателен → `auth.getUser()` → `has_role_v2` (admin/super_admin/manager/menedzher) через service-role, иначе 403.
- Наружу отдаются только `channel, subscription_id, event_type, days_before, effective_charge_at, status, reason, error_message, created_at` и агрегаты `attempts`. Ни email, ни chat_id, ни тела сообщений, ни `meta` целиком. В логах только `error.code`.
- Best-effort merge: canonical `notification_outbox` (жёсткий 500 при отказе) + legacy `telegram_logs`, `email_logs`, `audit_logs`; отказ legacy-источника, `provider_subscriptions` и `installment_payments` пишет имя в `sourceErrors` и не валит ответ. Ответ явно содержит `source_errors`, `requested`, `window_days`.
- Связка попыток: `subscriptionByOrder` (order_id подписки + order_id provider-строки), `subscriptionByProviderId` (`meta.bepaid_subscription_id`, `meta.provider_subscription_id`, `providerResponse.subscription_id/provider_subscription_id`), прямые `meta.subscription_v2_id/subscription_id`, `subscriptionByPaymentId` из `installment_payments`; дубли отсечены через `countedPaymentIds`.
- Окно `created_at >= now() - days` (по умолчанию 45, clamp 1..90), максимум 2000 ID, пустой список → `{logs:[],attempts:{}}`.

## 3. UI: ошибка источника и последняя отправка
- `useQuery` больше не глотает ошибку (`throw new Error(error.message ...)`), `console.error(...)+пустой ответ` удалён. При `observabilityError` или непустом `source_errors` рендерится `role="alert"`: «Статусы уведомлений и попыток загружены не полностью… Серые индикаторы нельзя считать подтверждением отсутствия отправки».
- `NotificationStatusIndicators`: удалён фильтр `minskDateKey(log.effective_charge_at) !== minskDateKey(nextChargeAt)`, поэтому последняя доставка не пропадает после переноса `next_charge_at`. Тултип теперь показывает «Отправка:» и «К списанию:» раздельно.

## 4. Доказательство оплаты и живые итоги
- `hasRealInstallmentEvidence` больше не принимает `paidAmount`; поле заменено на `linkedSuccessfulPayments` с явным комментарием, что `orders_v2.paid_amount` не является доказательством. Остальные доказательства: `evidence.firstPaymentSucceeded`, `paidPayments > 0`, `providerLastChargeAt`.
- UI считает `linkedSuccessfulPayments` из `payments_v2` по `order_id` c `status='succeeded'` и `is_deleted=false` (чанки по 200).
- Неоплаченные заготовки помечаются `kind='installment_draft'`, исключены из живых итогов (`filter === 'installment_drafts'` — единственный режим, где они видны; в остальных `renewal.kind === 'installment_draft'` отбрасывается, включая KPI-строки 1192/1197/1204) и имеют отдельный фильтр «Неоплаченные заготовки».
- `canAutoCharge` ограничивает «к оплате»/«автосписание» типами `provider_managed` и `mit`; `link_only` переименован в «Нет автосписания» и в суммы не попадает. `canceled_at` теперь читается и отменённые записи из списка исключаются.

## 5. admin-cancel-unpaid-subscription-drafts (новая)
- `config.toml` → `verify_jwt = true` + комментарий. В коде Bearer → `auth.getUser()` → `has_permission('subscriptions.edit')`/`has_role_v2(admin)`/`has_role_v2(super_admin)`, иначе 403.
- Только POST, иначе 405. IDs валидируются как UUID, дедуп, `0 < n <= 100`, иначе 400.
- Dry-run по умолчанию: мутация только при явном `dry_run === false`.
- Блокировка при любом подтверждении оплаты: `installment_payments` (`succeeded`/`paid`/`paid_at`/`payment_id`), успешный `payments_v2` по `order_id`, `provider_subscriptions.last_charge_at`; уже отменённые → `already_canceled`.
- Никаких `.delete()`: только `UPDATE subscriptions_v2` (`auto_renew=false`, `canceled_at`, `cancel_at`, метки в `meta`) с защитой `.is('canceled_at', null)`; платежи, сделки и доступы не трогаются. Провайдерская отмена делегируется существующей `bepaid-cancel-subscriptions`.
- Аудит: одна строка `audit_logs` с `action='subscription.unpaid_drafts_cancel'` и только счётчиками (`requested/eligible/canceled/blocked/failed`), без PII.

## 6. Managed schema
- Подтверждены все выбранные колонки: `subscriptions_v2(order_id,status,canceled_at,cancel_at,auto_renew,charge_attempts,meta)`, `provider_subscriptions(subscription_v2_id,provider_subscription_id,state,last_charge_at,order_id)`, `installment_payments(subscription_id,payment_id,charge_attempts,status,paid_at,last_attempt_at,error_message)`, `payments_v2(order_id,status,is_deleted,meta,provider_response,paid_at,error_message)`, `audit_logs(action,actor_type,actor_user_id,actor_label,meta)`.
- Индекс присутствует: `idx_audit_logs_actor_label_created_at (actor_label, created_at DESC)`.
- RPC существуют: `has_role_v2(_user_id uuid, _role_code text)`, `has_permission(_user_id uuid, _permission_code text)`. Новых миграций этому PR не требуется.

## Замечание (не блокер, fail-closed)
`admin-cancel-unpaid-subscription-drafts` вызывает `has_permission` с именем аргумента `_permission`, тогда как managed-сигнатура — `_permission_code`. Вызов вернёт ошибку, `permission.data` будет `null`, и доступ останется только у `admin`/`super_admin`. Безопасность не страдает (закрывается, а не открывается), но менеджер с правом `subscriptions.edit` получит 403. Правка кода вне scope этого READ-ONLY ревью; выносится в follow-up.

## EXECUTE-план (после одобрения, без создания нового кода)
1. Preflight: подтвердить SHA `e5bbd482a...` и чистое дерево; STOP при mismatch.
2. Deploy ровно двух функций: `admin-auto-renewal-observability` и `admin-cancel-unpaid-subscription-drafts`, обе с сохранением `verify_jwt = true`.
3. Safe smokes:
   - анонимный POST на обе функции → 401; битый Bearer → 401;
   - observability с пустым `subscription_ids` → 200 `{logs:[],attempts:{}}`;
   - observability на минимальном наборе существующих ID → только счётчики/агрегаты и `source_errors`, без PII в отчёте;
   - cancel-функция: только `dry_run: true` на заведомо несуществующем UUID (ожидается `eligible: []`) и проверка границ 400 (пустой список / >100). Реальные записи не отменяются.
4. `vitest` на `src/test/autoRenewalObservabilityDeliverySources.test.ts` и `src/lib/autoRenewalInstallments.test.ts`.
5. Ровно один frontend Publish при всех PASS.

STOP при SHA/schema drift, любом 5xx, регрессии авторизации или critical finding.
Запрещено и не планируется: миграции, изменение схемы/RLS/Storage/данных, секреты, cron, реальные сообщения, платежи, списания и отмены.

**Статус: PASS. Ожидаю EXECUTE.**
