# PATCH P1.0 — Support Ticket System: Telegram-level UX + Bridge (FINAL PLAN)

## Жёсткие правила исполнения для Lovable.dev (обязательно в начале)
1) Ничего не ломать и не трогать лишнее. Только по плану. Add-only, минимальный diff.
2) Любые массовые изменения: dry-run → execute (где применимо).
3) STOP-guards обязательны (лимиты, проверки связей, idempotency).
4) No-PII в логах (не логировать тексты сообщений, email, телефоны).
5) RBAC/RLS строго: user видит только своё, admin только по роли.
6) DoD только по фактам: UI-скрин/видео + SQL/логи + realtime-пруфы, без “теории”.

---

## Разбивка на 5 подпачей (последовательных)
P1.0.1 UI/UX → P1.0.2 Attachments+Emoji → P1.0.3 Reactions (tickets) → P1.0.4 Telegram Bridge → P1.0.5 Reactions (Telegram)

---

# P1.0.1 — UI техподдержки “как Telegram” (Layout + UX)
Цель: визуально и UX приблизить SupportTabContent к InboxTabContent, без изменения БД и бизнес-логики.

## Изменения

### A) ResizablePanelGroup вместо фиксированных ширин
Файл: src/components/admin/communication/SupportTabContent.tsx
- Заменить w-80/w-96 на ResizablePanelGroup + ResizableHandle (с grip).
- Left panel: defaultSize=35, minSize=15, maxSize=40
- Right panel: defaultSize=65, minSize=50
- Сохранять размеры в localStorage key="support-panel-sizes" в формате { left, right }.
- Важно: Mobile guard:
  - Если ширина экрана < md: НЕ использовать resizable layout. Оставить текущий mobile UX (список/чат по переключению).

### B) Клик на контакт → ContactDetailSheet
Файл: src/components/admin/communication/SupportTabContent.tsx
- Сделать аватар+имя в хедере чата кликабельными.
- Открывать ContactDetailSheet по корректному идентификатору:
  - Если ContactDetailSheet ожидает contactId (profiles.id / contacts.id) — передавать именно его.
  - Не использовать “user_id из тикета” вслепую: тикет может быть на profile/contact, не на auth.user.
- Добавить state:
  - contactSheetOpen:boolean
  - contactSheetContactId:string | null
- По клику: setContactSheetContactId(selectedTicket.profile_id || selectedTicket.contact_id), open=true.

### C) Полное имя без truncate
Файл: SupportTabContent.tsx + TicketCard.tsx
- Убрать truncate у имени клиента (break-words / line-clamp-2).
- Subject + ticket number второй строкой (subject можно truncate).

### D) Сортировка: непрочитанные сверху
Файл: SupportTabContent.tsx
- Клиентская сортировка:
  1) has_unread_admin=true сверху
  2) внутри updated_at DESC

### E) Яркий индикатор непрочитанных
Файл: src/components/support/TicketCard.tsx
- Непрочитанные: bg-primary/10, name font-bold.
- Badge:
  - если есть unread_count: круг + число
  - иначе: заметная точка (h-2.5 w-2.5 + ring)

### F) MarkRead семантика: НЕ ломаем в P1.0.1
- НЕ менять поведение has_unread_admin в БД.
- НЕ удалять markRead useEffect из TicketChat в этом подпаче.
(Если убрать — тикеты “вечные непрочитанные”, саппорт умирает.)
- Отдельный будущий микропатч P1.0.1.1 (не сейчас): add-only поле last_admin_seen_at, если понадобится логика “прочитан после ответа”.

## DoD P1.0.1
1) Панели ресайзятся (desktop), размеры сохраняются.
2) На mobile UI не сломан (fallback без resizable).
3) Клик по имени/аватару открывает ContactDetailSheet корректного контакта.
4) Непрочитанные сверху, визуально заметны.
5) markRead работает как раньше (нет регрессий).

---

# P1.0.2 — Файлы, эмодзи, мультимедиа в тикетах
Цель: добавить attachments + emoji picker + корректный безопасный доступ к файлам.

## ВАЖНО (SECURITY)
Запрещено делать SELECT policy на storage.objects вида USING(bucket_id='ticket-attachments') — это даёт чтение всем.
Чтение вложений только через signed URL (edge function).

## DB миграция
1) Bucket (private):
- storage.buckets: id='ticket-attachments', public=false

2) Storage policies (минимум):
- INSERT: authenticated, bucket_id='ticket-attachments'
- SELECT: НЕ давать широкой политики. (Либо только admin роли, если это реально нужно.)
Рекомендуемый вариант: SELECT policy отсутствует, выдача через signed URL только edge function.

## Edge Function (новая): ticket-attachments-sign
- Input: { ticketId, objectPath }
- Auth: required
- Проверка доступа:
  - user = владелец тикета ИЛИ admin
- Generate signed URL (short TTL, напр. 10-30 минут)
- STOP-guards: ограничить objectPath префиксом ticketId

## UI
Файл: src/components/support/TicketChat.tsx
- Кнопка “скрепка” рядом с textarea
- Upload path: ticket-attachments/{ticketId}/{messageLocalId}/{filename}
- После upload: запросить signed URL через ticket-attachments-sign
- Attachments preview queue до отправки
- Emoji picker (Popover) + вставка эмодзи в текст

Файл: src/components/support/TicketMessage.tsx
- Рендер вложений:
  - image/* inline preview
  - video/* preview
  - pdf link
  - docs link + icon

## DoD P1.0.2
1) Upload работает, файлы в bucket private.
2) Signed URL выдаётся только участнику тикета/админу.
3) Не-участник не может получить URL (401/403).
4) Вложения отображаются в чате, есть preview.

---

# P1.0.3 — Реакции на сообщения тикетов
Цель: emoji reactions как в мессенджерах.

## DB миграция
ticket_message_reactions как в ТЗ + добавить индекс:
- index on (message_id)

RLS:
- INSERT/DELETE только своего user_id
- SELECT допустим (или ограничить на участников тикета, если есть join)

Realtime:
- ADD TABLE ticket_message_reactions to publication

## UI/хуки
- src/hooks/useTicketReactions.ts (new)
- TicketMessage.tsx:
  - hover reaction button + picker
  - grouped reactions under message
  - toggle on click

## DoD P1.0.3
1) Реакции добавляются/удаляются, RLS работает.
2) UI обновляется realtime без перезагрузки.

---

# P1.0.4 — Telegram Bridge (дублирование сообщений)
Цель: отправка ответа в TG по чекбоксу, входящие TG сообщения попадают в тикет.

## DB миграция
support_tickets:
- telegram_bridge_enabled boolean default false
- telegram_user_id bigint null

ticket_telegram_sync:
- FK тип telegram_message_id должен совпадать с telegram_messages.id (проверить заранее!)
- direction enum: to_telegram/from_telegram
- RLS: только admin

## Edge изменения
1) supabase/functions/telegram-admin-chat/index.ts
- new action: bridge_ticket_message
- input: { ticketId, ticketMessageId }
- STOP-guards:
  - ticket exists
  - bridge_enabled=true
  - telegram_user_id not null
  - idempotency: если sync запись уже есть для ticketMessageId+direction=to_telegram → no-op
- send Telegram message (использовать существующий отправляющий код/функцию)
- insert ticket_telegram_sync

2) supabase/functions/telegram-webhook/index.ts
- add-only: если incoming from user with open ticket where telegram_bridge_enabled=true:
  - создать ticket_message(author_type='user')
  - insert ticket_telegram_sync(direction='from_telegram')
- Если найдено несколько тикетов: выбрать самый свежий open/active (ordered by updated_at desc).

## UI
src/components/support/TicketChat.tsx
- checkbox “Отправить в Telegram” показывать только если selectedTicket.telegram_user_id != null
- при отправке с галочкой: вызвать bridge_ticket_message

src/components/admin/communication/SupportTabContent.tsx
- кнопка “Перейти в Telegram” в хедере:
  - открывает тот же диалог в InboxTabContent (deep link / state routing)

## DoD P1.0.4
1) Отправка из тикета с галочкой → сообщение уходит в TG.
2) Ответ в TG → появляется в тикете.
3) ticket_telegram_sync заполняется обеими направлениями.
4) Нет дублей (idempotency подтверждён).

---

# P1.0.5 — Реакции в Telegram чате
Цель: реакции на сообщения в ContactTelegramChat.

## DB миграция
telegram_message_reactions + индекс message_id
RLS: admin-only (insert/delete/select), не “ALL”.

## UI
src/components/admin/ContactTelegramChat.tsx
- hover reaction button + picker
- grouped reactions under bubble
- realtime обновление (если подключено)

## DoD P1.0.5
1) Реакции сохраняются и отображаются.
2) Realtime обновляет без refresh.

---

## Итоговый порядок выполнения
1) P1.0.1 UI/UX (без логики markRead)
2) P1.0.2 Attachments+Signed URLs (secure)
3) P1.0.3 Reactions (tickets)
4) P1.0.4 Telegram Bridge
5) P1.0.5 Telegram reactions

---

## Общий DoD (сквозной)
- UI: ресайз + сохранение + sheet + сортировка.
- Security: attachments не доступны посторонним.
- Realtime: реакции live.
- Bridge: двунаправленная синхронизация, без дублей.
- Audit (если затрагиваются системные действия): audit_logs actor_type='system' и actor_label заполнен.