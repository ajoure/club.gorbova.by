Да, согласен, с учетом правок:

&nbsp;

1. В Задачу 3B (Repair wrongly removed) добавить обязательный dedupe/idempotency guard:  

  - не ставить повторный grant в telegram_access_queue, если уже есть pending / processing запись для того же user + club;
  - repair batch должен быть идемпотентным;
  - DoD: повторный запуск batch не создаёт дубликатов очереди и не меняет уже исправленные записи.
2. &nbsp;
3. В Задачу 3 (Backfill зеркал + repair membership) явно разделить два разных сценария:  

  - 3B.1 Regrant required: пользователь removed / kicked / not_in_chat, при этом доступ валиден → ставим в grant queue;
  - 3B.2 State sync only: membership формально ещё ок, но зеркала/статусы расходятся → только sync state/mirrors, без нового invite/grant.  
  Иначе часть пользователей будет ошибочно прогоняться через повторную выдачу доступа.
4. &nbsp;
5. В Задачу 3A (Backfill зеркал) жёстко зафиксировать scope обновления:  

  - telegram_access.active_until обновлять только по user + club;
  - telegram_access_grants.end_at обновлять только для status='active' и только по соответствующему club_id;
  - не трогать revoked / expired / исторические grants.  
  Добавить отдельный STOP-guard: если update затрагивает не только active grants — остановка.
6. &nbsp;
7. В Задачу 7 (Proof “не тот клуб в уведомлении”) расширить proof не только на renew, но и на grace/failure:  

  - renewal_success
  - grace_started
  - grace_24h_left
  - grace_expired  
  Для каждого кейса сверять:
  - subscriptions_v2.product_id
  - product_club_[mappings.club](http://mappings.club)_id
  - фактический club_name в тексте
  - фактические invite links / inline keyboard в payload
  - telegram_logs.meta  
  То есть proof делать по реальному payload, а не только по строкам логов.
8. &nbsp;
9. В Задачу 4B (Manual-payment negative proof) добавить отдельный негативный кейс:  

  - у пользователя нет актуальной provider_managed подписки;
  - при этом может существовать старый provider_subscriptions / старый bePaid subscription id;
  - provider sync / bepaid-get-subscription-details / webhook не должен занизить, обнулить или перетереть текущий ручной доступ.  
  Это отдельный обязательный proof, не сливать его с обычной ручной оплатой.
10. &nbsp;
11. В Задачу 4A (Decision gate по live-sync карточки) зафиксировать обязательный финальный статус:  

  - Live-sync at card open = RESTORED
  - или
  - Live-sync at card open = INTENTIONALLY DEPRECATED  
  С коротким обоснованием, почему выбран именно этот вариант.  
  Нельзя оставлять этот пункт как просто “исследовали”.
12. &nbsp;
13. В Задачу 1 (Repo-wide Warsaw/timezone grep + fix) уточнить границы проверки:  

  - grep/search обязателен по всем access/subscription/telegram runtime участкам:  

    - Warsaw
    - Europe/Warsaw
    - endOfDayWarsaw
    - ручные end-of-day helpers
    - ручные +12h, +24h, setHours(23,59,59)
  - &nbsp;
  - всё найденное делить на:  

    - access-critical → исправить;
    - non-access / unrelated → явно перечислить и пометить “не относится к текущему патчу”.  
    DoD: repo-wide grep result приложен к финальному proof.
  - &nbsp;
14. &nbsp;
15. В Задачу 3C (Corrective notifications) добавить правило:  

  - корректирующее уведомление отправляется по конкретному клубу / конкретному продукту;
  - не объединять в одно сообщение несколько разных клубов/сроков пользователя;
  - если у пользователя 2 клуба с разными сроками — уведомление формируется отдельно по каждому затронутому клубу.
16. &nbsp;
17. В DoD дополнительно включить:  

  - repair batch идемпотентен, без дублей в telegram_access_queue;
  - backfill не трогает historical / revoked / expired grants;
  - proof “не тот клуб” выполнен для renewal и grace-сценариев;
  - manual-payment proof включает кейс со stale provider record;
  - decision gate по карточке закрыт статусом RESTORED или INTENTIONALLY DEPRECATED;
  - приложен repo-wide timezone grep report с разделением critical / non-critical находок.
18. &nbsp;
19. В финальный отчёт добавить отдельный раздел:

&nbsp;

&nbsp;

&nbsp;

- Repair batch results
- Mirror backfill results
- Wrong-club notification proof
- Manual payment / stale provider proof
- Live-sync decision
- Timezone grep report

&nbsp;

&nbsp;

Если нужно жёстко вставить это прямо в твой текущий план единым блоком для подрядчика, сделаю следующим сообщением в готовом виде для копипаста.

&nbsp;

# План: PATCH-FOLLOWUP v2 — полное закрытие хвоста, repair, timezone cleanup, proofs

---

## Текущий статус

- Phase 0 (discovery): done
- Phase 1 (shared helpers): done
- Phase 2 (edge function fixes): done (включая DM в kick-violators, timezone в accessValidation.ts)
- **PATCH-FOLLOWUP**: partially done — reconciliation запланирована, но не выполнена

---

## Задача 1: Repo-wide Warsaw/timezone grep + fix

**Цель**: Гарантировать отсутствие скрытых Warsaw-участков в access-логике.

**Найдено по discovery**:


| Файл                                                 | Что                                       | Статус                                                                   |
| ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| `_shared/timezone.ts:160-166`                        | `endOfDayWarsaw()` с `Europe/Warsaw`      | **Менять** → `endOfDayAppTz()` с `APP_TZ`                                |
| `bepaid-get-subscription-details/index.ts:4,495,530` | `import { endOfDayWarsaw }`, 2 вызова     | **Менять** → `endOfDayAppTz`                                             |
| `bepaid-webhook/index.ts:3,1498`                     | `import { endOfDayWarsaw }`, 1 вызов      | **Менять** → `endOfDayAppTz`                                             |
| `_shared/accessValidation.ts:51-52`                  | Комментарий «Warsaw»                      | **Менять** комментарий → APP_TZ                                          |
| `instagram-webhook/index.ts:60,85`                   | `Europe/Warsaw` для ApiX-Drive timestamps | **НЕ МЕНЯТЬ** — это парсинг входящих данных ApiX-Drive, не access-логика |
| `installment-notifications/index.ts:407`             | `setHours(23,59,59,999)`                  | **Проверить** — это рассрочки, не access                                 |


**Фикс**:

- `_shared/timezone.ts`: переименовать `endOfDayWarsaw` → `endOfDayAppTz`, использовать `APP_TZ` вместо `WARSAW_TZ`
- `bepaid-get-subscription-details`: заменить import и вызовы
- `bepaid-webhook`: заменить import и вызов
- `accessValidation.ts`: обновить комментарий

---

## Задача 2: Read-only reconciliation сверка

SQL-запрос по каждому `user + club`:

- `subscriptions_v2.access_end_at` (по product_club_mappings)
- `entitlements.expires_at`
- `telegram_manual_access.valid_until`
- `telegram_access.active_until`
- `telegram_access_grants.end_at`
- Effective = MAX по валидным источникам (NULL = бессрочно)

Выделить 4 категории расхождений:

1. **Зеркала < effective** — mirror drift, нужен backfill зеркал
2. **Зеркала > effective** — mirror overshot, нужен corrective sync
3. **Доступ валиден, но membership = removed/not_in_chat** — нужен repair membership + regrant
4. **Membership ok, но зеркала кривые** — только sync mirrors

---

## Задача 3: Backfill зеркал + repair membership

### 3A: Backfill зеркал (только даты)

Для категорий 1-2 из задачи 2:

- Пересчитать `effectiveEndAt` через `resolveEffectiveClubAccess`
- Обновить `telegram_access.active_until` и `telegram_access_grants.end_at`
- `audit_logs` с `actor_label = 'patch_mirror_backfill'`, `batch_id`

### 3B: Repair wrongly removed (membership + regrant)

Для категории 3:

- Dry-run: список пользователей с валидным доступом, но `access_status = 'removed'` или `in_chat = false`
- Execute: для каждого — upsert в `telegram_access_queue` с `action = 'grant'`
- НЕ автоматически кикать обратно — ставить в очередь на grant, чтобы система сама выдала invite link
- `audit_logs` с `actor_label = 'patch_wrongly_removed_repair'`, `batch_id`
- Список восстановленных пользователей

### 3C: Разделение corrective notifications

**Срок увеличен/восстановлен** → автоматическое уведомление:

- Шаблон: «ℹ️ Уточнён срок доступа к {club}. Актуальный срок: до {date}.»
- Только если разница > 1 дня

**Срок уменьшен** → НЕ отправлять автоматически:

- Вывести список в ручной review
- Отправка только после whitelist approval

---

## Задача 4: Проверка live-sync карточки доступа через bePaid

### 4A: Decision gate (обязательное решение)

По результатам discovery (карточка читает только из БД, нет live-refresh bePaid при открытии):

**Зафиксировать архитектурное решение**:

- Sync bePaid → canonical data происходит **только** через webhook / cron / admin refresh
- Карточка UI читает **только** canonical data из БД
- Shared helper считает effective access из canonical data
- Записать это решение как invariant

### 4B: Negative proof — ручная оплата не перетирается provider sync

Отдельный кейс:

- Пользователь без active provider subscription
- Доступ дан по последней ручной оплате (subscriptions_v2 status=active, billing_type != provider_managed)
- Вызов `bepaid-get-subscription-details` / webhook НЕ должен ухудшить `access_end_at`
- Helper должен корректно вернуть canonical access

SQL proof: найти таких пользователей, проверить, что `access_end_at` не обнулён/не уменьшен после последнего bePaid sync.

---

## Задача 5: Proof renewal — нет дублирования grant-message

SQL:

- Найти последнее успешное продление после деплоя
- В `telegram_logs`: есть `renewal_success`, нет `grant` / "Доступ открыт" в тот же день
- В `telegram_access_queue`: нет `action='grant'` для user с `in_chat=true`
- В логах `subscription-charge`: строка `[TG-RENEW] User ... already in club`

---

## Задача 6: Proof cutoff 23:59 Минск

- Код: `accessValidation.ts:86-87` — `endOfDayUtcMs = todayEnd - 1000`, `now <= endOfDayUtcMs`
- SQL: `audit_logs` с `action = 'access.validation.billing_day_protected'` после деплоя
- Если нет таких записей — зафиксировать: «логика корректна, billing-day protection не воспроизводилась на живых данных»

---

## Задача 7: Proof «не тот клуб в уведомлении» — по фактическому payload

Не только `telegram_logs.meta.club_id`, а:

- `subscription.product_id` → `product_club_mappings.club_id` (expected)
- `telegram_logs.meta` → фактические invite links / inline keyboard / club name в тексте
- Сверка: название клуба в тексте сообщения совпадает с `telegram_clubs.club_name` для expected club_id

---

## Задача 8: Разбор legacy-хвоста поштучно

### 8A: 52 drift → new vs legacy

- SQL: split по `subscriptions_v2.updated_at > дата_деплоя`
- New drift = баг → разбирать
- Legacy drift → backfill (задача 3A)

### 8B: 68 removed без audit → new vs legacy

- SQL: `telegram_club_members.updated_at > дата_деплоя` + нет audit
- New = продолжающаяся проблема
- Legacy = historical gap

### 8C: 7 expired-but-not-kicked → поштучно

- По каждому: все источники доступа (sub + ent + manual + billing-day)
- Классификация: valid access source / ожидание cron / баг

---

## Изменяемые файлы


| Файл                                       | Изменение                                     |
| ------------------------------------------ | --------------------------------------------- |
| `_shared/timezone.ts`                      | `endOfDayWarsaw` → `endOfDayAppTz` с `APP_TZ` |
| `bepaid-get-subscription-details/index.ts` | import + 2 вызова → `endOfDayAppTz`           |
| `bepaid-webhook/index.ts`                  | import + 1 вызов → `endOfDayAppTz`            |
| `_shared/accessValidation.ts`              | комментарий Warsaw → APP_TZ                   |


Остальное — SQL-диагностика, backfill скрипт, repair скрипт (read-only + one-off operations).

## Порядок выполнения

1. Repo-wide Warsaw grep + fix (задача 1)
2. Read-only reconciliation сверка (задача 2)
3. Разбор legacy-хвоста: drift/removed/expired (задача 8)
4. Backfill зеркал + repair wrongly removed (задача 3)
5. Decision gate по live-sync карточки (задача 4A)
6. Proof renewal (задача 5)
7. Proof cutoff 23:59 (задача 6)
8. Proof «не тот клуб» по payload (задача 7)
9. Negative proof ручная оплата (задача 4B)
10. Деплой (timezone fix)
11. Discovery AFTER (6 запросов, before/after summary)

## DoD

- `endOfDayWarsaw` → `endOfDayAppTz` во всех файлах, repo-wide grep чист
- Reconciliation таблица собрана, 4 категории расхождений выделены
- Backfill зеркал выполнен, записан в audit_logs
- Wrongly removed: либо восстановлены (regrant в очередь), либо в ручной review list
- Corrective notifications: увеличение срока — автоматически, уменьшение — только после ручного approve
- Repair membership: пользователи с валидным доступом но removed/not_in_chat — в grant queue
- Decision gate по live-sync карточки: зафиксировано (restored или intentionally deprecated)
- Manual-payment negative proof: provider sync не перетирает ручной доступ
- Proof renewal: нет дублирования grant-message
- Proof cutoff 23:59 Минск
- Proof «не тот клуб» по фактическому payload, не только по log rows
- Legacy-хвост разобран: new vs legacy по drift/removed/expired
- Before/after summary по 6 запросам