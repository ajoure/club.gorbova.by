План: минимальное переназначение в Служебной поддержке (PLAN-ONLY, production только чтение)

## 1. Состояние среды (прочитано)

- Source в Cloud: HEAD `adc4a5c3` (merge PR655), рабочее дерево чистое; совпадает с известным merged SHA. PR657 не трогался.
- Managed journal: последние версии `20261007081532`, `20261006121448`, `20261005123053`. Версии `20261022113000_support_channel_boundary` в журнале нет, но функции `support_bot_assign_v1`, `support_bot_assignment_lock_v1`, `support_bot_begin_send_v1`, `assign_contact_center_dialog_v2` в базе есть. `support_bot_reassign_v1` нет. Перед execute надо сверить, как установлен boundary-пакет (тела функций против файла), — это стоп-условие, а не повод исправлять журнал.
- «Build unsuccessful / Preview out of date / unpublished changes» в UI: в этой задаче не исправляется и не публикуется. Чужие незавершённые изменения в рабочем дереве Cloud не найдены (дерево чистое), но статус UI-очереди Lovable до execute надо перепроверить.

## 2. Можно ли обойтись существующими RPC

- `assign_contact_center_dialog_v2` — нет. Не фильтрует бот, transport, Business-поля, нет проверки support_enabled, нет CAS по последнему входящему, берёт самое старое непрочитанное входящее по всем каналам пользователя (может зацепить Business). Использовать для support-режима нельзя.
- `support_bot_assign_v1` — подходит как основа, но не для смены владельца: при существующем активном назначении другого сотрудника возвращает `support_already_assigned`. Менять его семантику опасно (UI и тесты ждут этой ошибки как защиты).
- Вывод: нужен один новый узкий RPC `support_bot_reassign_v1` рядом с `support_bot_assign_v1`, в той же блокировочной модели. Новой системы, бота или агента нет.

## 3. Контракт `support_bot_reassign_v1`

Аргументы: `p_user_id`, `p_bot_id`, `p_observed_incoming_id`, `p_observed_assignment_id`, `p_observed_assignee_user_id`, `p_new_assignee_user_id`, `p_request_id uuid`, `p_note`.

Порядок внутри одной транзакции:
1. `auth.uid()` + `has_admin_section_access(...,'communication','manage')`; новый владелец имеет `view`; `support_bot_allowed_v1(p_bot_id)`; новый владелец ≠ текущий.
2. Блокировки в том же порядке, что у `support_bot_begin_send_v1`: `support-binding:<user>`, затем `support-bot:<user>:<bot>` (без инверсии с триггерами, которые используют try-lock).
3. Отказ при активном send-claim (`support_send_in_progress_retry`).
4. CAS последнего входящего: только `transport='bot'`, оба Business NULL, этот бот → иначе `support_new_incoming_refresh_required`.
5. CAS назначения: активное назначение в этом scope должно иметь ровно `p_observed_assignment_id` и `p_observed_assignee_user_id`, иначе `support_assignment_changed_refresh_required`. Обработка ровно одной строки, без массовых обновлений.
6. Идемпотентность: если по `p_request_id` уже есть завершённое переназначение с теми же параметрами — вернуть `{assignment_id, created:false}` без изменений; при других параметрах — `support_request_conflict`.
7. Действие: старое назначение закрыть (`resolved_at`, причина reassigned), новое вставить с тем же `source_message_id` = последнее входящее; запись в `audit_logs` (actor, old/new assignee, ids — без текстов).
8. Возврат `{assignment_id, created:true}`; уведомление отправляет UI только при `created=true` через существующий `contact-center-assignment-notify`, как сейчас.

Права: REVOKE от PUBLIC/anon, EXECUTE только authenticated (проверка manage внутри).

Хранение request_id: одна колонка `reassign_request_id uuid UNIQUE NULL` в `contact_center_message_assignments` (аддитивно) — без новой таблицы.

## 4. UI (`SupportWorkspace.tsx`, самый узкий diff)

- Разделить `blocked` на `notReady` (scope/история/права/ошибки) и `foreignAssigned`.
- Отправка, реакции, unread, resolve/reopen по-прежнему блокируются при `notReady || foreignAssigned` — guard не ослабляется.
- Если `foreignAssigned && !notReady`: показать отдельную кнопку «Переназначить», которая открывает подтверждение с текущим и выбранным новым владельцем. По подтверждению — `support_bot_reassign_v1` с наблюдаемыми id и новым `request_id` (генерируется при открытии диалога, повторно используется при повторе).
- После успеха — обновить диалог; форма ответа активна только если новый владелец = текущий пользователь.
- При неясном результате — тот же `request_id` при повторе, без повторного уведомления.

## 5. Тесты (Codex, локально, без production)

- PGlite: права (без manage → forbidden), бот вне allowlist, Business-сообщения игнорируются, CAS assignment/incoming, идемпотентный повтор, конфликт request_id, одна строка закрыта/одна создана.
- Реальный PG (по образцу `scripts/tests/support-channel-concurrency.test.mjs`): новое входящее во время переназначения; параллельное assign/reassign; смена привязки профиля; активный send-claim; прямые UPDATE/DELETE назначения против reassign — без deadlock.
- React: кнопка видна только при чужом назначении и готовности; отправка остаётся заблокирована до успеха; уведомление только при `created=true`.

## 6. Managed migrations

Одна новая аддитивная миграция: колонка + уникальный индекс, функция `support_bot_reassign_v1`, grants. Без изменения существующих функций и без backfill. Применение — только отдельной командой Lovable execute после merge PR и сверки SHA.

## 7. Стоп-условия

- Тела установленных support-функций не совпадают с файлом boundary-миграции или журнал не объясним.
- В Cloud есть чужая незавершённая работа или неопубликованные изменения другой ветки.
- Любой тест конкурентности падает или даёт deadlock/timeout.
- Rowcount переназначения ≠ 1 закрытой + 1 новой строки.
- Обнаружена необходимость трогать Business/личные каналы, оплаты, пользователей или массовые назначения.

Ничего не исполнялось: код, данные, sync, deploy и Publish не затронуты; переписки, файлы и платежи не читались.
