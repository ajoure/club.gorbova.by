да, согласен, с учетом правок:

&nbsp;

1. В DoD исправить формулировку пункта 12:
  &nbsp;
  - не “Kinescope URL не попадает ни в payload, ни в audit”,
  - а: **Kinescope URL/reference не попадает в payload, preview, историю и audit; в payload попадает только platform link /live-access/:token**.
  &nbsp;
2. Явно определить судьбу статуса opened в live_access_links. Сейчас он перечислен, но не встроен в lifecycle. Нужно выбрать одно из двух и зафиксировать:
  &nbsp;
  - либо opened — только audit event, а status не меняется до consumed,
  - либо opened — реальный статус, и тогда его надо включить в active workflow и учесть в unique index.
    Для MVP проще: **opened оставить только как timestamp/audit, без отдельного статуса**.
  &nbsp;
3. Если opened не используется как статус, скорректировать список статусов и unique index:
  &nbsp;
  - статусы: created, sent, consumed, expired, revoked, mismatch
  - unique active index остаётся на ('created','sent')
    Иначе сейчас есть скрытое противоречие.
  &nbsp;
4. В validate добавить явные выходные статусы для события:
  &nbsp;
  - event_not_found
  - event_unpublished
    Или явно задокументировать, что они маппятся в один общий статус. Сейчас шаг “проверить event exists + published” есть, а явного результата нет.
  &nbsp;
5. Зафиксировать, допустима ли комбинация:
  &nbsp;
  - invite_mode='required_one_time'
  - direct_access_allowed=true
    Если нет — запретить её в UI и валидации. Если да — прямо описать, что required-режим в таком случае смягчается. Сейчас это двусмысленно.
  &nbsp;
6. В разделе “Где персональный URL хранится” добавить строку про telegram_messages.message_text и email body/history. Нужно прямо зафиксировать выбранную модель:
  &nbsp;
  - либо в истории хранится **redacted** текст без raw URL + link_id,
  - либо raw URL осознанно сохраняется в тексте сообщения/письма как исключение.
    Сейчас это не договорено, а без этого будет архитектурная дыра.
  &nbsp;
7. В DoD добавить отдельный сценарий event_unpublished / event_not_found для token route:
  &nbsp;
  - валидный token, но эфир снят с публикации → корректный отказ
  - token на несуществующее событие → корректный отказ
  &nbsp;
8. В audit-таблице добавить явные действия:
  &nbsp;
  - event_unpublished/event_not_found на token validate уровне,
    либо явно указать, что они покрываются существующими live_access_* событиями. Сейчас это лучше закрепить, чтобы не потерять диагностику.
  &nbsp;
9. В разделе файлов/миграций лучше разбить один общий xxx.sql на логические миграции:
  &nbsp;
  - alter live_events
  - create live_access_links
  - create live_access_proofs
    Так безопаснее и легче проверять rollback/diagnostics.
  &nbsp;
10. В DoD по рассылкам уточнить:

&nbsp;

&nbsp;

&nbsp;

- **в переписке и истории кампаний должны быть видны отправки**,
- **персональные URL не должны утекать в общий campaign-level audit/details**,
  чтобы не было путаницы между общей историей и per-recipient delivery.

&nbsp;

&nbsp;

В остальном план уже собран правильно.

&nbsp;

&nbsp;

# План: LIVE VIDEO MVP — Одноразовые ссылки + Приглашения + История рассылок

## Что уже реализовано (НЕ трогаем)

- `live_events` — таблица с RLS admin-only, slug, kinescope_video_id, access_rule
- `live-resolve` — Edge Function: slug → auth → canonical access → kinescope_video_id
- `/live/:slug` — ProtectedRoute → LiveEvent.tsx → вызов live-resolve
- AdminLiveEvents.tsx — CRUD эфиров
- BroadcastTemplateDialog — поддержка `template_type='webinar_invite'` + `live_event_id`
- telegram-mass-broadcast — batch-запись в telegram_messages + audit_logs с meta
- BroadcastsTabContent — кликабельные карточки истории + Dialog деталей + regex-очистка preview

---

## Фаза 1 — Миграции БД

### 1.1 Расширение `live_events`

```sql
ALTER TABLE public.live_events
  ADD COLUMN invite_mode TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN direct_access_allowed BOOLEAN NOT NULL DEFAULT true;
```

Значения `invite_mode`: `none` | `optional_one_time` | `required_one_time` — единый enum во всех слоях.

### 1.2 Таблица `live_access_links`

```sql
CREATE TABLE public.live_access_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id),
  user_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'created',
  expires_at TIMESTAMPTZ NOT NULL,
  sent_via TEXT,            -- 'telegram' | 'email'
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_opened_by_user_id UUID,
  last_opened_at TIMESTAMPTZ,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Ограничение уникальности**: один активный токен на user+event:

```sql
CREATE UNIQUE INDEX idx_live_access_links_active_unique
  ON public.live_access_links(user_id, live_event_id)
  WHERE status IN ('created', 'sent');
```

Статусы: `created`, `sent`, `opened`, `consumed`, `expired`, `revoked`, `mismatch`.
Token: хранится только SHA-256 hash. Raw token — никогда.

При reissue: старый токен → `revoked`, новый → единственный активный.

Индексы: `token_hash`, `live_event_id`, `user_id`, `status`, `expires_at`.
RLS: admin-only. Обычные пользователи не читают таблицу.

### 1.3 Таблица `live_access_proofs`

```sql
CREATE TABLE public.live_access_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id),
  user_id UUID NOT NULL,
  link_id UUID REFERENCES public.live_access_links(id),
  proof_type TEXT NOT NULL DEFAULT 'invite_consumed',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_live_access_proofs_active
  ON public.live_access_proofs(user_id, live_event_id)
  WHERE expires_at > now();
```

- **Кто создаёт**: `live-token-validate` при action=`consume` (после полного success path).
- **Кто читает**: `live-resolve` при `invite_mode='required_one_time'`.
- **TTL**: задаётся при создании (default 24 часа от момента consume). После истечения proof невалиден → повторный вход требует новую ссылку.
- RLS: admin-only + backend service role.

### 1.4 TTL ссылок (нормы)

- Default TTL invite link: **72 часа** от создания.
- Если пользователь открыл ссылку до логина, TTL продолжает тикать. Если залогинился в пределах TTL — ссылка валидна.
- После истечения → статус `expired`, вход невозможен, нужен reissue.
- Default TTL proof: **24 часа** от consume. Refresh страницы `/live/:slug` в пределах TTL работает.

---

## Фаза 2 — Edge Function `live-token-validate`

Единая функция с разделением по `action`. Точные контракты:

### action = `create`

- **Кто вызывает**: broadcast send flow (telegram-mass-broadcast / email-mass-broadcast) или admin UI (reissue).
- **Вход**: `{ action: "create", live_event_id, user_id, ttl_hours?, sent_via? }`
- **Логика**: генерирует `crypto.randomUUID()`, хеширует SHA-256, проверяет existing active link → если есть, revoke старый. Вставляет новую запись.
- **Выход**: `{ token: "<raw>", link_id, expires_at }` — raw token возвращается только вызывающему backend, никогда клиенту напрямую.
- **Audit**: `live_link_created`

### action = `validate`

- **Кто вызывает**: фронтенд `/live-access/:token` через backend.
- **Вход**: `{ action: "validate", token: "<raw>" }` + JWT в Authorization.
- **Логика** (строгий порядок):
  1. Hash token → найти link
  2. `token_not_found` если нет
  3. `already_used` если status=`consumed`
  4. `token_expired` если expires_at < now
  5. `token_revoked` если status=`revoked`
  6. Проверить JWT → `auth_required` если нет user
  7. Сравнить user_id → `token_mismatch` если не совпадает
  8. Проверить event exists + published
  9. Canonical access check через `resolveEffectiveProductAccess`
  10. `access_denied` если нет доступа
  11. **Только здесь** → consume
- **Выход**: `{ status: "ok", redirect_slug }` или `{ status: "<error_code>" }`
- **НЕ consume на шаге validate без полного прохождения**

### action = `consume` (внутренний, вызывается из validate)

- **Когда**: только после success path всех проверок (auth + user match + token valid + event published + canonical access valid).
- **Что делает**:
  - link.status → `consumed`, consumed_at = now()
  - Создаёт запись в `live_access_proofs` (TTL 24ч)
  - Audit: `live_link_consumed`

### action = `revoke`

- **Кто имеет право**: admin (проверка `has_role_v2`).
- **Вход**: `{ action: "revoke", link_id }` + admin JWT.
- **Логика**: status → `revoked`, revoked_at = now().
- **Audit**: `live_link_revoked`

### action = `reissue`

- **Кто имеет право**: admin.
- **Вход**: `{ action: "reissue", link_id }` или `{ action: "reissue", user_id, live_event_id }` + admin JWT.
- **Логика**: revoke старый → create новый. Возвращает новый raw token для повторной отправки.
- **Audit**: `live_link_revoked` + `live_link_created`

---

## Фаза 3 — Доработка `live-resolve`

Добавить ветку для `invite_mode`:

```
existing branches (сохраняются)...

// НОВАЯ ВЕТКА: после auth check, перед canonical access
if (event.invite_mode === 'required_one_time' && !event.direct_access_allowed) {
  // Проверить наличие valid proof в live_access_proofs
  const proof = SELECT FROM live_access_proofs
    WHERE user_id = userId AND live_event_id = event.id AND expires_at > now()
    LIMIT 1;

  if (!proof) {
    return { status: 'invite_required' }; // 403
  }
  // proof найден → продолжить canonical access check
}

// existing canonical access check...
```

Для `invite_mode='optional_one_time'`: прямой доступ по canonical access разрешён, proof не требуется.
Для `invite_mode='none'`: поведение как сейчас.

---

## Фаза 4 — Frontend: `/live-access/:token`

Новый файл `src/pages/LiveAccessEntry.tsx`. Route в App.tsx: `/live-access/:token`.

Состояния: `loading`, `auth_required`, `token_not_found`, `already_used`, `token_expired`, `token_revoked`, `token_mismatch`, `access_denied`, `redirecting`, `error`.

Flow:

1. Если нет session → redirect to `/auth?redirectTo=/live-access/:token`
2. После login → вызов `live-token-validate` с action=`validate`
3. При `ok` → redirect to `/live/:slug`

**Сценарий refresh после redirect**: пользователь на `/live/:slug` обновляет страницу → `live-resolve` проверяет proof в БД → proof valid (TTL 24ч) → доступ сохраняется. После истечения proof → `invite_required` → нужна новая ссылка.

---

## Фаза 5 — Персонализация рассылок

### telegram-mass-broadcast

Для шаблонов с `template_type='webinar_invite'`:

- В цикле отправки для каждого получателя:
  1. Вызов `live-token-validate` action=`create` → получение raw token
  2. Формирование персонального URL: `${origin}/live-access/${rawToken}`
  3. Подстановка в кнопку вместо статического URL
- **Batch-safe**: если create failed для одного получателя → логируем ошибку на recipient-level, продолжаем остальных, инкрементируем failed.
- В `telegram_messages.meta`: хранить `{ broadcast: true, link_id: "<uuid>" }` — НЕ raw token, НЕ полный URL.
- В общем `audit_logs.meta`: хранить template-level данные, counts, filters. Персональные URL — НЕ хранить.

### email-mass-broadcast

Аналогичная логика для email-канала.

---

## Фаза 6 — Admin UI доработки

### AdminLiveEvents.tsx

- В форму добавить `invite_mode` (select: none / optional_one_time / required_one_time) и `direct_access_allowed` (switch).
- Секция «Пригласительные ссылки» для каждого эфира:
  - Таблица invite links с фильтрами: status, channel (telegram/email), user/profile search, date range.
  - Действия: revoke, reissue.

### BroadcastsTabContent.tsx

Reuse-check: уже реализовано — кликабельные карточки, Dialog с деталями, regex-очистка. Дозавершить:

- Различие трёх уровней отображения:
  1. **Шаблон рассылки** — template_type, live_event_id
  2. **Кампания/отправка** — audit_log запись, sent/failed, дата
  3. **Персональная доставка** — per-recipient в telegram_messages
- В Dialog деталей показать live_event_id → название эфира, если есть.

---

## Фаза 7 — Security правила

### Где персональный URL хранится


| Место                           | Что хранится             | Raw URL                      |
| ------------------------------- | ------------------------ | ---------------------------- |
| `live_access_links.token_hash`  | SHA-256 hash             | НЕТ                          |
| `telegram_messages.meta`        | `link_id` (UUID)         | НЕТ                          |
| `audit_logs.meta` (общий)       | template-level, counts   | НЕТ                          |
| email delivery history          | `link_id`                | НЕТ                          |
| Telegram payload (при отправке) | Полный URL (одноразовый) | ДА (необходимо для доставки) |


Raw URL существует только в runtime при генерации и в доставленном сообщении. В БД хранится только hash и link_id.

### RLS

- `live_access_links`: admin-only
- `live_access_proofs`: admin-only (чтение через service role в live-resolve)
- `live_events`: admin-only (сохраняется)

---

## Фаза 8 — Audit events


| Action                               | Actor                                     |
| ------------------------------------ | ----------------------------------------- |
| `live_link_created`                  | system (broadcast) / user (admin reissue) |
| `live_link_sent`                     | system                                    |
| `live_link_opened`                   | user (при validate, до consume)           |
| `live_link_consumed`                 | user                                      |
| `live_link_expired`                  | system                                    |
| `live_link_revoked`                  | user (admin)                              |
| `live_link_mismatch`                 | user                                      |
| `live_access_attempt/granted/denied` | user (сохраняется)                        |


---

## DoD

1. `/live/:slug` — базовый flow сохранён и не сломан
2. Одноразовая ссылка генерируется per-recipient, raw token в БД не хранится
3. Правильный пользователь после логина проходит по ссылке → consumed → proof → redirect → player
4. Повторное открытие consumed link → `already_used`
5. Чужой пользователь → `token_mismatch`
6. Истёкшая ссылка → `token_expired`
7. Revoked → `token_revoked`
8. `required_one_time` + прямой заход на `/live/:slug` без proof → `invite_required`
9. **Refresh после redirect**: пользователь на `/live/:slug` обновляет страницу → proof valid → доступ сохраняется. Proof истёк → `invite_required`.
10. **Reissue**: admin перевыпускает → старая ссылка `revoked` + не работает → новая работает → audit: `live_link_revoked` + `live_link_created` + `live_link_sent`
11. Рассылки видны в переписке, preview чистый, детали открываются
12. Kinescope URL не попадает ни в payload, ни в audit

---

## Файлы


| Файл                                                          | Действие                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `supabase/migrations/xxx.sql`                                 | live_events ALTER + live_access_links + live_access_proofs + индексы + RLS |
| `supabase/functions/live-token-validate/index.ts`             | Новая: create/validate/consume/revoke/reissue                              |
| `supabase/functions/live-resolve/index.ts`                    | Добавить ветку invite_mode + proof check                                   |
| `supabase/functions/telegram-mass-broadcast/index.ts`         | Per-recipient token generation для webinar_invite                          |
| `supabase/functions/email-mass-broadcast/index.ts`            | Аналогично                                                                 |
| `src/pages/LiveAccessEntry.tsx`                               | Новая: token entry page                                                    |
| `src/pages/LiveEvent.tsx`                                     | Добавить состояние `invite_required`                                       |
| `src/pages/admin/AdminLiveEvents.tsx`                         | invite_mode/direct_access + секция invite links                            |
| `src/components/admin/communication/BroadcastsTabContent.tsx` | Дозавершить: уровни отображения                                            |
| `src/App.tsx`                                                 | Route `/live-access/:token`                                                |
