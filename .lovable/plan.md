# План: Исправление системы отзыва доступа и ложной повторной выдачи (TG-REVOKE-FALSE-REGRANT)

---

## STOP-GUARD (глобальный)

1. **До фикса trigger/queue НЕ запускать** массовые revoke/kick/regrant операции по клубу.
2. **НЕ выполнять** ручные «исправления статусов» напрямую в БД без объяснимого audit trail.
3. **Первым шагом** — диагностика и блокировка ложного auto-grant, только потом косметика UI.

---

## Корневая причина (доказано по данным)

Полная цепочка бага на примере Рыштаковой (13.03.2026, 19:06):

```text
1. Admin нажимает "Отозвать" в EditSubscriptionDialog
   → вызывает telegram-revoke-access БЕЗ is_manual/admin_id

2. telegram-revoke-access: guard НЕ пропущен (isAdminAction=false)
   → находит subscription 90d3dda1 (status='active')
   → БЛОКИРУЕТ revoke, возвращает {blocked: true}

3. EditSubscriptionDialog ИГНОРИРУЕТ ответ backend
   → принудительно пишет telegram_access.state_*='revoked' (строка 387-390)
   → UI показывает "отозван", но backend НЕ отозвал

4. ПАРАЛЛЕЛЬНО: что-то обновило subscription 90d3dda1 (updated_at=19:06:02)
   → сработал SQL-триггер subscription_grant_telegram
   → вставил запись в telegram_access_queue (action='grant')

5. telegram-process-access-queue обработал очередь
   → вызвал telegram-grant-access без проверки revoke
   → отправил DM с invite-ссылкой "Авто-выдача: Бухгалтерия как бизнес"
   → записал telegram_logs: AUTO_GRANT с invite-ссылкой
```

**Три корневых дефекта:**
1. UI (`EditSubscriptionDialog`) не передает `is_manual: true` → revoke блокируется автогардом
2. UI игнорирует `{blocked: true}` от backend и форсит локальный state
3. SQL-триггер `subscription_grant_telegram` слепо ставит grant в очередь при любом UPDATE, не проверяя контекст
4. `telegram-grant-access` не проверяет, был ли только что revoke — слепо выдаёт доступ по запросу из очереди

---

## PATCH TG-REVOKE-FALSE-REGRANT (выделенный корневой патч)

**Цель:** после любого revoke пользователь НЕ должен получать сообщение о новой выдаче доступа без нового валидного grant-события.

### Компоненты патча:

#### A. SQL-триггер `subscription_grant_telegram` — корень бага

Триггер НЕ должен ставить grant в очередь если:
1. `access_end_at` уже истёк (`NEW.access_end_at IS NOT NULL AND NEW.access_end_at < NOW()`)
2. По данному `user_id + club_id` есть свежий revoke/remove сценарий (проверка `telegram_access.state_chat = 'revoked'` за последние 5 минут)
3. UPDATE не связан с реальной выдачей доступа (технические обновления — `updated_at`, `meta`, `notes` — не должны триггерить grant)

Конкретно: триггер должен реагировать ТОЛЬКО на изменение полей `status`, `access_end_at`, `tariff_id` (реальные grant-события).

#### B. Guard в `telegram-grant-access`

Перед выдачей доступа:
- Если `telegram_access.state_chat = 'revoked'` для данного user+club И `source !== 'manual'` → проверить `hasValidAccess(user_id, club_id)`
- Если нет валидного доступа → refuse grant, log `telegram.grant_blocked_after_revoke`

#### C. Guard в `telegram-process-access-queue`

Перед вызовом `telegram-grant-access`:
- Проверить `hasValidAccess(item.user_id, item.club_id)` (импорт из `_shared/accessValidation.ts`)
- Если нет валидного доступа → пометить queue item как `skipped`, reason: `no_valid_access`

#### D. Защита от гонок revoke vs auto-grant

- Если revoke и grant пришли почти одновременно — **revoke побеждает**
- Grant после revoke допускается ТОЛЬКО при доказуемом новом основании:
  - Новый active grant / new entitlement / новая оплата / manual regrant admin
- Механизм: перед grant проверять `telegram_access_audit` на наличие revoke за последние 60 секунд для того же user+club; если есть — требовать явный `force: true` или `source: 'manual'`

---

## Обязательная диагностика (ФАЗА 0)

### 0.1 Источник UPDATE subscription 90d3dda1 в 19:06:02

**Требуется доказать:**
- Какие поля были before/after (diff)
- Кто был actor/source (UI, edge function, cron, trigger)
- Какой код/функция это изменила

**Методы:**
- Проверить `audit_logs` за ±5 секунд от 19:06:02 для subscription 90d3dda1
- Проверить `telegram_access_audit` за тот же период
- Проверить `telegram_access_queue` — кто вставил запись
- Проверить edge function logs `telegram-revoke-access` за 19:06

### 0.2 Источник ложного сообщения

- Проверить `telegram_logs` за 19:06-19:10 для Рыштаковой
- Найти source_function, message type, trigger chain

---

## ФАЗА 1: Починить revoke flow из UI

### Жёсткое правило: Backend response is source of truth

1. Если backend вернул `blocked`, `success=false` или ошибку — **UI ничего локально не меняет**
2. **Никаких прямых `update telegram_access` из клиента** — backend сам управляет состоянием
3. После revoke — только refetch/refresh из backend

### `src/components/admin/EditSubscriptionDialog.tsx`:
- Вызов `telegram-revoke-access` с `is_manual: true, admin_id: user.id, club_id`
- Проверить ответ: если `data.blocked === true` → `toast.warning` с причиной, НЕ менять локальный state
- **Убрать** принудительный `update telegram_access.state_*='revoked'` (строки 387-390)
- После успешного revoke — refetch данных из backend

### Аналогично проверить и исправить:
- `ContactDetailSheet`
- `DealDetailSheet`
- `EditDealDialog`
- `AdminDeals`
- `MemberDetailsDrawer`

---

## ФАЗА 2: SQL-триггер subscription_grant_telegram

Миграция: обновить триггерную функцию.

```sql
-- Guard 1: не ставить в очередь, если access_end_at уже истёк
IF NEW.access_end_at IS NOT NULL AND NEW.access_end_at < NOW() THEN
  RETURN NEW;
END IF;

-- Guard 2: реагировать только на значимые изменения
IF NOT (
  OLD.status IS DISTINCT FROM NEW.status OR
  OLD.access_end_at IS DISTINCT FROM NEW.access_end_at OR
  OLD.tariff_id IS DISTINCT FROM NEW.tariff_id
) THEN
  RETURN NEW;
END IF;

-- Guard 3: не ставить в очередь, если есть свежий revoke
IF EXISTS (
  SELECT 1 FROM telegram_access
  WHERE user_id = NEW.user_id
    AND state_chat = 'revoked'
    AND updated_at > NOW() - INTERVAL '5 minutes'
) THEN
  RETURN NEW;
END IF;
```

---

## ФАЗА 3: Guards в backend функциях

### `telegram-process-access-queue`:
- Импорт `hasValidAccess` из `_shared/accessValidation.ts`
- Перед вызовом grant: `hasValidAccess(item.user_id, item.club_id)`
- Если нет доступа → status = `skipped`, reason = `no_valid_access`

### `telegram-grant-access`:
- Перед выдачей: проверка `telegram_access.state_chat` для user+club
- Если `revoked` и source ≠ manual → проверить `hasValidAccess`
- Если нет доступа → refuse, log `grant_blocked_after_revoke`
- Проверка гонки: `telegram_access_audit` на revoke за последние 60 секунд

---

## ФАЗА 4: Аудит причины отправки Telegram-сообщений

### Обязательные поля для каждого access-related события:

| Поле | Описание |
|------|----------|
| `user_id` | ID пользователя |
| `club_id` | ID клуба |
| `source_function` | Имя edge function |
| `source_entity` | Таблица-источник (subscription, entitlement, manual) |
| `source_entity_id` | ID записи-источника |
| `reason_code` | grant, regrant, renewal, manual_grant, queue_auto, revoke_blocked |
| `trigger_type` | manual, cron, trigger, queue, system |
| `decision` | granted, blocked, skipped, revoked |

### Классификация событий Telegram (PATCH отдельный):

| Тип | Описание |
|-----|----------|
| `grant_access` | Первичная выдача доступа |
| `regrant_access` | Повторная выдача после истечения/отзыва с новым основанием |
| `revoke_access` | Отзыв доступа (ручной или автоматический) |
| `kick_violator` | Кик нарушителя из чата/канала |
| `service_notification` | Сервисное уведомление (напоминание, инфо) |
| `subscription_reminder` | Напоминание об оплате/продлении |

### Куда писать:
- `audit_logs`: action = `telegram.access_dm_sent`, meta содержит все поля выше
- `telegram_logs`: добавить `reason_code` и `trigger_type`

### Все outbound notification flows должны использовать единый SoT:
- `telegram-grant-access` — перед отправкой DM
- `telegram-send-notification` — все типы уведомлений
- `telegram-reinvite-ghosts` — перед генерацией invite link
- `telegram-mass-broadcast` — при access-related рассылках

---

## ФАЗА 5: UI — backend truth wins

### Anti-contradiction guards (пользователь НЕ может одновременно быть):
- `removed` И `has_active_access=true`
- `violator` И `admin`
- `with_access` при `revoked` backend-state без валидного access-source

### `src/pages/admin/TelegramClubMembers.tsx`:
- `getAccessStatusBadge`: если `has_active_access === false` → всегда "Без доступа" (не зелёный)
- Вкладка "Удалённые": исключить админов
- Вкладка "Нарушители": исключить админов
- Не показывать кнопки "Выдать доступ" / "Повторно активировать" без явного нового grant-события
- Если backend говорит `no valid access` — UI не показывает зелёные статусы, активные плашки и кнопки, ведущие к выдаче/повторной активации

---

## ФАЗА 6: Обновить v_club_members_enriched

SQL миграция: добавить проверки в `has_active_access`:
- `subscriptions_v2` (active/trial/past_due + access_end_at)
- `entitlements` (active + expires_at)
- Существующие: `telegram_manual_access`, `telegram_access`, `telegram_access_grants`
- Guard против revoked-state: `state_chat != 'revoked' AND state_channel != 'revoked'`

---

## ФАЗА 7: Синхронизация cron/автокик

### `telegram-check-expired`:
- Синхронизировать с `_shared/accessValidation.ts`
- Явный skip для админов
- Убрать дефектный инкремент/декремент счётчиков

### `telegram-kick-violators`:
- Использовать `hasValidAccessBatch` для определения нарушителей
- Принудительно исключать админов из кандидатов на kick/removed

### `telegram-club-members` (actions kick/kick_present/mark_removed):
- Не допускать попадания админов в `removed`-состояние при массовых действиях

---

## Порядок внедрения

1. **Диагностика**: найти точный источник UPDATE subscription 90d3dda1 в 19:06:02 (ФАЗА 0)
2. **Заблокировать** ложный auto-grant: исправить SQL-trigger `subscription_grant_telegram` (ФАЗА 2)
3. **Backend guards**: `telegram-process-access-queue` + `telegram-grant-access` (ФАЗА 3)
4. **Починить revoke flow** в UI: `EditSubscriptionDialog` и все точки вызова (ФАЗА 1)
5. **Аудит**: добавить reason_code, trigger_type, decision в DM-отправки (ФАЗА 4)
6. **UI бейджи**: backend truth wins, anti-contradiction guards (ФАЗА 5)
7. **SQL view**: обновить `v_club_members_enriched` (ФАЗА 6)
8. **Cron sync**: обновить автокик с единой валидацией и admin-guard (ФАЗА 7)

---

## DoD (Definition of Done)

### Негативный E2E-сценарий «revoke → не должно прийти сообщение о выдаче» (обязательный отдельный)

1. Вручную отозвать доступ из карточки контакта/подписки
2. Backend возвращает `{success: true}` (не blocked)
3. `telegram_access.state_* = 'revoked'`
4. Бот **НЕ** отправляет DM "Доступ открыт" / invite-ссылку
5. SQL-лог `telegram_logs` **НЕ** содержит AUTO_GRANT после revoke
6. `telegram_access_queue` **НЕ** содержит нового grant item после revoke без основания
7. `audit_logs` содержит `reason_code` для каждого отправленного сообщения

### Негативный сценарий Рыштаковой (обязательный отдельный)

1. Отозвать доступ
2. Пользователь уходит в корректный статус (violator/removed)
3. Бот **НЕ** отправляет сообщение о новой выдаче доступа
4. Приложить: SQL-дамп queue items, telegram_logs, audit_logs, скрины карточки участника

### SQL-пруф по очереди

- Queue item created / skipped / processed — с reason
- Отсутствие нового grant item после revoke без основания
- Каждый processed item имеет `reason_code` и `decision`

### Статусы в UI соответствуют backend

- Плашки "С доступом" / "Без доступа" совпадают с `hasValidAccess`
- Вкладка "Удалённые" не содержит админов
- Anti-contradiction: нет одновременных `removed + has_active_access`, `violator + admin`, `with_access + revoked`

### Очередь не выдаёт доступ после revoke

- Queue processor пропускает item для revoked пользователя с `status=skipped, reason=no_valid_access`
- SQL-trigger не вставляет grant при технических UPDATE

### Аудит-лог полный

- Каждое Telegram-сообщение о доступе имеет запись с:
  - `source_function`, `reason_code`, `trigger_type`, `decision`
  - `user_id`, `club_id`, `source_entity`, `source_entity_id`

### Правила статусов после фикса

- Нет валидного доступа + в чате/канале → `violator`
- После успешного кика/бана → `removed`, `in_chat/in_channel=false`
- Админы: не кикаются автологикой, не в "Нарушители", не в "Удалённые", всегда в "Админы"

---

## Файлы с изменениями

| Файл | Действие |
|------|----------|
| SQL trigger `subscription_grant_telegram` | Миграция: guards на expired, технические UPDATE, свежий revoke |
| `supabase/functions/telegram-process-access-queue/index.ts` | Guard: hasValidAccess перед grant |
| `supabase/functions/telegram-grant-access/index.ts` | Guard: revoked state + hasValidAccess + race protection |
| `src/components/admin/EditSubscriptionDialog.tsx` | Убрать прямой update telegram_access, передать is_manual, проверять blocked |
| `src/pages/admin/TelegramClubMembers.tsx` | Backend truth wins для бейджей, anti-contradiction guards |
| SQL view `v_club_members_enriched` | Миграция: полный набор access-источников |
| `supabase/functions/telegram-check-expired/index.ts` | Синхронизация с единой валидацией, admin-guard |
| `supabase/functions/telegram-kick-violators/index.ts` | hasValidAccessBatch, admin-guard |
| Все outbound notification flows | reason_code, trigger_type, decision в audit |

## Что НЕ меняем

- Схему `_shared/accessValidation.ts` — используем as-is (единый SoT)
- Основную логику подписок/оплат
- Telegram Bot API интеграцию
- Структуру таблиц (только view + trigger)
