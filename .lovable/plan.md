# План: Live/Video MVP — Protected Page + Entitlement Gate + Тип шаблона «Приглашение на вебинар»

## Проблема
Нужен MVP для доступа к видеоэфирам Kinescope: protected page + entitlement gate + приглашения через существующую систему рассылок. Без дублирования UI и send-flow.

## Архитектурные решения (зафиксированные)

### Источник истины по доступу
**`live_events`** — единственный источник истины для доступа к эфиру.
- `live_events.product_id` определяет, какой продукт даёт право входа.
- `live_events.access_rule` (JSONB) определяет режим и гранулярность проверки.
- `broadcast_templates` — только carrier/preview. Шаблон **не хранит и не переопределяет** правило доступа. В UI шаблона access_rule показывается read-only из привязанного live_event.

### RLS для live_events
- Прямой SELECT/INSERT/UPDATE/DELETE — **только для админов** (через `has_role_v2(auth.uid(), 'admin')`).
- Пользователь **не может** читать таблицу `live_events` напрямую.
- Пользовательские данные эфира приходят **только** через secure resolver.

### Cardinality
- Один `product_id` может иметь **много** `live_events`. Нет скрытого ограничения «один продукт = один эфир».
- `product_id` — required (nullable=false), т.к. без привязки к продукту невозможна проверка доступа.

### access_rule JSON-контракт
```jsonc
{
  "mode": "all" | "product" | "tariff",
  "product_id": "uuid | null",
  "tariff_id": "uuid | null"
}
// Валидация:
// mode='all'     → product_id=null, tariff_id=null (доступ всем authenticated)
// mode='product' → product_id required, tariff_id=null
// mode='tariff'  → product_id required, tariff_id required
```

### Edge Function: условное создание
**STOP-guard**: перед реализацией проверить, можно ли собрать secure resolver через existing backend layer (RPC / existing edge function) без утечки `kinescope_video_id`. Новая edge function `live-resolve` создаётся **только если** existing слой не гарантирует:
- скрытие kinescope_video_id до access check
- server-side entitlement validation
- audit logging

## Фазы

### Фаза 1 — Миграция БД

**Новая таблица `live_events`:**
```sql
CREATE TABLE public.live_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  kinescope_video_id TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  access_rule JSONB NOT NULL DEFAULT '{"mode":"product","product_id":null,"tariff_id":null}',
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | scheduled | live | ended
  is_published BOOLEAN NOT NULL DEFAULT false,
  scheduled_at TIMESTAMPTZ,
  replay_enabled BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: admin-only direct access
ALTER TABLE public.live_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to live_events"
  ON public.live_events FOR ALL
  TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));
-- Нет policy для обычных пользователей. Данные — только через resolver.
```

**Расширение `broadcast_templates`:**
```sql
ALTER TABLE public.broadcast_templates
  ADD COLUMN template_type TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN live_event_id UUID REFERENCES public.live_events(id);
-- template_type: 'general' | 'webinar_invite'
-- live_event_id: nullable для general, required для webinar_invite (валидация на UI/app уровне)
```

**Расширение `broadcast_templates` для тарифного фильтра аудитории:**
```sql
ALTER TABLE public.broadcast_templates
  ADD COLUMN targeting_tariff_id UUID REFERENCES public.tariffs(id);
```

### Фаза 2 — Secure Resolver

**Условие**: создать `live-resolve` edge function (или RPC), если existing слой не покрывает требования (см. STOP-guard выше).

**Контракт resolver:**
- Вход: `slug` + JWT (auth user)
- Branch order:
  1. `slug exists?` → нет → `{ status: 'not_found' }`
  2. `is_published = true?` → нет → `{ status: 'unpublished' }`
  3. `user authenticated?` → нет → `{ status: 'auth_required' }`
  4. `access valid?` (через canonical access helper: `resolveEffectiveProductAccess` или equivalent entitlement check по `live_events.product_id` + `access_rule`) → нет → `{ status: 'access_denied' }`
  5. Всё ок → `{ status: 'ok', title, description, kinescope_video_id, event_status, replay_enabled }`
- `kinescope_video_id` **не возвращается** при любом статусе кроме `ok`.
- Audit: логирует в `audit_logs`:
  - `live_access_attempt` (каждый запрос)
  - `live_access_granted` / `live_access_denied` / `live_access_not_found` / `live_access_unpublished`

**Canonical access check**: resolver использует текущий canonical valid-access path (entitlements + subscriptions_v2), **не** создаёт параллельный access SoT. Для `mode='tariff'` дополнительно проверяет tariff_id подписки.

### Фаза 3 — Live Page (`/live/:slug`)

Новая страница, обёрнутая в `ProtectedRoute` (login redirect с `redirectTo`).

**Состояния:**
1. `loading` — запрос к resolver
2. `not_found` — slug не найден (отличается от denied)
3. `unpublished` — событие не опубликовано (отличается от denied)
4. `access_denied` — нет доступа, deny screen без kinescope данных
5. `scheduled` — событие запланировано, показать дату
6. `live` / `replay` — Kinescope player через existing `useKinescopePlayer`

Route: регистрация в `App.tsx` внутри existing routing structure.

### Фаза 4 — Расширение UI шаблонов (existing broadcast system)

**`BroadcastTemplateDialog.tsx` — новый тип шаблона:**
- Селектор типа: Обычная рассылка / Приглашение на вебинар
- Для типа `webinar_invite`:
  - Селектор live_event (из `live_events` где `is_published = true`)
  - При выборе live_event:
    - `button_url` вычисляется автоматически из `live_event.slug` → `/live/{slug}`. **Ручной ввод URL запрещён** для этого типа.
    - `button_text` предзаполняется, но редактируется
    - Кнопка-ссылка обязательна (нельзя убрать)
  - **Access rule preview** (read-only из live_event):
    - mode=all → «Ссылка откроется всем авторизованным пользователям»
    - mode=product → «Ссылка откроется только пользователям с доступом к продукту X»
    - mode=tariff → «Ссылка откроется только пользователям с тарифом Y продукта X»
  - **Validation guard**: нельзя сохранить webinar_invite без выбранного live_event

**`BroadcastSendDialog.tsx` — добавить тарифный фильтр + access preview:**
- Добавить селектор тарифа (зависимый от выбранного продукта) в existing фильтры аудитории
- Для webinar_invite: показать read-only блок «Кому разрешён вход» из live_event.access_rule
- Визуально разделить: «Кому отправляем» (targeting) vs «Кому доступен вход» (access — read-only)
- **Send guard**: для webinar_invite disabled send если нет привязанного live_event

**`BroadcastTemplateCard.tsx`:**
- Badge «Вебинар» для webinar_invite
- Preview access_rule из привязанного live_event

### Фаза 5 — Админ-конфигурация Live Events

**Встроить в existing admin navigation section** (не отдельный модуль).
Добавить пункт в existing admin menu, например в секцию интеграций или контента.

Минимальная страница:
- Список эфиров (CRUD)
- Поля: title, slug, kinescope_video_id, product (селектор из products_v2), access_rule (mode + product/tariff селекторы), status, is_published, scheduled_at, replay_enabled
- Кнопка «Создать приглашение» → открывает BroadcastTemplateDialog с:
  - type = webinar_invite
  - live_event_id prefilled
  - title/button prefilled
  - **Не создаёт шаблон автоматически** — только prefill, пользователь подтверждает save

### Фаза 6 — Отправка через existing каналы

**Без нового send-flow:**
- `telegram-mass-broadcast` — добавить фильтрацию по `tariff_id` (если указан в targeting)
- `email-mass-broadcast` — аналогично добавить `tariff_id`
- Для webinar_invite `button_url` = платформенная ссылка `/live/:slug`
- **Kinescope URL/reference НЕ попадает** в: message text, email HTML, button_url, preview, payload рассылки

### Фаза 7 — Audit

Внутри resolver, логирование в existing `audit_logs`:
- `live_access_attempt` — каждый запрос
- `live_access_granted` — доступ разрешён
- `live_access_denied` — доступ запрещён
- `live_access_not_found` — slug не найден
- `live_access_unpublished` — событие не опубликовано
- Actor: `actor_type = 'user'`, `actor_user_id` из JWT

## Файлы

| Файл | Действие |
|------|----------|
| `supabase/migrations/xxx_live_events.sql` | Новая таблица + расширение broadcast_templates |
| `supabase/functions/live-resolve/index.ts` | Новый edge function — secure resolver (условно, см. STOP-guard) |
| `src/pages/LiveEvent.tsx` | Новая страница /live/:slug |
| `src/pages/admin/AdminLiveEvents.tsx` | Админ-страница (встроена в existing admin section) |
| `src/App.tsx` | Регистрация маршрутов |
| `src/components/admin/communication/BroadcastTemplateDialog.tsx` | Тип шаблона + webinar fields |
| `src/components/admin/communication/BroadcastTemplateCard.tsx` | Badge + preview |
| `src/components/admin/communication/BroadcastSendDialog.tsx` | Тарифный фильтр + access preview |
| `supabase/functions/telegram-mass-broadcast/index.ts` | Добавить tariff_id фильтрацию |
| `supabase/functions/email-mass-broadcast/index.ts` | Добавить tariff_id фильтрацию |

## Add-only guard
- Не менять existing send mutations logic (только добавить tariff filter)
- Не менять entitlements, access_rules, products_v2
- Не менять existing шаблоны в БД
- Source of truth по доступу = entitlements/subscriptions_v2 (canonical), не Telegram membership
- targeting_filter и access_rule разделены на уровне данных и runtime: фильтр рассылки не влияет на доступ по ссылке

## DoD

### Функциональные проверки
- [ ] `/live/:slug` требует логин (redirectTo работает)
- [ ] Entitlement check на уровне resolver, не client-side only
- [ ] `kinescope_video_id` не отдаётся без valid access
- [ ] Deny state показывается без утечки video config
- [ ] Состояние `not_found` отличается от `access_denied`
- [ ] Состояние `unpublished` отличается от `access_denied`
- [ ] Live → Replay без смены маршрута и access-модели

### Шаблоны и рассылки
- [ ] Шаблон типа «Приглашение на вебинар» создаётся в существующем UI рассылок
- [ ] Для webinar_invite: URL кнопки вычисляется автоматически, ручной ввод невозможен
- [ ] Для webinar_invite: кнопка-ссылка обязательна
- [ ] Для webinar_invite: нельзя сохранить/отправить без привязанного live_event
- [ ] Access rule preview (read-only) отображается из live_event
- [ ] Тарифный фильтр работает в диалоге отправки

### Proof по каналам доставки
- [ ] Telegram сообщение содержит только platform link `/live/:slug`
- [ ] Email содержит только platform link `/live/:slug`
- [ ] Kinescope URL/video_id **нигде** не присутствует в payload рассылки, preview, HTML

### Runtime-сценарий «получил сообщение, но нет доступа»
- [ ] Пользователь попал в targeting_filter
- [ ] Получил сообщение (Telegram или Email)
- [ ] Открыл ссылку `/live/:slug`
- [ ] Залогинился
- [ ] Не имеет нужного entitlement/подписки
- [ ] Получил deny state без утечки video config

### Audit
- [ ] `live_access_granted` / `live_access_denied` / `live_access_not_found` / `live_access_unpublished` логируются
- [ ] Actor = user из JWT

### Архитектура
- [ ] `live_events` — единственный SoT для access_rule
- [ ] `broadcast_templates` не хранит и не переопределяет access_rule
- [ ] Прямой доступ к `live_events` — admin-only (RLS)
- [ ] Canonical access helpers переиспользованы (не параллельный SoT)
- [ ] Админ-страница встроена в existing admin navigation