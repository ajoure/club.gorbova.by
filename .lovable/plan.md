да, согласен, с учетом правок:

&nbsp;

1. sendGraceNotification из списка “не сделано” убрать.  
По твоему же discovery это уже фактически закрыто: сигнатура обновлена, productName передаётся, хардкод убран. Оставь это в разделе уже сделано, а не в open items.
2. Зафиксировать отдельно: telegram-kick-violators не обязан напрямую звать resolveEffectiveClubAccess, если он использует _shared/accessValidation.ts.  
Корректный invariant такой:  

  - telegram-check-expired и telegram-kick-violators не должны иметь локальной логики доступа;
  - оба должны опираться на один shared access-layer из _shared/accessValidation.ts;
  - а accessValidation.ts, в свою очередь, должен быть приведён к той же модели времени и protection rules, что и resolve-effective-access.ts.  
  То есть требование не “один и тот же helper-файл буквально”, а один и тот же access-layer и одинаковые правила.
3. &nbsp;
4. Timezone unify — это обязательная часть закрытия патча, не постфикс.  
У тебя это уже отражено, но я бы усилил формулировку:  

  - пока accessValidation.ts не переведён на APP_TZ = Europe/Minsk и end-of-day guard,
  - патч по revoke/kick считать не закрытым.
5. &nbsp;
6. В DoD добавить отдельный пункт про Минск-time cutoff.  
Не просто “billing-day = end-of-day”, а явно:  

  - если дата окончания доступа приходится на текущий день,
  - revoke/kick до 23:59:59 по Минску не выполняется.
7. &nbsp;
8. Multi-club proof расширить ещё одним кейсом:  
кроме:  

  - один продукт → несколько клубов
  - несколько продуктов → один клуб  
  добавь:
  - один пользователь, два продукта, два клуба, renew только одного продукта  
  и докажи отдельно:  

    - дата меняется только у соответствующих telegram_access / telegram_access_grants;
    - в уведомлении не путаются название клуба, ссылки и дата;
    - другой клуб вообще не затрагивается.
  - &nbsp;
9. &nbsp;
10. Для renewal notification добавь явный invariant по структуре сообщения.  
Если у продукта несколько клубов, в сообщении должен быть не “один общий доступ до…”, а:  

  - по каждому клубу отдельная строка;
  - по каждому клубу свои кнопки входа.  
  Это у тебя уже реализовано через formatClubAccessBlock, но в плане стоит закрепить как обязательный результат.
11. &nbsp;
12. Добавь proof по зеркалам не только на дату, но и на scope.  
То есть проверить:  

  - telegram_access.active_until
  - telegram_access_grants.end_at  
  совпадают не просто “по дате”, а по правильному club_id.  
  Это важно именно для проблемы “не тот клуб в уведомлении”.
13. &nbsp;
14. В Discovery AFTER добавь отдельный вывод “что именно уменьшилось”.  
Не просто повторить 6 запросов, а сделать before/after summary:  

  - drift count
  - removed without audit count
  - expired-but-not-kicked count
  - stale reminders count
  - wrong-club notification count
15. &nbsp;
16. По telegram-kick-violators в DoD добавь non-fatal поведение.  
Если DM не отправился, это не должно ломать сам kick.  
Правильный порядок:  

  - kick выполнен,
  - membership state обновлён,
  - audit записан,
  - DM попытались отправить,
  - ошибка DM логируется отдельно, но не отменяет результат.
17. &nbsp;
18. Итоговый статус патча сейчас лучше формулировать так:

&nbsp;

&nbsp;

&nbsp;

- done: Phase 0, Phase 1, большая часть Phase 2
- open blockers:  

  - timezone unify in accessValidation.ts
  - DM в telegram-kick-violators
  - deploy
  - discovery AFTER
  - multi-club / multi-product proof
- &nbsp;

&nbsp;

&nbsp;

В остальном план соответствует текущей архитектуре и учитывает главное правило: никакого общего срока по пользователю, всё считается строго по конкретному клубу через его связанные product_id, а не глобально по всем подпискам пользователя.

&nbsp;

# План: Завершение патча единой системы доступа — оставшиеся обязательные блоки

## Текущий статус

- **Phase 0 (discovery BEFORE)**: done
- **Phase 1 (shared helpers)**: done — `resolve-effective-access.ts`, `invite-link-helper.ts` созданы
- **Phase 2 (edge function fixes)**: **partially done**

### Что уже сделано в Phase 2

- `telegram-grant-access`: activeUntil через `resolveEffectiveClubAccess` ✅
- `subscription-charge`: per-club membership check + зеркала через `resolveEffectiveClubAccess` + ссылки в renewal notification ✅
- `subscription-grace-reminders`: сумма по приоритету + реальный продукт + anti-stale ✅
- `subscription-renewal-reminders`: anti-stale guard ✅
- `telegram-check-expired`: audit_logs с system actor ✅
- `telegram-revoke-access`: улучшенный DM ✅

### Что НЕ сделано

1. **telegram-kick-violators**: нет DM пользователю после kick, не использует shared helper `resolveEffectiveClubAccess` напрямую (использует `hasValidAccessBatch` из `accessValidation.ts`)
2. **accessValidation.ts timezone unify**: до сих пор `WARSAW_TZ = 'Europe/Warsaw'` и `BILLING_DAY_PROTECTION_HOURS = 12` вместо end-of-day по единому timezone
3. **sendGraceNotification**: сигнатура уже обновлена (`productName?: string`), call sites уже передают `productName`, хардкод уже заменён на `${productName || 'Подписка'}` — **фактически done**
4. **Деплой всех edge functions**
5. **Discovery AFTER**
6. **Multi-club / multi-product proof**

---

## Обязательные оставшиеся задачи

### 1. Timezone unify в accessValidation.ts

**Файл**: `supabase/functions/_shared/accessValidation.ts`, строки 19-21, 67-68, 88-91.

**Текущее**:

```
const BILLING_DAY_PROTECTION_HOURS = 12;
const WARSAW_TZ = 'Europe/Warsaw';
```

**Фикс**:

- Импортировать `APP_TZ` из `timezone.ts` (уже `Europe/Minsk`)
- Заменить `WARSAW_TZ` на `APP_TZ`
- Заменить `chargeTime + 12h` на end-of-day: вычислить конец дня `todayEnd - 1s` через `dayWindowUtc(APP_TZ, todayKey)` (уже используется в `resolve-effective-access.ts`)
- Убрать `BILLING_DAY_PROTECTION_HOURS`

Это закрывает DoD: «кик НЕ до конца дня 23:59:59 по Минску».

### 2. telegram-kick-violators: DM + shared helper

**Файл**: `supabase/functions/telegram-kick-violators/index.ts`, строки 444-506.

**Фикс A — DM после kick**:
После строки 471 (audit), добавить отправку DM через link-bot:

- Получить `telegram_user_id` (уже есть в `member.telegram_user_id`)
- Текст: «❌ Ваш доступ к {club_name} завершён. Причина: срок доступа истёк.»
- Порядок: факт кика → membership update → audit → DM

**Фикс B — shared helper**:
`hasValidAccessBatch` в `accessValidation.ts` уже проверяет все 6 источников. Это корректный shared helper для batch-проверки.
Но `telegram-kick-violators` и `telegram-check-expired` должны гарантированно использовать одну и ту же логику — через один файл `accessValidation.ts`. Это уже так: оба импортируют из `_shared/accessValidation.ts`. Достаточно зафиксировать invariant: никакой локальной логики проверки доступа в этих функциях.

### 3. Деплой всех изменённых edge functions

Функции для деплоя:

- `telegram-grant-access`
- `subscription-charge`
- `subscription-grace-reminders`
- `subscription-renewal-reminders`
- `telegram-check-expired`
- `telegram-revoke-access`
- `telegram-kick-violators`

Shared helpers (`_shared/*`) деплоятся автоматически как зависимости.

### 4. Discovery AFTER — те же 6 запросов

1. SoT vs зеркала drift
2. Ошибочно removed с валидным доступом
3. Removed без audit / каким процессом
4. Expired но не kicked
5. Stale reminders
6. Не тот клуб в уведомлении

Before/after таблица с выводом по каждому пункту.

### 5. Proof-пакет

**Multi-club / multi-product proof** (обязательные кейсы):

A. **Один продукт → несколько клубов**:

- renew обновляет зеркала по каждому club_id отдельно
- уведомление содержит блоки по каждому клубу с отдельной датой и ссылками

B. **Несколько продуктов → один клуб**:

- helper берёт MAX только по product_id, привязанным к этому клубу
- не тянет чужие продукты пользователя

C. **Два клуба, два продукта, разные сроки**:

- renew продукта 1 не меняет клуб 2
- зеркала обновляются только по нужному club_id
- название/ссылки/дата в уведомлении соответствуют нужному клубу

D. **Negative proof по revoke**:

- подписка истекла, но entitlement/manual access валиден → kick не происходит

---

## Invariants (зафиксировать)

1. **Зеркала = effectiveEndAt(helper)**: `telegram_access.active_until` и `telegram_access_grants.end_at` обновляются от `resolveEffectiveClubAccess(...)`, не от `newEndDate` напрямую. Уже реализовано в `subscription-charge` (строки 1792-1811).
2. **Renewal notification при нескольких клубах**: уже реализовано — `formatClubAccessBlock` формирует отдельный блок по каждому клубу с названием и датой, `inlineKeyboard` содержит кнопки по каждому ресурсу.
3. **telegram-check-expired и telegram-kick-violators**: оба импортируют из `_shared/accessValidation.ts`, никакой локальной логики проверки доступа.

---

## Порядок выполнения

1. Timezone unify в `accessValidation.ts`
2. DM в `telegram-kick-violators`
3. Деплой всех 7 edge functions
4. Discovery AFTER (6 запросов)
5. Multi-club/multi-product proof

---

## DoD (для закрытия патча)

- Timezone в `accessValidation.ts` унифицирован на `APP_TZ`, billing-day = end-of-day
- `telegram-kick-violators` отправляет DM после успешного kick
- Все 7 edge functions задеплоены
- Discovery AFTER по 6 запросам выполнена, before/after сравнение показано
- Multi-club proof: один продукт → несколько клубов
- Multi-product proof: несколько продуктов → один клуб
- Negative proof: kick не происходит при валидном entitlement/manual access