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

> **Architectural gate.** ФАЗЫ 8–10 НЕ переходят в execute-режим, пока не завершены 11A и 11B. Если при 11A найден хоть один club-specific branch или hardcoded path — STOP, сначала закрыть 11B.

> **Club SoT chain.** `club_id` + `telegram_clubs` + `product_club_mappings` = единственный SoT клубной логики. Все derived flags (`in_any`, `has_active_access`, `is_bought_not_joined`, `is_violator`, `removed-visible`, counters, quick stats, restore eligibility) считаются ТОЛЬКО от этого SoT. Client-side reinterpretations backend-флагов запрещены.

> **Club-as-SoT.** `club_id` — единственный ключ всей клубной логики. Не допускается отдельных реализаций для разных клубов. Один движок, одна логика меню/статистики/вкладок/участников/доступов/уведомлений. Различия — только через `club_id` и `club_config`.

> **Club-specific code запрещён.** Запрещены:
> - `if`/`switch`/`branch` по названию клуба
> - Hardcoded club UUID или name в логике (SQL, RPC, edge functions, UI)
> - Отдельные RPC/SQL/view/cron под конкретный клуб
> - Разрешена ТОЛЬКО параметризация по `club_id` и config клуба

> **Per-club isolation.** Запрещено использовать "общий telegram presence" пользователя. Только chat/channel states именно этого `club_id`. Если пользователь состоит в чате клуба A, это не влияет на его статус в клубе B.

> **No club_id → no send.** Любая outbound Telegram action (DM, invite link, notification) без валидного `club_id` блокируется на уровне edge function. Отсутствие `club_id` = ошибка, не fallback.

> **БкБ — P0.** Сначала довести БкБ до полной консистентности (все фазы, все proofs). Затем GC проходит через **тот же code path** без отдельной логики. Если GC требует отдельной ветки — это дефект.

---

## Club Config как authoritative source

Единый конфиг клуба (из таблицы `telegram_clubs`) — единственный источник ресурсной конфигурации:

```text
club_config = {
  club_id,
  telegram_chat_id,       -- может быть NULL
  telegram_channel_id,    -- может быть NULL
  has_chat: telegram_chat_id IS NOT NULL,
  has_channel: telegram_channel_id IS NOT NULL,
  product_ids: (из product_club_mappings)
}
```

Вся логика `in_any`, `not_joined`, `violators`, `removed`, counters и UI строится от этого конфига. `has_chat`/`has_channel` — computed поля, не хранятся отдельно.

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

- Собрать логи queue items, telegram_logs, audit_logs для подозрительных случаев
- Проверить, что UI форсит локальный state при revoke
- Проверить SQL-триггер subscription_grant_telegram на whitelist полей
- Проверить, что Save вызывает grant без изменения основания
- Проверить, что нет проверки club-product linkage в edge functions
- Составить список всех мест с hardcoded club UUID/name

---

## ФАЗА 1: SQL-триггер `subscription_grant_telegram` — корень ложного auto-grant

- Добавить whitelist полей, при изменении которых триггер срабатывает
- Добавить guard на expired подписки
- Добавить guard на race condition с revoke (проверять состояние revoke)
- Добавить guard на бизнес-смысл (только при реальном изменении основания)
- Логировать reason_code в audit_logs

---

## ФАЗА 1.5 (NEW): Диагностика Save-flow

- Проверить все UI-точки Save (EditSubscriptionDialog, EditDealDialog, DealDetailSheet, AdminDeals)
- Проверить, что updateMutation отправляет все поля
- Проверить, что UI напрямую пишет telegram_access (active_until, state_chat, state_channel)
- Проверить, что Save не передаёт is_manual/admin_id

---

## ФАЗА 2: Backend guards — единая централизованная проверка доступа

- В `telegram-grant-access` и `telegram-process-access-queue` добавить проверку:
  - Проверять, что нет активного revoke
  - Проверять, что subscription.product_id соответствует club_id через product_club_mappings
  - Проверять, что grant создаётся только при валидном основании
- Логировать все решения с reason_code, trigger_type, decision

---

## ФАЗА 2.5 (NEW): Save ≠ Grant — исправление `EditSubscriptionDialog.tsx`

- Убрать прямые update telegram_access из UI
- Передавать `is_manual: true` и `admin_id` при revoke/grant
- Обрабатывать ответ backend, если `blocked: true` — не менять локальный state, показывать toast.warning
- Все UI-точки revoke и grant должны следовать этому правилу

---

## ФАЗА 2.6 (NEW): Club-product linkage integrity

- В edge functions и backend guards добавить проверку, что subscription.product_id → product_club_mappings → club_id совпадает с запрашиваемым club_id
- Блокировать grant/revoke, если linkage не совпадает
- Логировать reason_code `club_product_mismatch`

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

- Проверить, что Save не вызывает grant без изменения основания
- Проверить, что UI не пишет напрямую в telegram_access
- Проверить, что queue items не создаются без основания
- Проверить, что нет ложных DM/уведомлений после Save

---

## ФАЗА 4: Аудит причины отправки Telegram-сообщений

- В audit_logs добавить поля:
  - `source_function`
  - `reason_code`
  - `trigger_type`
  - `decision`
  - `user_id`
  - `club_id`
  - `source_entity`
  - `source_entity_id`
- Логировать все события grant/revoke/auto-grant/kick с подробностями

---

## ФАЗА 5: UI — backend truth wins

- UI не должен переопределять статусы вручную
- Все counters, badges, tabs должны отображать данные из backend payload
- UI должен обрабатывать `blocked` и ошибки backend корректно
- UI не должен делать локальные update telegram_access

---

## ФАЗА 6: SQL-функция `has_valid_access_for_club` + обновление `v_club_members_enriched`

- Создать функцию `has_valid_access_for_club(user_id, club_id)` — единый SoT для SQL-слоя
- Обновить view `v_club_members_enriched`:
  - Использовать `has_valid_access_for_club`
  - Добавить conditional `in_any` на основе ресурсов клуба (chat-only, channel-only, chat+channel)
  - Отделить админов от обычных участников
  - Добавить флаги `is_bought_not_joined`, `is_violator`, `removed_visible`
- Обновить RPC `get_club_members_enriched` и `get_club_business_stats` для использования нового view и функции

---

## ФАЗА 7: Синхронизация cron/автокик

- Использовать `hasValidAccessBatch` из `_shared/accessValidation.ts` для проверки доступа
- Убрать локальные проверки доступа в cron, использовать единую функцию
- Добавить guard на админов (не кикать)
- Логировать все действия с reason_code
- Обновить edge function `telegram-cron-sync` согласно новым правилам

---

## ═══════════════════════════════════════════
## АРХИТЕКТУРНЫЙ GATE: ФАЗЫ 11A → 11B → 8 → 9 → 10
## ═══════════════════════════════════════════

> **GATE RULE:** ФАЗЫ 8–10 НЕ переходят в execute-режим, пока 11A и 11B не завершены.
> Если найден хоть один club-specific branch / hardcoded path → STOP, сначала закрыть 11B.

---

## ФАЗА 11A: Dry-run аудит расслоения БкБ / GC

### 11A.1 Обязательный отчёт-таблица

| Область | БкБ использует | GC использует | Общее / Раздельное |
|---------|---------------|--------------|-------------------|
| Page route | ? | ? | ? |
| RPC `get_club_members_enriched` | ? | ? | ? |
| RPC `get_club_business_stats` | ? | ? | ? |
| View `v_club_members_enriched` | ? | ? | ? |
| Edge function `telegram-grant-access` | ? | ? | ? |
| Edge function `telegram-revoke-access` | ? | ? | ? |
| Edge function `telegram-club-members` | ? | ? | ? |
| Edge function `telegram-kick-violators` | ? | ? | ? |
| Edge function `telegram-cron-sync` | ? | ? | ? |
| UI `TelegramClubMembers.tsx` | ? | ? | ? |
| UI `ClubQuickStats.tsx` | ? | ? | ? |
| UI member filters / tabs | ? | ? | ? |
| `useClubMemberStats` hook | ? | ? | ? |
| `useClubBusinessStats` hook | ? | ? | ? |
| Quick stats source | ? | ? | ? |
| Tabs/filter source | ? | ? | ? |
| Drawers/details/actions | ? | ? | ? |
| Restore/regrant flows | ? | ? | ? |
| Hardcoded club names / IDs | ? | ? | ? |

### 11A.2 Обязательный grep/scan proof

- `grep -rn` по repo на все club UUID (из `telegram_clubs.id`)
- `grep -rn` по repo на club names ("Бухгалтерия как бизнес", "Gorbova Club", "БкБ", "GC")
- Scope: `*.tsx`, `*.ts` (UI/hooks), `*.sql` (RPC/views/triggers), edge functions
- Результат: таблица найденных мест + статус (устранено / не применимо / дефект)
- DoD: **0 hardcoded club branches in production logic** (исключение: display-only labels, test fixtures)

### 11A.3 Flow mapping per club

Для каждого клуба (БкБ, GC) составить mapping:

```text
экран → hook → query key → RPC/view → edge actions → quick stats source → tab source
```

Цель: доказать, что оба клуба проходят через один и тот же flow, или зафиксировать расхождения как дефекты.

### 11A.4 Dry-run: два разных меню / две разных статистики

Сравнительная таблица для БкБ и GC:

| Аспект | БкБ | GC | Совпадает? |
|--------|-----|-----|-----------|
| Page route | ? | ? | ? |
| Hooks | ? | ? | ? |
| Quick stats source (RPC/hook) | ? | ? | ? |
| Tabs/filter source | ? | ? | ? |
| Drawers/details/actions | ? | ? | ? |
| Restore/regrant flows | ? | ? | ? |
| `invalidateQueries` / query keys | ? | ? | ? |

DoD: proof, что после 11B это один и тот же UI-flow.

**DoD ФАЗЫ 11A:** отчёт с пруфами — что общее, что реализовано двумя путями. Если найдены club-specific ветки — зафиксировать как дефект.

---

## ФАЗА 11B: Устранение club-specific code paths

Для каждого расхождения, найденного в 11A:
- Убрать club-specific код
- Параметризировать по `club_id`
- Убедиться, что БкБ и GC проходят через идентичный code path

### `club_id` как главный ключ

Все нижеследующие сущности строго по `club_id`:
- member state (`telegram_club_members`)
- access state (`telegram_access`, `telegram_access_grants`)
- Telegram resources (`chat_id`, `channel_id` из `telegram_clubs`)
- queue / grants / revoke (`telegram_access_queue`)
- counters / tabs / quick stats
- notifications / invite links

**DoD ФАЗЫ 11B:** proof, что после фикса это один и тот же code path для БкБ и GC (same RPC, same counters logic, same tabs logic, same member state logic, same access flow, no hardcoded club UUIDs).

---

## ФАЗА 8: Single SoT для tabs/counters/quick stats

### Один backend payload для всего экрана

> Tab counters и upper stats (ClubQuickStats) считаются из **одного backend-запроса** (один payload). Два разных вычисления "по одинаковой логике" запрещены — это источник дрейфа.

Payload содержит:
- `members[]` — полный список с derived flags
- `in_club_regular`, `in_club_admins`, `in_club_total`
- `with_access_regular`, `with_access_total`
- `removed_count`
- `bought_not_joined_count`
- `violators_count`
- `resource_mode`: `'chat-only' | 'channel-only' | 'chat+channel'`

UI **только отображает**, не re-interprets.

### Формат "В клубе" — backend-driven

Backend (RPC) возвращает:
```typescript
{
  in_club_regular: number,
  in_club_admins: number,
  in_club_total: number,
  with_access_regular: number,
  with_access_total: number,
}
```
UI показывает: `"26 (+4 админа) = 30"`. Работает по **любому** клубу, не только БкБ.

### 8.5 Removed flow (усиленный)

- Removed members **обязаны** возвращаться из RPC даже при `in_any=false`
- Restore работает строго по `club_id`
- Restore **не создаёт grant без valid source** (restore ≠ grant)
- Restore **не трогает другие клубы пользователя**
- Removed history **сохраняется** (не удаляется при restore)
- После restore member уходит из removed и появляется **только в допустимой вкладке**
- Removed counter **всегда** равен длине списка removed tab

### "Не вошли" (усиленное правило)

```text
is_bought_not_joined =
  has_valid_access_for_club(user_id, club_id) = TRUE
  AND user physically absent from Telegram resources of THIS club
  AND (for chat-only clubs: only in_chat matters, stale in_channel IGNORED)
```

Users without valid access **CANNOT** appear in "Не вошли". Anti-contradiction guard в SQL и UI.

---

## ФАЗА 9: Club-Telegram resource integrity

### Club resources authoritative (3 режима)

Для каждого клуба поддерживается один из трёх режимов:
- **chat-only** (`telegram_channel_id IS NULL`)
- **channel-only** (`telegram_chat_id IS NULL`)
- **chat+channel** (оба заполнены)

```sql
CASE
  WHEN club.telegram_channel_id IS NULL THEN v.in_chat
  WHEN club.telegram_chat_id IS NULL THEN v.in_channel
  ELSE (v.in_chat OR v.in_channel)
END AS in_any
```

Stale `in_channel` **обязан** игнорироваться для chat-only клубов.

### 9.x Resource-mode aware UI

- **chat-only**: не показывать channel icons/status/wording в таблице и карточках
- **channel-only**: не показывать chat wording
- **chat+channel**: показывать оба
- `resource_mode` приходит из backend payload, UI рендерит колонки/иконки условно

### 9.y Stale-resource-state guard

- Stale `in_channel=true` для chat-only клуба: попадает в dry-run report, **не участвует** в flags/counters/UI
- Stale `in_chat=true` для channel-only клуба: аналогично
- SQL/RPC уровень: conditional `in_any` автоматически исключает stale states
- Stale states не участвуют в `not_joined`, `removed`, quick stats

### Admin presentation rule

| Правило | Реализация |
|---------|-----------|
| Админ всегда с бейджем «Администратор» | `getAccessStatusBadge` |
| Админ никогда не «Удалён» | filter в `removed` tab: `&& !isAdmin` |
| Админ никогда не «Без доступа» | исключить из `no_access` статуса |
| Админ исключён из regular member counters | `in_club_regular` = `in_any && !isAdmin` |
| Админ исключён из removed / violators tabs | filter guards |

---

## ФАЗА 10: Data diagnostic + repair

### 10.1 Dry-run диагностика

Все repair-запросы выполнять отдельно для БкБ и GC.

### 10.2 Repair SQL (примеры)

```sql
-- Clear false in_channel for chat-only clubs
UPDATE telegram_club_members SET in_channel = NULL
WHERE club_id IN (SELECT id FROM telegram_clubs WHERE telegram_channel_id IS NULL)
AND in_channel = true;

-- Remove admins from 'removed' status
UPDATE telegram_club_members SET access_status = 'ok'
WHERE telegram_user_id IN (SELECT telegram_user_id FROM telegram_club_admins WHERE club_id = ?)
AND access_status = 'removed' AND club_id = ?;
```

### 10.3 Жёсткий protocol для repair execute

```text
1. Counts/rows preview (dry-run SQL → SELECT COUNT / SELECT *)
2. Snapshot affected rows (SELECT * для rollback)
3. Approval (явное подтверждение)
4. Execute (UPDATE/DELETE)
5. Post-check SQL snapshot (те же SELECT после execute)
6. UI proof (скриншоты)
```

STOP-guard: без approval ничего не execute.

### 10.x Rollback-safety protocol

1. **Snapshot** affected rows before execute
2. **Repair log** с old values (в `audit_logs` с `action: 'data_repair'`)
3. **Возможность rollback** конкретного repair patch (через saved old values)

### 10.4 Cross-club contamination diagnostic

Отдельно искать:
- Один и тот же `telegram_user_id` с конфликтными статусами по двум клубам
- `telegram_access` на клуб, для которого нет валидного source
- `telegram_club_members` записи, противоречащие resources конкретного клуба
- Уведомления/DM/invite links, отправленные не тому `club_id`
- Invite link создан по одному `club_id`, а записан/показан в контексте другого
- `telegram_logs` / `audit_logs` / `queue items` с несогласованным `club_id`
- Сообщения, отправленные "от имени" не того клуба

### 10.5 Унификация уведомлений и invite links по club_id

- Все outbound Telegram notifications строго по `club_id`
- Invite links строго по `club_id`
- reason/source/audit строго по `club_id`
- Исключить возможность отправки уведомления клуба A по source клуба B

### 10.6 Подпакет proof для БкБ — полная цепочка

- Кто реально оплатил БкБ (SQL: `orders_v2` + `subscriptions_v2` + `products` WHERE product mapped to БкБ)
- Кто имеет доступ в БкБ (SQL: `telegram_access` WHERE `club_id` = БкБ AND active)
- Где расхождения (access есть, оплаты нет; оплата есть, access нет)
- Кто получил доступ без валидного основания
- Кто оплатил другой продукт, но попал в БкБ

---

## Порядок внедрения

```text
ФАЗА 0   — Диагностика root-cause
ФАЗА 1   — SQL-trigger guard
ФАЗА 1.5 — Диагностика Save-flow
ФАЗА 2   — Backend guards
ФАЗА 2.5 — Save ≠ Grant
ФАЗА 2.6 — Club-product linkage
ФАЗА 3   — UI revoke flow
ФАЗА 3.5 — Все точки Save
ФАЗА 4   — Аудит
ФАЗА 5   — UI бейджи (backend truth wins)
ФАЗА 6   — SQL-функция has_valid_access_for_club + view
ФАЗА 7   — Cron sync
─── АРХИТЕКТУРНЫЙ GATE ───
ФАЗА 11A — Dry-run аудит расслоения БкБ / GC
ФАЗА 11B — Устранение club-specific code paths
─── GATE RULE: ФАЗЫ 8–10 НЕ переходят в execute, пока 11A+11B не завершены ───
ФАЗА 8   — Single SoT для tabs/counters/quick stats
ФАЗА 9   — Club-Telegram resource integrity
ФАЗА 10  — Data diagnostic + repair
```

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

### 13. "Не вошли" tab correctness

- [ ] Users without valid access do NOT appear in "Не вошли"
- [ ] SQL proof: `is_bought_not_joined` only true when `has_valid_access_for_club = true`
- [ ] For chat-only clubs: channel state does not affect "Не вошли"

### 14. Counter consistency

- [ ] Top stats (ClubQuickStats) и tab counters считаются из **одного** backend payload
- [ ] "В клубе" shows format: "26 (+4 админа) = 30" (backend fields)
- [ ] "С доступом" matches backend truth

### 15. Admin isolation

- [ ] Admins shown with "Администратор" badge
- [ ] Admins NOT in "Удалённые" / "Нарушители"
- [ ] Admins NOT inflating regular member counters

### 16. "Удалённые" tab functional

- [ ] List populates from backend (even with `in_any=false`)
- [ ] Restore works strictly by `club_id`, no cross-club regrant
- [ ] Restore does NOT create grant without valid source
- [ ] Counter matches list length
- [ ] After restore, counters update without reload

### 17. Club-Telegram resource integrity

- [ ] For clubs without channel: no channel-state in filters/counters/UI
- [ ] No cross-club state mixing
- [ ] Proof по 3 типам: chat-only, channel-only, chat+channel

### 18. Data repair proof (per club)

- [ ] Dry-run → snapshot → approval → execute → post-check → UI proof
- [ ] Executed separately for БкБ and GC
- [ ] Rollback possible via saved old values

### 19. Club unification proof

- [ ] БкБ and GC use identical RPC/view
- [ ] БкБ and GC use identical counter/tab/filter/member state/access logic
- [ ] No hardcoded club IDs or names in code
- [ ] Diagnostic report: что было общее vs раздельное

### 20. Per-club post-fix proof (отдельно для БкБ И отдельно для GC)

Для каждого клуба независимый блок:
- [ ] SQL snapshot: regular members / admins / with_access / not_joined / removed / violators
- [ ] UI screenshots с теми же цифрами
- [ ] Counts parity (top stats = tab counts)
- [ ] Removed tab functional
- [ ] Admins isolated
- [ ] No false not_joined
- [ ] No wrong channel logic

### 20.x Consistency proof на одном срезе

- Top stats = tabs counters = list `.length` = SQL snapshot — всё на **одном timestamp**
- Один refresh → все цифры совпадают
- Не допускается "цифры совпадают если обновить дважды"

### 21. Уведомления и invite links по club_id

- [ ] Все outbound notifications строго по club_id
- [ ] Invite links строго по club_id
- [ ] Нет отправки уведомления клуба A по source клуба B

### 22. Финальный глобальный инвариант

После фикса **невозможно**, чтобы:
- [ ] Пользователь без valid access попал в "Не вошли"
- [ ] Админ попал в removed/violators
- [ ] Chat-only клуб использовал channel state
- [ ] Counters вверху и во вкладках расходились
- [ ] Клуб A влиял на клуб B
- [ ] БкБ и GC шли через разные code paths
- [ ] Removed user с `access_status='removed'` отсутствовал в removed-tab
- [ ] Save / restore / refresh меняли club isolation или resource-mode логику

### 23. Resource modes proof

- [ ] chat-only клуб: корректные flags/counters/UI (channel логика отсутствует)
- [ ] channel-only клуб: корректные flags/counters/UI (chat логика отсутствует)
- [ ] chat+channel клуб: корректные flags/counters/UI (оба присутствуют)
- Если режима нет в prod — proof через SQL simulation

---

## Файлы с изменениями

| Файл | Действие |
|------|----------|
| SQL trigger `subscription_grant_telegram` | Миграция: whitelist полей + guard expired + guard revoke race + guard бизнес-смысл |
| SQL function `has_valid_access_for_club` | Миграция: новая функция — единый SoT для SQL-слоя |
| SQL view `v_club_members_enriched` | Миграция: использовать `has_valid_access_for_club`, conditional `in_any` based on club resources |
| SQL RPC `get_club_members_enriched` | Conditional `in_any`, admin-separated counts, removed scope |
| SQL RPC `get_club_business_stats` | Align с единым SoT или объединить в один payload |
| `supabase/functions/telegram-process-access-queue/index.ts` | Guard: hasValidAccess + revoke race check + club-product linkage |
| `supabase/functions/telegram-grant-access/index.ts` | Guard: revoked state + hasValidAccess + race protection + club-product linkage + аудит |
| `src/components/admin/EditSubscriptionDialog.tsx` | Diff-only UPDATE, убрать прямые writes telegram_access, передать is_manual, проверять blocked |
| `src/components/admin/EditDealDialog.tsx` | Проверить Save на побочные grant, добавить is_manual + admin_id |
| `src/components/admin/DealDetailSheet.tsx` | Проверить Save на побочные grant, добавить is_manual + admin_id |
| `src/components/admin/AdminDeals.tsx` | Проверить Save на побочные grant, добавить is_manual + admin_id |
| `src/components/admin/ContactDetailSheet.tsx` | Проверить manual access actions на побочный grant |
| Все UI-точки revoke (Contact, Deal, Member, Bulk) | Backend truth wins, нет локальных update |
| `src/pages/admin/TelegramClubMembers.tsx` | Единый payload, убрать client-side recomputation counters, channel-aware UI |
| `src/components/telegram/ClubQuickStats.tsx` | Получать данные из единого payload, admin-separated display |
| `src/hooks/useTelegramIntegration.tsx` (`useClubMemberStats`) | Убрать отдельный source, использовать единый payload из RPC |
| `src/hooks/useTelegramIntegration.tsx` (`useClubBusinessStats`) | Объединить с `useClubMemberStats` или гарантировать единый backend-source |
| `supabase/functions/telegram-check-expired/index.ts` | Единая валидация, admin-guard, reason-лог |
| `supabase/functions/telegram-kick-violators/index.ts` | hasValidAccessBatch, admin-guard, reason-лог |
| Все outbound notification flows | reason_code, trigger_type, decision в audit; no club_id → no send |
| Все edge functions | Verify no hardcoded club IDs, notifications by club_id |
| Diagnostic SQL (one-time) | Расслоение report, cross-club contamination, per-club repair |

## Что НЕ меняем

- Схему `_shared/accessValidation.ts` — используем as-is (единый SoT для edge functions)
- Основную логику подписок/оплат
- Telegram Bot API интеграцию
- Структуру таблиц (только view + trigger + новая SQL-функция)

---

# ПЛАН: Закрытие рассинхрона метрик и единая верификация клубной статистики

**Статус**: EXECUTE завершён, ожидает финальную UI-приёмку

## Цель

Устранить все расхождения между SQL, RPC, UI и Telegram для метрик «В клубе», «Админы», «С доступом», «Не вошли», «Удалённые», «Нарушители». Подтвердить parity для БкБ и GC.

## 1. Root Cause

Edge functions `telegram-cron-sync` и `telegram-revoke-access` ставили `in_chat=false` и `access_status=removed` администраторам/создателям, которых Telegram не позволяет удалить. Guard-логика внедрена в 7 write-paths, данные пересинхронизированы.

## 2. Инвариант (DoD)

- Если `chat_status IN ('administrator','creator')` → `in_chat` обязан быть `true`
- Если `channel_status IN ('administrator','creator')` → `in_channel` обязан быть `true`
- `access_status='removed'` для такой записи недопустим
- Нарушение логируется как аномалия

## 3. Что исправлено в коде

Guard в 5 edge functions: telegram-cron-sync, telegram-revoke-access, telegram-club-members (check_status/kick/kick_present), telegram-kick-violators, telegram-check-expired.

## 4. Что исправлено в данных (2026-03-16 12:17 UTC)

**БкБ** (2 записи): Катерина (99340019) и Сергей (66086524) — `in_chat: false→true`, `access_status: removed→ok`
**GC** (3 записи): Катерина (99340019), Ирина (2087326316), Алима (6338908257) — `in_chat: false→true`, `access_status: removed→ok`

## 5. SQL Snapshot (post-sync)

**БкБ**: in_club_total 31→33, in_club_admins 1→3, removed 4→2
**GC**: in_club_total 155→158, in_club_admins 1→4, removed 42→39

## 6. Поимённый proof: все 9 админов

Все 7 админов в members + 2 бота (один бот на оба клуба) подтверждены: `in_chat=true`, `access_status=ok`, chat_status=administrator/creator.

## 7. Что остаётся

- UI parity-проверка (cards, badges, rendered lists)
- RPC summary parity (требует auth)
- getChatMembersCount грубая сверка
- SQL-миграция не планируется, но может потребоваться
- PATCH-4 заблокирован
