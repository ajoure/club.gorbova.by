## да, согласен, с учетом правок:

1. **Сначала не новый header, а emergency-fix по двум регрессиям.**
  &nbsp;
  Перед `PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-HEADERS-AND-MONO-FIX` нужно зафиксировать, что текущий `CHANNELS` **не PASS**, а **PARTIAL / regression found**.
  По скрину есть две критичные проблемы:
  - mono-Telegram снова сломан: список без имён, справа «Telegram не привязан»;
  - merge IG → profile падает на записи audit-log:
  ```text
  new row for relation "audit_logs" violates check constraint "audit_logs_actor_type_check"
  ```
  Значит сначала чинить:
  - mono-Telegram;
  - RPC audit insert.
2. **Ошибка привязки профиля — это не UI-ошибка, а DB/RPC bug.**
  &nbsp;
  Ошибка на скрине говорит, что `link_instagram_contact_to_profile` пытается вставить в `audit_logs.actor_type` значение, которое не входит в разрешённый CHECK constraint.
  Нужно сделать read-only diagnose:
  ```sql
  SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conname = 'audit_logs_actor_type_check';
  ```
  И отдельно посмотреть несколько валидных строк:
  ```sql
  SELECT actor_type, action, created_at
  FROM public.audit_logs
  ORDER BY created_at DESC
  LIMIT 20;
  ```
  После этого исправить RPC так, чтобы `actor_type` использовал реально разрешённое значение. Не угадывать `admin`, `user`, `system`, `staff` и т.д.
3. **План должен включить отдельный P0A: fix RPC audit-log.**
  &nbsp;
  Добавить перед UI-работами:
  ```text
  P0A — Fix IG merge audit_logs constraint
  ```
  Scope:
  - найти допустимые значения `audit_logs.actor_type`;
  - исправить `link_instagram_contact_to_profile`;
  - исправить `unlink_instagram_contact_from_profile`;
  - проверить link/unlink через UI;
  - проверить запись audit_logs;
  - проверить RPC под non-admin → 42501;
  - rollback migration/RPC prepared.
  DoD:
  - привязка Катерины к профилю проходит без ошибки;
  - `instagram_contacts.profile_id` заполняется;
  - audit row создаётся;
  - unlink работает;
  - audit unlink row создаётся.
4. **P0 mono-Telegram должен быть главным blocker.**
  &nbsp;
  Нельзя продолжать unified headers, пока mono-Telegram показывает «Telegram не привязан».
  В плане P0 добавить точную диагностику:
  - проверить, изменялся ли `InboxTabContent.tsx`;
  - проверить, какие props уходят в `ContactTelegramChat`;
  - проверить `selectedUserId`;
  - проверить `telegramUserId`;
  - проверить `profile.telegram_user_id`;
  - проверить `dialog.user_id`;
  - проверить, не засорён ли React Query cache неправильной формой данных из unified;
  - проверить query key collisions между mono и unified.
5. **Особенно проверить конфликт query keys/cache.**
  &nbsp;
  В отчёте есть риск: unified и mono могут использовать один и тот же query key, но с разной нормализованной формой строки. Тогда mono-Telegram получает не старый объект диалога, а unified-row без нужных полей.
  Добавить проверку:
  ```text
  INBOX_DIALOGS_QK mono payload shape
  UnifiedInbox payload shape
  query keys пересекаются / не пересекаются
  selected dialog object before click
  props into ContactTelegramChat
  ```
  Если query key общий — развести ключи:
6. **Не писать “скорее всего регрессия не наша”.**
  &nbsp;
  Регрессия появилась после `CHANNELS`. Значит в плане должно быть:
7. `ContactDetailSheet` **не должен открываться через новый fetch, если уже есть существующий механизм.**
  &nbsp;
  В плане написано:
  ```text
  fetch profiles.* по id
  ```
  Уточнить: переиспользовать существующий механизм открытия `ContactDetailSheet`, а не создавать параллельную загрузку профиля, если в проекте уже есть hook/handler.
  Иначе появятся разные формы `Contact` и новые ошибки.
8. **Единая шапка не должна ломать внутренние шапки компонентов.**
  &nbsp;
  Для `ContactInstagramChat` допустимо добавить `hideHeader`, но только после проверки, что:
  - mono-Instagram не изменился;
  - default `hideHeader=false`;
  - unified передаёт `hideHeader=true`.
  Аналогично для Telegram/Support: если у них есть свои header-части, не дублировать.
9. **Header для Telegram и Support — только если есть** `profileId`**.**
  &nbsp;
  Не пытаться открывать карточку по Telegram numeric id или support ticket id напрямую. Логика:
10. **Кнопку “Привязать к профилю…” сделать не в шапке текстом, а compact action.**

По текущему скрину кнопка слишком тяжёлая. Сделать:

- icon-only `Link2`;
- tooltip `Привязать к профилю`;
- в dialog уже показывать полный текст.

В header не дублировать имя Instagram-контакта два раза.

11. **В диалоге привязки добавить защиту от неправильного выбора.**

Сейчас поиск нашёл `Katsiaryna Katok`, но нужно показывать больше контекста:

- ФИО;
- email;
- phone;
- profile id short;
- уже привязанные каналы, если есть;
- предупреждение перед link.

Кнопка `Привязать` должна быть disabled во время mutation, чтобы не было двойного клика.

12. **После успешной привязки нужно инвалидировать все нужные queries.**

Добавить в план:

```text
invalidate:
- unified inbox;
- profile channels;
- instagram contacts;
- ContactDetailSheet profile/channel section;
- selected row/header profile resolution.
```

Иначе после link UI может продолжать показывать «не привязан» до refresh.

13. **После ошибки RPC UI должен показывать нормальное сообщение.**

Вместо raw DB error:

```text
Не удалось привязать профиль. Ошибка аудита исправляется / повторите позже.
```

После фикса audit constraint raw error больше не должен появляться.

14. **P0/P0A proof должен быть отдельным до header work.**

Разделить proof:

```text
docs/audit/2026-07-04-unified-inbox-v2-mono-and-merge-hotfix.md
docs/audit/2026-07-04-unified-inbox-v2-headers.md
```

Сначала вернуть отчёт:

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-MONO-AND-MERGE-HOTFIX
```

Только после PASS продолжать headers.

15. **Текущий** `CHANNELS` **нельзя закрывать как PASS.**

Верный статус:

```text
PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-CHANNELS — PARTIAL
P1 ChannelPicker — PARTIAL
P2 Merge — FAIL на audit_logs constraint
P3 IG header — PARTIAL, требует redesign
Mono Telegram regression — FAIL
```

16. **Новый утверждённый порядок:**

```text
1. P0 — восстановить mono-Telegram.
2. P0A — исправить RPC audit_logs actor_type для link/unlink IG.
3. Проверить ручную привязку IG → profile.
4. Проверить unlink.
5. Только затем делать UnifiedChatHeader.
6. Потом убирать дублирование IG header.
7. Потом компактная кнопка привязки.
```

17. **Regression-gate расширить.**

После hotfix обязательно проверить:

- mono Telegram: имена в списке;
- mono Telegram: открытие истории;
- mono Telegram: text/voice/video note;
- unified Telegram;
- unified Instagram;
- unified Support;
- link IG → profile;
- unlink IG;
- audit_logs;
- kill-switch;
- ordinary operator OFF.

18. **В план добавить rollback по RPC.**

Так как уже есть миграция с RPC, нужен rollback:

- вернуть предыдущую версию RPC;
- либо заменить RPC на no-audit temporary variant;
- либо исправить actor_type без изменения контракта;
- не трогать `instagram_contacts.profile_id` у уже привязанных строк без явной команды.

19. **Финальный отчёт после всего:**

Для hotfix:

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-MONO-AND-MERGE-HOTFIX
```

Для headers:

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-HEADERS
```

Не смешивать эти два отчёта.

## **Что отправить исполнителю сейчас**

```text
Стоп. CHANNELS не принимаю как PASS.

По скрину и UI есть две критичные регрессии:

1. Mono-Telegram снова сломан: в списке нет имён контактов, справа «Telegram не привязан».
2. Привязка Instagram к профилю падает на DB constraint:
   new row for relation "audit_logs" violates check constraint "audit_logs_actor_type_check".

Сначала делаем не header-redesign, а emergency hotfix:

PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-MONO-AND-MERGE-HOTFIX

Scope:
- восстановить mono-Telegram;
- исправить RPC link/unlink Instagram → profile, чтобы audit_logs писался с допустимым actor_type;
- проверить link/unlink;
- проверить audit_logs;
- проверить, что unified и mono не конфликтуют по query keys/cache.

Не делать пока:
- UnifiedChatHeader;
- redesign IG header;
- новые кнопки;
- новые UX-улучшения.

После PASS по hotfix можно начинать:
PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-HEADERS

Дополнительно:
- Diagnose audit_logs_actor_type_check через pg_get_constraintdef;
- не угадывать actor_type;
- развести query keys mono/unified, если есть collision;
- after link/unlink invalidate unified/profile/instagram/contact queries;
- скрывать raw DB error от пользователя;
- ordinary operators остаются OFF.

Вернуть отчёт:
Отчет о выполненной работе: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-MONO-AND-MERGE-HOTFIX

План: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-HEADERS-AND-MONO-FIX
```

Diagnose → Plan → Dry run → Execute → Verify. Только фронтенд, БД/RPC/edge не трогаем.

### 1. Проблемы (по скринам и словам пользователя)

1. **Моно-Telegram сломан** (скрин 1). В списке — только «gorbova support» без имён контактов; в правой панели «Telegram не привязан». Работало раньше — регрессия. Нужно проверить, не сломал ли ChannelPicker/useUnifiedInbox использование `INBOX_DIALOGS_QK` (кэш общий) или пропала резолюция profile в моно.
2. **Unified «Все» + IG**: в правой панели две шапки — наш `IgContactHeader` и внутренняя шапка `ContactInstagramChat` — имя и аватар дублируются.
3. **Кнопка «Привязать к профилю…»** громоздкая; пользователь хочет компактную (иконка/короткий label), без повторной подписи имени IG.
4. **Unified «Все» + Telegram/Support**: нет кликабельного имени сверху → нельзя открыть карточку контакта. Нужна единая шапка над чатом для всех трёх источников.
5. **Карточка контакта из чата**: клик по имени должен открывать `ContactDetailSheet` поверх (без ухода со страницы) — как уже работает для IG после привязки.
6. **Моно IG/Support/Email** должны продолжать работать без изменений (регрессия-гейт).

### 2. Что делаем (фронтенд only)

#### 2.1 Fix моно-Telegram (P0, regression)

- Прочитать `InboxTabContent` в зоне резолюции `profile.full_name` и передачи `telegramUserId` в `ContactTelegramChat`. Найти, что именно изменилось (или что ломает `useUnifiedInbox`, монтируемый в `AdminLayout` через `useInboxRealtimeInvalidation`, при `unifiedEnabled=false`).
- Гипотеза: `useUnifiedInbox({ enabled: true })` внутри `UnifiedInboxView` монтируется даже когда пользователь на моно-Telegram (не наш случай — компонент не рендерится). Скорее всего регрессия в самом `InboxTabContent` не наша, но проверим последние правки к нему и к запросу профилей.
- Исправить резолюцию `profile.full_name` и передачу `telegram_user_id`, чтобы список снова показывал имена и правая панель открывала чат.

#### 2.2 Единая шапка `UnifiedChatHeader` для всех источников

Новый компонент `src/components/admin/communication/unified/UnifiedChatHeader.tsx`:

- Показывает аватар + `displayName` + `sourceLabel` (маленьким).
- Клик по имени/аватару → открывает `ContactDetailSheet` (in-place overlay), если `profileId` есть.
- Если `profileId` нет — имя не кликабельно, иконка `Link2Off` + компактная icon-кнопка «Привязать» (только `<Link2/>` + tooltip, без длинного текста). Для IG — открывает существующий `AttachProfileDialog` (вынесем из `IgContactHeader` в отдельный файл `AttachProfileDialog.tsx`, чтобы переиспользовать).
- Для Telegram и Support привязка не поддерживается (нет соответствующей RPC) — просто tooltip «Не привязан к профилю», без кнопки.
- Резолвим `profiles.*` одним `useQuery(['unified-header-profile', profileId])`.

#### 2.3 Убрать дублирование в IG

- Удалить старый `IgContactHeader` из `UnifiedInboxView` (или превратить его в тонкую обёртку над `UnifiedChatHeader`).
- Убедиться, что внутренняя шапка `ContactInstagramChat` не дублирует имя над нашим header'ом. Если дублирует — скрыть внутреннюю шапку через уже существующий `onBack`/prop или обернуть в контейнер, где верхний header от нас, а внутренний остаётся как есть (сначала посмотрим, что там показано; при необходимости добавим prop `hideHeader` в `ContactInstagramChat` — минимальная UI-правка).

#### 2.4 Итоговая композиция правой панели в `UnifiedInboxView`

```
<UnifiedChatHeader row={selected} />   // единая шапка: аватар+имя (кликабельно) + компактная привязка
<ChannelPicker … />                    // без изменений
<ChatPanel row={selected} />           // моно-компоненты источников
```

### 3. Что НЕ делаем

- Новых таблиц/RPC/edge functions.
- Cross-channel composer, автолинковка по email/phone, push для IG — вне scope.
- Изменений в `ContactTelegramChat`/`TicketChat` (кроме проверки, что имя не дублируется — если дублируется, сделаем минимальную правку `hideHeader` prop).
- Изменений моно IG/Email — не трогаем.

### 4. DoD (Regression-gate, под superadmin)

- Моно-Telegram: список показывает имена контактов, при клике открывается чат с историей и композером (не «Telegram не привязан»).
- Моно-Instagram / моно-Support / моно-Email: без регрессий.
- Unified «Все»: единый header во всех трёх источниках; клик по имени открывает `ContactDetailSheet` in-place (Telegram, IG, Support).
- IG: header не дублируется; кнопка привязки компактная (иконка + tooltip); имя из IG не выводится дважды.
- IG (не привязан): flow «Привязать → выбрать profile → RPC → header становится кликабельным» работает.
- Kill-switch OFF: unified полностью скрыт, моно-режимы работают.
- Ordinary operator: unified недоступен.
- Typecheck зелёный.

### 5. Файлы

- **create**: `src/components/admin/communication/unified/UnifiedChatHeader.tsx`, `src/components/admin/communication/unified/AttachProfileDialog.tsx` (extract).
- **edit**: `src/components/admin/communication/unified/UnifiedInboxView.tsx`, `src/components/admin/communication/unified/IgContactHeader.tsx` (удалить или адаптировать), `src/components/admin/communication/InboxTabContent.tsx` (fix моно-Telegram), при необходимости `src/components/admin/communication/instagram/ContactInstagramChat.tsx` (prop `hideHeader`).
- **create proof**: `docs/audit/2026-07-04-unified-inbox-v2-headers.md`.

### 6. Порядок работы

1. P0 — fix моно-Telegram (без него всё сломано). Отдельный коммит + smoke.
2. P1 — `UnifiedChatHeader` + удаление дублирования IG + компактная кнопка привязки. Smoke.
3. P2 — включить header для Telegram/Support (клик → ContactDetailSheet). Smoke.
4. Proof + regression-gate.