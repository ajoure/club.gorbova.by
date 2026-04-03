# да, согласен, с учетом правок:

&nbsp;

1. **Не ослабляй текущую модель доступа из-за product_id nullable без явного migration mapping.**
  Если live_events.product_id переводится в legacy/fallback, нужно в плане прямо добавить:
  &nbsp;
  - backfill/mapping для уже созданных эфиров;
  - правило, как существующие записи превращаются в live_event_access_rules;
  - запрет на потерю текущего access behavior при миграции.
  &nbsp;
2. **live_event_access_rules должна стать единственным SoT для multi-access после миграции, а fallback — только временным.**
  Иначе архитектура останется раздвоенной.
  Добавь явный этап:
  &nbsp;
  - migrate old single-rule data into rules table;
  - после этого new writes идут только в live_event_access_rules;
  - legacy access_rule/product_id читаются только для старых записей до завершения backfill.
  &nbsp;
3. **Для multi-rule access нужен точный приоритет проверки и дедупликации.**
  Зафиксируй:
  &nbsp;
  - если есть правило product_id=X, tariff_id=NULL, то более узкие правила для этого же продукта уже избыточны;
  - UI должен либо запрещать такие комбинации, либо автоматически схлопывать их;
  - нельзя хранить конфликтующие/дублирующие rules.
  &nbsp;
4. **Multi-select тарифов лучше хранить как отдельные строки, как ты и предложил, но это нужно прямо закрепить в UI/DB mapping.**
  То есть:
  &nbsp;
  - один продукт + 3 тарифа = 3 строки в live_event_access_rules
  - “все тарифы продукта” = 1 строка с tariff_id=NULL
    Это нужно прописать явно, чтобы подрядчик не ушёл в JSON внутри строки.
  &nbsp;
5. **Pre-publish validation должна учитывать не только наличие kinescope_video_id, но и Kinescope readiness.**
  Добавь в checklist:
  &nbsp;
  - выбранный/введённый kinescope_video_id реально существует или валидируется через integration layer;
  - если видео не найдено/недоступно — publish blocked.
  &nbsp;
6. **Если kinescope-api остаётся “без изменений”, это нужно подтвердить достаточностью current actions.**
  В плане сейчас написано “без изменений, уже достаточен”. Лучше явно добавить:
  &nbsp;
  - reuse existing list_projects + list_videos
  - manual fallback для video_id
  - отсутствие automation по live creation признано ограничением, а не забыто.
  &nbsp;
7. **Статус Запись доступна не должен зависеть только от status='ended' на уровне UI.**
  Правильнее:
  &nbsp;
  - setting можно включить заранее как намерение;
  - но фактическая доступность записи пользователю наступает только после ended и валидной Kinescope replay source.
    Иначе UX будет странным. Лучше разделить:
  - “Разрешить доступ к записи после завершения”
  - фактический replay availability
  &nbsp;
8. **Опубликован должен быть не просто switch, а результат readiness-check.**
  В плане стоит добавить:
  &nbsp;
  - publish action валидирует всё и либо включает публикацию, либо показывает список блокеров;
  - не просто toggle без контекста.
  &nbsp;
9. **Нужен явный summary block “Как это будет работать для пользователя”.**
  В карточке/форме эфира показывать:
  &nbsp;
  - доступ у кого;
  - нужен ли персональный invite;
  - доступна ли запись;
  - как пользователь войдёт: напрямую или только по ссылке.
    Это снимет основную путаницу из текущего UI.
  &nbsp;
10. **Для BroadcastTemplateDialog нужен не только empty-state, но и возвратный flow после создания эфира.**
  Зафиксируй:

&nbsp;

&nbsp;

&nbsp;

- “Создать эфир” открывает /admin/live-events;
- после сохранения эфир можно выбрать без ручного перезахода/потери формы, если это возможно;
- если нет — хотя бы явно написать, что нужен refresh списка.

&nbsp;

&nbsp;

&nbsp;

11. **Token picker bugfix не смешивай с empty dropdown of live events.**
  В плане их надо держать как 2 независимых проблемы:

&nbsp;

&nbsp;

&nbsp;

- dropdown пуст из-за отсутствия данных;
- token picker/dropdown interaction bug inside Dialog.
  Это важно для DoD и proof.

&nbsp;

&nbsp;

&nbsp;

12. **AdminLiveEvents должен быть встроен в AdminLayout без потери existing admin guards.**
  Прямо зафиксируй:

&nbsp;

&nbsp;

&nbsp;

- route остаётся под admin-only protection;
- sidebar/title/breadcrumb работают как у остальных admin pages.

&nbsp;

&nbsp;

&nbsp;

13. **Нужен отдельный smoke-test на multi-rule с несколькими продуктами и смешанной логикой тарифов.**
  Не только “2 продукта, у одного 2 тарифа”, а конкретно:

&nbsp;

&nbsp;

&nbsp;

- продукт A — все тарифы;
- продукт B — только тарифы X,Y;
- пользователь с A проходит;
- пользователь с B+X проходит;
- пользователь с B+Z не проходит.

&nbsp;

&nbsp;

&nbsp;

14. **Host flow ограничение нужно вынести в явный раздел “что не автоматизировано”.**
  Сейчас это есть, но лучше жёстче:

&nbsp;

&nbsp;

&nbsp;

- host/instructor flow через Kinescope console;
- viewer flow через платформу;
- в текущем спринте host automation не обещается.

&nbsp;

&nbsp;

&nbsp;

15. **Kinescope Video ID как fallback-поле лучше скрывать по умолчанию.**
  В плане запиши:

&nbsp;

&nbsp;

&nbsp;

- default UX = выбор проекта/видео;
- manual ID — только в “Расширенные настройки”.
  Это важный UX-фикс.

&nbsp;

&nbsp;

&nbsp;

16. **DoD нужно расширить proof по sidebar/navigation и by-role сценариям.**
  Добавь:

&nbsp;

&nbsp;

&nbsp;

- admin видит страницу в sidebar и открывает её;
- шаблон вебинара видит созданный эфир;
- пользователь с нужным multi-rule доступом входит;
- пользователь без доступа не входит;
- ограничения host flow отражены в UI.

&nbsp;

&nbsp;

В остальном направление верное: semi-auto Kinescope, нормальная навигация, multi-rule access и human-readable workflow — это именно то, чего сейчас не хватает.

&nbsp;

План: Перестройка Live Events — навигация, множественный доступ, Kinescope интеграция, UX

## Kinescope API Discovery — факты

### Что есть в API (подтверждено)

- **v1/projects** — CRUD проектов (GET/POST/PUT/DELETE). Работает, проверено реальным вызовом. 28 проектов в аккаунте.
- **v1/videos** — CRUD видео, загрузка, получение embed/play/hls ссылок. Поля: `id`, `project_id`, `play_link`, `embed_link`, `hls_link`, `status`, `duration`.
- **v1/projects/{id}/videos** — список видео в проекте.
- **Embed URL** — формируется как `https://kinescope.io/embed/{video_id}` — это уже используется в системе.

### Что указано в OpenAPI spec, но НЕ документировано

- **v2/live** — тег существует в spec (`The event object: id, type: one-time|recurring`), но ни одного endpoint path (`/v2/live/...`) в spec не описано.
- **v2/live/restreams** — тег есть, paths нет.
- **v1/speak/rooms** — тег есть (Speak = вебинарная комната Kinescope), paths не документированы.

### Вывод

**Full auto (Mode A) невозможен** на основании имеющейся документации. Нет подтверждённых endpoints для:

- создания live stream/event через API
- получения RTMP credentials через API  
- получения host URL через API
- управления записью через API

**Выбранный режим: Mode B — semi-auto.**

Kinescope используется как video hosting + embed player. Создание live stream / настройка RTMP выполняется в консоли Kinescope. Наша система получает `video_id` (или `embed_link`) и управляет доступом.

---

## Единый продуктовый сценарий (backbone)

```text
1. Админ создаёт эфир в системе
2. Привязывает Kinescope video/stream (ручной ID или выбор из списка видео)
3. Настраивает множественные правила доступа (продукты + тарифы)
4. Выбирает режим приглашений
5. Публикует эфир (с pre-publish validation)
6. Создаёт шаблон рассылки и отправляет приглашения
7. Пользователь входит по ссылке (viewer flow)
8. После завершения — запись доступна по тем же access rules
```

Host/instructor flow — вне текущего спринта (Kinescope API не даёт host URL, преподаватель работает через Kinescope native console).

---

## Scope текущего спринта vs Follow-up

### Current sprint

- Навигация: Live Events в sidebar
- Multi-rule access model (таблица `live_event_access_rules`)
- UI конструктор правил доступа
- Semi-auto Kinescope (выбор из списка видео + ручной fallback)
- Pre-publish validation
- UX-тексты на русском
- Empty state + CTA в BroadcastTemplateDialog
- Token picker bugfix
- Smoke-test flow

### Follow-up (не в этом спринте)

- Host/instructor automation (зависит от Kinescope API v2/live/speak)
- Kinescope webhook для автоматического определения начала/конца эфира
- Advanced moderation
- Analytics

---

## Фаза 1 — Навигация

### AdminSidebar: добавить пункт

В `src/hooks/useAdminMenuSettings.tsx`, группа `service`, добавить:

```typescript
{ id: "live-events", label: "Эфиры", path: "/admin/live-events", icon: "Video", order: 6.5, permission: "content.edit" }
```

Добавить `Video` в `MENU_ICONS`.

### AdminLayout route fix

В `src/App.tsx` строка 304: обернуть `AdminLiveEvents` в `AdminLayout` (сейчас без неё).

### routeToTitle

В `src/components/layout/AdminLayout.tsx`: добавить `'/admin/live-events': 'Эфиры'`.

---

## Фаза 2 — Multi-rule access model

### Миграция: таблица `live_event_access_rules`

```sql
CREATE TABLE public.live_event_access_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  tariff_id UUID REFERENCES public.tariffs(id),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(live_event_id, product_id, tariff_id)
);

CREATE INDEX idx_live_event_access_rules_event ON public.live_event_access_rules(live_event_id);

ALTER TABLE public.live_event_access_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage live_event_access_rules"
  ON public.live_event_access_rules FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));
```

### Миграция: make `product_id` nullable на `live_events`

```sql
ALTER TABLE public.live_events ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.live_events ALTER COLUMN kinescope_video_id DROP NOT NULL;
```

`product_id` остаётся как legacy fallback. Source of truth переносится в `live_event_access_rules`.

### `live-resolve`: обновить access check

Новая логика:

```text
1. Загрузить rules из live_event_access_rules WHERE live_event_id = event.id
2. Если rules пусты — fallback на legacy access_rule
3. Для каждого rule: проверить product access через resolveEffectiveProductAccess
4. Если rule.tariff_id задан — дополнительно проверить tariff match
5. Доступ = хотя бы одно rule matched
```

---

## Фаза 3 — Semi-auto Kinescope integration

### Расширить `kinescope-api` Edge Function

Добавить action `list_videos_for_project` — уже есть как `list_videos`. Достаточно текущего API.

### UI: Kinescope-блок в форме эфира

Два режима:

- **Выбрать из Kinescope** — Select проекта → Select видео из проекта → auto-fill `kinescope_video_id`
- **Ввести вручную** — текстовое поле (advanced/fallback)

По умолчанию — режим выбора. Ручной ввод — в секции "Расширенные настройки".

При выборе видео — сохранять `kinescope_video_id` и `metadata.kinescope_project_id` для повторного использования.

---

## Фаза 4 — UI конструктор правил доступа

### Компонент `LiveEventAccessRulesEditor`

Заменяет текущий single-select "Правило доступа" в `AdminLiveEvents.tsx`.

```text
┌────────────────────────────────────────┐
│ Кто может войти                        │
│                                        │
│ [Продукт A]  [Все тарифы     ▼]   [✕] │
│ [Продукт B]  [VIP, Premium   ▼]   [✕] │
│                                        │
│ [+ Добавить правило]                   │
│                                        │
│ Итог: доступ у пользователей           │
│ продуктов A, B (для B — только VIP,    │
│ Premium)                               │
└────────────────────────────────────────┘
```

- Select продукта — из `products_v2`
- Multi-select тарифов для выбранного продукта — из `tariffs`
- Пустой список тарифов = любой тариф продукта
- Дедупликация: нельзя добавить одинаковый product+tariff дважды
- Audience preview — текстовое описание итогового правила

---

## Фаза 5 — UX тексты и человекочитаемые подписи

### Режим приглашений (invite_mode)


| Значение          | Текущий текст                   | Новый текст                          |
| ----------------- | ------------------------------- | ------------------------------------ |
| none              | Без приглашений                 | Без приглашений                      |
| optional_one_time | Опциональные одноразовые ссылки | Персональные ссылки можно отправлять |
| required_one_time | Обязательные одноразовые ссылки | Вход только по персональной ссылке   |


Под каждым вариантом — пояснение:

- none: "Доступ по правам аккаунта, без персональной ссылки"
- optional: "По ссылке вход удобнее, но пользователь с нужными правами может войти и без неё"
- required: "Даже при наличии прав аккаунта нужен вход через выданную ссылку"

### Переключатели

- **Опубликован** → tooltip: "Эфир виден системе и доступен по ссылке"
- **Запись доступна** → tooltip: "После завершения эфира пользователи смогут смотреть запись"
- Если status != `ended`, switch "Запись доступна" → disabled + пояснение "Эфир ещё не завершён"

---

## Фаза 6 — Pre-publish validation

Перед включением `is_published = true` — чек-лист:

1. `kinescope_video_id` заполнен
2. Хотя бы одно правило доступа задано (или legacy access_rule)
3. `title` и `slug` заполнены

Если не проходит — показать ошибки, не дать опубликовать.

---

## Фаза 7 — Структура формы эфира (workflow-экран)

Перестроить `AdminLiveEvents.tsx` dialog в секционный wizard:

1. **Основное** — Название, Slug, Описание, Дата, Статус
2. **Kinescope** — Выбор видео из аккаунта или ручной ID
3. **Кто может войти** — Конструктор правил доступа (Фаза 4)
4. **Приглашения** — Режим приглашений + пояснения (Фаза 5)
5. **Публикация и запись** — Переключатели с пояснениями + pre-publish validation
6. **Проверка готовности** — read-only чек-лист (Фаза 6)

---

## Фаза 8 — Empty state + CTA в BroadcastTemplateDialog

В `BroadcastTemplateDialog.tsx` (строки 175-206):

Если `liveEvents` загружены и пустые:

```tsx
<div className="text-center py-4 space-y-2">
  <p className="text-sm text-muted-foreground">Нет созданных эфиров</p>
  <Button variant="outline" size="sm" onClick={() => window.open('/admin/live-events', '_blank')}>
    Создать эфир
  </Button>
</div>
```

---

## Фаза 9 — Token picker bugfix

### `src/components/admin/TokenizedRichInput.tsx`

- На dropdown div добавить `onWheel={(e) => e.stopPropagation()}`
- На каждый `CommandItem` добавить `data-token-picker="true"`

### `src/components/ui/dialog.tsx`

- В `onPointerDownOutside` guard расширить проверку на `[cmdk-item]`, `[cmdk-list]`

---

## Фаза 10 — Audience/access preview

### В форме эфира

Текстовый preview: "Доступ у пользователей продуктов A, B. Для продукта C — только тарифы X, Y."

### В BroadcastTemplateDialog

После выбора эфира показать summary:

- Статус эфира (черновик / опубликован)
- Режим приглашений
- Список продуктов/тарифов доступа
- Запись вкл/выкл

---

## Фаза 11 — Host/instructor flow (зафиксировать ограничения)

Kinescope API НЕ предоставляет:

- Endpoint для создания live stream
- Host URL для преподавателя
- RTMP credentials через API

**Решение для текущего спринта:**

- Преподаватель работает через Kinescope native console (dashboard.kinescope.io)
- В `live_events.metadata` можно сохранить `host_instructions` — текстовая подсказка для ведущего
- В UI эфира — read-only секция "Для ведущего" с инструкцией

**Follow-up:** когда Kinescope откроет v2/live API — добавить автоматизацию.

---

## Smoke-test flow (обязательный)


| #   | Сценарий                                            | Ожидание                       |
| --- | --------------------------------------------------- | ------------------------------ |
| 1   | Админ создаёт эфир, видит его в sidebar и в списке  | Эфир виден                     |
| 2   | Шаблон вебинара может выбрать этот эфир             | Select показывает эфир         |
| 3   | Пустой список эфиров — показывает CTA               | "Создать эфир" кнопка          |
| 4   | Multi-rule: 2 продукта, у одного 2 тарифа           | Rules сохраняются в БД         |
| 5   | Пользователь с подходящим продуктом входит          | `live-resolve` → ok            |
| 6   | Пользователь без доступа не входит                  | `live-resolve` → access_denied |
| 7   | Pre-publish: без kinescope_video_id не опубликовать | Validation блокирует           |
| 8   | Token picker: клик/скролл работают в Dialog         | Нет серых/disabled items       |


---

## Файлы


| Файл                                                             | Действие                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/hooks/useAdminMenuSettings.tsx`                             | Добавить "Эфиры" + Video icon                                         |
| `src/App.tsx`                                                    | Обернуть AdminLiveEvents в AdminLayout                                |
| `src/components/layout/AdminLayout.tsx`                          | routeToTitle                                                          |
| `supabase/migrations/xxx_live_event_access_rules.sql`            | Новая таблица + make product_id nullable                              |
| `src/pages/admin/AdminLiveEvents.tsx`                            | Полная перестройка: секции, multi-rule, Kinescope select, pre-publish |
| `src/components/admin/live/LiveEventAccessRulesEditor.tsx`       | Новый компонент                                                       |
| `supabase/functions/live-resolve/index.ts`                       | Multi-rule access check                                               |
| `supabase/functions/kinescope-api/index.ts`                      | (без изменений, уже достаточен)                                       |
| `src/components/admin/communication/BroadcastTemplateDialog.tsx` | Empty state + summary                                                 |
| `src/components/admin/TokenizedRichInput.tsx`                    | Scroll/click fix                                                      |
| `src/components/ui/dialog.tsx`                                   | Pointer guard расширение                                              |


## DoD

1. "Эфиры" доступны из sidebar
2. Форма эфира — секционная, с human-readable текстами
3. Multi-rule access работает (несколько продуктов/тарифов)
4. `live-resolve` проверяет по новой таблице rules
5. Kinescope video выбирается из списка или вводится вручную
6. Pre-publish validation блокирует публикацию без обязательных полей
7. Empty state в шаблоне вебинара показывает CTA
8. Token picker кликабелен и скроллится
9. Audience preview показывает итог правил доступа
10. Host flow = Kinescope console (documented limitation)