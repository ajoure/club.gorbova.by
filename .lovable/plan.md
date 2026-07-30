# PLAN-ONLY ревизия PR #235 — PASS

## 1. Preflight
- Managed HEAD = `67782b516d5e4b8a2e56f7a3cadbcd8006aca0ea`, дерево чистое (`git status --porcelain` пуст).
- Коммит: `fix(payments): reconcile auto-renewal registry (#235)`, ровно 8 файлов, все внутри заявленного scope; посторонних файлов, миграций и правок схемы нет.

## 2. Код и зависимости
- `AutoRenewalsTabContent.tsx`: введён `kind: recurring | installment | installment_draft`; неоплаченные заготовки исключены из основных списков и вынесены в отдельный фильтр «Неоплаченные заготовки».
- `autoRenewalInstallments.ts` + тесты: реальность конечной рассрочки определяется только по succeeded-платежу / оплаченному циклу / оплаченной сумме / provider charge; сгенерированный неоплаченный график реальной рассрочкой не считается.
- `useContactInstallmentsData.ts`: та же граница (`paidCycles<=0 && paidTotal<=0 && factualPaid<=0` → скрыть) — контактная вкладка и реестр согласованы.
- `autoRenewalObservability.ts` + тест: правка минимальная, лимит попыток берётся из snapshot, а не хардкодом.
- Регрессия по scope: `vitest src/lib/autoRenewalInstallments.test.ts src/lib/autoRenewalObservability.test.ts` — 14/14 PASS.

## 3. Edge Function `admin-auto-renewal-observability`
- `supabase/config.toml`: блок с `verify_jwt = true`.
- В коде: Bearer обязателен → `auth.getUser()` → `has_role_v2` (admin/super_admin/manager) → иначе 401/403.
- Ответ содержит только агрегаты: `logs` (channel, subscription_id, days_before, status, reason, timestamps) и `attempts` (счётчики попыток). PII (ФИО, email, телефон, номера карт) не возвращается.
- Пагинация: `notification_outbox` и `payments_v2` читаются постранично по 1000 с чанками по 200 order_id — полнота выборки обеспечена; входной массив ограничен 2000 id, окно 1..90 дней.

## 4. Read-only DB read-back (без PII)
- `subscriptions_v2`: 183 активных auto_renew подписки; ни одна не помечена как finite (`as_finite_subscription`/`model=bepaid_finite_subscription` = 0) — реальные recurring-модели и конечные рассрочки разделены корректно.
- `orders_v2` с `payment_method=internal_installment`: всего 10 → 4 реально оплаченных, 6 неоплаченных заготовок. Именно это разделение и реализует патч.
- `provider_subscriptions`: 814 строк, 617 без `last_charge_at`, 233 без связи с `subscriptions_v2` — подтверждает необходимость диагностического фильтра заготовок; массовых операций патч не выполняет.
- `notification_outbox` по `subscription_charge_reminder` / `installment_charge_reminder`: 0 строк (ранее выполнялся только dry_run). Разрезы 7/3/1 дн. и каналы email/telegram будут наполняться после первого реального прогона; схема meta (`days_before`, `subscription_v2_id`, `effective_charge_at`) функцией читается корректно.

## 5. UI
- Тексты русские: «Неоплаченные заготовки», «Отменить неоплаченную заготовку?», «Не удалось отменить заготовку».
- Отмена доступна только для `installment_draft` с `provider_subscription_id`, через явный диалог подтверждения; удаления записей и массовых операций нет.

## Вывод: PASS

## EXECUTE-план (по разрешению, без нового кода)
1. Preflight: managed HEAD снова строго `67782b51...`, дерево чистое. STOP при mismatch.
2. Sync ровно на этот SHA (если требуется).
3. Deploy ровно одной Edge Function `admin-auto-renewal-observability`, `verify_jwt = true`. Других деплоев нет.
4. Safe smoke без customer artifacts:
   - POST без Authorization → 401;
   - POST с пустым `subscription_ids` под owner-сессией → `{logs: [], attempts: {}}`;
   - POST с 1-2 реальными subscription_id (только чтение) → агрегаты без PII.
5. Read-back логов функции: отсутствие 5xx и auth-регрессий.
6. Ровно один Publish frontend после всех PASS.
7. Запрещено: миграции, backfill, delete, cancel, массовые операции, отправка email/Telegram, создание платежей/подписок/сделок/доступов.
