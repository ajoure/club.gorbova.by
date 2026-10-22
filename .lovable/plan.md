План: аудит автотехподдержки контакт-центра (PLAN-ONLY, без исполнения)

Scope: contact-center-auto-support. Точный SHA рабочей копии: `f3928ce8c0bf9de3f11e01a14301686000303190`, дерево чистое. Ветку `codex/contact-center-auto-support` создаёт Codex в GitHub — здесь ничего не менялось. Данные ниже — только агрегаты и метаданные.

## 1. Источники, идентичность клиента, защита от двойного ответа

- `support_tickets`: profile_id, user_id, telegram_user_id, telegram_bridge_enabled, status, has_unread_admin/user, first_response_at, merged_into_ticket_id.
- `ticket_messages`: ticket_id, author_type, is_internal, attachments, is_read.
- `telegram_messages`: зеркало бота и Business (`transport` = bot/business). Дедупликация webhook по update_id выполняется индексом `telegram_messages_bot_update_dedupe_idx`, это закреплено тестом.
- `ai_handoffs`: telegram_user_id, user_id, status, assigned_to, last_message_id. `ai_admin_notifications`: handoff_id, status.
- `contact_center_message_assignments` (source, source_message_id, assignee) — это действующая функция «поручить ответ».
- Идентичность: Telegram ID связывается с профилем по `telegram_user_id`; для неизвестного ID создаётся гостевой контакт.
- Защита от двойного ответа:
  - `telegram-webhook` вызывает `telegram-ai-support` только при `bot_enabled` и пропускает вызов, если открыт handoff (`hold_ai_when_handoff_open`).
  - `telegram-admin-chat` отменяет отложенные ответы продаж перед ручной отправкой.
- Gap: нет единого курсора «последнее обработанное сообщение» для внешнего агента. Нет блокировки, которая сработала бы при одновременном ответе ИИ, cb21-sales и оператора в Business-канале. Это не проверено end-to-end.

## 2. Каналы, настройки, задания, агрегаты

- Каналы: бот @gorbovabybot (transport bot); Telegram Business — одно подключение, активно и может отвечать; веб-тикеты; email (отдельный ящик).
- `ai_bot_settings`, одна строка:
  - bot_enabled = **false** — ИИ-поддержка сейчас выключена;
  - handoff_enabled = true, admin_notify_enabled = true, mode = inbox, hold_ai_when_handoff_open = true;
  - admin_notify_targets — пустой массив, то есть **получатель не настроен**.
- Задания, связанные с поддержкой: `cb21-sales-runtime` (каждые 10 с), `telegram-access-queue-processor`, `telegram-media-worker-cron`, `crm-tasks-notify-tick`. Задания, которое разбирало бы нерешённые обращения, **нет**.
- Агрегаты: незакрытых тикетов — 21 (все open); открытых handoff — 2; ai_admin_notifications — 0 записей.

## 3. Штатные API для проверки и восстановления

- Проверка оплаты и доступа: только чтение `orders_v2` / `payments_v2` / `entitlements` / `subscriptions_v2` под ролью admin (RLS) либо `ai-access-status`. Готового read-only API «проверь клиента X» нет.
- Восстановление оплаченного доступа: `grant-access-for-order` (идемпотентный, replay-merge, dedupe extended_by_orders). Авторизация: service_role или admin; ветка adminManualAccessEdit — только admin.
  - Риск: ветка standard может **продлить срок**, если заказ ещё не учтён. Нужен guard «только при отсутствии entitlement по оплаченному заказу».
- Telegram-доступ: `admin-regrant-wrongly-revoked` (admin/super_admin через has_role_v2, пропускает in_chat) и `telegram-grant-access` по каноническому пути. В очередь писать только с `meta.source` ∈ reinvite/manual_bulk/repair/admin_backfill.
- Повторная отправка ссылки для входа или ссылки на курс: **отдельного штатного API нет**. Есть только `_shared/invite-link-helper.ts`, `telegram-link-manage` и одноразовые функции. Это gap.
- Отправлять сообщения клиенту при проверке нельзя (стоп-правило).

## 4. Передача владельцу (handoff)

- Путь: `telegram-ai-support` создаёт `ai_handoffs`, затем `ai_admin_notifications` (mode inbox), затем назначение через `assign_contact_center_message_v1` / `assign_contact_center_dialog_v2`, затем уведомление `contact-center-assignment-notify`.
- Ключ получателя: `ai_bot_settings.admin_notify_targets` — **false (пусто)**. Назначен ли Сергей Федорчук исполнителем по умолчанию, не проверено: для этого нужно читать профиль/роль, а это ПДн. Предлагаю сверить только boolean.

## 5. Доступ для Codex

- Сейчас нет MCP или узкого admin API для внешнего агента. Есть только `.lovable/mcp/manifest.json` (не проверялся), а функции требуют JWT админа.
- Минимум изменений:
  - read-only RPC `support_queue_snapshot_v1` (агрегаты, id, курсор, без текстов);
  - RPC `support_case_verify_v1(ticket_id)` → флаги paid / entitled / tg_in_chat / missing_access, без сумм и карт;
  - действие `support_restore_access_v1(order_id, dry_run)` — обёртка над grant-access-for-order с запретом продления;
  - `support_escalate_v1(ticket_id, reason)` → штатное назначение.
- Всё это — под отдельной сервисной ролью с аудитом в `audit_logs` и rate limit на стороне вызывающей стороны.

## 6. Минимальный план (для отдельного execute)

1. Миграция: таблица курсора/лока `support_agent_cursor` (source, last_seen_id, lease_until) и четыре RPC выше: SECURITY DEFINER, REVOKE от anon/authenticated, GRANT только сервисной роли.
2. Функция `support-agent-gateway`: аутентификация отдельным ключом, только перечисленные действия; по умолчанию dry_run=true.
3. UI: в настройках ИИ задать получателя и показать журнал действий агента.
4. Расписание проверок каждые 30 минут — на стороне Codex. Cron в БД не нужен.
5. Dry-run → ожидаемые счётчики → действие по одному кейсу → read-back (entitlement, audit, отсутствие новых заказов и платежей).
- Риски:
  - продление срока при повторной выдаче;
  - двойной ответ в Business-канале;
  - запуск cb21-sales поверх поддержки;
  - утечка ПДн в ответах RPC;
  - включение bot_enabled без настроенного получателя.

## Отдельно: gaps

- Фото и скриншоты: медиа сохраняются через media-worker, но ИИ их не анализирует и не запрашивает скриншот целенаправленно.
- Веб-тикеты: `telegram-ai-support` их не обрабатывает. В тикетах нет handoff/AI-слоя, есть только уведомление `ticket-message-notify`.
- Business, окно 24 ч: ответ через Business возможен только при can_reply. Ограничение 24 ч на стороне Telegram в коде явно не обрабатывается — не проверено.

## Не проверено
Фактические версии развёрнутых функций в сравнении с исходником; содержимое MCP manifest; кто исполнитель по умолчанию; поведение cb21-sales в отношении поддержки.
