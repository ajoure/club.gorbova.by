## да, согласен, с учетом правок:

1. **LocalStorage kill-switch не является глобальным kill-switch.**  
Сейчас он отключит unified только в конкретном браузере. В тексте плана не писать «пункт “Все” пропадает у всех». Корректно:
  &nbsp;
  ```text
  localStorage kill-switch = аварийное отключение в текущем браузере/сессии superadmin.
  ```
  Для настоящего глобального отключения пока остаётся кодовый rollback `return false`.
2. **Включение “только для superadmin” через frontend-role — временный rollout, не security boundary.**  
Это нормально для UI-фичи, но в proof явно указать:
3. `useHasRole('superadmin')` **проверить по реальному названию роли.**  
В проекте встречались оба варианта: `superadmin` и `super_admin`. Перед реализацией подтвердить, какой именно enum/string принимает `useHasRole`. Нельзя случайно включить флаг никому или всем из-за неверного имени роли.
4. **Не использовать kill-switch как доказательство обычного оператора.**  
Эмуляция через `contact_center_unified_inbox_kill=1` доказывает только kill-switch, а не default OFF для non-superadmin.
  &nbsp;
  Для non-superadmin proof нужно одно из:
  - реальная тестовая админ-учётка без superadmin;
  - существующая админ-учётка без superadmin с read-only UI session;
  - unit/integration test хука с `hasRole=false`;
  - Playwright с mock auth state, если в проекте есть тестовая инфраструктура.
  Если реальной UI-сессии нет — статус operator UI proof = `PARTIAL`, а не PASS.
5. **QA override должен быть безопасно ограничен.**  
Сейчас любой оператор может открыть консоль и поставить:
  ```js
  localStorage.setItem("contact_center_unified_inbox_v2_test","1")
  ```
  Это противоречит «все остальные операторы видят старый интерфейс».
  Исправить формулу:
  ```text
  kill → false
  superadmin → true
  qa-override → true только в DEV/preview или только если user тоже admin/superadmin по allowlist
  otherwise false
  ```
  В production для обычного оператора localStorage QA override не должен включать unified.
6. **Настройки UI не должны показывать kill-кнопку обычным операторам.**  
Кнопка аварийного выключения — только если `source='superadmin' | 'qa-override'` и пользователь имеет superadmin/admin право. Обычный оператор должен видеть информационный disabled-блок или вообще не видеть rollout card.
7. **При kill-switch нужно также сбрасывать активный selected source.**  
Если пользователь был в `All`, после kill должен автоматически перейти на Telegram, иначе UI может остаться в невалидном состоянии.
8. **Realtime proof должен проверять не только idle.**  
Idle 8s = 0 refetch полезно, но недостаточно. Добавить smoke:
  - при default OFF unified IG/support subscriptions не создаются;
  - при V2 ON создаются только ожидаемые subscriptions;
  - переключение All → Telegram не оставляет unified subscriptions висеть.
9. **Не тестировать composer только “ввод текста принимается”.**  
Минимальный rollout proof должен хотя бы не ломать уже рабочие действия. Для реальных клиентов не отправлять, но на тестовом DM Сергея можно проверить:
  - Telegram text send;
  - voice send;
  - video note send;
  - mark read.
  Если не выполняется из-за data-safety — пометить как pending, не PASS.
10. **Флаг должен быть OFF by default и после hard refresh.**  
Добавить проверки:

- clean localStorage + superadmin → ON;
- clean localStorage + non-superadmin → OFF;
- kill=1 + superadmin → OFF;
- qa override в production ordinary user → OFF;
- legacy key `contact_center_unified_inbox=1` → не включает V2.

11. **В Settings-карточке не давать ложного ощущения, что тумблер включает фичу.**  
Если setter no-op, тумблер лучше заменить на `Badge/Status` + кнопка kill. Disabled toggle может путать.
12. **Proof должен включать точное значение** `source`**.**  
Для каждого кейса показать:

```text
enabled=<true/false>
source=<kill|superadmin|qa-override|default-off>
```

13. **Если server-side flag отложен, добавить Phase 2 blocker.**  
Перед включением всем операторам нужен не localStorage, а нормальный server-side/admin-config flag. Зафиксировать как обязательный пункт Phase 2.

После этих правок план утверждён. Выполнять rollout-патч одним проходом без промежуточного согласования.

&nbsp;

Цель

Перевести unified inbox V2 из скрытого localStorage-режима в безопасный controlled rollout:
единая лента включена только для superadmin (Сергей); все остальные операторы видят старый интерфейс; сохраняется мгновенный kill-switch.

Phase 2 (cross-channel composer, bulk, IG history догрузка, server-side flag, push) — вне scope этого патча.

## Что меняем

### 1. `src/hooks/useContactCenterFeatureFlag.ts` — controlled rollout

Хук `useUnifiedInboxFlag()` начинает возвращать `true` в одном из случаев:

1. **Роль:** `has_role(auth.uid(), 'superadmin')` = true (проверяется через существующий `useHasRole('superadmin')`).
2. **Kill-switch override:** `localStorage.getItem('contact_center_unified_inbox_kill') === '1'` → принудительно **OFF**, независимо от роли. Это моментальный аварийный выключатель.
3. **QA/dev override:** сохраняем текущий `contact_center_unified_inbox_v2_test === '1'` как бэкдор для локального тестирования на не-superadmin аккаунтах.

Итоговая формула:

```
kill? → false
superadmin || v2_test? → true
иначе → false
```

Legacy-ключ `contact_center_unified_inbox` продолжает вычищаться при монтировании (как сейчас).

Setter остаётся no-op — включение операторам через UI по-прежнему запрещено.

Хук возвращает дополнительно `source: 'kill' | 'superadmin' | 'qa-override' | 'default-off'` для диагностики в Settings-карточке.

### 2. `src/components/admin/communication/CommunicationSettingsTabContent.tsx` — карточка статуса rollout

Существующий `UnifiedInboxToggleCard` переписываем в информационный блок:

- Заголовок «Единая лента сообщений — controlled rollout».
- Показывает текущий статус: «Включено для вас (роль superadmin)» / «Отключено (обычный оператор)» / «Аварийно выключено (kill-switch)» / «QA test override».
- Тумблер остаётся `disabled`, но рядом появляется кнопка «Аварийно выключить» (для superadmin): ставит `contact_center_unified_inbox_kill=1` в localStorage и триггерит перезагрузку хука. Кнопка «Снять аварийное выключение» убирает ключ.
- Короткое описание, кому включено и как откатить.

### 3. `src/pages/admin/AdminCommunication.tsx` — без структурных изменений

Уже читает `useUnifiedInboxFlag()`. Никаких правок логики не нужно — просто теперь хук отдаёт `true` для superadmin, и пункт «Все» + `<UnifiedInboxView />` автоматически появляются у Сергея, а обычные операторы получают старый Telegram mono.

### 4. Fallback / kill-switch

- Snap-off: `localStorage.setItem('contact_center_unified_inbox_kill','1')` → пункт «Все» пропадает у всех, включая superadmin; unified не рендерится; realtime подписки (`useUnifiedInbox({enabled:false})`) не активируются.
- Быстрый snap-off из UI: кнопка в Settings-карточке для superadmin.
- Полный код-роллбэк (если понадобится) — вернуть в хук `return false` и мгновенно скрыть у всех.

## Валидация (Playwright + evidence)

Все скрины и логи — в `/tmp/browser/v2rollout/`.

**A. Аккаунт Сергея (superadmin, uses injected session):**

1. `/admin/communication?tab=inbox` — открывается сразу; пункт «Все» присутствует в дропдауне; выбор «Все» рендерит unified feed (Telegram + Instagram + Support, source badges, unanswered сверху).
2. Telegram row → реальная история сообщений (voice player, admin auto-msgs, composer + bot selector), **никакого «Telegram не привязан»**.
3. Instagram row → ContactInstagramChat (header + composer).
4. Support row → TicketChat (сообщения, вложение, composer).
5. Composer Telegram: ввод текста принимается (без реальной отправки в чужой чат, чтобы не спамить пользователей).
6. Моно-режимы Telegram / Email / Support / Instagram по-прежнему открываются через dropdown.
7. Kill-switch: ставим `contact_center_unified_inbox_kill=1`, перезагружаем — «Все» исчезает, mono-Telegram работает. Снимаем ключ — «Все» возвращается.

**B. Аккаунт обычного оператора:**
Playwright под injected сессией — это Сергей (superadmin). Поэтому для роли operator валидация делается двумя способами:

- **Кодовый proof:** SQL-запрос через `supabase--read_query` показывает роли текущего пользователя vs. пример другого админа (без изменения данных); подтверждается, что `has_role(<other>, 'superadmin') = false`.
- **UI proof:** в консоли браузера выполняется временный мок `useHasRole` невозможен без правок кода, поэтому вместо этого — эмулируем «не-superadmin» состоянием, поставив `contact_center_unified_inbox_kill=1` (эквивалентно default OFF в поведении для UI). Скрин показывает: нет «Все», Telegram mono работает, unified не грузится. Плюс скрин исходника хука подтверждает, что при `hasRole=false && kill=false && qa=false` возвращается `false`.

(Если этого недостаточно — добавляем логи в консоль на этапе rollout: `[unified-inbox] enabled=<bool>, source=<...>` — оставляем в проде за `if (import.meta.env.DEV)`.)

**C. Realtime idle check:** после стабилизации unified 8s без интеракций — 0 дополнительных запросов к `get_inbox_dialogs_v1` / `get_instagram_dialogs_v1` / `support_tickets` / `instagram-admin-chat` сверх плановых polling-окон.

## Proof-файл

`docs/audit/2026-07-04-unified-inbox-v2-rollout.md`:

- Кто видит unified (по ролям + override матрица).
- Kill-switch: как включается, как снимается, скрины.
- Screenshots Sergey: unified ON (Telegram history, IG, Support, композер).
- Screenshot / SQL-evidence обычного оператора: unified OFF.
- Telegram mono regression: pass 4/4 (tg/email/support/ig).
- Realtime idle refetch = 0.
- Список файлов, статус rollout, что остаётся в Phase 2.

## Файлы, которые будут изменены

- `src/hooks/useContactCenterFeatureFlag.ts` — новая логика (superadmin + kill + qa).
- `src/components/admin/communication/CommunicationSettingsTabContent.tsx` — карточка статуса rollout + кнопка kill-switch.
- (без правок) `src/pages/admin/AdminCommunication.tsx` — уже совместим.
- (без правок) `src/hooks/useUnifiedInbox.ts`, `src/components/admin/communication/unified/UnifiedInboxView.tsx` — контракт V2 уже правильный.

## DoD

1. Хук `useUnifiedInboxFlag` возвращает `true` только для superadmin (или QA override); kill-switch мгновенно отключает.
2. Сергей (superadmin) видит «Все» и единую ленту; Telegram/IG/Support открываются корректно.
3. Обычный оператор (proof — SQL + эмуляция kill) видит старый интерфейс.
4. Моно-ленты 4/4 работают.
5. Realtime idle refetch = 0.
6. Kill-switch работает: скрины ON/OFF.
7. Proof-файл создан.
8. Итоговый отчёт: `Отчет о выполненной работе: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-ROLLOUT`, статус: **Unified inbox V2 — enabled for superadmin only; operators — old UI; kill-switch available; Phase 2 deferred**.

## Что НЕ делаем в этом патче

- Cross-channel composer.
- Bulk actions.
- Объединение строк одного профиля.
- Полная догрузка истории Instagram.
- Push-уведомления IG/support.
- Server-side (БД) feature flag система — оставляем role + localStorage override как rollout-механизм с явной пометкой «временный до Phase 2».
- Правки Instagram/support composer.