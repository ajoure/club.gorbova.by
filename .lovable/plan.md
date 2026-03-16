# STATUS: PLAN — APPROVED WITH CORRECTION
PATCH: PATCH-STAT-4

&nbsp;

### **Обязательные правки к плану**

&nbsp;

&nbsp;

1. **removed_admin в ожиданиях указан неверно.**
  В плане сейчас для BkB и GC написано removed_admin ~0, но ранее уже было доказано:
  &nbsp;
  - BkB: removed_admin = 2
  - GC: removed_admin = 3
    Это нужно исправить в плане, иначе verify снова будет ложным.
  &nbsp;
2. **in_channel_count / in_both_count для chat_only клуба не использовать как пользовательскую метрику.**
  Для BkB это только diagnostic-only.
  В UI эти поля не должны участвовать в карточках и не должны влиять на пользовательские выводы.
3. **not_joined_chat / not_joined_channel — только diagnostic.**
  Пользовательская карточка Не вошли должна продолжать использовать один согласованный итог:
  &nbsp;
  - not_joined_any / bought_not_joined_count
    А detail по chat/channel — только для proof/debug.
  &nbsp;
4. **Верификацию сделать по двум слоям отдельно:**
  &nbsp;
  - **UI metrics**
  - **diagnostic metrics**
    Чтобы не смешивать пользовательские карточки с внутренней диагностикой.
  &nbsp;
5. **Cross-verify после execute обязателен.**
  Нужно явно проверить, что после расширения summary:
  &nbsp;
  - get_club_members_enriched
  - search_club_members_enriched
  - get_club_member_summary
    всё ещё совпадают по пользовательским метрикам:
  - В клубе
  - С доступом
  - Не вошли
  - Удалённые
  - Нарушители
  &nbsp;
6. **UI не должен начинать показывать diagnostic-поля без отдельного решения.**
  В этом патче разрешено:
  &nbsp;
  - изменить формат В клубе на regular + admins = total
  - расширить payload
    Но не добавлять новые пользовательские карточки по chat/channel без отдельного approval.
  &nbsp;
7. **Подтвердить отсутствие club-specific UI branches.**
  В финальном proof block явно показать, что один и тот же TelegramClubMembers.tsx работает через:
  &nbsp;
  - club_id
  - resource_mode
    а не через ветвление по конкретному клубу.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

### **Что нужно получить после execute**

&nbsp;

```
1. exact migration filename
2. exact changed files
3. UI metrics parity block
4. diagnostic metrics block
5. BkB proof
6. GC proof
7. cross-verify with list/search RPCs
```

&nbsp;

### **Условие приёмки**

&nbsp;

&nbsp;

Если после выполнения останется хоть одна визуальная двусмысленность между:

&nbsp;

- В клубе
- Админы
- Не вошли
- diagnostic chat/channel detail

&nbsp;

&nbsp;

PATCH не принимается.

```
PATCH-STAT-4 можно выполнять после внесения этих правок в план.
PATCH-4 remains blocked.

PATCH-STAT-4: Финальная унификация статистики клубов и UI
```

## Scope: 3 изменения


| #   | Файл                                               | Тип                                                 |
| --- | -------------------------------------------------- | --------------------------------------------------- |
| 1   | SQL migration                                      | ADD 13 полей в `get_club_member_summary` (add-only) |
| 2   | `src/hooks/useTelegramIntegration.tsx` L628-643    | ADD 13 optional полей в `ClubMemberSummary`         |
| 3   | `src/pages/admin/TelegramClubMembers.tsx` L994-997 | CHANGE badge `regular + admins = total`             |


**Не трогаем:** `get_club_members_enriched`, `search_club_members_enriched`, `v_club_members_enriched`, billing, PATCH-4.

---

## 1. SQL Migration — расширить `get_club_member_summary`

Существующие 15 полей остаются без изменений. Добавляются 13 новых в `jsonb_build_object`:

### UI metrics (для пользовательских карточек и proof block)


| Поле                        | Формула                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| `admins_in_club`            | `WHERE ac.is_admin AND v.in_any AND NOT orphaned`                                |
| `admins_not_in_club`        | `WHERE ac.is_admin AND NOT v.in_any AND NOT orphaned`                            |
| `bot_admins_not_in_members` | `v_bot_admin_count` (уже считается, просто expose)                               |
| `removed_non_admin`         | `WHERE access_status='removed' AND NOT in_any AND NOT orphaned AND NOT is_admin` |
| `removed_admin`             | `WHERE access_status='removed' AND NOT in_any AND NOT orphaned AND is_admin`     |
| `not_joined_any`            | Alias = `bought_not_joined_count` (для семантической ясности)                    |


### Diagnostic metrics (chat/channel detail, НЕ для пользовательских карточек)


| Поле                 | Формула                                             | Resource-mode-aware      |
| -------------------- | --------------------------------------------------- | ------------------------ |
| `in_chat_count`      | `WHERE in_chat AND NOT orphaned`                    | Всегда считается         |
| `in_channel_count`   | `WHERE in_channel AND NOT orphaned`                 | Всегда считается         |
| `in_both_count`      | `WHERE in_chat AND in_channel AND NOT orphaned`     | Всегда считается         |
| `chat_only_count`    | `WHERE in_chat AND NOT in_channel AND NOT orphaned` | Всегда считается         |
| `channel_only_count` | `WHERE NOT in_chat AND in_channel AND NOT orphaned` | Всегда считается         |
| `not_joined_chat`    | Resource-mode-aware (see below)                     | NULL если нет chat_id    |
| `not_joined_channel` | Resource-mode-aware (see below)                     | NULL если нет channel_id |


### Resource-mode-aware логика для `not_joined`

```sql
-- not_joined_chat: ТОЛЬКО если у клуба есть chat_id
'not_joined_chat', CASE WHEN tc.chat_id IS NOT NULL THEN
  COUNT(*) FILTER (WHERE COALESCE(v.has_active_access,false) 
    AND NOT COALESCE(v.in_chat,false) 
    AND NOT COALESCE(v.is_orphaned,false) 
    AND v.access_status != 'removed')
  ELSE NULL END,

-- not_joined_channel: ТОЛЬКО если у клуба есть channel_id  
'not_joined_channel', CASE WHEN tc.channel_id IS NOT NULL THEN
  COUNT(*) FILTER (WHERE COALESCE(v.has_active_access,false) 
    AND NOT COALESCE(v.in_channel,false) 
    AND NOT COALESCE(v.is_orphaned,false) 
    AND v.access_status != 'removed')
  ELSE NULL END,
```

### Ключевые правила по resource_mode

- **chat_only (BkB):** SoT присутствия = `in_chat`. `in_channel_count`/`in_both_count` = diagnostic-only (stale data, не показывается в UI). `not_joined_channel = NULL`.
- **channel_only:** SoT = `in_channel`. `not_joined_chat = NULL`.
- **chat+channel (GC):** Все метрики активны. `not_joined_chat` и `not_joined_channel` оба заполнены.

---

## 2. TypeScript — расширить `ClubMemberSummary`

**File:** `src/hooks/useTelegramIntegration.tsx` L628-643

Add optional fields after existing ones:

```typescript
// --- UI metrics ---
admins_in_club?: number;
admins_not_in_club?: number;
bot_admins_not_in_members?: number;
removed_non_admin?: number;
removed_admin?: number;
not_joined_any?: number;
// --- Diagnostic metrics (resource detail) ---
in_chat_count?: number;
in_channel_count?: number;
in_both_count?: number;
chat_only_count?: number;
channel_only_count?: number;
not_joined_chat?: number | null;  // NULL if no chat_id
not_joined_channel?: number | null;  // NULL if no channel_id
```

---

## 3. UI — badge «В клубе»

**File:** `src/pages/admin/TelegramClubMembers.tsx` L994-997

**Current:** `155 (+1 адм. в клубе) = 156`
**New:** `155 + 1 = 156`

```tsx
{counts.in_club_admins > 0 
  ? `${counts.in_club_regular} + ${counts.in_club_admins} = ${counts.in_club}`
  : counts.in_club}
```

### Жёсткое разведение admins


| Метрика                     | Где                                | Что                            |
| --------------------------- | ---------------------------------- | ------------------------------ |
| `admins_in_club`            | Часть формулы в бейдже «В клубе»   | Админы физически в ресурсах    |
| `admins_total`              | Отдельная вкладка «Админы» (L1023) | ВСЕ админы (in + not_in + bot) |
| `admins_not_in_club`        | Backend payload, proof block       | Админы-члены вне клуба         |
| `bot_admins_not_in_members` | Backend payload, proof block       | Бот не в members               |


Формула `regular + admins = total` — это `in_club_regular + admins_in_club = in_club_total`. НЕ связано с `admins_total`.

---

## 4. UI metrics vs diagnostic metrics


| Метрика                     | Слой       | В карточках UI           | В proof block |
| --------------------------- | ---------- | ------------------------ | ------------- |
| `in_club_total`             | UI         | Да (бейдж)               | Да            |
| `in_club_regular`           | UI         | Да (формула)             | Да            |
| `in_club_admins`            | UI         | Да (формула)             | Да            |
| `admins_total`              | UI         | Да (вкладка)             | Да            |
| `with_access_total`         | UI         | Да (вкладка)             | Да            |
| `bought_not_joined_count`   | UI         | Да (вкладка)             | Да            |
| `violators_count`           | UI         | Да (вкладка)             | Да            |
| `removed_count`             | UI         | Да (вкладка)             | Да            |
| `admins_in_club`            | UI         | Proof only               | Да            |
| `admins_not_in_club`        | UI         | Proof only               | Да            |
| `bot_admins_not_in_members` | UI         | Proof only               | Да            |
| `removed_non_admin`         | Backend    | Нет                      | Да            |
| `removed_admin`             | Backend    | Нет                      | Да            |
| `not_joined_any`            | Backend    | Alias                    | Да            |
| `in_chat_count`             | Diagnostic | Нет                      | Да            |
| `in_channel_count`          | Diagnostic | Нет                      | Да            |
| `in_both_count`             | Diagnostic | Нет                      | Да            |
| `chat_only_count`           | Diagnostic | Нет                      | Да            |
| `channel_only_count`        | Diagnostic | Нет                      | Да            |
| `not_joined_chat`           | Diagnostic | Нет (NULL if no chat)    | Да            |
| `not_joined_channel`        | Diagnostic | Нет (NULL if no channel) | Да            |


---

## 5. Верификация (post-execute)

### Разделена по resource_mode

**BkB (chat_only, 4f8f9d8f):**


| Метрика                   | Ожидание         | Источник                          |
| ------------------------- | ---------------- | --------------------------------- |
| resource_mode             | chat_only        | RPC                               |
| in_club_total             | ~30              | RPC                               |
| in_club_regular           | ~29              | RPC                               |
| in_club_admins            | ~1               | RPC                               |
| admins_total              | ~4               | RPC (in_club + not_in_club + bot) |
| admins_in_club            | ~1               | RPC                               |
| admins_not_in_club        | ~2               | RPC                               |
| bot_admins_not_in_members | ~1               | RPC                               |
| removed_non_admin         | ~2               | RPC                               |
| removed_admin             | ~0               | RPC                               |
| not_joined_chat           | ~0               | RPC                               |
| not_joined_channel        | **NULL**         | RPC (нет channel_id)              |
| in_channel_count          | diagnostic/stale | RPC                               |
| UI badge                  | `29 + 1 = 30`    | UI                                |


**GC (chat+channel, fa547c41):**


| Метрика                   | Ожидание         | Источник |
| ------------------------- | ---------------- | -------- |
| resource_mode             | chat_and_channel | RPC      |
| in_club_total             | ~156             | RPC      |
| in_club_regular           | ~155             | RPC      |
| in_club_admins            | ~1               | RPC      |
| admins_total              | ~5               | RPC      |
| admins_in_club            | ~1               | RPC      |
| admins_not_in_club        | ~3               | RPC      |
| bot_admins_not_in_members | ~1               | RPC      |
| removed_non_admin         | ~38              | RPC      |
| removed_admin             | ~0               | RPC      |
| not_joined_chat           | ~2               | RPC      |
| not_joined_channel        | ~2               | RPC      |
| in_both_count             | ~156             | RPC      |
| UI badge                  | `155 + 1 = 156`  | UI       |


### Cross-verify

After PATCH-STAT-4, confirm `get_club_members_enriched` and `search_club_members_enriched` still match summary UI metrics (in_club, with_access, bought_not_joined, violators, removed counts).

### UI consistency proof

One component `TelegramClubMembers.tsx` handles both clubs via `club_id` + `resource_mode` from summary payload. No `if (clubId === ...)` branches.

---

## 6. Условие приёмки

PATCH принимается ТОЛЬКО если:

- Бейдж «В клубе» = `regular + admins = total`
- `admins_total` и `admins_in_club` разведены жёстко
- `not_joined` resource-mode-aware (NULL для отсутствующего ресурса)
- `removed_non_admin` и `removed_admin` оба в backend
- BkB и GC работают через один UI-компонент
- 4-level parity: SQL → RPC → Badge → List
- Нет визуальной двусмысленности между В клубе / Админы / Не вошли / chat-channel

**PATCH-4 remains blocked.**