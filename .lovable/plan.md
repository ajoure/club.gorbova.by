# План: READ-ONLY диагностика инцидента refund (access_action=keep_subscription, 250 BYN, 2026-08-11)

Мутаций нет: код, миграции, функции, данные и Publish не трогались. Реальный возврат не выполнялся.

## 1) Live-логи последнего неудачного вызова — ЧАСТИЧНО НЕДОСТУПНЫ

- `subscription-admin-actions`: за доступное окно логов возвращается только служебное `shutdown` (2026-08-11 15:13Z), записей самого вызова нет.
- Выборка `function_edge_logs` по URL `subscription-admin-actions` за окно ретенции — пусто; окно логов покрывает примерно последний час, момент инцидента в него не попал.
- Вывод: исходный exception/stack по этому конкретному вызову в текущей ретенции недоступен. Ниже — вывод об этапе падения по косвенным доказательствам (см. п.4).

## 2) Сверка deployed-версии с GitHub commit dfeb5cc6

Managed HEAD = `dfeb5cc60351ceba4d108560df458d297c286576`. Ключевые места в исходнике совпадают с ожидаемыми:

- whitelist: `new Set(['revoke','reduce','keep','keep_subscription'])`;
- безопасный дефолт: `const effectiveAccessAction = access_action || 'keep'`;
- provider-aware ветка Stripe/bePaid и запись через `record_refund_atomic` / `record_refund_atomic_multi` присутствуют.

Runtime-проба развёрнутой функции (безопасный несуществующий order_id, `access_action=keep_subscription`) вернула HTTP **404 `Order not found`**, а НЕ `400 invalid_access_action`. Значит deployed-бандл действительно содержит whitelist с `keep_subscription` и проходит валидацию — deployed соответствует ожидаемому исходнику.

## 3) Развёрнут ли backend PR #295 (merge 0958006f)

Да. Дефолт `keep` и whitelist из PR #295 присутствуют и в managed-источнике, и в развёрнутом бандле (подтверждено пробой выше). Старая функция с дефолтом `revoke` в production не используется.

## 4) Успел ли bePaid реально выполнить возврат — НЕТ (по имеющимся данным)

- `audit_logs` за 2026-08-11 по refund-действиям: всего 6 строк — три пары `refund_recorded` + `admin.subscription.refund` в 11:27, 11:28, 11:30 UTC, суммы 55 / 55 / 150 BYN, `access_action = revoke`. Записей с суммой 250 или с `keep_subscription` нет.
- Маркеров частичного провала нет: `refund_db_recording_failed`, `refund_already_refunded_*`, `refund_failed` за сегодня отсутствуют.
- `composable_refund_intents` за 2026-08-10..11 — пусто, то есть composable-ветка не создавала intent.
- Логика функции: любые ошибки bePaid возвращаются со статусом **200** (`success:false`), а non-2xx возможен только до обращения к провайдеру: 401 (JWT), 403 (не админ), 400 (нет `order_id` / `refund_reason` / невалидный access_action / заказ не `paid` / composable без provider payment), 404 (заказ не найден), 409 (дубликат composable-запроса).

**Вывод по этапу падения:** падение произошло на пред-провайдерной стадии — auth/validation/резолв заказа (наиболее вероятно 404 `Order not found` либо 400 `Only paid orders can be refunded` / composable-валидация), до вызова bePaid и до RPC. Списание/возврат в bePaid по этому запросу **не выполнялся**, дублей при повторе не будет. Идентификаторы платежей, PII и токены в отчёте не раскрываются.

## 5) Минимальный план исправления (к утверждению, пока не выполнен)

Проблема — не в бизнес-логике возврата, а в том, что UI показывает сырое «Edge Function returned a non-2xx status code» вместо человекочитаемой причины, из-за чего инцидент неотличим от реального сбоя провайдера.

1. Frontend (`RefundDialog.tsx` / общий invoke-хелпер): при ошибке `FunctionsHttpError` читать `error.context.text()`/JSON и показывать поле `error` из ответа функции (например «Заказ не найден», «Возврат возможен только для оплаченных заказов»), с фолбэком на текущий текст.
2. Backend (`subscription-admin-actions`, refund-ветка): перед каждым ранним non-2xx `return` писать компактную аудит-строку `admin.subscription.refund_rejected` с `order_id`, `stage` (`validation` / `order_not_found` / `order_not_paid` / `composable`), `access_action` — без сумм-PII и без провайдерских uid. Это даёт постоянный след даже после истечения ретенции логов.
3. Никаких изменений в whitelist, дефолте access action, вызове bePaid и RPC не требуется.

## Безопасная runtime-проверка без реального возврата

- Повторить пробу функции с заведомо несуществующим `order_id` и `access_action=keep_subscription` — ожидание `404 Order not found` (уже подтверждено).
- Проба с существующим, но не `paid` заказом — ожидание `400 Only paid orders can be refunded`.
- Проба без `refund_reason` — ожидание `400 refund_reason required`.
- В UI: открыть диалог возврата на любом заказе и убедиться, что текст ошибки читаемый; диалог закрывать без подтверждения возврата.
- Дополнительно: попросить администратора назвать `order_number`, по которому была попытка на 250 BYN — read-only проверка его `status`/`payments_v2` однозначно закроет вопрос об этапе падения.

## Явно вне scope

Другие задачи, шаблоны, биллинг, роли, чаты, данные пользователей, миграции, deploy и Publish.
