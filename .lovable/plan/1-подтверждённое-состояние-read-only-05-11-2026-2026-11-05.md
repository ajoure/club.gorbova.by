План: SUPPORT_FRONTEND_697_698 — релиз PR697 + PR698 (frontend-only)

## 1. Подтверждённое состояние (read-only, 05.11.2026)
- Lovable HEAD `8aa6a63b7d0d2d5ddb783c43da0e4ba341cdc536`, tree `1abb614678775b6a922a61b58c949365c11d9dd7`, рабочее дерево clean; совпадает с GitHub `main` (тот же SHA/tree) = опубликованный baseline.
- Очередь: чужих pending/unpublished изменений между baseline и HEAD нет (HEAD = published source). Неизвестного владельца не обнаружено.
- PR697: open, mergeable_state=clean, head `a3703880…`, base `93615335…`, 9 файлов +173/−41.
- PR698: open, clean, head `c2acd564…`, base `93615335…`, 3 файла +84/−1.
- Base обоих PR отстаёт от main на 19 коммитов (25 файлов), пересечений файлов с PR697/698 нет; PR697 и PR698 не пересекаются друг с другом.
- PR703 (только инструкции/TOML) — вне runtime, в релиз не входит, но после merge окажется в main; на bundle влиять не должен.

## 2. Состав релиза (полный и единственный)
- PR697: исходный Telegram-канал вопроса и метки каналов (ChannelPicker, SourceBadge, useUnifiedInbox, contactCenterTelegramQueue, telegramBusinessIdentity + тесты).
- PR698: компонент TicketMessageText — кликабельные только http/https ссылки, без логина/пароля в URL, `target=_blank rel="noopener noreferrer"`, перенос `break-all`; текст рендерится как React-текст (без HTML-инъекции).
- Плюс PR703 как нейтральный не-runtime коммит. Ничего иного.

## 3. Семантическая совместимость
- PR697 использует только чтения: `select` по существующей таблице сообщений и существующий RPC `list_operational_telegram_bots` через существующий `operational-client` (оба есть в main). Записей/insert/update нет.
- PR698 — чистый UI без запросов.
- Ожидаемая backend delta: ноль (нет миграций, edge functions, secrets, RLS, Storage).

## 4. Gates после merge (Codex), до Publish
1. Codex сообщает exact merged SHA; Lovable sync, сверка HEAD/tree = GitHub main, clean.
2. `git diff 8aa6a63b..<merged>` содержит только 12 файлов PR697/698 + файлы PR703; иначе STOP.
3. 0 файлов в `supabase/`, `drizzle/`, edge functions; иначе STOP.
4. Exact merged CI PASS; build-errors.log — build OK; vitest для 4 тестов PR697/698.
5. Preview, desktop 1280 и mobile 375: Контакт-центр — у существующего Telegram-вопроса виден исходный канал/корректная метка; существующий web-ticket с длинной ссылкой — ссылка кликабельна (проверяется атрибутами, не переходом), не выходит за край. Без отправок, без переходов по ссылкам, без payment-страниц; PII/URL в скриншотах замазать или выбирать служебные диалоги.
6. Затем отдельная команда на ровно один Publish; после — оба origin отдают новый entry asset, повтор сценария п.5 на опубликованном URL (desktop+mobile).

## 5. Границы проверки до merge
- До merge код PR697/698 в Lovable отсутствует; preview показывает baseline. Не заявлять функциональность активной.

## 6. Rollback
- Frontend-only: revert-PR в GitHub (Codex) → exact SHA → один Publish; либо возврат к версии deployment `5083199e…` через историю. Данные не затрагиваются.

## 7. DoD
- Merged SHA/tree сверены; diff только заявленные файлы; backend delta 0; CI/build/tests PASS; desktop+mobile скриншоты опубликованного результата; один Publish; entry asset на обоих хостах; обращения не изменены.

## 8. STOP-условия
- Посторонний файл в diff, любая backend-дельта, расхождение SHA, чужая незавершённая задача, critical finding в UI-проверке.

Критических блокеров сейчас нет — план готов к exact-SHA execute после merge Codex.
