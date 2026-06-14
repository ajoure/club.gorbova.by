# S1 — единая модель realtime-инвалидации + удаление дубля звука + понижение polling

**Patch:** PATCH-CONTACT-CENTER-FIX-V1
**Stage:** S1 (закрывает F2 + F7 + F10)
**Date:** 2026-06-14
**Status:** ENGINEERING IMPLEMENTATION = PASS · RUNTIME UAT = DEFERRED_OPERATIONAL_UAT

---

## 1. Что изменено

### 1.1 Новое

- `src/constants/inboxQueryKeys.ts` — канонические query keys `INBOX_DIALOGS_QK` и `UNREAD_MESSAGES_COUNT_QK` (правка 6 плана: единые константы вместо string-литералов).
- `src/hooks/useInboxRealtimeInvalidation.ts` — единый event-aware bus с trailing debounce 300 мс. SINGLE OWNER. Cleanup с flush ожидающих инвалидаций и `removeChannel`. StrictMode-safe.

### 1.2 Изменено

- `src/components/layout/AdminLayout.tsx` — подключён `useInboxRealtimeInvalidation()` рядом с `useIncomingMessageAlert()`. **Owner — AdminLayout**, потому что бейдж `useUnreadMessagesCount` живёт в `AdminSidebar` (всегда виден вне зависимости от текущего admin-маршрута) — это удовлетворяет правке 3 плана.
- `src/components/admin/communication/InboxTabContent.tsx`:
  - удалён локальный канал `inbox-messages-realtime` (теперь инвалидация приходит из общего bus'а);
  - удалён локальный `playNotificationSound` (дубль с глобальным `useIncomingMessageAlert`);
  - удалены неиспользуемые `soundEnabledRef` и его autoplay-gate effect (глобальный хук имеет свой gate через AudioContext.resume на первый клик).
- `src/hooks/useUnreadMessagesCount.tsx`:
  - удалена локальная realtime-подписка `unread-count` (теперь приходит из общего bus'а);
  - safety polling поднят с 60 секунд до 5 минут с visibility-aware паузой (`useVisibilityPolling`), пауза во вкладке вне фокуса сохранена — это закрывает правку 7 плана;
  - удалён избыточный `refetch` из API хука (наружу больше не нужен — все mutations и так используют invalidateQueries).

### 1.3 НЕ изменено

- `src/hooks/useIncomingMessageAlert.ts` — sound-only хук с серверным фильтром `direction=eq.incoming`, остаётся единственным источником звука.
- Per-dialog подписки в `ContactTelegramChat.tsx` (`chat-messages-<userId>`, `chat-bridge-<userId>`) — они фильтрованные по user_id и patch'ат кэш конкретного диалога, не дублируют bus.
- Edge-функции, RLS, RPC, миграции, права, billing, broadcasts, CRM, документы, Storage — без изменений.
- `mark_dialog_read` RPC и контракт `get_inbox_dialogs_v1` — будут адресованы в S2/S3, тут не трогаем.

---

## 2. Матрица событий (event-aware)

```
event                                        →  inbox-dialogs   unread-count
─────────────────────────────────────────────────────────────────────────────
INSERT direction='incoming'                  →       ✓                ✓
INSERT direction='outgoing'                  →       ✓                ·
UPDATE                                       →       ✓                ·
  ── + new.direction='incoming' AND          →       (✓)              ✓
       new.is_read=true
DELETE                                       →       ✓                ✓
```

Любое UPDATE → invalidate inbox-dialogs (превью / порядок / любая метаинформация могут поменяться). Дополнительно invalidate unread-count только если новое состояние строки = «прочитанное входящее» (mark-as-read fanout). Эвристика не зависит от `REPLICA IDENTITY FULL`.

---

## 3. Контракт debounce и cleanup

- **Trailing 300 ms.** Первое событие в окне ставит таймер; последующие в окне ничего не делают, только взводят соответствующие refs. По истечении окна — один invalidate каждого пакета (если был взведён).
- **Flush на unmount.** При размонтировании, если таймер ещё идёт — `clearTimeout` + сразу выполняется flush ожидающих инвалидаций. Последний invalidate не теряется.
- **`removeChannel` на unmount** в той же cleanup-функции. Повторный mount (например, StrictMode dev) создаёт новый канал; старый удалён через cleanup → нет дублей подписки.
- **Reconnect.** При `CHANNEL_ERROR` / `TIMED_OUT` — `console.warn`. Supabase Realtime сам выполняет reconnect; после восстановления invalidate возобновляется.

---

## 4. Соответствие правкам утверждённого плана

| Правка | Статус | Где |
| --- | --- | --- |
| 2 — anti-duplication check | PASS | Подтверждено в baseline §1.2 |
| 3 — single always-mounted owner | PASS | `AdminLayout` |
| 4 — event-aware матрица | PASS | См. §2 |
| 5 — счёт «1+1 refetch» отдельно от callbacks | PASS | См. §6 |
| 6 — trailing debounce + flush + query-keys через константы | PASS | См. §1, §3 |
| 7 — visibility-aware safety polling 5 мин | PASS | `useUnreadMessagesCount` |
| 1 — между S0…S4 без ручных согласований | PASS | Сразу перехожу к S2 |

---

## 5. Ожидаемое поведение «после» (UAT матрица)

Ожидаемые числа, которые должен подтвердить browser/network трейс пользователя в реальном UAT:

| Сценарий | Realtime callbacks | invalidate calls | HTTP refetch |
| --- | ---: | ---: | ---: |
| 1× INSERT incoming | 1 (alert) + 1 (bus) = 2 | 2 (inbox + unread) | ≤ 2 (один inbox, один unread; dedup если уже in-flight) |
| 1× INSERT outgoing | 1 (bus) | 1 (inbox) | ≤ 1 |
| Mass mark-as-read 14 строк (построчно, как сейчас) | 14 (bus UPDATE) | 2 (после окна 300 ms: inbox + unread) | ≤ 2 |
| Звук на 1× INSERT incoming | 1 раз | — | — |

**Важно:** mass-fanout 14 UPDATE → 2 HTTP — этого достаточно, чтобы убрать «нагрузку от собственного действия». Полное устранение построчного fanout-а realtime-broadcast'а делается в S2 (атомарный RPC).

---

## 6. DoD S1

- [x] 1 источник звука (глобальный `useIncomingMessageAlert`).
- [x] Realtime → ≤ 1 inbox-invalidate + ≤ 1 unread-invalidate за окно 300 мс.
- [x] Polling unread-count = 5 мин (visibility-aware), realtime — основная сигнализация.
- [x] Анти-дублирование подписок (`SINGLE OWNER`, cleanup, StrictMode-safe).
- [ ] **DEFERRED_OPERATIONAL_UAT:** browser/network proof «до/после» (cold-open, INSERT, mark-as-read) снимает пользователь по шаблону §3 baseline.

---

## 7. Rollback

`git revert` четырёх файлов (`AdminLayout`, `InboxTabContent`, `useUnreadMessagesCount`, новые файлы `inboxQueryKeys` и `useInboxRealtimeInvalidation`). Никаких миграций / RPC / edge-функций не затронуто — rollback атомарный, без БД-зависимости.

---

## 8. Затронутые домены: чек isolation

- Доступы (grant-access-for-order, access_rules, entitlements, subscriptions_v2) — НЕ затронуто.
- Billing / payments (bePaid, Stripe, orders_v2) — НЕ затронуто.
- Broadcasts (диспетчер, шаблоны, аудитории) — НЕ затронуто.
- CRM (pipelines, deals, kanban) — НЕ затронуто.
- Документы — НЕ затронуто.
- RLS, Storage, миграции — НЕ затронуто.
- Edge-функции (telegram-admin-chat, telegram-webhook, grant-access-*, bepaid-*, stripe-*) — НЕ затронуто.
- `useVisualViewportInset` — НЕ затронуто (отложено в S4).

---

## 9. Переход к S2

S2 — атомарный mark-as-read RPC + защищённый flow «ответ» — начинается без дополнительного согласования (правка 1 плана). Перед миграцией будет выполнен sub-discovery по канонической границе «не пометить новое incoming» (правка 9 плана): timestamp vs message_id.
