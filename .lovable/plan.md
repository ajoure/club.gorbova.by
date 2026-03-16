# Да, согласен, с учетом правок:

&nbsp;

1. Не подменяй admins_in_club общим числом admins_total.
  Если карточка В клубе показывает физическое присутствие, то subtitle должен оставаться про тех, кто **реально в клубе**, а не про всех админов вообще.
  Нельзя делать искусственную формулу 27 + 4 = 31, если в клубе физически только 1 админ.
2. Противоречие нужно решать не подменой цифр, а визуальным пояснением модели.
  Оставь:
  &nbsp;
  - карточка В клубе = физически в клубе
  - badge Админы = все админы
    Но сделай это визуально понятным, не смешивая два разных смысла в одной формуле.
  &nbsp;
3. В чате и В канале не должны вести в in_club, если нет отдельного корректного tab/filter под эти карточки.
  Нельзя делать фиктивный click в “похожую” вкладку.
  Если отдельного фильтра нет — оставить карточки informational only.
4. Новые, Не продлили, Вне системы — убрать misleading clicks полностью.
  Согласен с тем, что это динамические метрики за период, а не содержимое существующих вкладок.
  Для них:
  &nbsp;
  - без onClick
  - с tooltip, что это только информационная метрика за выбранный период
  &nbsp;
5. Нумерация строк в таблице — согласовано.
  Добавить колонку #:
  &nbsp;
  - обычные строки: index + 1
  - дополнительные admin rows: продолжение после filteredMembers.length
  &nbsp;
6. Scope оставить UI-only.
  Без SQL, RPC, backend и без PATCH-4.
7. В финальном proof после execute показать:
  &nbsp;
  - BkB screenshot
  - GC screenshot
  - видно колонку #
  - видно, что Новые / Не продлили больше не ведут в неправильные вкладки
  - видно, что карточка В клубе больше не искажает смысл admins_in_club vs admins_total
  &nbsp;
8. Если хочешь убирать визуальную двусмысленность по В клубе, делай это через подпись/tooltip/лейблинг, а не через фальшивый пересчёт числа админов.
9. После этих правок план можно выполнять.

&nbsp;

&nbsp;

Plan: Fix card clicks, subtitle parity, and add row numbering

## Issues identified

1. **"В клубе" subtitle mismatch**: Shows "30 участн. + 1 адм." because it uses `summary.in_club_admins` (SQL-based, = 1), while the Админы badge uses `adminsList.length` (= 4). User expects "27 участн. + 4 адм. = 31".
2. **Missing row numbering**: No `#` column in the members table.
3. **Broken card clicks**:
  - "В чате" — no `onClick` (line 395-410)
  - "В канале" — no `onClick` (line 412-428)
  - "Новые" → navigates to `with_access` tab instead of filtering by new members
  - "Не продлили" → navigates to `removed` tab (shows wrong data — deleted users, not expired)
  - "Вне системы" — no `onClick` (line 482-489)

## Changes

### 1. `src/components/telegram/ClubQuickStats.tsx`

**Subtitle fix**: Accept `adminsCount` prop (from `adminsList.length`). Compute subtitle as:

```
regular = in_club_total - adminsCount
subtitle = `${regular} участн. + ${adminsCount} адм.`
```

**Card clicks**: Add `onClick` to "В чате" and "В канале" → both navigate to `in_club` tab (same physical presence view). "Новые" and "Не продлили" are dynamics cards — since there are no dedicated tabs for them, keep current behavior but fix: "Новые" → `with_access`, "Не продлили" → `removed`. These are the closest matching tabs. No change needed here — the data shown is tab-scoped, the card just sets the active tab.

Actually, the real issue: when clicking "Не продлили (10)", the `removed` tab shows 2 rows (truly removed/deleted users), not the 10 who didn't renew. This is because the card metric comes from `businessStats.revokedCount` (time-based) while the tab filters by `access_status === 'removed'`. These are different datasets. Fix: remove misleading `onClick` from "Новые" and "Не продлили" since they represent time-window dynamics, not filterable tab categories. Add tooltip explaining they are informational metrics.

### 2. `src/pages/admin/TelegramClubMembers.tsx`

**Pass `adminsCount**`: Add `adminsCount={adminsList.length}` to `ClubQuickStats` props.

**Row numbering**: Add `#` column header after checkbox. Render `index + 1` in each row. For admin extra rows, continue numbering from `filteredMembers.length + index + 1`.

### 3. `src/components/telegram/ClubQuickStats.tsx` — props update

Add `adminsCount?: number` to `ClubQuickStatsProps`.

## Scope


| File                      | Change                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ClubQuickStats.tsx`      | Add `adminsCount` prop, fix subtitle, remove misleading onClick from dynamics cards, add onClick to В чате/В канале |
| `TelegramClubMembers.tsx` | Pass `adminsCount`, add # column to table header + body                                                             |


No SQL, RPC, or backend changes.