План: read-only ревизия финального backend-follow-up авто-продлений (PR #232)

## Preflight — PASS
- Managed HEAD = `a8ff1d9528f15e12d4968ff92e4518089f1787ec`, parent = `11c9d10c80e4b263d70524796cf18a45997cccab`. Совпадение точное.
- Рабочее дерево чистое (`git status --porcelain` пуст).
- Дифф ровно 3 файла (+172/−31):
  - `src/lib/chargeReminderInstallment.test.ts`
  - `supabase/functions/_shared/finite-installment-progress.ts`
  - `supabase/functions/_shared/run-charge-reminders.ts`
- Мутаций не выполнялось: без кода, БД, миграций, секретов, настроек, деплоя, Publish, рассылок.

## Проверка контракта
1. Провайдерская загрузка `provider_subscriptions` (active/trialing) сохранена — базовый запрос не изменён, ранний выход при пустом наборе на месте. PASS
2. Дополнительная загрузка `subscriptions_v2` со статусами `active/trial/past_due` выполняется только при `!args.onlyProviderSubscriptionId`; кандидаты строятся через `buildLocalFiniteCandidateRows`, который пропускает только finite-рассрочки (`isFiniteInstallmentModel`). PASS
3. Дедупликация: `providerManagedSubscriptionIds` из `subscription_v2_id` загруженных провайдерских строк; уже связанные подписки исключаются. PASS
4. Завершённые планы и планы без валидного графика: логика ниже по потоку остаётся на `buildVirtualInstallmentPayment` (возвращает `null` при `completed` и при отсутствии реального `next_charge_at`) — напоминание не создаётся. PASS
5. Политика напоминаний по-прежнему берётся из `sourceOfferIds`, собранных строго из meta конкретной подписки/заказа; угадывания тарифа нет — изменён только источник строк (`candidateRows`). PASS
6. `dry_run` не мутирует и ничего не отправляет: ветки claim/send не затронуты диффом. PASS
7. Нет изменений схемы/миграций/конфига/фронтенда; `run-charge-reminders.ts` импортируется только `subscription-renewal-reminders` — редеплой `bepaid-webhook` не требуется. PASS

Замечание (не блокирующее): в изменённых legacy-хелперах сохраняется существующий долг `no-explicit-any` — в этой ревизии код не правится.

## Итог: PASS

## Единственный последующий шаг выполнения (EXECUTE, отдельным разрешением)
Развернуть ровно одну Edge Function `subscription-renewal-reminders` из точного SHA `a8ff1d9528f15e12d4968ff92e4518089f1787ec` с сохранением текущей авторизации; затем выполнить её аутентифицированный `dry_run` и прочитать счётчики: провайдерские кандидаты, добавленные локальные finite-кандидаты, исключённые дубликаты, пропущенные completed/без графика, eligible 7/3/1; подтвердить неизменность `notification_outbox`, `installment_payments`, `subscriptions_v2`, `payments`, `accesses`. Frontend Publish для этого backend-follow-up не требуется.
