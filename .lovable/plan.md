
## PATCH: Ghost→«Без аккаунта» + скролл контакт-центра + бан-лист (план v4 — финальный)

---

### 1) EditContactDialog — Ghost → «Без аккаунта» ✅ DONE

**Файл:** `src/components/admin/EditContactDialog.tsx`
- Импорт: `Ghost` → `UserX`
- Бейдж: `Ghost` → `Без аккаунта` с `border-amber-400 text-amber-600`
- Текст подсказки: `Контакты без аккаунта не могут иметь статус «Активен» — только зарегистрированные пользователи`

**DoD:** Слово "Ghost" отсутствует в UI.

---

### 2) Скролл контакт-центра (детерминированный фикс) ✅ DONE

#### 2.1 TicketChat.tsx — scrollEndRef внутри viewport-контента

**Корневая причина:** `ScrollArea` форвардит `ref` на `ScrollAreaPrimitive.Root` (overflow:hidden). Скроллящий элемент — `Viewport` (дочерний). `scrollRef.current.scrollTop = scrollHeight` на Root ничего не делает.

**Реализованный фикс:**
```tsx
const scrollEndRef = useRef<HTMLDivElement | null>(null);
const AUTOSCROLL_THRESHOLD_PX = 120;
const lastId = visibleMessages?.at(-1)?.id ?? '';

useEffect(() => {
  if (!scrollEndRef.current) return;
  const root = scrollEndRef.current.closest('[data-radix-scroll-area-root]') as HTMLElement | null;
  const viewport = root?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
  if (viewport) {
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < AUTOSCROLL_THRESHOLD_PX;
    if (isNearBottom) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  } else {
    scrollEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }
}, [visibleMessages?.length, lastId]);

// JSX: <div ref={scrollEndRef} /> после списка сообщений внутри ScrollArea
```

**Правила:**
- `scrollEndRef` вставляется после списка сообщений, гарантированно внутри Radix viewport.
- Viewport ищется через `closest('[data-radix-scroll-area-root]')` → `querySelector('[data-radix-scroll-area-viewport]')` внутри root (детерминированно, не глобально).
- `behavior: 'auto'` (НЕ `'instant'` — невалидное значение).
- Зависимость useEffect: `[visibleMessages?.length, lastId]` — срабатывает при изменении числа сообщений И при изменении последнего сообщения (статус/редактирование).
- `AUTOSCROLL_THRESHOLD_PX = 120` — константа.
- Автоскролл выполняется ТОЛЬКО если пользователь уже внизу (threshold 120px).
- Если пользователь пролистал вверх — новые сообщения НЕ принудительно уводят вниз.

#### 2.2 InboxTabContent.tsx — mobile wrapper

- Убран `overflow-y-auto` с mobile-обёртки чата.
- Убран `overflow-y-auto overflow-x-hidden` с контейнера чата (заменён на `flex flex-col h-full min-h-0 overflow-x-hidden`).
- Цепочка контейнеров:
  - Родитель: `flex-1 min-h-0 overflow-x-hidden`
  - Контейнер чата: `flex flex-col h-full min-h-0`
  - Запрещено `overflow-hidden` на контейнере, который непосредственно ограничивает высоту чата (flex-1 min-h-0), если внутри используется ScrollArea.

**DoD (скролл):**
1. Desktop: wheel/trackpad скроллит историю сообщений.
2. Mobile (iOS/Android): свайп скроллит историю.
3. Автоскролл вниз при новом сообщении работает (только если пользователь внизу).
4. Если пользователь пролистал вверх — автоскролл НЕ срабатывает.
5. Скрытие скроллбара (`scrollbar-none`) не отключает pointer/scroll события на viewport.
6. В DevTools: скроллится именно `[data-radix-scroll-area-viewport]` (у него меняется `scrollTop`).

---

### 3) Бан-лист — полная реализация с merge и intake (TODO)

#### 3A) SQL-миграция

**Таблицы:**
```sql
CREATE TABLE public.ban_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id),
  reason text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.ban_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ban_case_id uuid NOT NULL REFERENCES public.ban_cases(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email','phone','telegram_user_id','telegram_username')),
  value text NOT NULL,
  value_norm text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ban_identifiers_unique_active
ON public.ban_identifiers(kind, value_norm)
WHERE is_active = true;
```

RLS: super_admin only (USING + WITH CHECK через `has_role_v2`).

При деактивации бан-кейса — деактивировать и все его identifiers:
```sql
UPDATE public.ban_identifiers SET is_active = false WHERE ban_case_id = _case_id;
```

**Нормализаторы (IMMUTABLE):**
- `norm_email(text)` → `lower(trim(...))`
- `norm_phone(text)` → `regexp_replace` → оставить + и цифры → `+` допускается только первым символом → пустые/короткие (<7 цифр) телефоны не сохраняются как identifier (возвращается NULL)
- `norm_tg_username(text)` → `lower(ltrim(trim(...), '@'))`

**Функция поиска бана:**
```sql
CREATE FUNCTION public.check_ban_by_identifiers(
  _email text DEFAULT NULL, _phone text DEFAULT NULL,
  _tg_user_id bigint DEFAULT NULL, _tg_username text DEFAULT NULL
) RETURNS TABLE(ban_case_id uuid, matched_kind text, matched_value text)
```
Логика: матч по `ban_identifiers.is_active=true` + `ban_cases.is_active=true`.

**Функция upsert/merge identifiers:**
```sql
CREATE FUNCTION public.ban_case_upsert_identifiers(
  _ban_case_id uuid, _identifiers jsonb
) RETURNS int
```

**Правило выбора "target case" при merge:**
- Если `ban_cases.profile_id` совпадает с текущим профилем — он target.
- Иначе target = кейс с `created_at` самым ранним (первичный источник бана).
- При конфликте `(kind,value_norm)` активного identifier из другого кейса:
  - Сначала `UPDATE ... SET ban_case_id = target` (или `SET is_active=false` на старом + INSERT в target).
  - При любом конфликте по partial unique index — делать UPDATE existing row, а не падать.
  - Деактивировать «проигравший» кейс, если в нём не осталось активных identifiers.
  - audit_log `ban_case_merged`.

**DoD merge:**
- После серии merge не существует двух активных кейсов, содержащих пересекающиеся identifiers.
- `ban_case_upsert_identifiers` никогда не падает на `unique_active`, а приводит к единственному активному identifier.

#### 3B) handle_new_user — post-signup ban-check (email-only)

В начало функции, после `_email := lower(trim(NEW.email))`:
```sql
DECLARE _ban_case_id uuid;
SELECT bc.ban_case_id INTO _ban_case_id
FROM public.check_ban_by_identifiers(_email := _email) bc LIMIT 1;

IF _ban_case_id IS NOT NULL THEN
  -- Профиль создаётся, но со статусом banned
  -- ON CONFLICT обновляет ТОЛЬКО status и updated_at (add-only, не теряет поля)
  INSERT INTO profiles (...) VALUES (..., 'banned', ...)
  ON CONFLICT (user_id) DO UPDATE SET status = 'banned', updated_at = now();

  -- Добавить email в ban_case
  PERFORM public.ban_case_upsert_identifiers(_ban_case_id,
    jsonb_build_array(jsonb_build_object('kind','email','value',NEW.email)));

  -- Audit log (SYSTEM ACTOR proof — колонки таблицы, НЕ meta)
  INSERT INTO audit_logs (
    actor_type, actor_user_id, actor_label,
    action, target_user_id, meta
  ) VALUES (
    'system', NULL, 'handle_new_user',
    'banned_access_denied', NEW.id,
    jsonb_build_object('ban_case_id', _ban_case_id, 'matched_kind', 'email', 'matched_value', _email)
  );

  RETURN NEW; -- НЕ назначаем роли
END IF;
```

**Важно:**
- `actor_type`, `actor_user_id`, `actor_label` — это колонки таблицы `audit_logs`, НЕ поля внутри `meta`.
- `ON CONFLICT` обновляет **только** `status='banned'` и `updated_at=now()` — не перезатирает другие поля.

#### 3C) ban-intake — системный intake при изменении phone/tg/email

**Файл:** `supabase/functions/ban-intake/index.ts`

**Вызывается системно**, а НЕ только из UI:
- Либо DB-trigger `AFTER UPDATE OF phone, telegram_user_id, telegram_username, email ON profiles`
- Либо централизованная edge-функция обновления профиля (UI, админка, webhooks используют её)

Алгоритм:
1. Собрать все identifiers профиля (email, phone, tg)
2. `check_ban_by_identifiers(...)`
3. Если match:
   - `profiles.status='banned'`
   - `ban_case_upsert_identifiers(matched_case, all_identifiers)` — добавит новый email/телефон в бан автоматически
   - `audit_logs`: `actor_type='system'`, `actor_user_id=NULL`, `actor_label='ban-intake'`

**DoD:**
- Кейс «новый email + banned phone» → бан + новый email добавлен в ban_identifiers.
- Бан срабатывает при изменении данных из админки, через API/edge, и через любые импорты.

#### 3D) ban-list-manage — admin операции (super_admin)

**Файл:** `supabase/functions/ban-list-manage/index.ts`

- **add(profileId, reason):** собрать ВСЕ identifiers из profiles (email, phone, telegram_user_id, telegram_username, emails[], phones[]), нормализовать, создать ban_case + upsert identifiers, `profiles.status='banned'`, audit_log (actor admin), Telegram notify.
- **remove(caseId):** `ban_cases.is_active=false` + `ban_identifiers.is_active=false WHERE ban_case_id=caseId`, audit_log. История сохраняется.
- **check(identifiers):** вернуть `{banned, caseId, matchedBy}`.

#### 3E) Guards + страница /banned

- **RLS:** Если `profiles.status='banned'` и пользователь не admin → deny all на основные таблицы приложения (минимум: products/content/entitlements/messages/payments). Явное правило, не «аналогично archived».
- **Frontend guard:** В AuthContext/ProtectedRoute — если `profiles.status === 'banned'` → редирект на `/banned`.
- **`src/pages/Banned.tsx`:** красный экран «Доступ запрещён администратором» (без раскрытия деталей бана).

**DoD:** Запросы к защищённым таблицам от banned пользователя не возвращают данные и не позволяют запись (RLS denies).

#### 3F) UI кнопка в ContactDetailSheet (super_admin)

**Файл:** `src/components/admin/ContactDetailSheet.tsx`
- Кнопка «Добавить в бан-лист» (красная pill, иконка `Ban`) — только super_admin.
- `AlertDialog`: показывает список identifiers перед подтверждением + поле «Причина».
- После успеха: бейдж «BANNED» в карточке.

---

### Итого файлов

| Артефакт | Статус | Что |
|----------|--------|-----|
| `src/components/admin/EditContactDialog.tsx` | ✅ | Ghost → «Без аккаунта» |
| `src/components/support/TicketChat.tsx` | ✅ | scrollEndRef внутри viewport, автоскролл с threshold 120px |
| `src/components/admin/communication/InboxTabContent.tsx` | ✅ | Убран overflow-y-auto на mobile, min-h-0 цепочка |
| SQL-миграция | TODO | ban_cases, ban_identifiers (+is_active, partial unique), нормализаторы (norm_phone с валидацией длины), check/upsert/merge, handle_new_user ban-check |
| `supabase/functions/ban-list-manage/index.ts` | TODO | add/remove/check |
| `supabase/functions/ban-intake/index.ts` | TODO | системный intake при phone/tg/email |
| `src/pages/Banned.tsx` | TODO | Красный экран запрета |
| `src/components/admin/ContactDetailSheet.tsx` | TODO | Кнопка «В бан-лист» + бейдж BANNED |
| Routing/guards | TODO | Редирект banned → /banned |

### DoD (финальный)

1. **Ghost→Без аккаунта:** слово "Ghost" отсутствует в UI. ✅
2. **Скролл:** ✅
   - Telegram-chat и TicketChat скроллятся на desktop/mobile.
   - Автоскролл вниз работает только если пользователь внизу (threshold 120px).
   - Если пролистал вверх — автоскролл НЕ срабатывает.
   - Скрытие скроллбара не отключает pointer/scroll события.
   - В DevTools скроллится `[data-radix-scroll-area-viewport]`.
3. **Бан-лист (TODO):**
   - Бан по email → регистрация возможна, доступ запрещён после входа.
   - Новый email + banned phone → после ввода телефона банится и новый email добавляется в тот же ban_case.
   - Деактивация кейса: `is_active=false` на case + identifiers → пользователь снова проходит guard.
   - После merge нет двух активных кейсов с пересекающимися identifiers.
   - `ban_case_upsert_identifiers` никогда не падает на `unique_active`.
   - banned пользователь не может читать/писать данные через client SDK (RLS denies).
   - `ON CONFLICT` в `handle_new_user` обновляет только `status` и `updated_at`.
   - `norm_phone`: `+` только первым символом, пустые/короткие (<7 цифр) → NULL.
4. **SYSTEM ACTOR proof:** авто-бан записан в `audit_logs` с `actor_type='system'` (колонка), `actor_user_id=NULL`, `actor_label` заполнен. НЕ внутри `meta`.
