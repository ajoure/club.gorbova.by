да, согласен, с учетом правок:

1. По payment_links_enriched_v исправь **оба** join и зафиксируй это в отчёте явно:
  - rec.user_id = pl.user_id
  - cre.user_id = pl.created_by
2. И отдельно покажи before/after SQL proof на 2–3 строках:
  - до фикса recipient_name/email = null
  - после фикса имя/email заполнены.
3. В proof по таблице «Ссылки» проверь **оба сценария**:
  - bound link → имя/email получателя отображаются;
  - public link без user_id → остаётся «Любой плательщик».
4. Это важно, чтобы не сломать корректный fallback.
5. В FormsHubTable.tsx не просто подставь ClickableContactName, а сначала проверь, какой идентификатор у него ожидается:
  - profileId
  - userId
  - contactId
6. Нужно передать тот ключ, который реально открывает карточку без лишнего поиска. Если компонент умеет брать и user_id, и profile_id, используй самый каноничный для forms-flow и зафиксируй это в отчёте.
7. Для таблицы «Анкеты и заявки» добавь ещё один guard:
  - если контакт не найден / профиль отсутствует, имя остаётся текстом, а не ломает рендер пустой ссылкой.
8. То есть:
  - есть профиль → кликабельно;
  - нет профиля → обычный текст.
9. В proof по forms покажи не только клик, но и результат:
  - клик по имени
  - открылась карточка контакта / drawer / нужный route
  - видно, что это именно тот контакт.
10. Одного скрина таблицы мало.
11. В mobile-proof для обеих таблиц отдельно проверь, что:
  - имя не ломает row layout;
  - кликабельный элемент не уезжает под соседние колонки;
  - email под именем читаем.
12. Контракт view-колонок действительно не меняй, но в отчёте всё равно отдельно перечисли:
  - какие поля остались 1:1 прежними;
  - что изменился только источник derived recipient_* и creator_*.
13. В DoD добавь ещё один пункт:
  - **исторические строки в payment links без привязанного пользователя продолжают отображаться корректно и не становятся ложноположительно “привязанными”.**

В остальном план правильный: это узкий и безопасный фикс, без вмешательства в writers, webhook, RLS и UI-контракты таблиц.

&nbsp;

## Что нашёл

### Баг 1 — "Получатель" в таблице ссылок всегда "—" / "Любой плательщик"

В view `payment_links_enriched_v` join сделан по неверному ключу:

```sql
LEFT JOIN profiles rec ON rec.id = pl.user_id      -- ❌ pl.user_id = auth.users.id
LEFT JOIN profiles cre ON cre.id = pl.created_by   -- ❌ то же
```

Канон проекта (см. `useDisplayProfiles`, memory `ID-First Logic`): `payment_links.user_id` = **auth user_id**, а в `profiles` ключ — `profiles.user_id`. SQL-проверка подтвердила: join по `id` даёт NULL, по `user_id` — корректное имя/email. Поэтому колонки `recipient_name/email` и `creator_name/email` всегда пустые → UI показывает "—" для созданных и "Любой плательщик" когда `user_id IS NULL` (это оставляем — это правильно).

### Баг 2 — В таблице "Анкеты и заявки" контакт некликабельный

`FormsHubTable.tsx`, ячейки `client` / `email` рендерят просто текст. Уже есть готовый компонент `ClickableContactName` (`src/components/admin/ClickableContactName.tsx`), который умеет открывать карточку контакта в `/admin/contacts?contact=...&from=forms`. В `FormsHubRow` уже есть поля `user_id` и `profile_id` — данные есть, просто не используются.

## План фикса

### Фикс 1 — миграция view

`CREATE OR REPLACE VIEW public.payment_links_enriched_v` с правильными join-ключами:

```sql
LEFT JOIN profiles rec ON rec.user_id = pl.user_id
LEFT JOIN profiles cre ON cre.user_id = pl.created_by
```

Сохранить `security_invoker=on`, `GRANT SELECT TO authenticated`. Контракт колонок не меняется — UI и `usePaymentLinks` не трогаем.

### Фикс 2 — кликабельный контакт в `FormsHubTable.tsx`

В `case "client"`: заменить `<div>{row.client_name}</div>` на `<ClickableContactName userId={row.user_id} profileId={row.profile_id} name={row.client_name} fromPage="forms" />`. Текст ячейки `client_email` оставляю как есть (уже отдельная колонка), но если профиль есть — кликабельный label через тот же компонент с `showEmail={false}` (только имя кликабельно).

### Фикс 3 — proof скринами

Через browser:

- `/admin/payments` → вкладка «Ссылки» → проверить колонку «Получатель» (не должно быть "—" у привязанных) и «Создал» (имя автора).
- `/admin/forms` → таблица анкет → клик по имени клиента → должна открыться карточка контакта в `/admin/contacts`.
- Скрины desktop + mobile (375).

## Файлы

**Изменю:**

- новая миграция: фикс join в `payment_links_enriched_v`
- `src/components/admin/forms/FormsHubTable.tsx` — кликабельный контакт через `ClickableContactName`

**НЕ трогаю:** writers, edge functions, RLS, hooks, контракты колонок view, дизайн карточки контакта.

## DoD

1. В `/admin/payments` → «Ссылки» колонка «Получатель» показывает имя+email для привязанных контактов; «Любой плательщик» — только если `user_id IS NULL`.
2. Колонка «Создал» показывает имя/email админа, а не "—".
3. В `/admin/forms` имя клиента в таблице — кликабельная ссылка на карточку контакта (поведение как в `/admin/payments`).
4. Скрины desktop + mobile подтверждают оба фикса.
5. Никаких изменений писателей/RLS/контракта view-колонок.