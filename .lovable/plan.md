# PATCH TG-REVOKE-FALSE-REGRANT + TG-SUBSCRIPTION-SAVE-FALSE-GRANT / TG-CLUB-LINKAGE-INTEGRITY

## Инвариант (главное правило патча)

> **После revoke никакой auto-grant, DM с новой выдачей и queue-grant без нового доказуемого основания быть не должно.**
> Revoke сильнее grant. Если revoke и grant пересеклись по времени — grant блокируется, пока не появится новое валидное основание после revoke (новая оплата, новый entitlement, manual regrant admin).

> **Save ≠ Grant.** Обычное сохранение карточки подписки/сделки/доступа НЕ является основанием для выдачи Telegram-доступа.
> Grant допустим ТОЛЬКО при новом валидном основании:
> - новая оплата
> - новая активная подписка (реальный переход статуса)
> - ручная осознанная выдача админом
> - валидный regrant по бизнес-логике

> **Club ↔ Product integrity.** Доступ в клуб выдаётся ТОЛЬКО если источник доступа (subscription/deal/order) относится именно к продукту, замапленному на этот клуб. Cross-product / cross-club выдача запрещена.

---

## STOP-GUARD (глобальный)

1. **До завершения ФАЗ 0–3 НЕ запускать** массовые revoke/kick/regrant операции по клубу — иначе снова нагенерируются ложные grant и уведомления.
2. **До завершения ФАЗ 1.5–2.6 НЕ запускать** массовые revoke/regrant/kick по клубу «Бухгалтерия как бизнес» (БкБ) — пока не доказано, что Save не создаёт ложный grant и club linkage корректен.
3. **НЕ выполнять** ручные «исправления статусов» напрямую в БД без объяснимого audit trail.
4. **Порядок**: сначала остановить ложную выдачу на системном уровне (trigger + backend guards + Save≠Grant), потом чистить интерфейс.

---

## Доказанные баги

### БАГ 1: Ложный auto-grant после revoke (TG-REVOKE-FALSE-REGRANT)

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

### БАГ 2: Save в карточке подписки создаёт ложный grant (TG-SUBSCRIPTION-SAVE-FALSE-GRANT)

**Воспроизводимый вручную:**

```text
1. Открыть EditSubscriptionDialog
2. Нажать «Сохранить» без фактической необходимости менять доступ
3. updateMutation отправляет UPDATE subscriptions_v2 со ВСЕМИ полями
   (status, access_end_at, tariff_id, product_id — даже если не менялись)
4. JavaScript toISOString() может дать отличие от DB-значения
   (точность микросекунд, timezone) → IS DISTINCT FROM = true
   → whitelist guard пропускает → trigger ставит grant в очередь
5. Строки 280-283: Save НАПРЯМУЮ пишет telegram_access.active_until — прямой UI→DB write, минуя backend
6. grantTelegramAccess (строки 341-348) НАПРЯМУЮ пишет state_chat='granted', state_channel='granted' — минуя backend
```

**Сценарий Revoke → Save:**
```text
1. Revoke ставит state_chat='revoked' (через backend, корректно)
2. Save обновляет subscriptions_v2 → trigger срабатывает
3. Queue item 'grant' создаётся → доступ выдаётся заново
4. Revoke фактически ломается
```

### БАГ 3: Cross-product / cross-club false grant (TG-CLUB-LINKAGE-INTEGRITY)

**Риск:** при Save карточки подписки по одному продукту доступ может выдаться по логике другого продукта / другого периода / другого клуба. Нет проверки, что subscription.product_id → product_club_mappings → club_id совпадает с запрашиваемым club_id в grant.

---

## Корневые дефекты (сводка)

1. UI (`EditSubscriptionDialog`) не передаёт `is_manual: true` → revoke блокируется автогардом
2. UI игнорирует `{blocked: true}` от backend и форсит локальный state
3. UI `updateMutation` отправляет ВСЕ поля → trigger срабатывает на техническом пересохранении
4. UI напрямую пишет в `telegram_access` (active_until, state_chat, state_channel) — минуя backend
5. SQL-триггер `subscription_grant_telegram` слепо ставит grant в очередь при любом UPDATE, не проверяя бизнес-смысл
6. `telegram-grant-access` и `telegram-process-access-queue` не проверяют club↔product соответствие
7. Нет guard на cross-product/cross-club выдачу

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

### 0.2 Что именно сделал UI при Save

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

-- Guard 4 (NEW): бизнес-смысл — не ставить grant если статус не перешёл
-- в реально активное состояние и срок не продлён вперёд
IF TG_OP = 'UPDATE' THEN
  IF OLD.status = NEW.status
     AND (OLD.access_end_at IS NOT DISTINCT FROM NEW.access_end_at
          OR NEW.access_end_at <= OLD.access_end_at)
     AND OLD.tariff_id IS NOT DISTINCT FROM NEW.tariff_id
     AND OLD.product_id IS NOT DISTINCT FROM NEW.product_id
  THEN
    RETURN NEW; -- пересохранение без бизнес-изменения
  END IF;
END IF;
```

---

## ФАЗА 1.5 (NEW): Диагностика Save-flow

**Цель:** доказуемо установить, что именно меняет Save и почему это приводит к ложному grant.

### Что нужно доказать:

1. Какие поля в `subscriptions_v2` меняются при **обычном Save** (без изменений в форме)
2. Какие поля меняются после сценария **Revoke → Save**
3. Какой именно UPDATE снова активирует `subscription_grant_telegram`
4. Не меняются ли при Save поля `status`, `access_end_at`, `tariff_id`, `product_id` — или меняются из-за serialization mismatch (toISOString vs DB format)

### Методы диагностики:

1. **Код `EditSubscriptionDialog.tsx`**: точный diff updateMutation — какие поля отправляются
2. **SQL diff before/after**: запрос `subscriptions_v2` до и после Save для конкретной записи
3. **`telegram_access_queue`**: появился ли новый queue item после Save
4. **`audit_logs`**: запись с trigger_type / source_function

### DoD фазы:

- [ ] SQL diff before/after Save по записи подписки
- [ ] Proof, какой UPDATE создал queue item
- [ ] Proof, какие поля реально изменились, а какие были пересохранены без смысла
- [ ] Proof из кода, какие поля передаются в updateMutation

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

## ФАЗА 2.5 (NEW): Save ≠ Grant — исправление `EditSubscriptionDialog.tsx`

### Жёсткое правило:

> Обычное сохранение карточки подписки НЕ равно grant. Если пользователь не изменил ни одного поля — UPDATE не должен отправляться вообще.

### Конкретные изменения в `EditSubscriptionDialog.tsx`:

#### 1. Diff-only UPDATE в `updateMutation`:

```typescript
const changes: Record<string, any> = {};
if (formData.status !== subscription.status) changes.status = formData.status;
if (formData.access_end_at !== subscription.access_end_at) changes.access_end_at = formData.access_end_at;
if (formData.tariff_id !== subscription.tariff_id) changes.tariff_id = formData.tariff_id;
if (formData.product_id !== subscription.product_id) changes.product_id = formData.product_id;
// ... другие поля

if (Object.keys(changes).length === 0) {
  toast.info("Нет изменений");
  return;
}
// Только тогда: await supabase.from('subscriptions_v2').update(changes).eq('id', ...)
```

#### 2. Убрать прямой write `telegram_access.active_until` (строки 280-283):

Если нужно синхронизировать active_until — делать через backend (edge function или trigger), не из UI напрямую.

#### 3. Убрать прямой write `state_chat/state_channel='granted'` (строки 341-348 в `grantTelegramAccess`):

Вызывать только `telegram-grant-access` edge function. UI не должен напрямую менять state в telegram_access.

#### 4. After Save — НЕ должен:
- ставить queue item grant
- вызывать telegram-grant-access
- отправлять DM
- менять telegram_access в сторону выдачи

---

## ФАЗА 2.6 (NEW): Club-product linkage integrity

### Guard соответствия club ↔ product при grant:

В `telegram-grant-access` и `telegram-process-access-queue` перед выдачей доступа проверить:

```text
subscription.product_id → product_club_mappings → club_id
                                                    ↓
                                              совпадает с запрашиваемым club_id?
```

**Если несоответствие → блокировать grant с reason:**
- `club_product_mismatch` — product не замаплен на этот клуб
- `tariff_product_mismatch` — tariff принадлежит другому product
- `source_not_entitled_for_club` — источник доступа не относится к данному клубу

### Обязательная проверка полной цепочки для БкБ:

```text
product → tariff → offer/button → deal/order → subscription → product_club_mapping → telegram_access_queue → telegram_access
```

**Правило:** Доступ в БкБ получает ТОЛЬКО тот, кто оплатил именно БкБ. Не "похожий продукт", не другой клуб, не чужой тариф.

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

## ФАЗА 3.5 (NEW): Все точки Save — проверить на скрытый regrant

### Проверить ВСЕ точки, где есть Save subscription / Save deal / Save access:

| Компонент | Что проверить |
|-----------|---------------|
| `EditSubscriptionDialog` | Save не запускает скрытый regrant через побочный UPDATE |
| `EditDealDialog` | Save не запускает скрытый regrant через побочный UPDATE |
| `DealDetailSheet` | Save не запускает скрытый regrant через побочный UPDATE |
| `AdminDeals` | Save не запускает скрытый regrant через побочный UPDATE |
| `ContactDetailSheet` | manual access actions не запускают побочный grant |

**Правило:** нигде Save не запускает скрытый regrant по побочному UPDATE.

### DoD фазы:

- [ ] Для каждого компонента: proof, что Save не создаёт queue item grant
- [ ] Для каждого компонента: proof, что Save не пишет напрямую в telegram_access

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
| `club_product_mismatch` | Grant заблокирован: product не замаплен на клуб |
| `tariff_product_mismatch` | Grant заблокирован: tariff принадлежит другому product |
| `source_not_entitled_for_club` | Grant заблокирован: источник не относится к клубу |
| `save_no_change` | Save без изменений — grant не запущен |

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
2. **ФАЗА 1 — SQL-trigger**: guard с whitelist полей + expired + revoke race + бизнес-смысл (остановить ложную выдачу)
3. **ФАЗА 1.5 — Диагностика Save-flow**: SQL diff before/after Save, proof какой UPDATE создал queue item
4. **ФАЗА 2 — Backend guards**: `telegram-process-access-queue` + `telegram-grant-access` (второй барьер)
5. **ФАЗА 2.5 — Save ≠ Grant**: diff-only UPDATE в EditSubscriptionDialog, убрать прямые writes telegram_access
6. **ФАЗА 2.6 — Club-product linkage**: guard соответствия club↔product↔tariff при grant
7. **ФАЗА 3 — UI revoke flow**: `EditSubscriptionDialog` и все точки (третий барьер)
8. **ФАЗА 3.5 — Все точки Save**: проверить EditDeal, DealDetail, AdminDeals, ContactDetail на скрытый regrant
9. **ФАЗА 4 — Аудит**: reason_code, trigger_type, decision
10. **ФАЗА 5 — UI бейджи**: backend truth wins, anti-contradiction guards
11. **ФАЗА 6 — SQL-функция**: `has_valid_access_for_club` + view
12. **ФАЗА 7 — Cron sync**: автокик с единой валидацией и reason-логом

---

## DoD (Definition of Done)

### 1. Негативный E2E: Save без изменения основания доступа

1. Открыть карточку подписки БкБ
2. Нажать Save без изменения основания доступа
3. Проверить:
   - [ ] Queue item grant **НЕ создан**
   - [ ] AUTO_GRANT **нет**
   - [ ] DM **не ушёл**
   - [ ] `telegram_access` **не стал активным**
   - [ ] UI **не показывает новый доступ**

### 2. Негативный E2E: Revoke → Save

1. Отозвать доступ (Revoke)
2. Сохранить карточку (Save)
3. Проверить:
   - [ ] Отзыв **остаётся в силе**
   - [ ] Новый grant **не создаётся**
   - [ ] Invite link **не отправляется**
   - [ ] AUTO_GRANT **отсутствует**
   - [ ] Queue **не создаёт/не обрабатывает ложный grant**

### 3. Позитивный E2E для БкБ (3 сценария)

1. Валидная оплата БкБ → доступ выдан ✓
2. Save без оплаты → доступ **НЕ выдан** ✓
3. Подписка/сделка другого продукта → доступ в БкБ **НЕ выдан** ✓

Для каждого приложить: SQL-пруф источника, queue item, telegram_logs, audit_logs, скрин карточки.

### 4. Негативный E2E: revoke → НЕ должно прийти сообщение о выдаче

1. Вручную отозвать доступ из карточки контакта/подписки
2. Backend возвращает `{success: true}` (не blocked)
3. `telegram_access.state_* = 'revoked'`
4. Бот **НЕ** отправляет DM "Доступ открыт" / invite-ссылку
5. `telegram_logs` **НЕ** содержит AUTO_GRANT после revoke
6. `telegram_access_queue` **НЕ** содержит нового grant item после revoke без основания
7. `audit_logs` содержит `reason_code` для каждого события

### 5. Негативный тест: технический UPDATE подписки

1. Обновить поле, **не влияющее** на доступ (например, `notes`)
2. Queue item на grant **НЕ создаётся**
3. DM **НЕ отправляется**
4. Подтвердить SQL-запросом к `telegram_access_queue`

### 6. Club-product linkage integrity

- [ ] Доступ в БкБ получают только пользователи с валидной оплатой **именно БкБ**
- [ ] Нет cross-product/cross-club выдачи
- [ ] `product_club_mappings` корректно связывает product и club
- [ ] Guard `club_product_mismatch` блокирует ложные grant
- [ ] Приложена полная цепочка: product → tariff → offer → deal → subscription → mapping → queue → access

### 7. SQL-пруф по очереди

- Queue item created / skipped / processed — с reason
- Отсутствие нового grant item после revoke без основания
- Каждый processed item имеет `reason_code` и `decision`

### 8. Статусы в UI соответствуют backend

- Плашки "С доступом" / "Без доступа" совпадают с `hasValidAccess`
- Вкладка "Удалённые" не содержит админов
- Anti-contradiction: нет одновременных `removed + has_active_access`, `violator + admin`, `with_access + revoked`, `removed + in_chat`, `violator + has_valid_access`

### 9. Очередь не выдаёт доступ после revoke

- Queue processor пропускает item для revoked пользователя с `status=skipped, reason=no_valid_access` или `reason=recent_revoke`
- SQL-trigger не вставляет grant при технических UPDATE (whitelist полей)

### 10. Аудит-лог полный

- Каждое Telegram-сообщение о доступе имеет запись с:
  - `source_function`, `reason_code`, `trigger_type`, `decision`
  - `user_id`, `club_id`, `source_entity`, `source_entity_id`

### 11. Правила статусов после фикса

- Нет валидного доступа + в чате/канале → `violator`
- После успешного кика/бана → `removed`, `in_chat/in_channel=false`
- Админы: не кикаются автологикой, не в "Нарушители", не в "Удалённые", всегда в "Админы"
- Cron логирует reason для каждого действия (`skipped_admin`, `skipped_valid_access`, `kicked_violator`, `marked_removed`)

### 12. Нет ложной выдачи (сводка)

- [ ] Нет ложной выдачи после Save
- [ ] Нет ложной выдачи после Revoke → Save
- [ ] Нет cross-product/cross-club grant
- [ ] Доступ БкБ выдаётся только по валидной оплате БкБ
- [ ] Приложены SQL-пруфы, queue items, telegram_logs, audit_logs и скрины UI

---

## Файлы с изменениями

| Файл | Действие |
|------|----------|
| SQL trigger `subscription_grant_telegram` | Миграция: whitelist полей + guard expired + guard revoke race + guard бизнес-смысл |
| SQL function `has_valid_access_for_club` | Миграция: новая функция — единый SoT для SQL-слоя |
| SQL view `v_club_members_enriched` | Миграция: использовать `has_valid_access_for_club` |
| `supabase/functions/telegram-process-access-queue/index.ts` | Guard: hasValidAccess + revoke race check + club-product linkage |
| `supabase/functions/telegram-grant-access/index.ts` | Guard: revoked state + hasValidAccess + race protection + club-product linkage + аудит |
| `src/components/admin/EditSubscriptionDialog.tsx` | Diff-only UPDATE, убрать прямые writes telegram_access (строки 280-283, 341-348), передать is_manual, проверять blocked |
| `src/components/admin/EditDealDialog.tsx` | Проверить Save на побочные grant, добавить is_manual + admin_id |
| `src/components/admin/DealDetailSheet.tsx` | Проверить Save на побочные grant, добавить is_manual + admin_id |
| `src/components/admin/AdminDeals.tsx` | Проверить Save на побочные grant, добавить is_manual + admin_id |
| `src/components/admin/ContactDetailSheet.tsx` | Проверить manual access actions на побочный grant |
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
