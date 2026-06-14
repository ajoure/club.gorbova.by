да, согласен, с учетом правок:

1. **Этап 1 остаётся строго Diagnose-only**: без миграций, индексов, изменения RLS/RPC, правок кода, деплоя, очистки данных, изменения realtime-подписок и конфигурации Storage. Соблюсти порядок DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY.
2. Сначала провести **инвентаризацию фактической архитектуры**, не предполагая заранее названия таблиц и источники истины:
  - реальные таблицы, views, RPC, edge-функции;
  - query keys React Query;
  - realtime-каналы и места их создания/удаления;
  - Storage buckets;
  - связи Telegram, support tickets и UnifiedCommunicationHistory;
  - legacy и canonical контуры.
3. Направления A–F считать **гипотезами**, а не заранее утверждёнными решениями. Этап Diagnose должен доказать, действительно ли нужны pagination, новые индексы, aggregate view, visualViewport, chunking и другие перечисленные изменения.
4. Для каждого проблемного пользовательского сценария зафиксировать воспроизводимый baseline:
  - открытие контакт-центра;
  - загрузка списка диалогов;
  - открытие переписки;
  - подгрузка старых сообщений;
  - открытие и отправка файла;
  - отправка ответа;
  - переключение вкладки «Новые».
5. Замеры разделить на:
  - SQL/backend time;
  - network latency;
  - размер payload;
  - frontend render time;
  - число запросов;
  - число realtime-событий и вызванных ими refetch.
6. Производительность измерять для cold/warm cache и фиксировать хотя бы P50/P95. Не выполнять опасные нагрузочные тесты и тяжёлый EXPLAIN ANALYZE в production без лимитов и STOP-условий.
7. По unread/read-state построить полную state-machine:
  - источник истины непрочитанного;
  - входящее/исходящее сообщение;
  - контакт/тикет/диалог;
  - открытие диалога;
  - успешная отправка ответа;
  - ошибка отправки;
  - параллельное входящее сообщение;
  - realtime UPDATE после локального optimistic update.
8. Отдельно доказать, должно ли успешное исходящее сообщение автоматически закрывать все предыдущие входящие. Не сбрасывать unread при неуспешной отправке.
9. Проверить не только наличие индексов, но и соответствие фактическим WHERE, JOIN, ORDER BY, включая:
  - направление сообщения;
  - статус прочтения;
  - contact_id / ticket_id;
  - created_at;
  - partial indexes;
  - RLS overhead;
  - планы запросов RPC и views.
10. Для realtime составить таблицу:
  - компонент;
  - имя канала;
  - таблица;
  - event;
  - filter;
  - вызываемый refetch;
  - количество подписок при повторном открытии страницы;
  - корректность cleanup/unsubscribe.
11. Отдельный proof: сколько SQL/API-запросов вызывает один Telegram INSERT и один UPDATE.
12. Для файлов дополнительно проверить:
  - распределение количества и размеров вложений;
  - генерируются ли signed URL по одному на файл и создаёт ли это N+1;
  - срок жизни URL;
  - повторную генерацию URL при каждом render;
  - thumbnails/preview;
  - lazy loading;
  - хранение file_id, URL и metadata;
  - отсутствие загрузки всех файлов диалога до открытия вложения.
13. Мобильный Diagnose провести минимум для:
  - iOS Safari;
  - установленного PWA, если используется;
  - portrait/landscape;
  - открытой клавиатуры;
  - QuickType bar;
  - textarea в одну и несколько строк;
  - отправки файла;
  - возвращения из background.
14. Зафиксировать размеры visualViewport, layout viewport, safe-area и положение composer до/после фокуса.
15. Проверить жизненный цикл компонентов: повторное открытие контактов не должно накапливать listeners, observers, timers, realtime channels и кешированные тяжёлые объекты. Добавить проверку memory growth после 20–30 последовательных открытий диалогов.
16. В discovery-отчёте разделять:
  - **FACT** — доказано кодом, SQL или runtime;
  - **HYPOTHESIS** — требует дополнительной проверки;
  - **ROOT CAUSE CONFIRMED** — воспроизведено и подтверждено;
  - **DEFERRED** — не блокирует основной fix.
17. Формат каждого finding F1…Fn расширить:
  - симптом;
  - затронутый пользовательский сценарий;
  - доказательство;
  - root cause;
  - confidence;
  - severity;
  - scope;
  - риск исправления;
  - зависимости;
  - рекомендуемый fix;
  - expected proof;
  - blocker / non-blocker.
18. Discovery-файл не должен содержать полные тексты сообщений, токены, персональные данные, приватные signed URL и содержимое вложений. Использовать UUID и обезличенные примеры.
19. Целевые показатели этапа Verify (<1.5s, Lighthouse ≥80, 0 повторных refetch) пока считать **предварительными**. После Diagnose сопоставить их с baseline и утвердить окончательные измеримые DoD.
20. После завершения Diagnose предоставить:
  - единый файл .lovable/discovery/contact_center_audit_<date>.md;
  - краткую executive summary;
  - consolidated список всех findings;
  - перечень критических блокеров;
  - список безопасных quick wins;
  - deferred/backlog;
  - карту затрагиваемых файлов, таблиц, RPC и edge-функций.
21. До отдельного согласования Этапа 2 никаких исправлений не применять. План и отчёт о выполненной работе должны быть отдельными сообщениями и полностью на русском языке.

&nbsp;

План: PATCH-CONTACT-CENTER-AUDIT-AND-FIX-V1

## Цель

Полный аудит контакт-центра (Telegram + техподдержка + UnifiedCommunicationHistory) с фиксацией и устранением деградации скорости, багов мобильной верстки и неверного статуса «непрочитано» после ответа.

## Известные симптомы (из обращения и скринов)

1. Долго грузятся переписка и файлы в чате.
2. Контакт-центр постепенно деградирует, всё медленнее реагирует.
3. После ответа оператором карточка остаётся в «Новые» / счётчик не сбрасывается (скрин IMG_4569: «Наталия Колесник — 1 минута», висит как новое, хотя ответ ушёл).
4. На мобильной версии (скрин IMG_4570) iOS подсказочный бар (стрелки ↑↓ и галочка) и клавиатура накрывают поле ввода — текст не виден при наборе.

## Этап 1. Diagnose (read-only, без правок)

Подцели — собрать факты, без догадок:

1. **Замер скорости:**
  - Прогнать `supabase--slow_queries` на `telegram_messages`, `support_tickets`, `support_messages`, вьюхах истории, RPC `get_unread_*`.
  - Прочитать `InboxTabContent.tsx` (1089 строк), `ContactTelegramChat.tsx` (2152 строки), `UnifiedCommunicationHistory.tsx`, `useUnreadMessagesCount`, `useIncomingMessageAlert` — найти: N+1 запросы, отсутствие пагинации, `select('*')` на больших таблицах, лишние realtime-подписки, дубли react-query ключей, неинвалидируемые кеши.
  - Проверить размер пэйлоадов `telegram_messages` (raw_update jsonb может быть гигантским) и хранение файлов (inline base64 vs storage).
2. **Read-state регрессия:**
  - Найти все места, где `is_read=true` проставляется (server RPC, webhook, фронт). Проверить, вызывается ли mark-as-read при отправке исходящего ответа, а не только при открытии диалога.
  - Проверить условие фильтра «Новые» в `InboxTabContent` — может считаться по `unread_count` диалога без учёта последнего исходящего.
  - Проверить, есть ли индексы `(direction, is_read)`, `(contact_id, created_at)`.
3. **Мобильный UX (IMG_4570):**
  - Найти composer (поле ввода) в `ContactTelegramChat.tsx`. Проверить: `position: sticky/fixed bottom`, `env(safe-area-inset-bottom)`, `interactiveWidget=resizes-content` в `<meta name="viewport">` (index.html), обработку `visualViewport` для iOS Safari (бар iOS QuickType не учитывается без JS-фикса).
  - Проверить scroll-to-bottom после фокуса textarea на мобиле.
4. **Realtime-шум:**
  - В `useIncomingMessageAlert` и `useUnreadMessagesCount` подписки на ВСЮ таблицу `telegram_messages` (`event:'*'`) — каждый INSERT/UPDATE триггерит рефетч count по всему проекту. На большой истории это и есть «постепенная деградация».
5. **Загрузка файлов:**
  - Найти где аплоадятся файлы в Telegram чат — проверить, идут ли они через storage signed URL или base64 в edge, есть ли progress, лимиты, chunking.

DoD этапа 1: единый отчёт `.lovable/discovery/contact_center_audit_<date>.md` с findings F1..Fn, для каждого: симптом, доказательство (sql/файл:строка/network), severity, предлагаемый fix.

## Этап 2. Plan (после Diagnose, отдельным сообщением)

По собранным findings составлю отдельный план PATCH-CONTACT-CENTER-FIX-V1 с конкретными правками. Список ожидаемых направлений:

A. **Производительность списка диалогов**

- Серверная пагинация (limit 50 + cursor), вместо загрузки всей истории.
- Вьюха-агрегат для списка («последнее сообщение + unread_count») вместо подсчёта на клиенте.
- Индексы: `idx_telegram_messages_contact_created`, `idx_telegram_messages_unread_incoming`.
- Уменьшить `raw_update` в SELECT (выбирать только нужные поля).

B. **Realtime-каналы**

- Сузить фильтры подписок (только incoming + только активный диалог).
- Дебаунс `refetch()` в `useUnreadMessagesCount` (сейчас на каждый event).
- Один общий канал на страницу вместо нескольких.

C. **Mark-as-read на ответ**

- При успешной отправке исходящего сообщения помечать все incoming диалога `is_read=true` через RPC.
- Инвалидировать `unread-messages-count` и список «Новые».

D. **Мобильный composer**

- Использовать `visualViewport` API для подстройки `padding-bottom` под клавиатуру + iOS QuickType bar.
- `<meta name="viewport" content="..., interactive-widget=resizes-content">`.
- Скрытие composer'а под безопасную зону `env(safe-area-inset-bottom)`.
- Auto-scroll к низу при фокусе textarea.

E. **Файлы**

- Аплоад через signed URL в storage, edge только проксирует `sendDocument` с `file_id`/URL.
- Прогресс-бар, лимит размера, чанковка >10MB.

F. **Чистка**

- Снять `event:'*'` подписки, заменить на `INSERT` + `UPDATE` точечно.
- Кеш react-query: `staleTime` 30s для списка, `gcTime` 5m.

## Этап 3. Dry run + Execute (после approve этапа 2)

Каждый fix отдельным мини-патчем с proof.

## Этап 4. Verify

- Lighthouse mobile на /admin/communication ≥ 80.
- Время первого рендера списка из 500 диалогов < 1.5s.
- Mark-as-read: после ответа в течение 2s карточка уходит из «Новые».
- Мобильный composer: при открытой клавиатуре всё поле ввода видно (скрин до/после).
- 0 повторных realtime-рефетчей при отправке одного сообщения (Network proof).

## Что НЕ трогаем

- Бизнес-логика выдачи доступа, grant-access, CRM, RLS, схемы заказов/подписок.
- Шаблоны рассылок и broadcast-движок (отдельная зона).
- bePaid/Stripe webhooks.

## Подтверждение

Прежде чем переходить к Этапу 2 (конкретные правки), дай OK на Этап 1 — Diagnose-only прогон с отчётом findings. После отчёта согласуем приоритеты и объём фиксов.