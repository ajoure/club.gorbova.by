# Да, согласен, с учетом правок:

&nbsp;

1. В AuthContext нельзя просто “добавить employee” вслепую. Нужно взять **реальные role codes из БД/проекта** и явно зафиксировать mapping:
  &nbsp;
  - super_admin → superadmin
  - admin → admin
  - admin_gost и/или employee → employee
  - всё остальное → user
    Сейчас в проекте уже есть след, что admin_gost используется как staff-роль. Это нужно проверить и поддержать, а не вводить новый код без связи с текущими ролями.
  &nbsp;
2. Исправление нужно сделать не только в LiveEventQuestions.tsx, но и **в обоих room-компонентах консистентно**:
  &nbsp;
  - LiveEventComments.tsx
  - LiveEventQuestions.tsx
  - LiveInlineModeration.tsx
  - LiveEvent.tsx
    Для room нужен единый helper isStaffRole(role) / canModerateRoom(role) / canRemoveFromRoom(role), чтобы не размножать условия по файлам.
  &nbsp;
3. Матрицу прав лучше зафиксировать сразу в коде как явный контракт:
  &nbsp;
  - **employee**: reply, private/public reply, open profile, delete/hide message, mute/unmute, mark question answered
  - **admin/superadmin**: всё выше + remove/restore from room
    Это нужно отразить и в UI, и в проверках действий, а не только в отображении кнопок.
  &nbsp;
4. Для onOpenProfile правильно не просто “не передавать handler всем”, а сделать двойную защиту:
  &nbsp;
  - UI: не делать имя/аватар кликабельными для non-staff
  - action layer: если handler вызван без staff-role, ничего не открывать
    Иначе останется скрытый обход через прямой вызов обработчика.
  &nbsp;
5. Для moderation action buttons нужно разделить не только видимость, но и **mutation guards**:
  &nbsp;
  - employee не должен иметь возможность вызвать removed / restored
  - employee может вызывать muted / unmuted
  - admin/superadmin могут всё
    Это важно, потому что сейчас риск не только в UI, но и в том, что кто-то позже переиспользует mutation без проверки роли.
  &nbsp;
6. В proof-план добавить отдельный блок **DB/RLS proof по роли employee**:
  &nbsp;
  - employee действительно распознаётся как employee, а не как user
  - employee видит reply/mute/open card
  - employee не видит remove/restore
  - employee может mark question answered
  - admin и superadmin не деградировали
  &nbsp;
7. В proof-план добавить отдельную проверку на **role badge/snapshot consistency**:
  &nbsp;
  - новые сообщения от employee получают author_role = 'employee'
  - новые сообщения от admin получают author_role = 'admin'
  - UI badge соответствует snapshot, а не текущей клиентской сессии
  &nbsp;
8. Перед закрытием Wave 1 нужен не только runtime proof, но и короткий **regression diff-proof**:
  &nbsp;
  - AuthContext не сломал обычного user
  - recorded_webinar и replay не задеты
  - notification guardrails не изменены
  - existing comments/questions data продолжает читаться
  &nbsp;

&nbsp;

&nbsp;

Итог: план правильный. После этих правок можно давать в работу как **обязательный fix-to-patch для приемки Wave 1**.

&nbsp;

План: Wave 1 Proof — аудит employee gap + исправление + runtime verification

## Диагноз: подтверждённый баг employee role

Аудит кода Wave 1 выявил **критический gap**: роль `employee` не включена в проверки доступа в room UI.

### Root cause

`useAuth().role` возвращает только 3 значения: `"user" | "admin" | "superadmin"`. В `AuthContext.tsx` (строка 6) тип `AppRole` не содержит `employee`. Функция `fetchRole` (строка 45-55) проверяет только `super_admin` и `admin` — любая другая роль (включая employee) приводит к `setRole("user")`.

### Затронутые файлы и строки


| Файл                             | Проблема                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `LiveInlineModeration.tsx:31-32` | `isStaff = isAdmin` — employee не попадает в staff, компонент возвращает `null`               |
| `LiveInlineModeration.tsx:81`    | `isAdmin && !isSelf` — mute/remove/delete только для admin, employee не видит ни одной кнопки |
| `LiveEventQuestions.tsx:49`      | `isAdmin = role === "admin" || role === "superadmin"` — toggle answered скрыт для employee    |
| `LiveEventComments.tsx`          | `onOpenProfile` передаётся всегда (нет guard), но inline moderation скрыта для employee       |


### Что должен видеть employee по матрице прав

- ✅ Reply (public/private)
- ✅ Delete/hide message
- ✅ Mute/unmute
- ✅ Open user card
- ❌ Remove from room (только admin)
- ❌ Restore to room (только admin)
- ❌ Show/hide sales block (только admin)

## План исправления

### Шаг 1 — Расширить AuthContext

Добавить `"employee"` в тип `AppRole`. В `fetchRole` добавить проверку:

```
if (roleCodes.includes("employee")) { setRole("employee"); return; }
```

Порядок приоритета: `super_admin` → `admin` → `employee` → `user`.

### Шаг 2 — Исправить LiveInlineModeration.tsx

```typescript
const isAdmin = role === "admin" || role === "superadmin";
const isEmployee = role === "employee";
const isStaff = isAdmin || isEmployee;
```

Разделить кнопки по матрице:

- **Reply, Open Profile, Delete message, Mute** — видны `isStaff` (admin + employee)
- **Remove from room** — видны только `isAdmin`

### Шаг 3 — Исправить LiveEventQuestions.tsx

Заменить `isAdmin` на `isStaff` для toggle answered:

```typescript
const isStaff = role === "admin" || role === "superadmin" || role === "employee";
```

### Шаг 4 — Проверить onOpenProfile guard

`onOpenProfile` в Comments и Questions передаётся из `LiveEvent.tsx` через `useLiveContactSheet`. Сейчас guard отсутствует — аватар/имя кликабельны для всех. По матрице прав open card доступен только staff. Добавить условие: передавать `onOpenProfile` только если `isStaff`.

## Изменяемые файлы


| Файл                                           | Изменение                                                      |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `src/contexts/AuthContext.tsx`                 | Добавить `"employee"` в `AppRole`, добавить проверку role code |
| `src/components/live/LiveInlineModeration.tsx` | `isStaff = isAdmin || isEmployee`, разделить кнопки по матрице |
| `src/components/live/LiveEventQuestions.tsx`   | Toggle answered для staff, не только admin                     |
| `src/pages/LiveEvent.tsx`                      | Guard `onOpenProfile` для staff only                           |


## Proof-план после исправления (Wave 1 closure)

### 1. Employee role proof

- Пользователь с ролью `employee` видит: reply, delete, mute, open card
- Employee **НЕ** видит: remove from room
- Employee может отмечать вопрос как отвеченный

### 2. Runtime room proof

- Desktop: видео увеличено, чат на всю высоту
- Mobile: sticky input, sticky tabs работают
- Public reply виден всем
- Private reply виден только target + staff
- Muted user не может писать
- Removed user не может открыть комнату
- Карточка открывается из comments и questions

### 3. Regression proof

- recorded_webinar не сломан
- replay не сломан
- /live/:slug работает

### 4. Notifications safety proof

- Job #42 не затронут
- kill-switch/proof_mode/approval gate не изменены

## Статус Wave 1

**Кодовые задачи Wave 1 (PATCH 1–6) выполнены, кроме employee role gap.**
Employee role fix — обязательное условие приёмки Wave 1.
Переход к Wave 2 не согласован до полного закрытия proof.