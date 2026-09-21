# План: force-resend Telegram по entitlement + инцидент Калининой (20.09.2026)

Только чтение выполнено. Источник кода: origin/main `f6fe5c42`. Ни одной записи в production не сделано.

## A. Инцидент Татьяны Калининой — CONFIRMED

Идентификаторы маскированы: profile `14a7db55…4df3d5`, auth user `7e89d011…5fd4a133`, оплата `96744412…fae5ae5a1b19`, provider uid `fc4615d9…5874ef877`, заказ-ребилл `7c69a5fa…a776e54e7bf2`, bePaid подписка `sbs_07e4…9c64`, подписка v2 A `eedd1322…62b36b08eca0`, подписка v2 B `6919fa8c…4ea6beb52575`, клуб `fa547c41…27332a0506e` (Gorbova Club).

Хронология (UTC / Минск = UTC+3):

| UTC | Минск | Событие |
|---|---|---|
| 20.09 20:30:15 | 20.09 23:30:15 | bePaid списал 250.00 BYN (BUSINESS, цикл 30 дней), платёж `succeeded`, webhook отработал в реальном времени |
| 20.09 20:30:15.99 | 23:30:15 | создан ребилл-заказ, `status=paid`, `paid_amount=250.00` |
| 20.09 20:30:17 | 23:30:17 | `grant-access-for-order` → **grant_skipped: provider_linkage_conflict**, `reason=subv2_terminal_status`, заказ помечен `manual_review` |
| 21.09 12:00:00 | 21.09 15:00 | истекла подписка B (по ней и слались напоминания 18–20.09) |
| 21.09 21:00:12 | 22.09 00:00 | `AUTO_REVOKE`: chat и channel отозваны, все `telegram_access_grants` → `revoked` |
| 21.09 21:06:25 | 22.09 00:06 | ночная сверка `bepaid-get-subscription-details` восстановила подписку A: `superseded → active`, доступ до 20.10 20:59:59 UTC |

Root cause (confirmed): в `provider_subscriptions` строка bePaid-подписки ссылается на `subscription_v2_id = eedd1322…`, которая на момент списания была `superseded` (в meta есть `stale_link_repair` от 11.08 на `6919fa8c…`, но сама колонка не переписана). Резолвер `provider_linked_subscription_resolver.ts` в такой ситуации по проекту STOP-ит: не создаёт параллельную подписку, пишет audit и возвращает `skipped`. Дальше цепочка не пошла: подписка не продлена → entitlement не создан → `telegram-grant-access` не вызван → ссылок на канал и чат клиент не получил. Следом отработало штатное авто-отключение по истёкшей второй подписке.

Текущее состояние: деньги получены, подписка A активна до 20.10.2026, но Telegram-доступ отозван (`state_chat=revoked`, `state_channel=revoked`), `telegram_access.active_until = 21.09 21:00 UTC`. Ночная сверка доступ в Telegram не возвращает.

Webhook и fallback-cron (PR #488): работают. Оба сентябрьских события материализованы за секунды; `bepaid-queue-cron` идёт по расписанию. Его «1 failed» в каждом прогоне — чужие элементы очереди (`failed_attempt.subscription`, insufficient funds → `recovery_provider_payment_mismatch`), к Калининой отношения не имеют; это отдельный follow-up.

Консультация 1500 BYN: **не связана** (confirmed). Единственный заказ на 1500 BYN с 01.09 — другой клиент, Stripe, 17.09, публичная ссылка. За последние 7 дней нет ни одной записи `composable_order_materialization_failed`. Оформлять как отдельный incident, если он всё-таки наблюдался в UI.

## B. Минимальный admin force-resend по активному entitlement

Сейчас карточки `activeEntitlementSources` в карточке контакта отрисованы без действий (только даты и бейджи), тогда как у подписок есть «Управление» → `EditSubscriptionDialog` → `telegram-grant-access`. Задача — переиспользовать существующий канонический путь, не создавая заказ, сделку, покупку или продление.

Правила:
- кнопка только у источника со `status=active`, начавшегося и не истёкшего;
- продукт источника должен иметь `telegram_club_id` (иначе кнопка не показывается);
- `valid_until = min(expires_at источника, канонический конец доступа)`, срок не удлиняется;
- доступ только при праве `entitlements.manage` (плюс superadmin), кнопка скрыта иначе;
- подтверждение в диалоге + блокировка повторного клика (cooldown), чтобы не отправить дважды;
- вызов идёт с `source='admin_entitlement_source_resend'`, `source_id = entitlement_sources.id`, `access_rule_id` из meta источника — это даёт корректную привязку и повторно идемпотентно;
- защита `duplicate_access_granted_dm` остаётся включённой по умолчанию; принудительная повторная отправка — отдельный явный флаг, который пишется в audit (`admin.telegram.force_resend`) вместе с id администратора и причиной.

Файлы патча (GitHub):
- `src/components/admin/ContactDetailSheet.tsx` — кнопка и диалог подтверждения на карточке источника;
- `src/components/admin/EditSubscriptionDialog.tsx` или новый малый компонент `EntitlementTelegramResendDialog.tsx` — переиспользование логики вызова;
- `src/hooks/useTelegramIntegration.tsx` — типизированная мутация resend по источнику;
- `supabase/functions/telegram-grant-access/index.ts` — приём `force_resend` + audit (только если решаем разрешать обход дубликата);
- тесты: `src/test/` — RBAC, идемпотентность, отсутствие удлинения срока, UI-состояния.

Миграции: не нужны. Deploy функции: только `telegram-grant-access`, и только если добавляем `force_resend`; иначе деплой не требуется вовсе.

## C. Разрешённая восстановительная отправка Калининой (одна)

Preflight (всё read-only, стоп при любом несовпадении):
1. подписка A активна, конец доступа 20.10.2026 20:59:59 UTC;
2. оплата 250.00 BYN `succeeded`, ребилл-заказ `paid`;
3. `telegram_access` по клубу существует, состояние `revoked`;
4. за последние 24 часа нет `access_granted_dm` по этому пользователю и клубу;
5. Telegram-привязка пользователя актуальна.

Ожидаемые дельты ровно одной отправки:
- `telegram_access_grants`: +1 строка (`status=active`, `end_at = 2026-10-20 20:59:59+00`), прежние остаются `revoked`;
- `telegram_access`: 1 UPDATE — `active_until` → 20.10.2026, `state_chat`/`state_channel` → `active`/`pending`;
- `telegram_logs`: +1…3 строки (unban/invite/DM);
- `telegram_messages`: +1 DM с двумя ссылками;
- `orders_v2` ребилл-заказ: снятие `manual_review` после успеха;
- `audit_logs`: +1…2 записи;
- 0 новых заказов, 0 платежей, 0 подписок, 0 изменений тарифов и цен.

Отдельно (по согласованию, вне этой отправки): точечный CAS-ремонт `provider_subscriptions.subscription_v2_id` на активную подписку A, чтобы следующее списание 20.10 не повторило конфликт. Это единственная строка, с read-back и audit.

## D. Проверки

- RBAC: без `entitlements.manage` кнопки нет и вызов отклоняется.
- Идемпотентность: повторный клик без force даёт `skipped: duplicate_access_granted_dm`, второго сообщения нет.
- Срок: resend не удлиняет `active_until` дальше канонического конца.
- UI: desktop и 390×844 — карточка источника с кнопкой, состояние загрузки, ошибка и успех.
- Read-back после отправки: строки выше в точных значениях, нулевые изменения денежных таблиц.

Ничего из перечисленного не выполнено — жду решения.
