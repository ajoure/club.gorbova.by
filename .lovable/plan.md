# PATCH TG-REVOKE-FALSE-REGRANT

## Инвариант (главное правило патча)

> **После revoke никакой auto-grant, DM с новой выдачей и queue-grant без нового доказуемого основания быть не должно.**
> Revoke сильнее grant. Если revoke и grant пересеклись по времени — grant блокируется, пока не появится новое валидное основание после revoke (новая оплата, новый entitlement, manual regrant admin).

---

## STOP-GUARD (глобальный)

1. **До завершения ФАЗ 0–3 НЕ запускать** массовые revoke/kick/regrant операции по клубу — иначе снова нагенерируются ложные grant и уведомления.
2. **НЕ выполнять** ручные «исправления статусов» напрямую в БД без объяснимого audit trail.
3. **Порядок**: сначала остановить ложную выдачу на системном уровне (trigger + backend guards), потом чистить интерфейс.

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

**Четыре корневых дефекта:**
1. UI (`EditSubscriptionDialog`) не передает `is_manual: true` → revoke блокируется автогардом
2. UI игнорирует `{blocked: true}` от backend и форсит локальный state
3. SQL-триггер `subscription_grant_telegram` слепо ставит grant в очередь при любом UPDATE, не проверяя контекст
4. `telegram-grant-access` и `telegram-process-access-queue` не проверяют revoke-state — слепо выдают доступ

---

## ФАЗА 0: Диагностика (root-cause с доказательствами)

### 0.1 Источник UPDATE subscription 90d3dda1 в 19:06:02

**Требуется доказать (не предположить):**
- Какие **конкретные поля** были before/after (diff)
- Кто был **actor/source** (UI, edge function, cron, trigger) — имя функции/компонента
- Какой **код/функция** инициировала UPDATE
- Какой **queue item** был создан из-за этого UPDATE (id, created_at, action)
- Полная цепочка: UPDATE → trigger → queue item → grant invoke → DM sent

**Методы:**
- `audit_logs` за ±5 секунд от 19:06:02 для subscription 90d3dda1
- `telegram_access_audit` за тот же период
- `telegram_access_queue` — запись с user_id Рыштаковой, created_at ~19:06
- Edge function logs `telegram-revoke-access` за 19:06
- Edge function logs `telegram-grant-access` за 19:06-19:10
- `telegram_logs` за 19:06-19:10 для Рыштаковой — source_function, message type

### 0.2 Что именно сделал UI при revoke

- Проверить, обновляет ли `EditSubscriptionDialog` поля подписки (status, access_end_at, notes и т.д.) ДО или ПОСЛЕ вызова revoke
- Если да — это и есть источник UPDATE, запускающего trigger

---

## ФАЗА 1: SQL-триггер `subscription_grant_telegram` — корень ложного auto-grant

### Whitelist полей, при изменении которых допускается grant:

Grant в очередь допускается **ТОЛЬКО** если изменились поля, реально влияющие на доступ:
- `status` (переход в active/trial)
- `access_end_at` (продление)
- `tariff_id` (смена тарифа)
- `product_id` (смена продукта)

Любые другие UPDATE (`notes`, `meta`, `updated_at`, `payment_method_id` и т.д.) — **НЕ триггерят grant**.

### Guards в триггерной функции:

```sql
-- Guard 1: whitelist полей — реагировать ТОЛЬКО на значимые изменения
IF NOT (
  OLD.status IS DISTINCT FROM NEW.status OR
  OLD.access_end_at IS DISTINCT FROM NEW.access_end_at OR
  OLD.tariff_id IS DISTINCT FROM NEW.tariff_id OR
  OLD.product_id IS DISTINCT FROM NEW.product_id
) THEN
  RETURN NEW; -- технический UPDATE, игнорируем
END IF;

-- Guard 2: не ставить в очередь, если access_end_at уже истёк
IF NEW.access_end_at IS NOT NULL AND NEW.access_end_at < NOW() THEN
  RETURN NEW;
END IF;

-- Guard 3: не ставить в очередь, если есть свежий revoke (race protection)
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

## ФАЗА 2: Backend guards — единая централизованная проверка доступа

### Единое правило:

> `telegram-process-access-queue`, `telegram-grant-access`, `v_club_members_enriched`, и UI — все опираются на **одну и ту же** централизованную проверку доступа (`_shared/accessValidation.ts` / SQL-функция `has_valid_access_for_club`).
> Нельзя допускать отдельных локальных трактовок валидного доступа.

### Правило приоритета гонок:

> **Revoke сильнее grant.** Если revoke и grant пересеклись по времени, grant блокируется, пока не появится новое валидное основание после revoke.
> Механизм: перед grant проверять `telegram_access.updated_at` на наличие revoke за последние 60 секунд для того же user+club; если есть — требовать явный `source: 'manual'` или новое валидное основание.

### `telegram-process-access-queue/index.ts`:

- Импорт `hasValidAccess` из `_shared/accessValidation.ts`
- Перед вызовом `telegram-grant-access`: `hasValidAccess(item.user_id, item.club_id)`
- Если нет доступа → status = `skipped`, reason = `no_valid_access`, **НЕ** вызывать grant
- Проверка race: если `telegram_access.state_chat = 'revoked'` и `updated_at` < 5 min назад → status = `skipped`, reason = `recent_revoke`

### `telegram-grant-access/index.ts`:

- Перед выдачей доступа:
  1. Проверить `telegram_access.state_chat` для user+club
  2. Если `revoked` и source ≠ `manual` → проверить `hasValidAccess(user_id, club_id)`
  3. Если нет валидного доступа → refuse grant, log с `decision: 'grant_blocked'`, `reason_code: 'no_valid_access_after_revoke'`
- Перед отправкой DM: финальная повторная проверка `hasValidAccess`

---

## ФАЗА 3: Починить revoke flow из UI

### Жёсткое правило: Backend response is source of truth

1. Если backend вернул `blocked`, `success=false` или ошибку — **UI ничего локально не меняет**
2. **Никаких прямых `update telegram_access` из клиента** — backend сам управляет состоянием
3. После revoke — только refetch/refresh из backend

### Все точки ручного revoke (проверить и исправить каждую):

| Компонент | Что проверить |
|-----------|---------------|
| `EditSubscriptionDialog` | Убрать прямой update telegram_access, передать `is_manual: true, admin_id`, проверять `blocked` |
| `ContactDetailSheet` | Аналогично |
| `DealDetailSheet` | Аналогично |
| `EditDealDialog` | Аналогично |
| `AdminDeals` | Аналогично |
| `MemberDetailsDrawer` | Аналогично |
| Список клуба (3 точки) | Аналогично |
| Массовые операции (BulkActionsBar) | Аналогично — никаких локальных update |

**Правило для всех:** `is_manual: true` → ожидать ответ → если `blocked` → toast.warning → НЕ менять state → refetch.

---

## ФАЗА 4: Аудит причины отправки Telegram-сообщений

### Два слоя аудита (НЕ дублировать тяжёлый payload):

| Слой | Таблица | Назначение | Что писать |
|------|---------|------------|------------|
| Технический аудит | `audit_logs` | Полный trail для разбора | action, actor_type, actor_user_id, meta (все поля ниже) |
| Бизнес-событие | `telegram_logs` | Короткое бизнес-событие | reason_code, trigger_type, decision (лёгкий payload) |

### Обязательные поля в `audit_logs.meta` для access-related событий:

| Поле | Описание |
|------|----------|
| `user_id` | ID пользователя |
| `club_id` | ID клуба |
| `source_function` | Имя edge function |
| `source_entity` | Таблица-источник (subscription, entitlement, manual) |
| `source_entity_id` | ID записи-источника |
| `reason_code` | см. классификацию ниже |
| `trigger_type` | manual, cron, trigger, queue, system |
| `decision` | granted, blocked, skipped, revoked |

### Классификация событий (reason_code):

| Код | Описание |
|-----|----------|
| `grant_access` | Первичная выдача доступа |
| `regrant_access` | Повторная выдача с новым основанием |
| `revoke_access` | Отзыв доступа |
| `kick_violator` | Кик нарушителя |
| `service_notification` | Сервисное уведомление |
| `subscription_reminder` | Напоминание об оплате |
| `grant_blocked` | Grant заблокирован (нет доступа / revoke race) |
| `queue_skipped` | Queue item пропущен (нет доступа / revoke race) |
| `revoke_blocked` | Revoke заблокирован (активная подписка) |

### Все outbound notification flows должны использовать единый SoT:
- `telegram-grant-access` — перед отправкой DM
- `telegram-send-notification` — все типы уведомлений
- `telegram-reinvite-ghosts` — перед генерацией invite link
- `telegram-mass-broadcast` — при access-related рассылках

---

## ФАЗА 5: UI — backend truth wins

### Anti-contradiction guards (пользователь НЕ может одновременно быть):

| Запрещённая комбинация | Что делать |
|------------------------|------------|
| `removed` И `has_active_access=true` | Невозможно: если есть доступ, не removed |
| `removed` И `in_chat=true` или `in_channel=true` | Невозможно: если в чате, не removed |
| `violator` И `admin` | Невозможно: админ никогда не violator |
| `violator` И `has_valid_access=true` | Невозможно: если есть доступ, не violator |
| `with_access` при `revoked` backend-state без валидного access-source | Невозможно: revoked без source = без доступа |

### `src/pages/admin/TelegramClubMembers.tsx`:
- `getAccessStatusBadge`: если `has_active_access === false` → всегда "Без доступа" (не зелёный)
- Вкладка "Удалённые": исключить админов
- Вкладка "Нарушители": исключить админов
- Не показывать кнопки "Выдать доступ" / "Повторно активировать" без явного нового grant-события
- Если backend говорит `no valid access` — UI не показывает зелёные статусы, активные плашки и кнопки

---

## ФАЗА 6: SQL-функция `has_valid_access_for_club` + обновление `v_club_members_enriched`

### Не дублировать сложную access-логику во view.

Вынести в одну SQL-функцию:
```sql
CREATE OR REPLACE FUNCTION has_valid_access_for_club(p_user_id uuid, p_club_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- Проверяет все 5 источников доступа аналогично _shared/accessValidation.ts
  -- subscriptions_v2, entitlements, telegram_manual_access, telegram_access, telegram_access_grants
  -- с guard против revoked-state
$$;
```

Использовать эту функцию в:
- `v_club_members_enriched.has_active_access`
- RPC для диагностики
- Cron-функции (через SQL, где применимо)

---

## ФАЗА 7: Синхронизация cron/автокик

### Обязательный reason-лог для каждого действия cron:

| Reason | Описание |
|--------|----------|
| `skipped_admin` | Пропущен: администратор |
| `skipped_valid_access` | Пропущен: есть валидный доступ |
| `kicked_violator` | Кикнут: нарушитель без доступа |
| `marked_removed` | Помечен как удалённый |

### `telegram-check-expired`:
- Синхронизировать с `_shared/accessValidation.ts`
- Явный skip для админов с reason `skipped_admin`
- Убрать дефектный инкремент/декремент счётчиков

### `telegram-kick-violators`:
- Использовать `hasValidAccessBatch` для определения нарушителей
- Принудительно исключать админов с reason `skipped_admin`
- Логировать каждое действие с reason

### `telegram-club-members` (actions kick/kick_present/mark_removed):
- Не допускать попадания админов в `removed`-состояние при массовых действиях

---

## Порядок внедрения

1. **ФАЗА 0 — Диагностика**: root-cause UPDATE subscription + полная цепочка до DM
2. **ФАЗА 1 — SQL-trigger**: guard с whitelist полей + expired + revoke race (остановить ложную выдачу)
3. **ФАЗА 2 — Backend guards**: `telegram-process-access-queue` + `telegram-grant-access` (второй барьер)
4. **ФАЗА 3 — UI revoke flow**: `EditSubscriptionDialog` и все точки (третий барьер)
5. **ФАЗА 4 — Аудит**: reason_code, trigger_type, decision
6. **ФАЗА 5 — UI бейджи**: backend truth wins, anti-contradiction guards
7. **ФАЗА 6 — SQL-функция**: `has_valid_access_for_club` + view
8. **ФАЗА 7 — Cron sync**: автокик с единой валидацией и reason-логом

---

## DoD (Definition of Done)

### 1. Негативный E2E-сценарий «revoke → НЕ должно прийти сообщение о выдаче» (обязательный отдельный)

1. Вручную отозвать доступ из карточки контакта/подписки
2. Backend возвращает `{success: true}` (не blocked)
3. `telegram_access.state_* = 'revoked'`
4. Бот **НЕ** отправляет DM "Доступ открыт" / invite-ссылку
5. `telegram_logs` **НЕ** содержит AUTO_GRANT после revoke
6. `telegram_access_queue` **НЕ** содержит нового grant item после revoke без основания
7. `audit_logs` содержит `reason_code` для каждого события

### 2. Негативный сценарий Рыштаковой (обязательный SQL-пруф по временной линии)

Приложить по одной временной линии:
- запись revoke в `telegram_access` (state_chat, updated_at)
- отсутствие нового валидного grant item в `telegram_access_queue` после revoke
- отсутствие AUTO_GRANT / invite DM в `telegram_logs` после revoke
- итоговый статус пользователя в `v_club_members_enriched`
- состояние `telegram_access`, `telegram_access_queue`, `telegram_logs`, `audit_logs` по одной timeline

### 3. Негативный тест «технический UPDATE подписки»

1. Обновить поле, **не влияющее** на доступ (например, `notes`)
2. Queue item на grant **НЕ создаётся**
3. DM **НЕ отправляется**
4. Подтвердить SQL-запросом к `telegram_access_queue`

### 4. SQL-пруф по очереди

- Queue item created / skipped / processed — с reason
- Отсутствие нового grant item после revoke без основания
- Каждый processed item имеет `reason_code` и `decision`

### 5. Статусы в UI соответствуют backend

- Плашки "С доступом" / "Без доступа" совпадают с `hasValidAccess`
- Вкладка "Удалённые" не содержит админов
- Anti-contradiction: нет одновременных `removed + has_active_access`, `violator + admin`, `with_access + revoked`, `removed + in_chat`, `violator + has_valid_access`

### 6. Очередь не выдаёт доступ после revoke

- Queue processor пропускает item для revoked пользователя с `status=skipped, reason=no_valid_access` или `reason=recent_revoke`
- SQL-trigger не вставляет grant при технических UPDATE (whitelist полей)

### 7. Аудит-лог полный

- Каждое Telegram-сообщение о доступе имеет запись с:
  - `source_function`, `reason_code`, `trigger_type`, `decision`
  - `user_id`, `club_id`, `source_entity`, `source_entity_id`

### 8. Правила статусов после фикса

- Нет валидного доступа + в чате/канале → `violator`
- После успешного кика/бана → `removed`, `in_chat/in_channel=false`
- Админы: не кикаются автологикой, не в "Нарушители", не в "Удалённые", всегда в "Админы"
- Cron логирует reason для каждого действия (`skipped_admin`, `skipped_valid_access`, `kicked_violator`, `marked_removed`)

---

## Файлы с изменениями

| Файл | Действие |
|------|----------|
| SQL trigger `subscription_grant_telegram` | Миграция: whitelist полей + guard expired + guard revoke race |
| SQL function `has_valid_access_for_club` | Миграция: новая функция — единый SoT для SQL-слоя |
| SQL view `v_club_members_enriched` | Миграция: использовать `has_valid_access_for_club` |
| `supabase/functions/telegram-process-access-queue/index.ts` | Guard: hasValidAccess + revoke race check |
| `supabase/functions/telegram-grant-access/index.ts` | Guard: revoked state + hasValidAccess + race protection + аудит |
| `src/components/admin/EditSubscriptionDialog.tsx` | Убрать прямой update telegram_access, передать is_manual, проверять blocked |
| Все UI-точки revoke (Contact, Deal, Member, Bulk) | Backend truth wins, нет локальных update |
| `src/pages/admin/TelegramClubMembers.tsx` | Backend truth wins для бейджей, anti-contradiction guards |
| `supabase/functions/telegram-check-expired/index.ts` | Единая валидация, admin-guard, reason-лог |
| `supabase/functions/telegram-kick-violators/index.ts` | hasValidAccessBatch, admin-guard, reason-лог |
| Все outbound notification flows | reason_code, trigger_type, decision в audit |

## Что НЕ меняем

- Схему `_shared/accessValidation.ts` — используем as-is (единый SoT для edge functions)
- Основную логику подписок/оплат
- Telegram Bot API интеграцию
- Структуру таблиц (только view + trigger + новая SQL-функция)
