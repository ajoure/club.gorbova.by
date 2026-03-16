# да, согласен, с учетом правок:

&nbsp;

1. PATCH-A дополни до полноценного **full-sync режима**, а не только заменой limit(50):
  &nbsp;
  - deterministic ORDER BY
  - пагинация батчами
  - total processed / total expected
  - audit/log proof по каждому запуску
  - отдельный итог: сколько checked, сколько admins forced to in_chat=true, сколько restored from removedto ok
  &nbsp;
2. В PATCH-B зафиксируй **новое бизнес-правило явно**:
  &nbsp;
  - вкладка и badge **«С доступом»** = только has_active_access = true AND access_status != 'removed'
  - removed c действующим доступом **не теряются**, а остаются во вкладке **«Удалённые»** с явной пометкой доступ активен
  - это правило должно быть одинаковым в:
    &nbsp;
    - SQL summary
    - list RPC
    - UI badge
    - rendered list filter
    &nbsp;
  &nbsp;
3. Нельзя менять только get_club_member_summary. Нужно синхронно проверить и при необходимости привести к одному правилу:
  &nbsp;
  - get_club_member_summary
  - get_club_members_enriched
  - search_club_members_enriched
  - TelegramClubMembers.tsx filters / badges / cards
  &nbsp;
4. Добавь отдельный **proof block по 4 removed-but-has-access пользователям GC**:
  &nbsp;
  - email / tg / источник доступа
  - почему раньше попадали в «С доступом»
  - где отображаются после фикса
  - подтверждение, что после фикса badge/list parity соблюдён
  &nbsp;
5. Для PATCH-A добавь **STOP-guard**:
  &nbsp;
  - если full-sync обработал меньше 100% записей клуба, патч не считается выполненным
  - если после sync остались chat_status in ('administrator','creator') при in_chat=false, патч не считается выполненным
  &nbsp;
6. Добавь отдельную проверку по обоим клубам:
  &nbsp;
  - В клубе
  - Админы
  - С доступом
  - Не вошли
  - Удалённые
  - Нарушители
    Формат доказательства: SQL / RPC / badge / list / Telegram fact
  &nbsp;
7. Для вкладки **«Удалённые»** зафиксируй UI-изменение:
  &nbsp;
  - у removed-пользователей с активным доступом должен быть явный secondary marker, а не скрытая логика
  - без этого пользователь снова увидит визуальную путаницу
  &nbsp;
8. Подтверди, что всё делается **без club-specific веток** и что новый клуб после создания автоматически наследует:
  &nbsp;
  - full-sync
  - те же summary/list правила
  - тот же UI-фильтр и badge logic
  &nbsp;
9. В финальном отчёте отдельно покажи:
  &nbsp;
  - что именно было причиной старого рассинхрона
  - что исправлено кодом
  - что исправлено данными
  - какие значения были до / после по БкБ и GC
  &nbsp;
10. PATCH-4 не трогать и не смешивать с этим циклом.

&nbsp;

&nbsp;

План: Закрытие parity-проверки + исправление check_status + anti-contradiction «removed + has_access»

---

## Обнаруженные проблемы

### 1. «С доступом» показывает людей, у которых `access_status = 'removed'`

**Факт**: в GC 4 человека имеют `access_status = 'removed'` + `in_any = false`, но `has_active_access = true`:


| Имя             | Email                                                           | Источник доступа                  |
| --------------- | --------------------------------------------------------------- | --------------------------------- |
| Виктория Цалей  | [3776714@mail.ru](mailto:3776714@mail.ru)                       | entitlement (expires 2026-03-25)  |
| Татьяна Лайко   | [dervi@mail.ru](mailto:dervi@mail.ru)                           | entitlement (expires 2026-03-25)  |
| Юлия Киселева   | [yuliyakisileva@yandex.ru](mailto:yuliyakisileva@yandex.ru)     | entitlement (expires 2026-04-02)  |
| Ирина Лещинская | [ir.leshchinskaya@gmail.com](mailto:ir.leshchinskaya@gmail.com) | grant manual (expires 2026-03-23) |


Эти люди были кикнуты из Telegram (removed), но их entitlements/grants **не были отозваны**. `has_valid_access_for_club` корректно возвращает `true`, потому что бизнес-доступ ещё действует.

**Проблема UI**: вкладка «С доступом» фильтрует по `member.has_active_access` без учёта `access_status`. Пользователь видит красные ⊘ рядом с зелёным бейджем «С доступом» — визуальное противоречие.

**Вопрос к бизнесу**: это не баг данных — это вопрос отображения. Два варианта:

- **A**: Вкладка «С доступом» показывает ВСЕХ с `has_active_access=true`, включая removed. Это технически правильно (у них есть оплаченный доступ), но визуально сбивает.
- **B**: Вкладка «С доступом» исключает `access_status='removed'`. Тогда нужно убедиться, что эти люди видны во вкладке «Удалённые» с пометкой, что у них есть действующий доступ.

### 2. `check_status` обрабатывает только 50 записей из 643

Строка 332 в `telegram-club-members/index.ts`:

```typescript
: await supabase.from('telegram_club_members').select('*').eq('club_id', club_id).limit(50);
```

Нет `ORDER BY`, нет пагинации. Из 643 участников GC проверяются только случайные 50.

### 3. Parity-цепочка (текущие значения GC после sync)


| Метрика    | SQL direct                | UI (скриншот) | Совпадает                                                             |
| ---------- | ------------------------- | ------------- | --------------------------------------------------------------------- |
| В клубе    | 158                       | 158           | ДА                                                                    |
| С доступом | 161                       | 161           | ДА                                                                    |
| Не вошли   | 2                         | 2             | ДА                                                                    |
| Нарушители | 3 (raw, без admin filter) | 0             | Нужна проверка                                                        |
| Удалённые  | 39                        | 39            | ДА (на скриншоте badge=39 не виден, но в предыдущих данных confirmed) |


---

## Шаги выполнения

### PATCH-A: Исправление `check_status` — полный проход по всем участникам

**Файл**: `supabase/functions/telegram-club-members/index.ts`, строка 332

**Текущее**: `.limit(50)` без ORDER BY

**Исправление**: пагинированный проход батчами по 50 с deterministic order:

```typescript
// Вместо .limit(50):
// Fetch ALL members in batches of 50 with deterministic order
let allMembers: any[] = [];
let offset = 0;
const BATCH_SIZE = 50;
while (true) {
  const { data: batch } = await supabase
    .from('telegram_club_members')
    .select('*')
    .eq('club_id', club_id)
    .order('id')
    .range(offset, offset + BATCH_SIZE - 1);
  if (!batch || batch.length === 0) break;
  allMembers = allMembers.concat(batch);
  offset += BATCH_SIZE;
}
```

При этом проверка Telegram API идёт батчами по 50 с паузой (rate limit). Добавить прогресс-логирование.

### PATCH-B: Визуальная фиксация anti-contradiction `removed + has_access`

**Файл**: `src/pages/admin/TelegramClubMembers.tsx`, строка 282

**Решение (вариант B — рекомендуемый)**: вкладка «С доступом» исключает `access_status='removed'`:

```typescript
case 'with_access':
  return member.has_active_access && member.access_status !== 'removed';
```

Соответственно badge «С доступом» тоже должен использовать ту же логику. Нужно обновить `get_club_member_summary`:

```sql
'with_access_total', COUNT(*) FILTER (
  WHERE COALESCE(v.has_active_access, false) 
  AND NOT COALESCE(v.is_orphaned, false)
  AND v.access_status != 'removed'
),
```

Во вкладке «Удалённые» для таких людей добавить визуальный индикатор: «имеет действующий доступ, но удалён из клуба».

### PATCH-C: Parity-проверка после выполнения

После PATCH-A и PATCH-B:

1. Запустить `check_status` полный проход для обоих клубов
2. SQL snapshot → RPC summary → UI badges → rendered list → сверка
3. Поимённый proof по всем 9 админам
4. Поимённый proof по 4 removed-but-has-access записям GC

---

## Scope файлов


| Файл                                                | Изменение                                                   |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `supabase/functions/telegram-club-members/index.ts` | Пагинированный check_status вместо limit(50)                |
| `src/pages/admin/TelegramClubMembers.tsx`           | Фильтр with_access исключает removed                        |
| SQL миграция `get_club_member_summary`              | with_access_total исключает removed (если принят вариант B) |


---

## Acceptance criteria

1. `check_status` обрабатывает ВСЕХ участников клуба батчами, а не случайных 50
2. Вкладка «С доступом» не показывает людей с `access_status='removed'`
3. Badge «С доступом» = rendered list length вкладки «С доступом»
4. Removed users с активным доступом видны во вкладке «Удалённые» с соответствующей пометкой
5. 5-level parity подтверждён для обоих клубов
6. PATCH-4 остаётся заблокирован