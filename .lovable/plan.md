# да, согласен, с учетом правок:

&nbsp;

1. **Не делать live_active_sessions с session_key как отдельным единственным источником доступа без жёсткой привязки к user.**
  В heartbeat и session-check обязательно проверять одновременно:
  &nbsp;
  - session_key
  - user_id
  - live_event_id
    Иначе одна утёкшая session key может стать самостоятельным токеном доступа.
  &nbsp;
2. **session_key не передавать через URL param.**
  В плане упомянуто “через URL param или sessionStorage”.
  URL param нужно исключить полностью.
  Оставить только:
  &nbsp;
  - sessionStorage
  - либо другой client storage, не попадающий в URL/history/referrer.
  &nbsp;
3. **Не переименовывать consumed в activated, если это сломает уже созданные миграции и текущую реализацию без реальной необходимости.**
  Для MVP безопаснее:
  &nbsp;
  - оставить статус consumed как “успешно активированная ссылка”,
  - а новую semantics описать логически, без обязательного массового переименования схемы.
    Иначе это лишний churn и риск конфликтов.
    Если очень хочется новое имя, тогда это должен быть отдельный осознанный migration patch с проверкой всех мест использования.
  &nbsp;
4. **Если оставляете смену consumed -> activated, то надо явно обновить все места в коде и constraints без остаточных веток already_used.**
  Сейчас план затрагивает это, но нужно явно прописать full sweep:
  &nbsp;
  - validate statuses
  - DoD
  - UI states
  - audit labels
  - existing DB constraints/checks
  - admin screens/filters
    Иначе можно получить смешанную модель consumed + activated.
  &nbsp;
5. **live_access_proofs и live_active_sessions должны иметь чёткую роль без дублирования.**
  Прямо зафиксируй:
  &nbsp;
  - proof = право повторного входа после успешной первичной активации
  - active_session = защита от параллельного просмотра
    И отдельно запиши, что наличие proof **не равно** наличию активной viewer-session.
  &nbsp;
6. **В live-resolve не стоит возвращать session_expired только по отсутствию active session, если proof ещё валиден и пользователь не пытается параллельный просмотр.**
  Иначе обычный refresh/новая вкладка может ломаться слишком жёстко.
  Нужна более мягкая модель:
  &nbsp;
  - если proof валиден, но active session отсутствует, можно пересоздать/поднять новую session для этого же user, а не сразу отказывать;
  - session_expired нужен именно когда proof уже невалиден или heartbeat/session реально истекли по политике.
  &nbsp;
7. **Определи канонический момент создания active session.**
  Сейчас написано:
  &nbsp;
  - live-token-validate создаёт session при activate/re-enter
    Это ок, но тогда live-resolve не должен параллельно создавать вторую session.
    Нужно явно закрепить:
  - session создаётся/заменяется только в live-token-validate
  - live-resolve только проверяет её наличие/валидность
    Либо наоборот. Но не оба сразу.
  &nbsp;
8. **Single-session policy должна быть user-safe при обычном refresh/перезаходе владельца.**
  Новый вход того же пользователя не должен считаться “вторым человеком”.
  Нужно явно описать:
  &nbsp;
  - новый вход того же user с тем же proof заменяет старую session без потери доступа;
  - старая вкладка/устройство получает session_revoked;
  - новая продолжает просмотр.
  &nbsp;
9. **Для live-session-heartbeat не писать audit на каждый ping.**
  Ты это уже частично отметил, но лучше жёстко закрепить:
  &nbsp;
  - heartbeat audit либо вообще не писать,
  - либо агрегировать / rate-limit, например не чаще раза в 10–15 минут на session.
    Иначе быстро засорите audit_logs.
  &nbsp;
10. **В live_active_sessions нужен updated_at или эквивалентный служебный timestamp.**
  Сейчас есть last_seen_at и created_at, но для диагностики и админки удобнее иметь ещё явный updated_at, либо чётко использовать last_seen_at как единственный operational timestamp.
11. **RLS policy для live_active_sessions снова использует has_role_v2(auth.uid(), 'admin') — проверь, чтобы в SQL использовалось корректное имя параметра RPC или вообще не было повторения старой ошибки.**
  Лучше прямо в плане отметить: использовать тот же корректный вызов, что и после hotfix, без возврата к _role.
12. **В PATCH C2 не надо убирать mismatch из статусов, если он уже где-то физически появился в данных, без миграции очистки/нормализации.**
  Если решили сделать mismatch только audit-only, нужно:
  &nbsp;
  - либо оставить старый статус как legacy-compatible, но больше не писать его,
  - либо сделать явную data cleanup migration.
    Не оставлять это в полусостоянии.
  &nbsp;
13. **already_activated лучше не делать отдельным жёстким стоп-статусом, если вы и так хотите автоматический re-entry.**
  Для владельца ссылки логичнее:
  &nbsp;
  - validate → ok + redirect_slug + session refresh/replacement
  - без лишнего промежуточного экрана
    already_activated можно оставить только как fallback UI, если redirect невозможен.
  &nbsp;
14. **В DoD уточни пункт про “два одновременных просмотра невозможны”.**
  Технически нужно сформулировать так:
  &nbsp;
  - две одновременно активные viewer-session для одного user_id и live_event_id невозможны;
  - новый вход заменяет старую session;
  - старая вкладка теряет доступ после heartbeat check.
    Это точнее и проверяемее.
  &nbsp;
15. **Добавь отдельный DoD на unpublished/deleted event для уже активированной ссылки.**
  Если эфир сняли с публикации после отправки ссылки:
  &nbsp;
  - владелец ссылки не должен проходить дальше,
  - должен получить корректный event_unpublished / event_not_found,
  - без утечки Kinescope config.
  &nbsp;

&nbsp;

&nbsp;

В остальном направление правильное: hotfix, уход от “одноразовой навсегда” модели, и переход к персональной активации + single active session — это верный контур.

&nbsp;

&nbsp;

План: PATCH C — Hotfix + Activation Model + Single Active Session

## Диагностика текущего состояния

### Что есть сейчас

- `live-token-validate`: баг `_role` вместо `_role_code` (revoke/reissue сломаны)
- Semantics: ссылка после consume навсегда "сгорает" — владелец получает `already_used` при повторном открытии
- `live_access_proofs`: существует, TTL 24ч, но нет контроля одновременных сессий
- Нет heartbeat, нет single-session enforcement

### Что нужно

- Hotfix `_role_code`
- Смена модели: consumed → activated (владелец может повторно входить)
- Новая таблица `live_active_sessions` для single-session per user per event
- Heartbeat на `/live/:slug`
- `live-resolve` проверяет active session

---

## PATCH C1 — Hotfix `_role_code`

**Файл**: `supabase/functions/live-token-validate/index.ts`, строка 465

**Было**: `_role: 'admin'`
**Будет**: `_role_code: 'admin'`

Deploy + проверка revoke/reissue через curl.

---

## PATCH C2 — Смена semantics: activation вместо one-time lock

### Изменения в `live-token-validate`

**validate flow** (строки 161-167): при `link.status === 'activated'` и `user.id === link.user_id`:

- НЕ возвращать `already_used`
- Обновить/создать proof и session
- Вернуть `{ status: 'ok', redirect_slug }`

**consume** (строки 298-332): переименовать статус `consumed` → `activated`:

- `link.status = 'activated'` вместо `consumed`
- `consumed_at` → `activated_at` (или оставить `consumed_at` как timestamp первой активации)
- `proof_type: 'invite_activated'`
- Audit: `live_link_activated` вместо `live_link_consumed`

### Миграция БД

```sql
-- Обновить CHECK constraint: заменить 'consumed' на 'activated'
ALTER TABLE public.live_access_links DROP CONSTRAINT chk_live_access_links_status;
ALTER TABLE public.live_access_links 
  ADD CONSTRAINT chk_live_access_links_status
  CHECK (status IN ('created', 'sent', 'activated', 'expired', 'revoked'));

-- Убрать 'mismatch' из статусов (audit-only, не статус)
-- Добавить activated_at
ALTER TABLE public.live_access_links ADD COLUMN activated_at TIMESTAMPTZ;

-- Обновить unique active index: включить 'activated' как допустимый для повторного входа
-- (active unique остаётся на created+sent — одна неактивированная ссылка на user+event)
```

### Frontend: `LiveAccessEntry.tsx`

- `already_used` → `already_activated`: новый текст "Доступ уже активирован для вашего аккаунта" + кнопка "Перейти к эфиру" (ссылка на `/live/:slug`)
- Если validate возвращает `already_activated` с `redirect_slug` — показать redirect-кнопку

### Логика повторного открытия владельцем

В validate, после нахождения link со status=`activated`:

1. Проверить `user.id === link.user_id` → да
2. Проверить event exists + published
3. Проверить canonical access
4. Обновить proof (upsert, TTL 24ч)
5. Создать/обновить active session
6. Вернуть `{ status: 'ok', redirect_slug }`

Чужой пользователь на activated link → `token_mismatch` (как сейчас, audit-only).

---

## PATCH C3 — Таблица `live_active_sessions` + single-session enforcement

### Миграция

```sql
CREATE TABLE public.live_active_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  session_key TEXT NOT NULL UNIQUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  client_instance_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_live_active_sessions_user_event
  ON public.live_active_sessions(user_id, live_event_id)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_live_active_sessions_session_key ON public.live_active_sessions(session_key);
CREATE INDEX idx_live_active_sessions_expires ON public.live_active_sessions(expires_at);

ALTER TABLE public.live_active_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage live_active_sessions"
  ON public.live_active_sessions FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));
```

### Правило single-session

- Один user = одна активная (revoked_at IS NULL) сессия на один event
- При новом входе: старая сессия → `revoked_at = now()`, новая создаётся
- `session_key` = `crypto.randomUUID()`, возвращается клиенту
- Session TTL: привязан к proof TTL (24ч) или к длительности эфира

### Кто создаёт session

- `live-token-validate` при validate → после успешной активации/повторного входа
- Revoke старую → insert новую → вернуть `session_key` в response

### Кто проверяет session

- `live-resolve`: после proof check, дополнительно проверить active session
- Если session не найдена или revoked → `session_expired` (клиент должен повторно пройти через `/live-access/:token` или получить новый proof)

---

## PATCH C4 — Heartbeat + session check на `/live/:slug`

### Новая Edge Function: `live-session-heartbeat`

```
POST /live-session-heartbeat
Body: { session_key }
Auth: user JWT

Response:
  { status: 'ok' } — сессия активна, last_seen_at обновлён
  { status: 'session_revoked' } — вытеснена другим входом
  { status: 'session_expired' } — TTL истёк
```

### Frontend: `LiveEvent.tsx`

- После успешного `live-resolve`, получить `session_key` (передаётся в response или из localStorage)
- Запустить `setInterval` (каждые 30-60 сек): POST `live-session-heartbeat`
- Если `session_revoked` → показать overlay "Сессия завершена. Вы вошли с другого устройства"
- Если `session_expired` → показать overlay "Сессия истекла. Обновите страницу"

### Доработка `live-resolve`

- В response добавить `session_key` (если session создана/обновлена)
- Или: session создаётся только через `live-token-validate`, а `live-resolve` только проверяет наличие active session

**Выбранная архитектура**: 

- `live-token-validate` создаёт session при activate/re-enter → возвращает `session_key`
- `live-resolve` проверяет: proof valid + active session exists для `required_one_time`
- `live-session-heartbeat` обновляет `last_seen_at`
- При новом входе через token-link: старая session revoked → heartbeat на старой вкладке → `session_revoked`

### Передача session_key

- `LiveAccessEntry` → validate → получает `session_key` в response → передаёт через URL param или sessionStorage
- `LiveEvent` → берёт `session_key` из sessionStorage → использует для heartbeat
- sessionStorage scoped per tab — потеря при закрытии вкладки, это нормально

---

## Доработка `live-resolve` (итоговый flow для `required_one_time`)

```
1. Auth check
2. Invite mode check:
   if required_one_time && !direct_access_allowed:
     a. Check proof (live_access_proofs, expires_at > now)
     b. If no proof → invite_required
     c. Check active session (live_active_sessions, revoked_at IS NULL, expires_at > now)
     d. If no active session → session_expired (нужен re-entry через token или re-activate)
3. Canonical access check
4. Return ok + kinescope_video_id
```

---

## Audit events (новые)


| Action                   | Actor  | Когда                                                           |
| ------------------------ | ------ | --------------------------------------------------------------- |
| `live_link_activated`    | user   | Первая успешная активация ссылки                                |
| `live_link_reentry`      | user   | Повторный вход владельца через activated link                   |
| `live_session_started`   | user   | Новая session создана                                           |
| `live_session_replaced`  | system | Старая session revoked при новом входе                          |
| `live_session_heartbeat` | user   | Периодический ping (писать audit не на каждый, а раз в N минут) |


---

## UI тексты (замена)


| Было                                                               | Стало                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| "Ссылка уже использована. Каждая ссылка действует только один раз" | "Доступ уже активирован для вашего аккаунта" + кнопка "Перейти к эфиру"       |
| `already_used`                                                     | `already_activated` (с redirect_slug)                                         |
| Новое: `session_revoked`                                           | "Просмотр продолжен с другого устройства. Одновременный просмотр невозможен." |
| Новое: `session_expired`                                           | "Сессия просмотра истекла. Обновите страницу для продолжения."                |


---

## Файлы


| Файл                                                 | Действие                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `supabase/functions/live-token-validate/index.ts`    | C1: `_role_code` fix. C2: activation model + re-entry. C3: session create/revoke |
| `supabase/migrations/xxx_c2_activation_model.sql`    | ALTER status constraint, add `activated_at`, remove `mismatch` from statuses     |
| `supabase/migrations/xxx_c3_active_sessions.sql`     | CREATE `live_active_sessions` + indexes + RLS                                    |
| `supabase/functions/live-session-heartbeat/index.ts` | Новая: heartbeat endpoint                                                        |
| `supabase/functions/live-resolve/index.ts`           | Добавить session check для required_one_time                                     |
| `src/pages/LiveAccessEntry.tsx`                      | `already_activated` state + redirect кнопка                                      |
| `src/pages/LiveEvent.tsx`                            | Heartbeat interval + session_revoked/expired overlays                            |


---

## DoD

1. `_role_code` исправлен → revoke/reissue работают для admin
2. Владелец ссылки после активации может повторно входить в эфир через свой аккаунт
3. Повторное открытие token-link владельцем → обновляет proof/session → redirect на эфир
4. Чужой пользователь по ссылке → `token_mismatch`, ссылка не сгорает
5. Два одновременных просмотра под одним аккаунтом невозможны — второй вход вытесняет первый
6. Heartbeat на live page обновляет `last_seen_at`; вытесненная вкладка получает `session_revoked`
7. Refresh страницы `/live/:slug` → proof + session valid → доступ сохраняется
8. Admin reissue: старая ссылка revoked, новая работает, audit корректен
9. Token link после истечения TTL → `token_expired`
10. Валидный token на unpublished/deleted event → `event_unpublished` / `event_not_found`