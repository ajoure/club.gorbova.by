# Baseline pre-execute — Контакт-центр (S0)

**Patch:** PATCH-CONTACT-CENTER-FIX-V1
**Stage:** S0 — Baseline pre-execute (read-only, без правок кода/БД)
**Date:** 2026-06-14
**Scope:** Telegram inbox в `/admin/communication?tab=inbox` + глобальный счётчик непрочитанных в `AdminSidebar`.

---

## 1. Подтверждённый код-инвентарь (FACT)

### 1.1 Места монтирования глобальных хуков

| Хук | Файл монтирования | Scope |
| --- | --- | --- |
| `useIncomingMessageAlert` | `src/components/layout/AdminLayout.tsx:98` | Глобально, любая admin-страница |
| `useUnreadMessagesCount` | `src/components/layout/AdminSidebar.tsx:57` **и** `src/pages/admin/AdminCommunication.tsx:38` | Сайдбар-бейдж (всегда) + страница контакт-центра |

**Следствие для S1 (правка 3 плана):** owner общего realtime-bus-хука обязан быть в `AdminLayout` (как и `useIncomingMessageAlert`), потому что бейдж непрочитанных в `AdminSidebar` всегда смонтирован вне зависимости от текущей вкладки. Если разместить хук только в `InboxTabContent`, вне `/admin/communication` обновления будут приходить только раз в 5 минут (safety polling).

### 1.2 Anti-duplication проверка (правка 2 плана)

Поиск `supabase.channel(...)` в `src/hooks/`, `src/components/admin/communication/`, `src/pages/admin/` дал **0 совпадений** на верхнем уровне общего bus/invalidation-хука. Существующие подписки на `telegram_messages`:

| Канал | Файл | Фильтр | Действие |
| --- | --- | --- | --- |
| `inbox-messages-realtime` | `InboxTabContent.tsx:470` | нет | refetch `inbox-dialogs` + локальный звук |
| `unread-count` | `useUnreadMessagesCount.tsx:31` | нет | refetch `unread-messages-count` |
| `global-incoming-alert` | `useIncomingMessageAlert.ts:31` | `direction=eq.incoming` | sound only |
| `chat-messages-<userId>-<instanceId>` | `ContactTelegramChat.tsx:685` | `user_id=eq.<uuid>` | patch cache конкретного диалога |
| `chat-bridge-<userId>-<instanceId>` | `ContactTelegramChat.tsx:781` | `user_id=eq.<uuid>` | bridge refetch |

**Вывод:** общий event-aware bus-хук в проекте отсутствует. Создание `useInboxRealtimeInvalidation` — оригинальная сущность, не дубликат. Существующие per-dialog подписки (`chat-messages-*`, `chat-bridge-*`) и глобальный звук (`global-incoming-alert`) трогать не будем.

### 1.3 Контракт отправки сообщения (правка 13 плана)

- Edge `supabase/functions/telegram-admin-chat/index.ts` возвращает HTTP 200/4xx с JSON `{ success: boolean, error?: string, ... }`.
- Фронт `ContactTelegramChat.tsx:1034-1036` уже выполняет:
  ```ts
  if (error) throw error;
  if (!data.success) throw new Error(data.error || "Не удалось отправить сообщение");
  ```
- `onMessageSent?.()` вызывается ТОЛЬКО в `onSuccess` мутации, то есть после прохождения обоих условий (HTTP success + business `success:true`).
- **Следствие для S2:** добавочного wrapper'а в edge не требуется. Достаточно убедиться, что `onMessageSent` действительно вызывается только из `onSuccess` — это уже так.

### 1.4 Канонический хук `useVisualViewportInset` (правка 22 плана)

`src/hooks/useVisualViewportInset.ts`:
- Пишет CSS-переменную `--room-vv-bottom-offset` в `document.documentElement` (глобально, не привязано к DOM lesson-room).
- Использует `window.visualViewport` с graceful fallback (offset=0 на desktop / без API).
- Cleanup всех listeners + сброс переменной в 0 на unmount.
- Используется в `src/pages/LiveEvent.tsx:188`.

CSS-переменная **глобальная** и подходит для переиспользования в композере чата без модификации хука. Имя переменной (`--room-vv-bottom-offset`) — историческое (от lesson-room), но семантически — generic visual-viewport offset. Подключаем как есть (single-mount на странице чата). Никакой регрессии lesson-room это не создаёт: значение пишется глобально, читается через `var(--room-vv-bottom-offset, 0px)` в любом месте.

### 1.5 Источник истины тела RPC `get_inbox_dialogs_v1`

Полный текст функции получен через `pg_get_functiondef` и сохранён в `.lovable/discovery/contact_center_audit_2026-06-14.md` §F1. Контракт колонок результата:

```
user_id uuid, last_message_text text, last_message_at timestamptz, last_message_type text,
last_message_id uuid, unread_count bigint, has_pending_media boolean,
last_bot_id uuid, last_bot_username text, last_bot_name text
```

LANGUAGE sql, STABLE, SECURITY DEFINER, `SET search_path = 'public'`. При rewrite в S3 контракт сохраняется бит-в-бит.

---

## 2. БД-метрики «до» (read-only)

### 2.1 Объём `telegram_messages`

| Метрика | Значение |
| --- | --- |
| Всего строк | 9 334 |
| Размер таблицы | 11 MB |
| Непрочитанных (incoming, is_read=false) | 14 |

### 2.2 Использование индексов `telegram_messages` (`pg_stat_user_indexes`, накопленное)

| Индекс | idx_scan | idx_tup_read | Размер |
| --- | ---: | ---: | --- |
| `idx_telegram_messages_unread_v1` (partial: direction='incoming' AND is_read=false) | **57 652** | 439 209 | 16 kB |
| `telegram_messages_pkey` | 24 875 | 26 949 | 344 kB |
| `idx_telegram_messages_dialog_v1` (user_id, created_at DESC) | 23 957 | 80 822 983 | 528 kB |
| `idx_telegram_messages_fts` (GIN) | 416 | 885 | 1 240 kB |
| `idx_telegram_messages_user_id` | 289 | 34 948 | 104 kB |
| `idx_telegram_messages_telegram_user_id` | 196 | 10 519 | 96 kB |
| `idx_telegram_messages_created_at` | 51 | 47 255 | 344 kB |
| **`idx_telegram_messages_unread` (дубликат)** | **6** | 93 | 32 kB |
| `telegram_messages_sent_by_admin_idx` | 3 | 16 770 | 88 kB |

**Подтверждение для F9 (DEFERRED):** дубликат `idx_telegram_messages_unread` фактически не используется (6 сканов против 57 652 у `_v1`). Дроп возможен отдельным микро-патчем после dependency-proof (проверить отсутствие REFERENCES/CONSTRAINT-зависимостей). В рамках V1 не выполняется.

### 2.3 `EXPLAIN ANALYZE` для `get_inbox_dialogs_v1`

Не выполнен: функция `SECURITY DEFINER` недоступна из read-only DB-режима tooling'а текущей сессии (`permission denied for function`). Запланирован в S3.1 в окно вне пика, со снятием плана через прямой DB-доступ либо через временный SECURITY INVOKER wrapper в test-schema.

---

## 3. Runtime browser/network baseline — DEFERRED_OPERATIONAL_UAT

Замеры по §4.A discovery (cold/warm Network trace, TTFP, число вызовов `get_inbox_dialogs_v1`, payload size, INSERT/MAR realtime callbacks) в текущем sandbox-окружении агента доступны только через инструментированный браузер; их детерминированный snapshot выполняется пользователем в реальном prod-окружении до и после фикса. Метрики снимаются по идентичной методике в:

- `.lovable/proofs/patch_contact_center_s1_<date>.md` (после S1)
- `.lovable/proofs/patch_contact_center_s2_<date>.md` (после S2)
- `.lovable/proofs/patch_contact_center_s3_<date>.md` (после S3)
- `.lovable/proofs/patch_contact_center_s4_<date>.md` (после S4)

Минимальный шаблон каждого замера:

```
Сценарий: <cold-open | warm-return | one-incoming | mar-N>
Когда: <UTC timestamp>
Браузер/устройство: <Chrome 124 / Safari iOS 17 / ...>
Метрики:
  - вызовов get_inbox_dialogs_v1: N
  - суммарный payload (inbox-dialogs): X kB
  - TTFP до первого диалога: T ms
  - realtime callbacks по telegram_messages: K
  - фактических HTTP-refetch: H
  - duplicate score (H - intended): D
```

`intended` для одного INSERT = 1 inbox-refetch + 1 count-refetch.
`intended` для MAR-N в одном диалоге = 1 RPC + 1 inbox-refetch + 1 count-refetch.

### 3.1 Воспроизведение F4 runtime

Запускается пользователем в реальном UAT с тестовым диалогом. Результат фиксируется в этом же файле как добавление:

```
F4 runtime:
- desktop reply → unread bagde disappears within: <ms>
- mobile reply → unread badge disappears within: <ms>
- observed misorder: <yes|no, details>
```

Если runtime воспроизвести не удалось — F4 остаётся PARTIALLY CONFIRMED, S2 всё равно выполняется превентивно (атомарный RPC + optimistic patch + защита от send-failure корректны как самостоятельный safety-фикс).

---

## 4. Тестовый диалог для S0…S4 UAT (правка 25 плана)

**Канал:** `telegram_messages` тестового диалога создаётся отдельной задачей оператором на собственном тестовом telegram-аккаунте (не реальный клиент).

**Контракт:**
- UUID тестового user_id фиксируется в proof-файле каждого этапа.
- Сообщения помечаются `meta = jsonb_build_object('test_fixture', 'patch_contact_center_v1')`.
- После завершения PATCH-CONTACT-CENTER-FIX-V1 — либо удалить тестовые строки, либо явно оставить с маркером (на усмотрение оператора).
- Запрещено отправлять тестовые сообщения внешнему человеку.

В этой версии baseline тестовый UUID ещё не зафиксирован — будет внесён в S1-proof при первом runtime замере.

---

## 5. STOP-guards и не-затронутые домены

Не затронуто на S0: 0 правок кода, 0 миграций, 0 запросов с побочными эффектами в БД. Все запросы — read-only через `pg_proc`/`pg_stat_user_indexes`/`count(*)`.

---

## 6. Готовность к S1

S0 завершён. S1 (`useInboxRealtimeInvalidation` + правки трёх файлов + удаление дубля звука + понижение polling) можно начинать без дополнительного согласования. STOP-guards внутри S1 сохранены (правка 1 плана).
