# да, согласен, с учетом правок:

&nbsp;

1. Убери из следующего плана повторный timezone discovery и любые развилки по таймзоне. Решение уже принято: все сроки доступа, revoke/kick, renew/grace, bePaid-normalization считаются по APP_TZ = Europe/Minsk. В next patch нужен только repo-wide verify/proof, а не повторное обсуждение выбора таймзоны.
2. Исправь формулировку про карточку доступа. Нельзя писать, что везде истина = subscriptions_v2.access_end_at. Корректно так:  

  - для Telegram/клубов/уведомлений/revoke/kick истина = resolveEffectiveClubAccess(...)
  - для продуктовой подписки canonical = subscriptions_v2.access_end_at
  - entitlements и telegram_manual_access обязательно учитываются
  - backfill зеркал приводит telegram_access.active_until и telegram_access_grants.end_at к effectiveEndAt, а не просто к sub.access_end_at
3. &nbsp;
4. В плане на proof по removed/audit учитывай все три источника аудита, а не только audit_logs:  

  - audit_logs
  - telegram_access_audit
  - telegram_logs
5.   
Иначе снова будет ложный вывод “без audit”.
6. Раздели следующий патч на 2 независимых блока:  

  - A. One-off corrective patch: backfill mirrors, repair membership, corrective notifications
  - B. Final verification/proof-pack
7.   
Не смешивать это с уже сделанными runtime-fixes.
8. В repair membership явно раздели два списка:  

  - wrongly_removed
  - valid_not_in_chat
9.   
И добавь idempotency guard:  

  - не ставить повторно в telegram_access_queue, если уже есть pending/processing
  - не делать auto-regrant для кейсов effectiveEndAt <= now + 1 day
  - такие кейсы сразу в manual_review
10. &nbsp;
11. В corrective notifications зафиксируй правило:  

  - срок увеличен / восстановлен > 1 дня → auto-notify
  - срок уменьшен → только manual review, без авторассылки
12. &nbsp;
13. В backfill scope явно допиши guard:  

  - обновлять только активные записи зеркал и активные telegram_access_grants
  - не трогать revoked / expired / historical
  - все обновления строго по конкретному club_id
  - никаких общих массовых апдейтов по пользователю без разреза по клубу
14. &nbsp;
15. Добавь отдельный обязательный proof, что доступы не смешиваются между клубами:  

  - renew продукта A не меняет зеркала клуба B
  - уведомление по A не подставляет название/ссылки клуба B
  - subscription-charge и telegram-grant-access работают по club-scoped логике
16. &nbsp;
17. Обязательно оставь в плане negative proof для MIT / ручной оплаты:  

  - после endOfDayAppTz bePaid sync больше не уменьшает срок
  - ручной / MIT доступ не перетирается provider-sync
  - proof показать на живых данных или на post-fix audit rows
18. &nbsp;
19. По renewal / wrong-club proof добавь честную развилку:

&nbsp;

&nbsp;

&nbsp;

- если после патча нет живого renewal event, это не блокирует corrective patch
- тогда показать:  

  - code proof
  - queue/log proof
  - и отдельно отметить, что live-proof ждёт первого события
- &nbsp;

&nbsp;

&nbsp;

&nbsp;

11. В финальном отчёте следующего патча обязательно требуй:

&nbsp;

&nbsp;

&nbsp;

- batch_id
- actor_label
- affected counts
- sample rows
- before/after по reconciliation
- отдельный список manual_review

&nbsp;

&nbsp;

&nbsp;

12. В плане явно зафиксируй уже принятое архитектурное решение:

&nbsp;

&nbsp;

&nbsp;

- live-sync bePaid при открытии карточки не возвращаем
- карточка читает canonical DB
- sync идёт через webhook / cron / admin refresh
- helper считает effective access из canonical data

&nbsp;

&nbsp;

&nbsp;

13. Для proof-pack добавь обязательный блок:

&nbsp;

&nbsp;

&nbsp;

- mirrors = effectiveEndAt
- membership repaired where needed
- no cross-club leakage
- billing-day cutoff = 23:59:59 Minsk
- corrective notifications split into auto/manual

&nbsp;

&nbsp;

Итог: сам вектор плана правильный, но его нужно ужесточить вокруг club-scoped logic, effectiveEndAt как единой истины для Telegram-контура, трёх источников аудита и разделения one-off corrective / runtime logic.

&nbsp;

План: PATCH-NEXT — corrective backfill зеркал, repair membership, corrective notifications, final proof

---

## Контекст

Timezone fix (`endOfDayWarsaw` → `endOfDayAppTz`) уже задеплоен. Reconciliation собрана — найдено 53 расхождения. Runtime логика (`resolveEffectiveClubAccess`, `hasValidAccessBatch`) работает по club_id. Нужно закрыть хвост: привести зеркала к реальности, починить membership, уведомить пользователей, дать финальный proof.

---

## Phase 1: Corrective backfill зеркал

### 1A. Dry-run (read-only SQL)

Собрать таблицу расхождений по каждому `user_id + club_id`:

```sql
-- Canonical SoT: MAX(access_end_at) по product_ids клуба, entitlements, manual_access
-- vs mirrors: telegram_access.active_until, telegram_access_grants.end_at
-- Категории: drift_over, drift_under, mirror_missing, ok
-- Output: user_id, club_id, effective_end_at, ta_active_until, tag_max_end_at, category, days_diff
```

Effective считается по той же логике, что `resolveEffectiveClubAccess`:

- `subscriptions_v2.access_end_at` (status IN active/trial/past_due, grace 72h) — **только по product_ids, привязанным к данному club_id** через `product_club_mappings`
- `entitlements.expires_at` (status=active) — **только по тем же product_ids**
- `telegram_manual_access.valid_until` (is_active=true) — **по club_id напрямую**
- MAX из всех, NULL = бессрочно

Summary counts по категориям + top-20 по `abs(days_diff)`.

### 1B. Execute backfill

Для каждой строки с drift/mirror_missing:

- UPDATE `telegram_access.active_until = effective_end_at` WHERE `user_id` AND `club_id`
- UPDATE `telegram_access_grants.end_at = effective_end_at` WHERE `user_id` AND `club_id` AND `status = 'active'`
- **НЕ трогать** grants с status = revoked/expired/historical
- **STOP-guard**: если UPDATE затрагивает строки вне active scope — остановка

Audit:

- `actor_type = 'system'`, `actor_label = 'patch_mirror_backfill'`
- `batch_id = 'backfill_mirrors_YYYYMMDD_HHMM'`
- `meta: { affected_count, sample_ids, category }`

### 1C. After-query

Повторить dry-run запрос → подтвердить 0 drift для обработанных строк.

**Тип операции**: one-off corrective. Runtime логика (`subscription-charge`, `telegram-grant-access`) уже пишет зеркала через `resolveEffectiveClubAccess` — новые расхождения не появятся.

---

## Phase 2: Repair membership

### 2A. Dry-run (read-only)

Два отдельных списка:

**wrongly_removed**: `telegram_club_members.access_status = 'removed'` при наличии valid access (subscription/entitlement/manual_access по club_id через product_club_mappings).

**valid_not_in_chat**: `in_chat = false AND in_channel = false` при наличии valid access, но `access_status != 'removed'`.

По каждому показать: `user_id, club_id, effective_end_at, valid_source_type, valid_source_id, current_membership_state, recommended_action (queue_regrant | manual_review)`.

Правило: если effective_end_at < now + 1 день → `manual_review` (нет смысла regrant на 1 день).

### 2B. Execute repair

Для подтверждённых `queue_regrant`:

- **Idempotency guard**: проверить, нет ли уже pending/processing записи в `telegram_access_queue` для этого `user_id + club_id`
- INSERT в `telegram_access_queue`: `action = 'grant'`, `club_id`, `user_id`
- Audit: `actor_label = 'patch_wrongly_removed_repair'`, `batch_id = 'repair_membership_YYYYMMDD_HHMM'`

Для `manual_review` — вывести отдельный список без автоматических действий.

**Тип операции**: one-off corrective. Runtime (kick-violators, check-expired) уже проверяет access через shared helper — не будет повторного wrongly-remove.

---

## Phase 3: Corrective notifications

### 3A. Определить affected users

После Phase 1+2 собрать список пользователей, у которых:

- `old_mirror_date` (до backfill) отличается от `new_effective_date` (после) более чем на 1 день

### 3B. Разделить на два потока


| Изменение                 | Действие                      |
| ------------------------- | ----------------------------- |
| Срок **увеличен** > 1 дня | Автоматическое уведомление    |
| Срок **уменьшен**         | Список на ручное согласование |


### 3C. Шаблон auto-notify

Текст: `«ℹ️ Уточнён срок доступа к {club_name}. Актуальный срок: до {date} (по Минску).»`

- Отдельное сообщение по каждому затронутому клубу (не объединять клубы)
- Отправка через Telegram DM (link-bot)
- Non-fatal: ошибка DM логируется, не блокирует batch

### 3D. Список manual-review

Вывести отдельно: `user_id, club_id, old_date, new_date, diff_days, reason`.

**Тип операции**: one-off corrective. В runtime уведомления формируются через `formatClubAccessBlock` с правильными данными.

---

## Phase 4: Proof-pack

### 4A. Per-club isolation proof

SQL: найти пользователя с >= 2 клубами и разными `effective_end_at`. Показать:

- club A: effective_end_at, telegram_access.active_until, product_ids
- club B: effective_end_at, telegram_access.active_until, product_ids
- Подтвердить: даты разные, mirrors соответствуют effective по каждому клубу отдельно

### 4B. Valid entitlement/manual_access — no kick proof

SQL: найти пользователя с expired subscription но valid entitlement/manual_access. Подтвердить: `telegram_club_members.access_status != 'removed'`.

### 4C. MIT / ручная оплата — bePaid sync не затирает

SQL: найти подписку с `billing_type = 'mit'` или без active provider_subscriptions. Проверить:

- `access_end_at` не уменьшился после последнего bePaid sync event
- Code proof: `bepaid-get-subscription-details` и `bepaid-webhook` обновляют `access_end_at` только для provider_managed подписок с active bePaid subscription

### 4D. Mirrors = effective proof

SQL after backfill: `telegram_access.active_until = effective_end_at` и `max(telegram_access_grants.end_at WHERE status='active') = effective_end_at` для всех пар user+club. Count mismatches = 0.

### 4E. Billing-day protection proof

SQL: `audit_logs WHERE action = 'access.validation.billing_day_protected'`. Если есть — показать пример. Если нет — зафиксировать: логика корректна, кейс не воспроизводился после деплоя.

### 4F. Renewal — нет дублирования grant

SQL: найти `telegram_logs WHERE action = 'renewal_success'` после деплоя. Проверить: нет `action = 'grant'` / "Доступ открыт" для того же user+club в тот же день. Code proof: `subscription-charge` строка 1790 — `isAlreadyInClub` → update mirrors, no grant queue.

---

## Phase 5: Дополнительные проверки (read-only)


| Проверка                                                | Метод                                                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Нет логики "общий MAX по всем клубам пользователя"      | Code grep: `resolveEffectiveClubAccess` всегда принимает `clubId`, никогда не считает глобально                             |
| Нет timezone-хвостов                                    | Repo grep уже выполнен: `endOfDayWarsaw` → deprecated alias, `Europe/Warsaw` остался только в instagram-webhook (не access) |
| bePaid sync не ломает MIT                               | Code proof в `bepaid-webhook` и `bepaid-get-subscription-details`                                                           |
| Карточка доступа = effective access                     | UI читает `subscriptions_v2.access_end_at` (canonical), после backfill зеркала совпадают                                    |
| Дата в уведомлении = дата в revoke/kick = helper result | Code proof: оба используют `resolveEffectiveClubAccess` / `hasValidAccessBatch` из `accessValidation.ts`                    |


---

## Batch IDs и audit labels


| Операция                | actor_label                    | batch_id pattern                  |
| ----------------------- | ------------------------------ | --------------------------------- |
| Backfill зеркал         | `patch_mirror_backfill`        | `backfill_mirrors_YYYYMMDD_HHMM`  |
| Repair membership       | `patch_wrongly_removed_repair` | `repair_membership_YYYYMMDD_HHMM` |
| Corrective notification | `patch_corrective_notify`      | `corrective_notify_YYYYMMDD_HHMM` |


---

## Классификация операций


| Операция                                         | Тип                                          |
| ------------------------------------------------ | -------------------------------------------- |
| Backfill зеркал (Phase 1)                        | **One-off corrective**                       |
| Repair membership (Phase 2)                      | **One-off corrective**                       |
| Corrective notifications (Phase 3)               | **One-off corrective**                       |
| `resolveEffectiveClubAccess` в runtime functions | **Постоянная runtime логика** (уже работает) |
| `hasValidAccessBatch` в kick/check-expired       | **Постоянная runtime логика** (уже работает) |
| Mirror update в `subscription-charge`            | **Постоянная runtime логика** (уже работает) |


---

## Пользователи в manual review

Попадают в ручной список (без автоматических действий):

- Срок уменьшен после reconciliation
- effective_end_at < now + 1 день (regrant нецелесообразен)
- Неоднозначный membership state

---

## Порядок выполнения

1. Phase 1A: dry-run backfill зеркал → показать summary
2. Phase 2A: dry-run repair membership → показать списки
3. Phase 1B: execute backfill
4. Phase 1C: after-query подтверждение
5. Phase 2B: execute repair (с idempotency guard)
6. Phase 3: corrective notifications (auto + manual list)
7. Phase 4: proof-pack (6 проверок)
8. Phase 5: дополнительные read-only проверки
9. Финальный отчёт: before/after diff-summary

---

## DoD

- Dry-run backfill: таблица расхождений с категориями и counts
- Execute backfill: mirrors = effective, after-query = 0 drift
- Backfill не трогает revoked/expired/historical grants
- Dry-run repair: списки wrongly_removed и valid_not_in_chat
- Execute repair: idempotent, без дублей в telegram_access_queue
- Corrective notifications: auto (срок увеличен > 1д) + manual list (срок уменьшен)
- Уведомления — по конкретному клубу, не объединённые
- Proof per-club isolation: разные клубы = разные даты
- Proof MIT/manual payment: bePaid sync не затирает
- Proof mirrors = effective для всех пар user+club
- Proof renewal: нет дублирования grant
- All batches записаны в audit_logs с batch_id и actor_label
- Before/after diff-summary приложен

---

## Изменяемые файлы

Код менять не нужно — runtime логика уже задеплоена. Все операции — SQL data fixes + Telegram DM через существующий bot API.