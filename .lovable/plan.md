План:

# да, согласен, с учетом правок:

1. **Privacy-контракт вопросов зафиксируй жёстко.**  
Сейчас в плане остаётся двусмысленность: “только свои вопросы (или пусто)”.  
По тексту интерфейса *«Их видят модераторы и ведущий»* нужно принять один контракт и не размывать его:
  &nbsp;
  &nbsp;
  - обычный участник **не видит список чужих вопросов вообще**;
  - staff/presenter видит все;
  - показывать ли автору его собственные вопросы — зафиксируй отдельно как product decision.  
  Без этого нельзя корректно собрать ни RLS, ни proof.
2. **Не расширяй** `DELETE policy` **без необходимости.**  
В этом патче нужен только сценарий `mark-as-answered`.  
Значит:
  - `SELECT` — privacy fix;
  - `UPDATE` — только для staff/presenter;
  - `DELETE` — не трогать, если нет отдельного требования удалять вопросы.  
  Иначе лишне расширишь права.
3. **Для** `mark-as-answered` **лучше не открывать широкий UPDATE на всю таблицу.**  
Более безопасно:
  - либо отдельный RPC / edge action `mark_live_question_answered(question_id)`;
  - либо очень аккуратный UPDATE path, но тогда в отчёте явно указать риск, что staff технически сможет менять и другие поля строки.  
  Предпочтительно первое.
4. `Badge новых вопросов` **и** `badge неотвеченных` **— это не одно и то же.**  
Без отдельного per-staff read cursor / last_seen state ты можешь честно сделать только:
  - **badge количества неотвеченных**.  
  Не называй это “новые вопросы”, если не вводится отдельное состояние “последний просмотр staff”. Иначе это будет функциональная ложь.
5. `is_live_event_presenter(...)` **не придумывать заранее.**  
Сначала подтвердить реальный SoT:
  - presenter хранится в `live_events.metadata`;
  - или в отдельной колонке/связи;
  - или уже есть общий staff-guard helper.  
  В плане зафиксируй: использовать **существующий server-side guard**, а не вводить новую функцию, пока не подтверждён источник.
6. **Realtime-proof должен учитывать RLS, а не только UI.**  
Обязательно добавь в diagnose/proof:
  - обычный участник не получает чужие вопросы не только через select, но и через realtime subscription;
  - staff получает все вопросы и badge обновляется в realtime.  
  Это ключевой privacy-proof.
7. **По answered-state добавь индекс/производительность.**  
Если делаешь badge `WHERE live_event_id = ? AND is_answered = false`, добавь в план:
  - индекс по `(live_event_id, is_answered)` или эквивалентный частичный индекс.  
  Иначе на больших эфирах staff-badge будет ненужно дорогим.
8. **Desktop nickname color сформулируй точнее.**  
Это не “desktop ветка”, а баг общего chat renderer, где цвет ника в чате не применяется, хотя в participant list применяется.  
В плане так и напиши:
  - исправить **chat renderer**;
  - mobile participant list не трогать;
  - источник строго `author_nickname_color`.
9. **Proof regular user view сделай двойным.**  
Нужно показать:
  - обычный участник A не видит вопрос участника B;
  - staff видит оба вопроса.  
  Одного скрина “вижу только свои” недостаточно.
10. **В финальном отчёте раздели статусы так:**

&nbsp;

- privacy вопросов;
- badge/count;
- mark-as-answered;
- nickname color;
- что не тронуто;
- что осталось open.  
И отдельно укажи, что визуальный баг вкладки “Вопросы” в этот PATCH не входит.

11. **Stop-guard дополни:**  
если для privacy требуется менять не только RLS, но и клиентский UX обычного участника (например, полностью скрывать список и оставлять только форму), это нужно явно зафиксировать до execute, а не решать по ходу.
12. **DoD уточни формулировкой без двусмысленности:**

- обычный участник не видит чужие вопросы;
- staff/presenter видит все вопросы;
- badge показывает количество **неотвеченных**;
- mark-as-answered сохраняет статус серверно;
- цвет ника в чате совпадает с выбранным цветом и не зависит от desktop/mobile.
- &nbsp;
- PATCH: Privacy «Вопросов» + Staff-badge + Desktop nickname color

## 1. Diagnose (подтверждено tools)

**B1. Privacy «Вопросов» — главный баг (подтверждён в БД):**

- RLS SELECT policy `Users with access can read questions` на `public.live_event_questions`:
  ```
  USING (user_has_live_event_access(auth.uid(), live_event_id))
  ```
  → **любой** участник с доступом к эфиру читает **все** вопросы всех участников.
- Клиентский query в `src/components/live/LiveEventQuestions.tsx` (строки 66–71) вытягивает все вопросы без фильтра по `user_id`.
- В UI висит hint «Анонимные вопросы. Их видят модераторы и ведущий» (строка 230) — это сейчас **ложь**, контракт нарушен.

**B2. Staff badge — отсутствует:**

- В `LiveEventQuestions.tsx` нет счётчика неотвеченных, нет источника для badge на вкладке «Вопросы».
- В таблице есть `is_answered boolean NOT NULL`, нет `answered_at`, нет `answered_by`.
- Realtime publication на `live_event_questions` уже включён.
- Кнопка «Отметить как отвечен» сейчас доступна `isStaff` (admin/superadmin/employee) — это ок, но без serverside guard (UPDATE policy = `has_role_v2(auth.uid(),'admin')` — то есть **employee сейчас не может update**, расхождение UI vs RLS).

**B3. Nickname color на desktop:**

- Компонент чата один и тот же для desktop и mobile (`LiveEventComments.tsx`) — нет двух веток.
- Поле `author_nickname_color` есть в БД, но **не читается** в SELECT (строка 67) и **не применяется** к `<span>` имени (строки 273–279).
- На mobile цвет, который видит пользователь, скорее всего идёт из `RoomParticipantsList.tsx` (там `nickname_color` уже применяется через inline style). Значит баг — цвет применяется в **списке участников**, но **не в чате**. После фикса будет применяться в обеих поверхностях идентично.

## 2. Scope

**DB (миграция):**

- Заменить SELECT policy `live_event_questions` на privacy-safe (staff видит всё, обычный — только свои).
- Заменить UPDATE/DELETE policies — расширить с `admin` до staff (`admin/superadmin/employee`), чтобы UI и RLS совпадали.
- Добавить колонки `answered_at timestamptz`, `answered_by uuid`.

**Клиент:**

- `src/components/live/LiveEventQuestions.tsx` — убрать ложный hint / переписать его, добавить badge неотвеченных через `useUnansweredQuestionsCount`, расширить SELECT (`author_nickname_color`, `answered_at`, `answered_by`), записывать `answered_at/by` при toggle, сделать визуальное отделение «Отвеченные/Неотвеченные».
- `src/components/live/LiveEventComments.tsx` — добавить `author_nickname_color` в SELECT и применять inline `style={{ color }}` к имени автора (как уже сделано в `RoomParticipantsList`).
- Найти место рендера `Tabs` с триггером «Вопросы» (вероятно `src/pages/LiveEvent.tsx` или `src/components/LiveEvent.tsx`) — добавить badge на `TabsTrigger` для staff.
- Новый хук `src/hooks/useUnansweredQuestionsCount.ts` — staff-only realtime счётчик `WHERE live_event_id=? AND is_answered=false`. Для не-staff хук no-op.

**НЕ трогаем:**

- Auth / reset password.
- Access rules эфиров.
- `LiveEventReplies` (отдельный поток ответов).
- Mobile-ветку (её нет — компонент один).
- Стили вкладки «Вопросы» как таковой (B1 из предыдущей итерации — отдельный визуальный баг, в этом PATCH не закрываем).

## 3. Решение по пунктам

### B1. Privacy «Вопросов» (server-side, не только UI)

**Новая RLS SELECT policy:**

```sql
DROP POLICY "Users with access can read questions" ON public.live_event_questions;

CREATE POLICY "Staff read all, users read own"
  ON public.live_event_questions FOR SELECT TO authenticated
  USING (
    user_has_live_event_access(auth.uid(), live_event_id)
    AND (
      auth.uid() = user_id
      OR has_role_v2(auth.uid(), 'admin')
      OR has_role_v2(auth.uid(), 'employee')
      OR is_live_event_presenter(auth.uid(), live_event_id)
    )
  );
```

- Если функции `is_live_event_presenter` нет — создать её на основе `live_events.metadata->>'presenter_user_id'` в той же миграции.
- INSERT policy не трогаем (она уже корректна).

**UPDATE/DELETE policies — расширить до staff:**

```sql
DROP POLICY "Admins can update questions" ON public.live_event_questions;
CREATE POLICY "Staff can update questions"
  ON public.live_event_questions FOR UPDATE TO authenticated
  USING (
    has_role_v2(auth.uid(), 'admin')
    OR has_role_v2(auth.uid(), 'employee')
    OR is_live_event_presenter(auth.uid(), live_event_id)
  );
-- аналогично DELETE
```

**Клиент:**

- Hint переписать: «Ваш вопрос увидят только модераторы и ведущий».
- SELECT в `LiveEventQuestions.tsx` оставить как есть — RLS сам отфильтрует. Никаких client-side `eq("user_id", ...)`, чтобы не было утечки контракта.
- Список вопросов у обычного участника: показываем только его собственные (это естественно вытекает из RLS); если их нет — пусто + форма ввода.

### B2. Staff badge + answered-state

**Миграция:**

```sql
ALTER TABLE public.live_event_questions
  ADD COLUMN IF NOT EXISTS answered_at timestamptz,
  ADD COLUMN IF NOT EXISTS answered_by uuid;
```

**Хук `useUnansweredQuestionsCount(liveEventId, enabled)`:**

- `enabled = isStaff`.
- Query: `select id from live_event_questions where live_event_id=? and is_answered=false`.
- Realtime подписка на ту же таблицу, инвалидирует count.
- Для не-staff возвращает `0` без сетевого запроса.

**Badge на `TabsTrigger`:**

- В компоненте, где собраны Tabs «Чат / Вопросы / Участники», обернуть label «Вопросы» во flex с `<Badge variant="default">{count}</Badge>` (или красная точка) при `count > 0` и `isStaff`.
- Не показываем badge для текущей активной вкладки (опционально).

**Mark-as-answered:**

- Кнопка остаётся у staff. При клике пишем `is_answered`, `answered_at = now()`, `answered_by = auth.uid()`.
- В UI секционировать список: «Неотвеченные» (сверху, обычный стиль) → «Отвеченные» (снизу, `opacity-60` + иконка `CheckCircle2`). Заголовки секций показываем только staff (обычный пользователь видит максимум один-два своих).

### B3. Desktop nickname color

В `LiveEventComments.tsx`:

- В SELECT добавить `author_nickname_color`.
- В рендере имени:
  ```tsx
  <span
    className="..."
    style={comment.author_nickname_color ? { color: comment.author_nickname_color } : undefined}
  >
  ```
- Никаких эвристик; источник — строго `author_nickname_color` (snapshot в комментарии). Theme комнаты не перебивает (inline style имеет приоритет).
- Аналогично для `LiveEventQuestions.tsx` (имена авторов вопросов — для staff, который их видит).

## 4. Файлы

**Изменяемые:**

- `supabase/migrations/<new>.sql` — RLS + колонки.
- `src/components/live/LiveEventQuestions.tsx`
- `src/components/live/LiveEventComments.tsx`
- `src/hooks/useUnansweredQuestionsCount.ts` (новый)
- Файл с `Tabs` для комнаты (определю в execute — вероятно `src/pages/LiveEvent.tsx`).

**Не изменяемые:**

- `LiveEventReplies.tsx`, `RoomParticipantsList.tsx`, auth-flow, access-rules.

## 5. Порядок execute

1. Миграция: новые RLS-полиси SELECT/UPDATE/DELETE + колонки `answered_at/by`.
2. Клиент: privacy hint + расширенный select (`author_nickname_color, answered_at, answered_by`) + answered-секции.
3. Новый хук `useUnansweredQuestionsCount`.
4. Badge на `TabsTrigger` «Вопросы» (staff-only).
5. Nickname color в `LiveEventComments` и `LiveEventQuestions`.
6. Verify по DoD.

## 6. STOP-guards

Остановиться и вернуться с мини-планом, если:

- Функции `is_live_event_presenter` нет и при создании выяснится, что `presenter_user_id` хранится не в `metadata`, а в отдельной колонке/связи (требует уточнения SoT).
- В `live_event_questions` есть зависимые view/RPC (например, `get_live_event_thread`), которые ломаются после ужесточения SELECT (нужна сверка).
- В UI есть второе место, читающее `live_event_questions` для обычного пользователя (CRM `ContactWebinarsTab` — staff-only, ок; `LiveEventExportButtons` — staff-only, ок).

## 7. DoD

**Privacy:**

- Обычный участник видит во вкладке «Вопросы» только свои вопросы (или пусто) + форму отправки.
- Staff (admin/superadmin/employee) и presenter видят все вопросы текущего эфира.
- Защита на RLS, не только в UI.

**Badge:**

- Staff видит счётчик неотвеченных на `TabsTrigger` «Вопросы», обновляется в realtime, сбрасывается при mark-as-answered.
- Обычный участник badge не видит.

**Answered:**

- Staff может отметить вопрос как отвечен; пишутся `is_answered`, `answered_at`, `answered_by`.
- В списке отвеченные визуально отделены от неотвеченных.

**Nickname color:**

- В desktop-чате цвет ника совпадает с тем, что выбран в `RoomEntryDialog` и виден в списке участников.
- Источник — `author_nickname_color` snapshot.

## 8. Proof

1. Скрин: Staff view — все вопросы + badge + mark-as-answered до/после.
2. Скрин: Regular user view — только свои вопросы + hint про приватность.
3. SQL-proof: новые RLS-полиси (`pg_policy`) и попытка SELECT под обычным юзером (другого `user_id`) возвращает 0 строк.
4. Скрин: desktop-чат с разноцветными никами одного эфира.

## 9. Финальный отчёт (структура)

Раздельные блоки:

- **Privacy вопросов** — что изменено в RLS и UI.
- **Staff badge / mark-as-answered** — что добавлено в schema, hook, Tabs.
- **Desktop nickname color** — что добавлено в SELECT и рендер.
- **Что не тронуто** — auth, access rules, mobile, стили вкладки.
- **Open / deferred** — визуальный «тень»-баг вкладки «Вопросы» (B1 предыдущей итерации) и звуковой сигнал — не входят в этот PATCH.