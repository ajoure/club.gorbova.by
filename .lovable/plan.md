Да, согласен, с учетом правок:

&nbsp;

1. В начале плана отдельным блоком зафиксируй, что предыдущий forensic по клубу был ошибочным. Корректная картина сейчас:  

  - в чате 37 человек;
  - из них 31 с активной подпиской на продукт «Бухгалтерия как бизнес»;
  - 2 admin/owner не трогаем;
  - 2 лишних на удаление: Диана Шуляк и Ольга Севериненко;
  - дальше любые выводы делать только после сверки по 4 слоям: telegram_club_members / telegram_access / telegram_access_grants / subscriptions_v2 + entitlements.
2. &nbsp;
3. План раздели на два execution-блока:  

  - EXECUTION A — только точечный cleanup двух пользователей через существующий canonical revoke path.
  - EXECUTION B — исправление системных багов единой Telegram-системы, которые ты уже сам нашёл:  

    - pending → active не работает;
    - telegram-check-expired не видит pending;
    - telegram_access.active_until и entitlement.expires_at у части людей уходят дальше subscription.access_end_at;
    - оба клуба должны работать через один и тот же lifecycle, без отдельной логики.
  - &nbsp;
4. &nbsp;
5. Для EXECUTION A добавь строгий dry-run → execute:  

  - по Диане и Ольге до execute показать:  

    - нет active subscription на продукт 85046734;
    - нет entitlement на этот продукт;
    - telegram_access уже removed/revoked;
    - telegram_access_grants уже revoked;
    - физически in_chat=true;
    - доступ к Gorbova Club у них есть и не затрагивается;
  - &nbsp;
  - после execute показать before/after proof по:  

    - telegram_club_members
    - telegram_access
    - telegram_access_grants
  - &nbsp;
  - SQL использовать только для discovery/proof, не для основного kick/revoke.
6. &nbsp;
7. Для EXECUTION B не выноси в backlog, а включи в текущий план:  

  - исправить pending → active: если пользователь уже физически в чате/канале, состояние должно переходить из pending в active;
  - исправить expiry-flow для pending: такие записи тоже должны корректно закрываться, а не висеть вечно;
  - исправить owner-path расчёта telegram_access.active_until: он не должен жить своей логикой, а должен приводиться к canonical subscription.access_end_at;
  - исправить owner-path расчёта entitlement.expires_at для renewal, чтобы он не уходил на order_date + month, если canonical срок уже задан подпиской.
8. &nbsp;
9. Обязательно добавь таблицу canonical owner-функций:

&nbsp;


|                                    |                                          |                                               |                                    |
| ---------------------------------- | ---------------------------------------- | --------------------------------------------- | ---------------------------------- |
| **Этап**                           | **Единственная owner-функция**           | **Допустимые compensating paths**             | **Что запрещено**                  |
| Выдача Telegram доступа            | telegram-grant-access                    | /start path через тот же grant                | прямой insert из UI                |
| Создание telegram_access           | telegram-grant-access                    | нет                                           | UI/SQL insert                      |
| Создание telegram_access_grants    | telegram-grant-access                    | нет                                           | параллельная запись вне owner-path |
| Отправка двух ссылок (чат + канал) | telegram-grant-access                    | queue processor того же потока                | отдельный custom path              |
| Переход pending → active           | telegram-cron-sync                       | нет                                           | ручной SQL update                  |
| Продление active_until             | owner-path через canonical срок подписки | compensating sync                             | расчёт от now() + 30               |
| Revoke / kick                      | telegram-revoke-access                   | telegram-check-expired вызывает тот же revoke | SQL-kick / SQL-revoke              |
| Синхронизация in_chat/in_channel   | telegram-cron-sync                       | нет                                           | ручные несвязанные апдейты         |


&nbsp;

6. Отдельным блоком покажи exact parity-check по двум клубам:  

  - Gorbova Club
  - Бухгалтерия как бизнес
7.   
И докажи, что у них:  

  - один и тот же механизм выдачи;
  - один и тот же механизм отправки двух ссылок;
  - один и тот же механизм продления;
  - один и тот же механизм revoke/kick;
  - различаются только club_id, product_id, tariff_id, access_rule.
8.   
Если есть хоть один path, где они живут по разной логике, это нужно исправить сейчас.
9. По Ирине Царевой добавь не общий текст, а точную трассировку:

&nbsp;


|         |           |                  |                 |                     |           |            |                                  |          |
| ------- | --------- | ---------------- | --------------- | ------------------- | --------- | ---------- | -------------------------------- | -------- |
| **Шаг** | **Order** | **Subscription** | **Entitlement** | **telegram_access** | **grant** | **invite** | **[tcm.in](http://tcm.in)_chat** | **Итог** |


И отдельный вывод:

&nbsp;

- это не баг “покупки не создались”;
- это комбинация:  

  - бага state-machine (pending → active);
  - бага расчёта дат (entitlement.expires_at / active_until).
- &nbsp;

&nbsp;

&nbsp;

&nbsp;

8. По Екатерине Кузьменок дай такой же reference-case diff:  

  - где цепочка совпадает с Ириной;
  - где расходится;
  - одна и та же причина или нет.
9.   
Сейчас по данным это выглядит как тот же системный баг, а не отдельный кейс.
10. +30 дней зафиксируй как отдельный P0-баг, а не “аномалию”:  

  - покажи exact код, где entitlement для club renewal считает срок не от subscription.access_end_at, а от другой базы;
  - покажи exact код, где telegram_access.active_until берёт завышенную дату;
  - зафиксируй правило:  
  source of truth для срока club-продукта = subscription.access_end_at.  
  entitlements и telegram_access должны приводиться к нему, а не жить собственной датой.
11. &nbsp;
12. Добавь отдельный блок Regression / Safety:

&nbsp;

&nbsp;

&nbsp;

- admin/owner/team не будут ошибочно кикнуты;
- Gorbova Club не пострадает при cleanup Бухгалтерии;
- valid-pending у реально ожидающих вход пользователей не будет ошибочно удалён;
- обе ссылки (чат + канал) продолжают отправляться;
- не создаётся новый параллельный Telegram-path.

&nbsp;

&nbsp;

&nbsp;

11. В плане должны быть exact files for execution, а не “файлов нет”:

&nbsp;

&nbsp;

&nbsp;

- файл, где чинится pending → active;
- файл, где чинится expiry для pending;
- файл, где чинится owner-path entitlement.expires_at;
- файл, где убирается dangerous fallback по выбору клуба;
- отдельный execute-шаг через существующий telegram-revoke-access для двух пользователей.

&nbsp;

&nbsp;

&nbsp;

12. В telegram-revoke-access отдельно потребуй проверить и, при необходимости, убрать dangerous fallback вида “выбрать любой активный клуб”. Для двух клубов это недопустимо. Если club_id не определён однозначно — функция должна падать с ошибкой, а не угадывать.
13. Cleanup делать только по двум людям:

&nbsp;

&nbsp;

&nbsp;

- Диана Шуляк
- Ольга Севериненко  
Остальных не трогать. Массовый kick запрещён.

&nbsp;

&nbsp;

&nbsp;

14. В DoD перепиши жёстко:

&nbsp;

&nbsp;

&nbsp;

- 2 лишних пользователя удалены корректно;
- 31 платящий пользователь не затронут;
- admin/owner/team не затронуты;
- pending → active работает;
- pending с истёкшим сроком корректно закрывается;
- telegram_access.active_until больше не уходит за subscription.access_end_at;
- Ирина Царева расследована с точной причиной;
- Екатерина Кузьменок дана как reference-case;
- оба клуба подтверждены как одна единая система;
- новые функции / таблицы / параллельные paths не созданы.

&nbsp;

&nbsp;

&nbsp;

15. В конце потребуй один consolidated final plan:

&nbsp;

&nbsp;

&nbsp;

- один полный dry-run;
- одна полная карта функций;
- один финальный execution-plan;
- без новых мелких под-планов после этого.

&nbsp;

&nbsp;

План нужно доработать и прислать заново как один consolidated final plan.

&nbsp;

Обязательные правки:

&nbsp;

1. В начале отдельно зафиксируй, что предыдущий forensic по клубу был ошибочным. Корректные цифры сейчас:

&nbsp;

&nbsp;

&nbsp;

- 37 человек в чате
- 31 с активной подпиской на продукт «Бухгалтерия как бизнес»
- 2 admin/owner не трогаем
- 2 лишних на удаление: Диана Шуляк и Ольга Севериненко

&nbsp;

&nbsp;

&nbsp;

2. Дальше любые выводы делать только после сверки по 4 слоям:

&nbsp;

&nbsp;

&nbsp;

- telegram_club_members
- telegram_access
- telegram_access_grants
- subscriptions_v2 + entitlements

&nbsp;

&nbsp;

&nbsp;

3. План раздели на 2 execution-блока:

&nbsp;

&nbsp;

&nbsp;

- EXECUTION A — только точечный cleanup двух пользователей через существующий canonical revoke path
- EXECUTION B — фиксация системных багов единой Telegram-системы:  

  - pending → active не работает
  - telegram-check-expired не видит pending
  - telegram_access.active_until / entitlement.expires_at у части людей уходят дальше subscription.access_end_at
  - оба клуба должны работать через один и тот же lifecycle
- &nbsp;

&nbsp;

&nbsp;

&nbsp;

4. Для EXECUTION A нужен строгий dry-run → execute:  
до execute по Диане и Ольге покажи:

&nbsp;

&nbsp;

&nbsp;

- нет active subscription на продукт 85046734
- нет entitlement на этот продукт
- telegram_access уже removed/revoked
- telegram_access_grants revoked
- физически in_chat=true
- доступ к Gorbova Club есть и не затрагивается

&nbsp;

&nbsp;

после execute дай before/after proof по:

&nbsp;

- telegram_club_members
- telegram_access
- telegram_access_grants

&nbsp;

&nbsp;

SQL использовать только для discovery/proof, не для основного kick/revoke.

&nbsp;

5. Для EXECUTION B не выноси в backlog, а включи в текущий план:

&nbsp;

&nbsp;

&nbsp;

- починить pending → active, если пользователь уже физически в чате/канале
- починить expiry-flow для pending
- починить owner-path active_until, чтобы он приводился к canonical subscription.access_end_at
- починить owner-path entitlement.expires_at для renewal

&nbsp;

&nbsp;

&nbsp;

6. Добавь таблицу canonical owner-функций по этапам:

&nbsp;

&nbsp;

&nbsp;

- выдача Telegram доступа
- создание telegram_access
- создание telegram_access_grants
- отправка двух ссылок (чат + канал)
- переход pending → active
- продление active_until
- revoke / kick
- синхронизация in_chat/in_channel

&nbsp;

&nbsp;

Для каждого этапа:

&nbsp;

- единственная owner-функция
- допустимые compensating paths
- что запрещено

&nbsp;

&nbsp;

&nbsp;

7. Дай exact parity-check по двум клубам:

&nbsp;

&nbsp;

&nbsp;

- Gorbova Club
- Бухгалтерия как бизнес

&nbsp;

&nbsp;

Нужно доказать, что у них:

&nbsp;

- один и тот же механизм выдачи
- один и тот же механизм отправки двух ссылок
- один и тот же механизм продления
- один и тот же механизм revoke/kick

&nbsp;

&nbsp;

Различаются только:

&nbsp;

- club_id
- product_id
- tariff_id
- access_rule

&nbsp;

&nbsp;

Если есть хоть один path, где логика разная, исправить сейчас.

&nbsp;

8. По Ирине Царевой добавь точную трассировку:  
| Шаг | Order | Subscription | Entitlement | telegram_access | grant | invite | [tcm.in](http://tcm.in)_chat | Итог |

&nbsp;

&nbsp;

И отдельный вывод:

&nbsp;

- это не баг “покупки не создались”
- это комбинация бага state-machine и бага расчёта дат

&nbsp;

&nbsp;

&nbsp;

9. По Екатерине Кузьменок дай такой же reference-case diff:

&nbsp;

&nbsp;

&nbsp;

- где совпадает с Ириной
- где расходится
- одна причина или нет

&nbsp;

&nbsp;

&nbsp;

10. +30 дней оформить как отдельный P0-баг, а не “аномалию”:

&nbsp;

&nbsp;

&nbsp;

- exact код, где entitlement для club renewal считает срок не от subscription.access_end_at
- exact код, где telegram_access.active_until берёт завышенную дату
- exact фикс
- правило: source of truth для срока club-продукта = subscription.access_end_at

&nbsp;

&nbsp;

&nbsp;

11. Добавь блок Regression / Safety:

&nbsp;

&nbsp;

&nbsp;

- admin/owner/team не будут ошибочно кикнуты
- Gorbova Club не пострадает при cleanup Бухгалтерии
- valid-pending не будет ошибочно удалён
- обе ссылки продолжают отправляться
- не создаётся новый параллельный Telegram-path

&nbsp;

&nbsp;

&nbsp;

12. В плане должны быть exact files for execution:

&nbsp;

&nbsp;

&nbsp;

- где чинится pending → active
- где чинится expiry для pending
- где чинится owner-path entitlement.expires_at
- где убирается dangerous fallback выбора клуба
- execute-шаг через существующий telegram-revoke-access для двух пользователей

&nbsp;

&nbsp;

&nbsp;

13. Отдельно перепроверь telegram-revoke-access:  
если там есть fallback типа “выбрать любой активный клуб”, его нужно убрать. Для двух клубов это недопустимо. Если club_id не определён однозначно — функция должна падать с ошибкой.
14. Cleanup делать только по:

&nbsp;

&nbsp;

&nbsp;

- Диана Шуляк
- Ольга Севериненко

&nbsp;

&nbsp;

Остальных не трогать. Массовый kick запрещён.

&nbsp;

15. Перепиши DoD жёстко:

&nbsp;

&nbsp;

&nbsp;

- 2 лишних пользователя удалены корректно
- 31 платящий пользователь не затронут
- admin/owner/team не затронуты
- pending → active работает
- pending с истёкшим сроком корректно закрывается
- telegram_access.active_until больше не уходит за subscription.access_end_at
- Ирина Царева расследована с точной причиной
- Екатерина Кузьменок дана как reference-case
- оба клуба подтверждены как одна единая система
- новые функции / таблицы / параллельные paths не созданы

&nbsp;

&nbsp;

&nbsp;

16. Финально нужен один consolidated final plan:

&nbsp;

&nbsp;

&nbsp;

- один полный dry-run
- одна полная карта функций
- один финальный execution-plan
- без новых мелких под-планов после этого.После его обновлённого плана я проверю его на противоречия и недостающие места.

&nbsp;

&nbsp;

# Consolidated Plan: Cleanup двух пользователей + фиксация системных багов Telegram-доступа

---

## КОРРЕКЦИЯ ПРЕДЫДУЩЕГО FORENSIC

Предыдущий вывод «37 человек в чате и 0 активных подписок» был **ошибочным**. Корректные данные:


| Факт                                               | Значение                   |
| -------------------------------------------------- | -------------------------- |
| Физически в чате                                   | **37**                     |
| С активной подпиской на «Бухгалтерия как бизнес»   | **31**                     |
| Admin / Owner                                      | **2** (Горбова, Федорчук)  |
| Лишние (wrong-grant, без подписки на этот продукт) | **2** (Шуляк, Севериненко) |
| Stale (expired sub, active_until ещё в будущем)    | **1** (Королёва)           |
| Wrong-grant без профиля                            | **1** (f1a79dd0, pending)  |


**Правило:** выводы по клубу не делаются без сверки по 4 слоям: `telegram_club_members` → `telegram_access` → `telegram_access_grants` → `subscriptions_v2 / entitlements`.

---

## EXECUTION A — Точечный cleanup (Шуляк, Севериненко)

### Dry-run proof (read-only SQL)

Для каждого из двух пользователей подтвердить:

- Нет active subscription на product `85046734` (Бухгалтерия)
- Нет entitlement на этот продукт
- `telegram_access.state_chat = removed` (уже отозваны PATCH-ом)
- `telegram_access_grants.status = revoked`
- `telegram_club_members.in_chat = true` (физически ещё в чате)
- Есть active subscription на Gorbova Club (`11c9f1b8`) — **не затрагивается**

### Execute

Вызвать edge function `telegram-revoke-access` для каждого пользователя:

```json
{ "user_id": "...", "club_id": "4f8f9d8f-07ce-4898-8012-39f1035c1456", "reason": "wrong-grant cleanup", "is_manual": true, "admin_id": "system", "force_revoke": true }
```

`force_revoke: true` обязателен — без него guard блокирует revoke для пользователя с active sub на другой клуб.

### After-proof

SQL-proof по `telegram_club_members` (in_chat=false, access_status=removed) + `telegram_access` + `telegram_access_grants`.

### Запреты

- SQL-kick запрещён
- SQL-revoke запрещён
- Массовый kick запрещён
- Gorbova Club доступ не затрагивается

---

## EXECUTION B — Фиксация системных багов

### Баг 1 (P0): `pending → active` не реализован

**Проблема:** `telegram-grant-access` (строка 593) всегда ставит `state_chat: 'pending'` при upsert. Ни одна функция не переводит pending → active при обнаружении `in_chat=true`. Результат: 33 пользователя физически в чате, но state=pending. Это делает их невидимыми для expiry cron.

**Owner-path:** `telegram-cron-sync` — единственная функция, которая вызывает `getChatMember` и обновляет `in_chat`.

**Фикс:** В `telegram-cron-sync` (файл `supabase/functions/telegram-cron-sync/index.ts`), после обновления `telegram_club_members` (строка 183-191), добавить блок: если `in_chat=true` и у пользователя есть `telegram_access` с `state_chat=pending` для этого `club_id` — обновить на `state_chat='active'`, `state_channel='active'`.

```text
Pseudo-code:
if (inChat && userId) {
  // Check telegram_access for pending state
  const { data: pendingAccess } = await supabase
    .from('telegram_access')
    .select('id, state_chat')
    .eq('user_id', userId)
    .eq('club_id', club.id)
    .eq('state_chat', 'pending')
    .maybeSingle();
  
  if (pendingAccess) {
    await supabase.from('telegram_access')
      .update({ state_chat: 'active', state_channel: 'active', last_sync_at: now })
      .eq('id', pendingAccess.id);
    // audit log
  }
}
```

**Safety:** Только для пользователей, которых Telegram API подтвердил как `member/administrator/creator`. Не трогает pending без `in_chat=true`.

### Баг 2 (P0): `telegram-check-expired` не видит pending

**Проблема:** Строка 81 в `telegram-check-expired/index.ts`:

```
.or('state_chat.eq.active,state_channel.eq.active')
```

Записи с `state_chat=pending` невидимы для expiry cron. Если подписка истекла, а пользователь так и не вошёл — запись зависает навсегда.

**Фикс:** Расширить фильтр:

```
.or('state_chat.eq.active,state_channel.eq.active,state_chat.eq.pending,state_channel.eq.pending')
```

Для pending-записей с expired `active_until`: вызывать `telegram-revoke-access` (тот же canonical path, что и для active). Функция revoke сама определит, нужен ли kick (для pending — пользователь не в чате, kick не нужен, только state update).

### Баг 3: `active_until` уходит на +30 дней сверх подписки

**Проблема:** 4 пользователя имеют `telegram_access.active_until` > `subscription.access_end_at` на 8-30 дней.

**Root cause (exact code path):**

1. `grant-access-for-order` (строки 253-304) вычисляет `accessEndAt`:
  - Для club product: `accessEndAt = calcCalendarMonthEnd(accessStartAt)` (строка 300)
  - `accessStartAt` = `order.created_at` (строка 264-266)
  - Итого: `entitlement.expires_at = order_date + calendar_month`
2. При renewal, `subscriptions_v2.access_end_at` вычисляется **от конца предыдущей подписки** (extend), а `entitlement.expires_at` — **от даты заказа** (order.created_at). Если оплата прошла раньше конца текущей подписки — entitlement получает дату `order_date + 30`, которая может быть позже `sub.access_end_at`.
3. `telegram-grant-access` (строка 583-586) вызывает `resolveEffectiveClubAccess`, который берёт `MAX(sub.access_end_at, entitlement.expires_at)`. Inflated entitlement побеждает.

**Фикс:** В `grant-access-for-order`, при расчёте primary entitlement для club products с existing subscription (renewal):

- Если `extendFromCurrent=true` и есть existing subscription, `accessEndAt` для entitlement должен быть `= subscription.access_end_at` (тот же, что присваивается подписке), а не `order_date + calendar_month`.
- Файл: `supabase/functions/grant-access-for-order/index.ts`, блок строк 293-305.

Альтернативный минимальный фикс: в `resolveEffectiveClubAccess`, для club-продуктов, subscription всегда имеет приоритет над entitlement (subscription = canonical SoT по memory `club-product-sot`). Но правильнее починить источник — entitlement creation.

### Баг 4: `telegram-revoke-access.findClubId` — dangerous fallback

**Проблема:** Строки 96-145 в `telegram-revoke-access/index.ts` — если `club_id` не передан, функция пытается угадать клуб через fallback-цепочку, включая «any active club» (строка 137-143). Это опасно при наличии двух клубов.

**Фикс:** Удалить fallback к «any active club» (строки 136-143). Если `club_id` не определён после всех lookup — возвращать 400 ошибку, не угадывать.

---

## Canonical Owner Table


| Этап lifecycle                    | Owner-функция                                          | Compensating paths                               | Запрещено                                    |
| --------------------------------- | ------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------- |
| Выдача Telegram доступа           | `telegram-grant-access`                                | `telegram-webhook` (/start → grant)              | Прямой insert в `telegram_access` из UI      |
| Создание `telegram_access`        | `telegram-grant-access` (upsert, строка 590)           | —                                                | Прямой insert из frontend                    |
| Создание `telegram_access_grants` | `telegram-grant-access` (insert, строка 636)           | —                                                | Дублирование без idempotency check           |
| Отправка 2 ссылок (чат + канал)   | `telegram-grant-access` (строки 741-764)               | —                                                | Отправка одной ссылки, silent skip второй    |
| Переход `pending → active`        | `**telegram-cron-sync**` (после фикса бага 1)          | —                                                | Ручной SQL update state_chat                 |
| Продление `active_until`          | `telegram-grant-access` → `resolveEffectiveClubAccess` | `bepaid-webhook` sync (compensating)             | `now() + 30 days` вместо `sub.access_end_at` |
| Revoke / kick                     | `telegram-revoke-access`                               | `telegram-check-expired` (cron → invokes revoke) | SQL-kick, SQL-revoke                         |
| Sync in_chat/in_channel           | `telegram-cron-sync` (getChatMember)                   | —                                                | Manual update без API check                  |


---

## Parity-check: Gorbova Club vs Бухгалтерия как бизнес


| Параметр        | Gorbova Club                                        | Бухгалтерия        | Одинаково?    |
| --------------- | --------------------------------------------------- | ------------------ | ------------- |
| Выдача доступа  | `grant-access-for-order` → `telegram-grant-access`  | То же              | **Да**        |
| Invite delivery | `telegram-grant-access` (chat + channel links)      | То же              | **Да**        |
| Продление       | `bepaid-webhook` → `grant-access-for-order`         | То же              | **Да**        |
| Revoke/kick     | `telegram-revoke-access` / `telegram-check-expired` | То же              | **Да**        |
| Sync            | `telegram-cron-sync`                                | То же              | **Да**        |
| access_mode     | AUTO_WITH_FALLBACK                                  | AUTO_WITH_FALLBACK | **Да**        |
| revoke_mode     | KICK_ONLY                                           | KICK_ONLY          | **Да**        |
| Разница         | club_id, product_id, access_rule_id                 | Другие ID          | Только config |


Club-specific логики в коде нет. Все функции работают через `club_id` из `access_rules`.

---

## Forensic: Ирина Царева


| Шаг             | Данные                                                          | Статус                                 |
| --------------- | --------------------------------------------------------------- | -------------------------------------- |
| Order           | `8f11d65c`, paid, 12.04.2026                                    | OK                                     |
| Subscription    | `a504cb23`, active, access_end=**2026-05-13**                   | OK                                     |
| Entitlement     | `b6423dca`, active, expires_at=**2026-06-12**                   | **БАГ: +30 дней**                      |
| telegram_access | `7ef58b1a`, state_chat=**pending**, active_until=**2026-06-12** | **БАГ: pending + дата от entitlement** |
| Grant           | `2d793def`, auto_subscription, end_at=2026-06-12                | Берёт MAX из resolver                  |
| Invite          | sent, 12.04.2026                                                | OK                                     |
| tcm.in_chat     | **true**                                                        | OK                                     |


**Вывод:** Цепочка выдачи сработала полностью. Два бага:

1. `state_chat=pending` при `in_chat=true` — баг state-machine (нет перехода)
2. `active_until=2026-06-12` при `sub.access_end=2026-05-13` — баг расчёта `entitlement.expires_at` (order_date + 30 вместо sub.access_end_at), resolver берёт MAX → inflated entitlement побеждает

## Forensic: Екатерина Кузьменок (reference-case)


| Шаг             | Данные                                                          | Статус           |
| --------------- | --------------------------------------------------------------- | ---------------- |
| Subscription    | `a5c7b490`, active, access_end=**2026-05-10**                   | OK               |
| telegram_access | `bf903ce9`, state_chat=**pending**, active_until=**2026-06-09** | **Те же 2 бага** |
| tcm.in_chat     | **true**                                                        | OK               |


### Diff


| Шаг                     | Ирина         | Екатерина     | Совпадает? |
| ----------------------- | ------------- | ------------- | ---------- |
| Order paid              | Да            | Да            | Да         |
| Sub active              | Да            | Да            | Да         |
| Grant auto_subscription | Да            | Да            | Да         |
| Invite sent             | Да            | Да            | Да         |
| In chat                 | Да            | Да            | Да         |
| state_chat=active       | НЕТ (pending) | НЕТ (pending) | Оба broken |
| active_until = sub end  | НЕТ (+30д)    | НЕТ (+30д)    | Оба broken |


**Причина идентична.** Это не индивидуальный кейс — это системный баг, затрагивающий всех.

---

## +30 дней — exact fix

**Owner-path расчёта `entitlement.expires_at`:** `grant-access-for-order`, строки 293-305.

**Owner-path расчёта `telegram_access.active_until`:** `telegram-grant-access`, строки 583-586 → `resolveEffectiveClubAccess` → MAX(sub, ent, manual).

**Почему +30 дней:**

- Subscription: `access_end_at` = prev_sub_end + calendar_month = **2026-05-13** (корректно)
- Entitlement: `expires_at` = order.created_at(12.04) + calendar_month = **2026-06-12** (некорректно)
- Resolver: MAX(05-13, 06-12) = **06-12** → записывается в `active_until`

**Exact фикс в `grant-access-for-order/index.ts**`, строки 293-305:

Текущий код (строка 299-301):

```typescript
} else if (isClubProduct && !customAccessDays) {
  accessEndAt = calcCalendarMonthEnd(accessStartAt);
```

Нужно: если есть existing subscription и `extendFromCurrent`, entitlement.expires_at = subscription.access_end_at (тот же, что вычислен для подписки), а не `calcCalendarMonthEnd(order_date)`.

**Правило:** `subscription.access_end_at` является canonical SoT для срока club-продукта. Entitlement ОБЯЗАН быть ≤ subscription.access_end_at.

---

## Regression / Safety


| Риск                                            | Защита                                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Admin/owner ошибочно кикнуты                    | `telegram-cron-sync` и `telegram-check-expired` имеют ADMIN_GUARD (проверка `administrator/creator` status). Не изменяется. |
| Gorbova Club пострадает при cleanup Бухгалтерии | Kick через `telegram-revoke-access` scoped по `club_id`. Подписка на Gorbova не затрагивается.                              |
| Valid-pending ошибочно удалён                   | `telegram-check-expired` проверяет `active_until < now()`. Если active_until в будущем — не трогает.                        |
| Обе ссылки продолжают отправляться              | Не меняем логику отправки в `telegram-grant-access` (строки 741-764).                                                       |
| Продление не создаёт параллельный path          | Не добавляем новых функций. Все изменения в существующих owner-функциях.                                                    |


---

## Файлы для изменения


| Файл                                                 | Что меняется                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `supabase/functions/telegram-cron-sync/index.ts`     | Добавить блок `pending → active` при `in_chat=true` (после строки 191)                                 |
| `supabase/functions/telegram-check-expired/index.ts` | Строка 81: расширить фильтр на `pending`                                                               |
| `supabase/functions/grant-access-for-order/index.ts` | Строки 293-305: при renewal, `accessEndAt` для entitlement = subscription end, не `order_date + month` |
| `supabase/functions/telegram-revoke-access/index.ts` | Строки 136-143: удалить fallback к «any active club»                                                   |


---

## Admin Allowlist (не трогать)


| Участник         | Основание                    |
| ---------------- | ---------------------------- |
| Катерина Горбова | **owner** — владелец проекта |
| Сергей Федорчук  | **admin** — has_role=true    |


---

## DoD

1. Диана Шуляк и Ольга Севериненко удалены из чата «Бухгалтерия» через canonical `telegram-revoke-access` с before/after proof
2. 31 платящий пользователь не затронут
3. Admin/owner/team не затронуты
4. `pending → active` работает: `telegram-cron-sync` переводит state при обнаружении `in_chat=true`
5. Pending с истёкшим `active_until` корректно обрабатывается `telegram-check-expired`
6. `telegram_access.active_until` больше не уходит за `subscription.access_end_at` — entitlement.expires_at при renewal = sub end
7. Ирина Царева расследована: цепочка работает, причина — баги state-machine + entitlement overshoot
8. Екатерина Кузьменок — reference-case, идентичные баги
9. Оба клуба работают через один canonical lifecycle (подтверждено parity-check)
10. Новые функции / таблицы / параллельные paths не созданы
11. Gorbova Club не пострадал
12. Dangerous fallback `findClubId → any active club` удалён из `telegram-revoke-access`
13. Edge functions задеплоены
14. Changed files list + diff-summary предоставлены